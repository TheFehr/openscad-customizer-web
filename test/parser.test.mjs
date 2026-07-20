import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { parseCustomizer } from '../dist/customizer-parser.js';
import { applyParamOverrides } from '../dist/scad-params.js';

const scadPath = fileURLToPath(new URL('../examples/basic/nameplate.scad', import.meta.url));
const source = readFileSync(scadPath, 'utf8');
const schema = parseCustomizer(source);

function byName(name) {
  const p = schema.params.find((p) => p.name === name);
  assert.ok(p, `expected param "${name}" to be parsed`);
  return p;
}

// Groups, in file order. The parser returns *all* non-empty groups,
// including "Hidden" — it's form-builder.js that skips rendering groups
// flagged hidden, not the parser (callers may still want to introspect it).
assert.deepEqual(
  schema.groups.map((g) => g.name),
  ['Plate', 'Text', 'Mounting', 'Appearance', 'Hidden'],
);
assert.equal(schema.groups.find((g) => g.name === 'Hidden').hidden, true);

// Numeric range (min:max)
const width = byName('width');
assert.equal(width.type, 'number');
assert.equal(width.min, 40);
assert.equal(width.max, 200);
assert.equal(width.default, 80);

// Numeric range (min:step:max)
const thickness = byName('thickness');
assert.equal(thickness.type, 'number');
assert.equal(thickness.min, 2);
assert.equal(thickness.step, 0.5);
assert.equal(thickness.max, 10);

// Boolean -> checkbox regardless of any comment
const holes = byName('mounting_holes');
assert.equal(holes.type, 'boolean');
assert.equal(holes.default, true);

// Numeric dropdown, raw values (no labels)
const holeCount = byName('hole_count');
assert.equal(holeCount.type, 'dropdown');
assert.deepEqual(holeCount.options.map((o) => o.value), [2, 4]);

// String dropdown with explicit labels
const holeStyle = byName('hole_style');
assert.equal(holeStyle.type, 'dropdown');
assert.deepEqual(holeStyle.options, [
  { value: 'round', label: 'Round' },
  { value: 'slot', label: 'Slotted' },
]);

// Plain string, no constraint -> free text
const label = byName('label');
assert.equal(label.type, 'text');
assert.equal(label.default, 'Hello!');
assert.equal(label.description, 'Text to emboss on the plate');

// Description comes from the preceding // comment line
assert.equal(width.description, 'Plate width in mm');

// Hidden group: present in defaults/params for override purposes, marked hidden
const fn = schema.params.find((p) => p.name === '$fn');
assert.ok(fn, '$fn should still be parsed (usable in overrides) even though hidden');
assert.equal(fn.hidden, true);
assert.equal(fn.default, 48);

// Module bodies must NOT leak their local variables into the schema
assert.ok(!schema.params.some((p) => p.name === 'margin'), 'margin is inside a module body, not top-level');
assert.ok(!schema.params.some((p) => p.name === 'w' || p.name === 'h' || p.name === 't' || p.name === 'r'),
  'module parameters must not be parsed as customizer params');

// applyParamOverrides splices live values back into the source correctly
const overridden = applyParamOverrides(source, schema.params, {
  width: 120,
  label: 'It\'s "Working"!',
  mounting_holes: false,
  hole_style: 'slot',
});
assert.match(overridden, /^width = 120;/m);
assert.match(overridden, /^label = "It's \\"Working\\"!";/m);
assert.match(overridden, /^mounting_holes = false;/m);
assert.match(overridden, /^hole_style = "slot";/m);
// Untouched params keep their original literal
assert.match(overridden, /^height = 30;/m);

console.log(`OK — ${schema.params.length} params parsed across ${schema.groups.length} groups, overrides applied correctly`);
