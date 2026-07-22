import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { parseCustomizer } from '../dist/customizer-parser.js';

// form-builder.js expects a browser environment (document, localStorage,
// Event) as ambient globals, not injected — so each test gets a fresh JSDOM
// wired onto globalThis before (re-)importing it. `url` is required for
// jsdom to back localStorage with a real (non-opaque) origin.
let buildForm;
let container;

beforeEach(async () => {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Event = dom.window.Event;
  localStorage.clear();

  // Cache-bust so each test's ensureStyles()/module-level style-injection
  // guard starts fresh against the new document (it checks for a <style>
  // element left behind by a previous test's document).
  ({ buildForm } = await import(`../dist/form-builder.js?t=${Date.now()}-${Math.random()}`));
  container = document.createElement('div');
});

function fire(el, type = 'input') {
  el.dispatchEvent(new Event(type, { bubbles: true }));
}

describe('buildForm — field types', () => {
  test('number with a range renders a slider + live value readout', () => {
    const schema = parseCustomizer(`size = 10; // [1:0.5:20]`); // min:step:max
    const form = buildForm(container, schema);

    const input = container.querySelector('input[type="range"]');
    assert.ok(input, 'expected a range input for a constrained number');
    assert.equal(input.min, '1');
    assert.equal(input.max, '20');
    assert.equal(input.step, '0.5');
    assert.equal(input.value, '10');

    const valueSpan = container.querySelector('.oscw-value');
    assert.equal(valueSpan.textContent, '10');

    input.value = '15';
    fire(input);
    assert.equal(form.getValues().size, 15);
    assert.equal(valueSpan.textContent, '15', 'readout updates live alongside the slider');
  });

  test('number without a range renders a plain number input', () => {
    const schema = parseCustomizer(`count = 3;`);
    const form = buildForm(container, schema);

    assert.equal(container.querySelectorAll('input[type="range"]').length, 0);
    const input = container.querySelector('input[type="number"]');
    assert.ok(input);
    input.value = '9';
    fire(input);
    assert.equal(form.getValues().count, 9);
  });

  test('boolean renders a checkbox', () => {
    const schema = parseCustomizer(`enabled = false;`);
    const form = buildForm(container, schema);

    const input = container.querySelector('input[type="checkbox"]');
    assert.ok(input);
    assert.equal(input.checked, false);
    input.checked = true;
    fire(input, 'change');
    assert.equal(form.getValues().enabled, true);
  });

  test('dropdown renders a <select> with labeled options and coerces the type back on change', () => {
    const schema = parseCustomizer(`mode = "pocket"; // [pocket:Pocket,inlay:Inlay]`);
    const form = buildForm(container, schema);

    const select = container.querySelector('select');
    assert.ok(select);
    const options = [...select.options].map((o) => ({ value: o.value, label: o.textContent, selected: o.selected }));
    assert.deepEqual(options, [
      { value: 'pocket', label: 'Pocket', selected: true },
      { value: 'inlay', label: 'Inlay', selected: false },
    ]);

    select.value = 'inlay';
    fire(select, 'change');
    assert.equal(form.getValues().mode, 'inlay');
  });

  test('numeric dropdown coerces the selected value back to a number, not a string', () => {
    const schema = parseCustomizer(`sides = 6; // [3,4,6,8]`);
    const form = buildForm(container, schema);

    const select = container.querySelector('select');
    select.value = '8';
    fire(select, 'change');
    const value = form.getValues().sides;
    assert.equal(value, 8);
    assert.equal(typeof value, 'number', 'must not stay as the string "8" from select.value');
  });

  test('vector renders one number input per component, editing one leaves the others untouched', () => {
    const schema = parseCustomizer(`offset = [1, 2, 3];`);
    const form = buildForm(container, schema);

    const inputs = [...container.querySelectorAll('input[type="number"]')];
    assert.equal(inputs.length, 3);
    inputs[1].value = '99';
    fire(inputs[1]);
    assert.deepEqual(form.getValues().offset, [1, 99, 3]);
  });

  test('plain string with no widget renders <input type="text">', () => {
    const schema = parseCustomizer(`name = "Untitled";`);
    buildForm(container, schema);

    assert.ok(container.querySelector('input[type="text"]'));
    assert.equal(container.querySelectorAll('textarea').length, 0);
  });

  test('a bare-number spinbox step (no brackets) sets the number input\'s step, with no range slider', () => {
    const schema = parseCustomizer(`fine = 5.5; // .5`);
    buildForm(container, schema);

    assert.equal(container.querySelectorAll('input[type="range"]').length, 0);
    const input = container.querySelector('input[type="number"]');
    assert.equal(input.step, '0.5');
  });

  test('a bare-number string length (no brackets) sets the text input\'s maxlength', () => {
    const schema = parseCustomizer(`label = "hello"; // 8`);
    buildForm(container, schema);

    const input = container.querySelector('input[type="text"]');
    assert.equal(input.maxLength, 8);
  });

  test('description renders as a hint under the field, and is omitted when absent', () => {
    const schema = parseCustomizer(`
      // Helpful hint
      a = 1;
      b = 2;
    `);
    buildForm(container, schema);
    const fields = [...container.querySelectorAll('.oscw-field')];
    assert.equal(fields[0].querySelector('.oscw-hint').textContent, 'Helpful hint');
    assert.equal(fields[1].querySelector('.oscw-hint'), null);
  });

  test('a group flagged hidden is not rendered at all', () => {
    const schema = parseCustomizer(`
      /* [Visible] */
      a = 1;
      /* [Hidden] */
      $fn = 64;
    `);
    buildForm(container, schema);
    assert.equal(container.querySelectorAll('.oscw-group-title').length, 1);
    assert.equal(container.querySelector('.oscw-group-title').textContent, 'Visible');
    assert.equal([...container.querySelectorAll('input')].some((i) => i.value === '64'), false);
  });
});

describe('buildForm — [textarea] widget', () => {
  test('renders a <textarea> instead of <input type="text">', () => {
    const schema = parseCustomizer(`grid = "AAAA\\nBBBB"; // [textarea]`);
    buildForm(container, schema);

    const textarea = container.querySelector('textarea');
    assert.ok(textarea, 'expected a <textarea> element');
    assert.equal(container.querySelectorAll('input[type="text"]').length, 0);
    assert.equal(textarea.value, 'AAAA\nBBBB', 'initial value is the real (unescaped) multi-line default');
  });

  test('typing a multi-line value flows into getValues() as real newlines', () => {
    const schema = parseCustomizer(`grid = "x"; // [textarea]`);
    const form = buildForm(container, schema);

    const textarea = container.querySelector('textarea');
    textarea.value = 'row1\nrow2\nrow3';
    fire(textarea);

    assert.equal(form.getValues().grid, 'row1\nrow2\nrow3');
  });

  test('a non-textarea text field is unaffected (regression guard)', () => {
    const schema = parseCustomizer(`
      grid = "x"; // [textarea]
      name = "plain";
    `);
    buildForm(container, schema);
    assert.equal(container.querySelectorAll('textarea').length, 1);
    assert.equal(container.querySelectorAll('input[type="text"]').length, 1);
  });
});

describe('buildForm — persistence and programmatic updates', () => {
  test('storageKey persists values across a fresh buildForm() call (simulated reload)', () => {
    const schema = parseCustomizer(`label = "default";`);
    const first = buildForm(container, schema, { storageKey: 'test-key' });
    const input = container.querySelector('input[type="text"]');
    input.value = 'changed';
    fire(input);
    assert.equal(first.getValues().label, 'changed');

    const container2 = document.createElement('div');
    const second = buildForm(container2, schema, { storageKey: 'test-key' });
    assert.equal(second.getValues().label, 'changed', 'a fresh form with the same storageKey picks up the persisted value');
  });

  test('onChange fires with the full current values object on every change', () => {
    const schema = parseCustomizer(`
      a = 1;
      b = "x";
    `);
    const seen = [];
    const form = buildForm(container, schema, { onChange: (values) => seen.push(values) });

    fire(container.querySelector('input[type="number"]'));
    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0], { a: 1, b: 'x' });
  });

  test('setValues() updates the DOM and getValues() without needing user interaction', () => {
    const schema = parseCustomizer(`count = 1;`);
    const form = buildForm(container, schema);
    form.setValues({ count: 42 });
    assert.equal(form.getValues().count, 42);
    assert.equal(container.querySelector('input[type="number"]').value, '42');
  });

  test('a Hidden param is never restored from a saved preset — always keeps its .scad literal default', () => {
    // Matches real Customizer: "[Hidden] variables are not retrieved from
    // the JSON file" (persisted preset), even though they're still present
    // in getValues()/the render request.
    const schema = parseCustomizer(`
      /* [Hidden] */
      $fn = 64;
    `);
    const first = buildForm(container, schema, { storageKey: 'hidden-key' });
    assert.equal(first.getValues().$fn, 64);
    // Simulate a saved preset containing a stale/tampered hidden value.
    localStorage.setItem('hidden-key', JSON.stringify({ $fn: 999 }));

    const container2 = document.createElement('div');
    const second = buildForm(container2, schema, { storageKey: 'hidden-key' });
    assert.equal(second.getValues().$fn, 64, 'hidden param ignores the persisted value, keeps the source default');
  });
});
