import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Button from "../../../components/Button/Button";
import Modal from "../../../components/Modal/Modal";
import Select from "../../../components/Select/Select";
import {
  getSchedulingCycle,
  getSchedulingAutomation,
  previewSchedulingCycle,
  saveChurchSchedulingDefaults,
  saveTeamSchedulingOverride,
  setAvailabilityAutomation,
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
              {action.actionType === "availability_response_deadline"
                ? `Respond through ${formatPlainDate(action.localDate, true)} (${serviceTimeZone || "church time"})`
                : `${formatPlainDate(action.localDate, true)} at ${action.localTime || "09:00"} ${serviceTimeZone || "church time"}`}
            </p>
          ) : (
            <p className="text-sm text-gray-300">Leader decision; publication is never automatic.</p>
          )}
        </div>
        <span className="shrink-0 rounded-full bg-gray-800 px-2 py-1 text-xs text-gray-300">
          {action.state === "manual" ? "Manual" : action.state === "completed" ? "Completed" : action.state === "skipped" ? "Skipped" : action.state === "review_required" ? "Needs attention" : action.state === "retryable_failure" ? "Retry pending" : "Upcoming"}
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
  const [dataOwnerKey, setDataOwnerKey] = useState("");
  const [defaultsDraft, setDefaultsDraft] = useState<SchedulingAutomationSettings | null>(null);
  const [overrideMode, setOverrideMode] = useState<OverrideMode>("inherit");
  const [overrideDraft, setOverrideDraft] = useState<SchedulingAutomationSettings | null>(null);
  const [preview, setPreview] = useState<PlannedCycle | null>(null);
  const [loading, setLoading] = useState(false);
  const [cycleLoading, setCycleLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activationSaving, setActivationSaving] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [scope, setScope] = useState<SettingsScope>(canManageDefaults ? "church" : "team");
  const [snapshot, setSnapshot] = useState<SchedulingCycleRecord | null>(null);
  const [savedActions, setSavedActions] = useState<SchedulingCycleAction[]>([]);
  const ownerKey = JSON.stringify([churchId, teamId]);
  const ownerKeyRef = useRef(ownerKey);
  ownerKeyRef.current = ownerKey;
  const settingsRequestRef = useRef(0);
  const cycleRequestRef = useRef(0);
  const previewRequestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++settingsRequestRef.current;
    const requestedOwner = JSON.stringify([churchId, teamId]);
    setLoading(true);
    setSaveError("");
    try {
      const result = await getSchedulingAutomation(churchId, { teamId });
      if (requestId !== settingsRequestRef.current || ownerKeyRef.current !== requestedOwner) return;
      setData(result);
      setDataOwnerKey(requestedOwner);
      if (result.defaults.settings) setDefaultsDraft(cloneSettings(result.defaults.settings));
      const mode = result.override?.mode || "inherit";
      setOverrideMode(mode);
      setOverrideDraft(cloneSettings(result.override?.settings || result.defaults.settings!));
    } catch (error) {
      if (requestId === settingsRequestRef.current && ownerKeyRef.current === requestedOwner) {
        setSaveError(error instanceof Error ? error.message : "Could not load scheduling settings.");
      }
    } finally {
      if (requestId === settingsRequestRef.current && ownerKeyRef.current === requestedOwner) setLoading(false);
    }
  }, [churchId, teamId]);

  useEffect(() => {
    setData(null);
    setDataOwnerKey("");
    setDefaultsDraft(null);
    setOverrideDraft(null);
    setOverrideMode("inherit");
    setSnapshot(null);
    setSavedActions([]);
    setPreview(null);
    setSaveError("");
    setPreviewError("");
    settingsRequestRef.current += 1;
    cycleRequestRef.current += 1;
    previewRequestRef.current += 1;
    setLoading(false);
  }, [ownerKey]);

  useEffect(() => {
    if (!isOpen || !teamId || dataOwnerKey === ownerKey) return undefined;
    void load();
    return () => { settingsRequestRef.current += 1; };
  }, [dataOwnerKey, isOpen, load, ownerKey, teamId]);

  useEffect(() => {
    if (!isOpen || !teamId) return undefined;
    const requestId = ++cycleRequestRef.current;
    const requestedOwner = ownerKey;
    setCycleLoading(true);
    setSnapshot(null);
    setSavedActions([]);
    void getSchedulingCycle(churchId, teamId, periodId).then((result) => {
      if (requestId !== cycleRequestRef.current || ownerKeyRef.current !== requestedOwner) return;
      setSnapshot(result.savedCycle || null);
      setSavedActions(result.savedActions || []);
    }).catch((error: unknown) => {
      if (requestId === cycleRequestRef.current && ownerKeyRef.current === requestedOwner) {
        setSaveError(error instanceof Error ? error.message : "Could not load this scheduling cycle.");
      }
    }).finally(() => {
      if (requestId === cycleRequestRef.current && ownerKeyRef.current === requestedOwner) setCycleLoading(false);
    });
    return () => { cycleRequestRef.current += 1; };
  }, [churchId, isOpen, ownerKey, periodId, teamId]);

  const currentData = dataOwnerKey === ownerKey ? data : null;

  const effectiveForDraft = useMemo(() => {
    if (scope === "church" && defaultsDraft) return defaultsDraft;
    if (overrideMode === "customize" && overrideDraft) return overrideDraft;
    return defaultsDraft || currentData?.effective.settings || null;
  }, [currentData?.effective.settings, defaultsDraft, overrideDraft, overrideMode, scope]);

  const isDirty = useMemo(() => {
    if (!currentData) return false;
    const defaultsDirty = canManageDefaults && defaultsDraft &&
      JSON.stringify(defaultsDraft) !== JSON.stringify(currentData.defaults.settings);
    const originalMode = currentData.override?.mode || "inherit";
    const overrideDirty = overrideMode !== originalMode || (overrideMode === "customize" &&
      JSON.stringify(overrideDraft) !== JSON.stringify(currentData.override?.settings));
    return Boolean((scope === "church" && defaultsDirty) || (scope === "team" && overrideDirty));
  }, [canManageDefaults, currentData, defaultsDraft, overrideDraft, overrideMode, scope]);

  useEffect(() => {
    if (!isOpen || !currentData || !effectiveForDraft) return undefined;
    const requestId = ++previewRequestRef.current;
    setPreview(null);
    let active = true;
    const timeout = window.setTimeout(() => {
      setPreviewError("");
      const body = {
        teamId,
        periodId,
        ...(canManageDefaults && defaultsDraft
          ? { draftDefaults: defaultsDraft }
          : {}),
        ...(scope === "team" ? { draftOverride: {
          mode: overrideMode,
          settings: overrideMode === "customize" ? overrideDraft : null,
        } } : {}),
      };
      void previewSchedulingCycle(churchId, body).then((result) => {
        if (active && requestId === previewRequestRef.current) setPreview({ cycle: result.preview.cycle, actions: result.preview.actions });
      }).catch((error: unknown) => {
        if (active && requestId === previewRequestRef.current) setPreviewError(error instanceof Error ? error.message : "Could not calculate this timeline.");
      });
    }, 200);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [canManageDefaults, churchId, currentData, defaultsDraft, effectiveForDraft, isOpen, overrideDraft, overrideMode, periodId, scope, teamId]);

  const savedView = useMemo(() => snapshot
    ? cycleFromSaved(snapshot, savedActions)
    : null, [savedActions, snapshot]);

  const save = async () => {
    if (!currentData) return;
    const requestedOwner = ownerKey;
    setSaving(true);
    setSaveError("");
    try {
      if (scope === "church") {
        if (!canManageDefaults || !defaultsDraft) return;
        await saveChurchSchedulingDefaults(churchId, {
          settings: defaultsDraft,
          revision: currentData.defaults.revision,
        });
      } else {
        await saveTeamSchedulingOverride(churchId, teamId, {
          mode: overrideMode,
          settings: overrideMode === "customize" ? overrideDraft : null,
          revision: currentData.override?.revision || 0,
        });
      }
      if (ownerKeyRef.current === requestedOwner) await load();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save scheduling settings. Your changes are still here.");
    } finally {
      setSaving(false);
    }
  };

  const changeAutomationActivation = async () => {
    if (!currentData || !canManageDefaults) return;
    const enabled = currentData.defaults.availabilityAutomationEnabled !== true;
    if (enabled) {
      const confirmed = window.confirm(
        `Enable church-wide automatic availability forms? The selected cycle timeline above shows the ${teamName || "team"} actions for ${periodName(periodId)}. This activates future eligible cycles across the church. Forms and personalized recipients may be created. Email and SMS delivery remain disabled. Continue?`,
      );
      if (!confirmed) return;
    }
    const requestedOwner = ownerKey;
    setActivationSaving(true);
    setSaveError("");
    try {
      const result = await setAvailabilityAutomation(churchId, {
        enabled,
        formCreationEnabled: enabled,
        revision: currentData.defaults.revision,
        teamId,
        periodId,
        confirmAlreadyStarted: enabled,
      });
      if (ownerKeyRef.current === requestedOwner) {
        setData((previous) => previous && dataOwnerKey === requestedOwner
          ? { ...previous, defaults: result.defaults }
          : previous);
      }
    } catch (error) {
      if (ownerKeyRef.current === requestedOwner) {
        setSaveError(error instanceof Error ? error.message : "Could not update availability automation.");
      }
    } finally {
      setActivationSaving(false);
    }
  };

  const isInherit = overrideMode === "inherit";
  const isTeamSettingsEditable = scope === "team" && overrideMode === "customize" && canManageTeam;
  const canEditCurrentSettings = scope === "church" ? canManageDefaults : isTeamSettingsEditable;
  const canSaveCurrentSettings = scope === "church" ? canManageDefaults : canManageTeam;
  const selectedTeamOverride = currentData?.override;
  const selectionValue = scope;
  if (!teamId) return null;

  return (
    <section aria-labelledby="scheduling-automation-title" className="mt-3 rounded-xl border border-gray-700 bg-gray-900/60 p-3 sm:p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 id="scheduling-automation-title" className="text-sm font-semibold text-gray-100">Scheduling timeline</h2>
          <p className="mt-1 text-sm text-gray-300">{periodName(periodId)} schedule for {teamName || "this team"}</p>
          <p className="mt-1 text-xs text-gray-400">{existingScheduleStatus}</p>
        </div>
        <Button variant="secondary" onClick={() => setIsOpen(true)}>
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
        description={`Review schedule preparation and availability collection for ${teamName || "this team"}.`}
        size="lg"
        busy={saving}
      >
        {loading || !currentData ? <div>
          {loading ? <p role="status" className="text-sm text-gray-300">Loading scheduling settings…</p> : null}
          {saveError ? <p role="alert" className="mt-2 text-sm text-red-300">{saveError}</p> : null}
          {!loading && saveError ? <Button variant="tertiary" className="mt-2" onClick={() => void load()}>Retry settings</Button> : null}
        </div> : (
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

            {scope === "church" && canManageDefaults ? (
              <div className="rounded-lg border border-gray-700 bg-gray-950/30 px-3 py-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="font-semibold text-gray-100">Automatic availability forms</h3>
                    <p className="mt-1 text-sm text-gray-300">
                      {currentData.defaults.availabilityAutomationEnabled
                        ? "Enabled church-wide. Upcoming eligible cycles can create forms and personalized recipients."
                        : "Disabled church-wide. Timing settings and previews do not activate processing."}
                    </p>
                    <p className="mt-1 text-xs text-gray-400">Notification delivery is disabled. Existing SMS registration and provider readiness must be reviewed separately.</p>
                  </div>
                  <Button
                    variant={currentData.defaults.availabilityAutomationEnabled ? "tertiary" : "primary"}
                    onClick={() => void changeAutomationActivation()}
                    isLoading={activationSaving}
                    disabled={saving || activationSaving}
                  >
                    {currentData.defaults.availabilityAutomationEnabled ? "Disable automation" : "Enable automation"}
                  </Button>
                </div>
              </div>
            ) : null}

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
                  : defaultsDraft || effectiveForDraft}
                disabled={!canEditCurrentSettings}
                onChange={(settings) => scope === "church"
                  ? setDefaultsDraft(settings)
                  : setOverrideDraft(settings)}
              />
            ) : null}

            <div className="rounded-lg border border-amber-700/60 bg-amber-950/20 px-3 py-2 text-sm text-amber-100">
              Volunteer responses remain open through the response-deadline date in the church timezone. Review and publication remain manual.
            </div>

            {previewError ? <p role="alert" className="text-sm text-red-300">{previewError}</p> : null}
            {saveError ? <p role="alert" className="text-sm text-red-300">{saveError}</p> : null}
            {saveError && !data ? <Button variant="tertiary" onClick={() => void load()}>Retry settings</Button> : null}

            <div className="space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-semibold text-gray-100">{savedView ? "Saved cycle timeline" : "Future settings preview"}</h3>
                <p className="text-xs text-gray-400">{serviceTimeZone || "Church timezone unavailable"} · {effectiveForDraft?.localExecutionTime || "09:00"}</p>
              </div>
              {savedView ? <Timeline plan={savedView} serviceTimeZone={serviceTimeZone} /> : preview ? <Timeline plan={preview} serviceTimeZone={serviceTimeZone} /> : (
                <p role="status" className="text-sm text-gray-400">{cycleLoading ? "Loading saved cycle…" : "Calculating timeline…"}</p>
              )}
              {savedView ? (
                <p className="text-xs text-gray-400">This timeline is saved with its original settings. Changes apply to future cycles.</p>
              ) : null}
              {savedView ? <div className="mt-4 space-y-2 border-t border-gray-700 pt-3">
                <h4 className="font-semibold text-gray-100">Future settings preview</h4>
                {preview ? <Timeline plan={preview} serviceTimeZone={serviceTimeZone} /> : (
                  <p role="status" className="text-sm text-gray-400">Calculating preview with current settings…</p>
                )}
              </div> : null}
            </div>

            <div className="flex flex-wrap justify-end gap-2 border-t border-gray-700 pt-3">
              <Button variant="tertiary" onClick={() => setIsOpen(false)} disabled={saving}>Close</Button>
              {canSaveCurrentSettings && isDirty ? (
                <Button variant="primary" onClick={() => void save()} isLoading={saving}>
                  Save {scope === "church" ? "church defaults" : "team settings"}
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
};

export default SchedulingAutomationPanel;
