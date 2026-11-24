import { hasUnavailableAvailabilityAnswer } from "./serviceAvailability";

const occurrence = {
  occurrenceId: "group:sabbath@2026-11-07",
  serviceId: "sabbath-main",
  serviceIds: ["sabbath-main", "sabbath-second"],
  groupId: "sabbath",
  serviceDate: "2026-11-07",
  startsAt: "2026-11-07T14:00:00.000Z",
};

it("recognizes exact saved individual answers for a combined schedule occurrence", () => {
  expect(hasUnavailableAvailabilityAnswer({
    serviceAvailability: { "sabbath-main@2026-11-07": "unavailable" },
  }, occurrence, "America/New_York")).toBe(true);
});

it("keeps unrelated same-day service answers independent", () => {
  expect(hasUnavailableAvailabilityAnswer({
    serviceAvailability: { "independent-service@2026-11-07": "unavailable" },
  }, occurrence, "America/New_York")).toBe(false);
});

it("keeps direct answers and ignores grouped aliases for standalone occurrences", () => {
  expect(hasUnavailableAvailabilityAnswer({
    serviceAvailability: { [occurrence.occurrenceId]: "unavailable" },
  }, occurrence, "America/New_York")).toBe(true);
  expect(hasUnavailableAvailabilityAnswer({
    serviceAvailability: { "sabbath-main@2026-11-07": "unavailable" },
  }, { ...occurrence, groupId: undefined }, "America/New_York")).toBe(false);
});
