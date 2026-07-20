// Optional module: openscad-wasm ships with no font data at all — no
// .ttf/.woff anywhere in the bundle — so text() can never produce glyphs in
// a browser render. This works around that by rendering each needed string
// to a vector outline ourselves with opentype.js + a real webfont, then
// generating a `module text(...) {}` override that dispatches on the string
// argument to a precomputed polygon() literal — shadowing the OpenSCAD
// builtin by name (a user-defined module takes precedence over a builtin of
// the same name), so any of the project's own `text(...)` calls pick it up
// unmodified.
//
// Runs fine inside a Worker (fetch + ArrayBuffer, no DOM needed). opentype.js
// is loaded from a CDN at runtime via a dynamic import — no local type
// dependency for a library that's peripheral to this package's core value.

const DEFAULT_FONT_URL =
  'https://cdn.jsdelivr.net/npm/@fontsource/dejavu-sans@5.2.5/files/dejavu-sans-latin-700-normal.woff';

// Indirected through a variable (rather than a string literal directly in
// the import() call) so TypeScript treats this as a dynamic, unresolvable
// specifier (-> Promise<any>) instead of attempting module resolution
// against a real URL at type-check time.
const OPENTYPE_CDN_URL = 'https://cdn.jsdelivr.net/npm/opentype.js@2.0.0/+esm';

// OpenSCAD's real text(size=N) does not map 1:1 onto font units the way
// opentype.js's `fontSize / unitsPerEm` scaling does. Measured against
// DejaVu Sans Bold specifically (via OpenSCAD's own textmetrics()), its
// glyphs come out ~1.389x larger than opentype.js's for the same nominal
// `size` — this factor is font-specific; recalibrate if you swap fonts.
const DEFAULT_SIZE_FACTOR = 100 / 72;

export interface TextGlyphOptions {
  fontUrl?: string;
  sizeFactor?: number;
}

interface OpentypePathCommand {
  type: 'M' | 'L' | 'C' | 'Q' | 'Z';
  x?: number; y?: number;
  x1?: number; y1?: number;
  x2?: number; y2?: number;
}

interface OpentypeFont {
  unitsPerEm: number;
  charToGlyph(ch: string): {
    advanceWidth: number;
    getPath(x: number, y: number, fontSize: number): { commands: OpentypePathCommand[] };
  };
}

let cachedFont: OpentypeFont | null = null;
let cachedFontUrl: string | null = null;

async function loadFont(fontUrl: string): Promise<OpentypeFont> {
  if (cachedFont && cachedFontUrl === fontUrl) return cachedFont;
  const ot = await import(/* webpackIgnore: true */ OPENTYPE_CDN_URL);
  const buf = await fetch(fontUrl).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status} fetching font ${fontUrl}`);
    return r.arrayBuffer();
  });
  cachedFont = ot.parse(buf) as OpentypeFont;
  cachedFontUrl = fontUrl;
  return cachedFont;
}

// Flattens an opentype.js Path (M/L/C/Q/Z commands) into subpaths of [x,y]
// points, tessellating bezier curves. opentype.js uses canvas-style Y-down
// coordinates; OpenSCAD's polygon() is math-style Y-up, so Y is negated on
// the way out — a uniform mirror flips every contour's winding together, so
// outer/hole relationships polygon() relies on for letters like A/O/Q/D
// still come out correct.
function flattenPath(path: { commands: OpentypePathCommand[] }, segments = 10): number[][][] {
  const subpaths: number[][][] = [];
  let current: number[][] | null = null;
  let cx = 0, cy = 0;

  for (const cmd of path.commands) {
    if (cmd.type === 'M') {
      current = [[cmd.x!, -cmd.y!]];
      subpaths.push(current);
      cx = cmd.x!; cy = cmd.y!;
    } else if (cmd.type === 'L') {
      current!.push([cmd.x!, -cmd.y!]);
      cx = cmd.x!; cy = cmd.y!;
    } else if (cmd.type === 'C') {
      for (let i = 1; i <= segments; i++) {
        const t = i / segments, mt = 1 - t;
        const x = mt*mt*mt*cx + 3*mt*mt*t*cmd.x1! + 3*mt*t*t*cmd.x2! + t*t*t*cmd.x!;
        const y = mt*mt*mt*cy + 3*mt*mt*t*cmd.y1! + 3*mt*t*t*cmd.y2! + t*t*t*cmd.y!;
        current!.push([x, -y]);
      }
      cx = cmd.x!; cy = cmd.y!;
    } else if (cmd.type === 'Q') {
      for (let i = 1; i <= segments; i++) {
        const t = i / segments, mt = 1 - t;
        const x = mt*mt*cx + 2*mt*t*cmd.x1! + t*t*cmd.x!;
        const y = mt*mt*cy + 2*mt*t*cmd.y1! + t*t*cmd.y!;
        current!.push([x, -y]);
      }
      cx = cmd.x!; cy = cmd.y!;
    } // 'Z' needs no point — polygon() closes each path implicitly
  }
  return subpaths.filter((sp) => sp.length >= 3);
}

// Builds a glyph path manually, one character at a time, positioned by
// simple advance-width summation. opentype.js's own getPath()/
// stringToGlyphs applies the font's full GSUB shaping (ligatures, kerning
// tables, ...) and throws on lookup formats it doesn't implement for some
// fonts/strings; most CAD label text doesn't need ligatures/kerning, so this
// sidesteps that entirely.
function getTextPathManual(font: OpentypeFont, text: string, fontSize: number) {
  const scale = fontSize / font.unitsPerEm;
  let x = 0;
  const commands: OpentypePathCommand[] = [];
  for (const ch of text) {
    const glyph = font.charToGlyph(ch);
    commands.push(...glyph.getPath(x, 0, fontSize).commands);
    x += glyph.advanceWidth * scale;
  }
  return { commands };
}

function scadString(s: string): string {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// polygon(points=..., paths=...) literal for one string, pre-centered on the
// origin to match text(..., halign="center", valign="center"). Returns null
// for strings that produce no glyph outlines (e.g. a space).
function stringPolygonLiteral(
  font: OpentypeFont,
  text: string,
  fontSize: number,
  sizeFactor: number,
): string | null {
  const path = getTextPathManual(font, text, fontSize * sizeFactor);
  const subpaths = flattenPath(path);
  if (subpaths.length === 0) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const sp of subpaths) for (const [x, y] of sp) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const dx = -(minX + maxX) / 2;
  const dy = -(minY + maxY) / 2;

  const points: string[] = [];
  const paths: string[] = [];
  for (const sp of subpaths) {
    const idx: number[] = [];
    for (const [x, y] of sp) {
      idx.push(points.length);
      points.push(`[${(x + dx).toFixed(3)},${(y + dy).toFixed(3)}]`);
    }
    paths.push(`[${idx.join(',')}]`);
  }
  return `polygon(points=[${points.join(',')}], paths=[${paths.join(',')}])`;
}

/**
 * Builds a `module text(t, size, halign, valign, font) {...}` source snippet
 * that dispatches on `t` to a precomputed polygon() per unique string —
 * needed whenever more than one distinct string is rendered (e.g. many
 * differently-labeled instances in one file).
 *
 * @param strings All distinct strings that will be passed to text() in this
 *   render pass. Duplicates/blanks are fine.
 * @param fontSize The `size=` value the SCAD source's text() calls use for
 *   these strings.
 */
export async function buildTextOverride(
  strings: string[],
  fontSize: number,
  opts: TextGlyphOptions = {},
): Promise<string> {
  const fontUrl = opts.fontUrl ?? DEFAULT_FONT_URL;
  const sizeFactor = opts.sizeFactor ?? DEFAULT_SIZE_FACTOR;

  const unique = [...new Set(strings)].filter((s) => s);
  if (unique.length === 0) return 'module text(t, size, halign, valign, font) {}';

  const font = await loadFont(fontUrl);
  const branches: string[] = [];
  for (const s of unique) {
    const lit = stringPolygonLiteral(font, s, fontSize, sizeFactor);
    if (lit) branches.push(`if (t == "${scadString(s)}") ${lit};`);
  }
  if (branches.length === 0) return 'module text(t, size, halign, valign, font) {}';

  return `module text(t, size, halign, valign, font) {\n  ${branches.join('\n  else ')}\n}`;
}
