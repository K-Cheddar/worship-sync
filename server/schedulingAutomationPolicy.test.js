import test from "node:test";
import assert from "node:assert/strict";
import { evaluateAvailabilityRequestTiming } from "../shared/schedulingAutomationPolicy.ts";

const call = (overrides = {}) => evaluateAvailabilityRequestTiming({
  dueAt: "2026-11-10T15:00:00.000Z",
  responseExpiresAt: "2026-11-16T05:00:00.000Z",
  responseDeadlineLocalDate: "2026-11-15",
  serviceTimeZone: "America/New_York",
  activationAt: "2026-11-01T00:00:00.000Z",
  now: new Date("2026-11-10T15:00:00.000Z"),
  ...overrides,
});

test("short configured response windows are honored on schedule and during ordinary delay", () => {
  assert.equal(call().status, "on_time");
  const delayed = call({ now: new Date("2026-11-11T14:59:59.000Z"),
    responseExpiresAt: "2026-11-12T05:00:00.000Z", responseDeadlineLocalDate: "2026-11-11" });
  assert.equal(delayed.eligible, true);
  assert.equal(delayed.status, "on_time");
});

test("late catch-up requires seven church-local calendar days remaining after the 24-hour grace", () => {
  const enough = call({ now: new Date("2026-11-11T16:00:00.000Z"),
    responseExpiresAt: "2026-11-21T05:00:00.000Z", responseDeadlineLocalDate: "2026-11-20" });
  assert.deepEqual([enough.eligible, enough.status], [true, "catch_up"]);
  const tooLate = call({ now: new Date("2026-11-11T16:00:00.000Z"),
    responseExpiresAt: "2026-11-17T05:00:00.000Z", responseDeadlineLocalDate: "2026-11-16" });
  assert.deepEqual([tooLate.eligible, tooLate.status], [false, "review_required"]);
});

test("expired windows and activation after the request date fail closed", () => {
  const expired = call({ now: new Date("2026-11-16T05:00:00.000Z") });
  assert.equal(expired.status, "expired");
  const activatedLate = call({ activationAt: "2026-11-11T00:00:00.000Z" });
  assert.equal(activatedLate.status, "review_required");
});

test("catch-up date arithmetic remains calendar-based across daylight-saving transitions", () => {
  const springForward = call({
    dueAt: "2026-03-07T14:00:00.000Z",
    activationAt: "2026-03-01T00:00:00.000Z",
    now: new Date("2026-03-08T15:00:00.000Z"),
    responseExpiresAt: "2026-03-16T04:00:00.000Z",
    responseDeadlineLocalDate: "2026-03-15",
  });
  assert.equal(springForward.status, "catch_up");
});
