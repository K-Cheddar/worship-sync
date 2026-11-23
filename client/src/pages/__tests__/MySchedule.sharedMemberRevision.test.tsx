import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ContextType } from "react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { GlobalInfoContext } from "../../context/globalInfo";
import store from "../../store/store";
import MySchedule from "../MySchedule";
import type {
  MyScheduleMember,
  PersonalScheduleAccess,
  VolunteerAvailabilityOperations,
  VolunteerSchedulingPreferences,
} from "../myScheduleOperations";

jest.mock("../../api/auth", () => ({
  acceptPendingMyAssignments: jest.fn(),
  getMyTeamAssignments: jest.fn(),
  getMyVolunteerAvailability: jest.fn(),
  respondToMyAssignment: jest.fn(),
  submitMyVolunteerAvailability: jest.fn(),
  updateMyBlockoutDates: jest.fn(),
  updateMySchedulingPreferences: jest.fn(),
  AuthApiError: class AuthApiError extends Error {},
}));
jest.mock("../../context/toastContext", () => ({
  useToast: () => ({ showToast: jest.fn(), removeToast: jest.fn() }),
}));

const REVISION_A = "2099-01-01T00:00:00.000Z";
const REVISION_B = "2099-01-02T00:00:00.000Z";
const REVISION_C = "2099-01-03T00:00:00.000Z";
const INITIAL_BLOCKOUT = {
  startDate: "2099-12-10",
  endDate: "2099-12-10",
  notes: "Already saved",
};

const memberAt = (
  updatedAt: string,
  overrides: Partial<MyScheduleMember> = {},
): MyScheduleMember => ({
  memberId: "member-1",
  churchId: "church-1",
  firstName: "Test",
  lastName: "Volunteer",
  blockoutDates: [INITIAL_BLOCKOUT],
  servingFrequency: "weekly",
  recurringAvailability: { weeksOfMonth: [1], includeLastWeekOfMonth: false },
  ...overrides,
  updatedAt,
});

const preferencesFor = (member: MyScheduleMember): VolunteerSchedulingPreferences => ({
  servingFrequency: member.servingFrequency || "as_needed",
  recurringAvailability: member.recurringAvailability || { weeksOfMonth: [], includeLastWeekOfMonth: false },
  updatedAt: member.updatedAt || "",
});

const conflict = () => Object.assign(new Error("The member changed elsewhere."), { status: 409 });

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => { resolve = finish; });
  return { promise, resolve };
};

const makeAccess = () => {
  let saved = memberAt(REVISION_A);
  const operations: PersonalScheduleAccess["operations"] & Required<VolunteerAvailabilityOperations> = {
    load: jest.fn(async () => ({ success: true, member: saved, occurrences: [] })),
    respond: jest.fn(async () => ({ success: true, response: "accepted" as const })),
    saveBlockouts: jest.fn(async (blockoutDates, expectedUpdatedAt) => {
      if (expectedUpdatedAt !== saved.updatedAt) throw conflict();
      saved = memberAt(saved.updatedAt === REVISION_A ? REVISION_B : REVISION_C, {
        ...saved,
        blockoutDates,
      });
      return { success: true, member: saved, memberSnapshot: saved };
    }),
    acceptUnanswered: jest.fn(async () => ({
      success: true,
      newlyAccepted: 0,
      alreadyAccepted: 0,
      alreadyDeclined: 0,
      skipped: 0,
      failedScheduleCount: 0,
      schedules: [],
      authorizationChanged: false,
      hasMore: false,
      nextCursor: null,
    })),
    loadAvailability: jest.fn(async (options) => ({
      success: true,
      requests: [],
      requestSummaries: [],
      schedulingPreferences: preferencesFor(saved),
      ...(options?.includeMemberSnapshot ? { memberSnapshot: saved } : {}),
    })),
    saveAvailability: jest.fn(async () => ({ success: true, submissionId: "submission" })),
    saveSchedulingPreferences: jest.fn(async (request) => {
      if (request.expectedUpdatedAt !== saved.updatedAt) throw conflict();
      saved = memberAt(saved.updatedAt === REVISION_A ? REVISION_B : REVISION_C, {
        ...saved,
        servingFrequency: request.servingFrequency,
        recurringAvailability: request.recurringAvailability,
      });
      return {
        success: true,
        schedulingPreferences: preferencesFor(saved),
        memberSnapshot: saved,
      };
    }),
  };
  const access: PersonalScheduleAccess = {
    churchId: "church-1",
    memberId: "member-1",
    sessionKey: "member-session",
    operations,
  };
  return {
    access,
    operations,
    getSaved: () => saved,
    setSaved: (next: MyScheduleMember) => { saved = next; },
  };
};

const renderPage = (access: PersonalScheduleAccess) => render(
  <Provider store={store}>
    <MemoryRouter initialEntries={["/my-schedule"]}>
      <GlobalInfoContext.Provider value={{ churchId: "church-1", userId: "member-1", role: "member" } as ContextType<typeof GlobalInfoContext>}>
        <MySchedule access={access} />
      </GlobalInfoContext.Provider>
    </MemoryRouter>
  </Provider>,
);

const editPreferences = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole("button", { name: "Edit preferences" }));
  await user.click(screen.getByRole("combobox", { name: /Serving frequency/ }));
  await user.click(await screen.findByRole("option", { name: "Once a month" }));
};

const editTimeOffNotes = async (
  user: ReturnType<typeof userEvent.setup>,
  notes: string,
) => {
  await user.click(await screen.findByRole("button", { name: /Time off/i }));
  await user.click(screen.getByRole("button", { name: /Edit time off/i }));
  const field = screen.getByRole("textbox", { name: /Notes/i });
  await user.clear(field);
  await user.type(field, notes);
};

const savePreferences = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: "Save preferences" }));
};

it("uses the committed preference revision for the next Time Off save", async () => {
  const user = userEvent.setup();
  const { access, operations } = makeAccess();
  renderPage(access);

  await editPreferences(user);
  await savePreferences(user);
  await waitFor(() => expect(operations.saveSchedulingPreferences).toHaveBeenCalledWith(expect.objectContaining({ expectedUpdatedAt: REVISION_A })));

  await editTimeOffNotes(user, "New trip");
  await user.click(screen.getByRole("button", { name: "Save time off" }));

  await waitFor(() => expect(operations.saveBlockouts).toHaveBeenCalledWith(
    expect.arrayContaining([expect.objectContaining({ notes: "New trip" })]),
    REVISION_B,
  ));
  expect(operations.load).toHaveBeenCalledTimes(1);
});

it("uses the committed Time Off revision for the next preferences save", async () => {
  const user = userEvent.setup();
  const { access, operations } = makeAccess();
  renderPage(access);

  await editTimeOffNotes(user, "Updated trip");
  await user.click(screen.getByRole("button", { name: "Save time off" }));
  await waitFor(() => expect(operations.saveBlockouts).toHaveBeenCalledWith(
    expect.arrayContaining([expect.objectContaining({ notes: "Updated trip" })]),
    REVISION_A,
  ));

  await editPreferences(user);
  await savePreferences(user);

  await waitFor(() => expect(operations.saveSchedulingPreferences).toHaveBeenCalledWith(expect.objectContaining({
    servingFrequency: "monthly",
    expectedUpdatedAt: REVISION_B,
  })));
});

it("preserves a dirty Time Off draft when preferences advance the member revision", async () => {
  const user = userEvent.setup();
  const { access, operations } = makeAccess();
  renderPage(access);

  await editTimeOffNotes(user, "Keep this draft");
  await editPreferences(user);
  await savePreferences(user);

  expect(await screen.findByRole("textbox", { name: /Notes/i })).toHaveValue("Keep this draft");
  expect(screen.getByRole("button", { name: "Save time off" })).toBeDisabled();
  expect(operations.saveBlockouts).not.toHaveBeenCalled();
});

it("keeps preference edits while a Time Off change is reviewed after HTTP 409", async () => {
  const user = userEvent.setup();
  const { access, operations, getSaved, setSaved } = makeAccess();
  renderPage(access);

  await editPreferences(user);
  setSaved(memberAt(REVISION_B, { ...getSaved(), blockoutDates: [{ startDate: "2099-12-12", endDate: "2099-12-12", notes: "Changed on another device" }] }));
  (operations.saveSchedulingPreferences as jest.Mock).mockRejectedValueOnce(conflict());
  await savePreferences(user);

  expect(operations.loadAvailability).toHaveBeenCalledWith({ summary: true, includeMemberSnapshot: true });
  expect(await screen.findByText(/Latest saved: Once a week/)).toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: /Serving frequency/ })).toHaveTextContent("Once a month");
  expect(screen.getByRole("button", { name: "Save preferences" })).toBeDisabled();
  expect(operations.saveSchedulingPreferences).toHaveBeenCalledTimes(1);

  await user.click(screen.getByRole("button", { name: /Time off/i }));
  await user.click(screen.getByRole("button", { name: /Edit time off/i }));
  expect(screen.getByRole("textbox", { name: /Notes/i })).toHaveValue("Changed on another device");
  expect(screen.getByRole("combobox", { name: /Serving frequency/ })).toHaveTextContent("Once a month");

  await user.click(screen.getByRole("button", { name: "Keep my edits" }));
  await savePreferences(user);
  await waitFor(() => expect(operations.saveSchedulingPreferences).toHaveBeenNthCalledWith(2, expect.objectContaining({ expectedUpdatedAt: REVISION_B })));
});

it("reconciles an uncertain preference save from the fresh shared member snapshot", async () => {
  const user = userEvent.setup();
  const { access, operations, getSaved, setSaved } = makeAccess();
  renderPage(access);

  await editPreferences(user);
  setSaved(memberAt(REVISION_B, {
    ...getSaved(),
    servingFrequency: "monthly",
    recurringAvailability: { weeksOfMonth: [1], includeLastWeekOfMonth: false },
  }));
  (operations.saveSchedulingPreferences as jest.Mock).mockRejectedValueOnce(new Error("Connection lost"));
  await savePreferences(user);

  expect(operations.loadAvailability).toHaveBeenCalledWith({ summary: true, includeMemberSnapshot: true });
  await waitFor(() => expect(screen.queryByRole("button", { name: "Save preferences" })).not.toBeInTheDocument());
  await editTimeOffNotes(user, "After uncertain save");
  await user.click(screen.getByRole("button", { name: "Save time off" }));
  await waitFor(() => expect(operations.saveBlockouts).toHaveBeenLastCalledWith(
    expect.arrayContaining([expect.objectContaining({ notes: "After uncertain save" })]),
    REVISION_B,
  ));
});

it("keeps the initial assignment load active when preferences save first", async () => {
  const user = userEvent.setup();
  const { access, operations, getSaved } = makeAccess();
  const pendingLoad = deferred<Awaited<ReturnType<PersonalScheduleAccess["operations"]["load"]>>>();
  (operations.load as jest.Mock).mockReturnValueOnce(pendingLoad.promise);
  renderPage(access);

  await editPreferences(user);
  await savePreferences(user);
  await waitFor(() => expect(operations.saveSchedulingPreferences).toHaveBeenCalledTimes(1));

  await act(async () => {
    pendingLoad.resolve({ success: true, member: getSaved(), occurrences: [] });
    await pendingLoad.promise;
  });
  await waitFor(() => expect(screen.queryAllByTestId("my-schedule-loading-card")).toHaveLength(0));
  expect(operations.load).toHaveBeenCalledTimes(1);
});
