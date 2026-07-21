// Main-thread entry point. Import the worker (src/worker.js, or a project's
// own) via its URL directly — Workers aren't constructed through this barrel.
export { parseCustomizer } from './customizer-parser.js';
export type {
  CustomizerSchema,
  CustomizerGroup,
  CustomizerParam,
  CustomizerDefault,
  ParamType,
  ParamWidget,
  DropdownOption,
} from './customizer-parser.js';

export { buildForm } from './form-builder.js';
export type { FormBuilderOptions, FormHandle } from './form-builder.js';

export { applyParamOverrides } from './scad-params.js';
export type { ParamValue, ParamValues } from './scad-params.js';

export { Viewer } from './viewer.js';
export type { ViewerOptions } from './viewer.js';

export { OpenScadPreview } from './preview.js';
export type { OpenScadPreviewOptions } from './preview.js';

export { offToTrianglePositions, offToIndexedMesh } from './off-utils.js';
export type { IndexedMesh } from './off-utils.js';

export { trianglesToStl, downloadStl } from './export-stl.js';
export { buildMultiColor3mf, downloadMultiColor3mf } from './export-3mf.js';
export type { ColoredPart } from './export-3mf.js';

export { buildTextOverride } from './text-glyphs.js';
export type { TextGlyphOptions } from './text-glyphs.js';

export { loadOpenScadModule, runOpenScadPass, fetchText, makeLogger } from './worker-core.js';
export type { OpenScadModule, OpenScadInstance, WorkerFile, RunPassOptions } from './worker-core.js';

export type {
  RenderedPart,
  RenderRequest,
  TextGlyphsConfig,
  WorkerMessage,
  ResultMessage,
  ErrorMessage,
  LogMessage,
} from './protocol.js';
