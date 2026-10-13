import { test } from "node:test";
import assert from "node:assert/strict";
import { FIXTURE_OWNER, planFixtureCleanup } from "./controllerFixtureCleanup";

const manifest = { owner: FIXTURE_OWNER, database: "worship-sync-demo", outlineId: "e2e-controller-outline-run", ids: ["e2e-controller-outline-run", "song-owned"], baselineSelection: {} };
const owned = { _id: "song-owned", e2eFixture: { owner: FIXTURE_OWNER, outlineId: manifest.outlineId } };
test("matching titles never establish ownership", () => {
  assert.throws(() => planFixtureCleanup([{ _id: "song-owned", name: "E2E Presentation Controller Song A" }], [], manifest), /unowned IDs/);
});
test("ownership from another run cannot authorize deletion", () => {
  assert.throws(() => planFixtureCleanup([{ ...owned, e2eFixture: { ...owned.e2eFixture, outlineId: "another-run" } }], [], manifest), /unowned IDs/);
});
test("operator adoption blocks cleanup until the exact reference is approved", () => {
  const reference = { _id: "operator-outline", items: [{ _id: owned._id }] };
  assert.throws(() => planFixtureCleanup([owned], [reference], manifest), /outside references/);
  assert.equal(planFixtureCleanup([owned], [reference], manifest, [reference._id]).approvedOutlines.length, 1);
});
test("unknown reference shapes are preserved even with an approved ID", () => {
  assert.throws(() => planFixtureCleanup([owned], [{ _id: "plan", resources: [{ songId: owned._id }] }], manifest, ["plan"]), /manual inspection/);
});
test("interrupted cleanup may resume with missing owned records", () => {
  assert.deepEqual(planFixtureCleanup([], [], manifest).owned, []);
  assert.deepEqual(planFixtureCleanup([owned], [{ _id: "allItems" }], manifest).owned, [owned]);
});
test("malformed and duplicated identity lists are rejected", () => {
  assert.throws(() => planFixtureCleanup([], [], { ...manifest, ids: null } as any), /Invalid fixture/);
  assert.throws(() => planFixtureCleanup([], [], { ...manifest, ids: [...manifest.ids, manifest.ids[0]] }), /Invalid fixture/);
});
