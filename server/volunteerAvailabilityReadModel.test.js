import test from "node:test";
import assert from "node:assert/strict";
import {
  getVolunteerAvailabilityCurrentDate,
  isVolunteerAvailabilityFormCurrent,
  mapVolunteerAvailabilityReads,
  VOLUNTEER_AVAILABILITY_READ_CONCURRENCY,
} from "./volunteerAvailabilityReadModel.js";

test("availability request deadlines use the church calendar date and include that date", () => {
  const now = new Date("2026-11-20T02:00:00.000Z");
  const currentDate = getVolunteerAvailabilityCurrentDate("America/New_York", now);
  assert.equal(currentDate, "2026-11-19");
  assert.equal(isVolunteerAvailabilityFormCurrent({
    active: true,
    responseDeadline: "2026-11-19",
  }, currentDate), true);
  assert.equal(isVolunteerAvailabilityFormCurrent({
    active: true,
    responseDeadline: "2026-11-18",
  }, currentDate), false);
});

test("availability request reads use legacy end dates and exclude inactive or archived forms", () => {
  assert.equal(isVolunteerAvailabilityFormCurrent({
    active: true,
    endDate: "2026-11-20",
  }, "2026-11-20"), true);
  assert.equal(isVolunteerAvailabilityFormCurrent({
    active: true,
    endDate: "2026-11-19",
  }, "2026-11-20"), false);
  assert.equal(isVolunteerAvailabilityFormCurrent({
    active: false,
    responseDeadline: "2026-12-20",
  }, "2026-11-20"), false);
  assert.equal(isVolunteerAvailabilityFormCurrent({
    active: true,
    archivedAt: "2026-11-01",
    responseDeadline: "2026-12-20",
  }, "2026-11-20"), false);
});

test("availability read batches keep concurrent database work bounded", async () => {
  let activeReads = 0;
  let maxConcurrentReads = 0;
  const values = Array.from({ length: 19 }, (_, index) => index);
  const results = await mapVolunteerAvailabilityReads(values, async (value) => {
    activeReads += 1;
    maxConcurrentReads = Math.max(maxConcurrentReads, activeReads);
    await new Promise((resolve) => setImmediate(resolve));
    activeReads -= 1;
    return value * 2;
  });
  assert.deepEqual(results, values.map((value) => value * 2));
  assert.equal(maxConcurrentReads, VOLUNTEER_AVAILABILITY_READ_CONCURRENCY);
});
