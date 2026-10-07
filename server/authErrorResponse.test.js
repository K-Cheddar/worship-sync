import assert from "node:assert/strict";
import test from "node:test";
import { serializeAuthError } from "./authErrorResponse.js";

test("preserves sanitized messages and endpoint details while exposing only the CSRF recovery code", () => {
  const details = { errorMessage: "Could not update invite access. Try again in a moment.", existingInvite: { inviteId: "invite-1" } };
  assert.deepEqual(serializeAuthError({ code: "AUTH_CSRF_MISMATCH", message: "internal" }, details), {
    success: false, ...details, code: "AUTH_CSRF_MISMATCH",
  });
  assert.deepEqual(serializeAuthError({ code: "UNRELATED_ERROR", message: "internal" }, details), {
    success: false, ...details,
  });
});
