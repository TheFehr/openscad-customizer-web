// Default, generic render worker — handles the common case (one .scad entry
// file, optionally a few `use </include <` dependencies, single uncolored
// output part) with zero project-specific code. Point OpenScadPreview at
// this file directly; write a custom worker only if you need multi-part
// color separation or other unusual rendering (see worker-core.ts).
import { loadOpenScadModule, runOpenScadPass, forceCall, fetchText, makeLogger } from './worker-core.js';
import { parseCustomizer, type CustomizerSchema } from './customizer-parser.js';
import { applyParamOverrides } from './scad-params.js';
import type { RenderRequest, RenderedPart, WorkerMessage } from './protocol.js';

declare const self: DedicatedWorkerGlobalScope;

self.postMessage({ type: 'log', text: '[worker] script start' } satisfies WorkerMessage);

interface Sources {
  entryFsPath: string;
  entryText: string;
  extra: Array<{ fsPath: string; text: string }>;
  schema: CustomizerSchema;
}

let cachedSources: Sources | null = null;

async function loadSources(config: RenderRequest): Promise<Sources> {
  if (cachedSources) return cachedSources;
  const entryText = await fetchText(config.entryUrl);
  const extra: Array<{ fsPath: string; text: string }> = [];
  for (const f of config.files ?? []) {
    extra.push({ fsPath: f.fsPath, text: await fetchText(f.url) });
  }
  const schema = parseCustomizer(entryText);
  cachedSources = {
    entryFsPath: config.entryFsPath ?? '/' + config.entryUrl.split('/').pop(),
    entryText,
    extra,
    schema,
  };
  return cachedSources;
}

self.onmessage = async ({ data }: MessageEvent<RenderRequest>) => {
  if (data.type !== 'render') return;

  const log = makeLogger((msg) => self.postMessage(msg));
  const timeoutSec = data.timeoutSec ?? 90;
  const timeout = setTimeout(() => {
    self.postMessage({ type: 'error', message: `Render timed out after ${timeoutSec}s` } satisfies WorkerMessage);
  }, timeoutSec * 1000);

  try {
    log('fetching source(s) & OpenSCAD WASM module…');
    const [mod, sources] = await Promise.all([
      loadOpenScadModule(data.wasmUrl),
      loadSources(data),
    ]);

    let entryText = sources.entryText;
    let extraFiles = sources.extra;

    if (data.textGlyphs?.enabled) {
      log('rendering text glyphs…');
      const { buildTextOverride } = await import('./text-glyphs.js');
      const override = await buildTextOverride(
        data.textGlyphs.strings ?? [],
        data.textGlyphs.fontSize ?? 10,
        data.textGlyphs,
      );
      const targetFsPath = data.textGlyphs.targetFsPath ?? sources.entryFsPath;
      if (targetFsPath === sources.entryFsPath) {
        entryText = `${override}\n\n${entryText}`;
      } else {
        extraFiles = extraFiles.map((f) =>
          f.fsPath === targetFsPath ? { ...f, text: `${override}\n\n${f.text}` } : f,
        );
      }
    }

    entryText = applyParamOverrides(entryText, sources.schema.params, data.values ?? {});

    let parts: RenderedPart[];
    if (data.multiPass) {
      const { defaultCallPattern, passes } = data.multiPass;
      parts = [];
      for (let i = 0; i < passes.length; i++) {
        const { call, color } = passes[i];
        log(`invoking callMain for pass ${i + 1}/${passes.length} (${call})…`);
        const src = forceCall(entryText, defaultCallPattern, call);
        const files = [...extraFiles, { fsPath: sources.entryFsPath, text: src }];
        const off = await runOpenScadPass(mod, files, sources.entryFsPath, {
          onLog: log,
          outFile: `/out_${i}.off`,
        });
        if (off) parts.push({ off, color });
      }
    } else {
      log('invoking callMain (blocks this thread until done)…');
      const files = [...extraFiles, { fsPath: sources.entryFsPath, text: entryText }];
      const off = await runOpenScadPass(mod, files, sources.entryFsPath, { onLog: log });
      parts = off ? [{ off, color: null }] : [];
    }

    clearTimeout(timeout);
    log(`done — ${parts.length} part(s) with geometry`);
    self.postMessage({ type: 'result', parts, values: data.values } satisfies WorkerMessage);
  } catch (err) {
    clearTimeout(timeout);
    self.postMessage({
      type: 'error',
      message: String((err as Error)?.message ?? err ?? 'unknown'),
    } satisfies WorkerMessage);
  }
};
