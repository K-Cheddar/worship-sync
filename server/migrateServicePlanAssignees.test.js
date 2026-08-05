import test from "node:test";
import assert from "node:assert/strict";
import {
  migrateServicePlanElement,
  migrateServicePlanSections,
} from "../scripts/migrate-service-plan-assignees.js";

test("migrates a single assignee holding one microphone onto that person", () => {
  const migrated = migrateServicePlanElement({
    id: "el-1",
    assignedName: "Pastor John",
    assignedMemberId: "member-1",
    microphoneAssignments: [{ microphoneId: "mic-orange" }],
  });

  assert.equal(migrated.assignees.length, 1);
  assert.equal(migrated.assignees[0].name, "Pastor John");
  assert.equal(migrated.assignees[0].memberId, "member-1");
  assert.deepEqual(migrated.assignees[0].microphoneIds, ["mic-orange"]);
  // The superseded fields are gone, so the document has one source of truth.
  assert.equal("assignedName" in migrated, false);
  assert.equal("assignedMemberId" in migrated, false);
  assert.equal("microphoneAssignments" in migrated, false);
});

test("leaves several microphones unassigned rather than guessing who held what", () => {
  const migrated = migrateServicePlanElement({
    id: "el-1",
    assignedName: "Jane",
    microphoneAssignments: [
      { microphoneId: "mic-a" },
      { microphoneId: "mic-b" },
    ],
  });

  assert.equal(migrated.assignees.length, 2);
  assert.equal(migrated.assignees[0].name, "Jane");
  assert.equal(migrated.assignees[0].microphoneIds, undefined);
  assert.equal(migrated.assignees[1].name, undefined);
  assert.deepEqual(migrated.assignees[1].microphoneIds, ["mic-a", "mic-b"]);
});

test("keeps a microphone with no person as the unassigned slot", () => {
  const migrated = migrateServicePlanElement({
    id: "el-1",
    microphoneAssignments: [{ microphoneId: "mic-choir" }],
  });

  assert.equal(migrated.assignees.length, 1);
  assert.equal(migrated.assignees[0].name, undefined);
  assert.deepEqual(migrated.assignees[0].microphoneIds, ["mic-choir"]);
});

test("drops duplicate microphone ids", () => {
  const migrated = migrateServicePlanElement({
    id: "el-1",
    microphoneAssignments: [
      { microphoneId: "mic-a" },
      { microphoneId: "mic-a" },
    ],
  });

  assert.deepEqual(migrated.assignees[0].microphoneIds, ["mic-a"]);
});

test("is idempotent: an already-migrated element is left alone", () => {
  assert.equal(
    migrateServicePlanElement({ id: "el-1", assignees: [] }),
    null,
  );
  assert.equal(
    migrateServicePlanElement({
      id: "el-1",
      assignees: [{ id: "a1", name: "Jane" }],
      // A stray legacy field alongside `assignees` is not re-converted; the
      // new shape already won.
      assignedName: "Someone else",
    }),
    null,
  );
});

test("leaves an element with nothing to convert untouched", () => {
  assert.equal(migrateServicePlanElement({ id: "el-1" }), null);
  assert.equal(migrateServicePlanElement(null), null);
});

test("reports no change when no element in the document needs converting", () => {
  assert.equal(
    migrateServicePlanSections([
      { id: "s1", name: "Worship", elements: [{ id: "e1", assignees: [] }] },
    ]),
    null,
  );
  assert.equal(migrateServicePlanSections(undefined), null);
});

test("converts only the elements that need it, preserving the rest", () => {
  const sections = migrateServicePlanSections([
    {
      id: "s1",
      name: "Worship",
      elements: [
        { id: "e1", assignedName: "Jane" },
        { id: "e2", title: "Untouched" },
      ],
    },
  ]);

  assert.equal(sections[0].name, "Worship");
  assert.equal(sections[0].elements[0].assignees[0].name, "Jane");
  assert.deepEqual(sections[0].elements[1], { id: "e2", title: "Untouched" });
});
