import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import type { ComponentProps, ContextType } from "react";
import { getMyVolunteerAvailability, submitMyVolunteerAvailability, updateMySchedulingPreferences } from "../api/auth";
import { GlobalInfoContext } from "../context/globalInfo";
import store from "../store/store";
import { useVolunteerNavigationGuard, VolunteerNavigationGuardProvider } from "./VolunteerNavigationGuard";
import { VolunteerAvailabilitySections as MyAvailability } from "./VolunteerAvailabilitySections";
import type {
  PersonalScheduleAccess,
  VolunteerAvailabilityRead,
  VolunteerAvailabilityRequest,
  VolunteerAvailabilitySave,
  VolunteerAvailabilitySaveResult,
  VolunteerSchedulingPreferences,
  VolunteerSchedulingPreferencesSave,
} from "./myScheduleOperations";

jest.mock("../context/toastContext", () => ({
  useToast: () => ({ showToast: jest.fn(), removeToast: jest.fn() }),
}));
jest.mock("../api/auth", () => ({
  getMyVolunteerAvailability: jest.fn(),
  submitMyVolunteerAvailability: jest.fn(),
  updateMySchedulingPreferences: jest.fn(),
  AuthApiError: class AuthApiError extends Error {
    status?: number;
    isReachabilityError = false;
  },
}));

const mockGetMyVolunteerAvailability = jest.mocked(getMyVolunteerAvailability);
const mockSubmitMyVolunteerAvailability = jest.mocked(submitMyVolunteerAvailability);
const mockUpdateMySchedulingPreferences = jest.mocked(updateMySchedulingPreferences);

const ids = ["service-a@2099-11-08", "service-b@2099-11-15", "service-c@2099-11-22"];

const memberSnapshotFor = (preferences: VolunteerSchedulingPreferences) => ({
  memberId: "member-1",
  churchId: "church-1",
  firstName: "Test",
  lastName: "Volunteer",
  blockoutDates: [],
  servingFrequency: preferences.servingFrequency,
  recurringAvailability: preferences.recurringAvailability,
  updatedAt: preferences.updatedAt,
});

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
  schedulingPreferences: VolunteerSchedulingPreferences | null = null,
): VolunteerAvailabilityRead => ({
  success: true,
  serviceTimeZone,
  requests,
  requestSummaries: requests.map(({ recipientId, formId, name, responseDeadline, respondedAt, submissionId, editable }) => ({
    recipientId, formId, name, responseDeadline, respondedAt, submissionId, editable,
  })),
  schedulingPreferences,
});

const confirmedAvailabilitySave = (
  request: VolunteerAvailabilityRequest,
  submissionId: string,
  submittedAt: string,
): VolunteerAvailabilitySaveResult => ({
  success: true,
  recipientId: request.recipientId,
  submissionId,
  submittedAt,
  requestSummary: {
    recipientId: request.recipientId,
    formId: request.formId,
    name: request.name,
    responseDeadline: request.responseDeadline,
    respondedAt: submittedAt,
    submissionId,
    editable: true,
  },
});

const requestCardName = (name: string) => new RegExp(
  `^(?:Respond|Change response) ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
);
const findRequestCard = (name = "November availability") =>
  screen.findByRole("button", { name: requestCardName(name) });
const makeAccess = (
  loadAvailability: () => Promise<VolunteerAvailabilityRead>,
  saveAvailability: (request: VolunteerAvailabilitySave) => Promise<VolunteerAvailabilitySaveResult>,
  memberId = "member-1",
  saveSchedulingPreferences?: (request: VolunteerSchedulingPreferencesSave) => Promise<{
    success: boolean;
    schedulingPreferences: VolunteerSchedulingPreferences;
    memberSnapshot: ReturnType<typeof memberSnapshotFor>;
  }>,
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
    ...(saveSchedulingPreferences ? { saveSchedulingPreferences } : {}),
  },
});

const LocationLabel = () => {
  const location = useLocation();
  return <output data-testid="current-location">{location.pathname + location.search}</output>;
};

const AvailabilityRouteSwitcher = () => {
  const navigate = useNavigate();
  return <div>
    <button type="button" onClick={() => navigate("/my-availability?availabilityRequest=recipient-1")}>Open first request</button>
    <button type="button" onClick={() => navigate("/my-availability?availabilityRequest=recipient-2")}>Open second request</button>
  </div>;
};

const RoutedAvailability = ({ navigationGuardProvided = false, ...props }: ComponentProps<typeof MyAvailability>) => {
  const location = useLocation();
  const recipientId = new URLSearchParams(location.search).get("availabilityRequest")?.trim() || undefined;
  return <MyAvailability {...props} initialRecipientId={recipientId} focusAvailability navigationGuardProvided={navigationGuardProvided} />;
};

const GuardedHomeLink = () => {
  const { requestNavigation } = useVolunteerNavigationGuard();
  return <a href="/home" onClick={(event) => {
    event.preventDefault();
    requestNavigation("/home");
  }}>Home</a>;
};

const renderPage = (
  access: PersonalScheduleAccess,
  fallbackPreferences: VolunteerSchedulingPreferences | null = null,
  initialEntry = "/my-availability",
) => render(
  <Provider store={store}>
    <MemoryRouter initialEntries={[initialEntry]}>
      <VolunteerNavigationGuardProvider>
        <GuardedHomeLink />
        <RoutedAvailability access={access} fallbackPreferences={fallbackPreferences} navigationGuardProvided />
      </VolunteerNavigationGuardProvider>
      <LocationLabel />
    </MemoryRouter>
  </Provider>,
);

const renderSwitchablePage = (access: PersonalScheduleAccess) => render(
  <Provider store={store}>
    <MemoryRouter initialEntries={["/my-availability"]}>
      <AvailabilityRouteSwitcher />
      <VolunteerNavigationGuardProvider>
        <RoutedAvailability access={access} navigationGuardProvided />
      </VolunteerNavigationGuardProvider>
      <LocationLabel />
    </MemoryRouter>
  </Provider>,
);

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => { resolve = finish; });
  return { promise, resolve };
};

beforeEach(() => {
  mockGetMyVolunteerAvailability.mockReset();
  mockSubmitMyVolunteerAvailability.mockReset();
  mockUpdateMySchedulingPreferences.mockReset();
});

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
    .mockResolvedValueOnce(makeRead([request]))
    .mockResolvedValueOnce(makeRead([request]))
    .mockResolvedValueOnce(makeRead([saved]));
  mockSubmitMyVolunteerAvailability.mockResolvedValue(
    confirmedAvailabilitySave(request, "signed-in-submission", "2099-10-21T12:00:00.000Z"),
  );
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
          <RoutedAvailability />
        </GlobalInfoContext.Provider>
      </MemoryRouter>
    </Provider>,
  );

  await user.click(await screen.findByRole("button", { name: requestCardName("November availability") }));
  await user.click(screen.getByRole("checkbox", { name: /Sunday 1/ }));
  await user.click(screen.getByRole("button", { name: "Save changes" }));

  await waitFor(() => expect(mockSubmitMyVolunteerAvailability).toHaveBeenCalledWith(
    "human-church",
    "recipient-1",
    { [ids[0]]: "unavailable", [ids[2]]: "unavailable" },
    { [ids[0]]: 0, [ids[1]]: 0, [ids[2]]: 0 },
  ));
  expect(mockGetMyVolunteerAvailability).toHaveBeenCalledTimes(2);
  expect(mockGetMyVolunteerAvailability).toHaveBeenNthCalledWith(1, "human-church", { summary: true });
  expect(mockGetMyVolunteerAvailability).toHaveBeenNthCalledWith(2, "human-church", { recipientId: "recipient-1" });
  expect(await screen.findByRole("button", { name: requestCardName("November availability") })).toBeInTheDocument();
});

it("shows stored scheduling preferences and saves explicit accountless edits", async () => {
  const user = userEvent.setup();
  const existing: VolunteerSchedulingPreferences = {
    servingFrequency: "twice_monthly",
    recurringAvailability: { weeksOfMonth: [1, 3], includeLastWeekOfMonth: false },
    updatedAt: "preferences-1",
  };
  const saved: VolunteerSchedulingPreferences = {
    servingFrequency: "monthly",
    recurringAvailability: { weeksOfMonth: [1, 2, 3], includeLastWeekOfMonth: false },
    updatedAt: "preferences-2",
  };
  const savePreferences = jest.fn().mockResolvedValue({
    success: true, schedulingPreferences: saved, memberSnapshot: memberSnapshotFor(saved),
  });
  renderPage(makeAccess(
    jest.fn().mockResolvedValue(makeRead([], "America/New_York", existing)),
    jest.fn(),
    "member-1",
    savePreferences,
  ));

  expect(await screen.findByText("Twice a month")).toBeInTheDocument();
  expect(screen.getByText("1st week, 3rd week")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Edit preferences" }));
  await user.click(screen.getByRole("combobox", { name: /Serving frequency/ }));
  await user.click(screen.getByRole("option", { name: "Once a month" }));
  await user.click(screen.getByRole("checkbox", { name: "2nd week" }));
  await user.click(screen.getByRole("button", { name: "Save preferences" }));

  await waitFor(() => expect(savePreferences).toHaveBeenCalledWith({
    servingFrequency: "monthly",
    recurringAvailability: { weeksOfMonth: [1, 2, 3], includeLastWeekOfMonth: false },
    expectedUpdatedAt: "preferences-1",
  }));
  expect(await screen.findByText("Once a month")).toBeInTheDocument();
  expect(screen.getByText("1st week, 2nd week, 3rd week")).toBeInTheDocument();
});

it("keeps a confirmed preference save when the initial summary resolves afterward", async () => {
  const user = userEvent.setup();
  const existing: VolunteerSchedulingPreferences = {
    servingFrequency: "twice_monthly",
    recurringAvailability: { weeksOfMonth: [1, 3], includeLastWeekOfMonth: false },
    updatedAt: "preferences-1",
  };
  const saved: VolunteerSchedulingPreferences = {
    servingFrequency: "monthly",
    recurringAvailability: { weeksOfMonth: [1, 3], includeLastWeekOfMonth: false },
    updatedAt: "preferences-2",
  };
  const pendingSummary = deferred<VolunteerAvailabilityRead>();
  const loadAvailability = jest.fn().mockReturnValue(pendingSummary.promise);
  const savePreferences = jest.fn().mockResolvedValue({
    success: true, schedulingPreferences: saved, memberSnapshot: memberSnapshotFor(saved),
  });
  renderPage(makeAccess(loadAvailability, jest.fn(), "member-1", savePreferences), existing);

  await user.click(screen.getByRole("button", { name: "Edit preferences" }));
  await user.click(screen.getByRole("combobox", { name: /Serving frequency/ }));
  await user.click(screen.getByRole("option", { name: "Once a month" }));
  await user.click(screen.getByRole("button", { name: "Save preferences" }));
  await waitFor(() => expect(savePreferences).toHaveBeenCalledWith({
    servingFrequency: "monthly",
    recurringAvailability: { weeksOfMonth: [1, 3], includeLastWeekOfMonth: false },
    expectedUpdatedAt: "preferences-1",
  }));
  expect(await screen.findByText("Once a month")).toBeInTheDocument();

  await act(async () => {
    pendingSummary.resolve(makeRead([], "America/New_York", existing));
    await pendingSummary.promise;
  });

  expect(screen.getByText("Once a month")).toBeInTheDocument();
  expect(screen.getByText("1st week, 3rd week")).toBeInTheDocument();
});

it("saves signed-in preferences through the church-scoped self-service API", async () => {
  const user = userEvent.setup();
  const preferences: VolunteerSchedulingPreferences = {
    servingFrequency: "weekly",
    recurringAvailability: { weeksOfMonth: [], includeLastWeekOfMonth: false },
    updatedAt: "signed-in-revision",
  };
  mockGetMyVolunteerAvailability.mockResolvedValue(makeRead([], "America/New_York", preferences));
  const savedPreferences: VolunteerSchedulingPreferences = {
    ...preferences,
    servingFrequency: "monthly",
    updatedAt: "signed-in-revision-2",
  };
  mockUpdateMySchedulingPreferences.mockResolvedValue({
    success: true,
    schedulingPreferences: savedPreferences,
    memberSnapshot: memberSnapshotFor(savedPreferences),
  });
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/my-availability"]}>
        <GlobalInfoContext.Provider value={{
          churchId: "human-church",
          churchName: "Northside",
          userId: "human-volunteer",
          role: "member",
        } as ContextType<typeof GlobalInfoContext>}>
          <RoutedAvailability />
        </GlobalInfoContext.Provider>
      </MemoryRouter>
    </Provider>,
  );

  await user.click(await screen.findByRole("button", { name: "Edit preferences" }));
  await user.click(screen.getByRole("combobox", { name: /Serving frequency/ }));
  await user.click(screen.getByRole("option", { name: "Once a month" }));
  await user.click(screen.getByRole("button", { name: "Save preferences" }));
  await waitFor(() => expect(mockUpdateMySchedulingPreferences).toHaveBeenCalledWith("human-church", {
    servingFrequency: "monthly",
    recurringAvailability: { weeksOfMonth: [], includeLastWeekOfMonth: false },
    expectedUpdatedAt: "signed-in-revision",
  }));
});

it("uses current preference defaults and canceling does not mutate them", async () => {
  const user = userEvent.setup();
  const defaults: VolunteerSchedulingPreferences = {
    servingFrequency: "as_needed",
    recurringAvailability: { weeksOfMonth: [], includeLastWeekOfMonth: false },
    updatedAt: "default-baseline",
  };
  const savePreferences = jest.fn();
  renderPage(makeAccess(
    jest.fn().mockResolvedValue(makeRead([], "America/New_York", defaults)),
    jest.fn(),
    "member-1",
    savePreferences,
  ));

  expect(await screen.findByText("As often as needed")).toBeInTheDocument();
  expect(screen.getByText("Every week")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Edit preferences" }));
  await user.click(screen.getByRole("checkbox", { name: "1st week" }));
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(savePreferences).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Save preferences" })).not.toBeInTheDocument();
  expect(screen.getByText("Every week")).toBeInTheDocument();
});

it("drops fallback preferences after the summary confirms they are unavailable", async () => {
  const pendingSummary = deferred<VolunteerAvailabilityRead>();
  const fallback: VolunteerSchedulingPreferences = {
    servingFrequency: "monthly",
    recurringAvailability: { weeksOfMonth: [2], includeLastWeekOfMonth: false },
    updatedAt: "stale-member-revision",
  };
  renderPage(makeAccess(() => pendingSummary.promise, jest.fn()), fallback);

  expect(screen.getByText("Once a month")).toBeInTheDocument();
  await act(async () => {
    pendingSummary.resolve(makeRead([]));
    await pendingSummary.promise;
  });

  await waitFor(() => expect(screen.queryByText("Once a month")).not.toBeInTheDocument());
  expect(screen.queryByRole("button", { name: "Edit preferences" })).not.toBeInTheDocument();
});

it("keeps preference edits across a stale-revision conflict until explicitly reconciled", async () => {
  const user = userEvent.setup();
  const existing: VolunteerSchedulingPreferences = {
    servingFrequency: "twice_monthly",
    recurringAvailability: { weeksOfMonth: [1, 3], includeLastWeekOfMonth: false },
    updatedAt: "preferences-1",
  };
  const latest: VolunteerSchedulingPreferences = {
    servingFrequency: "weekly",
    recurringAvailability: { weeksOfMonth: [2], includeLastWeekOfMonth: false },
    updatedAt: "preferences-2",
  };
  const loadAvailability = jest.fn()
    .mockResolvedValueOnce(makeRead([], "America/New_York", existing))
    .mockResolvedValueOnce(makeRead([], "America/New_York", latest));
  const staleError = Object.assign(new Error("stale"), { status: 409 });
  const savePreferences = jest.fn()
    .mockRejectedValueOnce(staleError)
    .mockResolvedValueOnce({ success: true, schedulingPreferences: {
      servingFrequency: "monthly",
      recurringAvailability: { weeksOfMonth: [1, 3], includeLastWeekOfMonth: false },
      updatedAt: "preferences-3",
    }, memberSnapshot: memberSnapshotFor({
      servingFrequency: "monthly",
      recurringAvailability: { weeksOfMonth: [1, 3], includeLastWeekOfMonth: false },
      updatedAt: "preferences-3",
    }) });
  renderPage(makeAccess(loadAvailability, jest.fn(), "member-1", savePreferences));

  await user.click(await screen.findByRole("button", { name: "Edit preferences" }));
  await user.click(screen.getByRole("combobox", { name: /Serving frequency/ }));
  await user.click(screen.getByRole("option", { name: "Once a month" }));
  await user.click(screen.getByRole("button", { name: "Save preferences" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Your saved preferences changed while you were editing");
  expect(screen.getByRole("button", { name: "Keep my edits" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Keep my edits" }));
  await user.click(screen.getByRole("button", { name: "Save preferences" }));

  await waitFor(() => expect(savePreferences).toHaveBeenNthCalledWith(2, expect.objectContaining({
    servingFrequency: "monthly",
    expectedUpdatedAt: "preferences-2",
  })));
  expect(await screen.findByText("Once a month")).toBeInTheDocument();
});

it("protects unsaved preference edits when leaving the unified workspace", async () => {
  const user = userEvent.setup();
  const preferences: VolunteerSchedulingPreferences = {
    servingFrequency: "twice_monthly",
    recurringAvailability: { weeksOfMonth: [1, 3], includeLastWeekOfMonth: false },
    updatedAt: "preferences-1",
  };
  renderPage(makeAccess(
    jest.fn().mockResolvedValue(makeRead([], "America/New_York", preferences)),
    jest.fn(),
    "member-1",
    jest.fn(),
  ));

  await user.click(await screen.findByRole("button", { name: "Edit preferences" }));
  await user.click(screen.getByRole("combobox", { name: /Serving frequency/ }));
  await user.click(screen.getByRole("option", { name: "Once a month" }));
  await user.click(screen.getByRole("link", { name: "Home" }));
  expect(await screen.findByRole("dialog", { name: "Unsaved changes" })).toBeInTheDocument();
  expect(screen.getByTestId("current-location")).toHaveTextContent("/my-availability");
  await user.click(screen.getByRole("button", { name: "Stay" }));
  expect(screen.getByRole("button", { name: "Save preferences" })).toBeInTheDocument();
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

  const card = await screen.findByRole("group", { name: "New availability request" });
  expect(card).toHaveTextContent("Response needed");
  expect(card).not.toHaveTextContent("unanswered");
  expect(screen.getByRole("region", { name: "Availability requests" })).toContainElement(card);
});

it("loads a lightweight summary first and fetches one request only when opened", async () => {
  const user = userEvent.setup();
  const request = makeRequest();
  const loadAvailability = jest.fn().mockResolvedValue(makeRead([request]));
  renderPage(makeAccess(loadAvailability, jest.fn()));

  const card = await findRequestCard();
  expect(card).toBeInTheDocument();
  expect(loadAvailability).toHaveBeenCalledTimes(1);
  expect(loadAvailability).toHaveBeenNthCalledWith(1, { summary: true });

  await user.click(card);
  expect(await screen.findByRole("heading", { name: "November availability" })).toBeInTheDocument();
  expect(loadAvailability).toHaveBeenNthCalledWith(2, { recipientId: "recipient-1" });
  expect(loadAvailability).not.toHaveBeenCalledWith({ summary: true, history: true });
});

it("keeps request details informational and opens the editor only from its action", async () => {
  const user = userEvent.setup();
  const initial = makeRequest({
    respondedAt: "",
    submissionId: "",
    availability: {},
    unansweredOccurrenceIds: [...ids],
  });
  const loadAvailability = jest.fn().mockResolvedValue(makeRead([initial]));
  renderPage(makeAccess(loadAvailability, jest.fn()));

  const action = await findRequestCard();
  const card = screen.getByRole("group", { name: "November availability" });
  expect(within(card).getAllByRole("button")).toHaveLength(1);
  expect(action).toHaveAttribute("data-variant", "presentCta");

  await user.click(within(card).getByText("November availability"));
  expect(screen.getByTestId("current-location")).toHaveTextContent("/my-availability");
  expect(screen.queryByRole("heading", { name: "November availability" })).not.toBeInTheDocument();
  expect(loadAvailability).toHaveBeenCalledTimes(1);

  await user.click(action);
  expect(await screen.findByRole("heading", { name: "November availability" })).toBeInTheDocument();
  expect(screen.getByTestId("current-location")).toHaveTextContent("availabilityRequest=recipient-1");
});

it("opens a focused request directly without an overview summary read", async () => {
  const user = userEvent.setup();
  const request = makeRequest();
  const loadAvailability = jest.fn().mockResolvedValue(makeRead([request]));
  renderPage(makeAccess(loadAvailability, jest.fn()), null, "/my-availability?availabilityRequest=recipient-1");

  expect(await screen.findByRole("heading", { name: "November availability" })).toBeInTheDocument();
  expect(loadAvailability.mock.calls.map(([options]) => options)).toEqual([
    { recipientId: "recipient-1" },
  ]);
  expect(screen.queryByRole("region", { name: "Availability requests" })).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Back to My Schedule" }));
  expect(await screen.findByRole("region", { name: "Availability requests" })).toBeInTheDocument();
  expect(screen.getByTestId("current-location")).toHaveTextContent("/my-availability");
  expect(loadAvailability.mock.calls.map(([options]) => options)).toEqual([
    { recipientId: "recipient-1" },
    { summary: true },
  ]);
});

it("offers a scoped detail retry without losing the selected request", async () => {
  const user = userEvent.setup();
  const request = makeRequest();
  const loadAvailability = jest.fn()
    .mockResolvedValueOnce(makeRead([request]))
    .mockRejectedValueOnce(new Error("Detail network unavailable"))
    .mockResolvedValueOnce(makeRead([request]));
  renderPage(makeAccess(loadAvailability, jest.fn()));

  await user.click(await findRequestCard());
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load this availability request.");
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("heading", { name: "November availability" })).toBeInTheDocument();
  expect(loadAvailability.mock.calls.map(([options]) => options)).toEqual([
    { summary: true },
    { recipientId: "recipient-1" },
    { recipientId: "recipient-1" },
  ]);
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
    .mockResolvedValueOnce(makeRead([initial]))
    .mockResolvedValueOnce(makeRead([submitted]));
  const saveAvailability = jest.fn().mockResolvedValue(
    confirmedAvailabilitySave(initial, "submission-initial", "2099-10-21T12:00:00.000Z"),
  );
  renderPage(makeAccess(loadAvailability, saveAvailability));

  await user.click(await screen.findByRole("button", { name: requestCardName("November availability") }));
  expect(screen.getByRole("heading", { name: "Select services you can serve" })).toBeInTheDocument();
  expect(screen.queryByText("Checked means available. When you submit, unchecked services will be unavailable.")).not.toBeInTheDocument();
  const firstService = screen.getByRole("checkbox", { name: /Sunday 1.*9:00 AM EST/ });
  const secondService = screen.getByRole("checkbox", { name: /Sunday 2/ });
  expect(firstService).not.toBeChecked();
  await user.click(firstService);
  expect(screen.getByText("1 of 3 selected")).toBeInTheDocument();
  await user.click(secondService);
  expect(screen.getByText("2 of 3 selected")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Review response" }));
  expect(screen.getByRole("dialog", { name: "Review your response" }))
    .toHaveTextContent("You're about to submit 2 available, 1 unavailable services.");
  expect(saveAvailability).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Submit response" }));

  await waitFor(() => expect(saveAvailability).toHaveBeenCalledWith({
    recipientId: "recipient-1",
    availability: { [ids[0]]: "available", [ids[1]]: "available", [ids[2]]: "unavailable" },
    availabilityRevision: { [ids[0]]: 0, [ids[1]]: 0, [ids[2]]: 0 },
  }));
  const submittedGroup = await screen.findByRole("region", { name: "Availability requests" });
  expect(within(submittedGroup).getByRole("group", { name: "November availability" }))
    .toHaveTextContent("Response submitted");
  expect(screen.getByRole("region", { name: "Availability requests" }))
    .toContainElement(screen.getByRole("button", { name: requestCardName("November availability") }));
  expect(screen.getByRole("group", { name: "November availability" }))
    .toHaveTextContent("Response submitted");
});

it("keeps availability in a simple date list without an organize mode switch", async () => {
  const user = userEvent.setup();
  const request = makeRequest({
    respondedAt: "",
    submissionId: "",
    availability: {},
    unansweredOccurrenceIds: [...ids],
  });
  renderPage(makeAccess(jest.fn().mockResolvedValue(makeRead([request])), jest.fn()));

  await user.click(await screen.findByRole("button", { name: requestCardName("November availability") }));
  expect(screen.queryByRole("button", { name: "By date" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "By service" })).not.toBeInTheDocument();
  expect(screen.getAllByRole("checkbox")).toHaveLength(3);
  expect(screen.getByRole("heading", { name: "November 08, 2099" })).toBeInTheDocument();
  await user.click(screen.getByRole("checkbox", { name: /Sunday 1/ }));
  expect(screen.getByRole("checkbox", { name: /Sunday 1/ })).toBeChecked();
  expect(screen.getAllByRole("heading", { level: 4 })).toHaveLength(3);
  expect(screen.getByRole("heading", { name: "November 15, 2099" })).toBeInTheDocument();
});

it("writes one projected grouped answer through to every issued occurrence ID", async () => {
  const user = userEvent.setup();
  const groupId = "group:1jrege3bu2c6hs0lrc7c@2026-11-07";
  const standaloneId = "1j8r6dqu4anb91e4jac8@2026-11-07";
  const request = makeRequest({
    respondedAt: "2099-10-20T12:00:00.000Z",
    submissionId: "submitted-1",
    occurrences: [{
      occurrenceId: groupId,
      responseOccurrenceIds: [groupId, standaloneId],
      name: "Sabbath Service & 2nd service",
      startsAt: "2026-11-07T14:00:00.000Z",
      serviceDate: "2026-11-07",
    }],
    availability: { [groupId]: "available" },
    unansweredOccurrenceIds: [],
    availabilityRevision: { [groupId]: 4, [standaloneId]: 7 },
  });
  const saved = makeRequest({
    ...request,
    availability: { [groupId]: "unavailable" },
    availabilityRevision: { [groupId]: 5, [standaloneId]: 8 },
  });
  const loadAvailability = jest.fn()
    .mockResolvedValueOnce(makeRead([request]))
    .mockResolvedValueOnce(makeRead([request]))
    .mockResolvedValueOnce(makeRead([saved]));
  const saveAvailability = jest.fn().mockResolvedValue({ success: true, submissionId: "submitted-2" });
  renderPage(makeAccess(loadAvailability, saveAvailability));

  await user.click(await screen.findByRole("button", { name: requestCardName("November availability") }));
  const service = screen.getByRole("checkbox", { name: /Sabbath Service & 2nd service/ });
  await user.click(service);
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await user.click(screen.getByRole("button", { name: "Submit response" }));

  await waitFor(() => expect(saveAvailability).toHaveBeenCalledWith({
    recipientId: "recipient-1",
    availability: { [groupId]: "unavailable", [standaloneId]: "unavailable" },
    availabilityRevision: { [groupId]: 4, [standaloneId]: 7 },
  }));
});

it("requires an explicit three-state choice to reconcile conflicting grouped answers", async () => {
  const user = userEvent.setup();
  const groupId = "group:1jrege3bu2c6hs0lrc7c@2026-11-07";
  const standaloneId = "1j8r6dqu4anb91e4jac8@2026-11-07";
  const request = makeRequest({
    respondedAt: "2099-10-20T12:00:00.000Z",
    submissionId: "submitted-1",
    occurrences: [{
      occurrenceId: groupId,
      responseOccurrenceIds: [groupId, standaloneId],
      hasConflictingAnswers: true,
      name: "Sabbath Service & 2nd service",
      startsAt: "2026-11-07T14:00:00.000Z",
      serviceDate: "2026-11-07",
    }],
    availability: {},
    unansweredOccurrenceIds: [groupId],
    availabilityRevision: { [groupId]: 4, [standaloneId]: 7 },
    conflictingOccurrenceIds: [groupId],
  });
  const saveAvailability = jest.fn().mockResolvedValue({ success: true, submissionId: "submitted-2" });
  renderPage(makeAccess(jest.fn().mockResolvedValue(makeRead([request])), saveAvailability));

  await user.click(await screen.findByRole("button", { name: requestCardName("November availability") }));
  const resolution = screen.getByRole("combobox", { name: /Resolve saved answers for Sabbath Service/ });
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await user.click(resolution);
  await user.click(screen.getByRole("option", { name: "Not answered" }));
  expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Save changes" }));

  await waitFor(() => expect(saveAvailability).toHaveBeenCalledWith({
    recipientId: "recipient-1",
    availability: {},
    availabilityRevision: { [groupId]: 4, [standaloneId]: 7 },
  }));
});

it("preserves historical grouped and individual occurrences with conflicting answers and revisions", async () => {
  const user = userEvent.setup();
  const groupedId = "group:1jrege3bu2c6hs0lrc7c@2026-11-07";
  const individualId = "1j8r6dqu4anb91e4jac8@2026-11-07";
  const unrelatedId = "unrelated-service@2026-11-14";
  const historical = makeRequest({
    name: "November availability",
    occurrences: [
      {
        occurrenceId: groupedId,
        name: "Sabbath Service & 2nd service",
        startsAt: "2026-11-07T14:00:00.000Z",
        serviceDate: "2026-11-07",
      },
      {
        occurrenceId: individualId,
        name: "Sabbath Service",
        startsAt: "2026-11-07T14:00:00.000Z",
        serviceDate: "2026-11-07",
      },
      {
        occurrenceId: unrelatedId,
        name: "Other service",
        startsAt: "2026-11-14T14:00:00.000Z",
        serviceDate: "2026-11-14",
      },
    ],
    availability: { [groupedId]: "available", [individualId]: "unavailable", [unrelatedId]: "unavailable" },
    unansweredOccurrenceIds: [],
    availabilityRevision: { [groupedId]: 4, [individualId]: 2, [unrelatedId]: 7 },
  });
  const saveAvailability = jest.fn().mockResolvedValue({ success: true, submissionId: "historical-response" });
  renderPage(makeAccess(jest.fn().mockResolvedValue(makeRead([historical])), saveAvailability));

  await user.click(await screen.findByRole("button", { name: requestCardName("November availability") }));
  const groupedOccurrence = screen.getByRole("checkbox", { name: /Sabbath Service & 2nd service/ });
  const individualOccurrence = screen.getByRole("checkbox", { name: /Sabbath Service, November 07, 2026/ });
  expect(groupedOccurrence).toBeChecked();
  expect(individualOccurrence).not.toBeChecked();

  expect(screen.getAllByRole("checkbox")).toHaveLength(3);
  expect(groupedOccurrence).toBeChecked();
  expect(individualOccurrence).not.toBeChecked();
  await user.click(screen.getByRole("checkbox", { name: /I can serve at Other service/ }));

  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(saveAvailability).toHaveBeenCalledWith({
    recipientId: "recipient-1",
    availability: { [groupedId]: "available", [individualId]: "unavailable", [unrelatedId]: "available" },
    availabilityRevision: { [groupedId]: 4, [individualId]: 2, [unrelatedId]: 7 },
  }));
});

it("keeps the date in the By date heading while retaining a full accessible date and time", async () => {
  const user = userEvent.setup();
  const request = makeRequest({ respondedAt: "", submissionId: "", availability: {}, unansweredOccurrenceIds: [...ids] });
  renderPage(makeAccess(jest.fn().mockResolvedValue(makeRead([request])), jest.fn()));

  await user.click(await screen.findByRole("button", { name: requestCardName("November availability") }));
  expect(screen.getByRole("heading", { name: "November 08, 2099" })).toBeInTheDocument();
  const firstService = screen.getByRole("checkbox", { name: /Sunday 1.*9:00 AM EST/ });
  expect(firstService).toHaveAccessibleName(/November 08, 2099/);
  expect(within(screen.getByRole("region", { name: "November 08, 2099" })).getByText("9:00 AM EST")).toBeInTheDocument();
  expect(screen.queryByText("November 08, 2099 · 9:00 AM EST")).not.toBeInTheDocument();
});

it("marks past services without disabling them before the request deadline", async () => {
  const user = userEvent.setup();
  const pastId = "past-service@2000-09-06";
  const request = makeRequest({
    respondedAt: "",
    submissionId: "",
    occurrences: [{ occurrenceId: pastId, name: "Past Sabbath Service", startsAt: "2000-09-06T14:00:00.000Z", serviceDate: "2000-09-06" }],
    availability: {},
    unansweredOccurrenceIds: [pastId],
    availabilityRevision: { [pastId]: 3 },
  });
  const saveAvailability = jest.fn().mockResolvedValue({ success: true, submissionId: "past-service-response" });
  renderPage(makeAccess(jest.fn().mockResolvedValue(makeRead([request])), saveAvailability));

  await user.click(await screen.findByRole("button", { name: requestCardName("November availability") }));
  expect(screen.getByText("1 past")).toBeInTheDocument();
  expect(screen.queryByText("Past service")).not.toBeInTheDocument();
  const pastService = screen.getByRole("checkbox", { name: /Past Sabbath Service/ });
  expect(pastService).toBeEnabled();
  await user.click(pastService);
  await user.click(screen.getByRole("button", { name: "Review response" }));
  await user.click(screen.getByRole("button", { name: "Submit response" }));

  await waitFor(() => expect(saveAvailability).toHaveBeenCalledWith(expect.objectContaining({
    availability: { [pastId]: "available" },
    availabilityRevision: { [pastId]: 3 },
  })));
});

it("keeps an availability draft when application navigation is canceled", async () => {
  const user = userEvent.setup();
  const request = makeRequest({ respondedAt: "", submissionId: "", availability: {}, unansweredOccurrenceIds: [...ids] });
  renderPage(makeAccess(jest.fn().mockResolvedValue(makeRead([request])), jest.fn()));

  await user.click(await screen.findByRole("button", { name: requestCardName("November availability") }));
  const firstService = screen.getByRole("checkbox", { name: /Sunday 1/ });
  await user.click(firstService);
  await user.click(screen.getByRole("link", { name: "Home" }));

  const navigationWarning = await screen.findByRole("dialog", { name: "Unsaved changes" });
  expect(screen.getByTestId("current-location")).toHaveTextContent("/my-availability");
  await user.click(within(navigationWarning).getByRole("button", { name: "Stay" }));

  expect(screen.getByRole("checkbox", { name: /Sunday 1/ })).toBeChecked();
  expect(screen.getByTestId("current-location")).toHaveTextContent("/my-availability");
});

it("blocks application navigation while an availability response is saving", async () => {
  const user = userEvent.setup();
  const pendingSave = deferred<VolunteerAvailabilitySaveResult>();
  const request = makeRequest({ respondedAt: "", submissionId: "", availability: {}, unansweredOccurrenceIds: [...ids] });
  const submitted = makeRequest({
    availability: Object.fromEntries(ids.map((id) => [id, "available"])),
    unansweredOccurrenceIds: [],
  });
  const loadAvailability = jest.fn()
    .mockResolvedValueOnce(makeRead([request]))
    .mockResolvedValueOnce(makeRead([request]))
    .mockResolvedValue(makeRead([submitted]));
  const saveAvailability = jest.fn().mockReturnValue(pendingSave.promise);
  renderPage(makeAccess(loadAvailability, saveAvailability));

  await user.click(await screen.findByRole("button", { name: requestCardName("November availability") }));
  await user.click(screen.getByRole("checkbox", { name: /Sunday 1/ }));
  await user.click(screen.getByRole("button", { name: "Review response" }));
  await user.click(screen.getByRole("button", { name: "Submit response" }));
  await waitFor(() => expect(saveAvailability).toHaveBeenCalled());
  await user.click(screen.getByRole("link", { name: "Home" }));

  const savingWarning = await screen.findByRole("dialog", { name: "Saving changes" });
  expect(screen.getByTestId("current-location")).toHaveTextContent("/my-availability");
  await user.click(within(savingWarning).getByRole("button", { name: "Stay on page" }));
  expect(screen.getByTestId("current-location")).toHaveTextContent("/my-availability");

  await act(async () => {
    pendingSave.resolve(confirmedAvailabilitySave(request, "saved-while-protected", "2099-10-21T12:00:00.000Z"));
  });
  expect(await screen.findByRole("button", { name: requestCardName("November availability") })).toBeInTheDocument();
});

it("keeps availability requests in the unified view without volunteer page navigation", async () => {
  renderPage(makeAccess(jest.fn().mockResolvedValue(makeRead([])), jest.fn()));

  expect(screen.queryByRole("navigation", { name: "Volunteer pages" })).not.toBeInTheDocument();
  expect(screen.queryByTestId("volunteer-desktop-sidebar")).not.toBeInTheDocument();
  expect(screen.queryByTestId("volunteer-mobile-bottom-navigation")).not.toBeInTheDocument();
});

it("keeps the latest direct-link request visible when an earlier detail read finishes late", async () => {
  const user = userEvent.setup();
  const first = makeRequest({ recipientId: "recipient-1", name: "First request" });
  const second = makeRequest({ recipientId: "recipient-2", formId: "form-2", name: "Second request" });
  const firstDetail = deferred<VolunteerAvailabilityRead>();
  const secondDetail = deferred<VolunteerAvailabilityRead>();
  const loadAvailability = jest.fn((options?: { recipientId?: string }) => {
    if (options?.recipientId === first.recipientId) return firstDetail.promise;
    if (options?.recipientId === second.recipientId) return secondDetail.promise;
    return Promise.resolve(makeRead([first, second]));
  });
  renderSwitchablePage(makeAccess(loadAvailability, jest.fn()));

  await user.click(screen.getByRole("button", { name: "Open first request" }));
  await waitFor(() => expect(loadAvailability).toHaveBeenCalledWith({ recipientId: first.recipientId }));
  await user.click(screen.getByRole("button", { name: "Open second request" }));
  await waitFor(() => expect(loadAvailability).toHaveBeenCalledWith({ recipientId: second.recipientId }));

  await act(async () => secondDetail.resolve(makeRead([second])));
  expect(await screen.findByRole("heading", { name: "Second request" })).toBeInTheDocument();
  await act(async () => firstDetail.resolve(makeRead([first])));

  expect(screen.getByRole("heading", { name: "Second request" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "First request" })).not.toBeInTheDocument();
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
    .mockResolvedValueOnce(makeRead([initial]))
    .mockResolvedValueOnce(makeRead([submitted]));
  const saveAvailability = jest.fn().mockResolvedValue({ success: true, submissionId: "all-available" });
  renderPage(makeAccess(loadAvailability, saveAvailability));

  await user.click(await screen.findByRole("button", { name: requestCardName("November availability") }));
  await user.click(screen.getByRole("button", { name: "Select all" }));
  expect(screen.getByText("3 of 3 selected")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Review response" }));
  const confirmation = screen.getByRole("dialog", { name: "Review your response" });
  expect(confirmation).toHaveTextContent("3 available");
  expect(confirmation).toHaveTextContent("0 unavailable");
  expect(confirmation).toHaveTextContent("0 unanswered");
  await user.click(screen.getByRole("button", { name: "Submit response" }));

  await waitFor(() => expect(saveAvailability).toHaveBeenCalledWith(expect.objectContaining({
    availability: Object.fromEntries(ids.map((id) => [id, "available"])),
    availabilityRevision: Object.fromEntries(ids.map((id) => [id, 0])),
  })));
});

it("selects eligible services while leaving an unresolved conflict for an explicit choice", async () => {
  const user = userEvent.setup();
  const conflict = makeRequest({
    conflictingOccurrenceIds: [ids[1]],
    availability: { [ids[0]]: "unavailable" },
    unansweredOccurrenceIds: [ids[1], ids[2]],
  });
  renderPage(makeAccess(jest.fn().mockResolvedValue(makeRead([conflict])), jest.fn()));

  await user.click(await screen.findByRole("button", { name: requestCardName("November availability") }));
  await user.click(screen.getByRole("button", { name: "Select all" }));
  expect(screen.getByRole("checkbox", { name: /Sunday 1/ })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: /Sunday 2/ })).not.toBeChecked();
  expect(screen.getByRole("checkbox", { name: /Sunday 3/ })).toBeChecked();
  expect(screen.getByText("2 of 3 selected")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();

  await user.click(screen.getByRole("checkbox", { name: /Sunday 2/ }));
  expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
});

it("uses the committed response summary without a post-save detail read", async () => {
  const user = userEvent.setup();
  const initial = makeRequest({ respondedAt: "", submissionId: "", availability: {}, unansweredOccurrenceIds: [...ids] });
  const submittedAt = "2099-10-21T12:00:00.000Z";
  const loadAvailability = jest.fn()
    .mockResolvedValueOnce(makeRead([initial]))
    .mockResolvedValueOnce(makeRead([initial]));
  const saveAvailability = jest.fn().mockResolvedValue(
    confirmedAvailabilitySave(initial, "committed-summary", submittedAt),
  );
  renderPage(makeAccess(loadAvailability, saveAvailability));

  await user.click(await screen.findByRole("button", { name: requestCardName("November availability") }));
  await user.click(screen.getByRole("checkbox", { name: /Sunday 1/ }));
  await user.click(screen.getByRole("button", { name: "Review response" }));
  await user.click(screen.getByRole("button", { name: "Submit response" }));

  expect(await screen.findByRole("button", { name: requestCardName("November availability") })).toBeInTheDocument();
  expect(screen.getByRole("group", { name: "November availability" })).toHaveTextContent("Response submitted");
  expect(loadAvailability).toHaveBeenCalledTimes(2);
  expect(saveAvailability).toHaveBeenCalledTimes(1);
});

it("keeps service checkboxes keyboard operable at a narrow viewport", async () => {
  const user = userEvent.setup();
  const originalWidth = window.innerWidth;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 375 });
  const initial = makeRequest({ respondedAt: "", submissionId: "", availability: {}, unansweredOccurrenceIds: [...ids] });
  renderPage(makeAccess(jest.fn().mockResolvedValue(makeRead([initial])), jest.fn()));

  await user.click(await screen.findByRole("button", { name: requestCardName("November availability") }));
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
    .mockResolvedValueOnce(makeRead([initial]))
    .mockResolvedValueOnce(makeRead([submitted]));
  const saveAvailability = jest.fn().mockResolvedValue(
    confirmedAvailabilitySave(initial, "all-unavailable", "2099-10-21T12:00:00.000Z"),
  );
  renderPage(makeAccess(loadAvailability, saveAvailability));

  await user.click(await screen.findByRole("button", { name: requestCardName("November availability") }));
  await user.click(screen.getByRole("button", { name: "Review response" }));
  const confirmation = screen.getByRole("dialog", { name: "Review your response" });
  expect(confirmation).toHaveTextContent("You haven't selected any services. Are you unavailable for all of them?");
  expect(confirmation).toHaveTextContent("0 available");
  expect(confirmation).toHaveTextContent("3 unavailable");
  expect(confirmation).toHaveTextContent("0 unanswered");
  await user.click(within(confirmation).getByRole("button", { name: "Cancel" }));
  expect(saveAvailability).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Review response" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Review response" }));
  await user.click(screen.getByRole("button", { name: "Submit response" }));
  await waitFor(() => expect(saveAvailability).toHaveBeenCalledWith(expect.objectContaining({
    availability: Object.fromEntries(ids.map((id) => [id, "unavailable"])),
  })));
  expect(await screen.findByRole("region", { name: "Availability requests" }))
    .toHaveTextContent("Response submitted");
});

it("keeps an initial request unsubmitted when its save fails", async () => {
  const user = userEvent.setup();
  const initial = makeRequest({ respondedAt: "", submissionId: "", availability: {}, unansweredOccurrenceIds: [...ids] });
  const loadAvailability = jest.fn()
    .mockResolvedValueOnce(makeRead([initial]))
    .mockResolvedValueOnce(makeRead([initial]))
    .mockResolvedValueOnce(makeRead([initial]));
  const saveAvailability = jest.fn().mockRejectedValue(Object.assign(new Error("Save rejected"), { status: 500 }));
  renderPage(makeAccess(loadAvailability, saveAvailability));

  await user.click(await screen.findByRole("button", { name: requestCardName("November availability") }));
  await user.click(screen.getByRole("checkbox", { name: /Sunday 1/ }));
  await user.click(screen.getByRole("button", { name: "Review response" }));
  await user.click(screen.getByRole("button", { name: "Submit response" }));
  expect(await screen.findByRole("button", { name: "Review latest saved answers" })).toBeInTheDocument();
  expect(saveAvailability).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "Back to My Schedule" }));
  await user.click(screen.getByRole("button", { name: "Discard changes" }));

  expect(screen.getByRole("region", { name: "Availability requests" }))
    .toHaveTextContent("Response needed");
});

it("preserves unanswered historical services while editing saved choices with checkboxes", async () => {
  const user = userEvent.setup();
  const partial = makeRequest({
    respondedAt: "",
    submissionId: "",
    availability: { [ids[0]]: "available" },
    unansweredOccurrenceIds: [ids[1], ids[2]],
  });
  const saveAvailability = jest.fn().mockResolvedValue({ success: true, submissionId: "legacy-finalized" });
  renderPage(makeAccess(jest.fn().mockResolvedValue(makeRead([partial])), saveAvailability));

  await user.click(await screen.findByRole("button", { name: requestCardName("November availability") }));
  expect(screen.getByRole("checkbox", { name: /Sunday 1/ })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: /Sunday 2/ })).not.toBeChecked();
  expect(screen.getAllByText("Not answered")).toHaveLength(2);
  expect(screen.getAllByRole("button", { name: "Mark unavailable" })).toHaveLength(2);
  await user.click(screen.getByRole("checkbox", { name: /Sunday 1/ }));
  await user.click(screen.getByRole("button", { name: "Review response" }));
  expect(screen.getByRole("dialog", { name: "Review your response" }))
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
    .mockResolvedValueOnce(makeRead([legacy]))
    .mockResolvedValueOnce(makeRead([submitted]));
  const saveAvailability = jest.fn().mockResolvedValue({ success: true, submissionId: "legacy-finalized" });
  renderPage(makeAccess(loadAvailability, saveAvailability));

  await user.click(await screen.findByRole("button", { name: requestCardName("November availability") }));
  const moreActions = within(screen.getByRole("group", { name: /I can serve at Sunday 1/ }))
    .getByRole("button", { name: "More actions for Sunday 1" });
  moreActions.focus();
  await user.keyboard("{Enter}");
  await user.keyboard("{Enter}");
  expect(screen.queryByRole("menuitem", { name: "Clear response" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Review response" }));
  expect(screen.getByRole("dialog", { name: "Review your response" }))
    .toHaveTextContent("0 available, 0 unavailable, and 3 unanswered");
  await user.click(screen.getByRole("button", { name: "Submit response" }));

  await waitFor(() => expect(saveAvailability).toHaveBeenCalledWith({
    recipientId: "recipient-1",
    availability: {},
    availabilityRevision: { [ids[0]]: 0, [ids[1]]: 0, [ids[2]]: 0 },
  }));
  expect(await screen.findByRole("region", { name: "Availability requests" }))
    .toHaveTextContent("Response submitted");
});

it("shows active requests and omits closed requests from the routine list", async () => {
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

  const requests = await screen.findByRole("region", { name: "Availability requests" });
  expect(within(requests).getAllByRole("button")).toHaveLength(2);
  expect(within(requests).getByRole("group", { name: "Open request" }))
    .toHaveTextContent("Response needed");
  expect(within(requests).getByRole("group", { name: "Submitted request" }))
    .toHaveTextContent("Response submitted");
  expect(screen.queryByText("Closed without response")).not.toBeInTheDocument();
  expect(screen.queryByText("Closed with response")).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Closed" })).not.toBeInTheDocument();
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
    .mockResolvedValueOnce(makeRead([saved]))
    .mockResolvedValueOnce(makeRead([cleared]));
  const saveAvailability = jest.fn().mockResolvedValue({ success: true, submissionId: "submission-1" });
  renderPage(makeAccess(loadAvailability, saveAvailability));

  await user.click(await screen.findByRole("button", { name: requestCardName("November availability") }));
  expect(screen.getByRole("checkbox", { name: /Sunday 1/ })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: /Sunday 2/ })).not.toBeChecked();
  await user.click(within(screen.getByRole("group", { name: /I can serve at Sunday 1/ }))
    .getByRole("button", { name: "More actions for Sunday 1" }));
  await user.click(screen.getByRole("menuitem", { name: "Clear response" }));
  const clearedService = within(screen.getByRole("group", { name: /I can serve at Sunday 1/ }));
  expect(clearedService.getByText("Not answered")).toBeInTheDocument();
  expect(clearedService.getByRole("button", { name: "Mark unavailable" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Save changes" }));

  await waitFor(() => expect(saveAvailability).toHaveBeenCalledWith({
    recipientId: "recipient-1",
    availability: { [ids[1]]: "unavailable", [ids[2]]: "available" },
    availabilityRevision: { [ids[0]]: 0, [ids[1]]: 0, [ids[2]]: 0 },
  }));
});

it("lets a volunteer choose available after clearing a saved answer", async () => {
  const user = userEvent.setup();
  const saved = makeRequest({
    availability: { [ids[0]]: "available", [ids[1]]: "unavailable", [ids[2]]: "available" },
    unansweredOccurrenceIds: [],
  });
  const loadAvailability = jest.fn().mockResolvedValue(makeRead([saved]));
  const saveAvailability = jest.fn().mockResolvedValue(
    confirmedAvailabilitySave(saved, "submission-after-clear", "2099-10-21T12:00:00.000Z"),
  );
  renderPage(makeAccess(loadAvailability, saveAvailability));

  await user.click(await screen.findByRole("button", { name: requestCardName("November availability") }));
  const firstService = screen.getByRole("checkbox", { name: /Sunday 1/ });
  const serviceGroup = within(screen.getByRole("group", { name: /I can serve at Sunday 1/ }));
  await user.click(serviceGroup.getByRole("button", { name: "More actions for Sunday 1" }));
  await user.click(screen.getByRole("menuitem", { name: "Clear response" }));
  expect(serviceGroup.getByText("Not answered")).toBeInTheDocument();

  await user.click(firstService);
  expect(firstService).toBeChecked();
  expect(serviceGroup.queryByText("Not answered")).not.toBeInTheDocument();
  await user.click(screen.getByRole("checkbox", { name: /Sunday 2/ }));
  await user.click(screen.getByRole("button", { name: "Save changes" }));

  await waitFor(() => expect(saveAvailability).toHaveBeenCalledWith(expect.objectContaining({
    availability: { [ids[0]]: "available", [ids[1]]: "available", [ids[2]]: "available" },
  })));
});

it("lets a volunteer explicitly mark a just-cleared answer unavailable", async () => {
  const user = userEvent.setup();
  const saved = makeRequest({
    availability: { [ids[0]]: "available", [ids[1]]: "unavailable", [ids[2]]: "available" },
    unansweredOccurrenceIds: [],
  });
  const loadAvailability = jest.fn().mockResolvedValue(makeRead([saved]));
  const saveAvailability = jest.fn().mockResolvedValue(
    confirmedAvailabilitySave(saved, "submission-after-clear", "2099-10-21T12:00:00.000Z"),
  );
  renderPage(makeAccess(loadAvailability, saveAvailability));

  await user.click(await screen.findByRole("button", { name: requestCardName("November availability") }));
  const serviceGroup = within(screen.getByRole("group", { name: /I can serve at Sunday 1/ }));
  await user.click(serviceGroup.getByRole("button", { name: "More actions for Sunday 1" }));
  await user.click(screen.getByRole("menuitem", { name: "Clear response" }));
  await user.click(serviceGroup.getByRole("button", { name: "Mark unavailable" }));
  expect(serviceGroup.queryByText("Not answered")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Save changes" }));

  await waitFor(() => expect(saveAvailability).toHaveBeenCalledWith(expect.objectContaining({
    availability: { [ids[0]]: "unavailable", [ids[1]]: "unavailable", [ids[2]]: "available" },
  })));
});

it("shows submitted requests and saves the complete scoped map with its revisions", async () => {
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
    return confirmedAvailabilitySave(savedRequest, "submission-1", savedRequest.respondedAt);
  });
  renderPage(makeAccess(loadAvailability, saveAvailability));

  const submittedResponses = await screen.findByRole("region", { name: "Availability requests" });
  expect(within(submittedResponses).getByRole("group", { name: "November availability" }))
    .toHaveTextContent("Response submitted");
  expect(screen.queryByText("October availability")).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Closed" })).not.toBeInTheDocument();
  expect(screen.queryByText("An unanswered date means you haven't responded. It doesn't mean you're unavailable."))
    .not.toBeInTheDocument();

  await user.click(within(submittedResponses).getByRole("button", { name: requestCardName("November availability") }));
  const firstService = screen.getByRole("checkbox", { name: /Sunday 1/ });
  await user.click(within(screen.getByRole("group", { name: /I can serve at Sunday 1/ }))
    .getByRole("button", { name: "More actions for Sunday 1" }));
  await user.click(screen.getByRole("menuitem", { name: "Clear response" }));
  const secondService = screen.getByRole("checkbox", { name: /Sunday 2/ });
  await user.click(secondService);
  expect(firstService).not.toBeChecked();
  expect(secondService).toBeChecked();

  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(saveAvailability).toHaveBeenCalledTimes(1));
  expect(saveAvailability).toHaveBeenCalledWith({
    recipientId: "recipient-1",
    availability: { [ids[1]]: "available", [ids[2]]: "unavailable" },
    availabilityRevision: { [ids[0]]: 0, [ids[1]]: 0, [ids[2]]: 0 },
  });
  expect(await screen.findByRole("group", { name: "November availability" }))
    .toHaveTextContent("Response submitted");
  expect(loadAvailability).toHaveBeenCalledTimes(2);
});

it("keeps a conflicting draft until the volunteer reviews and rebases it", async () => {
  const user = userEvent.setup();
  const original = makeRequest({
    availability: { [ids[0]]: "available", [ids[1]]: "unavailable" },
    unansweredOccurrenceIds: [ids[2]],
  });
  const latest = makeRequest({
    availability: { [ids[2]]: "available" },
    unansweredOccurrenceIds: [ids[0], ids[1]],
    availabilityRevision: { [ids[0]]: 1, [ids[1]]: 2, [ids[2]]: 1 },
  });
  const saved = makeRequest({
    availability: { [ids[0]]: "unavailable", [ids[2]]: "available" },
    unansweredOccurrenceIds: [ids[1]],
    availabilityRevision: { [ids[0]]: 2, [ids[1]]: 2, [ids[2]]: 2 },
    submissionId: "submission-after-conflict",
  });
  let readCount = 0;
  const loadAvailability = jest.fn(async () => {
    readCount += 1;
    return makeRead([readCount <= 2 ? original : readCount === 3 ? latest : saved]);
  });
  const conflict = Object.assign(new Error("Availability changed elsewhere"), { status: 409 });
  const saveAvailability = jest.fn()
    .mockRejectedValueOnce(conflict)
    .mockResolvedValueOnce(confirmedAvailabilitySave(saved, "submission-after-conflict", "2099-10-22T12:00:00.000Z"));
  renderPage(makeAccess(loadAvailability, saveAvailability));

  await user.click(await screen.findByRole("button", { name: requestCardName("November availability") }));
  const firstService = screen.getByRole("checkbox", { name: /Sunday 1/ });
  await user.click(firstService);
  await user.click(screen.getByRole("button", { name: "Save changes" }));

  expect(await screen.findByRole("button", { name: "Review latest saved answers" })).toBeInTheDocument();
  expect(firstService).not.toBeChecked();
  await user.click(screen.getByRole("button", { name: "Review latest saved answers" }));
  const firstComparison = within(
    within(screen.getByRole("alert")).getAllByRole("listitem")[0],
  );
  expect(firstComparison.getByText("Available", { selector: "dd" })).toBeInTheDocument();
  expect(firstComparison.getByText("Not answered", { selector: "dd" })).toBeInTheDocument();
  expect(firstComparison.getByText("Unavailable", { selector: "dd" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Keep my draft and continue" }));
  expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();

  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(saveAvailability).toHaveBeenCalledTimes(2));
  expect(saveAvailability.mock.calls[1][0].availabilityRevision).toEqual({
    [ids[0]]: 1,
    [ids[1]]: 2,
    [ids[2]]: 1,
  });
  expect(saveAvailability.mock.calls[1][0].availability).toEqual({
    [ids[0]]: "unavailable",
    [ids[2]]: "available",
  });
  expect(await screen.findByRole("button", { name: requestCardName("November availability") })).toBeInTheDocument();
});

it("keeps a newly introduced historical conflict unresolved after rebasing", async () => {
  const user = userEvent.setup();
  const original = makeRequest();
  const latest = makeRequest({
    availability: { [ids[2]]: "unavailable" },
    unansweredOccurrenceIds: [ids[0], ids[1]],
    conflictingOccurrenceIds: [ids[1]],
    availabilityRevision: { [ids[0]]: 1, [ids[1]]: 2, [ids[2]]: 0 },
  });
  const loadAvailability = jest.fn()
    .mockResolvedValueOnce(makeRead([original]))
    .mockResolvedValueOnce(makeRead([original]))
    .mockResolvedValueOnce(makeRead([latest]));
  const saveAvailability = jest.fn().mockRejectedValue(
    Object.assign(new Error("Availability changed elsewhere"), { status: 409 }),
  );
  renderPage(makeAccess(loadAvailability, saveAvailability));

  await user.click(await screen.findByRole("button", { name: requestCardName("November availability") }));
  await user.click(screen.getByRole("checkbox", { name: /Sunday 1/ }));
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await user.click(await screen.findByRole("button", { name: "Review latest saved answers" }));
  await user.click(screen.getByRole("button", { name: "Keep my draft and continue" }));

  const conflictingService = within(screen.getByRole("group", { name: /I can serve at Sunday 2/ }));
  expect(conflictingService.getByText("Saved answers conflict. Choose how to resolve this service."))
    .toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await user.click(conflictingService.getByRole("checkbox"));
  expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
});

it("adopts a closed request after a conflict and leaves it read-only", async () => {
  const user = userEvent.setup();
  const original = makeRequest();
  const closed = makeRequest({
    editable: false,
    availability: { [ids[0]]: "unavailable" },
    unansweredOccurrenceIds: [ids[1], ids[2]],
    availabilityRevision: { [ids[0]]: 1, [ids[1]]: 0, [ids[2]]: 0 },
  });
  const loadAvailability = jest.fn()
    .mockResolvedValueOnce(makeRead([original]))
    .mockResolvedValueOnce(makeRead([original]))
    .mockResolvedValueOnce(makeRead([closed]));
  const saveAvailability = jest.fn().mockRejectedValue(
    Object.assign(new Error("Availability changed elsewhere"), { status: 409 }),
  );
  renderPage(makeAccess(loadAvailability, saveAvailability));

  await user.click(await screen.findByRole("button", { name: requestCardName("November availability") }));
  await user.click(screen.getByRole("checkbox", { name: /Sunday 1/ }));
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await user.click(await screen.findByRole("button", { name: "Review latest saved answers" }));
  expect(screen.queryByRole("button", { name: "Keep my draft and continue" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Use latest answers" }));

  expect(screen.getByRole("heading", { name: "November availability" })).toBeInTheDocument();
  expect(screen.getByText(/Closed/)).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: /Sunday 1/ })).not.toBeChecked();
  expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
  expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
});

it("clears obsolete local clear state when the volunteer chooses the latest answers", async () => {
  const user = userEvent.setup();
  const original = makeRequest();
  const latest = makeRequest({
    availability: { [ids[0]]: "unavailable", [ids[1]]: "available" },
    unansweredOccurrenceIds: [ids[2]],
    availabilityRevision: { [ids[0]]: 1, [ids[1]]: 2, [ids[2]]: 0 },
  });
  const loadAvailability = jest.fn()
    .mockResolvedValueOnce(makeRead([original]))
    .mockResolvedValueOnce(makeRead([original]))
    .mockResolvedValueOnce(makeRead([latest]));
  const saveAvailability = jest.fn().mockRejectedValue(
    Object.assign(new Error("Availability changed elsewhere"), { status: 409 }),
  );
  renderPage(makeAccess(loadAvailability, saveAvailability));

  await user.click(await screen.findByRole("button", { name: requestCardName("November availability") }));
  await user.click(within(screen.getByRole("group", { name: /I can serve at Sunday 1/ }))
    .getByRole("button", { name: "More actions for Sunday 1" }));
  await user.click(screen.getByRole("menuitem", { name: "Clear response" }));
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await user.click(await screen.findByRole("button", { name: "Review latest saved answers" }));
  await user.click(screen.getByRole("button", { name: "Use latest answers" }));

  expect(screen.getByRole("checkbox", { name: /Sunday 1/ })).not.toBeChecked();
  expect(screen.getByRole("checkbox", { name: /Sunday 2/ })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: /Sunday 3/ })).not.toBeChecked();
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
});

it("reloads a changed raw occurrence mapping before saving its new scope", async () => {
  const user = userEvent.setup();
  const originalBase = makeRequest({
    availability: {},
    unansweredOccurrenceIds: [...ids],
    availabilityRevision: { "raw-old": 0, [ids[1]]: 0, [ids[2]]: 0 },
  });
  const original: VolunteerAvailabilityRequest = {
    ...originalBase,
    occurrences: originalBase.occurrences.map((occurrence, index) => index === 0
      ? { ...occurrence, responseOccurrenceIds: ["raw-old"] }
      : occurrence),
  };
  const latestBase = makeRequest({
    availability: { [ids[1]]: "unavailable" },
    unansweredOccurrenceIds: [ids[0], ids[2]],
    availabilityRevision: { "raw-new-a": 3, "raw-new-b": 4, [ids[1]]: 1, [ids[2]]: 0 },
  });
  const latest: VolunteerAvailabilityRequest = {
    ...latestBase,
    occurrences: latestBase.occurrences.map((occurrence, index) => index === 0
      ? { ...occurrence, responseOccurrenceIds: ["raw-new-a", "raw-new-b"] }
      : occurrence),
  };
  const loadAvailability = jest.fn()
    .mockResolvedValueOnce(makeRead([original]))
    .mockResolvedValueOnce(makeRead([original]))
    .mockResolvedValueOnce(makeRead([latest]));
  const saveAvailability = jest.fn()
    .mockRejectedValueOnce(Object.assign(new Error("Availability changed elsewhere"), { status: 409 }))
    .mockResolvedValueOnce(confirmedAvailabilitySave(latest, "scope-reloaded", "2099-10-22T12:00:00.000Z"));
  renderPage(makeAccess(loadAvailability, saveAvailability));

  await user.click(await screen.findByRole("button", { name: requestCardName("November availability") }));
  await user.click(screen.getByRole("checkbox", { name: /Sunday 1/ }));
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await user.click(await screen.findByRole("button", { name: "Review latest saved answers" }));
  expect(screen.getByRole("button", { name: "Keep my draft and continue" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Use latest answers" }));

  await user.click(screen.getByRole("checkbox", { name: /Sunday 1/ }));
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(saveAvailability).toHaveBeenCalledTimes(2));
  expect(saveAvailability.mock.calls[1][0]).toEqual({
    recipientId: "recipient-1",
    availability: { "raw-new-a": "available", "raw-new-b": "available", [ids[1]]: "unavailable" },
    availabilityRevision: { "raw-new-a": 3, "raw-new-b": 4, [ids[1]]: 1, [ids[2]]: 0 },
  });
});

it("preserves the dirty draft when the operations reference changes for the same volunteer", async () => {
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
        <RoutedAvailability access={access} />
      </MemoryRouter>
    </Provider>
  );
  const { rerender } = render(view(firstAccess));

  await user.click(await screen.findByRole("button", { name: requestCardName("November availability") }));
  const firstService = screen.getByRole("checkbox", { name: /Sunday 1/ });
  await user.click(firstService);
  rerender(view(secondAccess));

  expect(refreshedLoad).not.toHaveBeenCalled();
  expect(firstService).not.toBeChecked();
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
    .mockResolvedValueOnce(makeRead([initial]))
    .mockResolvedValueOnce(makeRead([submitted]));
  const networkError = Object.assign(new Error("Connection closed"), { status: 503 });
  const saveAvailability = jest.fn().mockRejectedValue(networkError);
  renderPage(makeAccess(loadAvailability, saveAvailability));

  await user.click(await screen.findByRole("button", { name: requestCardName("November availability") }));
  await user.click(screen.getByRole("checkbox", { name: /Sunday 1/ }));
  await user.click(screen.getByRole("button", { name: "Save changes" }));

  expect(await screen.findByRole("button", { name: requestCardName("November availability") })).toBeInTheDocument();
  expect(saveAvailability).toHaveBeenCalledTimes(1);
  expect(loadAvailability).toHaveBeenCalledTimes(3);
  expect(screen.queryByText("We couldn't confirm that save. Your draft is still here.")).not.toBeInTheDocument();
});

it("keeps an uncertain save in conflict review when the matching read has unresolved answers", async () => {
  const user = userEvent.setup();
  const initial = makeRequest({
    availability: { [ids[0]]: "available", [ids[2]]: "unavailable" },
    unansweredOccurrenceIds: [ids[1]],
  });
  const conflicted = makeRequest({
    availability: { [ids[2]]: "unavailable" },
    unansweredOccurrenceIds: [ids[0], ids[1]],
    conflictingOccurrenceIds: [ids[0]],
    occurrences: initial.occurrences.map((occurrence) => occurrence.occurrenceId === ids[0]
      ? { ...occurrence, hasConflictingAnswers: true }
      : occurrence),
    submissionId: "committed-with-conflict",
  });
  const loadAvailability = jest.fn()
    .mockResolvedValueOnce(makeRead([initial]))
    .mockResolvedValueOnce(makeRead([initial]))
    .mockResolvedValueOnce(makeRead([conflicted]));
  const saveAvailability = jest.fn().mockRejectedValue(
    Object.assign(new Error("Connection closed"), { status: 503 }),
  );
  renderPage(makeAccess(loadAvailability, saveAvailability));

  await user.click(await screen.findByRole("button", { name: requestCardName("November availability") }));
  const serviceGroup = within(screen.getByRole("group", { name: /I can serve at Sunday 1/ }));
  await user.click(serviceGroup.getByRole("button", { name: "More actions for Sunday 1" }));
  await user.click(screen.getByRole("menuitem", { name: "Clear response" }));
  await user.click(screen.getByRole("button", { name: "Save changes" }));

  expect(await screen.findByRole("button", { name: "Review latest saved answers" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Review latest saved answers" }));
  expect(within(screen.getByRole("alert")).getAllByText("Latest saved")).toHaveLength(3);
  expect(within(screen.getByRole("alert")).getAllByText("Not answered").length).toBeGreaterThan(0);
});

it("keeps a response read in conflict review instead of confirming an incomplete save result", async () => {
  const user = userEvent.setup();
  const initial = makeRequest({
    availability: { [ids[0]]: "available", [ids[2]]: "unavailable" },
    unansweredOccurrenceIds: [ids[1]],
  });
  const conflicted = makeRequest({
    availability: { [ids[2]]: "unavailable" },
    unansweredOccurrenceIds: [ids[0], ids[1]],
    conflictingOccurrenceIds: [ids[0]],
    occurrences: initial.occurrences.map((occurrence) => occurrence.occurrenceId === ids[0]
      ? { ...occurrence, hasConflictingAnswers: true }
      : occurrence),
    submissionId: "committed-with-conflict",
  });
  const loadAvailability = jest.fn()
    .mockResolvedValueOnce(makeRead([initial]))
    .mockResolvedValueOnce(makeRead([initial]))
    .mockResolvedValueOnce(makeRead([conflicted]));
  const saveAvailability = jest.fn().mockResolvedValue({
    success: true,
    submissionId: "committed-with-conflict",
  });
  renderPage(makeAccess(loadAvailability, saveAvailability));

  await user.click(await screen.findByRole("button", { name: requestCardName("November availability") }));
  const serviceGroup = within(screen.getByRole("group", { name: /I can serve at Sunday 1/ }));
  await user.click(serviceGroup.getByRole("button", { name: "More actions for Sunday 1" }));
  await user.click(screen.getByRole("menuitem", { name: "Clear response" }));
  await user.click(screen.getByRole("button", { name: "Save changes" }));

  expect(await screen.findByRole("button", { name: "Review latest saved answers" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
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
    .mockResolvedValueOnce(makeRead([initial]))
    .mockRejectedValueOnce(new Error("Network unavailable"))
    .mockResolvedValueOnce(makeRead([initial]))
    .mockResolvedValueOnce(makeRead([saved]));
  const networkError = Object.assign(new Error("Connection closed"), { status: 503 });
  const saveAvailability = jest.fn()
    .mockRejectedValueOnce(networkError)
    .mockResolvedValueOnce({ success: true, submissionId: "confirmed-after-refresh" });
  renderPage(makeAccess(loadAvailability, saveAvailability));

  await user.click(await screen.findByRole("button", { name: requestCardName("November availability") }));
  const firstService = screen.getByRole("checkbox", { name: /Sunday 1/ });
  await user.click(firstService);
  await user.click(screen.getByRole("button", { name: "Save changes" }));

  expect(await screen.findByText("Could not load the latest saved answers. Your draft is still here. Refresh before trying again."))
    .toBeInTheDocument();
  expect(firstService).not.toBeChecked();
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  expect(saveAvailability).toHaveBeenCalledTimes(1);

  await user.click(screen.getByRole("button", { name: "Refresh saved answers" }));
  expect(await screen.findByRole("button", { name: "Review latest saved answers" })).toBeInTheDocument();
  expect(firstService).not.toBeChecked();
  expect(saveAvailability).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "Review latest saved answers" }));
  await user.click(screen.getByRole("button", { name: "Keep my draft and continue" }));
  await user.click(screen.getByRole("button", { name: "Save changes" }));

  expect(await screen.findByRole("button", { name: requestCardName("November availability") })).toBeInTheDocument();
  expect(saveAvailability).toHaveBeenCalledTimes(2);
});

it("does not display closed requests even if a stale read contains one", async () => {
  const closed = makeRequest({ editable: false, availability: Object.fromEntries(ids.map((id) => [id, "unavailable"])), unansweredOccurrenceIds: [] });
  renderPage(makeAccess(jest.fn().mockResolvedValue(makeRead([closed], "America/New_York", {
    servingFrequency: "twice_monthly",
    recurringAvailability: { weeksOfMonth: [1, 3], includeLastWeekOfMonth: true },
    updatedAt: "preference-revision",
  })), jest.fn()));

  expect(await screen.findByRole("button", { name: "Show past availability requests" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: requestCardName("November availability") })).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Closed" })).not.toBeInTheDocument();
  const preferences = screen.getByRole("region", { name: "Scheduling preferences" });
  expect(within(preferences).getByText("Twice a month")).toBeInTheDocument();
  expect(within(preferences).queryByText("Preferences are unavailable for this account.")).not.toBeInTheDocument();
});

it("loads past request summaries only on demand and opens one past response read-only", async () => {
  const user = userEvent.setup();
  const closedRequest = makeRequest({ editable: false });
  const loadAvailability = jest.fn()
    .mockResolvedValueOnce(makeRead([]))
    .mockResolvedValueOnce({
      ...makeRead([]),
      requestSummaries: [{
        recipientId: closedRequest.recipientId,
        formId: closedRequest.formId,
        name: closedRequest.name,
        responseDeadline: closedRequest.responseDeadline,
        respondedAt: closedRequest.respondedAt,
        submissionId: closedRequest.submissionId,
        editable: false,
      }],
    })
    .mockResolvedValueOnce(makeRead([closedRequest]));

  renderPage(makeAccess(loadAvailability, jest.fn()));

  expect(await screen.findByRole("button", { name: "Show past availability requests" })).toBeInTheDocument();
  expect(loadAvailability.mock.calls[0]).toEqual([{ summary: true }]);
  await user.click(screen.getByRole("button", { name: "Show past availability requests" }));
  const pastRequestButton = await screen.findByRole("button", { name: /November availability/ });
  await waitFor(() => expect(pastRequestButton).toBeEnabled());
  expect(loadAvailability.mock.calls[1][0]).toEqual({ summary: true, history: true });

  await user.click(pastRequestButton);
  expect(await screen.findByRole("button", { name: "Back to My Schedule" })).toBeInTheDocument();
  expect(loadAvailability.mock.calls[2][0]).toEqual({ recipientId: closedRequest.recipientId });
  expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
});

it("keeps past-summary loading active while another request opens", async () => {
  const user = userEvent.setup();
  const activeRequest = makeRequest();
  const pastRequest = makeRequest({
    recipientId: "recipient-past",
    formId: "form-past",
    name: "Past November availability",
    editable: false,
  });
  const pendingHistory = deferred<VolunteerAvailabilityRead>();
  const loadAvailability = jest.fn()
    .mockResolvedValueOnce(makeRead([activeRequest]))
    .mockReturnValueOnce(pendingHistory.promise)
    .mockResolvedValueOnce(makeRead([activeRequest]));
  renderPage(makeAccess(loadAvailability, jest.fn()));

  await screen.findByRole("button", { name: requestCardName("November availability") });
  await user.click(screen.getByRole("button", { name: "Show past requests" }));
  await user.click(screen.getByRole("button", { name: requestCardName("November availability") }));
  expect(await screen.findByRole("button", { name: "Back to My Schedule" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Back to My Schedule" }));

  await act(async () => {
    pendingHistory.resolve(makeRead([pastRequest]));
  });

  expect(await screen.findByRole("button", { name: /Past November availability/ })).toBeInTheDocument();
  expect(loadAvailability.mock.calls[1][0]).toEqual({ summary: true, history: true });
});

it("removes a past request when its detail has been revoked or archived", async () => {
  const user = userEvent.setup();
  const closedRequest = makeRequest({ editable: false });
  const summary = {
    recipientId: closedRequest.recipientId,
    formId: closedRequest.formId,
    name: closedRequest.name,
    responseDeadline: closedRequest.responseDeadline,
    respondedAt: closedRequest.respondedAt,
    submissionId: closedRequest.submissionId,
    editable: false,
  };
  const loadAvailability = jest.fn()
    .mockResolvedValueOnce(makeRead([]))
    .mockResolvedValueOnce({ ...makeRead([]), requestSummaries: [summary] })
    .mockResolvedValueOnce(makeRead([]))
    .mockResolvedValueOnce({ ...makeRead([]), requestSummaries: [] });

  renderPage(makeAccess(loadAvailability, jest.fn()));
  await user.click(await screen.findByRole("button", { name: "Show past availability requests" }));
  const pastRequestButton = await screen.findByRole("button", { name: /November availability/ });
  await waitFor(() => expect(pastRequestButton).toBeEnabled());
  await user.click(pastRequestButton);
  expect(await screen.findByText("This availability request is no longer available. It was removed from the list.")).toBeInTheDocument();
  expect(screen.queryByText("No past requests.")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Back to My Schedule" }));
  expect(await screen.findByText("No past requests.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  expect(loadAvailability).toHaveBeenCalledTimes(3);
  expect(loadAvailability.mock.calls[2][0]).toEqual({ recipientId: closedRequest.recipientId });
});

it("ignores a past-request read after the volunteer identity changes", async () => {
  const user = userEvent.setup();
  const pendingHistory = deferred<VolunteerAvailabilityRead>();
  const oldLoadAvailability = jest.fn()
    .mockResolvedValueOnce(makeRead([]))
    .mockReturnValueOnce(pendingHistory.promise);
  const nextLoadAvailability = jest.fn().mockResolvedValue(makeRead([]));
  const oldAccess = makeAccess(oldLoadAvailability, jest.fn(), "member-old");
  const nextAccess = makeAccess(nextLoadAvailability, jest.fn(), "member-new");
  const renderWithAccess = (access: PersonalScheduleAccess) => (
    <Provider store={store}>
      <MemoryRouter initialEntries={["/my-availability"]}>
        <RoutedAvailability access={access} />
      </MemoryRouter>
    </Provider>
  );
  const view = render(renderWithAccess(oldAccess));

  await screen.findByRole("button", { name: "Show past availability requests" });
  await user.click(screen.getByRole("button", { name: "Show past availability requests" }));
  expect(oldLoadAvailability.mock.calls[1][0]).toEqual({ summary: true, history: true });

  view.rerender(renderWithAccess(nextAccess));
  await screen.findByRole("button", { name: "Show past availability requests" });
  await act(async () => {
    pendingHistory.resolve({
      ...makeRead([]),
      requestSummaries: [{
        recipientId: "old-recipient",
        formId: "old-form",
        name: "Old volunteer history",
        responseDeadline: "2026-10-01",
        respondedAt: "2026-09-20T12:00:00.000Z",
        submissionId: "old-submission",
        editable: false,
      }],
    });
  });

  expect(screen.queryByText("Old volunteer history")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Show past availability requests" })).toBeInTheDocument();
});

it("guards application navigation when a response draft is dirty", async () => {
  const user = userEvent.setup();
  renderPage(makeAccess(jest.fn().mockResolvedValue(makeRead([makeRequest()])), jest.fn()));

  await user.click(await screen.findByRole("button", { name: requestCardName("November availability") }));
  await user.click(screen.getByRole("checkbox", { name: /Sunday 1/ }));
  await user.click(screen.getByRole("link", { name: "Home" }));
  expect(screen.getByRole("dialog", { name: "Unsaved changes" })).toBeInTheDocument();
  expect(screen.getByTestId("current-location")).toHaveTextContent("/my-availability");
  await user.click(screen.getByRole("button", { name: "Stay" }));
  await user.click(screen.getByRole("button", { name: "Back to My Schedule" }));
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
        <RoutedAvailability access={access} />
      </MemoryRouter>
    </Provider>
  );
  const { rerender } = render(view(oldAccess));

  await user.click(await screen.findByRole("button", { name: requestCardName("November availability") }));
  await user.click(screen.getByRole("checkbox", { name: /Sunday 1/ }));
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByRole("button", { name: /Saving availability/ })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: /Saving availability/ }));
  expect(saveAvailability).toHaveBeenCalledTimes(1);

  rerender(view(newAccess));
  expect(await screen.findByRole("heading", { name: "Availability request unavailable" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "November availability" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Back to My Schedule" }));
  expect(await screen.findByRole("button", { name: requestCardName("Current session request") })).toBeInTheDocument();
  await act(async () => {
    pendingSave.resolve({ success: true, submissionId: "late-old-session-save" });
  });
  expect(screen.getByRole("button", { name: requestCardName("Current session request") })).toBeInTheDocument();
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
        <RoutedAvailability access={access} />
      </MemoryRouter>
    </Provider>
  );
  const { rerender } = render(view(oldAccess));

  rerender(view(newAccess));
  expect(await screen.findByRole("button", { name: requestCardName("Current church request") })).toBeInTheDocument();
  await act(async () => oldRead.resolve(makeRead([makeRequest({ name: "Old church request" })])));

  expect(screen.queryByRole("button", { name: requestCardName("Old church request") })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: requestCardName("Current church request") })).toBeInTheDocument();
});

it("offers retry after a temporary availability-load failure", async () => {
  const user = userEvent.setup();
  const loadAvailability = jest.fn()
    .mockRejectedValueOnce(new Error("Network unavailable"))
    .mockResolvedValueOnce(makeRead([]));
  renderPage(makeAccess(loadAvailability, jest.fn()));

  expect(await screen.findByRole("alert")).toHaveTextContent("Network unavailable");
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByRole("button", { name: "Show past availability requests" })).toBeInTheDocument();
  expect(loadAvailability).toHaveBeenCalledTimes(2);
});
