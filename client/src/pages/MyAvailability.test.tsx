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
  respondedAt: "",
  submissionId: "",
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
  await user.click(screen.getByRole("button", { name: "Save availability" }));

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
    availability: {},
    unansweredOccurrenceIds: [...ids],
  });
  renderPage(makeAccess(jest.fn().mockResolvedValue(makeRead([noAnswers])), jest.fn()));

  const card = await screen.findByRole("button", { name: "Open New availability request" });
  expect(card).toHaveTextContent("0 available · 0 unavailable · 3 unanswered");
  expect(screen.getByRole("region", { name: "Needs response" })).toContainElement(card);
});

it("shows open and closed requests, then saves a complete map with the returned revisions", async () => {
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

  const needsResponse = await screen.findByRole("region", { name: "Needs response" });
  expect(within(needsResponse).getByRole("button", { name: "Open November availability" }))
    .toHaveTextContent("1 available · 1 unavailable · 1 unanswered");
  expect(screen.getByRole("region", { name: "Previous responses" }))
    .toHaveTextContent("October availability");
  expect(screen.getByText("An unanswered date means you haven't responded. It doesn't mean you're unavailable."))
    .toBeInTheDocument();

  await user.click(within(needsResponse).getByRole("button", { name: "Open November availability" }));
  const firstGroup = screen.getByRole("radiogroup", { name: /Sunday 1/ });
  expect(firstGroup).toHaveClass("grid", "sm:grid-cols-3");
  expect(within(firstGroup).getByText("Available", { selector: "label" })).toHaveClass("min-h-11");
  await user.click(within(firstGroup).getByRole("radio", { name: "Not answered" }));
  const secondGroup = screen.getByRole("radiogroup", { name: /Sunday 2/ });
  await user.click(within(secondGroup).getByRole("radio", { name: "Available" }));
  expect(within(firstGroup).getByRole("radio", { name: "Not answered" })).toBeChecked();

  await user.click(screen.getByRole("button", { name: "Save availability" }));
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
  await user.click(screen.getByRole("button", { name: "Save availability" }));

  expect(await screen.findByRole("button", { name: "Review latest saved answers" })).toBeInTheDocument();
  expect(within(firstGroup).getByRole("radio", { name: "Unavailable" })).toBeChecked();
  await user.click(screen.getByRole("button", { name: "Review latest saved answers" }));
  const firstComparison = within(screen.getAllByRole("listitem")[0]);
  expect(firstComparison.getByText("Available", { selector: "dd" })).toBeInTheDocument();
  expect(firstComparison.getByText("Not answered", { selector: "dd" })).toBeInTheDocument();
  expect(firstComparison.getByText("Unavailable", { selector: "dd" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Keep my draft and continue" }));
  expect(screen.getByRole("button", { name: "Save availability" })).toBeEnabled();

  await user.click(screen.getByRole("button", { name: "Save availability" }));
  await waitFor(() => expect(saveAvailability).toHaveBeenCalledTimes(2));
  expect(saveAvailability.mock.calls[1][0].availabilityRevision).toEqual({
    [ids[0]]: 1,
    [ids[1]]: 0,
    [ids[2]]: 0,
  });
  expect(await screen.findByRole("button", { name: "Open November availability" })).toBeInTheDocument();
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
  await user.click(screen.getByRole("button", { name: "Save availability" }));

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
  await user.click(screen.getByRole("button", { name: "Save availability" }));

  expect(await screen.findByText("Could not load the latest saved answers. Your draft is still here. Refresh before trying again."))
    .toBeInTheDocument();
  expect(within(firstGroup).getByRole("radio", { name: "Unavailable" })).toBeChecked();
  expect(screen.getByRole("button", { name: "Save availability" })).toBeDisabled();
  expect(saveAvailability).toHaveBeenCalledTimes(1);

  await user.click(screen.getByRole("button", { name: "Refresh saved answers" }));
  expect(await screen.findByRole("button", { name: "Review latest saved answers" })).toBeInTheDocument();
  expect(within(firstGroup).getByRole("radio", { name: "Unavailable" })).toBeChecked();
  expect(saveAvailability).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "Review latest saved answers" }));
  await user.click(screen.getByRole("button", { name: "Keep my draft and continue" }));
  await user.click(screen.getByRole("button", { name: "Save availability" }));

  expect(await screen.findByRole("button", { name: "Open November availability" })).toBeInTheDocument();
  expect(saveAvailability).toHaveBeenCalledTimes(2);
});

it("keeps closed requests read-only", async () => {
  const user = userEvent.setup();
  const closed = makeRequest({ editable: false, unansweredOccurrenceIds: [] });
  renderPage(makeAccess(jest.fn().mockResolvedValue(makeRead([closed])), jest.fn()));

  await user.click(await screen.findByRole("button", { name: "Open November availability" }));
  expect(screen.getByText("This availability request is closed. Your previous responses are shown below.")).toBeInTheDocument();
  screen.getAllByRole("radio").forEach((radio) => expect(radio).toBeDisabled());
  expect(screen.queryByRole("button", { name: "Save availability" })).not.toBeInTheDocument();
});

it("guards volunteer navigation when a response draft is dirty", async () => {
  const user = userEvent.setup();
  renderPage(makeAccess(jest.fn().mockResolvedValue(makeRead([makeRequest()])), jest.fn()));

  await user.click(await screen.findByRole("button", { name: "Open November availability" }));
  await user.click(within(screen.getByRole("radiogroup", { name: /Sunday 1/ }))
    .getByRole("radio", { name: "Unavailable" }));
  await user.click(screen.getByRole("link", { name: "My Schedule" }));
  expect(screen.getByRole("dialog", { name: "Unsaved changes" })).toBeInTheDocument();
  expect(screen.getByTestId("current-location")).toHaveTextContent("/my-availability");
  await user.click(screen.getByRole("button", { name: "Stay" }));
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
  await user.click(screen.getByRole("button", { name: "Save availability" }));
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
