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
  getMyTeamAssignments: jest.fn(), updateMyBlockoutDates: jest.fn(), respondToMyAssignment: jest.fn(),
  acceptMyUnansweredAssignments: jest.fn(), getMyVolunteerAvailability: jest.fn(), submitMyVolunteerAvailability: jest.fn(),
  AuthApiError: class extends Error {},
}));
const mockToast = jest.fn();
jest.mock("../../context/toastContext", () => ({ useToast: () => ({ showToast: mockToast, removeToast: jest.fn() }) }));

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
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
    load: jest.fn(async () => snapshot(saved)), respond: jest.fn<ReturnType<MyScheduleOperations["respond"]>, Parameters<MyScheduleOperations["respond"]>>().mockResolvedValue({ success: true }),
    acceptUnanswered: jest.fn(async () => ({ success: true, results: [] })),
    availability: jest.fn(async () => ({ success: true, requests: [] })),
    submitAvailability: jest.fn<ReturnType<MyScheduleOperations["submitAvailability"]>, Parameters<MyScheduleOperations["submitAvailability"]>>().mockResolvedValue({ success: true }),
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
  jest.mocked(auth.getMyVolunteerAvailability).mockImplementation(() => operations.availability());
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
  await user.click(screen.getByRole("button", { name: "Accept all unanswered" }));
  f.setSaved(member("revision-b", "Administrator dates", "2099-12-02"));
  await act(async () => { bulk.resolve({ success: true, results: [] }); });
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
  await user.click(screen.getByRole("button", { name: "Accept all unanswered" }));
  await screen.findByText(/Your saved information changed elsewhere/);
  await user.click(screen.getByRole("button", { name: "Discard changes" }));
  expect(screen.getByRole("button", { name: "Save time off" })).toBeDisabled();
  expect(screen.queryByText(/Your saved information changed elsewhere/)).not.toBeInTheDocument();
  await edit(user, "New edit");
  await user.click(screen.getByRole("button", { name: "Save time off" }));
  expect(f.operations.saveBlockouts).toHaveBeenLastCalledWith(dates("New edit", "2099-12-02"), "revision-b");
});

it("retries a failed conflict refresh without losing the draft or advancing its revision", async () => {
  const user = userEvent.setup(); const f = fixture(); render(page(f.operations));
  await openEditor(user); await edit(user);
  f.setSaved(member("revision-b", "Administrator dates", "2099-12-02"));
  f.operations.load.mockRejectedValueOnce(new Error("Offline"));
  await user.click(screen.getByRole("button", { name: "Save time off" }));
  await screen.findByText(/Your saved information changed elsewhere/);
  await waitFor(() => expect(mockToast).toHaveBeenCalledWith("Could not refresh saved dates. Your draft is kept. Try again.", "error"));
  const refresh = deferred<Awaited<ReturnType<MyScheduleOperations["load"]>>>();
  f.operations.load.mockReturnValueOnce(refresh.promise);
  await user.click(screen.getByRole("button", { name: "Refresh saved dates" }));
  expect(screen.getByRole("button", { name: /Refreshing saved dates/i })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Discard changes" })).toBeDisabled();
  await act(async () => { refresh.resolve(snapshot(f.getSaved())); });
  expect(screen.getByRole("textbox", { name: /Notes/i })).toHaveValue("Volunteer draft");
  expect(screen.getByRole("button", { name: "Save time off" })).toBeDisabled();
  expect(f.operations.saveBlockouts).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "Discard changes" }));
  expect(screen.getByRole("textbox", { name: /Notes/i })).toHaveValue("Administrator dates");
});

it.each(["before", "after"])("D: a refresh resolving %s save completion cannot replace the confirmed baseline", async (order) => {
  const user = userEvent.setup(); const f = fixture(); render(page(f.operations));
  await openEditor(user); await edit(user);
  const refresh = deferred<Awaited<ReturnType<MyScheduleOperations["load"]>>>();
  f.operations.load.mockReturnValueOnce(refresh.promise);
  await user.click(screen.getByRole("button", { name: "Accept all unanswered" }));
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
