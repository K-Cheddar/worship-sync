import type { TeamService } from "../../api/authTypes";
import {
  buildIntakeAvailabilityServiceOptions,
  formatShortOccurrenceDate,
} from "./teamsUtils";

const service = (overrides: Partial<TeamService>): TeamService => ({
  id: overrides.serviceId || "service",
  serviceId: overrides.serviceId || "service",
  churchId: "church-1",
  name: "Service",
  timerType: "countdown",
  reccurence: "weekly",
  dayOfWeek: 0,
  time: "10:00",
  ...overrides,
});

describe("formatShortOccurrenceDate", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("formats a short date and time separated by @", () => {
    jest
      .spyOn(Date.prototype, "toLocaleDateString")
      .mockReturnValue("Wed, Jul 1, 2026");
    jest.spyOn(Date.prototype, "toLocaleTimeString").mockReturnValue("7:00 PM");

    expect(formatShortOccurrenceDate("2026-07-01T19:00:00")).toBe(
      "Wed, Jul 1, 2026 @ 7:00 PM",
    );
  });
});

describe("buildIntakeAvailabilityServiceOptions", () => {
  it("groups linked services into one availability option with all service ids", () => {
    const options = buildIntakeAvailabilityServiceOptions([
      service({
        serviceId: "first",
        name: "First Service",
        time: "09:00",
        serviceGroupId: "sunday-am",
      }),
      service({
        serviceId: "second",
        name: "Second Service",
        time: "11:00",
        serviceGroupId: "sunday-am",
      }),
      service({
        serviceId: "evening",
        name: "Evening Service",
        time: "18:00",
      }),
    ]);

    expect(options).toHaveLength(2);
    expect(options[0]).toEqual(
      expect.objectContaining({
        id: "group:sunday-am",
        label: "First Service & Second Service",
        serviceIds: ["first", "second"],
      }),
    );
    expect(options[1]).toEqual(
      expect.objectContaining({
        id: "evening",
        label: "Evening Service",
        serviceIds: ["evening"],
      }),
    );
  });

  it("keeps a service with an orphaned group id as its own option", () => {
    const options = buildIntakeAvailabilityServiceOptions([
      service({
        serviceId: "first",
        name: "First Service",
        serviceGroupId: "sunday-am",
      }),
    ]);

    expect(options).toEqual([
      expect.objectContaining({
        id: "first",
        label: "First Service",
        serviceIds: ["first"],
      }),
    ]);
  });
});
