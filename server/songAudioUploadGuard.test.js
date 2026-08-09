import assert from "node:assert/strict";
import test from "node:test";

import { createSongAudioUploadGuard } from "./songAudioUploadGuard.js";

const runGuard = (guard, { userId = "user-1", sizeBytes = 10 } = {}) => {
  const response = { headers: {}, statusCode: 200, body: null };
  const req = {
    appSession: { churchId: "church-1", userId },
    params: { churchId: "church-1" },
    body: { sizeBytes },
    get: () => undefined,
  };
  const res = {
    set: (name, value) => {
      response.headers[name] = value;
    },
    status: (statusCode) => {
      response.statusCode = statusCode;
      return res;
    },
    json: (body) => {
      response.body = body;
      return res;
    },
  };
  let nextCalled = false;
  guard(req, res, () => {
    nextCalled = true;
  });
  return { ...response, nextCalled };
};

const runGuardBeforeBodyParsing = (guard, { contentLength, userId = "user-1" }) => {
  const response = { headers: {}, statusCode: 200, body: null };
  const req = {
    appSession: { churchId: "church-1", userId },
    params: { churchId: "church-1" },
    get: (name) =>
      name.toLowerCase() === "content-length" ? String(contentLength) : undefined,
  };
  const res = {
    set: (name, value) => {
      response.headers[name] = value;
    },
    status: (statusCode) => {
      response.statusCode = statusCode;
      return res;
    },
    json: (body) => {
      response.body = body;
      return res;
    },
  };
  let nextCalled = false;
  guard(req, res, () => {
    nextCalled = true;
  });
  return { ...response, nextCalled };
};

test("song audio upload guard limits attempts per member", () => {
  let currentTime = 1_000;
  const guard = createSongAudioUploadGuard({
    env: {
      SONG_AUDIO_UPLOADS_PER_HOUR: "2",
      SONG_AUDIO_UPLOAD_BYTES_PER_DAY: "1000",
    },
    now: () => currentTime,
  });

  assert.equal(runGuard(guard).nextCalled, true);
  assert.equal(runGuard(guard).nextCalled, true);
  const limited = runGuard(guard);
  assert.equal(limited.statusCode, 429);
  assert.match(limited.body.error, /too many MP3 uploads/i);
  assert.ok(Number(limited.headers["Retry-After"]) > 0);

  currentTime += 60 * 60 * 1000;
  assert.equal(runGuard(guard).nextCalled, true);
});

test("song audio upload guard limits requested bytes per church", () => {
  const guard = createSongAudioUploadGuard({
    env: {
      SONG_AUDIO_UPLOADS_PER_HOUR: "10",
      SONG_AUDIO_UPLOAD_BYTES_PER_DAY: "100",
    },
    now: () => 1_000,
  });

  assert.equal(runGuard(guard, { userId: "user-1", sizeBytes: 60 }).nextCalled, true);
  const limited = runGuard(guard, { userId: "user-2", sizeBytes: 50 });
  assert.equal(limited.statusCode, 429);
  assert.match(limited.body.error, /daily MP3 upload limit/i);
});

test("song audio upload guard rejects Content-Length before the body is parsed", () => {
  const guard = createSongAudioUploadGuard({
    env: {
      SONG_AUDIO_UPLOADS_PER_HOUR: "10",
      SONG_AUDIO_UPLOAD_BYTES_PER_DAY: "100",
    },
    now: () => 1_000,
  });

  const limited = runGuardBeforeBodyParsing(guard, { contentLength: 101 });
  assert.equal(limited.nextCalled, false);
  assert.equal(limited.statusCode, 429);
  assert.match(limited.body.error, /daily MP3 upload limit/i);
});
