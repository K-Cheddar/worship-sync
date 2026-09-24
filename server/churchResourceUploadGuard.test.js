import assert from "node:assert/strict";
import test from "node:test";
import { createChurchResourceUploadGuard } from "./churchResourceUploadGuard.js";

const run = (guard, { body, contentLength, userId = "user-1" } = {}) => {
  const response = { headers: {}, statusCode: 200, body: null };
  const req = {
    appSession: { churchId: "church-1", userId },
    params: { churchId: "church-1" },
    body,
    get: (name) => (name.toLowerCase() === "content-length" ? contentLength : undefined),
  };
  const res = {
    set: (name, value) => { response.headers[name] = value; },
    status: (code) => { response.statusCode = code; return res; },
    json: (value) => { response.body = value; return res; },
  };
  let nextCalled = false;
  guard(req, res, () => { nextCalled = true; });
  return { ...response, nextCalled };
};

test("ChurchResource guard applies the same attempt quota to upload paths", () => {
  const guard = createChurchResourceUploadGuard({
    env: { CHURCH_RESOURCE_UPLOADS_PER_HOUR: "1", CHURCH_RESOURCE_UPLOAD_BYTES_PER_DAY: "1000" },
    now: () => 1_000,
  });
  assert.equal(run(guard, { body: { sizeBytes: 10 } }).nextCalled, true);
  const limited = run(guard, { body: { sizeBytes: 10 } });
  assert.equal(limited.statusCode, 429);
  assert.match(limited.body.error, /church resource uploads/i);
  assert.ok(Number(limited.headers["Retry-After"]) > 0);
});

test("ChurchResource guard enforces fallback Content-Length before body parsing", () => {
  const guard = createChurchResourceUploadGuard({
    env: { CHURCH_RESOURCE_UPLOADS_PER_HOUR: "10", CHURCH_RESOURCE_UPLOAD_BYTES_PER_DAY: "100" },
    now: () => 1_000,
  });
  const limited = run(guard, { contentLength: "101" });
  assert.equal(limited.nextCalled, false);
  assert.equal(limited.statusCode, 429);
  assert.match(limited.body.error, /daily resource upload limit/i);
});
