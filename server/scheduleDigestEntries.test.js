import test from "node:test";
import assert from "node:assert/strict";

import {
  buildScheduleDigestEntries,
  scheduleDigestSubject,
} from "./scheduleDigestEntries.js";

const nameById = new Map([
  ["m1", "Ada Lovelace"],
  ["m2", "Bo Katan"],
  ["guest-1", "Gail Guest"],
]);
const positionNameById = new Map([
  ["drums", "Drums"],
  ["cam", "Camera"],
]);

const schedule = {
  occurrences: [
    {
      occurrenceId: "occ-06",
      name: "Sunday Gathering",
      startsAt: "2026-09-06T14:00:00.000Z",
    },
    { occurrenceId: "occ-13", name: "Evening", startsAt: "" },
  ],
  responses: {
    "occ-06": {
      "drums::0": {
        memberId: "m1",
        response: "declined",
        respondedAt: "2026-09-01T10:00:00.000Z",
      },
      "cam::0": {
        memberId: "guest-1",
        response: "accepted",
        respondedAt: "2026-09-01T11:00:00.000Z",
      },
    },
  },
};

test("only answers given since the window opened are reported", () => {
  const entries = buildScheduleDigestEntries({
    schedule,
    since: "2026-09-01T10:30:00.000Z",
    nameById,
    positionNameById,
  });

  // The 10:00 decline went out in the previous digest; repeating it would make
  // every email look like it contains new work.
  assert.deepEqual(
    entries.map((entry) => entry.name),
    ["Gail Guest"],
  );
});

test("an answer with no timestamp is not reported as news", () => {
  // Rows written before response tracking existed have no `respondedAt`.
  const entries = buildScheduleDigestEntries({
    schedule: {
      ...schedule,
      responses: {
        "occ-06": { "drums::0": { memberId: "m1", response: "declined" } },
      },
    },
    since: "2026-09-01T00:00:00.000Z",
    nameById,
    positionNameById,
  });

  assert.deepEqual(entries, []);
});

test("a line names the person, the service, and what they were asked to do", () => {
  const [entry] = buildScheduleDigestEntries({
    schedule,
    since: "2026-09-01T00:00:00.000Z",
    nameById,
    positionNameById,
  });

  assert.equal(entry.name, "Ada Lovelace");
  assert.equal(entry.serviceName, "Sunday Gathering");
  assert.equal(entry.positionName, "Drums");
  assert.equal(entry.kind, "declined");
});

test("guests are named like anyone else", () => {
  const entries = buildScheduleDigestEntries({
    schedule,
    since: "2026-09-01T00:00:00.000Z",
    nameById,
    positionNameById,
  });

  assert.ok(entries.some((entry) => entry.name === "Gail Guest"));
});

test("an unknown member still produces a usable line", () => {
  // A slot held by someone since deleted from the roster must not render blank —
  // the service and position are still what the owner needs to act on.
  const [entry] = buildScheduleDigestEntries({
    schedule: {
      ...schedule,
      responses: {
        "occ-06": {
          "drums::0": {
            memberId: "gone",
            response: "declined",
            respondedAt: "2026-09-01T10:00:00.000Z",
          },
        },
      },
    },
    since: "2026-09-01T00:00:00.000Z",
    nameById,
    positionNameById,
  });

  assert.equal(entry.name, "Someone");
  assert.equal(entry.serviceName, "Sunday Gathering");
});

test("an occurrence with no date says so rather than rendering Invalid Date", () => {
  const [entry] = buildScheduleDigestEntries({
    schedule,
    since: "2026-09-01T00:00:00.000Z",
    blockoutConflicts: [
      {
        memberId: "m2",
        occurrenceId: "occ-13",
        cellKey: "cam::0",
        blockedAt: "2026-09-01T12:00:00.000Z",
      },
    ],
    nameById,
    positionNameById,
  }).filter((entry) => entry.kind === "blockout");

  assert.equal(entry.when, "Date to be confirmed");
});

test("a slot on an occurrence that no longer exists is still listed", () => {
  // Better a vague line than silence: the owner is the one who can find out
  // what happened to the service.
  const [entry] = buildScheduleDigestEntries({
    schedule: { occurrences: [], responses: schedule.responses },
    since: "2026-09-01T00:00:00.000Z",
    nameById,
    positionNameById,
  });

  assert.equal(entry.serviceName, "Service");
});

test("blockouts and answers interleave by when they happened", () => {
  const entries = buildScheduleDigestEntries({
    schedule,
    since: "2026-09-01T00:00:00.000Z",
    blockoutConflicts: [
      {
        memberId: "m2",
        occurrenceId: "occ-06",
        cellKey: "cam::1",
        blockedAt: "2026-09-01T10:30:00.000Z",
      },
    ],
    nameById,
    positionNameById,
  });

  assert.deepEqual(
    entries.map((entry) => [entry.name, entry.kind]),
    [
      ["Ada Lovelace", "declined"],
      ["Bo Katan", "blockout"],
      ["Gail Guest", "accepted"],
    ],
  );
});

test("the subject counts everyone who cannot serve, however they said so", () => {
  const entries = [
    { kind: "declined" },
    { kind: "blockout" },
    { kind: "accepted" },
  ];

  assert.equal(
    scheduleDigestSubject(entries, "September"),
    "2 people cannot serve — September",
  );
  assert.equal(
    scheduleDigestSubject([{ kind: "blockout" }], "September"),
    "1 person cannot serve — September",
  );
});

test("all-good news reads as responses, not as a problem", () => {
  assert.equal(
    scheduleDigestSubject([{ kind: "accepted" }], "September"),
    "1 response on September",
  );
  assert.equal(
    scheduleDigestSubject([{ kind: "accepted" }, { kind: "accepted" }], ""),
    "2 responses on your schedule",
  );
});
