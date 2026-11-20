import {
  createAvailabilityCheckboxSubmission,
  formatAvailabilityOccurrence,
  formatAvailabilityOccurrenceTime,
  formatAvailabilityRequestDateRange,
  getAvailabilityRequestGroup,
  getAvailabilityRequestStatus,
  hasAvailabilityResponseSubmission,
  isAvailabilityOccurrencePast,
  organizeAvailabilityOccurrences,
  setAvailabilityChoice,
} from "./myAvailabilityUtils";
import type { VolunteerAvailabilityRequest } from "./myScheduleOperations";

const makeRequest = (overrides: Partial<VolunteerAvailabilityRequest> = {}): VolunteerAvailabilityRequest => ({
  recipientId: "recipient-1",
  formId: "form-1",
  name: "November availability",
  responseDeadline: "2026-11-30",
  availabilityMessage: "",
  respondedAt: "",
  submissionId: "",
  editable: true,
  occurrences: [
    { occurrenceId: "service-a@2026-11-08", name: "Morning service", startsAt: "2026-11-08T14:00:00.000Z", serviceDate: "2026-11-08" },
    { occurrenceId: "service-b@2026-11-22", name: "Evening service", startsAt: "2026-11-22T22:00:00.000Z", serviceDate: "2026-11-22" },
  ],
  availability: {},
  unansweredOccurrenceIds: ["service-a@2026-11-08", "service-b@2026-11-22"],
  availabilityRevision: { "service-a@2026-11-08": 0, "service-b@2026-11-22": 0 },
  ...overrides,
});

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

it("formats only the service time for cards grouped under a date heading", () => {
  expect(formatAvailabilityOccurrenceTime({
    occurrenceId: "service-1@2026-11-07",
    name: "Sabbath Service",
    startsAt: "2026-11-07T14:00:00.000Z",
    serviceDate: "2026-11-07",
  }, "America/New_York")).toMatch(/^9:00 AM EST$/);
  expect(formatAvailabilityOccurrenceTime({
    occurrenceId: "service-1@2026-11-07",
    name: "Sabbath Service",
    startsAt: "2026-11-07T14:00:00.000Z",
    serviceDate: "2026-11-07",
  }, null)).toBe("");
});

it("marks occurrences past by their start instant without imposing a save rule", () => {
  const occurrence = {
    occurrenceId: "service-1@2026-11-07",
    name: "Sabbath Service",
    startsAt: "2026-11-07T14:00:00.000Z",
    serviceDate: "2026-11-07",
  };
  expect(isAvailabilityOccurrencePast(occurrence, Date.parse("2026-11-07T14:01:00.000Z"))).toBe(true);
  expect(isAvailabilityOccurrencePast(occurrence, Date.parse("2026-11-07T13:59:00.000Z"))).toBe(false);
  expect(isAvailabilityOccurrencePast({ ...occurrence, startsAt: "invalid" }, Date.now())).toBe(false);
});

it("uses submission metadata rather than saved answers to determine response status", () => {
  const unsubmittedWithLegacyAnswers = makeRequest({
    availability: { "service-a@2026-11-08": "available" },
    unansweredOccurrenceIds: ["service-b@2026-11-22"],
  });
  expect(hasAvailabilityResponseSubmission(unsubmittedWithLegacyAnswers)).toBe(false);
  expect(getAvailabilityRequestGroup(unsubmittedWithLegacyAnswers)).toBe("needs-response");
  expect(getAvailabilityRequestStatus(unsubmittedWithLegacyAnswers)).toBe("Not yet submitted");

  const submittedPartial = makeRequest({
    submissionId: "submission-1",
    availability: { "service-a@2026-11-08": "available" },
    unansweredOccurrenceIds: ["service-b@2026-11-22"],
  });
  expect(getAvailabilityRequestGroup(submittedPartial)).toBe("submitted-responses");
  expect(getAvailabilityRequestStatus(submittedPartial)).toBe("Response submitted · 1 unanswered");
});

it("places closed requests in one group and distinguishes their response history", () => {
  const closedWithoutResponse = makeRequest({ editable: false });
  const closedWithResponse = makeRequest({ editable: false, respondedAt: "2026-11-01T12:00:00.000Z" });

  expect(getAvailabilityRequestGroup(closedWithoutResponse)).toBe("closed");
  expect(hasAvailabilityResponseSubmission(closedWithoutResponse)).toBe(false);
  expect(getAvailabilityRequestGroup(closedWithResponse)).toBe("closed");
  expect(hasAvailabilityResponseSubmission(closedWithResponse)).toBe(true);
});

it("only turns unchecked services into unavailable when checkbox intent is finalized", () => {
  const availability = { "service-a@2026-11-08": "available" as const };
  expect(createAvailabilityCheckboxSubmission(
    ["service-a@2026-11-08", "service-b@2026-11-22"],
    availability,
  )).toEqual({
    "service-a@2026-11-08": "available",
    "service-b@2026-11-22": "unavailable",
  });
  expect(setAvailabilityChoice(availability, "service-a@2026-11-08", "not-answered"))
    .toEqual({});
});

it("shows a compact date range from church service dates", () => {
  expect(formatAvailabilityRequestDateRange(makeRequest(), "America/New_York"))
    .toMatch(/November 08, 2026.*November 22, 2026/);
});

it("organizes availability by church date or stable service identity without merging legacy ids", () => {
  const occurrences = [
    { occurrenceId: "group:sabbath@2026-11-22", name: "Sabbath service", startsAt: "2026-11-22T15:00:00.000Z", serviceDate: "2026-11-22" },
    { occurrenceId: "standalone@legacy-id", name: "Sabbath service", startsAt: "2026-11-08T14:00:00.000Z", serviceDate: "2026-11-08" },
    { occurrenceId: "group:sabbath@2026-11-08", name: "Sabbath service", startsAt: "2026-11-08T15:00:00.000Z", serviceDate: "2026-11-08" },
    { occurrenceId: "group:sabbath@2026-11-15", name: "Sabbath service", startsAt: "2026-11-15T15:00:00.000Z", serviceDate: "2026-11-15" },
  ];
  const savedOrder = occurrences.map(({ occurrenceId }) => occurrenceId);

  const byDate = organizeAvailabilityOccurrences({ occurrences, mode: "byDate", serviceTimeZone: "America/New_York" });
  expect(byDate.map(({ key }) => key)).toEqual(["2026-11-08", "2026-11-15", "2026-11-22"]);
  expect(byDate[0].occurrences.map(({ occurrenceId }) => occurrenceId)).toEqual([
    "standalone@legacy-id",
    "group:sabbath@2026-11-08",
  ]);

  const byService = organizeAvailabilityOccurrences({ occurrences, mode: "byService", serviceTimeZone: "America/New_York" });
  expect(byService).toHaveLength(2);
  expect(byService.find(({ key }) => key === "group:sabbath")?.occurrences.map(({ occurrenceId }) => occurrenceId)).toEqual([
    "group:sabbath@2026-11-08",
    "group:sabbath@2026-11-15",
    "group:sabbath@2026-11-22",
  ]);
  expect(occurrences.map(({ occurrenceId }) => occurrenceId)).toEqual(savedOrder);
});
