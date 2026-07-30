import test from "node:test";
import assert from "node:assert/strict";
import { buildPublicServicePlanSnapshot } from "./servicePlanPublic.js";

const plan = {
  published: true,
  publicLinkToken: "share-token",
  startsAt: "2026-07-27T14:00:00.000Z",
  timezone: "America/New_York",
  name: "Sunday Service",
  updatedAt: "2026-07-27T13:00:00.000Z",
  publicLive: { mode: "manual", currentElementId: "welcome" },
  sections: [{
    id: "main",
    name: "Main",
    elements: [{
      id: "welcome",
      title: { blocks: [{ type: "paragraph", spans: [{ text: "Welcome" }] }] },
      notes: { blocks: [{ type: "paragraph", spans: [{ text: "Red mic", color: "#dd0000" }] }] },
      teamNotes: [{
        label: "Media",
        note: { blocks: [{ type: "paragraph", spans: [{ text: "Capture the greeting" }] }] },
      }],
      durationMinutes: 5,
      assignedMemberId: "private-member",
      assignedName: "Jamie Rivera",
    }],
  }],
};

test("public service plan snapshot exposes display-only team notes but omits editor fields", () => {
  const snapshot = buildPublicServicePlanSnapshot({ plan, churchName: "Northside" });
  const item = snapshot.service.sections[0].items[0];
  assert.equal(item.title, "Welcome");
  assert.equal(item.durationSeconds, 300);
  assert.deepEqual(item.teamNotes, [{
    label: "Media",
    notes: { blocks: [{ type: "paragraph", spans: [{ text: "Capture the greeting" }] }] },
  }]);
  assert.equal(item.creditName, "Jamie Rivera");
  assert.equal(item.assignedMemberId, undefined);
  assert.equal(snapshot.service.viewMode, "team");
  assert.deepEqual(snapshot.service.live, { mode: "manual", currentItemId: "welcome" });
});

test("general snapshots contain credits but never operational notes", () => {
  const snapshot = buildPublicServicePlanSnapshot({
    plan: { ...plan, publicGeneralLinkToken: "general-share-token" },
    viewMode: "general",
    shareId: "general-share-token",
  });
  const item = snapshot.service.sections[0].items[0];
  assert.equal(snapshot.service.shareId, "general-share-token");
  assert.equal(snapshot.service.viewMode, "general");
  assert.deepEqual(item.notes, { blocks: [] });
  assert.deepEqual(item.teamNotes, []);
  assert.equal(item.creditName, "Jamie Rivera");
  assert.equal(item.assignedMemberId, undefined);
});

test("draft or malformed public plans are never serialized", () => {
  assert.equal(buildPublicServicePlanSnapshot({ plan: { ...plan, published: false } }), null);
  assert.equal(buildPublicServicePlanSnapshot({ plan: { ...plan, startsAt: "invalid" } }), null);
});

test("public snapshot falls back safely when an older plan has an invalid timezone", () => {
  const snapshot = buildPublicServicePlanSnapshot({
    plan: { ...plan, timezone: "not/a-timezone" },
  });
  assert.equal(snapshot.service.timezone, "UTC");
});
