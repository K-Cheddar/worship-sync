import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { ContextType } from "react";
import { getMyVolunteerAvailability, submitMyVolunteerAvailability } from "../api/auth";
import { GlobalInfoContext } from "../context/globalInfo";
import store from "../store/store";
import MyAvailability from "./MyAvailability";
import type {
  PersonalScheduleAccess,
  VolunteerAvailabilityRead,
  VolunteerAvailabilityRequest,
  VolunteerAvailabilitySave,
  VolunteerAvailabilitySaveResult,
} from "./myScheduleOperations";

jest.mock("../context/toastContext", () => ({
  useToast: () => ({ showToast: jest.fn(), removeToast: jest.fn() }),
}));
jest.mock("../api/auth", () => ({
  getMyVolunteerAvailability: jest.fn(),
  submitMyVolunteerAvailability: jest.fn(),
  AuthApiError: class AuthApiError extends Error {
    status?: number;
    isReachabilityError = false;
  },
}));

const mockGetMyVolunteerAvailability = jest.mocked(getMyVolunteerAvailability);
const mockSubmitMyVolunteerAvailability = jest.mocked(submitMyVolunteerAvailability);

const ids = ["service-a@2099-11-08", "service-b@2099-11-15", "service-c@2099-11-22"];

const makeRequest = (
  overrides: Partial<VolunteerAvailabilityRequest> = {},
): VolunteerAvailabilityRequest => ({
  recipientId: "recipient-1",
  formId: "form-1",
  name: "November availability",
  responseDeadline: "2099-11-01",
  availabilityMessage: "Please respond for each Sunday.",
  respondedAt: "2099-10-20T12:00:00.000Z",
  submissionId: "submission-1",
  editable: true,
  occurrences: ids.map((occurrenceId, index) => ({
    occurrenceId,
    name: `Sunday ${index + 1}`,
    startsAt: `2099-11-${String(8 + index * 7).padStart(2, "0")}T14:00:00.000Z`,
    serviceDate: `2099-11-${String(8 + index * 7).padStart(2, "0")}`,
  })),
  availability: { [ids[0]]: "available", [ids[2]]: "unavailable" },
  unansweredOccurrenceIds: [ids[1]],
  availabilityRevision: { [ids[0]]: 0, [ids[1]]: 0, [ids[2]]: 0 },
  ...overrides,
});

const makeRead = (
  requests: VolunteerAvailabilityRequest[],
  serviceTimeZone: string | null = "America/New_York",
): VolunteerAvailabilityRead => ({ success: true, serviceTimeZone, requests });

const makeAccess = (
  loadAvailability: () => Promise<VolunteerAvailabilityRead>,
  saveAvailability: (request: VolunteerAvailabilitySave) => Promise<VolunteerAvailabilitySaveResult>,
  memberId = "member-1",
): PersonalScheduleAccess => ({
  churchId: "church-1",
  memberId,
  sessionKey: memberId + "-session",
  operations: {
    load: jest.fn().mockResolvedValue({ success: true, member: null, occurrences: [] }),
    respond: jest.fn(),
    saveBlockouts: jest.fn(),
    acceptUnanswered: jest.fn(),
    loadAvailability,
    saveAvailability,
  },
});

const LocationLabel = () => {
  const location = useLocation();
  return <output data-testid="current-location">{location.pathname}</output>;
};

const renderPage = (access: PersonalScheduleAccess) => render(
  <Provider store={store}>
    <MemoryRouter initialEntries={["/my-availability"]}>
      <MyAvailability access={access} />
      <LocationLabel />
    </MemoryRouter>
  </Provider>,
);

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => { resolve = finish; });
  return { promise, resolve };
};

beforeEach(() => jest.clearAllMocks());

it("loads and saves through the signed-in church-scoped availability operations", async () => {
  const user = userEvent.setup();
  const request = makeRequest();
  const saved = makeRequest({
    availability: { [ids[0]]: "unavailable", [ids[2]]: "unavailable" },
    unansweredOccurrenceIds: [ids[1]],
    availabilityRevision: { [ids[0]]: 1, [ids[1]]: 0, [ids[2]]: 0 },
  });
  mockGetMyVolunteerAvailability
    .mockResolvedValueOnce(makeRead([request]))
    .mockResolvedValueOnce(makeRead([saved]));
  mockSubmitMyVolunteerAvailability.mockResolvedValue({ success: true, submissionId: "signed-in-submission" });
  const context = {
    churchId: "human-church",
    churchName: "Northside",
    userId: "human-volunteer",
    role: "member",
  } as ContextType<typeof GlobalInfoContext>;
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/my-availability"]}>
        <GlobalInfoContext.Provider value={context}>
          <MyAvailability />
        </GlobalInfoContext.Provider>
      </MemoryRouter>
    </Provider>,
  );

  await user.click(await screen.findByRole("button", { name: "Open November availability" }));
  await user.click(within(screen.getByRole("radiogroup", { name: /Sunday 1/ }))
    .getByRole("radio", { name: "Unavailable" }));
  await user.click(screen.getByRole("button", { name: "Save response" }));

  await waitFor(() => expect(mockSubmitMyVolunteerAvailability).toHaveBeenCalledWith(
    "human-church",
    "recipient-1",
    { [ids[0]]: "unavailable", [ids[2]]: "unavailable" },
    { [ids[0]]: 0, [ids[1]]: 0, [ids[2]]: 0 },
  ));
  expect(mockGetMyVolunteerAvailability).toHaveBeenCalledTimes(2);
  expect(mockGetMyVolunteerAvailability).toHaveBeenNthCalledWith(1, "human-church");
  expect(await screen.findByRole("button", { name: "Open November availability" })).toBeInTheDocument();
});

it("shows a new unanswered request without counting it as unavailable", async () => {
  const noAnswers = makeRequest({
    name: "New availability request",
    respondedAt: "",
    submissionId: "",
    availability: {},
    unansweredOccurrenceIds: [...ids],
  });
  renderPage(makeAccess(jest.fn().mockResolvedValue(makeRead([noAnswers])), jest.fn()));

  const card = await screen.findByRole("button", { name: "Open New availability request" });
  expect(card).toHaveTextContent("0 available · 0 unavailable · 3 unanswered");
  expect(screen.getByRole("region", { name: "Needs response" })).toContainElement(card);
});

it("uses positive checkboxes for an initial response and confirms the complete scoped result", async () => {
  const user = userEvent.setup();
  const initial = makeRequest({
    respondedAt: "",
    submissionId: "",
    availability: {},
    unansweredOccurrenceIds: [...ids],
  });
  const submitted = makeRequest({
    availability: { [ids[0]]: "available", [ids[1]]: "available", [ids[2]]: "unavailable" },
    unansweredOccurrenceIds: [],
    availabilityRevision: Object.fromEntries(ids.map((id) => [id, 1])),
  });
  const loadAvailability = jest.fn()
    .mockResolvedValueOnce(makeRead([initial]))
    .mockResolvedValueOnce(makeRead([submitted]));
  const saveAvailability = jest.fn().mockResolvedValue({ success: true, submissionId: "submission-initial" });
  renderPage(makeAccess(loadAvailability, saveAvailability));

  await user.click(await screen.findByRole("button", { name: "Open November availability" }));
  expect(screen.getByRole("heading", { name: "Which services are you available to serve?" })).toBeInTheDocument();
  expect(screen.getByText("Checked means available. When you submit, unchecked services will be unavailable.")).toBeInTheDocument();
  const firstService = screen.getByRole("checkbox", { name: /Sunday 1.*9:00 AM EST/ });
  const secondService = screen.getByRole("checkbox", { name: /Sunday 2/ });
  expect(firstService).not.toBeChecked();
  await user.click(firstService);
  expect(screen.getByText("1 of 3 selected")).toBeInTheDocument();
  await user.click(secondService);
  expect(screen.getByText("2 of 3 selected")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Review response" }));
  expect(screen.getByRole("dialog", { name: "Confirm your availability" }))
    .toHaveTextContent("You're about to submit 2 available, 1 unavailable services.");
  expect(saveAvailability).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Submit response" }));

  await waitFor(() => expect(saveAvailability).toHaveBeenCalledWith({
    recipientId: "recipient-1",
    availability: { [ids[0]]: "available", [ids[1]]: "available", [ids[2]]: "unavailable" },
    availabilityRevision: { [ids[0]]: 0, [ids[1]]: 0, [ids[2]]: 0 },
  }));
  const submittedGroup = await screen.findByRole("region", { name: "Submitted responses" });
  expect(within(submittedGroup).getByRole("button", { name: "Open November availability" }))
    .toHaveTextContent("Response submitted");
  expect(screen.queryByRole("region", { name: "Needs response" }))
    .not.toHaveTextContent("November availability");
});

it("organizes compact availability cards by date or service without changing their response ids", async () => {
  const user = userEvent.setup();
  const request = makeRequest({
    respondedAt: "",
    submissionId: "",
    availability: {},
    unansweredOccurrenceIds: [...ids],
  });
  renderPage(makeAccess(jest.fn().mockResolvedValue(makeRead([request])), jest.fn()));

  await user.click(await screen.findByRole("button", { name: "Open November availability" }));
  expect(screen.getByRole("button", { name: "By date" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getAllByRole("checkbox")).toHaveLength(3);
  expect(screen.getByRole("heading", { name: "November 08, 2099" })).toBeInTheDocument();
  await user.click(screen.getByRole("checkbox", { name: /Sunday 1/ }));
  expect(screen.getByRole("checkbox", { name: /Sunday 1/ })).toBeChecked();

  await user.click(screen.getByRole("button", { name: "By service" }));
  expect(screen.getByRole("heading", { name: "Sunday 1" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Sunday 2" })).toBeInTheDocument();
  expect(screen.getAllByRole("checkbox")).toHaveLength(3);
  expect(screen.getByRole("checkbox", { name: /Sunday 1/ })).toBeChecked();
  expect(screen.getByRole("button", { name: "By service" })).toHaveAttribute("aria-pressed", "true");
  await user.click(screen.getByRole("button", { name: "By date" }));
  expect(screen.getByRole("checkbox", { name: /Sunday 1/ })).toBeChecked();
});

it("shows active volunteer destinations in the persistent and mobile navigation", async () => {
  renderPage(makeAccess(jest.fn().mockResolvedValue(makeRead([])), jest.fn()));

  const navigation = await screen.findAllByRole("navigation", { name: "Volunteer pages" });
  expect(navigation).toHaveLength(2);
  expect(screen.getAllByRole("link", { name: "My Availability" }).every((link) => link.getAttribute("aria-current") === "page")).toBe(true);
  expect(screen.getAllByRole("link", { name: "My Schedule" }).every((link) => link.getAttribute("href") === "/s?view=schedule")).toBe(true);
  expect(navigation[1]).toHaveClass("pb-[env(safe-area-inset-bottom)]");
  expect(navigation[1]).toHaveClass("lg:hidden");
});

it("selects every service with one action", async () => {
  const user = userEvent.setup();
  const initial = makeRequest({ respondedAt: "", submissionId: "", availability: {}, unansweredOccurrenceIds: [...ids] });
  const submitted = makeRequest({
    availability: Object.fromEntries(ids.map((id) => [id, "available"])),
    unansweredOccurrenceIds: [],
  });
  const loadAvailability = jest.fn()
    .mockResolvedValueOnce(makeRead([initial]))
    .mockResolvedValueOnce(makeRead([submitted]));
  const saveAvailability = jest.fn().mockResolvedValue({ success: true, submissionId: "all-available" });
  renderPage(makeAccess(loadAvailability, saveAvailability));

  await user.click(await screen.findByRole("button", { name: "Open November availability" }));
  await user.click(screen.getByRole("button", { name: "Select all" }));
  expect(screen.getByText("3 of 3 selected")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Review response" }));
  expect(screen.getByRole("dialog", { name: "Confirm your availability" }))
    .toHaveTextContent("3 available · 0 unavailable · 0 unanswered");
  await user.click(screen.getByRole("button", { name: "Submit response" }));

  await waitFor(() => expect(saveAvailability).toHaveBeenCalledWith(expect.objectContaining({
    availability: Object.fromEntries(ids.map((id) => [id, "available"])),
    availabilityRevision: Object.fromEntries(ids.map((id) => [id, 0])),
  })));
});

it("keeps service checkboxes keyboard operable at a narrow viewport", async () => {
  const user = userEvent.setup();
  const originalWidth = window.innerWidth;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 375 });
  const initial = makeRequest({ respondedAt: "", submissionId: "", availability: {}, unansweredOccurrenceIds: [...ids] });
  renderPage(makeAccess(jest.fn().mockResolvedValue(makeRead([initial])), jest.fn()));

  await user.click(await screen.findByRole("button", { name: "Open November availability" }));
  const firstService = screen.getByRole("checkbox", { name: /Sunday 1.*EST/ });

  firstService.focus();
  await user.keyboard(" ");

  expect(firstService).toBeChecked();
  expect(firstService).toHaveAccessibleName(/Sunday 1/);
  expect(screen.getByRole("button", { name: "Select all" })).toBeVisible();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
});

it("confirms an all-unavailable first response and lets the volunteer cancel without saving", async () => {
  const user = userEvent.setup();
  const initial = makeRequest({ respondedAt: "", submissionId: "", availability: {}, unansweredOccurrenceIds: [...ids] });
  const submitted = makeRequest({
    availability: Object.fromEntries(ids.map((id) => [id, "unavailable"])),
    unansweredOccurrenceIds: [],
  });
  const loadAvailability = jest.fn()
    .mockResolvedValueOnce(makeRead([initial]))
    .mockResolvedValueOnce(makeRead([submitted]));
  const saveAvailability = jest.fn().mockResolvedValue({ success: true, submissionId: "all-unavailable" });
  renderPage(makeAccess(loadAvailability, saveAvailability));

  await user.click(await screen.findByRole("button", { name: "Open November availability" }));
  await user.click(screen.getByRole("button", { name: "Review response" }));
  const confirmation = screen.getByRole("dialog", { name: "Confirm your availability" });
  expect(confirmation).toHaveTextContent("You haven't selected any services. Are you unavailable for all of them?");
  expect(confirmation).toHaveTextContent("0 available · 3 unavailable · 0 unanswered");
  await user.click(within(confirmation).getByRole("button", { name: "Cancel" }));
  expect(saveAvailability).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Review response" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Review response" }));
  await user.click(screen.getByRole("button", { name: "Submit response" }));
  await waitFor(() => expect(saveAvailability).toHaveBeenCalledWith(expect.objectContaining({
    availability: Object.fromEntries(ids.map((id) => [id, "unavailable"])),
  })));
  expect(await screen.findByRole("region", { name: "Submitted responses" }))
    .toHaveTextContent("Response submitted");
});

it("keeps an initial request unsubmitted when its save fails", async () => {
  const user = userEvent.setup();
  const initial = makeRequest({ respondedAt: "", submissionId: "", availability: {}, unansweredOccurrenceIds: [...ids] });
  const loadAvailability = jest.fn()
    .mockResolvedValueOnce(makeRead([initial]))
    .mockResolvedValueOnce(makeRead([initial]));
  const saveAvailability = jest.fn().mockRejectedValue(Object.assign(new Error("Save rejected"), { status: 500 }));
  renderPage(makeAccess(loadAvailability, saveAvailability));

  await user.click(await screen.findByRole("button", { name: "Open November availability" }));
  await user.click(screen.getByRole("checkbox", { name: /Sunday 1/ }));
  await user.click(screen.getByRole("button", { name: "Review response" }));
  await user.click(screen.getByRole("button", { name: "Submit response" }));
  expect(await screen.findByRole("button", { name: "Review latest saved answers" })).toBeInTheDocument();
  expect(saveAvailability).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "Back to requests" }));
  await user.click(screen.getByRole("button", { name: "Discard changes" }));

  expect(screen.getByRole("region", { name: "Needs response" }))
    .toHaveTextContent("Not yet submitted");
  expect(screen.queryByRole("region", { name: "Submitted responses" })).not.toBeInTheDocument();
});

it("keeps partially answered legacy requests in the three-state editor", async () => {
  const user = userEvent.setup();
  const partial = makeRequest({
    respondedAt: "",
    submissionId: "",
    availability: { [ids[0]]: "available" },
    unansweredOccurrenceIds: [ids[1], ids[2]],
  });
  const saveAvailability = jest.fn().mockResolvedValue({ success: true, submissionId: "legacy-finalized" });
  renderPage(makeAccess(jest.fn().mockResolvedValue(makeRead([partial])), saveAvailability));

  await user.click(await screen.findByRole("button", { name: "Open November availability" }));
  const answerGroup = screen.getByRole("radiogroup", { name: /Sunday 1/ });
  expect(within(answerGroup).getByRole("radio", { name: "Available" })).toBeChecked();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  await user.click(within(answerGroup).getByRole("radio", { name: "Unavailable" }));
  await user.click(screen.getByRole("button", { name: "Review response" }));
  expect(screen.getByRole("dialog", { name: "Confirm your availability" }))
    .toHaveTextContent("1 unavailable, and 2 unanswered");
  await user.click(screen.getByRole("button", { name: "Submit response" }));

  await waitFor(() => expect(saveAvailability).toHaveBeenCalledWith(expect.objectContaining({
    availability: { [ids[0]]: "unavailable" },
  })));
});

it("lets a legacy saved answer be cleared back to unanswered and finalized", async () => {
  const user = userEvent.setup();
  const legacy = makeRequest({
    respondedAt: "",
    submissionId: "",
    availability: { [ids[0]]: "available" },
    unansweredOccurrenceIds: [ids[1], ids[2]],
  });
  const submitted = makeRequest({
    respondedAt: "2099-10-21T12:00:00.000Z",
    submissionId: "legacy-finalized",
    availability: {},
    unansweredOccurrenceIds: [...ids],
    availabilityRevision: { [ids[0]]: 1, [ids[1]]: 0, [ids[2]]: 0 },
  });
  const loadAvailability = jest.fn()
    .mockResolvedValueOnce(makeRead([legacy]))
    .mockResolvedValueOnce(makeRead([submitted]));
  const saveAvailability = jest.fn().mockResolvedValue({ success: true, submissionId: "legacy-finalized" });
  renderPage(makeAccess(loadAvailability, saveAvailability));

  await user.click(await screen.findByRole("button", { name: "Open November availability" }));
  const firstGroup = screen.getByRole("radiogroup", { name: /Sunday 1/ });
  await user.click(within(firstGroup).getByRole("radio", { name: "Not answered" }));
  await user.click(screen.getByRole("button", { name: "Review response" }));
  expect(screen.getByRole("dialog", { name: "Confirm your availability" }))
    .toHaveTextContent("0 available, 0 unavailable, and 3 unanswered");
  await user.click(screen.getByRole("button", { name: "Submit response" }));

  await waitFor(() => expect(saveAvailability).toHaveBeenCalledWith({
    recipientId: "recipient-1",
    availability: {},
    availabilityRevision: { [ids[0]]: 0, [ids[1]]: 0, [ids[2]]: 0 },
  }));
  expect(await screen.findByRole("region", { name: "Submitted responses" }))
    .toHaveTextContent("Response submitted · 3 unanswered");
});

it("groups closed requests with and without a submission separately from open requests", async () => {
  const noSubmission = makeRequest({
    name: "Open request",
    respondedAt: "",
    submissionId: "",
    availability: {},
    unansweredOccurrenceIds: [...ids],
  });
  const submittedPartial = makeRequest({ name: "Submitted request" });
  const closedWithoutSubmission = makeRequest({
    name: "Closed without response",
    recipientId: "recipient-closed-without",
    formId: "form-closed-without",
    editable: false,
    respondedAt: "",
    submissionId: "",
    availability: {},
    unansweredOccurrenceIds: [...ids],
  });
  const closedWithSubmission = makeRequest({
    recipientId: "recipient-closed-with",
    formId: "form-closed-with",
    name: "Closed with response",
    editable: false,
  });
  renderPage(makeAccess(jest.fn().mockResolvedValue(makeRead([
    noSubmission, submittedPartial, closedWithoutSubmission, closedWithSubmission,
  ])), jest.fn()));

  const needsResponse = await screen.findByRole("region", { name: "Needs response" });
  const submitted = screen.getByRole("region", { name: "Submitted responses" });
  const closed = screen.getByRole("region", { name: "Closed" });
  expect(within(needsResponse).getByRole("button", { name: "Open Open request" }))
    .toHaveTextContent("Not yet submitted");
  expect(within(submitted).getByRole("button", { name: "Open Submitted request" }))
    .toHaveTextContent("Response submitted · 1 unanswered");
  expect(within(closed).getByRole("button", { name: "Open Closed without response" }))
    .toHaveTextContent("Closed · No response submitted");
  expect(within(closed).getByRole("button", { name: "Open Closed with response" }))
    .toHaveTextContent("Closed · Response submitted");
});

it("reopens saved answers and lets the volunteer clear one back to unanswered", async () => {
  const user = userEvent.setup();
  const saved = makeRequest({
    availability: { [ids[0]]: "available", [ids[1]]: "unavailable", [ids[2]]: "available" },
    unansweredOccurrenceIds: [],
  });
  const cleared = makeRequest({
    availability: { [ids[1]]: "unavailable", [ids[2]]: "available" },
    unansweredOccurrenceIds: [ids[0]],
    availabilityRevision: { [ids[0]]: 1, [ids[1]]: 0, [ids[2]]: 0 },
  });
  const loadAvailability = jest.fn()
    .mockResolvedValueOnce(makeRead([saved]))
    .mockResolvedValueOnce(makeRead([cleared]));
  const saveAvailability = jest.fn().mockResolvedValue({ success: true, submissionId: "submission-1" });
  renderPage(makeAccess(loadAvailability, saveAvailability));

  await user.click(await screen.findByRole("button", { name: "Open November availability" }));
  expect(screen.getByRole("checkbox", { name: /Sunday 1/ })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: /Sunday 2/ })).not.toBeChecked();
  await user.click(screen.getByRole("button", { name: "Edit individual answer states" }));
  const firstGroup = screen.getByRole("radiogroup", { name: /Sunday 1/ });
  await user.click(within(firstGroup).getByRole("radio", { name: "Not answered" }));
  await user.click(screen.getByRole("button", { name: "Save response" }));

  await waitFor(() => expect(saveAvailability).toHaveBeenCalledWith({
    recipientId: "recipient-1",
    availability: { [ids[1]]: "unavailable", [ids[2]]: "available" },
    availabilityRevision: { [ids[0]]: 0, [ids[1]]: 0, [ids[2]]: 0 },
  }));
});

it("shows submitted and closed requests, then saves the complete scoped map with its revisions", async () => {
  const user = userEvent.setup();
  const openRequest = makeRequest();
  const closedRequest = makeRequest({
    recipientId: "recipient-closed",
    formId: "form-closed",
    name: "October availability",
    editable: false,
    unansweredOccurrenceIds: [],
  });
  let savedRequest = openRequest;
  const loadAvailability = jest.fn(async () => makeRead([savedRequest, closedRequest]));
  const saveAvailability = jest.fn(async (payload: VolunteerAvailabilitySave) => {
    savedRequest = makeRequest({
      availability: payload.availability,
      unansweredOccurrenceIds: ids.filter((id) => !Object.hasOwn(payload.availability, id)),
      availabilityRevision: Object.fromEntries(ids.map((id) => [id, 1])),
      submissionId: "submission-1",
      respondedAt: "2099-10-20T12:00:00.000Z",
    });
    return { success: true, submissionId: "submission-1", submittedAt: savedRequest.respondedAt };
  });
  renderPage(makeAccess(loadAvailability, saveAvailability));

  const submittedResponses = await screen.findByRole("region", { name: "Submitted responses" });
  expect(within(submittedResponses).getByRole("button", { name: "Open November availability" }))
    .toHaveTextContent("1 available · 1 unavailable · 1 unanswered");
  expect(screen.getByRole("region", { name: "Closed" }))
    .toHaveTextContent("October availability");
  expect(screen.getByText("An unanswered date means you haven't responded. It doesn't mean you're unavailable."))
    .toBeInTheDocument();

  await user.click(within(submittedResponses).getByRole("button", { name: "Open November availability" }));
  const firstGroup = screen.getByRole("radiogroup", { name: /Sunday 1/ });
  expect(firstGroup).toHaveClass("grid", "sm:grid-cols-3");
  expect(within(firstGroup).getByText("Available", { selector: "label" })).toHaveClass("min-h-11");
  await user.click(within(firstGroup).getByRole("radio", { name: "Not answered" }));
  const secondGroup = screen.getByRole("radiogroup", { name: /Sunday 2/ });
  await user.click(within(secondGroup).getByRole("radio", { name: "Available" }));
  expect(within(firstGroup).getByRole("radio", { name: "Not answered" })).toBeChecked();

  await user.click(screen.getByRole("button", { name: "Save response" }));
  await waitFor(() => expect(saveAvailability).toHaveBeenCalledTimes(1));
  expect(saveAvailability).toHaveBeenCalledWith({
    recipientId: "recipient-1",
    availability: { [ids[1]]: "available", [ids[2]]: "unavailable" },
    availabilityRevision: { [ids[0]]: 0, [ids[1]]: 0, [ids[2]]: 0 },
  });
  expect(await screen.findByRole("button", { name: "Open November availability" }))
    .toHaveTextContent("1 available · 1 unavailable · 1 unanswered");
  expect(loadAvailability).toHaveBeenCalledTimes(2);
});

it("keeps a conflicting draft until the volunteer reviews and rebases it", async () => {
  const user = userEvent.setup();
  const original = makeRequest();
  const latest = makeRequest({
    availability: { [ids[2]]: "unavailable" },
    unansweredOccurrenceIds: [ids[0], ids[1]],
    availabilityRevision: { [ids[0]]: 1, [ids[1]]: 0, [ids[2]]: 0 },
  });
  const saved = makeRequest({
    availability: { [ids[0]]: "unavailable", [ids[2]]: "unavailable" },
    unansweredOccurrenceIds: [ids[1]],
    availabilityRevision: { [ids[0]]: 2, [ids[1]]: 0, [ids[2]]: 0 },
    submissionId: "submission-after-conflict",
  });
  let readCount = 0;
  const loadAvailability = jest.fn(async () => {
    readCount += 1;
    return makeRead([readCount === 1 ? original : readCount === 2 ? latest : saved]);
  });
  const conflict = Object.assign(new Error("Availability changed elsewhere"), { status: 409 });
  const saveAvailability = jest.fn()
    .mockRejectedValueOnce(conflict)
    .mockResolvedValueOnce({ success: true, submissionId: "submission-after-conflict" });
  renderPage(makeAccess(loadAvailability, saveAvailability));

  await user.click(await screen.findByRole("button", { name: "Open November availability" }));
  const firstGroup = screen.getByRole("radiogroup", { name: /Sunday 1/ });
  await user.click(within(firstGroup).getByRole("radio", { name: "Unavailable" }));
  await user.click(screen.getByRole("button", { name: "Save response" }));

  expect(await screen.findByRole("button", { name: "Review latest saved answers" })).toBeInTheDocument();
  expect(within(firstGroup).getByRole("radio", { name: "Unavailable" })).toBeChecked();
  await user.click(screen.getByRole("button", { name: "Review latest saved answers" }));
  const firstComparison = within(screen.getAllByRole("listitem")[0]);
  expect(firstComparison.getByText("Available", { selector: "dd" })).toBeInTheDocument();
  expect(firstComparison.getByText("Not answered", { selector: "dd" })).toBeInTheDocument();
  expect(firstComparison.getByText("Unavailable", { selector: "dd" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Keep my draft and continue" }));
  expect(screen.getByRole("button", { name: "Save response" })).toBeEnabled();

  await user.click(screen.getByRole("button", { name: "Save response" }));
  await waitFor(() => expect(saveAvailability).toHaveBeenCalledTimes(2));
  expect(saveAvailability.mock.calls[1][0].availabilityRevision).toEqual({
    [ids[0]]: 1,
    [ids[1]]: 0,
    [ids[2]]: 0,
  });
  expect(await screen.findByRole("button", { name: "Open November availability" })).toBeInTheDocument();
});

it("preserves a dirty draft when a refreshed request snapshot arrives during editing", async () => {
  const user = userEvent.setup();
  const original = makeRequest();
  const refreshed = makeRequest({
    availability: { [ids[0]]: "unavailable", [ids[2]]: "unavailable" },
    unansweredOccurrenceIds: [ids[1]],
    availabilityRevision: { [ids[0]]: 1, [ids[1]]: 0, [ids[2]]: 0 },
  });
  const firstAccess = makeAccess(jest.fn().mockResolvedValue(makeRead([original])), jest.fn());
  const refreshedLoad = jest.fn().mockResolvedValue(makeRead([refreshed]));
  const secondAccess = makeAccess(refreshedLoad, jest.fn());
  const view = (access: PersonalScheduleAccess) => (
    <Provider store={store}>
      <MemoryRouter initialEntries={["/my-availability"]}>
        <MyAvailability access={access} />
      </MemoryRouter>
    </Provider>
  );
  const { rerender } = render(view(firstAccess));

  await user.click(await screen.findByRole("button", { name: "Open November availability" }));
  const firstGroup = screen.getByRole("radiogroup", { name: /Sunday 1/ });
  await user.click(within(firstGroup).getByRole("radio", { name: "Unavailable" }));
  rerender(view(secondAccess));

  await waitFor(() => expect(refreshedLoad).toHaveBeenCalledTimes(1));
  expect(within(firstGroup).getByRole("radio", { name: "Unavailable" })).toBeChecked();
  expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
});

it("reconciles an uncertain save from the authoritative read without reporting a false failure", async () => {
  const user = userEvent.setup();
  const initial = makeRequest();
  const submitted = makeRequest({
    availability: { [ids[0]]: "unavailable", [ids[2]]: "unavailable" },
    unansweredOccurrenceIds: [ids[1]],
    availabilityRevision: { [ids[0]]: 1, [ids[1]]: 0, [ids[2]]: 0 },
    submissionId: "committed-despite-network-error",
  });
  const loadAvailability = jest.fn()
    .mockResolvedValueOnce(makeRead([initial]))
    .mockResolvedValueOnce(makeRead([submitted]));
  const networkError = Object.assign(new Error("Connection closed"), { status: 503 });
  const saveAvailability = jest.fn().mockRejectedValue(networkError);
  renderPage(makeAccess(loadAvailability, saveAvailability));

  await user.click(await screen.findByRole("button", { name: "Open November availability" }));
  await user.click(within(screen.getByRole("radiogroup", { name: /Sunday 1/ }))
    .getByRole("radio", { name: "Unavailable" }));
  await user.click(screen.getByRole("button", { name: "Save response" }));

  expect(await screen.findByRole("button", { name: "Open November availability" })).toBeInTheDocument();
  expect(saveAvailability).toHaveBeenCalledTimes(1);
  expect(loadAvailability).toHaveBeenCalledTimes(2);
  expect(screen.queryByText("We couldn't confirm that save. Your draft is still here.")).not.toBeInTheDocument();
});

it("keeps an uncertain draft and requires a refresh before retry when the read is unavailable", async () => {
  const user = userEvent.setup();
  const initial = makeRequest();
  const saved = makeRequest({
    availability: { [ids[0]]: "unavailable", [ids[2]]: "unavailable" },
    unansweredOccurrenceIds: [ids[1]],
    availabilityRevision: { [ids[0]]: 1, [ids[1]]: 0, [ids[2]]: 0 },
    submissionId: "confirmed-after-refresh",
  });
  const loadAvailability = jest.fn()
    .mockResolvedValueOnce(makeRead([initial]))
    .mockRejectedValueOnce(new Error("Network unavailable"))
    .mockResolvedValueOnce(makeRead([initial]))
    .mockResolvedValueOnce(makeRead([saved]));
  const networkError = Object.assign(new Error("Connection closed"), { status: 503 });
  const saveAvailability = jest.fn()
    .mockRejectedValueOnce(networkError)
    .mockResolvedValueOnce({ success: true, submissionId: "confirmed-after-refresh" });
  renderPage(makeAccess(loadAvailability, saveAvailability));

  await user.click(await screen.findByRole("button", { name: "Open November availability" }));
  const firstGroup = screen.getByRole("radiogroup", { name: /Sunday 1/ });
  await user.click(within(firstGroup).getByRole("radio", { name: "Unavailable" }));
  await user.click(screen.getByRole("button", { name: "Save response" }));

  expect(await screen.findByText("Could not load the latest saved answers. Your draft is still here. Refresh before trying again."))
    .toBeInTheDocument();
  expect(within(firstGroup).getByRole("radio", { name: "Unavailable" })).toBeChecked();
  expect(screen.getByRole("button", { name: "Save response" })).toBeDisabled();
  expect(saveAvailability).toHaveBeenCalledTimes(1);

  await user.click(screen.getByRole("button", { name: "Refresh saved answers" }));
  expect(await screen.findByRole("button", { name: "Review latest saved answers" })).toBeInTheDocument();
  expect(within(firstGroup).getByRole("radio", { name: "Unavailable" })).toBeChecked();
  expect(saveAvailability).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "Review latest saved answers" }));
  await user.click(screen.getByRole("button", { name: "Keep my draft and continue" }));
  await user.click(screen.getByRole("button", { name: "Save response" }));

  expect(await screen.findByRole("button", { name: "Open November availability" })).toBeInTheDocument();
  expect(saveAvailability).toHaveBeenCalledTimes(2);
});

it("keeps closed requests read-only", async () => {
  const user = userEvent.setup();
  const closed = makeRequest({ editable: false, availability: Object.fromEntries(ids.map((id) => [id, "unavailable"])), unansweredOccurrenceIds: [] });
  renderPage(makeAccess(jest.fn().mockResolvedValue(makeRead([closed])), jest.fn()));

  await user.click(await screen.findByRole("button", { name: "Open November availability" }));
  expect(screen.getByText("This availability request is closed. Your previous responses are shown below.")).toBeInTheDocument();
  screen.getAllByRole("checkbox").forEach((checkbox) => expect(checkbox).toBeDisabled());
  expect(screen.queryByRole("button", { name: "Save response" })).not.toBeInTheDocument();
});

it("guards volunteer navigation when a response draft is dirty", async () => {
  const user = userEvent.setup();
  renderPage(makeAccess(jest.fn().mockResolvedValue(makeRead([makeRequest()])), jest.fn()));

  await user.click(await screen.findByRole("button", { name: "Open November availability" }));
  await user.click(within(screen.getByRole("radiogroup", { name: /Sunday 1/ }))
    .getByRole("radio", { name: "Unavailable" }));
  await user.click(screen.getByRole("button", { name: "Open menu" }));
  const menu = await screen.findByRole("dialog", { name: "Menu" });
  await user.click(within(menu).getByRole("link", { name: "My Schedule" }));
  expect(screen.getByRole("dialog", { name: "Unsaved changes" })).toBeInTheDocument();
  expect(screen.getByTestId("current-location")).toHaveTextContent("/my-availability");
  await user.click(screen.getByRole("button", { name: "Stay" }));
  await user.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.getByRole("heading", { name: "November availability" })).toBeInTheDocument();
});

it("prevents duplicate saves and retires an in-flight save when the personal session changes", async () => {
  const user = userEvent.setup();
  const pendingSave = deferred<VolunteerAvailabilitySaveResult>();
  const original = makeRequest();
  const nextSessionRequest = makeRequest({
    recipientId: "recipient-next-session",
    formId: "form-next-session",
    name: "Current session request",
  });
  const loadAvailability = jest.fn().mockResolvedValue(makeRead([original]));
  const saveAvailability = jest.fn(() => pendingSave.promise);
  const oldAccess = makeAccess(loadAvailability, saveAvailability);
  const newAccess = {
    ...makeAccess(jest.fn().mockResolvedValue(makeRead([nextSessionRequest])), jest.fn()),
    sessionKey: "a-new-session-for-the-same-member",
  };
  const view = (access: PersonalScheduleAccess) => (
    <Provider store={store}>
      <MemoryRouter initialEntries={["/my-availability"]}>
        <MyAvailability access={access} />
      </MemoryRouter>
    </Provider>
  );
  const { rerender } = render(view(oldAccess));

  await user.click(await screen.findByRole("button", { name: "Open November availability" }));
  await user.click(within(screen.getByRole("radiogroup", { name: /Sunday 1/ }))
    .getByRole("radio", { name: "Unavailable" }));
  await user.click(screen.getByRole("button", { name: "Save response" }));
  expect(await screen.findByRole("button", { name: /Saving availability/ })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: /Saving availability/ }));
  expect(saveAvailability).toHaveBeenCalledTimes(1);

  rerender(view(newAccess));
  expect(await screen.findByRole("button", { name: "Open Current session request" })).toBeInTheDocument();
  await act(async () => {
    pendingSave.resolve({ success: true, submissionId: "late-old-session-save" });
  });
  expect(screen.getByRole("button", { name: "Open Current session request" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "November availability" })).not.toBeInTheDocument();
});

it("ignores an old availability read after the volunteer changes churches", async () => {
  const oldRead = deferred<VolunteerAvailabilityRead>();
  const oldAccess = makeAccess(() => oldRead.promise, jest.fn());
  const currentRequest = makeRequest({
    recipientId: "current-church-recipient",
    formId: "current-church-form",
    name: "Current church request",
  });
  const newAccess = {
    ...makeAccess(jest.fn().mockResolvedValue(makeRead([currentRequest])), jest.fn()),
    churchId: "another-church",
  };
  const view = (access: PersonalScheduleAccess) => (
    <Provider store={store}>
      <MemoryRouter initialEntries={["/my-availability"]}>
        <MyAvailability access={access} />
      </MemoryRouter>
    </Provider>
  );
  const { rerender } = render(view(oldAccess));

  rerender(view(newAccess));
  expect(await screen.findByRole("button", { name: "Open Current church request" })).toBeInTheDocument();
  await act(async () => oldRead.resolve(makeRead([makeRequest({ name: "Old church request" })])));

  expect(screen.queryByRole("button", { name: "Open Old church request" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Open Current church request" })).toBeInTheDocument();
});

it("offers retry after a temporary availability-load failure", async () => {
  const user = userEvent.setup();
  const loadAvailability = jest.fn()
    .mockRejectedValueOnce(new Error("Network unavailable"))
    .mockResolvedValueOnce(makeRead([]));
  renderPage(makeAccess(loadAvailability, jest.fn()));

  expect(await screen.findByRole("alert")).toHaveTextContent("Network unavailable");
  await user.click(screen.getByRole("button", { name: "Retry loading availability" }));
  expect(await screen.findByText("No availability requests right now.")).toBeInTheDocument();
  expect(loadAvailability).toHaveBeenCalledTimes(2);
});
