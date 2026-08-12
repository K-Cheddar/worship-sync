import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_PENDING_BLOCKOUT_CONFLICTS,
  findNewlyBlockedSlots,
  hasAddedBlockoutRanges,
  isDateBlocked,
  newBlockoutConflictEntries,
  normalizePendingBlockoutConflicts,
  occurrenceCalendarDate,
  verifiedBlockoutConflicts,
} from "./blockoutConflicts.js";

const readHolder = (cell) =>
  typeof cell === "string" ? cell : cell?.primaryMemberId || "";

const schedule = {
  occurrences: [
    { occurrenceId: "occ-06", startsAt: "2026-09-06T10:00:00.000Z" },
    { occurrenceId: "occ-13", startsAt: "2026-09-13T10:00:00.000Z" },
    { occurrenceId: "occ-past", startsAt: "2026-08-02T10:00:00.000Z" },
  ],
  assignments: {
    "occ-06": { "drums::0": { primaryMemberId: "m1" }, "bass::0": "m2" },
    "occ-13": { "drums::0": { primaryMemberId: "m1" } },
    "occ-past": { "drums::0": { primaryMemberId: "m1" } },
  },
};

test("blockout matching agrees with the client, inclusive at both ends", () => {
  const away = [{ startDate: "2026-09-06", endDate: "2026-09-13" }];

  assert.equal(isDateBlocked(away, "2026-09-06"), true);
  assert.equal(isDateBlocked(away, "2026-09-13"), true);
  assert.equal(isDateBlocked(away, "2026-09-05"), false);
  assert.equal(isDateBlocked(away, "2026-09-14"), false);
  // A single-day range stores only a start on some rows.
  assert.equal(isDateBlocked([{ startDate: "2026-09-06" }], "2026-09-06"), true);
  assert.equal(isDateBlocked([{ startDate: "2026-09-06" }], "2026-09-07"), false);
  assert.equal(isDateBlocked(away, ""), false);
  assert.equal(isDateBlocked(undefined, "2026-09-06"), false);
  // A range with no start would otherwise match every date in history.
  assert.equal(isDateBlocked([{ endDate: "2026-09-06" }], "2020-01-01"), false);
});

test("the occurrence day comes from startsAt, matching the grid", () => {
  assert.equal(
    occurrenceCalendarDate({ startsAt: "2026-09-06T10:00:00.000Z" }),
    "2026-09-06",
  );
  assert.equal(occurrenceCalendarDate(undefined), "");
});

test("the cheap pre-check fires only when a range was added", () => {
  const before = [{ startDate: "2026-09-06", endDate: "2026-09-13" }];

  assert.equal(hasAddedBlockoutRanges(before, before), false);
  // Removing, and editing only the note, must stay off the expensive path.
  assert.equal(hasAddedBlockoutRanges(before, []), false);
  assert.equal(
    hasAddedBlockoutRanges(before, [{ ...before[0], notes: "changed" }]),
    false,
  );
  assert.equal(
    hasAddedBlockoutRanges(before, [
      ...before,
      { startDate: "2026-10-04", endDate: "2026-10-04" },
    ]),
    true,
  );
  assert.equal(hasAddedBlockoutRanges([], [{ startDate: "2026-10-04" }]), true);
});

test("only newly blocked upcoming slots are reported", () => {
  const found = findNewlyBlockedSlots(schedule, {
    memberId: "m1",
    previousRanges: [{ startDate: "2026-09-13", endDate: "2026-09-13" }],
    nextRanges: [{ startDate: "2026-09-06", endDate: "2026-09-13" }],
    readHolder,
    fromDate: "2026-08-11",
  });

  // Sep 13 was already blocked, so it is not news. The past service is not
  // actionable. Only m1's own slots count.
  assert.deepEqual(found, [{ occurrenceId: "occ-06", cellKey: "drums::0" }]);
});

test("a member blocking a date they do not serve produces nothing", () => {
  assert.deepEqual(
    findNewlyBlockedSlots(schedule, {
      memberId: "m9",
      previousRanges: [],
      nextRanges: [{ startDate: "2026-09-06", endDate: "2026-09-06" }],
      readHolder,
      fromDate: "2026-08-11",
    }),
    [],
  );
});

test("every held slot on a newly blocked date is reported, not just the first", () => {
  const found = findNewlyBlockedSlots(
    {
      ...schedule,
      assignments: {
        "occ-06": { "drums::0": "m1", "vocals::1": "m1", "bass::0": "m2" },
      },
    },
    {
      memberId: "m1",
      previousRanges: [],
      nextRanges: [{ startDate: "2026-09-06", endDate: "2026-09-06" }],
      readHolder,
      fromDate: "2026-08-11",
    },
  );

  assert.deepEqual(found.map((slot) => slot.cellKey), [
    "drums::0",
    "vocals::1",
  ]);
});

test("only the new keys come back, never the keys already stored", () => {
  // The caller writes what this returns. Handing back the merged map would let a
  // writer holding a stale snapshot re-assert keys the digest just deleted, and
  // the same clash would be emailed twice.
  const additions = [
    { occurrenceId: "occ-06", cellKey: "drums::0", memberId: "m1" },
  ];
  const once = newBlockoutConflictEntries(
    {},
    additions,
    "2026-08-11T00:00:00.000Z",
  );
  assert.equal(Object.keys(once).length, 1);

  const twice = newBlockoutConflictEntries(
    once,
    additions,
    "2026-08-11T00:05:00.000Z",
  );
  // Already recorded, so nothing to write — and the original `blockedAt`, which
  // orders the digest, is left alone.
  assert.deepEqual(twice, {});
});

test("a save adding one conflict to an existing map writes only that one", () => {
  const existing = newBlockoutConflictEntries(
    {},
    [{ occurrenceId: "occ-06", cellKey: "drums::0", memberId: "m1" }],
    "2026-08-11T00:00:00.000Z",
  );

  const added = newBlockoutConflictEntries(
    existing,
    [
      { occurrenceId: "occ-06", cellKey: "drums::0", memberId: "m1" },
      { occurrenceId: "occ-13", cellKey: "drums::0", memberId: "m1" },
    ],
    "2026-08-11T00:05:00.000Z",
  );

  assert.deepEqual(
    Object.values(added).map((entry) => entry.occurrenceId),
    ["occ-13"],
  );
});

test("the pending map is bounded, counting what is already stored", () => {
  const many = Array.from(
    { length: MAX_PENDING_BLOCKOUT_CONFLICTS + 25 },
    (_, index) => ({
      occurrenceId: `occ-${index}`,
      cellKey: "drums::0",
      memberId: "m1",
    }),
  );

  const first = newBlockoutConflictEntries(
    {},
    many,
    "2026-08-11T00:00:00.000Z",
  );
  assert.equal(
    Object.keys(first).length,
    MAX_PENDING_BLOCKOUT_CONFLICTS,
  );

  // A full map accepts nothing further, rather than growing the document that
  // every grid load reads.
  assert.deepEqual(
    newBlockoutConflictEntries(
      first,
      [{ occurrenceId: "occ-late", cellKey: "drums::0", memberId: "m1" }],
      "2026-08-11T00:05:00.000Z",
    ),
    {},
  );
});

test("half-written rows are dropped rather than emailed as a blank line", () => {
  const normalized = normalizePendingBlockoutConflicts({
    good: { memberId: "m1", occurrenceId: "occ-06", cellKey: "drums::0" },
    noMember: { occurrenceId: "occ-06", cellKey: "drums::0" },
    noCell: { memberId: "m1", occurrenceId: "occ-06" },
    "": { memberId: "m1", occurrenceId: "occ-06", cellKey: "drums::0" },
  });

  assert.deepEqual(Object.keys(normalized), ["good"]);
  assert.equal(normalized.good.blockedAt, "");
});

test("conflicts resolved during the window never reach the email", () => {
  const pending = newBlockoutConflictEntries(
    {},
    [
      { occurrenceId: "occ-06", cellKey: "drums::0", memberId: "m1" },
      { occurrenceId: "occ-13", cellKey: "drums::0", memberId: "m1" },
    ],
    "2026-08-11T00:00:00.000Z",
  );

  const verified = verifiedBlockoutConflicts(pending, {
    schedule: {
      ...schedule,
      // The owner refilled Sep 6 with someone else during the window.
      assignments: {
        ...schedule.assignments,
        "occ-06": { "drums::0": "m5" },
      },
    },
    blockoutRangesByMemberId: new Map([
      ["m1", [{ startDate: "2026-09-06", endDate: "2026-09-13" }]],
    ]),
    readHolder,
  });

  assert.deepEqual(
    verified.map((entry) => entry.occurrenceId),
    ["occ-13"],
  );
});

test("a member who removes the blockout again produces no email", () => {
  const pending = newBlockoutConflictEntries(
    {},
    [{ occurrenceId: "occ-06", cellKey: "drums::0", memberId: "m1" }],
    "2026-08-11T00:00:00.000Z",
  );

  assert.deepEqual(
    verifiedBlockoutConflicts(pending, {
      schedule,
      blockoutRangesByMemberId: new Map([["m1", []]]),
      readHolder,
    }),
    [],
  );
});

test("verified conflicts come back oldest first", () => {
  const pending = {
    ...newBlockoutConflictEntries(
      {},
      [{ occurrenceId: "occ-13", cellKey: "drums::0", memberId: "m1" }],
      "2026-08-11T00:09:00.000Z",
    ),
    ...newBlockoutConflictEntries(
      {},
      [{ occurrenceId: "occ-06", cellKey: "drums::0", memberId: "m1" }],
      "2026-08-11T00:01:00.000Z",
    ),
  };

  assert.deepEqual(
    verifiedBlockoutConflicts(pending, {
      schedule,
      blockoutRangesByMemberId: new Map([
        ["m1", [{ startDate: "2026-09-06", endDate: "2026-09-13" }]],
      ]),
      readHolder,
    }).map((entry) => entry.occurrenceId),
    ["occ-06", "occ-13"],
  );
});
