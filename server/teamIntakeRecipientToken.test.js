import test from "node:test";
import assert from "node:assert/strict";

import {
  createTeamIntakeRecipientToken,
  decryptTeamIntakeRecipientToken,
  encryptTeamIntakeRecipientToken,
  hashTeamIntakeRecipientToken,
  looksLikeTeamIntakeRecipientToken,
  resolveTeamIntakeRecipientTokenSecret,
} from "./teamIntakeRecipientToken.js";

test("recipient tokens are short opaque one-segment values", () => {
  const first = createTeamIntakeRecipientToken();
  const second = createTeamIntakeRecipientToken();

  assert.match(first, /^r_[A-Za-z0-9_-]{24}$/);
  assert.equal(first.length, 26);
  assert.equal(first.includes("."), false);
  assert.notEqual(first, second);
  assert.equal(looksLikeTeamIntakeRecipientToken(first), true);
  assert.equal(looksLikeTeamIntakeRecipientToken("teamIntakeRecipient_member"), false);
});

test("recipient token hashes do not disclose the plaintext", () => {
  const token = createTeamIntakeRecipientToken();
  const hash = hashTeamIntakeRecipientToken(token, "recipient-test-secret");

  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.notEqual(hash, token);
  assert.notEqual(hashTeamIntakeRecipientToken(token, "other-secret"), hash);
});

test("recipient token recovery is encrypted at rest for stable admin links", () => {
  const token = createTeamIntakeRecipientToken();
  const ciphertext = encryptTeamIntakeRecipientToken(token, "recipient-secret");

  assert.match(ciphertext, /^v1\.[^.]+\.[^.]+\.[^.]+$/);
  assert.notEqual(ciphertext.includes(token), true);
  assert.equal(
    decryptTeamIntakeRecipientToken(ciphertext, "recipient-secret"),
    token,
  );
  assert.equal(
    decryptTeamIntakeRecipientToken(ciphertext, "other-secret"),
    null,
  );
});

test("production requires a dedicated recipient token secret", () => {
  assert.throws(
    () =>
      resolveTeamIntakeRecipientTokenSecret({
        NODE_ENV: "production",
        AUTH_SESSION_SECRET: "session-secret",
      }),
    /AUTH_TEAM_INTAKE_RECIPIENT_TOKEN_SECRET must be set in production/,
  );
  assert.equal(
    resolveTeamIntakeRecipientTokenSecret({
      NODE_ENV: "production",
      AUTH_TEAM_INTAKE_RECIPIENT_TOKEN_SECRET: "recipient-secret",
      AUTH_SESSION_SECRET: "session-secret",
    }),
    "recipient-secret",
  );
});

test("development derives a domain-separated secret instead of reusing the session secret", () => {
  const derived = resolveTeamIntakeRecipientTokenSecret({
    NODE_ENV: "development",
    AUTH_SESSION_SECRET: "session-secret",
  });

  assert.notEqual(derived, "session-secret");
  assert.equal(derived, resolveTeamIntakeRecipientTokenSecret({
    NODE_ENV: "development",
    AUTH_SESSION_SECRET: "session-secret",
  }));
});
