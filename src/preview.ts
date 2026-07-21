// Public orchestrator: wires the customizer parser, auto-generated form,
// Three.js viewer, and render worker together. This is the class most
// projects only ever touch — point it at a .scad file with Customizer
// annotations and a few DOM elements, and it does the rest.
import { parseCustomizer, type CustomizerSchema } from './customizer-parser.js';
import { buildForm, type FormHandle } from './form-builder.js';
import { Viewer } from './viewer.js';
import { offToTrianglePositions } from './off-utils.js';
import { downloadStl } from './export-stl.js';
import type { ParamValues } from './scad-params.js';
import type { RenderedPart, RenderRequest, TextGlyphsConfig, WorkerMessage } from './protocol.js';

export interface OpenScadPreviewOptions {
  canvas: HTMLCanvasElement;
  /** URL of the .scad entry file (also fetched on the main thread to build the form). */
  scadUrl: string;
  /** URL of the render worker (this package's src/worker.js, or a project-custom one). */
  workerUrl: string | URL;
  /** Container the auto-generated form is rendered into. */
  controlsEl?: HTMLElement;
  /** Text node updated with render status ("Rendering…", "Ready", errors). */
  statusEl?: HTMLElement;
  /** Wired to trigger an STL download of the current render. */
  downloadBtn?: HTMLButtonElement;
  /** localStorage key for persisting form values across reloads. */
  storageKey?: string;
  /** Square build-plate grid/outline size in mm. */
  bedSize?: number;
  backgroundColor?: number;
  /** Virtual FS path for the entry file inside the worker (default: derived from scadUrl). */
  entryFsPath?: string;
  /** Extra `use </include <` dependencies to fetch and write into the worker's FS. */
  files?: Array<{ url: string; fsPath: string }>;
  /** Override the openscad-wasm CDN URL (defaults to a pinned version). */
  wasmUrl?: string;
  textGlyphs?: (values: ParamValues) => TextGlyphsConfig | undefined;
  timeoutSec?: number;
  debounceMs?: number;
  downloadName?: (values: ParamValues) => string;
  /** Fully override the default STL download behavior. */
  onDownload?: (parts: RenderedPart[], values: ParamValues) => void;
  /** Receives worker debug/log lines. */
  onLog?: (text: string) => void;
  loadingText?: string;
  renderingText?: string;
  readyText?: string;
}

export class OpenScadPreview {
  private opts: OpenScadPreviewOptions;
  private viewer: Viewer;
  private worker: Worker;
  private rendering = false;
  private pendingRender = false;
  private renderTimer: ReturnType<typeof setTimeout> | null = null;
  private lastParts: RenderedPart[] | null = null;
  private form: FormHandle | null = null;
  private schema: CustomizerSchema | null = null;

  constructor(opts: OpenScadPreviewOptions) {
    this.opts = opts;

    this.viewer = new Viewer({
      canvas: opts.canvas,
      bedSize: opts.bedSize,
      backgroundColor: opts.backgroundColor,
    });

    this.worker = new Worker(opts.workerUrl, { type: 'module' });
    this.worker.onerror = (e) => {
      opts.onLog?.('WORKER ERROR: ' + (e.message || JSON.stringify(e)));
      this.setStatus('Worker error — see console/debug log', 'error');
    };
    this.worker.onmessage = ({ data }: MessageEvent<WorkerMessage>) => this.onWorkerMessage(data);

    if (opts.downloadBtn) {
      opts.downloadBtn.disabled = true;
      opts.downloadBtn.addEventListener('click', () => this.download());
    }

    this.setStatus(opts.loadingText ?? 'Loading OpenSCAD WASM (~14 MB, cached after first visit)…', 'busy');
    void this.init();
  }

  private async init(): Promise<void> {
    const res = await fetch(this.opts.scadUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${this.opts.scadUrl}`);
    const source = await res.text();
    this.schema = parseCustomizer(source);

    if (this.opts.controlsEl) {
      this.form = buildForm(this.opts.controlsEl, this.schema, {
        storageKey: this.opts.storageKey,
        onChange: () => this.scheduleRender(),
      });
    }

    this.triggerRender();
  }

  private setStatus(text: string, cls = ''): void {
    const el = this.opts.statusEl;
    if (!el) return;
    el.textContent = text;
    el.className = cls;
  }

  private onWorkerMessage(data: WorkerMessage): void {
    if (data.type === 'result') {
      this.lastParts = data.parts;
      if (this.opts.downloadBtn) this.opts.downloadBtn.disabled = data.parts.length === 0;
      this.viewer.loadParts(data.parts);
      this.setStatus(this.opts.readyText ?? 'Ready — drag to rotate, scroll to zoom', 'ok');
      this.finishRender();
    } else if (data.type === 'error') {
      this.opts.onLog?.('[error] ' + data.message);
      this.setStatus('Error: ' + data.message, 'error');
      this.finishRender();
    } else if (data.type === 'log') {
      this.opts.onLog?.(data.text);
    }
  }

  private finishRender(): void {
    this.rendering = false;
    if (this.pendingRender) {
      this.pendingRender = false;
      // Re-enter the debounce window rather than firing immediately: if the
      // user is still actively changing values right as the in-flight
      // render completes, this lets further changes keep coalescing into
      // one render instead of chaining an immediate re-render per change.
      this.scheduleRender();
    }
  }

  triggerRender(): void {
    if (!this.schema) return; // form/source not loaded yet — init() will call this once ready
    if (this.rendering) {
      this.pendingRender = true;
      return;
    }
    this.rendering = true;
    this.setStatus(this.opts.renderingText ?? 'Rendering…', 'busy');

    const values = this.form ? this.form.getValues() : this.schema.defaults;
    // Resolve to absolute URLs before handing off to the worker: a relative
    // URL sent as-is would be re-resolved by fetch() *inside the worker's
    // own script context* (e.g. against dist/worker.js's location), not
    // against this page — silently fetching the wrong file.
    const request: RenderRequest = {
      type: 'render',
      entryUrl: new URL(this.opts.scadUrl, document.baseURI).href,
      entryFsPath: this.opts.entryFsPath,
      files: this.opts.files?.map((f) => ({ ...f, url: new URL(f.url, document.baseURI).href })),
      values,
      wasmUrl: this.opts.wasmUrl,
      textGlyphs: this.opts.textGlyphs?.(values),
      timeoutSec: this.opts.timeoutSec,
    };
    this.worker.postMessage(request);
  }

  scheduleRender(): void {
    if (this.renderTimer) clearTimeout(this.renderTimer);
    this.renderTimer = setTimeout(() => this.triggerRender(), this.opts.debounceMs ?? 400);
  }

  /** Programmatically change form values (e.g. a "reset to defaults" button) and re-render. */
  setValues(partial: Partial<ParamValues>): void {
    this.form?.setValues(partial);
    this.triggerRender();
  }

  download(): void {
    if (!this.lastParts || this.lastParts.length === 0) return;
    const values = this.form?.getValues() ?? {};
    if (this.opts.onDownload) {
      this.opts.onDownload(this.lastParts, values);
      return;
    }

    const base = this.opts.downloadName?.(values) ?? 'model';
    if (this.lastParts.length === 1) {
      const positions = offToTrianglePositions(this.lastParts[0].off);
      if (positions?.length) downloadStl(positions, `${base}.stl`);
      return;
    }

    // Multiple parts, no custom handler: one STL per part. Staggered —
    // firing several a.click() downloads in the same tick gets some
    // browsers to block all but the first as a "multiple downloads" popup.
    this.lastParts.forEach(({ off, color }, i) => {
      const positions = offToTrianglePositions(off);
      if (!positions?.length) return;
      const label = (color ?? `part${i}`).toLowerCase();
      setTimeout(() => downloadStl(positions, `${base}-${label}.stl`), i * 300);
    });
  }

  terminate(): void {
    if (this.renderTimer) clearTimeout(this.renderTimer);
    this.worker.terminate();
  }
}
