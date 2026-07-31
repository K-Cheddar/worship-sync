import type { TeamService } from "../../api/authTypes";
import { findCurrentServiceOccurrence } from "./currentServiceWorkspaceUtils";

const service = (serviceId: string, dateTimeISO: string): TeamService => ({
  id: serviceId,
  serviceId,
  churchId: "church-1",
  name: serviceId,
  timerType: "countdown",
  reccurence: "one_time",
  dateTimeISO,
});

describe("findCurrentServiceOccurrence", () => {
  it("keeps an in-progress service selected before moving to a later one", () => {
    const occurrence = findCurrentServiceOccurrence([
      service("morning", "2026-07-26T09:00:00.000Z"),
      service("evening", "2026-07-26T18:00:00.000Z"),
    ], Date.parse("2026-07-26T10:30:00.000Z"));

    expect(occurrence?.serviceId).toBe("morning");
  });

  it("selects the next service after the current-service window ends", () => {
    const occurrence = findCurrentServiceOccurrence([
      service("morning", "2026-07-26T09:00:00.000Z"),
      service("evening", "2026-07-26T18:00:00.000Z"),
    ], Date.parse("2026-07-26T13:00:00.000Z"));

    expect(occurrence?.serviceId).toBe("evening");
  });
});
