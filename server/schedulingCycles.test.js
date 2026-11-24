import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_AVAILABILITY_RESPONSE_LEAD_DAYS,
  DEFAULT_SCHEDULING_AUTOMATION_SETTINGS,
  SchedulingCycleValidationError,
  firstInstantOfLocalDate,
  normalizeSchedulingAutomationSettings,
  planSchedulingCycle,
  resolveEffectiveSchedulingSettings,
  schedulingActionIdFor,
  schedulingCycleIdFor,
} from "./schedulingCycles.js";

const effective = (settings = DEFAULT_SCHEDULING_AUTOMATION_SETTINGS, configurationRevision = "church:1") => ({
  mode: "inherit",
  enabled: true,
  settings: normalizeSchedulingAutomationSettings(settings),
  configurationRevision,
  source: "church",
});

const plan = (periodId, settings, serviceTimeZone = "America/New_York") => planSchedulingCycle({
  churchId: "church-1",
  teamId: "team-1",
  periodId,
  serviceTimeZone,
  effective: effective(settings),
  createdAt: "2026-01-01T00:00:00.000Z",
  createdBy: "user-1",
});

test("monthly planner calculates the documented default timeline and manual publication", () => {
  const { cycle, actions } = plan("2026-12");
  assert.equal(cycle.periodStart, "2026-12-01");
  assert.equal(cycle.periodEnd, "2026-12-31");
  assert.equal(cycle.deadlines.preparation.localDate, "2026-11-24");
  assert.equal(cycle.deadlines.availabilityRequest.localDate, "2026-11-10");
  assert.equal(cycle.deadlines.availabilityFollowUp.localDate, "2026-11-13");
  assert.equal(cycle.deadlines.leaderSummary.localDate, "2026-11-16");
  assert.equal(cycle.deadlines.availabilityResponse.localDate, "2026-11-21");
  assert.equal(cycle.publicationPolicy, "manual");
  assert.equal(cycle.automationEnabled, false);
  assert.equal(actions.at(-1).actionType, "manual_review_and_publish");
  assert.equal(actions.at(-1).state, "manual");
  assert.equal(actions.filter((action) => action.enabled).length, 0);
});

test("response deadline is configurable and calculated as a calendar-day offset", () => {
  const { cycle, actions } = plan("2026-12", {
    ...DEFAULT_SCHEDULING_AUTOMATION_SETTINGS,
    availabilityResponseLeadDays: 5,
  });
  assert.equal(cycle.effectiveConfiguration.availabilityResponseLeadDays, 5);
  assert.equal(cycle.deadlines.availabilityResponse.localDate, "2026-11-19");
  assert.equal(cycle.deadlines.availabilityResponse.localTime, null);
  assert.equal(cycle.deadlines.availabilityResponse.dueAt, "2026-11-20T05:00:00.000Z");
  const deadlineAction = actions.find((action) => action.actionType === "availability_response_deadline");
  assert.equal(deadlineAction?.dueAt, "2026-11-20T05:00:00.000Z");
  assert.equal(deadlineAction?.localTime, null);
});

test("response windows include the complete church-local deadline date across DST transitions", () => {
  const springStart = firstInstantOfLocalDate("2026-03-08", "America/New_York");
  const springExpiration = firstInstantOfLocalDate("2026-03-09", "America/New_York");
  const fallStart = firstInstantOfLocalDate("2026-11-01", "America/New_York");
  const fallExpiration = firstInstantOfLocalDate("2026-11-02", "America/New_York");
  assert.equal(springExpiration.getTime() - springStart.getTime(), 23 * 60 * 60 * 1000);
  assert.equal(fallExpiration.getTime() - fallStart.getTime(), 25 * 60 * 60 * 1000);

  const spring = plan("2026-04", {
    ...DEFAULT_SCHEDULING_AUTOMATION_SETTINGS,
    preparationDay: 22,
    availabilityRequestLeadDays: 22,
    availabilityResponseLeadDays: 14,
    localExecutionTime: "09:00",
  });
  assert.equal(spring.cycle.deadlines.availabilityResponse.localDate, "2026-03-08");
  assert.equal(spring.cycle.deadlines.availabilityResponse.dueAt, springExpiration.toISOString());
});

test("planner clamps the configured day for short months and handles year boundaries", () => {
  const { cycle: leapCycle } = plan("2024-03", { ...DEFAULT_SCHEDULING_AUTOMATION_SETTINGS, preparationDay: 31 });
  const { cycle: nonLeapCycle } = plan("2025-03", { ...DEFAULT_SCHEDULING_AUTOMATION_SETTINGS, preparationDay: 31 });
  const { cycle: february29Cycle } = plan("2026-03", { ...DEFAULT_SCHEDULING_AUTOMATION_SETTINGS, preparationDay: 29 });
  const { cycle: thirtyDayCycle } = plan("2026-05", { ...DEFAULT_SCHEDULING_AUTOMATION_SETTINGS, preparationDay: 31 });
  const { cycle: thirtyDayTarget } = plan("2026-04", { ...DEFAULT_SCHEDULING_AUTOMATION_SETTINGS, preparationDay: 30 });
  const { cycle: januaryCycle } = plan("2027-01");
  assert.equal(leapCycle.deadlines.preparation.localDate, "2024-02-29");
  assert.equal(nonLeapCycle.deadlines.preparation.localDate, "2025-02-28");
  assert.equal(february29Cycle.deadlines.preparation.localDate, "2026-02-28");
  assert.equal(thirtyDayCycle.deadlines.preparation.localDate, "2026-04-30");
  assert.equal(thirtyDayTarget.deadlines.preparation.localDate, "2026-03-30");
  assert.equal(januaryCycle.deadlines.preparation.localDate, "2026-12-24");
});

test("planner uses calendar days and church-local timestamps across daylight-saving changes", () => {
  const { cycle } = plan("2026-12", {
    ...DEFAULT_SCHEDULING_AUTOMATION_SETTINGS,
    preparationDay: 15,
    localExecutionTime: "01:30",
  });
  const request = cycle.deadlines.availabilityRequest;
  assert.equal(request.localDate, "2026-11-01");
  // The fall fold deliberately follows existing service conversion behavior: the earlier instant.
  assert.equal(request.dueAt, "2026-11-01T05:30:00.000Z");

  const { cycle: pacificCycle } = plan("2026-12", {
    ...DEFAULT_SCHEDULING_AUTOMATION_SETTINGS,
    preparationDay: 15,
    localExecutionTime: "01:30",
  }, "America/Los_Angeles");
  assert.equal(pacificCycle.deadlines.availabilityRequest.localDate, request.localDate);
  assert.equal(pacificCycle.deadlines.availabilityRequest.dueAt, "2026-11-01T08:30:00.000Z");
});

test("planner reports a local execution time that falls in a spring-forward gap", () => {
  assert.throws(() => plan("2026-04", {
    ...DEFAULT_SCHEDULING_AUTOMATION_SETTINGS,
    preparationDay: 22,
    localExecutionTime: "02:30",
  }), (error) => error instanceof SchedulingCycleValidationError && /does not occur/.test(error.message));
});

test("settings validation rejects contradictory timing and unsupported publication policies", () => {
  assert.throws(() => normalizeSchedulingAutomationSettings({
    ...DEFAULT_SCHEDULING_AUTOMATION_SETTINGS,
    availabilityRequestLeadDays: 8,
  }), /early enough/);
  assert.throws(() => normalizeSchedulingAutomationSettings({
    ...DEFAULT_SCHEDULING_AUTOMATION_SETTINGS,
    availabilityResponseLeadDays: 0,
  }), /Availability response deadline/);
  assert.throws(() => normalizeSchedulingAutomationSettings({
    ...DEFAULT_SCHEDULING_AUTOMATION_SETTINGS,
    availabilityResponseLeadDays: 9,
  }), /early enough/);
  assert.throws(() => normalizeSchedulingAutomationSettings({
    ...DEFAULT_SCHEDULING_AUTOMATION_SETTINGS,
    publicationPolicy: "automatic",
  }), /must remain manual/);
  assert.throws(() => plan("2026-13"), /valid monthly schedule period/);
  assert.throws(() => plan("2026-12", DEFAULT_SCHEDULING_AUTOMATION_SETTINGS, "Not/A_Timezone"), /valid church timezone/);
  assert.equal(DEFAULT_AVAILABILITY_RESPONSE_LEAD_DAYS, 3);
});

test("cycle and action identities are stable, scoped, and deterministic", () => {
  const identity = { churchId: "church-1", teamId: "team-1", periodId: "2026-12" };
  const id = schedulingCycleIdFor(identity);
  assert.equal(id, schedulingCycleIdFor(identity));
  assert.notEqual(id, schedulingCycleIdFor({ ...identity, teamId: "team-2" }));
  assert.notEqual(id, schedulingCycleIdFor({ ...identity, periodId: "2027-01" }));
  assert.equal(schedulingActionIdFor(id, "availability_request"), schedulingActionIdFor(id, "availability_request"));
  assert.notEqual(schedulingActionIdFor(id, "availability_request"), schedulingActionIdFor(id, "leader_summary"));
});

test("team modes resolve overrides explicitly and retain inherited defaults", () => {
  const defaults = { settings: DEFAULT_SCHEDULING_AUTOMATION_SETTINGS, revision: 2 };
  const inherited = resolveEffectiveSchedulingSettings({ defaults, override: { mode: "inherit", revision: 3 } });
  const customized = resolveEffectiveSchedulingSettings({ defaults, override: {
    mode: "customize", revision: 4,
    settings: { ...DEFAULT_SCHEDULING_AUTOMATION_SETTINGS, preparationDay: 20 },
  } });
  const disabled = resolveEffectiveSchedulingSettings({ defaults, override: { mode: "disabled", revision: 5 } });
  assert.equal(inherited.settings.preparationDay, 24);
  assert.equal(inherited.source, "church");
  assert.equal(customized.settings.preparationDay, 20);
  assert.equal(customized.source, "team");
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.source, "disabled");
});
