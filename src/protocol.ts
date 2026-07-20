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
}

export interface RenderRequest {
  type: 'render';
  entryUrl: string;
  entryFsPath?: string;
  files?: Array<{ url: string; fsPath: string }>;
  values?: ParamValues;
  wasmUrl?: string;
  textGlyphs?: TextGlyphsConfig;
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
