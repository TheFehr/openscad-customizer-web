import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseCustomizer } from '../dist/customizer-parser.js';

const scadPath = fileURLToPath(new URL('../examples/basic/nameplate.scad', import.meta.url));
const nameplateSource = readFileSync(scadPath, 'utf8');
const nameplateSchema = parseCustomizer(nameplateSource);

function byName(schema, name) {
  const p = schema.params.find((p) => p.name === name);
  assert.ok(p, `expected param "${name}" to be parsed`);
  return p;
}

describe('parseCustomizer — nameplate.scad (integration fixture)', () => {
  test('returns groups in file order, including "Hidden"', () => {
    // The parser returns *all* non-empty groups, including "Hidden" — it's
    // form-builder.js that skips rendering groups flagged hidden, not the
    // parser (callers may still want to introspect it).
    assert.deepEqual(
      nameplateSchema.groups.map((g) => g.name),
      ['Plate', 'Text', 'Mounting', 'Appearance', 'Hidden'],
    );
    assert.equal(nameplateSchema.groups.find((g) => g.name === 'Hidden').hidden, true);
  });

  test('numeric range (min:max)', () => {
    const width = byName(nameplateSchema, 'width');
    assert.equal(width.type, 'number');
    assert.equal(width.min, 40);
    assert.equal(width.max, 200);
    assert.equal(width.default, 80);
    assert.equal(width.description, 'Plate width in mm', 'description comes from the preceding // comment line');
  });

  test('numeric range (min:step:max)', () => {
    const thickness = byName(nameplateSchema, 'thickness');
    assert.equal(thickness.type, 'number');
    assert.equal(thickness.min, 2);
    assert.equal(thickness.step, 0.5);
    assert.equal(thickness.max, 10);
  });

  test('boolean -> checkbox regardless of any comment', () => {
    const holes = byName(nameplateSchema, 'mounting_holes');
    assert.equal(holes.type, 'boolean');
    assert.equal(holes.default, true);
  });

  test('numeric dropdown, raw values (no labels)', () => {
    const holeCount = byName(nameplateSchema, 'hole_count');
    assert.equal(holeCount.type, 'dropdown');
    assert.deepEqual(holeCount.options.map((o) => o.value), [2, 4]);
  });

  test('string dropdown with explicit labels', () => {
    const holeStyle = byName(nameplateSchema, 'hole_style');
    assert.equal(holeStyle.type, 'dropdown');
    assert.deepEqual(holeStyle.options, [
      { value: 'round', label: 'Round' },
      { value: 'slot', label: 'Slotted' },
    ]);
  });

  test('plain string, no constraint -> free text', () => {
    const label = byName(nameplateSchema, 'label');
    assert.equal(label.type, 'text');
    assert.equal(label.default, 'Hello!');
    assert.equal(label.description, 'Text to emboss on the plate');
    assert.equal(label.widget, undefined, 'no [textarea] hint on this param');
  });

  test('Hidden group: still parsed (usable in overrides), just marked hidden', () => {
    const fn = nameplateSchema.params.find((p) => p.name === '$fn');
    assert.ok(fn, '$fn should still be parsed even though hidden');
    assert.equal(fn.hidden, true);
    assert.equal(fn.default, 48);
  });

  test('module bodies do not leak local variables into the schema', () => {
    assert.ok(!nameplateSchema.params.some((p) => p.name === 'margin'), 'margin is inside a module body, not top-level');
    assert.ok(
      !nameplateSchema.params.some((p) => ['w', 'h', 't', 'r'].includes(p.name)),
      'module parameters must not be parsed as customizer params',
    );
  });
});

describe('parseCustomizer — [textarea] widget hint', () => {
  test('sets widget on a plain string param', () => {
    const schema = parseCustomizer(`
      letters = "AAAA\\nBBBB"; // [textarea]
    `);
    const p = byName(schema, 'letters');
    assert.equal(p.type, 'text');
    assert.equal(p.widget, 'textarea');
    assert.equal(p.default, 'AAAA\nBBBB', 'the \\n escape sequence in source parses to a real newline in the default');
  });

  test('a description on the preceding line is preserved alongside a trailing [textarea] hint', () => {
    // Constraint brackets are only ever read from the trailing same-line
    // comment (matching real Customizer semantics — see the range/dropdown
    // tests above, which all put their bracket there too); a bracket in a
    // *preceding* standalone comment line is just literal description text.
    const schema = parseCustomizer(`
      // German letter grid, one row per line.
      letters_german = "EEEE\\nNNNN"; // [textarea]
    `);
    const p = byName(schema, 'letters_german');
    assert.equal(p.widget, 'textarea');
    assert.equal(p.description, 'German letter grid, one row per line.');
  });

  test('description and the bracket can also share the same trailing comment', () => {
    const schema = parseCustomizer(`grid = "x"; // Some description [textarea]`);
    const p = byName(schema, 'grid');
    assert.equal(p.widget, 'textarea');
    assert.equal(p.description, 'Some description');
  });

  test('description on the line above still works with no trailing text before the bracket', () => {
    const schema = parseCustomizer(`
      // Just a hint
      grid = "x"; // [textarea]
    `);
    const p = byName(schema, 'grid');
    assert.equal(p.widget, 'textarea');
    assert.equal(p.description, 'Just a hint');
  });

  test('is case-insensitive', () => {
    for (const variant of ['[textarea]', '[TextArea]', '[TEXTAREA]', '[ textarea ]']) {
      const schema = parseCustomizer(`grid = "x"; // ${variant}`);
      const p = byName(schema, 'grid');
      assert.equal(p.widget, 'textarea', `variant "${variant}" should set the widget`);
    }
  });

  test('does not get misparsed as a one-item dropdown', () => {
    // Before the fix, falling through to the generic options-list branch
    // would have produced type:'dropdown' with a single {value:'textarea'}
    // option instead of a plain text field with a widget hint.
    const schema = parseCustomizer(`grid = "x"; // [textarea]`);
    const p = byName(schema, 'grid');
    assert.equal(p.type, 'text');
    assert.equal(p.options, undefined);
  });

  test('is silently dropped (no crash, no widget) on a boolean default', () => {
    const schema = parseCustomizer(`flag = true; // [textarea]`);
    const p = byName(schema, 'flag');
    assert.equal(p.type, 'boolean');
    assert.equal(p.widget, undefined);
  });

  test('is silently dropped (no crash, no widget) on a number default', () => {
    const schema = parseCustomizer(`count = 5; // [textarea]`);
    const p = byName(schema, 'count');
    assert.equal(p.type, 'number');
    assert.equal(p.widget, undefined);
    assert.equal(p.min, undefined, 'textarea must not be misread as a numeric range either');
  });

  test('is silently dropped (no crash, no widget) on a vector default', () => {
    const schema = parseCustomizer(`pos = [1, 2, 3]; // [textarea]`);
    const p = byName(schema, 'pos');
    assert.equal(p.type, 'vector');
    assert.equal(p.widget, undefined);
  });

  test('a normal numeric range still parses correctly right after a textarea param', () => {
    // Regression guard: adding the textarea special-case must not disturb
    // ordinary constraint parsing for neighboring params.
    const schema = parseCustomizer(`
      grid = "x"; // [textarea]
      size = 10; // [1:20]
    `);
    assert.equal(byName(schema, 'grid').widget, 'textarea');
    const size = byName(schema, 'size');
    assert.equal(size.type, 'number');
    assert.equal(size.min, 1);
    assert.equal(size.max, 20);
  });
});
