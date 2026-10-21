import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ContextType } from "react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import store from "../../store/store";
import { GlobalInfoContext } from "../../context/globalInfo";
import * as auth from "../../api/auth";
import type { MyScheduleMember, MyScheduleOperations } from "../myScheduleOperations";
import MySchedule from "../MySchedule";

jest.mock("../../api/auth", () => ({
  acceptPendingMyAssignments: jest.fn(), getMyTeamAssignments: jest.fn(), updateMyBlockoutDates: jest.fn(), respondToMyAssignment: jest.fn(),
  acceptMyUnansweredAssignments: jest.fn(),
  AuthApiError: class extends Error {},
}));
const mockToast = jest.fn();
jest.mock("../../context/toastContext", () => ({ useToast: () => ({ showToast: mockToast, removeToast: jest.fn() }) }));

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const dates = (notes: string, date = "2099-11-01") => [{ startDate: date, endDate: date, notes }];
const member = (stamp: string, notes: string, date?: string): MyScheduleMember => ({
  memberId: "member", churchId: "church-a", firstName: "Test", lastName: "Volunteer", updatedAt: stamp, blockoutDates: dates(notes, date),
});
const snapshot = (saved: MyScheduleMember): Awaited<ReturnType<MyScheduleOperations["load"]>> => ({
  success: true, member: saved, serviceTimeZone: "UTC", occurrences: [{
    occurrenceId: "occurrence", serviceIds: ["service"], name: "Sunday Gathering", date: "2099-11-01", startsAt: "2099-11-01T14:00:00Z", plan: null,
    serving: [{ memberId: "member", name: "Volunteer", isMe: true, isPrimary: true, scheduleId: "schedule", teamId: "team",
      teamName: "Media", positionId: "camera", positionName: "Camera", columnKey: "camera::0", response: "pending" }],
  }],
});
const fixture = () => {
  let saved = member("revision-a", "Original dates");
  const operations: jest.Mocked<MyScheduleOperations> = {
    load: jest.fn(async () => snapshot(saved)), respond: jest.fn<ReturnType<MyScheduleOperations["respond"]>, Parameters<MyScheduleOperations["respond"]>>().mockResolvedValue({ success: true, response: "accepted" }),
    acceptUnanswered: jest.fn(async () => ({ success: true, newlyAccepted: 0, alreadyAccepted: 0, alreadyDeclined: 0, skipped: 0, failedScheduleCount: 0, schedules: [], authorizationChanged: false, hasMore: false, nextCursor: null })),
    saveBlockouts: jest.fn(async (ranges, revision) => {
      if (revision !== saved.updatedAt) throw Object.assign(new Error("Saved dates changed"), { status: 409 });
      saved = { ...saved, updatedAt: "revision-c", blockoutDates: ranges };
      return { success: true, member: saved };
    }),
  };
  return { operations, setSaved: (next: MyScheduleMember) => { saved = next; }, getSaved: () => saved };
};
type Mode = "human" | "personal";
const page = (operations: MyScheduleOperations, mode: Mode = "personal", churchId = "church-a") => {
  jest.mocked(auth.getMyTeamAssignments).mockImplementation(() => operations.load() as ReturnType<typeof auth.getMyTeamAssignments>);
  jest.mocked(auth.updateMyBlockoutDates).mockImplementation((_church, ranges, stamp) => operations.saveBlockouts(ranges, stamp) as ReturnType<typeof auth.updateMyBlockoutDates>);
  jest.mocked(auth.acceptMyUnansweredAssignments).mockImplementation(() => operations.acceptUnanswered());
  jest.mocked(auth.acceptPendingMyAssignments).mockImplementation((_church, cursor) => operations.acceptUnanswered(cursor || undefined));
  return <Provider store={store}><MemoryRouter><GlobalInfoContext.Provider value={{ churchId, userId: "member", role: "member" } as ContextType<typeof GlobalInfoContext>}>
    <MySchedule access={mode === "personal" ? { churchId, memberId: "member", operations } : undefined} />
  </GlobalInfoContext.Provider></MemoryRouter></Provider>;
};
const edit = async (user: ReturnType<typeof userEvent.setup>, notes = "Volunteer draft") => {
  const input = screen.getByRole("textbox", { name: /Notes/i });
  await user.clear(input); await user.type(input, notes);
};
const openEditor = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole("button", { name: /Time off/i }));
};
beforeEach(() => { jest.clearAllMocks(); });

it.each(["human", "personal"] as const)("A: bulk refresh cannot lend revision B to a dirty %s draft", async (mode) => {
  const user = userEvent.setup(); const f = fixture(); render(page(f.operations, mode));
  await openEditor(user); await edit(user);
  const bulk = deferred<Awaited<ReturnType<MyScheduleOperations["acceptUnanswered"]>>>();
  f.operations.acceptUnanswered.mockReturnValueOnce(bulk.promise);
  await user.click(screen.getByRole("button", { name: /Accept remaining assignments/ }));
  f.setSaved(member("revision-b", "Administrator dates", "2099-12-02"));
  await act(async () => { bulk.resolve({ success: true, newlyAccepted: 0, alreadyAccepted: 0, alreadyDeclined: 0, skipped: 0, failedScheduleCount: 0, schedules: [], authorizationChanged: false, hasMore: false, nextCursor: null }); });
  await waitFor(() => expect(f.operations.load).toHaveBeenCalledTimes(2));
  expect(screen.getByRole("textbox", { name: /Notes/i })).toHaveValue("Volunteer draft");
  await user.click(screen.getByRole("button", { name: "Save time off" }));
  expect(f.operations.saveBlockouts).not.toHaveBeenCalled();
  expect(f.getSaved().blockoutDates).toEqual(dates("Administrator dates", "2099-12-02"));
  expect(screen.getByText(/Your saved information changed elsewhere/)).toBeInTheDocument();
  await user.click(screen.getByText("Review saved dates"));
  expect(screen.getByText(/Administrator dates/)).toBeInTheDocument();
});

it("B: HTTP 409 keeps revision A and requires explicit conflict resolution before retry", async () => {
  const user = userEvent.setup(); const f = fixture(); render(page(f.operations));
  await openEditor(user); await edit(user);
  f.setSaved(member("revision-b", "Administrator dates", "2099-12-02"));
  await user.click(screen.getByRole("button", { name: "Save time off" }));
  await waitFor(() => expect(f.operations.load).toHaveBeenCalledTimes(2));
  expect(f.operations.saveBlockouts).toHaveBeenLastCalledWith(dates("Volunteer draft"), "revision-a");
  expect(screen.getByRole("textbox", { name: /Notes/i })).toHaveValue("Volunteer draft");
  await user.click(screen.getByRole("button", { name: "Save time off" }));
  expect(f.operations.saveBlockouts).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "Discard changes" }));
  expect(screen.getByRole("textbox", { name: /Notes/i })).toHaveValue("Administrator dates");
  await edit(user, "Reconciled dates");
  await user.click(screen.getByRole("button", { name: "Save time off" }));
  expect(f.operations.saveBlockouts).toHaveBeenLastCalledWith(dates("Reconciled dates", "2099-12-02"), "revision-b");
});

it("C: explicit discard adopts the refreshed dates and revision together", async () => {
  const user = userEvent.setup(); const f = fixture(); render(page(f.operations));
  await openEditor(user); await edit(user);
  f.setSaved(member("revision-b", "Administrator dates", "2099-12-02"));
  await user.click(screen.getByRole("button", { name: /Accept remaining assignments/ }));
  await screen.findByText(/Your saved information changed elsewhere/);
  await user.click(screen.getByRole("button", { name: "Discard changes" }));
  expect(screen.getByRole("button", { name: "Save time off" })).toBeDisabled();
  expect(screen.queryByText(/Your saved information changed elsewhere/)).not.toBeInTheDocument();
  await edit(user, "New edit");
  await user.click(screen.getByRole("button", { name: "Save time off" }));
  expect(f.operations.saveBlockouts).toHaveBeenLastCalledWith(dates("New edit", "2099-12-02"), "revision-b");
});

it.each(["human", "personal"] as const)("retries a failed %s conflict refresh without losing the draft or advancing its revision", async (mode) => {
  const user = userEvent.setup(); const f = fixture(); render(page(f.operations, mode));
  await openEditor(user); await edit(user);
  f.setSaved(member("revision-b", "Administrator dates", "2099-12-02"));
  f.operations.load.mockRejectedValueOnce(new Error("Offline"));
  await user.click(screen.getByRole("button", { name: "Save time off" }));
  await screen.findByText(/Your saved information changed elsewhere/);
  expect(await screen.findByText(/couldn.t load the latest saved dates/)).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: /Notes/i })).toHaveValue("Volunteer draft");
  expect(screen.queryByText("Review saved dates")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Discard changes" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Discard changes" }));
  expect(screen.getByRole("textbox", { name: /Notes/i })).toHaveValue("Volunteer draft");
  expect(screen.getByRole("button", { name: "Save time off" })).toBeDisabled();
  const refresh = deferred<Awaited<ReturnType<MyScheduleOperations["load"]>>>();
  f.operations.load.mockReturnValueOnce(refresh.promise);
  await user.click(screen.getByRole("button", { name: "Retry loading saved dates" }));
  expect(screen.getByRole("button", { name: /Refreshing saved dates/i })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Discard changes" })).toBeDisabled();
  await act(async () => { refresh.resolve(snapshot(f.getSaved())); });
  expect(screen.getByRole("textbox", { name: /Notes/i })).toHaveValue("Volunteer draft");
  expect(screen.getByRole("button", { name: "Save time off" })).toBeDisabled();
  expect(f.operations.saveBlockouts).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "Discard changes" }));
  expect(screen.getByRole("textbox", { name: /Notes/i })).toHaveValue("Administrator dates");
  await edit(user, "Reconciled retry");
  await user.click(screen.getByRole("button", { name: "Save time off" }));
  expect(f.operations.saveBlockouts).toHaveBeenLastCalledWith(dates("Reconciled retry", "2099-12-02"), "revision-b");
});

it.each(["before", "after"])("D: a refresh resolving %s save completion cannot replace the confirmed baseline", async (order) => {
  const user = userEvent.setup(); const f = fixture(); render(page(f.operations));
  await openEditor(user); await edit(user);
  const refresh = deferred<Awaited<ReturnType<MyScheduleOperations["load"]>>>();
  f.operations.load.mockReturnValueOnce(refresh.promise);
  await user.click(screen.getByRole("button", { name: /Accept remaining assignments/ }));
  await waitFor(() => expect(f.operations.load).toHaveBeenCalledTimes(2));
  const save = deferred<Awaited<ReturnType<MyScheduleOperations["saveBlockouts"]>>>();
  f.operations.saveBlockouts.mockReturnValueOnce(save.promise);
  await user.click(screen.getByRole("button", { name: "Save time off" }));
  if (order === "before") await act(async () => { refresh.resolve(snapshot(member("revision-a", "Original dates"))); });
  const confirmed = member("revision-c", "Normalized saved dates", "2099-12-03");
  f.setSaved(confirmed);
  await act(async () => { save.resolve({ success: true, member: confirmed }); });
  if (order === "after") await act(async () => { refresh.resolve(snapshot(member("revision-a", "Original dates"))); });
  expect(screen.getByRole("textbox", { name: /Notes/i })).toHaveValue("Normalized saved dates");
  expect(screen.getByRole("button", { name: "Save time off" })).toBeDisabled();
  await edit(user, "Next edit");
  await user.click(screen.getByRole("button", { name: "Save time off" }));
  expect(f.operations.saveBlockouts).toHaveBeenLastCalledWith(dates("Next edit", "2099-12-03"), "revision-c");
});

it.each([
  ["human", "personal", "church-a"], ["personal", "human", "church-b"], ["personal", "personal", "church-b"],
] as const)("E: retires %s work when opening %s in %s with the same member ID", async (from, to, church) => {
  const user = userEvent.setup(); const first = fixture(); const second = fixture();
  const { rerender } = render(page(first.operations, from));
  await openEditor(user); await edit(user, "Old identity draft");
  const oldSave = deferred<Awaited<ReturnType<MyScheduleOperations["saveBlockouts"]>>>();
  first.operations.saveBlockouts.mockReturnValueOnce(oldSave.promise);
  await user.click(screen.getByRole("button", { name: "Save time off" }));
  second.setSaved(member("revision-a", "New identity dates", "2099-12-04"));
  rerender(page(second.operations, to, church));
  await openEditor(user);
  await act(async () => { oldSave.resolve({ success: true, member: member("revision-c", "Old saved dates") }); });
  expect(screen.getByRole("textbox", { name: /Notes/i })).toHaveValue("New identity dates");
  expect(screen.getByRole("button", { name: "Save time off" })).toBeDisabled();
  await edit(user, "New identity edit");
  await user.click(screen.getByRole("button", { name: "Save time off" }));
  expect(second.operations.saveBlockouts).toHaveBeenLastCalledWith(dates("New identity edit", "2099-12-04"), "revision-a");
});

it.each([401, 403])("keeps the draft after access expires or is revoked (HTTP %s)", async (status) => {
  const user = userEvent.setup(); const f = fixture(); render(page(f.operations));
  await openEditor(user); await edit(user);
  f.operations.saveBlockouts.mockRejectedValueOnce(Object.assign(new Error("Open your personal link to continue."), { status }));
  await user.click(screen.getByRole("button", { name: "Save time off" }));
  expect(screen.getByRole("textbox", { name: /Notes/i })).toHaveValue("Volunteer draft");
  expect(f.getSaved().updatedAt).toBe("revision-a");
  expect(f.operations.saveBlockouts).toHaveBeenCalledWith(dates("Volunteer draft"), "revision-a");
  expect(mockToast).toHaveBeenCalled();
});

it("keeps a dirty draft through disconnect/reconnect and still submits its original revision", async () => {
  const user = userEvent.setup(); const f = fixture(); render(page(f.operations));
  await openEditor(user); await edit(user);
  const clock = jest.spyOn(Date, "now").mockReturnValue(1_000_000);
  try {
    await act(async () => { window.dispatchEvent(new Event("offline")); });
    f.setSaved(member("revision-b", "Administrator dates", "2099-12-02"));
    clock.mockReturnValue(1_060_000);
    await act(async () => { window.dispatchEvent(new Event("online")); });
    expect(f.operations.load).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("textbox", { name: /Notes/i })).toHaveValue("Volunteer draft");
    await user.click(screen.getByRole("button", { name: "Save time off" }));
    await screen.findByText(/Your saved information changed elsewhere/);
    expect(f.operations.saveBlockouts).toHaveBeenLastCalledWith(dates("Volunteer draft"), "revision-a");
    expect(f.getSaved().updatedAt).toBe("revision-b");
  } finally { clock.mockRestore(); }
});


it("a superseded conflict refresh cannot override a newer success", async () => {
  const user = userEvent.setup(); const f = fixture(); render(page(f.operations));
  await openEditor(user); await edit(user);
  f.setSaved(member("revision-b", "Administrator dates", "2099-12-02"));
  const older = deferred<Awaited<ReturnType<MyScheduleOperations["load"]>>>();
  const newer = deferred<Awaited<ReturnType<MyScheduleOperations["load"]>>>();
  f.operations.load.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
  await user.click(screen.getByRole("button", { name: "Save time off" }));
  await user.click(screen.getByRole("button", { name: /Accept remaining assignments/ }));
  await waitFor(() => expect(f.operations.load).toHaveBeenCalledTimes(3));
  await act(async () => { newer.resolve(snapshot(member("revision-c", "Newest dates", "2099-12-03"))); });
  await act(async () => { older.resolve(snapshot(f.getSaved())); });
  expect(screen.getByRole("textbox", { name: /Notes/i })).toHaveValue("Volunteer draft");
  expect(screen.getByRole("button", { name: "Save time off" })).toBeDisabled();
  await user.click(screen.getByText("Review saved dates"));
  expect(screen.getByText(/Newest dates/)).toBeInTheDocument();
  expect(screen.queryByText(/Administrator dates/)).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Discard changes" }));
  const value = "Newest dates";
  expect(screen.getByRole("textbox", { name: /Notes/i })).toHaveValue(value);
});

it("a superseded conflict refresh cannot override a newer failure", async () => {
  const user = userEvent.setup(); const f = fixture(); render(page(f.operations));
  await openEditor(user); await edit(user);
  f.setSaved(member("revision-b", "Administrator dates", "2099-12-02"));
  const older = deferred<Awaited<ReturnType<MyScheduleOperations["load"]>>>();
  const newer = deferred<Awaited<ReturnType<MyScheduleOperations["load"]>>>();
  f.operations.load.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
  await user.click(screen.getByRole("button", { name: "Save time off" }));
  await user.click(screen.getByRole("button", { name: /Accept remaining assignments/ }));
  await waitFor(() => expect(f.operations.load).toHaveBeenCalledTimes(3));
  await act(async () => { newer.reject(new Error("Offline")); });
  await act(async () => { older.resolve(snapshot(f.getSaved())); });
  expect(screen.getByRole("textbox", { name: /Notes/i })).toHaveValue("Volunteer draft");
  expect(screen.getByRole("button", { name: "Save time off" })).toBeDisabled();
  expect(screen.queryByText("Review saved dates")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Discard changes" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Discard changes" }));
  const value = "Volunteer draft";
  expect(screen.getByRole("textbox", { name: /Notes/i })).toHaveValue(value);
});

it.each(["revision-a", ""])("does not authorize discard with an unproven revision %s", async (stamp) => {
  const user = userEvent.setup(); const f = fixture(); render(page(f.operations));
  await openEditor(user); await edit(user);
  f.setSaved(member("revision-b", "Administrator dates"));
  f.operations.load.mockResolvedValueOnce(snapshot(member(stamp, "Unverified dates")));
  await user.click(screen.getByRole("button", { name: "Save time off" }));
  await waitFor(() => expect(f.operations.load).toHaveBeenCalledTimes(2));
  expect(screen.queryByText("Review saved dates")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Discard changes" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Retry loading saved dates" })).toBeEnabled();
  expect(screen.getByRole("textbox", { name: /Notes/i })).toHaveValue("Volunteer draft");
});

it.each([401, 403])("protects the draft and retains personal guidance when conflict refresh returns %s", async (status) => {
  const user = userEvent.setup(); const f = fixture(); render(page(f.operations));
  await openEditor(user); await edit(user);
  f.setSaved(member("revision-b", "Administrator dates"));
  f.operations.load.mockRejectedValueOnce(Object.assign(new Error("Open your personal link to continue."), { status }));
  await user.click(screen.getByRole("button", { name: "Save time off" }));
  expect(await screen.findByText(/Open your personal link to continue/)).toBeInTheDocument();
  expect(screen.queryByText("Refresh page")).not.toBeInTheDocument();
  expect(screen.queryByText("Review saved dates")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Discard changes" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Save time off" })).toBeDisabled();
  expect(screen.getByRole("textbox", { name: /Notes/i })).toHaveValue("Volunteer draft");
});

it("retires conflict recovery on an identity switch and unmount", async () => {
  const user = userEvent.setup(); const first = fixture(); const second = fixture();
  const { rerender, unmount } = render(page(first.operations));
  await openEditor(user); await edit(user);
  first.setSaved(member("revision-b", "Old administrator dates"));
  const old = deferred<Awaited<ReturnType<MyScheduleOperations["load"]>>>();
  first.operations.load.mockReturnValueOnce(old.promise);
  await user.click(screen.getByRole("button", { name: "Save time off" }));
  second.setSaved(member("revision-a", "New identity dates", "2099-12-04"));
  rerender(page(second.operations, "personal", "church-b"));
  await openEditor(user);
  await act(async () => { old.resolve(snapshot(first.getSaved())); });
  expect(screen.getByRole("textbox", { name: /Notes/i })).toHaveValue("New identity dates");
  expect(screen.queryByText(/Your saved information changed elsewhere/)).not.toBeInTheDocument();
  await edit(user, "New draft");
  second.setSaved(member("revision-b", "Second administrator dates"));
  const pending = deferred<Awaited<ReturnType<MyScheduleOperations["load"]>>>();
  second.operations.load.mockReturnValueOnce(pending.promise);
  await user.click(screen.getByRole("button", { name: "Save time off" }));
  unmount(); mockToast.mockClear();
  await act(async () => { pending.reject(new Error("Offline")); });
  expect(mockToast).not.toHaveBeenCalled();
});


it("does not treat an older timestamp as a newer authoritative snapshot", async () => {
  const user = userEvent.setup(); const f = fixture();
  f.setSaved(member("2026-10-20T15:00:00.000Z", "Original dates"));
  render(page(f.operations)); await openEditor(user); await edit(user);
  f.setSaved(member("2026-10-20T16:00:00.000Z", "Administrator dates"));
  f.operations.load.mockResolvedValueOnce(snapshot(member("2026-10-20T14:00:00.000Z", "Older dates")));
  await user.click(screen.getByRole("button", { name: "Save time off" }));
  await waitFor(() => expect(f.operations.load).toHaveBeenCalledTimes(2));
  expect(screen.queryByText("Review saved dates")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Discard changes" })).toBeDisabled();
  expect(screen.getByRole("textbox", { name: /Notes/i })).toHaveValue("Volunteer draft");
});

it.each(["missing member", "unsuccessful result"])("protects the draft when refresh returns %s", async (kind) => {
  const user = userEvent.setup(); const f = fixture(); render(page(f.operations));
  await openEditor(user); await edit(user);
  f.setSaved(member("revision-b", "Administrator dates"));
  const result = snapshot(f.getSaved());
  if (kind === "missing member") result.member = null;
  else result.success = false;
  f.operations.load.mockResolvedValueOnce(result);
  await user.click(screen.getByRole("button", { name: "Save time off" }));
  expect(await screen.findByText(/couldn.t load the latest saved dates/)).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: /Notes/i })).toHaveValue("Volunteer draft");
  expect(screen.getByRole("button", { name: "Discard changes" })).toBeDisabled();
});

const bulkPage = (overrides: Partial<Awaited<ReturnType<MyScheduleOperations["acceptUnanswered"]>>> = {}) => ({
  success: true, newlyAccepted: 0, alreadyAccepted: 0, alreadyDeclined: 0,
  skipped: 0, failedScheduleCount: 0, schedules: [], authorizationChanged: false,
  hasMore: false, nextCursor: null, ...overrides,
});

it.each(["human", "personal"] as const)("%s bulk follows bounded pages and retries partial completion", async (mode) => {
  const user = userEvent.setup(); const f = fixture();
  f.operations.acceptUnanswered.mockResolvedValueOnce(bulkPage({ newlyAccepted: 25, hasMore: true, nextCursor: "schedule-25" }))
    .mockResolvedValueOnce(bulkPage({ newlyAccepted: 1, failedScheduleCount: 1 }))
    .mockResolvedValueOnce(bulkPage({ newlyAccepted: 1 }));
  render(page(f.operations, mode));
  await user.click(await screen.findByRole("button", { name: /Accept remaining assignments/ }));
  expect(await screen.findByText(/Accepted 26 assignments.*Retry to finish the rest/)).toBeInTheDocument();
  expect(f.operations.acceptUnanswered).toHaveBeenNthCalledWith(1, undefined);
  expect(f.operations.acceptUnanswered).toHaveBeenNthCalledWith(2, "schedule-25");
  await waitFor(() => expect(screen.getByRole("button", { name: /Accept remaining assignments/ })).toBeEnabled());
  await user.click(screen.getByRole("button", { name: /Accept remaining assignments/ }));
  expect(await screen.findByText("Accepted 1 assignment.")).toBeInTheDocument();
  expect(f.operations.acceptUnanswered).toHaveBeenNthCalledWith(3, undefined);
});

it("personal authority change stops page traversal after committed partial success", async () => {
  const user = userEvent.setup(); const f = fixture();
  f.operations.acceptUnanswered.mockResolvedValueOnce(bulkPage({ newlyAccepted: 1,
    authorizationChanged: true, hasMore: true, nextCursor: "must-not-follow" }));
  render(page(f.operations));
  await user.click(await screen.findByRole("button", { name: "Accept remaining assignments" }));
  expect(await screen.findByText(/Accepted 1 assignment.*access changed/)).toBeInTheDocument();
  expect(f.operations.acceptUnanswered).toHaveBeenCalledTimes(1);
});
