// Rewrites top-level `name = <literal>;` assignments in a .scad source with
// live values from the form, using the parsed Customizer schema to know how
// each value must be serialized back into OpenSCAD literal syntax.
import type { CustomizerParam } from './customizer-parser.js';

export type ParamValue = number | string | boolean | Array<number | string>;
export type ParamValues = Record<string, ParamValue>;

function scadString(s: unknown): string {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
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
