import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import {
  archiveTeamSchedule,
  createTeamSchedule,
  deleteTeamSchedule,
  updateTeamSchedule,
} from "../../../api/auth";
import type {
  TeamRecord,
  TeamSchedule,
  TeamService,
} from "../../../api/authTypes";
import { ToastProvider } from "../../../context/toastContext";
import { TeamsNavigationGuardProvider } from "../TeamsNavigationGuardContext";
import ScheduleEditForm from "./ScheduleEditForm";

jest.mock("../../../api/auth", () => ({
  archiveTeamSchedule: jest.fn(),
  createTeamSchedule: jest.fn(),
  deleteTeamSchedule: jest.fn(),
  updateTeamSchedule: jest.fn(),
}));

const mockUpdateTeamSchedule = jest.mocked(updateTeamSchedule);

describe("ScheduleEditForm", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(archiveTeamSchedule).mockResolvedValue({ success: true });
    jest.mocked(createTeamSchedule).mockRejectedValue(
      new Error("Create should not run in this test."),
    );
    jest.mocked(deleteTeamSchedule).mockResolvedValue({ success: true });
  });

  it("keeps guests in optimistic metadata saves and applies the server response", async () => {
    const user = userEvent.setup();
    const guestId = "scheduleGuest_jordan";
    const occurrenceId = "service-sunday@2026-07-05T10:00:00.000Z";
    const schedule: TeamSchedule = {
      scheduleId: "schedule-july",
      churchId: "church-1",
      name: "July",
      teamId: "team-main",
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      serviceIds: ["service-sunday"],
      occurrences: [
        {
          occurrenceId,
          serviceId: "service-sunday",
          name: "Sunday",
          startsAt: "2026-07-05T10:00:00.000Z",
        },
      ],
      assignments: {
        [occurrenceId]: {
          "position-keys::0": { primaryMemberId: guestId },
        },
      },
      guests: [{ guestId, name: "Jordan Avery" }],
    };
    const service: TeamService = {
      serviceId: "service-sunday",
      churchId: "church-1",
      name: "Sunday",
      reccurence: "one_time",
      dateTimeISO: "2026-07-05T10:00:00.000Z",
    };
    const team: TeamRecord = {
      teamId: "team-main",
      churchId: "church-1",
      name: "Main Team",
      memberIds: [],
    };
    const authoritativeSchedule: TeamSchedule = {
      ...schedule,
      name: "July updated",
      guests: [{ guestId, name: "Jordan Server" }],
    };
    let resolveSave: (value: Awaited<ReturnType<typeof updateTeamSchedule>>) => void =
      () => undefined;
    mockUpdateTeamSchedule.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );
    const onScheduleSaved = jest.fn();

    render(
      <MemoryRouter>
        <TeamsNavigationGuardProvider>
          <ToastProvider>
            <ScheduleEditForm
              draftKey={schedule.scheduleId}
              selectedSchedule={schedule}
              defaultTeamId={team.teamId}
              defaultServiceIds={[service.serviceId]}
              defaultRange={{ startDate: "2026-07-01", endDate: "2026-07-31" }}
              services={[service]}
              activeTeams={[team]}
              schedules={[schedule]}
              seedSchedules={[schedule]}
              churchId="church-1"
              canEdit
              onDraftChange={jest.fn()}
              onDraftFlush={jest.fn()}
              onDraftClear={jest.fn()}
              onScheduleSaved={onScheduleSaved}
              onScheduleRemoved={jest.fn()}
              setSelectedScheduleId={jest.fn()}
              onCancel={jest.fn()}
            />
          </ToastProvider>
        </TeamsNavigationGuardProvider>
      </MemoryRouter>,
    );

    const nameInput = screen.getByRole("textbox", { name: /^Name:?$/i });
    await user.clear(nameInput);
    await user.type(nameInput, "July updated");
    await user.click(screen.getByRole("button", { name: /Save schedule/i }));

    await waitFor(() => expect(mockUpdateTeamSchedule).toHaveBeenCalledTimes(1));
    expect(mockUpdateTeamSchedule.mock.calls[0][2].guests).toEqual(schedule.guests);
    expect(onScheduleSaved).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ guests: schedule.guests }),
    );

    await act(async () => {
      resolveSave({ success: true, schedule: authoritativeSchedule });
    });
    await waitFor(() => expect(onScheduleSaved).toHaveBeenCalledTimes(2));
    expect(onScheduleSaved).toHaveBeenNthCalledWith(2, authoritativeSchedule);
  });

  it("fills the name from dates on create and clears the new draft", async () => {
    const user = userEvent.setup();
    const service: TeamService = {
      serviceId: "service-sunday",
      churchId: "church-1",
      name: "Sunday",
      reccurence: "weekly",
      dayOfWeek: 0,
      time: "10:00",
    };
    const team: TeamRecord = {
      teamId: "team-main",
      churchId: "church-1",
      name: "Main Team",
      memberIds: [],
    };
    const created: TeamSchedule = {
      scheduleId: "schedule-october",
      churchId: "church-1",
      name: "October 2026",
      teamId: team.teamId,
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      serviceIds: [service.serviceId],
      occurrences: [],
      assignments: {},
    };
    jest.mocked(createTeamSchedule).mockResolvedValue({
      success: true,
      schedule: created,
    });
    const onDraftClear = jest.fn();
    const onCancel = jest.fn();

    render(
      <MemoryRouter>
        <TeamsNavigationGuardProvider>
          <ToastProvider>
            <ScheduleEditForm
              draftKey="new"
              selectedSchedule={null}
              defaultTeamId={team.teamId}
              defaultServiceIds={[service.serviceId]}
              defaultRange={{ startDate: "2026-10-01", endDate: "2026-10-31" }}
              services={[service]}
              activeTeams={[team]}
              schedules={[]}
              seedSchedules={[]}
              churchId="church-1"
              canEdit
              onDraftChange={jest.fn()}
              onDraftFlush={jest.fn()}
              onDraftClear={onDraftClear}
              onScheduleSaved={jest.fn()}
              onScheduleRemoved={jest.fn()}
              setSelectedScheduleId={jest.fn()}
              onCancel={onCancel}
            />
          </ToastProvider>
        </TeamsNavigationGuardProvider>
      </MemoryRouter>,
    );

    expect(
      screen.getByText(/Saved as “October 2026” unless you enter a name/i),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Save schedule/i }));

    await waitFor(() => expect(createTeamSchedule).toHaveBeenCalledTimes(1));
    expect(createTeamSchedule.mock.calls[0][1]).toEqual(
      expect.objectContaining({ name: "October 2026" }),
    );
    expect(onDraftClear).toHaveBeenCalledWith("new");
    expect(onCancel).toHaveBeenCalled();
  });

  it("points operators to create a team when none exist", () => {
    const service: TeamService = {
      serviceId: "service-sunday",
      churchId: "church-1",
      name: "Sunday",
      reccurence: "weekly",
      dayOfWeek: 0,
      time: "10:00",
    };

    render(
      <MemoryRouter>
        <TeamsNavigationGuardProvider>
          <ToastProvider>
            <ScheduleEditForm
              draftKey="new"
              selectedSchedule={null}
              defaultTeamId=""
              defaultServiceIds={[service.serviceId]}
              defaultRange={{ startDate: "2026-10-01", endDate: "2026-10-31" }}
              services={[service]}
              activeTeams={[]}
              schedules={[]}
              seedSchedules={[]}
              churchId="church-1"
              canEdit
              onDraftChange={jest.fn()}
              onDraftFlush={jest.fn()}
              onDraftClear={jest.fn()}
              onScheduleSaved={jest.fn()}
              onScheduleRemoved={jest.fn()}
              setSelectedScheduleId={jest.fn()}
              onCancel={jest.fn()}
            />
          </ToastProvider>
        </TeamsNavigationGuardProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText(/No teams yet/i)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Create a team/i }),
    ).toHaveAttribute("href", "/teams-and-services/groups");
  });
});
