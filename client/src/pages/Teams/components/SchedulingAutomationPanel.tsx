import { useCallback, useEffect, useMemo, useState } from "react";
import Button from "../../../components/Button/Button";
import Modal from "../../../components/Modal/Modal";
import Select from "../../../components/Select/Select";
import {
  ensureSchedulingCycle,
  getSchedulingAutomation,
  previewSchedulingCycle,
  saveChurchSchedulingDefaults,
  saveTeamSchedulingOverride,
  type SchedulingAutomationResponse,
} from "../../../api/auth";
import type {
  SchedulingAutomationSettings,
  SchedulingCycleAction,
  SchedulingCycleRecord,
} from "../../../api/authTypes";

type OverrideMode = "inherit" | "customize" | "disabled";
type SettingsScope = "church" | "team";
type PlannedCycle = { cycle: SchedulingCycleRecord; actions: SchedulingCycleAction[] };

const actionTitles: Record<string, string> = {
  availability_request: "Request availability",
  availability_follow_up: "Remind nonresponders",
  leader_summary: "Send leaders a response summary",
  availability_response_deadline: "Availability response deadline",
  prepare_schedule_draft: "Prepare the schedule draft",
  manual_review_and_publish: "Review and publish",
};

const formatPlainDate = (date: string, includeYear = false) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  return new Intl.DateTimeFormat(undefined, {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    ...(includeYear ? { year: "numeric" as const } : {}),
  }).format(new Date(`${date}T12:00:00.000Z`));
};

const periodName = (periodId: string) => {
  const [year, month] = periodId.split("-").map(Number);
  if (!year || !month) return periodId;
  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, 1, 12)));
};

const cycleFromSaved = (cycle: SchedulingCycleRecord, actions: SchedulingCycleAction[]): PlannedCycle => ({
  cycle,
  actions: [...actions].sort((left, right) =>
    String(left.localDate || "9999-12-31").localeCompare(String(right.localDate || "9999-12-31"))),
});

const cloneSettings = (settings: SchedulingAutomationSettings): SchedulingAutomationSettings => ({ ...settings });

const SettingsFields = ({
  settings,
  disabled,
  onChange,
}: {
  settings: SchedulingAutomationSettings;
  disabled: boolean;
  onChange: (next: SchedulingAutomationSettings) => void;
}) => (
  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
    <label className="flex flex-col gap-1 text-sm text-gray-200">
      <span>Prepare the schedule by day</span>
      <input
        aria-label="Prepare the schedule by day"
        type="number"
        min={1}
        max={31}
        value={settings.preparationDay}
        disabled={disabled}
        onChange={(event) => onChange({ ...settings, preparationDay: Number(event.target.value) })}
        className="h-10 rounded-md border border-gray-600 bg-gray-900 px-3 text-gray-100 disabled:opacity-60"
      />
      <span className="text-xs text-gray-400">In the month before the schedule period. Short months use their last day.</span>
    </label>
    <label className="flex flex-col gap-1 text-sm text-gray-200">
      <span>Request availability</span>
      <span className="flex items-center gap-2">
        <input
          aria-label="Availability request lead days"
          type="number"
          min={1}
          max={60}
          value={settings.availabilityRequestLeadDays}
          disabled={disabled}
          onChange={(event) => onChange({ ...settings, availabilityRequestLeadDays: Number(event.target.value) })}
          className="h-10 w-24 rounded-md border border-gray-600 bg-gray-900 px-3 text-gray-100 disabled:opacity-60"
        />
        <span>days before preparation</span>
      </span>
      <span className="text-xs text-gray-400">Follow-up and leader summary are calculated from this date.</span>
    </label>
    <label className="flex flex-col gap-1 text-sm text-gray-200">
      <span>Follow-up nonresponders</span>
      <span className="flex items-center gap-2">
        <input
          aria-label="Follow-up days after request"
          type="number"
          min={1}
          max={14}
          value={settings.followUpAfterDays}
          disabled={disabled}
          onChange={(event) => onChange({ ...settings, followUpAfterDays: Number(event.target.value) })}
          className="h-10 w-24 rounded-md border border-gray-600 bg-gray-900 px-3 text-gray-100 disabled:opacity-60"
        />
        <span>days after request</span>
      </span>
    </label>
    <label className="flex flex-col gap-1 text-sm text-gray-200">
      <span>Send leader summary</span>
      <span className="flex items-center gap-2">
        <input
          aria-label="Leader summary days after follow-up"
          type="number"
          min={1}
          max={14}
          value={settings.leaderSummaryAfterDays}
          disabled={disabled}
          onChange={(event) => onChange({ ...settings, leaderSummaryAfterDays: Number(event.target.value) })}
          className="h-10 w-24 rounded-md border border-gray-600 bg-gray-900 px-3 text-gray-100 disabled:opacity-60"
        />
        <span>days after follow-up</span>
      </span>
    </label>
    <label className="flex flex-col gap-1 text-sm text-gray-200">
      <span>Volunteer response deadline</span>
      <span className="flex items-center gap-2">
        <input
          aria-label="Availability response deadline lead days"
          type="number"
          min={1}
          max={14}
          value={settings.availabilityResponseLeadDays}
          disabled={disabled}
          onChange={(event) => onChange({ ...settings, availabilityResponseLeadDays: Number(event.target.value) })}
          className="h-10 w-24 rounded-md border border-gray-600 bg-gray-900 px-3 text-gray-100 disabled:opacity-60"
        />
        <span>days before preparation</span>
      </span>
      <span className="text-xs text-gray-400">Default: 3 days. This leaves time for leaders to prepare.</span>
    </label>
    <label className="flex flex-col gap-1 text-sm text-gray-200 sm:col-span-2">
      <span>Local execution time</span>
      <input
        aria-label="Local execution time"
        type="time"
        value={settings.localExecutionTime}
        disabled={disabled}
        onChange={(event) => onChange({ ...settings, localExecutionTime: event.target.value })}
        className="h-10 w-36 rounded-md border border-gray-600 bg-gray-900 px-3 text-gray-100 disabled:opacity-60"
      />
      <span className="text-xs text-gray-400">Uses the church timezone. If that local time does not exist on a transition date, the preview asks you to choose another time.</span>
    </label>
  </div>
);

const Timeline = ({ plan, serviceTimeZone }: { plan: PlannedCycle; serviceTimeZone: string | null }) => (
  <ol aria-label="Scheduling timeline" className="space-y-2">
    {plan.actions.map((action) => (
      <li key={action.actionId} className="flex min-w-0 items-start justify-between gap-3 rounded-lg border border-gray-700/80 bg-gray-950/30 px-3 py-2">
        <div className="min-w-0">
          <p className="font-medium text-gray-100">{action.actionType === "manual_review_and_publish"
            ? "Manual — review and publish"
            : actionTitles[action.actionType] || action.actionType}</p>
          {action.localDate ? (
            <p className="text-sm text-gray-300">
              {formatPlainDate(action.localDate, true)} at {action.localTime || "09:00"} {serviceTimeZone || "church time"}
            </p>
          ) : (
            <p className="text-sm text-gray-300">Leader decision; publication is never automatic.</p>
          )}
        </div>
        <span className="shrink-0 rounded-full bg-gray-800 px-2 py-1 text-xs text-gray-300">
          {action.state === "manual" ? "Manual" : "Planned · not enabled"}
        </span>
      </li>
    ))}
  </ol>
);

export const SchedulingAutomationPanel = ({
  churchId,
  teamId,
  teamName,
  periodId,
  existingScheduleStatus,
  serviceTimeZone,
  canManageTeam,
  canManageDefaults,
}: {
  churchId: string;
  teamId: string;
  teamName: string;
  periodId: string;
  existingScheduleStatus: string;
  serviceTimeZone: string;
  canManageTeam: boolean;
  canManageDefaults: boolean;
}) => {
  const [data, setData] = useState<SchedulingAutomationResponse | null>(null);
  const [defaultsDraft, setDefaultsDraft] = useState<SchedulingAutomationSettings | null>(null);
  const [overrideMode, setOverrideMode] = useState<OverrideMode>("inherit");
  const [overrideDraft, setOverrideDraft] = useState<SchedulingAutomationSettings | null>(null);
  const [preview, setPreview] = useState<PlannedCycle | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [scope, setScope] = useState<SettingsScope>(canManageDefaults ? "church" : "team");
  const [snapshot, setSnapshot] = useState<SchedulingCycleRecord | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setSaveError("");
    setData(null);
    setPreview(null);
    try {
      const result = await getSchedulingAutomation(churchId, { teamId, periodId });
      setData(result);
      if (result.defaults.settings) setDefaultsDraft(cloneSettings(result.defaults.settings));
      const mode = result.override?.mode || "inherit";
      setOverrideMode(mode);
      setOverrideDraft(cloneSettings(result.override?.settings || result.defaults.settings!));
      setSnapshot(result.savedCycle);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not load scheduling settings.");
    } finally {
      setLoading(false);
    }
  }, [churchId, periodId, teamId]);

  useEffect(() => {
    void load();
  }, [load]);

  const effectiveForDraft = useMemo(() => {
    if (scope === "church" && canManageDefaults && defaultsDraft) return defaultsDraft;
    if (overrideMode === "customize" && overrideDraft) return overrideDraft;
    return data?.effective.settings || defaultsDraft;
  }, [canManageDefaults, data?.effective.settings, defaultsDraft, overrideDraft, overrideMode, scope]);

  const isDirty = useMemo(() => {
    if (!data) return false;
    const defaultsDirty = canManageDefaults && defaultsDraft &&
      JSON.stringify(defaultsDraft) !== JSON.stringify(data.defaults.settings);
    const originalMode = data.override?.mode || "inherit";
    const overrideDirty = overrideMode !== originalMode || (overrideMode === "customize" &&
      JSON.stringify(overrideDraft) !== JSON.stringify(data.override?.settings));
    return Boolean((scope === "church" && defaultsDirty) || (scope === "team" && overrideDirty));
  }, [canManageDefaults, data, defaultsDraft, overrideDraft, overrideMode, scope]);

  useEffect(() => {
    if (!data || !effectiveForDraft) return undefined;
    let active = true;
    const timeout = window.setTimeout(() => {
      setPreviewError("");
      const body = {
        teamId,
        periodId,
        ...(scope === "church" && canManageDefaults && defaultsDraft
          ? { draftDefaults: defaultsDraft }
          : {}),
        ...(scope === "team" ? { draftOverride: {
          mode: overrideMode,
          settings: overrideMode === "customize" ? overrideDraft : null,
        } } : {}),
      };
      void previewSchedulingCycle(churchId, body).then((result) => {
        if (active) setPreview({ cycle: result.preview.cycle, actions: result.preview.actions });
      }).catch((error: unknown) => {
        if (active) setPreviewError(error instanceof Error ? error.message : "Could not calculate this timeline.");
      });
    }, 200);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [canManageDefaults, churchId, data, defaultsDraft, effectiveForDraft, overrideDraft, overrideMode, periodId, scope, teamId]);

  const savedView = useMemo(() => snapshot && data?.savedActions
    ? cycleFromSaved(snapshot, data.savedActions)
    : null, [data?.savedActions, snapshot]);
  const visiblePlan = savedView && !isDirty ? savedView : preview;

  const save = async () => {
    if (!data) return;
    setSaving(true);
    setSaveError("");
    try {
      if (scope === "church") {
        if (!canManageDefaults || !defaultsDraft) return;
        await saveChurchSchedulingDefaults(churchId, {
          settings: defaultsDraft,
          revision: data.defaults.revision,
        });
      } else {
        await saveTeamSchedulingOverride(churchId, teamId, {
          mode: overrideMode,
          settings: overrideMode === "customize" ? overrideDraft : null,
          revision: data.override?.revision || 0,
        });
      }
      await load();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save scheduling settings. Your changes are still here.");
    } finally {
      setSaving(false);
    }
  };

  const createCycleSnapshot = async () => {
    setSaving(true);
    setSaveError("");
    try {
      const result = await ensureSchedulingCycle(churchId, teamId, periodId);
      setSnapshot(result.cycle);
      await load();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save this cycle snapshot.");
    } finally {
      setSaving(false);
    }
  };

  const isInherit = overrideMode === "inherit";
  const isTeamSettingsEditable = scope === "team" && overrideMode === "customize" && canManageTeam;
  const canEditCurrentSettings = scope === "church" ? canManageDefaults : isTeamSettingsEditable;
  const canSaveCurrentSettings = scope === "church" ? canManageDefaults : canManageTeam;
  const selectedTeamOverride = data?.override;
  const selectionValue = scope === "church" ? "church" : overrideMode;

  if (!teamId) return null;

  return (
    <section aria-labelledby="scheduling-automation-title" className="mt-3 rounded-xl border border-gray-700 bg-gray-900/60 p-3 sm:p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 id="scheduling-automation-title" className="text-sm font-semibold text-gray-100">Scheduling timeline</h2>
          <p className="mt-1 text-sm text-gray-300">
            {periodName(periodId)} schedule for {teamName || "this team"}
            {visiblePlan?.cycle.deadlines.preparation.localDate
              ? ` · prepare by ${formatPlainDate(visiblePlan.cycle.deadlines.preparation.localDate)}`
              : " · preparing timeline"}
          </p>
          <p className="mt-1 text-xs text-gray-400">{existingScheduleStatus}</p>
        </div>
        <Button variant="secondary" onClick={() => setIsOpen(true)} disabled={loading}>
          Configure and preview
        </Button>
      </div>
      {saveError && !isOpen ? <p role="alert" className="mt-2 text-sm text-red-300">{saveError}</p> : null}
      {saveError && !isOpen && !data ? (
        <Button variant="tertiary" className="mt-2" onClick={() => void load()}>Retry settings</Button>
      ) : null}

      <Modal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title={`Scheduling timeline · ${periodName(periodId)}`}
        description={`Monthly schedule for ${teamName || "this team"}. Preview is planning only.`}
        size="lg"
        busy={saving}
      >
        {loading ? <p role="status" className="text-sm text-gray-300">Loading scheduling settings…</p> : (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              {canManageDefaults ? (
                <div className="w-full sm:max-w-sm">
                  <Select
                    label="Settings"
                    value={selectionValue}
                    onChange={(value) => setScope(value === "church" ? "church" : "team")}
                    options={[
                      { label: "Church defaults", value: "church" },
                      { label: "This team", value: "team" },
                    ]}
                  />
                </div>
              ) : null}
              {scope === "team" && canManageTeam ? (
                <div className="w-full sm:max-w-sm">
                  <Select
                    label="Team scheduling settings"
                    value={overrideMode}
                    onChange={(value) => setOverrideMode(value as OverrideMode)}
                    options={[
                      { label: "Inherit church defaults", value: "inherit" },
                      { label: "Customize for this team", value: "customize" },
                      { label: "Disable cycle planning", value: "disabled" },
                    ]}
                  />
                </div>
              ) : null}
            </div>

            {scope === "church" && !canManageDefaults ? <p role="alert">Only a church administrator can change church defaults.</p> : null}
            {scope === "team" && isInherit ? (
              <p className="rounded-lg bg-gray-800/70 px-3 py-2 text-sm text-gray-300">This team inherits the church defaults.</p>
            ) : null}
            {scope === "team" && overrideMode === "disabled" ? (
              <p className="rounded-lg bg-gray-800/70 px-3 py-2 text-sm text-gray-300">Cycle planning is disabled for this team. Existing schedules remain available.</p>
            ) : null}
            {scope === "team" && overrideMode === "customize" && selectedTeamOverride?.settings === null ? (
              <p className="text-sm text-gray-300">Customize the schedule timing for {teamName}.</p>
            ) : null}

            {effectiveForDraft ? (
              <SettingsFields
                settings={scope === "church" ? defaultsDraft || effectiveForDraft : overrideMode === "customize"
                  ? overrideDraft || effectiveForDraft
                  : data?.effective.settings || effectiveForDraft}
                disabled={!canEditCurrentSettings}
                onChange={(settings) => scope === "church"
                  ? setDefaultsDraft(settings)
                  : setOverrideDraft(settings)}
              />
            ) : null}

            <div className="rounded-lg border border-amber-700/60 bg-amber-950/20 px-3 py-2 text-sm text-amber-100">
              Planning only. Actions are not enabled in this phase; no messages are sent and schedules are not changed. Volunteers’ response deadline is {effectiveForDraft?.availabilityResponseLeadDays ?? 3} calendar days before preparation. Review and publication remain manual.
            </div>

            {previewError ? <p role="alert" className="text-sm text-red-300">{previewError}</p> : null}
            {saveError ? <p role="alert" className="text-sm text-red-300">{saveError}</p> : null}
            {saveError && !data ? <Button variant="tertiary" onClick={() => void load()}>Retry settings</Button> : null}

            <div className="space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-semibold text-gray-100">Upcoming actions</h3>
                <p className="text-xs text-gray-400">{serviceTimeZone || "Church timezone unavailable"} · {effectiveForDraft?.localExecutionTime || "09:00"}</p>
              </div>
              {visiblePlan ? <Timeline plan={visiblePlan} serviceTimeZone={serviceTimeZone} /> : (
                <p role="status" className="text-sm text-gray-400">Calculating timeline…</p>
              )}
              {savedView && !isDirty ? (
                <p className="text-xs text-gray-400">This saved cycle keeps its original settings. Changes apply to future cycles.</p>
              ) : null}
            </div>

            <div className="flex flex-wrap justify-end gap-2 border-t border-gray-700 pt-3">
              <Button variant="tertiary" onClick={() => setIsOpen(false)} disabled={saving}>Close</Button>
              {canSaveCurrentSettings && isDirty ? (
                <Button variant="primary" onClick={() => void save()} isLoading={saving}>
                  Save {scope === "church" ? "church defaults" : "team settings"}
                </Button>
              ) : null}
              {!snapshot && !isDirty && overrideMode !== "disabled" ? (
                <Button variant="secondary" onClick={() => void createCycleSnapshot()} isLoading={saving}>
                  Save cycle snapshot
                </Button>
              ) : null}
              {snapshot ? <span className="self-center text-xs text-gray-400">Cycle snapshot saved</span> : null}
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
};

export default SchedulingAutomationPanel;
