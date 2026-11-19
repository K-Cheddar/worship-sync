import { formatAvailabilityOccurrence } from "./myAvailabilityUtils";

it("formats service date and time in the church timezone", () => {
  expect(formatAvailabilityOccurrence({
    occurrenceId: "service-1",
    name: "New Year's service",
    startsAt: "2025-01-01T01:00:00.000Z",
  }, "Pacific/Honolulu")).toMatch(/Dec 31.*3:00 PM HST/);
});

it("uses the occurrence's plain service date when no timezone is configured", () => {
  expect(formatAvailabilityOccurrence({
    occurrenceId: "service-1@2025-01-01",
    name: "New Year's service",
    startsAt: "2025-01-01T01:00:00.000Z",
    serviceDate: "2025-01-01",
  }, null)).toContain("January 01");
});
