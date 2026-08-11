import test from "node:test";
import assert from "node:assert/strict";

import {
  NOTIFICATION_CATEGORY_KEYS,
  isNotificationEnabled,
  isTeamEditorAnywhere,
  normalizeNotificationPreference,
  normalizeNotificationPreferences,
  visibleNotificationCategories,
} from "./notificationPreferences.js";

test("unknown preference values fall back to default", () => {
  assert.equal(normalizeNotificationPreference("on"), "on");
  assert.equal(normalizeNotificationPreference("OFF"), "off");
  assert.equal(normalizeNotificationPreference("  default "), "default");
  assert.equal(normalizeNotificationPreference(undefined), "default");
  assert.equal(normalizeNotificationPreference("yes"), "default");
  assert.equal(normalizeNotificationPreference(null), "default");
});

test("normalizing fills every category and drops retired ones", () => {
  const normalized = normalizeNotificationPreferences({
    scheduleAssignments: "off",
    somethingRetired: "on",
  });

  assert.deepEqual(Object.keys(normalized).sort(), [
    ...NOTIFICATION_CATEGORY_KEYS,
  ].sort());
  assert.equal(normalized.scheduleAssignments, "off");
  // Categories the row never stored resolve to the tri-state default, not to a
  // hard on/off, so the default stays changeable without a migration.
  assert.equal(normalized.scheduleReminders, "default");
  assert.equal(normalized.somethingRetired, undefined);
});

test("explicit values win and default follows the category", () => {
  assert.equal(isNotificationEnabled("scheduleAssignments", "on"), true);
  assert.equal(isNotificationEnabled("scheduleAssignments", "off"), false);
  assert.equal(isNotificationEnabled("scheduleAssignments", "default"), true);
  assert.equal(isNotificationEnabled("scheduleAssignments", undefined), true);
});

test("an unknown category is muted rather than un-mutable", () => {
  // Failing closed means a typo shows up as a missing email someone reports,
  // not as mail with no switch to turn it off.
  assert.equal(isNotificationEnabled("scheduleAsignments", "on"), false);
  assert.equal(isNotificationEnabled("", "on"), false);
});

test("team editors are recognized church-wide or per team", () => {
  assert.equal(isTeamEditorAnywhere({ role: "admin" }), true);
  assert.equal(isTeamEditorAnywhere({ teamsPermission: "edit" }), true);
  assert.equal(
    isTeamEditorAnywhere({ teamScopes: { "team-1": "edit" } }),
    true,
  );
  assert.equal(
    isTeamEditorAnywhere({ teamScopes: { "team-1": "view" } }),
    false,
  );
  assert.equal(isTeamEditorAnywhere({ teamsPermission: "view" }), false);
  assert.equal(isTeamEditorAnywhere({}), false);
});

test("a schedule-only volunteer is offered member categories only", () => {
  const visible = visibleNotificationCategories({ teamsPermission: "none" });

  assert.deepEqual(visible, ["scheduleAssignments", "scheduleReminders"]);
});

test("an editor sees owner categories too", () => {
  const visible = visibleNotificationCategories({ teamsPermission: "edit" });

  assert.deepEqual(visible, [...NOTIFICATION_CATEGORY_KEYS]);
});

test("every offered category has a dispatch behind it", () => {
  // `offered: false` exists because this shipped once as a switch promising
  // mail that never arrived, which is worse than a missing preference — the
  // owner believes they are covered and stops checking. Any new category should
  // stay unoffered until its emails exist.
  const offered = visibleNotificationCategories({ role: "admin" });

  assert.deepEqual(offered, [...NOTIFICATION_CATEGORY_KEYS]);
  assert.equal(isNotificationEnabled("scheduleResponses", "default"), true);
});

test("member categories are not gated on currently being on a roster", () => {
  // Roster membership changes without warning. Gating would make the switch
  // appear the day an admin adds you and vanish the day they remove you, and
  // would stop anyone setting a preference before their first assignment —
  // exactly when it matters.
  assert.deepEqual(visibleNotificationCategories({}), [
    "scheduleAssignments",
    "scheduleReminders",
  ]);
});
