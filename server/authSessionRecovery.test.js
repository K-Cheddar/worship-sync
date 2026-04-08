import test from "node:test";
import assert from "node:assert/strict";
import { isRecoverableInvalidHumanSessionError } from "./authSessionRecovery.js";

test("treats invalid human-session auth contract errors as recoverable", () => {
  assert.equal(
    isRecoverableInvalidHumanSessionError({ statusCode: 401 }),
    true,
  );
  assert.equal(
    isRecoverableInvalidHumanSessionError({ statusCode: 403 }),
    true,
  );
  assert.equal(
    isRecoverableInvalidHumanSessionError({ statusCode: 404 }),
    true,
  );
});

test("keeps server faults non-recoverable", () => {
  assert.equal(
    isRecoverableInvalidHumanSessionError({ statusCode: 500 }),
    false,
  );
  assert.equal(
    isRecoverableInvalidHumanSessionError(new Error("boom")),
    false,
  );
  assert.equal(isRecoverableInvalidHumanSessionError(null), false);
});
