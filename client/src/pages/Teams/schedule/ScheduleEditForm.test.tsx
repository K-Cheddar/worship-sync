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
import { buildScheduleCopyDraft } from "./scheduleDraftUtils";

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
      source: "custom",
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
      id: "service-sunday",
      serviceId: "service-sunday",
      churchId: "church-1",
      name: "Sunday",
      timerType: "countdown",
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
    const onCancel = jest.fn();

    render(
      <MemoryRouter>
        <TeamsNavigationGuardProvider>
          <ToastProvider>
            <ScheduleEditForm
              mode="edit"
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
              onCancel={onCancel}
            />
          </ToastProvider>
        </TeamsNavigationGuardProvider>
      </MemoryRouter>,
    );

    expect(screen.getByLabelText(/Team/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Start date/)).toBeInTheDocument();
    expect(screen.getByLabelText(/End date/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Services" })).toBeInTheDocument();

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
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("limits generated-period editing to metadata and submits its stored identity", async () => {
    const user = userEvent.setup();
    const occurrenceId = "service-sunday@2026-07-05T10:00:00.000Z";
    const schedule: TeamSchedule = {
      scheduleId: "generated_period-key",
      churchId: "church-1",
      name: "July",
      description: "Before",
      teamId: "team-main",
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      serviceIds: ["service-sunday"],
      source: "generated-period",
      generatedPeriodKey: "period-key",
      occurrences: [{
        occurrenceId,
        serviceId: "service-sunday",
        name: "Sunday",
        startsAt: "2026-07-05T10:00:00.000Z",
      }],
      assignments: {
        [occurrenceId]: {
          "position-keys::0": { primaryMemberId: "member-1" },
        },
      },
    };
    mockUpdateTeamSchedule.mockResolvedValue({ success: true, schedule: { ...schedule, description: "Updated" } });
    const team: TeamRecord = {
      teamId: "team-main",
      churchId: "church-1",
      name: "Main Team",
      memberIds: [],
    };
    const service: TeamService = {
      id: "service-sunday",
      serviceId: "service-sunday",
      churchId: "church-1",
      name: "Sunday",
      timerType: "countdown",
      reccurence: "one_time",
      dateTimeISO: "2026-07-05T10:00:00.000Z",
    };
    render(
      <MemoryRouter>
        <TeamsNavigationGuardProvider>
          <ToastProvider>
            <ScheduleEditForm
              mode="edit"
              draftKey={schedule.scheduleId}
              selectedSchedule={schedule}
              defaultTeamId={team.teamId}
              defaultServiceIds={[service.serviceId]}
              defaultRange={{ startDate: schedule.startDate!, endDate: schedule.endDate! }}
              services={[service]}
              activeTeams={[team]}
              schedules={[schedule]}
              seedSchedules={[schedule]}
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

    expect(screen.queryByLabelText(/Team/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Start date/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/End date/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Services" })).not.toBeInTheDocument();
    expect(screen.getByText(/Copy it to change the team, dates, or services/i)).toBeInTheDocument();
    await user.clear(screen.getByRole("textbox", { name: /^Description:?$/i }));
    await user.type(screen.getByRole("textbox", { name: /^Description:?$/i }), "Updated");
    await user.click(screen.getByRole("button", { name: /Save schedule/i }));

    await waitFor(() => expect(mockUpdateTeamSchedule).toHaveBeenCalledTimes(1));
    expect(mockUpdateTeamSchedule.mock.calls[0][2]).toEqual(expect.objectContaining({
      teamId: schedule.teamId,
      startDate: schedule.startDate,
      endDate: schedule.endDate,
      serviceIds: schedule.serviceIds,
      occurrences: schedule.occurrences,
    }));
  });

  it("opens explicit custom create mode even when a period schedule is active", async () => {
    const user = userEvent.setup();
    const service: TeamService = {
      id: "service-sunday",
      serviceId: "service-sunday",
      churchId: "church-1",
      name: "Sunday",
      timerType: "countdown",
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
    const activePeriodSchedule: TeamSchedule = {
      ...created,
      scheduleId: "generated_period-key",
      name: "Generated period",
      source: "generated-period",
      generatedPeriodKey: "period-key",
      assignments: {
        "service-sunday@2026-10-04T10:00:00.000Z": {
          "position-keys::0": { primaryMemberId: "member-1" },
        },
      },
    };
    jest.mocked(createTeamSchedule).mockResolvedValue({
      success: true,
      schedule: created,
    });
    const onDraftClear = jest.fn();
    const onCancel = jest.fn();
    const setSelectedScheduleId = jest.fn();

    render(
      <MemoryRouter>
        <TeamsNavigationGuardProvider>
          <ToastProvider>
            <ScheduleEditForm
              mode="create-custom"
              draftKey="new:custom"
              selectedSchedule={activePeriodSchedule}
              defaultTeamId={team.teamId}
              defaultServiceIds={[service.serviceId]}
              defaultRange={{ startDate: "2026-10-01", endDate: "2026-10-31" }}
              services={[service]}
              activeTeams={[team]}
              schedules={[activePeriodSchedule]}
              seedSchedules={[activePeriodSchedule]}
              churchId="church-1"
              canEdit
              onDraftChange={jest.fn()}
              onDraftFlush={jest.fn()}
              onDraftClear={onDraftClear}
              onScheduleSaved={jest.fn()}
              onScheduleRemoved={jest.fn()}
              setSelectedScheduleId={setSelectedScheduleId}
              onCancel={onCancel}
            />
          </ToastProvider>
        </TeamsNavigationGuardProvider>
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "New custom schedule" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Team/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Start date/)).toBeInTheDocument();
    expect(screen.getByLabelText(/End date/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Services" })).toBeInTheDocument();
    expect(
      screen.getByText(/Saved as “October 2026” unless you enter a name/i),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Create schedule/i }));

    await waitFor(() => expect(createTeamSchedule).toHaveBeenCalledTimes(1));
    expect(jest.mocked(createTeamSchedule).mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ name: "October 2026", assignments: {} }),
    );
    expect(jest.mocked(updateTeamSchedule)).not.toHaveBeenCalled();
    expect(onDraftClear).toHaveBeenCalledWith("new:custom");
    expect(setSelectedScheduleId).toHaveBeenCalledWith(created.scheduleId);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("points operators to create a team when none exist", () => {
    const service: TeamService = {
      id: "service-sunday",
      serviceId: "service-sunday",
      churchId: "church-1",
      name: "Sunday",
      timerType: "countdown",
      reccurence: "weekly",
      dayOfWeek: 0,
      time: "10:00",
    };

    render(
      <MemoryRouter>
        <TeamsNavigationGuardProvider>
          <ToastProvider>
            <ScheduleEditForm
              mode="create-custom"
              draftKey="new:custom"
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

  it("resets drafts when switching between custom, copy, and edit intents", async () => {
    const user = userEvent.setup();
    const occurrence = {
      occurrenceId: "service-sunday@2026-10-04T10:00:00.000Z",
      serviceId: "service-sunday",
      name: "Sunday",
      startsAt: "2026-10-04T10:00:00.000Z",
    };
    const service: TeamService = {
      id: "service-sunday",
      serviceId: "service-sunday",
      churchId: "church-1",
      name: "Sunday",
      timerType: "countdown",
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
    const source: TeamSchedule = {
      scheduleId: "schedule-source",
      churchId: "church-1",
      name: "Source schedule",
      teamId: team.teamId,
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      serviceIds: [service.serviceId],
      occurrences: [occurrence],
      assignments: {
        [occurrence.occurrenceId]: {
          "position-keys::0": { primaryMemberId: "member-1" },
        },
      },
    };
    const copyDraft = buildScheduleCopyDraft({ source, occurrences: [occurrence] });
    const commonProps = {
      defaultTeamId: team.teamId,
      defaultServiceIds: [service.serviceId],
      defaultRange: { startDate: "2026-10-01", endDate: "2026-10-31" },
      services: [service],
      activeTeams: [team],
      schedules: [source],
      seedSchedules: [source],
      churchId: "church-1",
      canEdit: true,
      onDraftChange: jest.fn(),
      onDraftFlush: jest.fn(),
      onDraftClear: jest.fn(),
      onScheduleSaved: jest.fn(),
      onScheduleRemoved: jest.fn(),
      setSelectedScheduleId: jest.fn(),
      onCancel: jest.fn(),
    };

    const view = render(
      <MemoryRouter>
        <TeamsNavigationGuardProvider>
          <ToastProvider>
            <ScheduleEditForm
              {...commonProps}
              mode="create-custom"
              draftKey="new:custom"
              selectedSchedule={source}
            />
          </ToastProvider>
        </TeamsNavigationGuardProvider>
      </MemoryRouter>,
    );

    const nameInput = screen.getByRole("textbox", { name: /^Name:?$/i });
    await user.type(nameInput, "Custom draft");
    view.rerender(
      <MemoryRouter>
        <TeamsNavigationGuardProvider>
          <ToastProvider>
            <ScheduleEditForm
              {...commonProps}
              mode="copy"
              draftKey="new:copy:schedule-source"
              persistedDraft={copyDraft}
              selectedSchedule={null}
              copySourceSchedule={source}
            />
          </ToastProvider>
        </TeamsNavigationGuardProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByRole("textbox", { name: /^Name:?$/i })).toHaveValue("Copy of Source schedule"));

    view.rerender(
      <MemoryRouter>
        <TeamsNavigationGuardProvider>
          <ToastProvider>
            <ScheduleEditForm
              {...commonProps}
              mode="edit"
              draftKey={source.scheduleId}
              selectedSchedule={source}
            />
          </ToastProvider>
        </TeamsNavigationGuardProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByRole("textbox", { name: /^Name:?$/i })).toHaveValue("Source schedule"));
    expect(screen.getByRole("heading", { name: "Edit schedule" })).toBeInTheDocument();
  });
});
