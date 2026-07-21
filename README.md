# openscad-customizer-web

In-browser 3D preview + STL/3MF export for OpenSCAD models, with the controls
panel generated automatically from the model's own [OpenSCAD Customizer](https://openscad.org/customizer.html)
comments — the same `// [min:max]` / `/* [Group] */` syntax OpenSCAD's
desktop app and Thingiverse Customizer already read. No per-project form code.

Renders with [openscad-wasm](https://www.npmjs.com/package/openscad-wasm) in
a Web Worker (off the main thread) and displays the result with
[three.js](https://threejs.org/). Zero build step *for consumers* — the
published package is plain ES modules (compiled from TypeScript ahead of
time), loaded via `<script type="importmap">` the same way you'd already
import three.js from a CDN. The TypeScript build only runs inside this repo;
projects using the library never need a bundler.

## Why

Three separate personal projects (door_latch, pavilion-of-scrying,
spell_tiles) each hand-built a `preview.html` + `preview-worker.js` from
scratch, and they drifted: different form styles, different ways of
splicing parameter values into the `.scad` source, duplicated OFF-parsing
and STL-export code. This package is the common core those three files
actually needed, minus the copy-paste — the parts that are always the same
(WASM lifecycle, mesh parsing, viewer setup, STL export) live here; the only
project-specific input is a `.scad` file annotated the standard way.

## Quick start

```html
<script type="importmap">
  {
    "imports": {
      "three": "https://cdn.jsdelivr.net/npm/three@0.167.0/build/three.module.js",
      "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.167.0/examples/jsm/"
    }
  }
</script>

<nav id="controls"></nav>
<canvas id="preview"></canvas>
<span id="status"></span>
<button id="btn-download">Download STL</button>

<script type="module">
  import { OpenScadPreview } from 'openscad-customizer-web';

  new OpenScadPreview({
    canvas:      document.getElementById('preview'),
    controlsEl:  document.getElementById('controls'),
    statusEl:    document.getElementById('status'),
    downloadBtn: document.getElementById('btn-download'),
    scadUrl:     './model.scad',
    workerUrl:   new URL('openscad-customizer-web/worker.js', import.meta.url),
  });
</script>
```

That's the entire integration for a model with no text-rendering or
multi-color needs. See `examples/basic/` for a complete working page
(a parametric nameplate, exercising every Customizer control type,
including `text()` glyph rendering).

## Customizer syntax this reads

Only *top-level* `name = literal;` assignments are customizable — anything
inside a `module`/`function` body, or a default that references another
variable or calls a function, is left alone (matching real Customizer
behavior).

```scad
/* [Group Name] */               // starts a new section in the form

// Shown as the field's description/tooltip
wall_thickness = 2;   // [0.4:0.1:5]        min : step : max  -> slider
sides           = 6;  // [3,4,5,6,8,12]     comma list        -> dropdown
mode = "pocket";      // [pocket:Pocket,inlay:Inlay]  value:Label pairs -> labeled dropdown
show_base = true;                            booleans -> checkbox, always
name = "Untitled";                           string, no constraint -> free text field
offset = [0, 0, 0];   // [-50:50]           vector -> one number input per component

/* [Hidden] */
$fn = 64;                                    present in defaults/overrides, never shown
```

## API

- **`OpenScadPreview`** — the orchestrator class shown above. Fetches
  `scadUrl`, builds the form, sets up the viewer, creates the worker, and
  wires render-on-change with debouncing. See the JSDoc in `src/preview.js`
  for every option (bed size, localStorage key, custom download naming,
  text-glyph config, etc).
- **`parseCustomizer(source)`** — the parser on its own, if you want the
  schema without the rest (`{ groups, params, defaults }`).
- **`buildForm(container, schema, opts)`** — the form generator on its own.
- **`Viewer`** — the three.js scene/camera/controls wrapper on its own.
- **`applyParamOverrides(source, params, values)`** — splices live values
  back into `.scad` source text.
- Mesh/export helpers: `offToTrianglePositions`, `offToIndexedMesh`,
  `trianglesToStl`, `downloadStl`.

## Optional modules

Two problems that came up in real projects, folded in as opt-in pieces
rather than assumed by the core:

- **`text-glyphs.js`** — openscad-wasm ships with *no* font data, so
  `text()` produces nothing in-browser. `buildTextOverride(strings, size, opts)`
  renders the needed strings with [opentype.js](https://opentype.js.org/) +
  a real webfont and returns a `module text(...) {}` override that shadows
  the builtin. Wire it up via `OpenScadPreview`'s `textGlyphs` option (see
  `examples/basic/index.html`). The default font is DejaVu Sans Bold; the
  size-calibration factor is measured against that specific font — recalibrate
  `sizeFactor` if you swap fonts (compare against OpenSCAD's own `textmetrics()`
  for the same nominal `size`).
- **`export-3mf.js`** — `buildMultiColor3mf(parts)` writes a single `.3mf`
  with one color per part (via the 3MF Materials & Properties Extension's
  `<m:colorgroup>`, which Bambu Studio/OrcaSlicer/PrusaSlicer read correctly
  — unlike the core-spec `<basematerials>` element OpenSCAD's own 3MF
  exporter uses, which Bambu Studio silently ignores).

## Multi-part / colored output, and other non-default rendering

The default `worker.js` covers the common case: one entry file, optional
`use </include <` dependencies, one uncolored output part. Projects that
render multiple differently-colored passes (e.g. a two-material inlay, or
splitting output by `color()`-tagged module) need project-specific pass
logic — how to isolate each part varies per `.scad` file's module structure,
so this isn't something a generic form-driven library can infer.

Write a small custom worker against the low-level primitives in
`worker-core.js` instead of reimplementing the WASM lifecycle:

```js
import { loadOpenScadModule, runOpenScadPass, fetchText, makeLogger } from
  'openscad-customizer-web/worker-core.js';
```

`runOpenScadPass(mod, files, entryFsPath, { onLog, args })` runs one render
pass in a fresh WASM instance (each pass needs its own — the Emscripten
runtime exits after the first `callMain()`) and returns OFF text or `null`.
Call it once per part/color, post back `{ type: 'result', parts: [{ off, color }, ...] }`
in the same shape the default worker uses, and `OpenScadPreview` (and
`Viewer.loadParts`) handle the rest unmodified.

## Requirements

- A browser with WebGL2 and module Worker support (all current
  Chrome/Firefox/Safari/Edge).
- Serve over HTTP(S) — `file://` won't work (Worker + fetch restrictions).
- `three` resolvable via an import map in the host page (viewer.js imports
  it as a bare specifier, same as any other three.js page).

## Development

Source is TypeScript under `src/`, compiled to plain ESM + `.d.ts` under
`dist/` (not committed — build it locally):

```sh
npm install
npm run build     # tsc -p tsconfig.json && tsc -p tsconfig.worker.json
npm test          # builds, then runs test/parser.test.mjs
```

Two `tsconfig`s exist because main-thread code needs the `DOM` lib and
worker code needs the `WebWorker` lib, and TypeScript can't type-check a
single program against both (they declare conflicting globals, e.g. `self`).
`tsconfig.json` covers everything reachable from `src/index.ts` (never
imports the worker files); `tsconfig.worker.json` covers `src/worker.ts` and
what it imports. `customizer-parser.ts`, `scad-params.ts`, and `protocol.ts`
are environment-agnostic and get compiled into both — harmless, since their
output is identical either way.

To try the example locally, build first, then serve the repo root over HTTP
(Worker + fetch don't work over `file://`) and open `examples/basic/`:

```sh
npm run build
python3 -m http.server 8080
# http://localhost:8080/examples/basic/
```

## Authorship

Code generated by [Claude](https://claude.com/claude-code). Design,
requirements, and decisions by Philipp Fehr.

## Status

Core library only — not yet wired into any of the three projects that
motivated it (door_latch, pavilion-of-scrying, spell_tiles). Migrating those
is expected to shrink each one to a `.scad` file + a small config object,
but hasn't been done yet.
