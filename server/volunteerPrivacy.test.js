import test from "node:test";
import assert from "node:assert/strict";
import { redactVolunteerSecrets, filterVolunteerTelemetry } from "./volunteerPrivacy.js";

test("personal bearer and session secrets are masked in nested telemetry including cookies", () => {
  const token = `v_${"x".repeat(31)}-`;
  const session = `vs_${"_".repeat(32)}`;
  const input = { request: { url: "/api/auth/me", headers: { cookie: `__Host-worshipsync-volunteer=${session}` } },
    breadcrumbs: [{ data: { url: `https://example.test/s#${token}` } }] };
  const output = filterVolunteerTelemetry(input);
  assert.doesNotMatch(JSON.stringify(output), /vs_|v_x/);
  assert.equal(input.request.headers.cookie.includes(session), true);
  assert.equal(redactVolunteerSecrets(`link: ${token}`), "link: [personal-access-redacted]");
});
test("personal access telemetry drops complete request events, including OTP request bodies", () => {
  assert.equal(filterVolunteerTelemetry({ request: { url: "https://example.test/api/volunteer/recovery/verify", data: { code: "123456" } } }), null);
  assert.equal(filterVolunteerTelemetry({ request: { url: "https://example.test/api/churches/a/team-roster-members/b/personal-access/prepare" } }), null);
});

test("encrypted credential envelopes never enter nested telemetry", () => {
  assert.equal(redactVolunteerSecrets({ nested: { credentialEnvelope: "v2.synthetic.ciphertext" } }).nested.credentialEnvelope,
    "[personal-access-redacted]");
});

test("serialized encrypted envelopes are redacted before structured fields are available", () => {
  const envelope = `v2.${"n".repeat(16)}.${"t".repeat(22)}.${"c".repeat(46)}`;
  const logged = redactVolunteerSecrets(JSON.stringify({ credentialEnvelope: envelope }));
  assert.ok(!logged.includes(envelope));
  assert.match(logged, /personal-access-redacted/);
});
