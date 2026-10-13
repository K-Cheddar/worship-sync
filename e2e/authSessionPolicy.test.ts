import assert from "node:assert/strict";
import test from "node:test";
import { requireReusableSavedSession, type SessionCheck } from "./auth";

const captureConsoleError = async (run: () => void) => {
  const messages: string[] = [];
  const originalError = console.error;
  console.error = (message?: unknown) => messages.push(String(message));
  try {
    run();
  } finally {
    console.error = originalError;
  }
  return messages;
};

test("a rejected saved session reports its sanitized reason and explicit refresh command", async () => {
  const mockedValidation = async (): Promise<SessionCheck> => ({
    status: "invalid",
    reason: "The saved WorshipSync server session cookie has expired.",
  });
  const result = await mockedValidation();
  const messages = await captureConsoleError(() => {
    assert.throws(
      () => requireReusableSavedSession(result),
      /Saved session cannot be reused: The saved WorshipSync server session cookie has expired\. No sign-in was attempted\. To explicitly refresh authentication with one attempt, run npm run test:e2e:auth:refresh\./,
    );
  });

  assert.deepEqual(messages, [
    "Saved session cannot be reused: The saved WorshipSync server session cookie has expired. No sign-in was attempted. To explicitly refresh authentication with one attempt, run npm run test:e2e:auth:refresh.",
  ]);
});

test("an infrastructure failure stops with its reason and without attempting sign-in", async () => {
  const mockedValidation = async (): Promise<SessionCheck> => ({
    status: "infrastructure-error",
    reason: "Could not reach E2E_BASE_URL while checking the saved session.",
  });
  const result = await mockedValidation();
  const messages = await captureConsoleError(() => {
    assert.throws(
      () => requireReusableSavedSession(result),
      /Saved session validation could not complete: Could not reach E2E_BASE_URL while checking the saved session\. No sign-in was attempted\./,
    );
  });

  assert.match(messages[0] ?? "", /No sign-in was attempted/);
});

test("a valid saved session is reused", () => {
  const originalInfo = console.info;
  const messages: string[] = [];
  console.info = (message?: unknown) => messages.push(String(message));
  try {
    const identity = {
      email: "test@example.invalid",
      tenantLabel: "Demo",
      tenantIdFingerprint: "tenant-fingerprint",
    };
    assert.deepEqual(requireReusableSavedSession({ status: "valid", identity }), identity);
    assert.deepEqual(messages, ["Reusing existing authenticated WorshipSync session."]);
  } finally {
    console.info = originalInfo;
  }
});
