import test from "node:test";
import assert from "node:assert/strict";

import {
  applyAssignmentResponses,
  normalizeAssignmentResponse,
  normalizeScheduleResponses,
  pruneStaleResponses,
  readAssignmentResponse,
  withAssignmentResponse,
} from "./scheduleResponses.js";

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
}
