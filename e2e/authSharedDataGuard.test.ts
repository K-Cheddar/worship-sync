import { test } from "node:test";
import assert from "node:assert/strict";
import { isObservedSharedDataSignIn, isTrustedFirebaseAuthOrigin } from "./authOrigins";
test("shared RTDB sign-in admits only the exact token observed from the trusted API", () => {
  const path = "/v1/accounts:signInWithCustomToken";
  assert.equal(isObservedSharedDataSignIn(path, { token: "observed" }, ["observed"]), true);
  for (const body of [null, {}, { token: "unknown" }]) assert.equal(isObservedSharedDataSignIn(path, body, ["observed"]), false);
  for (const endpoint of ["/v1/accounts:sendOobCode", "/v1/accounts:signInWithPassword", "/v1/accounts:signUp"]) assert.equal(isObservedSharedDataSignIn(endpoint, { token: "observed" }, ["observed"]), false);
});

test("Firebase auth actions require their exact HTTPS provider origin", () => {
  assert.equal(isTrustedFirebaseAuthOrigin("https://identitytoolkit.googleapis.com/v1/accounts:lookup", "identitytoolkit"), true);
  assert.equal(isTrustedFirebaseAuthOrigin("https://securetoken.googleapis.com/v1/token", "securetoken"), true);
  assert.equal(isTrustedFirebaseAuthOrigin("http://identitytoolkit.googleapis.com/v1/accounts:lookup", "identitytoolkit"), false);
  assert.equal(isTrustedFirebaseAuthOrigin("https://attacker.invalid/identitytoolkit.googleapis.com/v1/accounts:lookup", "identitytoolkit"), false);
  assert.equal(isTrustedFirebaseAuthOrigin("https://securetoken.googleapis.com.attacker.invalid/v1/token", "securetoken"), false);
});
