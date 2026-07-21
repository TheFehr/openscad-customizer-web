// Message shapes shared between the main thread (preview.ts) and a render
// worker (worker.ts, or a project's own custom one). Deliberately
// environment-agnostic (no DOM/WebWorker-only globals) so it compiles
// cleanly under both the main and worker tsconfigs.
import type { ParamValues } from './scad-params.js';

export interface RenderedPart {
  off: string;
  color?: string | null;
}

export interface TextGlyphsConfig {
  enabled: boolean;
  strings?: string[];
  fontSize?: number;
  fontUrl?: string;
  sizeFactor?: number;
  /** fsPath of the file that should receive the `module text(){}` override
   *  — defaults to the render's entry file. Needed when the file that
   *  actually calls text() is a `use`/`include` dependency, not the entry
   *  file itself. */
  targetFsPath?: string;
}

export interface MultiPassConfig {
  /** Regex *source* (not a RegExp — this crosses a postMessage boundary)
   *  matching the entry file's default trailing call, e.g.
   *  "\\nspell_tile\\(\\);\\s*$". */
  defaultCallPattern: string;
  passes: Array<{ call: string; color: string }>;
}

export interface RenderRequest {
  type: 'render';
  entryUrl: string;
  entryFsPath?: string;
  files?: Array<{ url: string; fsPath: string }>;
  values?: ParamValues;
  wasmUrl?: string;
  textGlyphs?: TextGlyphsConfig;
  multiPass?: MultiPassConfig;
  timeoutSec?: number;
}

export interface ResultMessage {
  type: 'result';
  parts: RenderedPart[];
  values?: ParamValues;
}
export interface ErrorMessage {
  type: 'error';
  message: string;
}
export interface LogMessage {
  type: 'log';
  text: string;
}
export type WorkerMessage = ResultMessage | ErrorMessage | LogMessage;
