import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseCustomizer } from '../dist/customizer-parser.js';
import { applyParamOverrides } from '../dist/scad-params.js';

// Round-trips a value through applyParamOverrides() and back through
// parseCustomizer(), and asserts the recovered default matches what was
// written in — the property that actually matters for correctness (byte-
// level escaping details are an implementation detail of getting this
// property right).
function roundTrip(scadSource, paramName, value) {
  const schema = parseCustomizer(scadSource);
  const param = schema.params.find((p) => p.name === paramName);
  assert.ok(param, `expected param "${paramName}" in fixture source`);
  const rewritten = applyParamOverrides(scadSource, schema.params, { [paramName]: value });
  const reparsed = parseCustomizer(rewritten);
  const reparsedParam = reparsed.params.find((p) => p.name === paramName);
  assert.ok(reparsedParam, `"${paramName}" should still be parseable after rewriting`);
  return { rewritten, value: reparsedParam.default };
}

describe('applyParamOverrides — basic serialization per type', () => {
  const source = `
    width = 80;
    label = "Hello!";
    mounting_holes = true;
    hole_style = "round";
    offset = [0, 0, 0];
    height = 30;
  `;
  const schema = parseCustomizer(source);

  test('number', () => {
    const out = applyParamOverrides(source, schema.params, { width: 120 });
    assert.match(out, /^\s*width = 120;/m);
  });

  test('boolean', () => {
    const out = applyParamOverrides(source, schema.params, { mounting_holes: false });
    assert.match(out, /^\s*mounting_holes = false;/m);
  });

  test('dropdown (string-valued)', () => {
    const out = applyParamOverrides(source, schema.params, { hole_style: 'slot' });
    assert.match(out, /^\s*hole_style = "slot";/m);
  });

  test('vector', () => {
    const out = applyParamOverrides(source, schema.params, { offset: [1, 2.5, -3] });
    assert.match(out, /^\s*offset = \[1,2\.5,-3\];/m);
  });

  test('untouched params keep their original literal', () => {
    const out = applyParamOverrides(source, schema.params, { width: 120 });
    assert.match(out, /^\s*height = 30;/m);
  });

  test('text with embedded quotes and backslashes', () => {
    const out = applyParamOverrides(source, schema.params, { label: 'It\'s "Working"! C:\\path' });
    assert.match(out, /^\s*label = "It's \\"Working\\"! C:\\\\path";/m);
  });
});

describe('applyParamOverrides — newline escaping (textarea round-trip)', () => {
  const source = `grid = "AAAA\\nBBBB"; // [textarea]`;

  test('a value containing \\n is NOT spliced in as a raw line break', () => {
    const schema = parseCustomizer(source);
    const out = applyParamOverrides(source, schema.params, { grid: 'EEEE\nNNNN\nZZZZ' });
    // The whole assignment must stay on one line in the regenerated source —
    // a raw embedded newline here would break it across lines and produce
    // invalid/unterminated-string OpenSCAD syntax.
    assert.match(out, /^grid = "EEEE\\nNNNN\\nZZZZ";\s*(\/\/.*)?$/m);
    assert.equal(out.split('\n').length, 1, 'the rewritten single-statement source must still be one line');
  });

  test('round-trips through parseCustomizer back to the original multi-line value', () => {
    const { value } = roundTrip(source, 'grid', 'row1\nrow2\nrow3');
    assert.equal(value, 'row1\nrow2\nrow3');
  });

  test('CRLF line endings are normalized to \\n, not left as literal \\r', () => {
    const { rewritten, value } = roundTrip(source, 'grid', 'row1\r\nrow2\r\nrow3');
    assert.ok(!rewritten.includes('\r'), 'no raw CR should end up in the regenerated source');
    assert.equal(value, 'row1\nrow2\nrow3', 'CRLF collapses to LF on round-trip, matching a real <textarea>.value');
  });

  test('lone CR (old Mac style) is also normalized', () => {
    const { value } = roundTrip(source, 'grid', 'row1\rrow2');
    assert.equal(value, 'row1\nrow2');
  });

  test('tabs are escaped too', () => {
    const { rewritten, value } = roundTrip(source, 'grid', 'a\tb');
    assert.ok(rewritten.includes('\\t'), 'tab should be written as the two-char escape');
    assert.ok(!rewritten.match(/"[^"]*\t[^"]*"/), 'no raw tab byte inside the string literal');
    assert.equal(value, 'a\tb');
  });

  test('newline combined with quotes and backslashes in the same value', () => {
    const { value } = roundTrip(source, 'grid', 'He said "hi"\nC:\\temp\nBye');
    assert.equal(value, 'He said "hi"\nC:\\temp\nBye');
  });

  test('multiple newlines in a row (blank lines in the grid)', () => {
    const { value } = roundTrip(source, 'grid', 'a\n\n\nb');
    assert.equal(value, 'a\n\n\nb');
  });
});
