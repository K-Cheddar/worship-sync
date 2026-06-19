import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeIntakeNotificationPreference,
  isIntakeNotificationEnabled,
  isTeamEditorForForm,
  decideDigestAction,
  collectDigestSubmitterNames,
  selectIntakeNotifyRecipients,
} from "./intakeNotifyRecipients.js";

test("normalizeIntakeNotificationPreference keeps known values", () => {
  assert.equal(normalizeIntakeNotificationPreference("on"), "on");
  assert.equal(normalizeIntakeNotificationPreference("off"), "off");
  assert.equal(normalizeIntakeNotificationPreference("default"), "default");
});

test("normalizeIntakeNotificationPreference is case/whitespace tolerant", () => {
  assert.equal(normalizeIntakeNotificationPreference("  OFF "), "off");
  assert.equal(normalizeIntakeNotificationPreference("On"), "on");
});

test("normalizeIntakeNotificationPreference falls back to default", () => {
  assert.equal(normalizeIntakeNotificationPreference(undefined), "default");
  assert.equal(normalizeIntakeNotificationPreference(null), "default");
  assert.equal(normalizeIntakeNotificationPreference("weekly"), "default");
  assert.equal(normalizeIntakeNotificationPreference(""), "default");
});

test("isIntakeNotificationEnabled opts editors in unless explicitly off", () => {
  assert.equal(isIntakeNotificationEnabled("on"), true);
  assert.equal(isIntakeNotificationEnabled("default"), true);
  assert.equal(isIntakeNotificationEnabled(undefined), true);
  assert.equal(isIntakeNotificationEnabled("off"), false);
});

test("isTeamEditorForForm: admins and church-wide editors always qualify", () => {
  assert.equal(
    isTeamEditorForForm({ role: "admin", teamsPermission: "none", formTeamIds: ["t1"] }),
    true,
  );
  assert.equal(
    isTeamEditorForForm({ role: "member", teamsPermission: "edit", formTeamIds: ["t1"] }),
    true,
  );
});

test("isTeamEditorForForm: per-team edit scope on any of the form's teams qualifies", () => {
  assert.equal(
    isTeamEditorForForm({
      role: "member",
      teamsPermission: "none",
      teamScopes: { t2: "edit" },
      formTeamIds: ["t1", "t2"],
    }),
    true,
  );
});

test("isTeamEditorForForm: view-only scope and unrelated teams do not qualify", () => {
  assert.equal(
    isTeamEditorForForm({
      role: "member",
      teamsPermission: "view",
      teamScopes: { t2: "view", t3: "edit" },
      formTeamIds: ["t1", "t2"],
    }),
    false,
  );
  assert.equal(
    isTeamEditorForForm({ role: "member", teamsPermission: "none", formTeamIds: [] }),
    false,
  );
});

test("decideDigestAction: no marker opens a window", () => {
  assert.equal(
    decideDigestAction({ pendingSince: null, hasArmedTimer: false, nowMs: 1000, windowMs: 100 }),
    "open-window",
  );
});

test("decideDigestAction: an armed timer coalesces (noop)", () => {
  assert.equal(
    decideDigestAction({
      pendingSince: new Date(900).toISOString(),
      hasArmedTimer: true,
      nowMs: 1000,
      windowMs: 100,
    }),
    "noop",
  );
});

test("decideDigestAction: marker past the window with no timer flushes now (restart)", () => {
  assert.equal(
    decideDigestAction({
      pendingSince: new Date(0).toISOString(),
      hasArmedTimer: false,
      nowMs: 1000,
      windowMs: 100,
    }),
    "flush-now",
  );
});

test("decideDigestAction: marker within the window with no timer re-arms (restart mid-window)", () => {
  assert.equal(
    decideDigestAction({
      pendingSince: new Date(950).toISOString(),
      hasArmedTimer: false,
      nowMs: 1000,
      windowMs: 100,
    }),
    "arm-timer",
  );
});

test("decideDigestAction: a corrupt marker restarts the window", () => {
  assert.equal(
    decideDigestAction({
      pendingSince: "not-a-date",
      hasArmedTimer: false,
      nowMs: 1000,
      windowMs: 100,
    }),
    "open-window",
  );
});

test("collectDigestSubmitterNames: includes only submissions at/after the window start, oldest first", () => {
  const names = collectDigestSubmitterNames(
    [
      { submittedAt: "2026-06-19T10:05:00Z", firstName: "Sam", lastName: "Rivera" },
      { submittedAt: "2026-06-19T09:00:00Z", firstName: "Too", lastName: "Early" },
      { submittedAt: "2026-06-19T10:01:00Z", firstName: "Jordan", lastName: "Lee" },
    ],
    "2026-06-19T10:00:00Z",
  );
  assert.deepEqual(names, ["Jordan Lee", "Sam Rivera"]);
});

test("collectDigestSubmitterNames: falls back to 'Someone' for blank names and tolerates bad input", () => {
  assert.deepEqual(
    collectDigestSubmitterNames(
      [{ submittedAt: "2026-06-19T10:01:00Z", firstName: "  ", lastName: "" }],
      "2026-06-19T10:00:00Z",
    ),
    ["Someone"],
  );
  assert.deepEqual(collectDigestSubmitterNames(null, "2026-06-19T10:00:00Z"), []);
});

test("selectIntakeNotifyRecipients includes opted-in editors only", () => {
  const recipients = selectIntakeNotifyRecipients([
    { email: "a@church.org", isEditor: true, preference: "on" },
    { email: "b@church.org", isEditor: true, preference: "default" },
    { email: "muted@church.org", isEditor: true, preference: "off" },
    { email: "viewer@church.org", isEditor: false, preference: "on" },
  ]);
  assert.deepEqual(recipients, ["a@church.org", "b@church.org"]);
});

test("selectIntakeNotifyRecipients dedupes case-insensitively, keeps first casing", () => {
  const recipients = selectIntakeNotifyRecipients([
    { email: "Lead@Church.org", isEditor: true, preference: "default" },
    { email: "lead@church.org", isEditor: true, preference: "on" },
  ]);
  assert.deepEqual(recipients, ["Lead@Church.org"]);
});

test("selectIntakeNotifyRecipients drops blank emails and tolerates bad input", () => {
  assert.deepEqual(selectIntakeNotifyRecipients(null), []);
  assert.deepEqual(
    selectIntakeNotifyRecipients([
      { email: "   ", isEditor: true, preference: "on" },
      { email: undefined, isEditor: true, preference: "on" },
      null,
    ]),
    [],
  );
});
