// Low-level primitives for running openscad-wasm inside a Worker. The
// default worker.ts in this package uses these directly for the common
// single-part case; a project with unusual rendering needs (multi-part
// color separation, multiple boolean passes, ...) can write a small custom
// worker against these same primitives instead of reimplementing the WASM
// lifecycle from scratch.

const DEFAULT_WASM_URL = 'https://cdn.jsdelivr.net/npm/openscad-wasm@0.0.4/openscad.js';

// Minimal shape of the openscad-wasm module/instance we rely on — the real
// package ships no types, so this pins down just what this file touches.
export interface OpenScadFS {
  mkdir(path: string): void;
  writeFile(path: string, data: string): void;
  readFile(path: string, opts: { encoding: 'utf8' }): string;
}
export interface OpenScadInstance {
  FS: OpenScadFS;
  callMain(args: string[]): number;
}
export interface OpenScadModule {
  createOpenSCAD(opts: {
    noInitialRun: boolean;
    print: (text: string) => void;
    printErr: (text: string) => void;
  }): Promise<{ getInstance(): Promise<OpenScadInstance> }>;
}

const moduleCache = new Map<string, Promise<OpenScadModule>>();

/** Loads (and caches) the openscad-wasm ES module from a CDN URL. */
export function loadOpenScadModule(wasmUrl: string = DEFAULT_WASM_URL): Promise<OpenScadModule> {
  if (!moduleCache.has(wasmUrl)) {
    moduleCache.set(wasmUrl, import(/* webpackIgnore: true */ wasmUrl) as Promise<OpenScadModule>);
  }
  return moduleCache.get(wasmUrl)!;
}

function mkdirp(wasm: OpenScadInstance, path: string): void {
  const parts = path.split('/').filter(Boolean);
  let cur = '';
  for (const part of parts) {
    cur += '/' + part;
    try { wasm.FS.mkdir(cur); } catch { /* already exists */ }
  }
}

export interface WorkerFile {
  fsPath: string;
  text: string;
}

export interface RunPassOptions {
  onLog?: (text: string) => void;
  args?: string[];
  outFile?: string;
}

/**
 * Runs one OpenSCAD render pass in a fresh WASM instance. Each pass needs
 * its own instance — openscad-wasm@0.0.4's Emscripten runtime exits after
 * the first callMain(), so a second callMain() on a reused instance throws.
 *
 * @param mod openscad-wasm module, from loadOpenScadModule().
 * @param files Written into the WASM virtual FS before running (parent
 *   directories created as needed).
 * @param entryFsPath Which written file to render.
 * @returns OFF text, or null if the pass produced no geometry, or failed.
 */
export async function runOpenScadPass(
  mod: OpenScadModule,
  files: WorkerFile[],
  entryFsPath: string,
  opts: RunPassOptions = {},
): Promise<string | null> {
  const onLog = opts.onLog ?? (() => {});
  let inst: OpenScadInstance;
  try {
    const wrapper = await mod.createOpenSCAD({
      noInitialRun: true,
      print: onLog,
      printErr: onLog,
    });
    inst = await wrapper.getInstance();
  } catch (e) {
    onLog(`WASM init failed: ${(e as Error).message || e}`);
    return null;
  }

  for (const f of files) {
    const dir = f.fsPath.split('/').slice(0, -1).join('/');
    if (dir) mkdirp(inst, dir);
    inst.FS.writeFile(f.fsPath, f.text);
  }

  const outFile = opts.outFile ?? '/out.off';
  const exit = inst.callMain([entryFsPath, '-o', outFile, ...(opts.args ?? [])]);
  if (exit !== 0) {
    onLog(`OpenSCAD exited with code ${exit}`);
    return null;
  }
  try {
    const off = inst.FS.readFile(outFile, { encoding: 'utf8' });
    const nv = parseInt(off.split('\n')[0].split(/\s+/)[1] ?? '0', 10);
    return nv > 0 ? off : null;
  } catch {
    return null;
  }
}

/**
 * Forces a `.scad` file's default trailing call (matched by
 * `defaultCallPattern`, a regex source) to a different module invocation —
 * the one piece of project-specific logic multi-part/multi-color rendering
 * needs, generalized so it's data a project passes in rather than a custom
 * worker it writes. No match is a no-op (returns entryText unchanged).
 */
export function forceCall(entryText: string, defaultCallPattern: string, call: string): string {
  return entryText.replace(new RegExp(defaultCallPattern), `\n${call}\n`);
}

export async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.text();
}

/** A `[+12.3s] message` logger tied to a Worker's postMessage. */
export function makeLogger(postMessage: (msg: { type: 'log'; text: string }) => void) {
  const t0 = performance.now();
  return (text: string): void => {
    const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
    postMessage({ type: 'log', text: `[+${elapsed}s] ${text}` });
  };
}
