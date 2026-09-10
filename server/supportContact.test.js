import test from "node:test";
import assert from "node:assert/strict";
import {
  SUPPORT_INBOX_DEFAULT,
  SUPPORT_MESSAGE_MAX,
  buildSupportContactEmail,
  isSupportHoneypotFilled,
  parseSupportContactBody,
  resolveSupportInboxEmail,
} from "./supportContact.js";

const normalizeEmail = (email = "") => email.trim().toLowerCase();

test("parseSupportContactBody accepts a valid payload", () => {
  const parsed = parseSupportContactBody(
    {
      name: "Alex Operator",
      email: "Alex@Example.com",
      churchName: "First Church",
      message: "Projector window will not open on Sunday.",
    },
    normalizeEmail,
  );

  assert.equal(parsed.ok, true);
  assert.equal(parsed.email, "alex@example.com");
  assert.equal(parsed.churchName, "First Church");
});

test("parseSupportContactBody rejects short messages and bad email", () => {
  const short = parseSupportContactBody(
    {
      name: "Alex",
      email: "alex@example.com",
      message: "Help",
    },
    normalizeEmail,
  );
  assert.equal(short.ok, false);
  assert.match(short.errorMessage, /short description/i);

  const badEmail = parseSupportContactBody(
    {
      name: "Alex",
      email: "not-an-email",
      message: "Projector window will not open on Sunday.",
    },
    normalizeEmail,
  );
  assert.equal(badEmail.ok, false);
  assert.match(badEmail.errorMessage, /valid email/i);
});

test("parseSupportContactBody enforces message length", () => {
  const tooLong = parseSupportContactBody(
    {
      name: "Alex",
      email: "alex@example.com",
      message: "x".repeat(SUPPORT_MESSAGE_MAX + 1),
    },
    normalizeEmail,
  );
  assert.equal(tooLong.ok, false);
  assert.match(tooLong.errorMessage, /under/i);
});

test("isSupportHoneypotFilled detects bot traps", () => {
  assert.equal(isSupportHoneypotFilled({}), false);
  assert.equal(isSupportHoneypotFilled({ company: "Acme" }), true);
  assert.equal(isSupportHoneypotFilled({ website: "https://spam.test" }), true);
});

test("buildSupportContactEmail escapes HTML and keeps reply details", () => {
  const email = buildSupportContactEmail({
    name: `Alex <script>`,
    email: "alex@example.com",
    churchName: `First & "Best"`,
    message: "Line one\nLine two",
  });

  assert.match(email.subject, /Alex/);
  assert.match(email.textBody, /alex@example.com/);
  assert.match(email.textBody, /Line one\nLine two/);
  assert.doesNotMatch(email.htmlBody, /<script>/);
  assert.match(email.htmlBody, /Alex &lt;script&gt;/);
  assert.match(email.htmlBody, /First &amp; &quot;Best&quot;/);
  assert.match(email.htmlBody, /Line one<br\/>Line two/);
});

test("resolveSupportInboxEmail falls back to the default inbox", () => {
  assert.equal(resolveSupportInboxEmail(""), SUPPORT_INBOX_DEFAULT);
  assert.equal(
    resolveSupportInboxEmail("  Support@WorshipSync.net "),
    "support@worshipsync.net",
  );
});
