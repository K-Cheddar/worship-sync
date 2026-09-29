import test from "node:test";
import assert from "node:assert/strict";
import { encodeCsv, parseCsv, protectSpreadsheetFormula } from "./csv.js";
import { PORTABLE_SCHEMAS, buildPortableDatasets, parsePortablePositionIcon, serializePortablePositionIcon } from "./schemas.js";
import { portableServiceMatches } from "./matching.js";
import { classifyPortablePreviewAction } from "./matching.js";
import { portableWallClockToIso } from "./time.js";
import { formatPortableDate, formatPortableTime } from "./time.js";
import { createZip } from "./zip.js";

test("CSV parser handles BOM, quoted commas, quotes, multiline values and blanks", () => {
  const parsed = parseCsv('\uFEFFName,Notes,Email\r\n"Doe, Jane","Said ""hello""\nand left",\r\n');
  assert.deepEqual(parsed.headers, ["Name", "Notes", "Email"]);
  assert.deepEqual(parsed.rows[0].values, { Name: "Doe, Jane", Notes: 'Said "hello"\nand left', Email: "" });
  assert.deepEqual(parsed.issues, []);
});

test("CSV parser reports malformed records and quote errors", () => {
  const parsed = parseCsv('A,B\n1\n"unfinished,2');
  assert.equal(parsed.rows.length, 0);
  assert.equal(parsed.totalRows, 2);
  assert.deepEqual(parsed.issues.map(({ code }) => code), ["column_count_mismatch", "unclosed_quote"]);
});

test("CSV parser reports an empty file without headers", () => {
  assert.deepEqual(parseCsv("").issues.map(({ code }) => code), ["missing_header"]);
});

test("CSV serializer quotes values and protects formula injection", () => {
  const csv = encodeCsv(["Name", "Notes"], [["Jane", "=HYPERLINK(\"https://bad\")"]]);
  assert.match(csv, /'=HYPERLINK\(""https:\/\/bad""\)/);
  assert.equal(protectSpreadsheetFormula("normal text"), "normal text");
});

test("preview action classification keeps resolvable ambiguity in review", () => {
  assert.equal(classifyPortablePreviewAction({ issues: [{ code: "ambiguous_reference", candidates: [{ id: "a" }, { id: "b" }] }] }), "review");
  assert.equal(classifyPortablePreviewAction({ issues: [{ code: "foreign_or_unknown_record_id", candidates: [] }] }), "review");
  assert.equal(classifyPortablePreviewAction({ issues: [{ code: "foreign_or_unknown_reference_id", candidates: [{ id: "a", name: "Media" }] }] }), "review");
  assert.equal(classifyPortablePreviewAction({ issues: [{ code: "foreign_or_unknown_reference_id", candidates: [] }] }), "invalid");
  assert.equal(classifyPortablePreviewAction({ issues: [{ code: "missing_reference" }] }), "invalid");
  assert.equal(classifyPortablePreviewAction({ issues: [{ code: "quote_in_unquoted_value" }] }), "invalid");
  assert.equal(classifyPortablePreviewAction({ issues: [{ code: "duplicate_header" }] }), "invalid");
  assert.equal(classifyPortablePreviewAction({ match: { id: "safe" } }), "update");
  assert.equal(classifyPortablePreviewAction({}), "create");
});

test("schedule export and import preserve local wall-clock dates across time zones", () => {
  const priorTz = process.env.TZ;
  try {
    for (const serverTz of ["UTC", "Pacific/Honolulu"]) {
      process.env.TZ = serverTz;
      for (const [timeZone, date, time, expectedInstant] of [
        ["UTC", "2026-10-03", "20:00", "2026-10-03T20:00:00.000Z"],
        ["America/New_York", "2026-10-03", "20:00", "2026-10-04T00:00:00.000Z"],
        ["America/New_York", "2026-03-08", "20:00", "2026-03-09T00:00:00.000Z"],
      ]) {
        const [row] = buildPortableDatasets({
          services: [{ serviceId: "service-1", name: "Evening", time }],
          schedules: [{ scheduleId: "schedule-1", name: "Sunday", teamId: "team-1", occurrences: [{ occurrenceId: "occurrence-1", serviceId: "service-1", startsAt: expectedInstant }] }],
          teams: [{ teamId: "team-1", name: "Media" }],
        }, { timeZone }).schedules;
        assert.equal(row[4], date);
        assert.equal(row[5], time);
        const parsed = parseCsv(encodeCsv(PORTABLE_SCHEMAS.schedules, [row]));
        const values = parsed.rows[0].values;
        assert.equal(portableWallClockToIso(values.Date, values["Start Time"], timeZone), expectedInstant);
      }
    }
  } finally {
    if (priorTz === undefined) delete process.env.TZ;
    else process.env.TZ = priorTz;
  }
  assert.equal(formatPortableDate("2026-10-04T00:00:00.000Z", "America/New_York"), "2026-10-03");
  assert.equal(formatPortableTime("2026-10-04T00:00:00.000Z", "America/New_York"), "20:00");
});

test("portable wall-clock conversion is timezone-explicit and DST-aware", () => {
  const priorTz = process.env.TZ;
  try {
    for (const serverTz of ["UTC", "Pacific/Honolulu"]) {
      process.env.TZ = serverTz;
      assert.equal(portableWallClockToIso("2026-10-03", "10:00", "America/New_York"), "2026-10-03T14:00:00.000Z");
    }
  } finally {
    if (priorTz === undefined) delete process.env.TZ;
    else process.env.TZ = priorTz;
  }
  assert.equal(portableWallClockToIso("2026-03-08", "02:30", "America/New_York"), "2026-03-08T07:30:00.000Z");
  assert.equal(portableWallClockToIso("2026-02-30", "10:00", "America/New_York"), null);
});

test("portable exports use readable fields and flatten schedules by slot", () => {
  const exported = buildPortableDatasets({
    members: [{ memberId: "m1", firstName: "Sam", lastName: "Doe", positionIds: ["p1"] }],
    teams: [{ teamId: "t1", name: "Worship", memberIds: ["m1"] }],
    positions: [{ positionId: "p1", teamId: "t1", name: "Keys" }],
    services: [{ id: "s1", serviceId: "s1", name: "Sunday", reccurence: "weekly", positionRequirements: [{ positionId: "p1", count: 2 }] }],
    schedules: [{ scheduleId: "sc1", name: "March", teamId: "t1", occurrences: [{ occurrenceId: "s1@2026-03-01T10:00:00.000Z", serviceId: "s1", startsAt: "2026-03-01T10:00:00.000Z", positionRequirements: [{ positionId: "p1", count: 2 }] }], assignments: { "s1@2026-03-01T10:00:00.000Z": { "p1::0": { primaryMemberId: "m1" }, "p1::1": { shadows: [{ memberId: "m1", kind: "shadow" }] } } } }],
  });
  assert.equal(exported.members[0][0], "Sam");
  assert.equal(exported.members[0][6], "Keys");
  assert.equal(exported.members[0][11], "t1");
  assert.equal(exported.members[0][12], "p1");
  assert.equal(exported.schedules.length, 2);
  assert.deepEqual(Object.keys(PORTABLE_SCHEMAS), ["members", "teams", "positions", "services", "schedules"]);
});

test("position CSV preserves legacy names and structured icon references", () => {
  const icon = { source: "tabler", name: "camera", color: "#22d3ee" };
  const exported = buildPortableDatasets({
    teams: [{ teamId: "t1", name: "Production" }],
    positions: [
      { positionId: "p1", teamId: "t1", name: "Vocal", icon: "MicVocal" },
      { positionId: "p2", teamId: "t1", name: "Camera", icon },
    ],
  }).positions;
  assert.equal(PORTABLE_SCHEMAS.positions.at(-1), "Icon");
  assert.equal(exported[0].at(-1), "MicVocal");
  assert.equal(exported[1].at(-1), JSON.stringify(icon));
  assert.equal(parsePortablePositionIcon(exported[0].at(-1)), "MicVocal");
  assert.deepEqual(parsePortablePositionIcon(exported[1].at(-1)), icon);
  assert.equal(serializePortablePositionIcon(undefined), "");
  assert.throws(() => parsePortablePositionIcon("{invalid"), { statusCode: 400 });
});

test("combined service exports retain recurrence details and match on re-import", () => {
  const services = [
    { serviceId: "s1", name: "Morning", reccurence: "weekly", time: "09:00", dayOfWeek: 0, startDateISO: "2026-01-04", serviceGroupId: "combined-1" },
    { serviceId: "s2", name: "Evening", reccurence: "weekly", time: "11:00", dayOfWeek: 0, startDateISO: "2026-01-04", serviceGroupId: "combined-1" },
  ];
  const exported = buildPortableDatasets({ services }).services;
  assert.equal(exported[0][8], "Sunday");
  assert.equal(exported[0][9], "Evening (Sunday 11:00; 2026-01-04) | Morning (Sunday 09:00; 2026-01-04)");
  const imported = {
    recurrence: exported[0][1], time: exported[0][2], date: exported[0][3],
    daysOfWeek: exported[0][4], startDate: exported[0][5], endDate: exported[0][6],
    weekOrdinal: exported[0][7], weekday: exported[0][8], combinedGroup: exported[0][9],
  };
  assert.equal(portableServiceMatches(services[0], imported, services), true);
  assert.equal(portableServiceMatches(services[1], imported, services), false);
});

test("one-time service exports keep their date and time for matching", () => {
  const services = [{ serviceId: "once", name: "Easter", reccurence: "one_time", dateTimeISO: "2026-04-05T09:30:00.000Z" }];
  const [row] = buildPortableDatasets({ services }).services;
  assert.equal(row[2], "09:30");
  assert.equal(row[3], "2026-04-05");
  assert.equal(portableServiceMatches(services[0], { recurrence: "one_time", date: row[3], time: row[2] }, services), true);
  assert.equal(portableServiceMatches(services[0], { recurrence: "one_time", date: row[3], time: "10:30" }, services), false);
});

test("schedule export preserves primary, shadow, reverse-shadow, guest, and combined service rows", () => {
  const services = [
    { serviceId: "s1", name: "Morning", reccurence: "weekly", time: "09:00", serviceGroupId: "combined-1" },
    { serviceId: "s2", name: "Evening", reccurence: "weekly", time: "11:00", serviceGroupId: "combined-1" },
  ];
  const exported = buildPortableDatasets({
    members: [
      { memberId: "m1", firstName: "Primary", lastName: "Person" },
      { memberId: "m2", firstName: "Shadow", lastName: "Person" },
      { memberId: "m3", firstName: "Reverse", lastName: "Person" },
    ],
    teams: [{ teamId: "t1", name: "Worship" }],
    positions: [{ positionId: "p1", teamId: "t1", name: "Keys" }],
    services,
    schedules: [{
      scheduleId: "sc1", name: "May", teamId: "t1", startDate: "2026-05-03", endDate: "2026-05-03",
      guests: [{ guestId: "g1", name: "Guest Person", email: "guest@example.com" }],
      occurrences: [{ occurrenceId: "combined@2026-05-03T09:00:00.000Z", serviceId: "s1", serviceIds: ["s1", "s2"], startsAt: "2026-05-03T09:00:00.000Z", positionRequirements: [{ positionId: "p1", count: 1 }] }],
      assignments: { "combined@2026-05-03T09:00:00.000Z": {
        "p1::0": { primaryMemberId: "m1", shadows: [{ memberId: "m2", kind: "shadow" }, { memberId: "m3", kind: "reverse_shadow" }] },
        "p1::1": { primaryMemberId: "g1" },
      } },
    }],
  });
  assert.equal(exported.schedules.length, 4);
  assert.deepEqual(exported.schedules.map((row) => row[11]), ["primary", "shadow", "reverse_shadow", "primary"]);
  assert.equal(exported.schedules.every((row) => row[3] === "Morning | Evening"), true);
  assert.equal(exported.schedules[3][12], "true");
  assert.equal(exported.schedules[3][10], "guest@example.com");
});

test("ZIP output has standard local and central directory signatures", () => {
  const archive = createZip([{ name: "members.csv", content: "Name\r\nSam\r\n" }]);
  assert.equal(archive.readUInt32LE(0), 0x04034b50);
  assert.equal(archive.readUInt32LE(archive.length - 22), 0x06054b50);
});
