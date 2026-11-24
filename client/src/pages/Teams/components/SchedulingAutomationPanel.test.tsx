import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  getSchedulingAutomation,
  getSchedulingCycle,
  previewSchedulingCycle,
  saveChurchSchedulingDefaults,
  setAvailabilityAutomation,
  type SchedulingAutomationResponse,
} from "../../../api/auth";
import type {
  SchedulingCycleAction,
  SchedulingCycleRecord,
} from "../../../api/authTypes";
import SchedulingAutomationPanel from "./SchedulingAutomationPanel";

jest.mock("../../../api/auth", () => ({
  getSchedulingAutomation: jest.fn(),
  getSchedulingCycle: jest.fn(),
  previewSchedulingCycle: jest.fn(),
  saveChurchSchedulingDefaults: jest.fn(),
  setAvailabilityAutomation: jest.fn(),
  saveTeamSchedulingOverride: jest.fn(),
}));

const settings = {
  frequency: "monthly" as const,
  preparationDay: 24,
  availabilityRequestLeadDays: 14,
  followUpAfterDays: 3,
  leaderSummaryAfterDays: 3,
  availabilityResponseLeadDays: 3 as const,
  localExecutionTime: "09:00",
  publicationPolicy: "manual" as const,
};

const cycle: SchedulingCycleRecord = {
  cycleId: "cycle-1",
  churchId: "church-1",
  scopeType: "team",
  teamId: "team-1",
  periodId: "2026-12",
  periodStart: "2026-12-01",
  periodEnd: "2026-12-31",
  serviceTimeZone: "America/New_York",
  configurationRevision: "church:1",
  effectiveConfiguration: settings,
  lifecycleState: "planned",
  automationEnabled: false,
  publicationPolicy: "manual",
  availabilityFormIds: [],
  scheduleIds: [],
  plannedActionIds: ["action-request", "action-manual"],
  deadlines: {
    preparation: { localDate: "2026-11-24", localTime: "09:00", dueAt: "2026-11-24T14:00:00.000Z" },
    availabilityRequest: { localDate: "2026-11-10", localTime: "09:00", dueAt: "2026-11-10T14:00:00.000Z" },
    availabilityFollowUp: { localDate: "2026-11-13", localTime: "09:00", dueAt: "2026-11-13T14:00:00.000Z" },
    leaderSummary: { localDate: "2026-11-16", localTime: "09:00", dueAt: "2026-11-16T14:00:00.000Z" },
    availabilityResponse: { localDate: "2026-11-21", localTime: "09:00", dueAt: "2026-11-21T14:00:00.000Z" },
  },
  schemaVersion: 1,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};

const actions: SchedulingCycleAction[] = [
  {
    actionId: "action-request", id: "availability_request", cycleId: "cycle-1", churchId: "church-1",
    teamId: "team-1", periodId: "2026-12", actionType: "availability_request", localDate: "2026-11-10",
    localTime: "09:00", serviceTimeZone: "America/New_York", dueAt: "2026-11-10T14:00:00.000Z",
    state: "planned", enabled: false, relatedFormId: null, relatedScheduleId: null,
    configurationRevision: "church:1", idempotencyKey: "action-request", cancelReason: null,
    supersededByActionId: null, attemptCount: 0, claimedAt: null, claimExpiresAt: null,
    lastAttemptAt: null, completedAt: null, lastError: null, result: null, schemaVersion: 1,
    createdAt: cycle.createdAt, updatedAt: cycle.updatedAt,
  },
  {
    actionId: "action-deadline", id: "availability_response_deadline", cycleId: "cycle-1", churchId: "church-1",
    teamId: "team-1", periodId: "2026-12", actionType: "availability_response_deadline", localDate: "2026-11-21",
    localTime: null, serviceTimeZone: "America/New_York", dueAt: "2026-11-22T05:00:00.000Z",
    state: "planned", enabled: false, relatedFormId: null, relatedScheduleId: null,
    configurationRevision: "church:1", idempotencyKey: "action-deadline", cancelReason: null,
    supersededByActionId: null, attemptCount: 0, claimedAt: null, claimExpiresAt: null,
    lastAttemptAt: null, completedAt: null, lastError: null, result: null, schemaVersion: 1,
    createdAt: cycle.createdAt, updatedAt: cycle.updatedAt,
  },
  {
    actionId: "action-manual", id: "manual_review_and_publish", cycleId: "cycle-1", churchId: "church-1",
    teamId: "team-1", periodId: "2026-12", actionType: "manual_review_and_publish", localDate: null,
    localTime: null, serviceTimeZone: "America/New_York", dueAt: null, state: "manual", enabled: false,
    relatedFormId: null, relatedScheduleId: null, configurationRevision: "church:1",
    idempotencyKey: "action-manual", cancelReason: null, supersededByActionId: null,
    attemptCount: 0, claimedAt: null, claimExpiresAt: null, lastAttemptAt: null, completedAt: null,
    lastError: null, result: null, schemaVersion: 1, createdAt: cycle.createdAt, updatedAt: cycle.updatedAt,
  },
];

const response = (savedCycle: SchedulingCycleRecord | null = null): SchedulingAutomationResponse => ({
  success: true,
  churchId: "church-1",
  team: { teamId: "team-1", name: "Music" },
  serviceTimeZone: "America/New_York",
  defaults: {
    settingsId: "defaults-1", churchId: "church-1", teamId: null,
    scopeType: "church_defaults", settings, revision: 1,
  },
  override: {
    settingsId: "override-1", churchId: "church-1", teamId: "team-1",
    scopeType: "team_override", mode: "inherit", settings: null, revision: 0,
  },
  effective: {
    mode: "inherit", enabled: true, settings, configurationRevision: "church:1", source: "church",
  },
  savedCycle,
  savedActions: savedCycle ? actions : [],
});

const renderPanel = () => {
  jest.mocked(getSchedulingAutomation).mockResolvedValue(response());
  jest.mocked(getSchedulingCycle).mockResolvedValue({ success: true, savedCycle: null, savedActions: [] });
  jest.mocked(previewSchedulingCycle).mockResolvedValue({
    success: true,
    preview: { cycle, actions },
    savedCycle: null,
    isUnsavedPreview: true,
  });
  jest.mocked(saveChurchSchedulingDefaults).mockResolvedValue({ success: true, defaults: response().defaults });
  jest.mocked(setAvailabilityAutomation).mockResolvedValue({
    success: true,
    defaults: response().defaults,
    activationImpact: {
      churchWide: true, selectedTeamId: "team-1", selectedPeriodId: "2026-12",
      selectedPeriodStarted: false, upcomingActions: [], notificationDeliveryEnabled: false,
    },
  });
  return render(
    <SchedulingAutomationPanel
      churchId="church-1"
      teamId="team-1"
      teamName="Music"
      periodId="2026-12"
      existingScheduleStatus="No saved schedule for this period."
      serviceTimeZone="America/New_York"
      canManageTeam
      canManageDefaults
    />,
  );
};

beforeEach(() => jest.clearAllMocks());

it("previews unsaved church defaults without saving a cycle or triggering scheduling actions", async () => {
  const interaction = userEvent.setup();
  renderPanel();
  await screen.findByRole("button", { name: "Configure and preview" });
  await interaction.click(screen.getByRole("button", { name: "Configure and preview" }));
  const preparationDay = await screen.findByRole("spinbutton", { name: "Prepare the schedule by day" });
  await interaction.clear(preparationDay);
  await interaction.type(preparationDay, "20");
  const responseDeadline = await screen.findByRole("spinbutton", { name: "Availability response deadline lead days" });
  await interaction.clear(responseDeadline);
  await interaction.type(responseDeadline, "5");

  await waitFor(() => expect(previewSchedulingCycle).toHaveBeenLastCalledWith("church-1", expect.objectContaining({
    teamId: "team-1",
    periodId: "2026-12",
    draftDefaults: expect.objectContaining({ preparationDay: 20, availabilityResponseLeadDays: 5 }),
  })));
  const timeline = within(screen.getByRole("list", { name: "Scheduling timeline" }));
  expect(await timeline.findByText("Request availability")).toBeInTheDocument();
  expect(timeline.getAllByText("Upcoming")).toHaveLength(2);
  expect(timeline.getByText(/Manual.*review and publish/)).toBeInTheDocument();
  expect(screen.getByText(/Notification delivery is disabled/)).toBeInTheDocument();
  expect(timeline.getByText(/Respond through November 21, 2026/)).toBeInTheDocument();
  expect(saveChurchSchedulingDefaults).not.toHaveBeenCalled();
  expect(setAvailabilityAutomation).not.toHaveBeenCalled();
});

it("keeps a settings draft visible when the server rejects a stale save", async () => {
  const interaction = userEvent.setup();
  renderPanel();
  await interaction.click(await screen.findByRole("button", { name: "Configure and preview" }));
  const preparationDay = await screen.findByRole("spinbutton", { name: "Prepare the schedule by day" });
  await interaction.clear(preparationDay);
  await interaction.type(preparationDay, "20");
  jest.mocked(saveChurchSchedulingDefaults).mockRejectedValueOnce(new Error("Settings changed in another session."));
  await interaction.click(await screen.findByRole("button", { name: "Save church defaults" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Settings changed in another session.");
  expect(screen.getByRole("spinbutton", { name: "Prepare the schedule by day" })).toHaveValue(20);
  expect(setAvailabilityAutomation).not.toHaveBeenCalled();
});

it("does not load settings or previews until configuration opens and removes manual snapshot creation", async () => {
  const interaction = userEvent.setup();
  renderPanel();
  await screen.findByRole("button", { name: "Configure and preview" });
  expect(getSchedulingAutomation).not.toHaveBeenCalled();
  expect(previewSchedulingCycle).not.toHaveBeenCalled();
  await interaction.click(await screen.findByRole("button", { name: "Configure and preview" }));
  await screen.findByRole("spinbutton", { name: "Prepare the schedule by day" });
  expect(getSchedulingAutomation).toHaveBeenCalledWith("church-1", { teamId: "team-1" });
  expect(getSchedulingCycle).toHaveBeenCalledWith("church-1", "team-1", "2026-12");
  expect(screen.queryByRole("button", { name: "Save cycle snapshot" })).not.toBeInTheDocument();
});

it("uses church defaults immediately when a customized team returns to inheritance", async () => {
  const interaction = userEvent.setup();
  renderPanel();
  jest.mocked(getSchedulingAutomation).mockResolvedValueOnce({
    ...response(),
    override: {
      settingsId: "override-1", churchId: "church-1", teamId: "team-1",
      scopeType: "team_override", mode: "customize", settings: { ...settings, preparationDay: 19 }, revision: 2,
    },
    effective: {
      mode: "customize", enabled: true, settings: { ...settings, preparationDay: 19 },
      configurationRevision: "church:1:team:2", source: "team",
    },
  });
  await interaction.click(await screen.findByRole("button", { name: "Configure and preview" }));
  const selectors = await screen.findAllByRole("combobox");
  await interaction.click(selectors[0]);
  await interaction.click(await screen.findByRole("option", { name: "This team" }));
  expect(await screen.findByRole("spinbutton", { name: "Prepare the schedule by day" })).toHaveValue(19);
  const updatedSelectors = await screen.findAllByRole("combobox");
  await interaction.click(updatedSelectors[1]);
  await interaction.click(await screen.findByRole("option", { name: "Inherit church defaults" }));
  expect(screen.getByRole("spinbutton", { name: "Prepare the schedule by day" })).toHaveValue(24);
  await waitFor(() => expect(previewSchedulingCycle).toHaveBeenLastCalledWith("church-1", expect.objectContaining({
    draftDefaults: settings,
    draftOverride: { mode: "inherit", settings: null },
  })));
});

it("shows a saved cycle separately from the future-settings preview", async () => {
  const interaction = userEvent.setup();
  renderPanel();
  jest.mocked(getSchedulingCycle).mockResolvedValueOnce({ success: true, savedCycle: cycle, savedActions: actions });
  await interaction.click(await screen.findByRole("button", { name: "Configure and preview" }));
  expect(await screen.findByText("Saved cycle timeline")).toBeInTheDocument();
  expect(await screen.findByText("Future settings preview")).toBeInTheDocument();
  expect(screen.getByText("This timeline is saved with its original settings. Changes apply to future cycles.")).toBeInTheDocument();
});
