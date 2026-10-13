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
import { TeamsNavigationGuardProvider, useTeamsNavigationGuard } from "../TeamsNavigationGuardContext";
import ScheduleEditForm from "./ScheduleEditForm";
import { buildScheduleCopyDraft } from "./scheduleDraftUtils";

jest.mock("../../../api/auth", () => ({
  AuthApiError: class AuthApiError extends Error {},
  archiveTeamSchedule: jest.fn(),
  createTeamSchedule: jest.fn(),
  deleteTeamSchedule: jest.fn(),
  updateTeamSchedule: jest.fn(),
}));

const mockUpdateTeamSchedule = jest.mocked(updateTeamSchedule);

const NavigationProbe = () => {
  const { requestNavigation } = useTeamsNavigationGuard();
  return <button type="button" onClick={() => requestNavigation("/elsewhere")}>Leave schedule editor</button>;
};

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
              positions={[]}
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
            <NavigationProbe />
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
    expect(screen.getByRole("button", { name: "Saved" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Leave schedule editor" }));
    expect(screen.queryByRole("dialog", { name: "Unsaved changes" })).not.toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("does not select the saved schedule after the editor moves to another schedule", async () => {
    const user = userEvent.setup();
    const service: TeamService = {
      id: "service-sunday", serviceId: "service-sunday", churchId: "church-1",
      name: "Sunday", timerType: "countdown", reccurence: "one_time",
      dateTimeISO: "2026-07-05T10:00:00.000Z",
    };
    const firstSchedule: TeamSchedule = {
      scheduleId: "schedule-first",
      churchId: "church-1",
      name: "First schedule",
      teamId: "team-main",
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      serviceIds: [service.serviceId],
      occurrences: [],
      assignments: {},
    };
    const secondSchedule: TeamSchedule = {
      ...firstSchedule,
      scheduleId: "schedule-second",
      name: "Second schedule",
    };
    const team: TeamRecord = {
      teamId: "team-main", churchId: "church-1", name: "Main Team", memberIds: [],
    };
    let resolveSave: (value: Awaited<ReturnType<typeof updateTeamSchedule>>) => void = () => undefined;
    mockUpdateTeamSchedule.mockImplementationOnce(
      () => new Promise((resolve) => { resolveSave = resolve; }),
    );
    const setSelectedScheduleId = jest.fn();
    const renderEditor = (schedule: TeamSchedule) => (
      <MemoryRouter>
        <TeamsNavigationGuardProvider>
          <ToastProvider>
            <ScheduleEditForm
              mode="edit"
              draftKey={schedule.scheduleId}
              selectedSchedule={schedule}
              positions={[]}
              defaultTeamId={team.teamId}
              defaultServiceIds={[service.serviceId]}
              defaultRange={{ startDate: "2026-07-01", endDate: "2026-07-31" }}
              services={[service]}
              activeTeams={[team]}
              schedules={[firstSchedule, secondSchedule]}
              seedSchedules={[firstSchedule, secondSchedule]}
              churchId="church-1"
              canEdit
              onDraftChange={jest.fn()}
              onDraftFlush={jest.fn()}
              onDraftClear={jest.fn()}
              onScheduleSaved={jest.fn()}
              onScheduleRemoved={jest.fn()}
              setSelectedScheduleId={setSelectedScheduleId}
              onCancel={jest.fn()}
            />
          </ToastProvider>
        </TeamsNavigationGuardProvider>
      </MemoryRouter>
    );
    const view = render(renderEditor(firstSchedule));

    await user.clear(screen.getByRole("textbox", { name: /^Name:?$/i }));
    await user.type(screen.getByRole("textbox", { name: /^Name:?$/i }), "First edited");
    await user.click(screen.getByRole("button", { name: /Save schedule/i }));
    await waitFor(() => expect(mockUpdateTeamSchedule).toHaveBeenCalledTimes(1));

    view.rerender(renderEditor(secondSchedule));
    await waitFor(() => expect(screen.getByRole("textbox", { name: /^Name:?$/i })).toHaveValue("Second schedule"));
    await act(async () => resolveSave({
      success: true,
      schedule: { ...firstSchedule, name: "First edited" },
    }));

    expect(screen.getByRole("textbox", { name: /^Name:?$/i })).toHaveValue("Second schedule");
    expect(setSelectedScheduleId).not.toHaveBeenCalled();
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
              positions={[]}
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
              positions={[]}
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

    expect(screen.getByRole("heading", { name: "New schedule" })).toBeInTheDocument();
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

  it("removes the optimistic schedule when a create request fails and keeps the draft", async () => {
    const user = userEvent.setup();
    jest.mocked(createTeamSchedule).mockRejectedValueOnce(new Error("Create failed"));
    const service: TeamService = {
      id: "service-sunday", serviceId: "service-sunday", churchId: "church-1",
      name: "Sunday", timerType: "countdown", reccurence: "one_time",
      dateTimeISO: "2026-07-05T10:00:00.000Z",
    };
    const team: TeamRecord = {
      teamId: "team-main", churchId: "church-1", name: "Main Team", memberIds: [],
    };
    const onScheduleSaved = jest.fn();
    const onScheduleRemoved = jest.fn();
    render(
      <MemoryRouter>
        <TeamsNavigationGuardProvider>
          <ToastProvider>
            <ScheduleEditForm
              mode="create-custom"
              draftKey="new:custom"
              selectedSchedule={null}
              positions={[]}
              defaultTeamId={team.teamId}
              defaultServiceIds={[service.serviceId]}
              defaultRange={{ startDate: "2026-07-01", endDate: "2026-07-31" }}
              services={[service]}
              activeTeams={[team]}
              schedules={[]}
              seedSchedules={[]}
              churchId="church-1"
              canEdit
              onDraftChange={jest.fn()}
              onDraftFlush={jest.fn()}
              onDraftClear={jest.fn()}
              onScheduleSaved={onScheduleSaved}
              onScheduleRemoved={onScheduleRemoved}
              setSelectedScheduleId={jest.fn()}
              onCancel={jest.fn()}
            />
          </ToastProvider>
        </TeamsNavigationGuardProvider>
      </MemoryRouter>,
    );

    await user.type(screen.getByRole("textbox", { name: /^Name:?$/i }), "Recoverable draft");
    await user.click(screen.getByRole("button", { name: /Create schedule/i }));
    await waitFor(() => expect(createTeamSchedule).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onScheduleRemoved).toHaveBeenCalledWith(
      expect.stringMatching(/^local-schedule-/),
    ));

    expect(onScheduleSaved).toHaveBeenCalledWith(expect.objectContaining({
      name: "Recoverable draft",
      scheduleId: expect.stringMatching(/^local-schedule-/),
    }));
    expect(screen.getByRole("textbox", { name: /^Name:?$/i })).toHaveValue("Recoverable draft");
  });

  it("rolls a failed schedule save back to a newer incoming server record", async () => {
    const user = userEvent.setup();
    const service: TeamService = {
      id: "service-sunday", serviceId: "service-sunday", churchId: "church-1",
      name: "Sunday", timerType: "countdown", reccurence: "one_time",
      dateTimeISO: "2026-07-05T10:00:00.000Z",
    };
    const schedule: TeamSchedule = {
      scheduleId: "schedule-remote",
      churchId: "church-1",
      name: "Original schedule",
      teamId: "team-main",
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      serviceIds: [service.serviceId],
      occurrences: [],
      assignments: {},
    };
    const remoteSchedule = { ...schedule, name: "Remote update" };
    const team: TeamRecord = {
      teamId: "team-main", churchId: "church-1", name: "Main Team", memberIds: [],
    };
    let rejectSave: (error: Error) => void = () => undefined;
    mockUpdateTeamSchedule.mockImplementationOnce(
      () => new Promise((_, reject) => { rejectSave = reject; }),
    );
    const onScheduleSaved = jest.fn();
    const renderEditor = (selectedSchedule: TeamSchedule) => (
      <MemoryRouter>
        <TeamsNavigationGuardProvider>
          <ToastProvider>
            <ScheduleEditForm
              mode="edit"
              draftKey={schedule.scheduleId}
              selectedSchedule={selectedSchedule}
              positions={[]}
              defaultTeamId={team.teamId}
              defaultServiceIds={[service.serviceId]}
              defaultRange={{ startDate: "2026-07-01", endDate: "2026-07-31" }}
              services={[service]}
              activeTeams={[team]}
              schedules={[selectedSchedule]}
              seedSchedules={[selectedSchedule]}
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
      </MemoryRouter>
    );
    const view = render(renderEditor(schedule));

    await user.clear(screen.getByRole("textbox", { name: /^Name:?$/i }));
    await user.type(screen.getByRole("textbox", { name: /^Name:?$/i }), "Local edit");
    await user.click(screen.getByRole("button", { name: /Save schedule/i }));
    await waitFor(() => expect(mockUpdateTeamSchedule).toHaveBeenCalledTimes(1));
    view.rerender(renderEditor(remoteSchedule));

    await act(async () => rejectSave(new Error("Save failed")));
    expect(onScheduleSaved).toHaveBeenNthCalledWith(2, remoteSchedule);
    expect(screen.getByRole("textbox", { name: /^Name:?$/i })).toHaveValue("Local edit");
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
              positions={[]}
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
      positions: [],
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
