import assert from "node:assert/strict";
import test from "node:test";
import {
  createChatImageFinalizeGuard,
  chatImageUploadGuardDefaults,
  createChatImageUploadGuard,
} from "./chatImageUploadGuard.js";

const request = (overrides = {}) => ({
  appSession: { churchId: "church_1", actorId: "actor_1" },
  params: { churchId: "church_1" },
  body: { sizeBytes: 1024 },
  get: () => undefined,
  ...overrides,
});

const response = () => ({
  statusCode: 200,
  payload: null,
  headers: {},
  set(name, value) {
    this.headers[name] = value;
    return this;
  },
  status(value) {
    this.statusCode = value;
    return this;
  },
  json(value) {
    this.payload = value;
    return this;
  },
});

test("limits chat image uploads per actor", () => {
  const guard = createChatImageUploadGuard();
  for (let index = 0; index < chatImageUploadGuardDefaults.uploadsPerHour; index += 1) {
    guard(request(), response(), () => {});
  }
  const res = response();
  guard(request(), res, () => assert.fail("rate-limited upload continued"));
  assert.equal(res.statusCode, 429);
  assert.match(res.payload.error, /too many photo uploads/i);
});

test("limits total requested chat image bytes per church", () => {
  const guard = createChatImageUploadGuard({
    env: {
      CHAT_IMAGE_UPLOADS_PER_HOUR: "100",
      CHAT_IMAGE_UPLOAD_BYTES_PER_DAY: "1000",
    },
  });
  guard(request({ body: { sizeBytes: 700 } }), response(), () => {});
  const res = response();
  guard(
    request({ body: { sizeBytes: 400 } }),
    res,
    () => assert.fail("over-quota upload continued"),
  );
  assert.equal(res.statusCode, 429);
  assert.match(res.payload.error, /daily photo upload limit/i);
});

test("charges the maximum object size when proxy Content-Length is missing", () => {
  const guard = createChatImageUploadGuard({
    env: {
      CHAT_IMAGE_UPLOADS_PER_HOUR: "100",
      CHAT_IMAGE_UPLOAD_BYTES_PER_DAY: "1000",
      CHAT_IMAGE_MAX_BYTES: "600",
    },
  });
  const chunkedRequest = () =>
    request({
      body: Buffer.from("image bytes"),
      get: () => undefined,
    });

  guard(chunkedRequest(), response(), () => {});
  const res = response();
  guard(
    chunkedRequest(),
    res,
    () => assert.fail("unknown-length over-quota upload continued"),
  );

  assert.equal(res.statusCode, 429);
  assert.match(res.payload.error, /daily photo upload limit/i);
});

test("allows only one in-flight finalization for the same pending photo", () => {
  const guard = createChatImageFinalizeGuard();
  const listeners = new Map();
  const firstResponse = {
    ...response(),
    locals: {},
    once(event, listener) {
      listeners.set(event, listener);
      return this;
    },
  };
  const finalizeRequest = () =>
    request({
      body: { imageUpload: { id: "upload_123" } },
    });

  let continued = 0;
  guard(finalizeRequest(), firstResponse, () => {
    continued += 1;
  });
  const blockedResponse = {
    ...response(),
    once() {
      return this;
    },
  };
  guard(finalizeRequest(), blockedResponse, () => {
    continued += 1;
  });

  assert.equal(continued, 1);
  assert.equal(blockedResponse.statusCode, 409);
  assert.match(blockedResponse.payload.error, /already being processed/i);

  firstResponse.locals.releaseChatImageFinalize();
  const retryResponse = {
    ...response(),
    once() {
      return this;
    },
  };
  guard(finalizeRequest(), retryResponse, () => {
    continued += 1;
  });
  assert.equal(continued, 2);
});

test("does not lock text-only messages", () => {
  const guard = createChatImageFinalizeGuard();
  let continued = 0;
  guard(request({ body: { text: "Ready" } }), response(), () => {
    continued += 1;
  });
  guard(request({ body: { text: "Still ready" } }), response(), () => {
    continued += 1;
  });
  assert.equal(continued, 2);
});
