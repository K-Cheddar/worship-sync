import test from "node:test";
import assert from "node:assert/strict";

import {
  ASSIGNMENT_TOKEN_TTL_MS,
  createAssignmentResponseToken,
  readAssignmentResponseToken,
} from "./assignmentResponseToken.js";

const SECRET = "test-secret";
const NOW = 1_800_000_000_000;
const payload = (overrides = {}) => ({
  churchId: "church-1",
  scheduleId: "sched-1",
  memberId: "m1",
  ...overrides,
});

const mint = (overrides = {}, expiresAt = NOW + ASSIGNMENT_TOKEN_TTL_MS) =>
  createAssignmentResponseToken(SECRET, payload(overrides), expiresAt);

test("a freshly minted token round-trips", () => {
  const result = readAssignmentResponseToken(SECRET, mint(), NOW);

  assert.equal(result.valid, true);
  assert.deepEqual(result.payload, payload());
});

test("a token signed with another secret is rejected", () => {
  const foreign = createAssignmentResponseToken(
    "other-secret",
    payload(),
    NOW + 1000,
  );

  assert.deepEqual(readAssignmentResponseToken(SECRET, foreign, NOW), {
    valid: false,
    reason: "signature",
  });
});

test("editing any field invalidates the signature", () => {
  // The token must not be repointable at a different slot or member.
  const token = mint();
  const parts = token.split(".");
  for (let index = 0; index < 3; index += 1) {
    const tampered = [...parts];
    tampered[index] = Buffer.from("tampered").toString("base64url");
    assert.equal(
      readAssignmentResponseToken(SECRET, tampered.join("."), NOW).reason,
      "signature",
      `field ${index} should be covered by the signature`,
    );
  }
});

test("extending the expiry by hand invalidates the signature", () => {
  const parts = mint({}, NOW - 1).split(".");
  parts[3] = String(NOW + 1_000_000);
  assert.equal(
    readAssignmentResponseToken(SECRET, parts.join("."), NOW).reason,
    "signature",
  );
});

test("an expired token is reported apart from a broken one", () => {
  // "Ask for a new link" and "this link is wrong" are different things to tell
  // a reader, so the caller needs to be able to tell them apart.
  assert.deepEqual(readAssignmentResponseToken(SECRET, mint({}, NOW - 1), NOW), {
    valid: false,
    reason: "expired",
  });
  assert.equal(
    readAssignmentResponseToken(SECRET, "not-a-token", NOW).reason,
    "malformed",
  );
  assert.equal(readAssignmentResponseToken(SECRET, "", NOW).reason, "malformed");
  assert.equal(
    readAssignmentResponseToken(SECRET, undefined, NOW).reason,
    "malformed",
  );
});

test("a value containing the separator cannot shift the field boundaries", () => {
  const odd = mint({ scheduleId: "sched.1.extra", memberId: "m.1" });
  const result = readAssignmentResponseToken(SECRET, odd, NOW);

  assert.equal(result.valid, true);
  assert.equal(result.payload.scheduleId, "sched.1.extra");
  assert.equal(result.payload.memberId, "m.1");
});

test("a token missing a field is malformed even when signed correctly", () => {
  const token = createAssignmentResponseToken(
    SECRET,
    payload({ memberId: "" }),
    NOW + 1000,
  );

  assert.equal(readAssignmentResponseToken(SECRET, token, NOW).reason, "malformed");
});

test("the token carries no answer, so a leaked link cannot force one", () => {
  // Accept and decline share one token; the choice is made at the link.
  const token = mint();
  assert.ok(!token.includes(Buffer.from("declined").toString("base64url")));
  assert.ok(!token.includes(Buffer.from("accepted").toString("base64url")));
});
