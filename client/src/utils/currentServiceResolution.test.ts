import type { TeamScheduleOccurrence } from "../api/authTypes";
import {
  resolveCurrentServiceOccurrence,
  type CurrentServiceResolutionReason,
} from "./currentServiceResolution";

const occurrence = (
  occurrenceId: string,
  startsAt: string,
): TeamScheduleOccurrence => ({
  occurrenceId,
  serviceId: occurrenceId,
  name: occurrenceId,
  startsAt,
});

const resolved = (
  occurrences: TeamScheduleOccurrence[],
  nowMs: number,
): { occurrenceId: string | null; reason: CurrentServiceResolutionReason } => {
  const result = resolveCurrentServiceOccurrence(occurrences, nowMs);
  return {
    occurrenceId: result.occurrence?.occurrenceId ?? null,
    reason: result.reason,
  };
};

describe("resolveCurrentServiceOccurrence", () => {
  it("prefers the most recently started service that is still in progress", () => {
    const now = Date.parse("2026-09-13T11:00:00.000Z");

    expect(
      resolved(
        [
          occurrence("morning", "2026-09-13T09:00:00.000Z"),
          occurrence("late-morning", "2026-09-13T10:30:00.000Z"),
        ],
        now,
      ),
    ).toEqual({ occurrenceId: "late-morning", reason: "in-progress" });
  });

  it("hands off to an adjacent service as soon as that service starts", () => {
    const now = Date.parse("2026-09-13T12:00:00.000Z");

    expect(
      resolved(
        [
          occurrence("morning", "2026-09-13T09:00:00.000Z"),
          occurrence("noon", "2026-09-13T12:00:00.000Z"),
        ],
        now,
      ),
    ).toEqual({ occurrenceId: "noon", reason: "in-progress" });
  });

  it("selects the next service today when nothing is in progress", () => {
    const now = Date.parse("2026-09-13T08:00:00.000Z");

    expect(
      resolved(
        [
          occurrence("later", "2026-09-13T12:00:00.000Z"),
          occurrence("tomorrow", "2026-09-14T09:00:00.000Z"),
        ],
        now,
      ),
    ).toEqual({ occurrenceId: "later", reason: "upcoming-today" });
  });

  it("keeps a recently ended service available during the short grace window", () => {
    const now = Date.parse("2026-09-13T10:00:00.000Z");

    expect(
      resolved(
        [occurrence("ended", "2026-09-13T06:30:00.000Z")],
        now,
      ),
    ).toEqual({ occurrenceId: "ended", reason: "recently-ended" });
  });

  it("uses the next future service when today has no remaining service", () => {
    const now = Date.parse("2026-09-13T18:00:00.000Z");

    expect(
      resolved(
        [occurrence("next-week", "2026-09-20T10:00:00.000Z")],
        now,
      ),
    ).toEqual({ occurrenceId: "next-week", reason: "upcoming" });
  });

  it("stops showing a completed service after the grace window", () => {
    const now = Date.parse("2026-09-13T12:00:00.000Z");

    expect(
      resolved(
        [occurrence("ended", "2026-09-13T06:30:00.000Z")],
        now,
      ),
    ).toEqual({ occurrenceId: null, reason: "none" });
  });

  it("does not invent a current service when the schedule is empty", () => {
    expect(
      resolved([], Date.parse("2026-09-13T18:00:00.000Z")),
    ).toEqual({ occurrenceId: null, reason: "none" });
  });

  it("resolves equal-time candidates deterministically", () => {
    const now = Date.parse("2026-09-13T08:00:00.000Z");

    expect(
      resolved(
        [
          occurrence("z-service", "2026-09-13T12:00:00.000Z"),
          occurrence("a-service", "2026-09-13T12:00:00.000Z"),
        ],
        now,
      ),
    ).toEqual({ occurrenceId: "a-service", reason: "upcoming-today" });
  });
});
