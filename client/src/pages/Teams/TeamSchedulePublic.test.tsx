import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import TeamSchedulePublic from "./TeamSchedulePublic";
import { getPublicTeamSchedule } from "../../api/auth";
import {
  TEAM_SCHEDULE_PUBLIC_HIGHLIGHT_STORAGE_KEY,
  writeTeamSchedulePublicHighlight,
} from "./teamSchedulePublicHighlight";
import {
  TEAM_SCHEDULE_PUBLIC_LAYOUT_STORAGE_KEY,
  writeTeamSchedulePublicLayout,
} from "./teamSchedulePublicLayout";
import {
  TEAM_SCHEDULE_PUBLIC_THEME_STORAGE_KEY,
  writeTeamSchedulePublicTheme,
} from "./teamSchedulePublicTheme";

jest.mock("../../api/auth", () => ({
  getPublicTeamSchedule: jest.fn(),
}));

// jsPDF pulls in browser-only globals; the export button isn't under test here.
jest.mock("./schedule/SchedulePdfExportButton", () => ({
  __esModule: true,
  default: () => <button type="button">Export PDF</button>,
}));

const mockGet = jest.mocked(getPublicTeamSchedule);

const occurrenceId = "svc@2026-06-13T10:00:00.000Z";
const snapshot = {
  success: true,
  churchName: "Grace Chapel",
  teamName: "Worship Team",
  schedule: {
    scheduleId: "sch_1",
    name: "June Schedule",
    teamId: "team_1",
    startDate: "2026-06-01",
    endDate: "2026-06-30",
    occurrences: [
      {
        occurrenceId,
        serviceId: "svc",
        name: "Sabbath",
        startsAt: "2026-06-13T10:00:00.000Z",
      },
    ],
    assignments: {
      [occurrenceId]: { "pos_1::0": { primaryMemberId: "m1" } },
    },
  },
  positions: [
    { positionId: "pos_1", name: "Vocalist", groupId: "", archivedAt: null },
  ],
  members: [{ memberId: "m1", name: "Jordan" }],
};

const multiServiceSnapshot = {
  success: true,
  churchName: "Grace Chapel",
  teamName: "Production",
  schedule: {
    scheduleId: "sch_2",
    name: "Summer Schedule",
    teamId: "team_1",
    startDate: "2026-06-01",
    endDate: "2026-06-30",
    occurrences: [
      {
        occurrenceId: "svcA@2026-06-13T10:00:00.000Z",
        serviceId: "svcA",
        name: "Sabbath",
        startsAt: "2026-06-13T10:00:00.000Z",
      },
      {
        occurrenceId: "svcB@2026-06-18T19:00:00.000Z",
        serviceId: "svcB",
        name: "Wednesday",
        startsAt: "2026-06-18T19:00:00.000Z",
      },
    ],
    assignments: {
      "svcA@2026-06-13T10:00:00.000Z": {
        "pos_dir::0": { primaryMemberId: "m1" },
      },
      "svcB@2026-06-18T19:00:00.000Z": {
        "pos_cam::0": { primaryMemberId: "m2" },
      },
    },
  },
  positions: [
    { positionId: "pos_dir", name: "Director", groupId: "", archivedAt: null },
    { positionId: "pos_cam", name: "Camera", groupId: "", archivedAt: null },
  ],
  members: [
    { memberId: "m1", name: "Jordan" },
    { memberId: "m2", name: "Alex" },
  ],
};

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/team-schedule/tok_123"]}>
      <Routes>
        <Route path="/team-schedule/:token" element={<TeamSchedulePublic />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
});

test("renders the read-only schedule from the public snapshot", async () => {
  mockGet.mockResolvedValue(snapshot as never);
  renderPage();

  expect(await screen.findByText("June Schedule")).toBeInTheDocument();
  expect(screen.getByText("Grace Chapel · Worship Team")).toBeInTheDocument();
  expect(screen.getByText(/June 1, 2026 – June 30, 2026/)).toBeInTheDocument();
  expect(mockGet).toHaveBeenCalledWith("tok_123");
});

test("keeps a late Saturday public service on the church date and clock", async () => {
  mockGet.mockResolvedValue({
    ...snapshot,
    serviceTimeZone: "America/New_York",
    schedule: {
      ...snapshot.schedule,
      occurrences: [{
        ...snapshot.schedule.occurrences[0],
        occurrenceId: "svc@2026-06-14T03:30:00.000Z",
        startsAt: "2026-06-14T03:30:00.000Z",
        serviceDate: "2026-06-13",
      }],
      assignments: {
        "svc@2026-06-14T03:30:00.000Z": { "pos_1::0": { primaryMemberId: "m1" } },
      },
    },
  } as never);
  renderPage();

  await screen.findByText("June Schedule");
  expect(document.body).toHaveTextContent("Sat");
  expect(document.body).toHaveTextContent("11:30 PM EDT");
  expect(document.body).not.toHaveTextContent("3:30 AM");
});

test("renders compact equipment in all layouts, including an unstaffed slot", async () => {
  const user = userEvent.setup();
  const equipmentSnapshot = {
    ...snapshot,
    schedule: {
      ...snapshot.schedule,
      microphoneAssignments: {
        [occurrenceId]: {
          "pos_1::0": ["mic-1"],
          "pos_1::1": ["mic-2"],
        },
      },
      iemAssignments: {
        [occurrenceId]: { "pos_1::0": ["iem-1"] },
      },
    },
    microphones: [
      { id: "mic-1", name: "Black", type: "Handheld", color: "#123456" },
      { id: "mic-2", name: "Spare", type: "Lapel", color: "#abcdef" },
    ],
    serviceEquipment: [
      { id: "iem-1", category: "iem", name: "IEM 1", subtype: "wireless-beltpack", color: "#654321" },
    ],
  };
  mockGet.mockResolvedValue(equipmentSnapshot as never);
  writeTeamSchedulePublicLayout("byDate");
  writeTeamSchedulePublicTheme("light");
  renderPage();

  await screen.findByText("June Schedule");
  expect(screen.getByText("Jordan")).toBeInTheDocument();
  expect(screen.getByLabelText("microphone: Black")).toBeInTheDocument();
  expect(screen.getByLabelText("iem: IEM 1")).toBeInTheDocument();
  expect(screen.getByLabelText("microphone: Spare")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "By position" }));
  expect(screen.getByLabelText("microphone: Black")).toBeInTheDocument();
  expect(screen.getByLabelText("iem: IEM 1")).toBeInTheDocument();
  expect(screen.getByLabelText("microphone: Spare")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Grid" }));
  expect(screen.getByLabelText("microphone: Black")).toBeInTheDocument();
  expect(screen.getByLabelText("iem: IEM 1")).toBeInTheDocument();
  expect(screen.getByLabelText("microphone: Spare")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Switch to dark theme" }));
  expect(screen.getByLabelText("microphone: Black")).toBeInTheDocument();
  expect(screen.getByLabelText("iem: IEM 1")).toBeInTheDocument();
});

test("shows an error state when the link is no longer valid", async () => {
  mockGet.mockRejectedValue(new Error("Invalid or expired link."));
  renderPage();

  expect(await screen.findByText("Schedule unavailable")).toBeInTheDocument();
  expect(
    screen.getByText("Invalid or expired link. Ask your team admin for a new link."),
  ).toBeInTheDocument();
});

test("restores layout, theme, and highlight preferences from localStorage", async () => {
  writeTeamSchedulePublicLayout("byDate");
  writeTeamSchedulePublicTheme("light");
  writeTeamSchedulePublicHighlight("m1");
  mockGet.mockResolvedValue(snapshot as never);
  renderPage();

  await screen.findByText("June Schedule");

  expect(screen.getByRole("button", { name: "Switch to dark theme" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "By date" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  const highlightedScheduleName = screen
    .getAllByText("Jordan")
    .find((element) => element.classList.contains("font-semibold"));
  expect(highlightedScheduleName).toHaveClass("bg-amber-200");
});

test("persists layout, theme, and highlight changes to localStorage", async () => {
  const user = userEvent.setup();
  writeTeamSchedulePublicTheme("light");
  mockGet.mockResolvedValue(snapshot as never);
  renderPage();

  await screen.findByText("June Schedule");

  await user.click(screen.getByRole("button", { name: "By date" }));
  expect(localStorage.getItem(TEAM_SCHEDULE_PUBLIC_LAYOUT_STORAGE_KEY)).toBe("byDate");

  await user.click(screen.getByRole("button", { name: "Switch to dark theme" }));
  expect(localStorage.getItem(TEAM_SCHEDULE_PUBLIC_THEME_STORAGE_KEY)).toBe("dark");

  await user.click(screen.getByRole("button", { name: "Highlight a person" }));
  await user.click(screen.getByRole("button", { name: "Jordan" }));
  expect(localStorage.getItem(TEAM_SCHEDULE_PUBLIC_HIGHLIGHT_STORAGE_KEY)).toBe("m1");
});

test("scopes by date cards to each service's positions", async () => {
  writeTeamSchedulePublicLayout("byDate");
  mockGet.mockResolvedValue(multiServiceSnapshot as never);
  renderPage();

  await screen.findByText("Summer Schedule");

  expect(screen.getByText("Sabbath")).toBeInTheDocument();
  expect(screen.getByText("Wednesday")).toBeInTheDocument();
  expect(screen.getAllByText("Director")).toHaveLength(1);
  expect(screen.getAllByText("Camera")).toHaveLength(1);
  expect(screen.getByText("Jordan")).toBeInTheDocument();
  expect(screen.getByText("Alex")).toBeInTheDocument();
});

test("debounces tab-focus refetches and respects a minimum interval", async () => {
  mockGet.mockResolvedValue(snapshot as never);
  renderPage();

  await screen.findByText("June Schedule");
  expect(mockGet).toHaveBeenCalledTimes(1);

  jest.useFakeTimers();

  fireEvent.focus(window);
  act(() => {
    jest.advanceTimersByTime(499);
  });
  expect(mockGet).toHaveBeenCalledTimes(1);

  act(() => {
    jest.advanceTimersByTime(1);
  });
  expect(mockGet).toHaveBeenCalledTimes(2);

  fireEvent.focus(window);
  act(() => {
    jest.advanceTimersByTime(500);
  });
  expect(mockGet).toHaveBeenCalledTimes(2);

  act(() => {
    jest.advanceTimersByTime(30_000);
  });
  fireEvent.focus(window);
  act(() => {
    jest.advanceTimersByTime(500);
  });
  expect(mockGet).toHaveBeenCalledTimes(3);

  jest.useRealTimers();
});
