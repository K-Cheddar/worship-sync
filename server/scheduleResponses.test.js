import test from "node:test";
import assert from "node:assert/strict";

import {
  applyAssignmentResponses,
  applyPendingAssignmentResponses,
  isVolunteerScheduleVisible,
  normalizeAssignmentResponse,
  normalizeScheduleResponses,
  pruneStaleResponses,
  readAssignmentResponse,
  withAssignmentResponse,
} from "./scheduleResponses.js";

test("pending-only responses accept eligible primary slots without changing prior answers or unrelated records", () => {
  const schedule = {
    assignments: {
      future: {
        legacy: "m1",
        structured: { primaryMemberId: "m1", shadows: ["m2"] },
        accepted: "m1",
        declined: "m1",
        stale: "m1",
        shadowOnly: { primaryMemberId: "m2", shadows: ["m1"] },
      },
    },
    responses: {
      future: {
        legacy: { memberId: "m1", response: "pending", metadata: "keep current holder data" },
        accepted: { memberId: "m1", response: "accepted", respondedAt: "accepted-at" },
        declined: { memberId: "m1", response: "declined", respondedAt: "declined-at" },
        stale: { memberId: "previous-holder", response: "declined", respondedAt: "old-at" },
        otherMember: { memberId: "m2", response: "accepted", respondedAt: "other-at", extra: "preserve" },
      },
      unrelatedOccurrence: { slot: { memberId: "m9", response: "accepted", privateMetadata: "preserve" } },
    },
  };
  const result = applyPendingAssignmentResponses(schedule, {
    memberId: "m1",
    targets: [
      { occurrenceId: "future", cellKey: "legacy" },
      { occurrenceId: "future", cellKey: "structured" },
      { occurrenceId: "future", cellKey: "accepted" },
      { occurrenceId: "future", cellKey: "declined" },
      { occurrenceId: "future", cellKey: "stale" },
      { occurrenceId: "future", cellKey: "shadowOnly" },
    ],
    respondedAt: "now",
  });

  assert.equal(result.newlyAccepted, 3);
  assert.equal(result.alreadyAccepted, 1);
  assert.equal(result.alreadyDeclined, 1);
  assert.equal(result.skipped, 1);
  assert.deepEqual(result.outcomes.map((item) => item.status), [
    "accepted",
    "accepted",
    "already_accepted",
    "already_declined",
    "accepted",
    "skipped",
  ]);
  assert.deepEqual(result.responses.future.accepted, schedule.responses.future.accepted);
  assert.deepEqual(result.responses.future.declined, schedule.responses.future.declined);
  assert.deepEqual(result.responses.future.otherMember, schedule.responses.future.otherMember);
  assert.deepEqual(result.responses.unrelatedOccurrence, schedule.responses.unrelatedOccurrence);
  assert.deepEqual(result.responses.future.stale, {
    memberId: "m1",
    response: "accepted",
    respondedAt: "now",
  });
  assert.deepEqual(result.responses.future.legacy, {
    memberId: "m1",
    response: "accepted",
    respondedAt: "now",
    metadata: "keep current holder data",
  });
  assert.equal(schedule.responses.future.stale.memberId, "previous-holder");
});

test("a repeated pending-only response is a no-op and de-duplicates assignment identities", () => {
  const schedule = {
    assignments: { future: { slot: "m1" } },
    responses: {},
  };
  const first = applyPendingAssignmentResponses(schedule, {
    memberId: "m1",
    targets: [
      { occurrenceId: "future", cellKey: "slot" },
      { occurrenceId: "future", cellKey: "slot" },
    ],
    respondedAt: "first-at",
  });
  const second = applyPendingAssignmentResponses(
    { ...schedule, responses: first.responses },
    {
      memberId: "m1",
      targets: [{ occurrenceId: "future", cellKey: "slot" }],
      respondedAt: "second-at",
    },
  );

  assert.equal(first.newlyAccepted, 1);
  assert.equal(first.outcomes.length, 1);
  assert.equal(second.newlyAccepted, 0);
  assert.equal(second.changed, false);
  assert.deepEqual(second.responses, first.responses);
  assert.equal(second.responses.future.slot.respondedAt, "first-at");
});

test("volunteer schedule visibility excludes Draft and archived schedules but keeps legacy Published schedules", () => {
  assert.equal(isVolunteerScheduleVisible({ scheduleId: "draft", published: false }), false);
  assert.equal(isVolunteerScheduleVisible({ scheduleId: "published", published: true }), true);
  assert.equal(isVolunteerScheduleVisible({ scheduleId: "legacy" }), true);
  assert.equal(isVolunteerScheduleVisible({ scheduleId: "archived", archivedAt: "archived" }), false);
  assert.equal(isVolunteerScheduleVisible(null), false);
});

test("absent and unreadable answers both read as pending", () => {
  // Most assignments are never answered, so absence is normal, not an error —
  // and an unreadable value must not be mistaken for a real answer.
  assert.equal(normalizeAssignmentResponse(undefined), "pending");
  assert.equal(normalizeAssignmentResponse(""), "pending");
  assert.equal(normalizeAssignmentResponse("maybe"), "pending");
  assert.equal(normalizeAssignmentResponse(" ACCEPTED "), "accepted");
  assert.equal(normalizeAssignmentResponse("declined"), "declined");
});

test("a response belongs to the member who gave it", () => {
  const record = {
    memberId: "m1",
    response: "accepted",
    respondedAt: "2026-09-01T00:00:00.000Z",
  };

  assert.deepEqual(readAssignmentResponse(record, "m1"), {
    response: "accepted",
    respondedAt: "2026-09-01T00:00:00.000Z",
  });
  // Reassigning the slot must not hand the new person the old "accepted".
  assert.deepEqual(readAssignmentResponse(record, "m2"), {
    response: "pending",
    respondedAt: "",
  });
  assert.equal(readAssignmentResponse(record, "").response, "pending");
  assert.equal(readAssignmentResponse(null, "m1").response, "pending");
});

test("normalizing drops records with no member and empty rows", () => {
  const normalized = normalizeScheduleResponses({
    "svc@2026-09-06": {
      "pos::0": { memberId: "m1", response: "accepted" },
      "pos::1": { response: "declined" },
    },
    "svc@2026-09-13": { "pos::0": {} },
    "": { "pos::0": { memberId: "m1" } },
  });

  assert.deepEqual(Object.keys(normalized), ["svc@2026-09-06"]);
  assert.deepEqual(Object.keys(normalized["svc@2026-09-06"]), ["pos::0"]);
  assert.equal(normalized["svc@2026-09-06"]["pos::0"].respondedAt, "");
});

test("recording an answer replaces the previous one without mutating", () => {
  const before = {
    "svc@2026-09-06": { "pos::0": { memberId: "m1", response: "accepted" } },
  };
  const after = withAssignmentResponse(before, {
    occurrenceId: "svc@2026-09-06",
    cellKey: "pos::0",
    memberId: "m1",
    response: "declined",
    respondedAt: "2026-09-02T00:00:00.000Z",
  });

  assert.equal(after["svc@2026-09-06"]["pos::0"].response, "declined");
  assert.equal(before["svc@2026-09-06"]["pos::0"].response, "accepted");
});

test("recording keeps other slots and other occurrences", () => {
  const after = withAssignmentResponse(
    {
      "svc@2026-09-06": { "pos::1": { memberId: "m2", response: "accepted" } },
      "svc@2026-09-13": { "pos::0": { memberId: "m1", response: "declined" } },
    },
    {
      occurrenceId: "svc@2026-09-06",
      cellKey: "pos::0",
      memberId: "m1",
      response: "accepted",
    },
  );

  assert.equal(after["svc@2026-09-06"]["pos::1"].response, "accepted");
  assert.equal(after["svc@2026-09-13"]["pos::0"].response, "declined");
  assert.equal(after["svc@2026-09-06"]["pos::0"].response, "accepted");
});

test("responses for slots nobody holds any more are pruned", () => {
  const holders = {
    "svc@2026-09-06": { "pos::0": "m1", "pos::1": "" },
    "svc@2026-09-13": { "pos::0": "m9" },
  };
  const pruned = pruneStaleResponses(
    {
      "svc@2026-09-06": {
        "pos::0": { memberId: "m1", response: "accepted" },
        "pos::1": { memberId: "m2", response: "accepted" },
      },
      "svc@2026-09-13": { "pos::0": { memberId: "m1", response: "declined" } },
    },
    (occurrenceId, cellKey) => holders[occurrenceId]?.[cellKey] || "",
  );

  // Kept: still held by the same member. Dropped: cleared slot, and a slot
  // reassigned to someone else.
  assert.deepEqual(pruned, {
    "svc@2026-09-06": {
      "pos::0": { memberId: "m1", response: "accepted", respondedAt: "" },
    },
  });
});

// The writer that uses this has a Firestore-transaction branch the suite cannot
// reach (`skipUnlessInMemoryAuth`), so the decision is tested here directly and
// both branches share it.
describe_applyAssignmentResponses();

function describe_applyAssignmentResponses() {
  const readHolder = (cell) =>
    typeof cell === "string" ? cell : cell?.primaryMemberId || "";
  const schedule = {
    assignments: {
      "svc@2026-09-06": { "cam::0": { primaryMemberId: "m1" }, "cam::1": "m2" },
      "svc@2026-09-13": { "cam::0": { primaryMemberId: "m1" } },
    },
  };

  test("answers every slot the member still holds", () => {
    const result = applyAssignmentResponses(schedule, {
      memberId: "m1",
      targets: [
        { occurrenceId: "svc@2026-09-06", cellKey: "cam::0" },
        { occurrenceId: "svc@2026-09-13", cellKey: "cam::0" },
      ],
      response: "accepted",
      respondedAt: "2026-09-01T00:00:00.000Z",
      readHolder,
    });

    assert.equal(result.applied, 2);
    assert.equal(
      result.responses["svc@2026-09-13"]["cam::0"].response,
      "accepted",
    );
  });

  test("skips slots that moved on rather than failing the batch", () => {
    // One reshuffled date must not stop someone answering the other three.
    const result = applyAssignmentResponses(schedule, {
      memberId: "m1",
      targets: [
        { occurrenceId: "svc@2026-09-06", cellKey: "cam::0" },
        { occurrenceId: "svc@2026-09-06", cellKey: "cam::1" },
      ],
      response: "declined",
      respondedAt: "2026-09-01T00:00:00.000Z",
      readHolder,
    });

    assert.equal(result.applied, 1);
    assert.equal(result.responses["svc@2026-09-06"]["cam::1"], undefined);
  });

  test("applies nothing when the member holds none of the targets", () => {
    const result = applyAssignmentResponses(schedule, {
      memberId: "gone",
      targets: [{ occurrenceId: "svc@2026-09-06", cellKey: "cam::0" }],
      response: "accepted",
      respondedAt: "2026-09-01T00:00:00.000Z",
      readHolder,
    });

    assert.equal(result.applied, 0);
  });

  test("pending-only acceptance preserves persisted answers and skips removed slots", () => {
    const current = {
      ...schedule,
      responses: {
        "svc@2026-09-06": { "cam::0": { memberId: "m1", response: "declined", respondedAt: "later" } },
        "svc@2026-09-13": { "cam::0": { memberId: "old-holder", response: "accepted" } },
      },
    };
    const params = {
      memberId: "m1", response: "accepted", respondedAt: "now", readHolder,
      targets: [
        { occurrenceId: "svc@2026-09-06", cellKey: "cam::0" },
        { occurrenceId: "svc@2026-09-13", cellKey: "cam::0" },
        { occurrenceId: "removed", cellKey: "cam::0" },
      ],
    };
    const result = applyPendingAssignmentResponses(current, params);
    assert.equal(result.newlyAccepted, 1);
    assert.deepEqual(result.responses["svc@2026-09-06"]["cam::0"], current.responses["svc@2026-09-06"]["cam::0"]);
    assert.equal(result.responses["svc@2026-09-13"]["cam::0"].memberId, "m1");
    assert.equal(applyPendingAssignmentResponses({ ...current, responses: result.responses }, params).newlyAccepted, 0);
  });
}
