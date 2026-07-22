// Parses OpenSCAD's official "Customizer" comment syntax out of a .scad source
// string — the same annotations openscad.org's desktop Customizer panel and
// the Thingiverse Customizer both read:
//
//   /* [Group Name] */
//
//   // Description shown above the control
//   wall_thickness = 2; // [0.4:0.1:5]     <- min:step:max slider
//   rounding       = 3;  // [50]            <- bare number in brackets: max-only slider (min 0, step 1)
//   sides           = 6; // [3,4,5,6,8,12]  <- dropdown of raw values
//   mode = "pocket"; // [pocket:Pocket,inlay:Inlay,flush:Flush]  <- labeled dropdown
//   show_base = true;                       <- booleans are always checkboxes
//   name = "Untitled";                      <- plain string, no constraint = free text
//   fine_step = 5.5;     // .5              <- bare number, no brackets: spinbox step size
//   label = "Untitled";  // 8               <- bare number, no brackets: max string length
//   offset = [0, 0, 0]; // [-50:50]         <- vector, range applies to each component
//
//   /* [Hidden] */
//   $fn = 64;                               <- present in the schema/defaults, never
//                                               rendered as a form control
//
// Only literal defaults (number / string / bool / array of those) are
// recognized as customizable, matching real Customizer behavior — a default
// that references another variable or calls a function is left alone.

export type ParamType = 'number' | 'text' | 'boolean' | 'vector' | 'dropdown';

export type CustomizerDefault = number | string | boolean | Array<number | string>;

export interface DropdownOption {
  value: string | number;
  label: string;
}

export type ParamWidget = 'textarea';

export interface CustomizerParam {
  name: string;
  type: ParamType;
  default: CustomizerDefault;
  description: string;
  group: string;
  hidden: boolean;
  min?: number;
  max?: number;
  step?: number;
  /** Max character length, from a bare (bracket-less) numeric trailing comment on a string param, e.g. `label = "x"; // 8`. */
  maxLength?: number;
  options?: DropdownOption[];
  /**
   * Rendering hint beyond real OpenSCAD Customizer syntax (verified against
   * the official manual: there is no native multi-line widget — a bare `//
   * [textarea]` is not a bracket form the desktop Customizer's own comment
   * parser recognizes for a string, so on a real .scad file it should be
   * silently ignored there, falling back to an ordinary single-line text
   * box — not a divergent/broken file, just a no-op elsewhere). Only ever
   * set when `type === 'text'`.
   */
  widget?: ParamWidget;
}

export interface CustomizerGroup {
  name: string;
  hidden: boolean;
  params: CustomizerParam[];
}

export interface CustomizerSchema {
  groups: CustomizerGroup[];
  params: CustomizerParam[];
  defaults: Record<string, CustomizerDefault>;
}

type Constraint =
  | { kind: 'range'; min: number; max: number; step: number }
  | { kind: 'options'; options: DropdownOption[] };

const ASSIGNMENT_RE =
  /^\s*(\$?[A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?);\s*(?:\/\/\s*(.*))?$/;
const GROUP_RE = /^\/\*\s*\[(.+?)\]\s*\*\/\s*$/;
const LINE_COMMENT_RE = /^\/\/\s?(.*)$/;

// Strips "..." string-literal contents (keeping the quotes) so brace-counting
// and comment detection don't get confused by braces/slashes inside strings.
function blankStrings(line: string): string {
  return line.replace(/"(?:[^"\\]|\\.)*"/g, (m) => '"' + ' '.repeat(m.length - 2) + '"');
}

function coerceOptionValue(token: string, exampleValue: unknown): string | number {
  if (typeof exampleValue === 'number') {
    const n = Number(token);
    return Number.isNaN(n) ? token : n;
  }
  return token;
}

// Splits a bracket constraint's inner text on top-level commas (there's no
// nesting to worry about — option tokens can't themselves contain commas).
function splitOptions(inner: string): string[] {
  return inner.split(',').map((s) => s.trim()).filter(Boolean);
}

function parseConstraint(text: string, defaultValue: CustomizerDefault): Constraint | null {
  const trimmed = text.trim();

  const rangeMatch = trimmed.match(
    /^(-?[\d.]+)\s*:\s*(-?[\d.]+)\s*(?::\s*(-?[\d.]+))?$/,
  );
  if (rangeMatch) {
    const a = parseFloat(rangeMatch[1]);
    const b = parseFloat(rangeMatch[2]);
    const c = rangeMatch[3] !== undefined ? parseFloat(rangeMatch[3]) : undefined;
    const min = a;
    const max = c === undefined ? b : c;
    const step = c === undefined ? 1 : b;
    return { kind: 'range', min, max, step };
  }

  // A bare number with no colon (e.g. "[50]") is real Customizer syntax for
  // a max-only slider on a numeric default — min 0, step 1 — not a one-item
  // dropdown. Only applies when the default is actually numeric; on a
  // string/bool default the same bracket form is a (degenerate) one-item
  // options list, handled below.
  const bareNumberMatch = trimmed.match(/^-?[\d.]+$/);
  const sample = Array.isArray(defaultValue) ? defaultValue[0] : defaultValue;
  if (bareNumberMatch && typeof sample === 'number') {
    return { kind: 'range', min: 0, max: parseFloat(bareNumberMatch[0]), step: 1 };
  }

  // Anything else (not a numeric min:max[:step] range) is a dropdown option
  // list, e.g. "[3,4,5,6]" or "[a:Label A,b:Label B]".
  const rawOptions = splitOptions(trimmed);
  if (rawOptions.length === 0) return null;
  const options: DropdownOption[] = rawOptions.map((tok) => {
    const idx = tok.indexOf(':');
    if (idx === -1) {
      const value = coerceOptionValue(tok, sample);
      return { value, label: String(value) };
    }
    const rawValue = tok.slice(0, idx).trim();
    const label = tok.slice(idx + 1).trim().replace(/^"(.*)"$/, '$1');
    return { value: coerceOptionValue(rawValue, sample), label };
  });
  return { kind: 'options', options };
}

// Comment text may be "Description [constraint]", "Description" alone, or
// just "[constraint]" alone. Constraint, if present, is always the trailing
// [...] chunk.
function splitDescriptionAndConstraint(
  commentText: string | undefined,
): { description: string; constraintText: string | null } {
  if (commentText === undefined) return { description: '', constraintText: null };
  const m = commentText.match(/^(.*?)\s*\[([^\]]*)\]\s*$/);
  if (!m) return { description: commentText.trim(), constraintText: null };
  return { description: m[1].trim(), constraintText: m[2] };
}

function classify(defaultValue: CustomizerDefault, constraint: Constraint | null): ParamType | null {
  if (typeof defaultValue === 'boolean') return 'boolean';
  if (constraint?.kind === 'options') return 'dropdown';
  if (Array.isArray(defaultValue)) return 'vector';
  if (typeof defaultValue === 'number') return 'number';
  if (typeof defaultValue === 'string') return 'text';
  return null;
}

export function parseCustomizer(source: string): CustomizerSchema {
  const lines = source.split('\n');

  const groups: CustomizerGroup[] = [{ name: '', hidden: false, params: [] }];
  let currentGroup = groups[0];
  let depth = 0;
  let inBlockComment = false;
  let pendingDescription: string | null = null;

  for (const rawLine of lines) {
    let line = rawLine;

    if (inBlockComment) {
      const end = line.indexOf('*/');
      if (end === -1) continue;
      line = line.slice(end + 2);
      inBlockComment = false;
    }

    const stripped = blankStrings(line);
    const trimmed = stripped.trim();

    if (depth === 0) {
      const groupMatch = trimmed.match(GROUP_RE);
      if (groupMatch) {
        const name = groupMatch[1].trim();
        currentGroup = { name, hidden: /^hidden$/i.test(name), params: [] };
        groups.push(currentGroup);
        pendingDescription = null;
        continue;
      }

      const lineCommentMatch = trimmed.match(LINE_COMMENT_RE);
      if (lineCommentMatch && !trimmed.startsWith('/*')) {
        pendingDescription =
          pendingDescription === null
            ? lineCommentMatch[1].trim()
            : `${pendingDescription} ${lineCommentMatch[1].trim()}`;
        continue;
      }

      if (trimmed === '') {
        continue;
      }

      const assignMatch = line.match(ASSIGNMENT_RE);
      if (assignMatch) {
        const [, name, valueExpr, trailingComment] = assignMatch;
        let defaultValue: CustomizerDefault | undefined;
        try {
          defaultValue = JSON.parse(valueExpr.trim());
        } catch {
          defaultValue = undefined; // not a literal — not customizable, skip
        }

        const descriptionFromAbove = pendingDescription;
        pendingDescription = null;

        if (defaultValue !== undefined) {
          const { description: trailingDesc, constraintText } =
            splitDescriptionAndConstraint(trailingComment);

          // A trailing comment with no brackets at all that's *just* a bare
          // number is real Customizer syntax too: a spinbox step size on a
          // numeric default (`// .5`), or a max string length on a string
          // default (`// 8`) — not description text, even though it has no
          // brackets to mark it as a constraint.
          const bareNumberHint =
            constraintText === null && trailingComment !== undefined
              ? trailingComment.trim().match(/^-?\d*\.?\d+$/)
              : null;

          const description = bareNumberHint ? descriptionFromAbove || '' : trailingDesc || descriptionFromAbove || '';

          // `[textarea]` is a library-specific widget hint, not a real
          // Customizer range/options constraint — intercept it before
          // parseConstraint() ever sees it, or it falls through to the
          // options-list branch and gets misparsed as a one-item dropdown.
          let widget: ParamWidget | undefined;
          let constraint: Constraint | null = null;
          if (constraintText !== null && /^textarea$/i.test(constraintText.trim())) {
            widget = 'textarea';
          } else if (constraintText) {
            constraint = parseConstraint(constraintText, defaultValue);
          }

          const type = classify(defaultValue, constraint);

          if (type) {
            const param: CustomizerParam = {
              name,
              type,
              default: defaultValue,
              description,
              group: currentGroup.name,
              hidden: currentGroup.hidden,
            };
            // Only meaningful for a plain text field — silently dropped for
            // any other type rather than erroring on a nonsense combination
            // (e.g. `[textarea]` on a boolean or number default).
            if (widget && type === 'text') param.widget = widget;
            if ((type === 'number' || type === 'vector') && constraint?.kind === 'range') {
              param.min = constraint.min;
              param.max = constraint.max;
              param.step = constraint.step;
            }
            if (bareNumberHint) {
              const n = parseFloat(bareNumberHint[0]);
              if (type === 'number') param.step = n;
              else if (type === 'text') param.maxLength = Math.max(0, Math.round(n));
            }
            if (type === 'dropdown' && constraint?.kind === 'options') {
              param.options = constraint.options;
            }
            currentGroup.params.push(param);
          }
        }
        continue;
      }

      pendingDescription = null;
    }

    // Depth tracking (post string-blanking) so assignments inside module/
    // function bodies are correctly ignored, and a `/*` that doesn't close
    // on the same line puts us into block-comment mode from the next line.
    let scan = stripped;
    const blockStart = scan.indexOf('/*');
    const lineCommentStart = scan.indexOf('//');
    if (blockStart !== -1 && (lineCommentStart === -1 || blockStart < lineCommentStart)) {
      const blockEnd = scan.indexOf('*/', blockStart + 2);
      if (blockEnd === -1) {
        scan = scan.slice(0, blockStart);
        inBlockComment = true;
      } else {
        scan = scan.slice(0, blockStart) + scan.slice(blockEnd + 2);
      }
    } else if (lineCommentStart !== -1) {
      scan = scan.slice(0, lineCommentStart);
    }
    for (const ch of scan) {
      if (ch === '{') depth++;
      else if (ch === '}') depth = Math.max(0, depth - 1);
    }
  }

  const nonEmptyGroups = groups.filter((g) => g.params.length > 0);
  const params = nonEmptyGroups.flatMap((g) => g.params);
  const defaults = Object.fromEntries(params.map((p) => [p.name, p.default]));

  return { groups: nonEmptyGroups, params, defaults };
}
