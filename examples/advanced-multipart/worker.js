// Custom worker for a case the default dist/worker.js doesn't handle:
// multi-part, multi-color output. badge.scad has two modules — badge_base()
// and badge_inset() — that need separate render passes (openscad-wasm's OFF
// export doesn't carry color()), so this is written directly against
// worker-core.js's primitives instead of the generic single-part worker.
// See the "Multi-part / colored output" section of the package README.
import { loadOpenScadModule, runOpenScadPass, fetchText, makeLogger } from '../../dist/worker-core.js';
import { parseCustomizer } from '../../dist/customizer-parser.js';
import { applyParamOverrides } from '../../dist/scad-params.js';

self.postMessage({ type: 'log', text: '[worker] script start' });

let cachedSources = null; // { entryFsPath, entryText, schema }

async function loadSources(config) {
  if (cachedSources) return cachedSources;
  const entryText = await fetchText(config.entryUrl);
  const schema = parseCustomizer(entryText);
  cachedSources = {
    entryFsPath: config.entryFsPath ?? '/' + config.entryUrl.split('/').pop(),
    entryText,
    schema,
  };
  return cachedSources;
}

// Forces badge.scad's trailing `badge_base();` call to a different module
// invocation, so one pass renders only the base plate and another only the
// inset plug.
function forceCall(src, call) {
  return src.replace(/\nbadge_base\(\);\s*$/, `\n${call}\n`);
}

self.onmessage = async ({ data }) => {
  if (data.type !== 'render') return;

  const log = makeLogger((msg) => self.postMessage(msg));
  const timeoutSec = data.timeoutSec ?? 90;
  const timeout = setTimeout(() => {
    self.postMessage({ type: 'error', message: `Render timed out after ${timeoutSec}s` });
  }, timeoutSec * 1000);

  try {
    log('fetching source & OpenSCAD WASM module…');
    const [mod, sources] = await Promise.all([
      loadOpenScadModule(data.wasmUrl),
      loadSources(data),
    ]);

    const values = data.values ?? {};
    const overridden = applyParamOverrides(sources.entryText, sources.schema.params, values);

    log('rendering base pass…');
    const baseSrc = forceCall(overridden, 'badge_base();');
    const baseOff = await runOpenScadPass(
      mod,
      [{ fsPath: sources.entryFsPath, text: baseSrc }],
      sources.entryFsPath,
      { onLog: log, outFile: '/out_base.off' },
    );

    log('rendering inset pass…');
    const insetSrc = forceCall(overridden, 'badge_inset();');
    const insetOff = await runOpenScadPass(
      mod,
      [{ fsPath: sources.entryFsPath, text: insetSrc }],
      sources.entryFsPath,
      { onLog: log, outFile: '/out_inset.off' },
    );

    clearTimeout(timeout);
    const parts = [];
    if (baseOff) parts.push({ off: baseOff, color: values.base_color });
    if (insetOff) parts.push({ off: insetOff, color: values.inset_color });
    log(`done — ${parts.length} part(s) with geometry`);
    self.postMessage({ type: 'result', parts, values });
  } catch (err) {
    clearTimeout(timeout);
    self.postMessage({ type: 'error', message: String(err?.message ?? err ?? 'unknown') });
  }
};
