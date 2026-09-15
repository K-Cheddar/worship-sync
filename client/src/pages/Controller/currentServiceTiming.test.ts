import type { TeamScheduleOccurrence } from "../../api/authTypes";
import type { ServiceTime } from "../../types";
import { EMPTY_RICH_TEXT } from "../../types/richText";
import type { ServicePlanSection } from "../../types/servicePlan";
import { serverDate, setServerTimeOffset } from "../../utils/serverTime";
import {
  formatCurrentServiceOvertime,
  resolveCurrentServiceTimingState,
  resolveOccurrenceServiceStarts,
} from "./currentServiceTiming";
import {
  resolveServicePlanEndMs,
  type ServicePlanTimingSource,
} from "../Services/servicePlanTimingUtils";

const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

const localAt = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0,
): number => new Date(year, month - 1, day, hour, minute).getTime();

const service = (overrides: Partial<ServiceTime> = {}): ServiceTime => ({
  id: "service-1",
  name: "Sunday Worship",
  timerType: "countdown",
  reccurence: "weekly",
  dayOfWeek: 0,
  time: "09:00",
  ...overrides,
});

const occurrence = (
  startsAtMs: number,
  overrides: Partial<TeamScheduleOccurrence> = {},
): TeamScheduleOccurrence => ({
  occurrenceId: `occurrence-${startsAtMs}`,
  serviceId: "service-1",
  name: "Sunday Worship",
  startsAt: new Date(startsAtMs).toISOString(),
  ...overrides,
});

const planSection = (
  id: string,
  elements: Array<{
    id: string;
    startTime?: string;
    durationSeconds?: number;
    durationMinutes?: number;
  }>,
): ServicePlanSection => ({
  id,
  name: id,
  elements: elements.map((element) => ({
    id: element.id,
    type: "free",
    title: EMPTY_RICH_TEXT,
    ...element,
  })),
});

const plan = (
  startsAtMs: number,
  sections: ServicePlanSection[],
  overrides: Partial<ServicePlanTimingSource> = {},
): ServicePlanTimingSource => ({
  planKey: "service-1@2026-07-26",
  startsAt: new Date(startsAtMs).toISOString(),
  timezone,
  sections,
  ...overrides,
});

const stateAt = ({
  selectedOccurrence,
  services,
  timingPlan,
  nowMs,
}: {
  selectedOccurrence: TeamScheduleOccurrence;
  services: ServiceTime[];
  timingPlan?: ServicePlanTimingSource | null;
  nowMs: number;
}) =>
  resolveCurrentServiceTimingState({
    occurrence: selectedOccurrence,
    occurrenceServices: services,
    plan: timingPlan,
    nowMs,
  });

describe("resolveOccurrenceServiceStarts", () => {
  const selectedDate = localAt(2026, 7, 26, 9);

  it("resolves weekly, multi-weekly, monthly, and one-time starts on the selected date", () => {
    const services = [
      service({ id: "weekly", time: "09:00" }),
      service({
        id: "multi",
        name: "Multi",
        reccurence: "multi_weekly",
        daysOfWeek: [{ day: 0, time: "10:00" }],
      }),
      service({
        id: "monthly",
        name: "Monthly",
        reccurence: "monthly",
        ordinal: 4,
        weekday: 0,
        time: "11:00",
      }),
      service({
        id: "one-time",
        name: "One time",
        reccurence: "one_time",
        dateTimeISO: new Date(localAt(2026, 7, 26, 12)).toISOString(),
      }),
    ];
    const selected = occurrence(selectedDate, {
      serviceId: "weekly",
      serviceIds: services.map(({ id }) => id),
    });

    expect(
      resolveOccurrenceServiceStarts(selected, services).map(({ service: item, targetMs }) => [
        item.id,
        targetMs,
      ]),
    ).toEqual([
      ["weekly", localAt(2026, 7, 26, 9)],
      ["multi", localAt(2026, 7, 26, 10)],
      ["monthly", localAt(2026, 7, 26, 11)],
      ["one-time", localAt(2026, 7, 26, 12)],
    ]);
  });

  it("keeps recurring starts on the selected date and never resolves next week", () => {
    const selected = occurrence(selectedDate, {
      serviceId: "service-1",
    });
    const starts = resolveOccurrenceServiceStarts(
      selected,
      [service({ time: "09:00" })],
    );

    expect(starts[0]?.targetMs).toBe(selectedDate);

    expect(
      stateAt({
        selectedOccurrence: selected,
        services: [service({ time: "09:00" })],
        nowMs: localAt(2026, 8, 2, 9),
      }),
    ).toEqual({ type: "live" });
  });

  it("keeps a manual occurrence date even when the current clock is later", () => {
    const selected = occurrence(localAt(2026, 7, 19, 9));
    const starts = resolveOccurrenceServiceStarts(
      selected,
      [service({ time: "09:00" })],
    );

    expect(starts[0]?.targetMs).toBe(localAt(2026, 7, 19, 9));
  });

  it("keeps a future override that crosses midnight in the selected occurrence", () => {
    const scheduledStart = localAt(2026, 7, 26, 23, 58);
    const overrideStart = localAt(2026, 7, 27, 0, 3);
    const selected = occurrence(scheduledStart);
    const adjusted = service({
      time: "23:58",
      overrideDateTimeISO: new Date(overrideStart).toISOString(),
    });

    expect(
      resolveOccurrenceServiceStarts(selected, [adjusted], scheduledStart + 1_000),
    ).toEqual([{ service: adjusted, targetMs: overrideStart }]);
    expect(
      stateAt({
        selectedOccurrence: selected,
        services: [adjusted],
        nowMs: scheduledStart + 1_000,
      }),
    ).toEqual({
      type: "upcoming-service",
      service: adjusted,
      targetMs: overrideStart,
    });
  });
});

describe("resolveServicePlanEndMs", () => {
  const startsAtMs = localAt(2026, 7, 26, 10);

  it("uses the real plan timeline when it begins before the official occurrence", () => {
    const sections = [
      planSection("pre-service", [
        { id: "welcome", startTime: "09:45", durationMinutes: 15 },
      ]),
      planSection("service", [
        { id: "worship", startTime: "10:00", durationSeconds: 1_800 },
      ]),
    ];

    expect(resolveServicePlanEndMs(plan(startsAtMs, sections))).toBe(
      localAt(2026, 7, 26, 10, 30),
    );
  });

  it("prefers durationSeconds and supports legacy durationMinutes", () => {
    expect(
      resolveServicePlanEndMs(
        plan(startsAtMs, [
          planSection("seconds", [
            {
              id: "seconds",
              startTime: "10:00",
              durationSeconds: 90,
              durationMinutes: 99,
            },
          ]),
        ]),
      ),
    ).toBe(localAt(2026, 7, 26, 10) + 90_000);
    expect(
      resolveServicePlanEndMs(
        plan(startsAtMs, [
          planSection("minutes", [
            { id: "minutes", startTime: "10:00", durationMinutes: 5 },
          ]),
        ]),
      ),
    ).toBe(
      localAt(2026, 7, 26, 10, 5),
    );
  });

  it("flattens sections and skips invalid or untimed elements", () => {
    const sections = [
      planSection("first", [
        { id: "valid", startTime: "10:00", durationMinutes: 10 },
      ]),
      planSection("second", [
        { id: "bad-start", startTime: "not-a-time", durationMinutes: 99 },
        { id: "bad-duration", startTime: "10:15", durationMinutes: -1 },
      ]),
    ];

    expect(resolveServicePlanEndMs(plan(startsAtMs, sections))).toBe(
      localAt(2026, 7, 26, 10, 10),
    );
    expect(
      resolveServicePlanEndMs(
        plan(startsAtMs, [planSection("empty", [{ id: "none" }])]),
      ),
    ).toBeNull();
  });

  it("uses the occurrence start as a fallback when a legacy plan omits startsAt", () => {
    expect(
      resolveServicePlanEndMs(
        plan(startsAtMs, [
          planSection("service", [
            { id: "item", startTime: "10:00", durationMinutes: 30 },
          ]),
        ], { startsAt: undefined }),
        startsAtMs,
      ),
    ).toBe(localAt(2026, 7, 26, 10, 30));
  });
});

describe("resolveCurrentServiceTimingState", () => {
  afterEach(() => {
    setServerTimeOffset(0);
    jest.useRealTimers();
  });

  const startsAtMs = localAt(2026, 7, 26, 9);
  const selected = occurrence(startsAtMs);
  const validPlan = plan(startsAtMs, [
    planSection("service", [
      { id: "item", startTime: "09:00", durationMinutes: 60 },
    ]),
  ]);

  it("counts down to a single future service", () => {
    const state = stateAt({
      selectedOccurrence: selected,
      services: [service()],
      timingPlan: validPlan,
      nowMs: localAt(2026, 7, 26, 8, 30),
    });

    expect(state).toEqual({
      type: "upcoming-service",
      service: service(),
      targetMs: startsAtMs,
    });
  });

  it("counts down to a valid plan end once a single service starts", () => {
    expect(
      stateAt({
        selectedOccurrence: selected,
        services: [service()],
        timingPlan: validPlan,
        nowMs: localAt(2026, 7, 26, 9, 30),
      }),
    ).toEqual({ type: "service-ending", targetMs: localAt(2026, 7, 26, 10) });
  });

  it("switches to overtime at the exact end and derives elapsed time absolutely", () => {
    const endMs = localAt(2026, 7, 26, 10);
    expect(
      stateAt({
        selectedOccurrence: selected,
        services: [service()],
        timingPlan: validPlan,
        nowMs: endMs,
      }),
    ).toEqual({ type: "overtime", targetMs: endMs });
    expect(formatCurrentServiceOvertime(endMs, endMs)).toBe("00:00");
    expect(formatCurrentServiceOvertime(endMs, endMs + 5 * 60_000)).toBe("05:00");
    expect(formatCurrentServiceOvertime(endMs, endMs + 65 * 60_000)).toBe("1:05:00");
  });

  it("uses the next same-day member start before the plan end", () => {
    const second = service({ id: "second", name: "Contemporary Service", time: "11:00" });
    const grouped = occurrence(startsAtMs, {
      groupId: "sunday",
      serviceIds: ["service-1", "second"],
    });
    const groupedPlan = plan(startsAtMs, [
      planSection("service", [
        { id: "item", startTime: "09:00", durationMinutes: 240 },
      ]),
    ]);

    expect(
      stateAt({
        selectedOccurrence: grouped,
        services: [service(), second],
        timingPlan: groupedPlan,
        nowMs: localAt(2026, 7, 26, 8),
      }),
    ).toEqual({
      type: "upcoming-service",
      service: service(),
      targetMs: startsAtMs,
    });
    expect(
      stateAt({
        selectedOccurrence: grouped,
        services: [service(), second],
        timingPlan: groupedPlan,
        nowMs: localAt(2026, 7, 26, 10),
      }),
    ).toEqual({
      type: "upcoming-service",
      service: second,
      targetMs: localAt(2026, 7, 26, 11),
    });
    expect(
      stateAt({
        selectedOccurrence: grouped,
        services: [service(), second],
        timingPlan: groupedPlan,
        nowMs: localAt(2026, 7, 26, 12),
      }),
    ).toEqual({
      type: "service-ending",
      targetMs: localAt(2026, 7, 26, 13),
    });
    expect(
      stateAt({
        selectedOccurrence: grouped,
        services: [service(), second],
        timingPlan: groupedPlan,
        nowMs: localAt(2026, 7, 26, 13, 5),
      }),
    ).toEqual({
      type: "overtime",
      targetMs: localAt(2026, 7, 26, 13),
    });
  });

  it("always chooses the next of three grouped services chronologically", () => {
    const services = [
      service({ id: "first", time: "09:00" }),
      service({ id: "second", name: "Second", time: "11:00" }),
      service({ id: "third", name: "Third", time: "13:00" }),
    ];
    const grouped = occurrence(startsAtMs, {
      groupId: "sunday",
      serviceIds: services.map(({ id }) => id),
    });

    expect(
      stateAt({
        selectedOccurrence: grouped,
        services,
        nowMs: localAt(2026, 7, 26, 12),
      }),
    ).toMatchObject({
      type: "upcoming-service",
      service: services[2],
      targetMs: localAt(2026, 7, 26, 13),
    });
  });

  it("shows Live when the plan has no reliable end timing", () => {
    expect(
      stateAt({
        selectedOccurrence: selected,
        services: [service()],
        timingPlan: plan(startsAtMs, [
          planSection("service", [{ id: "untimed", startTime: "09:00" }]),
        ]),
        nowMs: localAt(2026, 7, 26, 9, 30),
      }),
    ).toEqual({ type: "live" });
  });

  it("keeps pre-service plan timing from replacing the official start countdown", () => {
    const officialStart = localAt(2026, 7, 26, 10);
    const selectedOfficialOccurrence = occurrence(officialStart, {
      name: "Sunday Worship",
    });
    const preServicePlan = plan(officialStart, [
      planSection("pre-service", [
        { id: "welcome", startTime: "09:45", durationMinutes: 15 },
        { id: "service", startTime: "10:00", durationMinutes: 30 },
      ]),
    ]);

    expect(
      stateAt({
        selectedOccurrence: selectedOfficialOccurrence,
        services: [service({ time: "10:00" })],
        timingPlan: preServicePlan,
        nowMs: localAt(2026, 7, 26, 9, 50),
      }),
    ).toMatchObject({ type: "upcoming-service", targetMs: officialStart });
  });

  it("uses the server-adjusted absolute clock rather than accumulated local ticks", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(localAt(2026, 7, 26, 8, 30)));
    setServerTimeOffset(30_000 * 60);

    expect(serverDate().getTime()).toBe(localAt(2026, 7, 26, 9));
    expect(
      stateAt({
        selectedOccurrence: selected,
        services: [service()],
        timingPlan: validPlan,
        nowMs: serverDate().getTime(),
      }),
    ).toEqual({
      type: "service-ending",
      targetMs: localAt(2026, 7, 26, 10),
    });
  });
});
