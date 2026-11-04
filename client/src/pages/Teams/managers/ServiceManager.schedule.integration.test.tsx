import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { useSelector } from "../../../hooks";
import store from "../../../store/store";
import { initiateServices } from "../../../store/serviceTimesSlice";
import { ToastProvider } from "../../../context/toastContext";
import { TeamsNavigationGuardProvider } from "../TeamsNavigationGuardContext";
import { toTeamService } from "../teamsUtils";
import { buildTeamSchedulePeriod } from "../schedule/teamSchedulePeriod";
import type { ServiceTime } from "../../../types";
import ServiceManager from "./ServiceManager";

const mockRunTransaction = jest.fn();
jest.mock("firebase/database", () => ({
  ref: (_db: unknown, target: string) => target,
  runTransaction: (...args: unknown[]) => mockRunTransaction(...args),
  set: jest.fn(), update: jest.fn(), get: jest.fn(),
}));
jest.mock("../../../context/globalInfo", () => ({
  GlobalInfoContext: jest.requireActual("react").createContext({ churchId: "church-main" }),
  globalHostId: "boundary-client",
  globalFireDbInfo: { db: "test-rtdb", churchId: "church-main", writeCapabilities: { serviceManagement: true } },
}));
jest.mock("../../../context/churchServiceTimeZone", () => ({
  useChurchServiceTimeZone: () => ({ timeZone: "America/New_York", status: "ready", isConfigured: true }),
}));
jest.mock("../../../utils/generateRandomId", () => ({ __esModule: true, default: () => "1k6gq4vjthg7r1g7qg4g" }));

const positions = [{ positionId: "boundary-camera", churchId: "church-main", teamId: "boundary-media", name: "Camera" }];
const teams = [{ teamId: "boundary-media", churchId: "church-main", name: "Media", memberIds: [] }];
const Editor = () => {
  const services = useSelector(state => state.undoable.present.serviceTimes.list);
  return <ServiceManager services={services.map(toTeamService)} canEdit positions={positions} teams={teams} />;
};

it("creates Book Launch through the real picker and RTDB updater, then ensures and edits on independent clients", async () => {
  const user = userEvent.setup();
  const before: ServiceTime[] = [{ id: "existing-one-time", name: "Existing one-time", timerType: "countdown", reccurence: "one_time", dateTimeISO: "2026-11-07T15:00:00.000Z", positionRequirements: [{ positionId: "boundary-camera", count: 1 }] }];
  let committed: ServiceTime[] = JSON.parse(JSON.stringify(before));
  let releaseCommit!: () => void;
  mockRunTransaction.mockImplementation(async (_target, update) => {
    await new Promise<void>(resolve => { releaseCommit = resolve; });
    // Execute the actual store.ts transaction callback on authoritative state.
    committed = JSON.parse(JSON.stringify(update(committed)));
    return { committed: true, snapshot: { val: () => committed } };
  });
  store.dispatch(initiateServices(before));
  const view = render(<Provider store={store}><MemoryRouter><ToastProvider><TeamsNavigationGuardProvider><Editor /></TeamsNavigationGuardProvider></ToastProvider></MemoryRouter></Provider>);
  await user.click(screen.getAllByRole("button", { name: "Create service" })[0]);
  fireEvent.change(screen.getByLabelText(/^Name:?$/), { target: { value: "Book Launch 2026" } });
  await user.click(screen.getByRole("combobox", { name: /Type/ }));
  await user.click(screen.getByRole("option", { name: "One-time date" }));
  await user.click(screen.getByLabelText("Date & Time"));
  const backToDate = screen.queryByRole("button", { name: /Back to date/ });
  if (backToDate) await user.click(backToDate);
  await user.selectOptions(screen.getByRole("combobox", { name: /year/i }), "2026");
  await user.selectOptions(screen.getByRole("combobox", { name: /month/i }), "10");
  await user.click(screen.getByRole("button", { name: /November 7.*2026/ }));
  await user.click(within(screen.getByRole("listbox", { name: "Select hour" })).getByRole("option", { name: "4" }));
  await user.click(within(screen.getByRole("listbox", { name: "Select minutes" })).getByRole("option", { name: "30" }));
  await user.click(within(screen.getByRole("listbox", { name: "Select AM or PM" })).getByRole("option", { name: "PM" }));
  await user.click(screen.getByRole("button", { name: "Done" }));
  await user.click(screen.getByRole("checkbox", { name: "Camera" }));
  expect(screen.getByLabelText("Date & Time")).toHaveValue("11/07/2026 04:30 PM");
  await user.click(screen.getAllByRole("button", { name: "Create service" }).at(-1)!);
  await waitFor(() => expect(mockRunTransaction).toHaveBeenCalledTimes(1));
  expect(mockRunTransaction).toHaveBeenCalledWith("churches/church-main/data/services", expect.any(Function), { applyLocally: false });
  const optimistic: ServiceTime[] = store.getState().undoable.present.serviceTimes.list;
  expect(optimistic.find(service => service.id === "1k6gq4vjthg7r1g7qg4g")).toMatchObject({ reccurence: "one_time", dateTimeISO: "2026-11-07T21:30:00.000Z" });
  expect(committed).toEqual(before);
  const optimisticOccurrences = buildTeamSchedulePeriod({ services: optimistic.map(toTeamService), positions, teamId: "boundary-media", startDate: "2026-11-01", endDate: "2026-11-30", timeZone: "America/New_York" }).occurrences;
  expect(optimisticOccurrences).toHaveLength(2);
  await act(async () => { releaseCommit(); });
  await waitFor(() => expect(store.getState().undoable.present.serviceTimes.list).toEqual(committed));
  expect(committed[0]).toEqual(before[0]);
  expect(screen.getByLabelText("Date & Time")).toHaveValue("11/07/2026 04:30 PM");
  view.unmount();
  for (const timeZone of ["UTC", "America/Los_Angeles"]) {
    const result = spawnSync(process.execPath, ["--import", pathToFileURL(require.resolve("tsx")).href, "server/fixtures/serviceCreateScheduleBoundary.js"], {
      cwd: path.resolve(process.cwd(), ".."), env: { ...process.env, TZ: timeZone }, encoding: "utf8", timeout: 30_000,
      input: JSON.stringify({ before, committed, optimisticOccurrences, createdId: "1k6gq4vjthg7r1g7qg4g" }),
    });
    if (result.status !== 0) throw new Error(result.stderr || String(result.error));
    const diagnostics = result.stderr.trim().split("\n").filter(line => line.startsWith("{")).map(line => JSON.parse(line));
    expect(diagnostics.filter(entry => entry.event === "schedule.occurrence.recurrence_mismatch")).toEqual([
      expect.objectContaining({ serviceId: "1k6gq4vjthg7r1g7qg4g", recurrence: "one_time", storedDateTimeISO: "2026-11-07T21:30:00.000Z", expectedLocalTime: "16:30", submittedLocalTime: "15:30", startsAt: "2026-11-07T20:30:00.000Z", serviceDate: "2026-11-07", timeZone: "America/New_York" }),
      expect.objectContaining({ serviceId: "existing-one-time", storedDateTimeISO: "2026-11-07T15:00:00.000Z", expectedLocalTime: "10:00", submittedLocalTime: "09:00" }),
    ]);
    expect({ status: result.status, output: result.stdout }).toEqual({ status: 0, output: expect.stringContaining('"reloadStatus":200') });
  }
}, 60_000);
