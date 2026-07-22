// Renders a live form straight from a parsed Customizer schema (see
// customizer-parser.ts) — this is the piece that removes the need for every
// project to hand-build its own controls panel. One .scad file with proper
// `// [min:max]` / `/* [Group] */` annotations is enough.
import type { CustomizerParam, CustomizerSchema, ParamType } from './customizer-parser.js';
import type { ParamValue, ParamValues } from './scad-params.js';

const STYLE_ID = 'oscw-form-styles';

const DEFAULT_CSS = `
.oscw-form { display: flex; flex-direction: column; gap: 18px; font-size: 14px; }
.oscw-group { display: flex; flex-direction: column; gap: 12px; }
.oscw-group-title {
  font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;
  color: var(--oscw-muted, #8b949e); border-bottom: 1px solid var(--oscw-border, #30363d);
  padding-bottom: 4px;
}
.oscw-field { display: flex; flex-direction: column; gap: 4px; }
.oscw-field-row { display: flex; align-items: center; gap: 8px; }
.oscw-label {
  font-size: 12px; color: var(--oscw-text, #e6edf3); flex: 1;
  display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
}
.oscw-label .oscw-value { color: var(--oscw-muted, #8b949e); font-variant-numeric: tabular-nums; }
.oscw-hint { font-size: 11px; color: var(--oscw-muted, #8b949e); line-height: 1.35; }
.oscw-form input[type="number"],
.oscw-form input[type="text"],
.oscw-form select,
.oscw-form textarea {
  background: var(--oscw-surface, #161b22); border: 1px solid var(--oscw-border, #30363d);
  border-radius: 6px; color: var(--oscw-text, #e6edf3); padding: 6px 8px;
  font-size: 13px; font-family: inherit; width: 100%;
}
.oscw-form textarea { font-family: var(--oscw-mono, ui-monospace, monospace); resize: vertical; min-height: 4.5em; }
.oscw-form input[type="range"] { flex: 1; accent-color: var(--oscw-accent, #58a6ff); }
.oscw-form input:focus, .oscw-form select:focus { outline: none; border-color: var(--oscw-accent, #58a6ff); }
.oscw-checkbox-row { display: flex; align-items: center; gap: 8px; }
.oscw-checkbox-row input { accent-color: var(--oscw-accent, #58a6ff); }
.oscw-vector-row { display: flex; gap: 6px; }
.oscw-vector-row input { width: 0; flex: 1; }
`;

function ensureStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = DEFAULT_CSS;
  document.head.appendChild(style);
}

function labelText(name: string): string {
  return name.replace(/^\$/, '').replace(/_/g, ' ');
}

function coerceForType(type: ParamType, raw: unknown): ParamValue {
  switch (type) {
    case 'boolean':
      return !!raw;
    case 'number':
      return typeof raw === 'number' ? raw : parseFloat(String(raw));
    case 'vector':
      return Array.isArray(raw) ? raw.map(Number) : (raw as ParamValue);
    case 'dropdown':
      return raw as ParamValue;
    default:
      return String(raw);
  }
}

export interface FormBuilderOptions {
  onChange?: (values: ParamValues) => void;
  storageKey?: string;
}

export interface FormHandle {
  getValues(): ParamValues;
  setValues(partial: Partial<ParamValues>): void;
}

export function buildForm(
  container: HTMLElement,
  schema: CustomizerSchema,
  opts: FormBuilderOptions = {},
): FormHandle {
  ensureStyles();
  container.innerHTML = '';
  container.classList.add('oscw-form');

  const values: ParamValues = {};
  for (const p of schema.params) values[p.name] = p.default;

  if (opts.storageKey) {
    try {
      const saved = JSON.parse(localStorage.getItem(opts.storageKey) ?? '{}');
      for (const p of schema.params) {
        // Hidden params always keep their .scad literal default, even across
        // a saved preset — matches real Customizer ("[Hidden] variables are
        // not retrieved from the JSON file").
        if (p.hidden) continue;
        if (saved[p.name] !== undefined) values[p.name] = coerceForType(p.type, saved[p.name]);
      }
    } catch {
      // ignore malformed persisted state
    }
  }

  function persist(): void {
    if (!opts.storageKey) return;
    try {
      localStorage.setItem(opts.storageKey!, JSON.stringify(values));
    } catch {
      // storage full/unavailable — form still works, just won't persist
    }
  }

  function emitChange(): void {
    persist();
    opts.onChange?.({ ...values });
  }

  function renderField(param: CustomizerParam): HTMLElement {
    const field = document.createElement('div');
    field.className = 'oscw-field';

    if (param.type === 'boolean') {
      const row = document.createElement('label');
      row.className = 'oscw-checkbox-row';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !!values[param.name];
      input.addEventListener('change', () => {
        values[param.name] = input.checked;
        emitChange();
      });
      const span = document.createElement('span');
      span.className = 'oscw-label';
      span.textContent = labelText(param.name);
      row.append(input, span);
      field.appendChild(row);
    } else if (param.type === 'dropdown') {
      const label = document.createElement('label');
      label.className = 'oscw-label';
      label.textContent = labelText(param.name);
      const select = document.createElement('select');
      for (const opt of param.options ?? []) {
        const optionEl = document.createElement('option');
        optionEl.value = String(opt.value);
        optionEl.textContent = opt.label;
        if (opt.value === values[param.name]) optionEl.selected = true;
        select.appendChild(optionEl);
      }
      select.addEventListener('change', () => {
        const match = (param.options ?? []).find((o) => String(o.value) === select.value);
        values[param.name] = match ? match.value : select.value;
        emitChange();
      });
      field.append(label, select);
    } else if (param.type === 'number' && param.min !== undefined) {
      const label = document.createElement('label');
      label.className = 'oscw-label';
      const valueSpan = document.createElement('span');
      valueSpan.className = 'oscw-value';
      valueSpan.textContent = String(values[param.name]);
      label.append(labelText(param.name), valueSpan);

      const row = document.createElement('div');
      row.className = 'oscw-field-row';
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(param.min);
      input.max = String(param.max);
      input.step = String(param.step ?? 1);
      input.value = String(values[param.name]);
      input.addEventListener('input', () => {
        values[param.name] = parseFloat(input.value);
        valueSpan.textContent = input.value;
        emitChange();
      });
      row.appendChild(input);
      field.append(label, row);
    } else if (param.type === 'number') {
      const label = document.createElement('label');
      label.className = 'oscw-label';
      label.textContent = labelText(param.name);
      const input = document.createElement('input');
      input.type = 'number';
      if (param.step !== undefined) input.step = String(param.step);
      input.value = String(values[param.name]);
      input.addEventListener('input', () => {
        values[param.name] = parseFloat(input.value) || 0;
        emitChange();
      });
      field.append(label, input);
    } else if (param.type === 'vector') {
      const label = document.createElement('label');
      label.className = 'oscw-label';
      label.textContent = labelText(param.name);
      const row = document.createElement('div');
      row.className = 'oscw-vector-row';
      const current = (values[param.name] as Array<number | string>).slice();
      current.forEach((component, idx) => {
        const input = document.createElement('input');
        input.type = 'number';
        input.value = String(component);
        if (param.min !== undefined) { input.min = String(param.min); input.max = String(param.max); }
        if (param.step !== undefined) input.step = String(param.step);
        input.addEventListener('input', () => {
          const vec = (values[param.name] as Array<number | string>).slice();
          vec[idx] = parseFloat(input.value) || 0;
          values[param.name] = vec;
          emitChange();
        });
        row.appendChild(input);
      });
      field.append(label, row);
    } else if (param.widget === 'textarea') {
      const label = document.createElement('label');
      label.className = 'oscw-label';
      label.textContent = labelText(param.name);
      const textarea = document.createElement('textarea');
      textarea.rows = 8;
      textarea.value = String(values[param.name]);
      textarea.addEventListener('input', () => {
        values[param.name] = textarea.value;
        emitChange();
      });
      field.append(label, textarea);
    } else {
      const label = document.createElement('label');
      label.className = 'oscw-label';
      label.textContent = labelText(param.name);
      const input = document.createElement('input');
      input.type = 'text';
      if (param.maxLength !== undefined) input.maxLength = param.maxLength;
      input.value = String(values[param.name]);
      input.addEventListener('input', () => {
        values[param.name] = input.value;
        emitChange();
      });
      field.append(label, input);
    }

    if (param.description) {
      const hint = document.createElement('div');
      hint.className = 'oscw-hint';
      hint.textContent = param.description;
      field.appendChild(hint);
    }
    return field;
  }

  function render(): void {
    container.innerHTML = '';
    for (const group of schema.groups) {
      if (group.hidden) continue;
      const visibleParams = group.params;
      if (visibleParams.length === 0) continue;

      const groupEl = document.createElement('div');
      groupEl.className = 'oscw-group';
      if (group.name) {
        const title = document.createElement('div');
        title.className = 'oscw-group-title';
        title.textContent = group.name;
        groupEl.appendChild(title);
      }
      for (const param of visibleParams) groupEl.appendChild(renderField(param));
      container.appendChild(groupEl);
    }
  }

  render();

  return {
    getValues: () => ({ ...values }),
    setValues(partial: Partial<ParamValues>) {
      Object.assign(values, partial);
      render();
    },
  };
}
