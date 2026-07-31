/**
 * Runs in setupFiles (before test file imports). Firebase Auth's Node CJS entry
 * touches `fetch` at load time; jsdom + Jest 30 may not expose it on globalThis yet.
 * TextEncoder must exist before loading undici (undici's fetch stack uses it at require time).
 */
const { TextEncoder, TextDecoder } = require("util");
Object.assign(globalThis, { TextEncoder, TextDecoder });

const {
  ReadableStream,
  WritableStream,
  TransformStream,
} = require("stream/web");
Object.assign(globalThis, { ReadableStream, WritableStream, TransformStream });

const { fetch, Headers, Request, Response, FormData } = require("undici");
Object.assign(globalThis, { fetch, Headers, Request, Response, FormData });

// ProseMirror asks the browser for caret geometry during keyboard and pointer
// editing. jsdom has no layout engine, so provide inert geometry for editor
// interaction tests; assertions still validate the resulting document model.
const emptyRect = {
  bottom: 0,
  height: 0,
  left: 0,
  right: 0,
  top: 0,
  width: 0,
  x: 0,
  y: 0,
  toJSON: () => ({}),
};
if (typeof Range !== "undefined") {
  Range.prototype.getBoundingClientRect ??= () => emptyRect;
  Range.prototype.getClientRects ??= () => [];
}
if (typeof HTMLElement !== "undefined") {
  HTMLElement.prototype.getBoundingClientRect ??= () => emptyRect;
  HTMLElement.prototype.getClientRects ??= () => [];
}
if (typeof document !== "undefined") {
  document.elementFromPoint ??= () => document.body;
}
