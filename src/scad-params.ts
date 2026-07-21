// Rewrites top-level `name = <literal>;` assignments in a .scad source with
// live values from the form, using the parsed Customizer schema to know how
// each value must be serialized back into OpenSCAD literal syntax.
import type { CustomizerParam } from './customizer-parser.js';

export type ParamValue = number | string | boolean | Array<number | string>;
export type ParamValues = Record<string, ParamValue>;

// Order matters: backslash first (or a literal backslash introduced by a
// later replace would itself get re-escaped), then the characters that
// need a backslash escape inside an OpenSCAD/C-like double-quoted string
// literal. A raw embedded newline (e.g. from a <textarea> value) would
// otherwise get spliced straight into the regenerated .scad source as a
// literal line break inside the string token — a syntax error, not valid
// multi-line content; \r\n and lone \r are normalized to \n first so
// Windows-style line endings don't leave a stray \r behind.
function scadString(s: unknown): string {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r\n?/g, '\\n')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
}

function serialize(type: CustomizerParam['type'], value: ParamValue): string {
  switch (type) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'text':
      return `"${scadString(value)}"`;
    case 'dropdown':
      return typeof value === 'string' ? `"${scadString(value)}"` : String(value);
    case 'vector':
      return `[${(value as Array<number | string>).map((n) => Number(n)).join(',')}]`;
    case 'number':
    default:
      return String(Number(value));
  }
}

/**
 * @param source Original .scad source.
 * @param params Parsed Customizer params (from parseCustomizer).
 * @param values Current form values, keyed by param name.
 * @returns Source with each param's assignment replaced.
 */
export function applyParamOverrides(
  source: string,
  params: CustomizerParam[],
  values: ParamValues,
): string {
  let out = source;
  for (const param of params) {
    if (!(param.name in values)) continue;
    const value = values[param.name];
    if (value === undefined || value === null) continue;

    const escapedName = param.name.replace(/[$]/g, '\\$');
    const re = new RegExp(`^(\\s*${escapedName}\\s*=\\s*)[^;]+;`, 'm');
    if (!re.test(out)) continue;
    out = out.replace(re, `$1${serialize(param.type, value)};`);
  }
  return out;
}
