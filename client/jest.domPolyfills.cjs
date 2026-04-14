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
