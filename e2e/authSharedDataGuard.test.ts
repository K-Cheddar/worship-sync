import { test } from "node:test";
import assert from "node:assert/strict";
import { isObservedSharedDataSignIn } from "./authOrigins";
test("shared RTDB sign-in admits only the exact token observed from the trusted API", () => {
  const path = "/v1/accounts:signInWithCustomToken";
  assert.equal(isObservedSharedDataSignIn(path, { token: "observed" }, ["observed"]), true);
  for (const body of [null, {}, { token: "unknown" }]) assert.equal(isObservedSharedDataSignIn(path, body, ["observed"]), false);
  for (const endpoint of ["/v1/accounts:sendOobCode", "/v1/accounts:signInWithPassword", "/v1/accounts:signUp"]) assert.equal(isObservedSharedDataSignIn(endpoint, { token: "observed" }, ["observed"]), false);
});
