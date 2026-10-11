import { useCallback, useEffect, useMemo, useState } from "react";
import RangeSelector from "../components/RangeSelector";
import { resolveRangePreset, useRangeSelection } from "../rangeSelection";
import { filterFormsByDateRange } from "../formsPeriodFilters";
import IntakeManager from "../managers/IntakeManager";
import { useTeamsPage } from "../TeamsPageContext";
import { isActive } from "../teamsUtils";
import { getUpcomingServiceRange } from "../servicePeriodRange";
import { serverDate } from "../../../utils/serverTime";
import { getTeamAvailabilityManagementData } from "../../../api/auth";
import Button from "../../../components/Button/Button";
import type {
  TeamAvailabilityManagementData,
  TeamAvailabilityResponse,
  TeamIntakeForm,
  TeamIntakeRecipient,
} from "../../../api/authTypes";

const upsertById = <T, K extends keyof T>(
  values: T[],
  key: K,
  value: T,
) => {
  const id = value[key];
  const existingIndex = values.findIndex((entry) => entry[key] === id);
  if (existingIndex < 0) return [...values, value];
  return values.map((entry, index) => index === existingIndex ? value : entry);
};

const TeamsFormsPage = () => {
  const {
    churchId,
    pageData,
    upsertData,
    canEditTeams,
    canEditTeam,
    canManageTeamAvailability,
    serviceTimeZone,
  } = useTeamsPage();
  const scopedAvailabilityOnly = !canEditTeams && canManageTeamAvailability;
  const managedTeamIds = useMemo(
    () => pageData.teams
      .filter((team) => !team.archivedAt && canEditTeam(team.teamId))
      .map((team) => team.teamId)
      .sort(),
    [canEditTeam, pageData.teams],
  );
  const availabilityScopeKey = `${churchId}:${managedTeamIds.join("|")}`;
  const [scopedDataState, setScopedDataState] = useState<{
    scopeKey: string;
    data: TeamAvailabilityManagementData;
  } | null>(null);
  const scopedData = scopedDataState?.scopeKey === availabilityScopeKey
    ? scopedDataState.data
    : null;
  const [scopedLoading, setScopedLoading] = useState(false);
  const [scopedError, setScopedError] = useState("");
  const [scopedRefreshVersion, setScopedRefreshVersion] = useState(0);
  useEffect(() => {
    if (!scopedAvailabilityOnly || !churchId) return undefined;
    let active = true;
    setScopedLoading(true);
    setScopedError("");
    const requestedScopeKey = availabilityScopeKey;
    getTeamAvailabilityManagementData(churchId)
      .then((response) => {
        if (active) setScopedDataState({ scopeKey: requestedScopeKey, data: response });
      })
      .catch((error: unknown) => {
        if (active) setScopedError(error instanceof Error ? error.message : "Could not load Team availability.");
      })
      .finally(() => {
        if (active) setScopedLoading(false);
      });
    return () => { active = false; };
  }, [availabilityScopeKey, churchId, scopedAvailabilityOnly, scopedRefreshVersion]);
  const now = serverDate();
  const resolveUpcomingRange = useCallback((referenceTime: Date) => {
    return getUpcomingServiceRange(pageData.services.filter(isActive), referenceTime, serviceTimeZone);
  }, [pageData.services, serviceTimeZone]);
  const {
    preset: periodPreset,
    range: periodRange,
    selectPreset: selectPeriodPreset,
    selectCustomRange,
  } = useRangeSelection({
    now,
    resolveUpcomingRange,
    resolvePresetRange: (preset, referenceTime) => resolveRangePreset(preset, referenceTime),
  });
  const visibleForms = useMemo(
    () => filterFormsByDateRange(pageData.intakeForms, {
      startDate: periodRange.start,
      endDate: periodRange.end,
    }),
    [pageData.intakeForms, periodRange.end, periodRange.start],
  );

  const refreshScopedData = useCallback(() => {
    setScopedRefreshVersion((current) => current + 1);
  }, []);

  if (scopedAvailabilityOnly && scopedLoading && !scopedData) {
    return <main className="p-6 text-sm text-gray-300" role="status">Loading Team availability…</main>;
  }
  if (scopedAvailabilityOnly && scopedError && !scopedData) {
    return (
      <main className="space-y-3 p-6" role="alert">
        <p className="text-sm text-red-200">{scopedError}</p>
        <Button variant="secondary" onClick={refreshScopedData}>Try again</Button>
      </main>
    );
  }
  if (scopedAvailabilityOnly && scopedData) {
    const availabilityForms = scopedData.forms.filter((form) => form.purpose === "team_availability");
    const availabilityResponses: TeamAvailabilityResponse[] = scopedData.availabilityResponses;
    return (
      <IntakeManager
        availabilityOnly
        managedTeamIds={managedTeamIds}
        availabilityResponses={availabilityResponses}
        onAvailabilityRefresh={refreshScopedData}
        forms={availabilityForms}
        displayForms={filterFormsByDateRange(availabilityForms, {
          startDate: periodRange.start,
          endDate: periodRange.end,
        })}
        listHeader={(
          <div className="mb-3 rounded-md border border-gray-700/80 bg-gray-900/70 px-2.5 py-2">
            <RangeSelector
              preset={periodPreset}
              range={periodRange}
              onPresetChange={selectPeriodPreset}
              onCustomRangeChange={selectCustomRange}
            />
          </div>
        )}
        submissions={[]}
        intakeRecipients={scopedData.intakeRecipients}
        smsEligibilityByMemberId={scopedData.smsEligibilityByMemberId}
        services={pageData.services}
        members={scopedData.members}
        positions={pageData.positions.filter((position) => managedTeamIds.includes(position.teamId))}
        schedules={pageData.schedules.filter((schedule) => managedTeamIds.includes(schedule.teamId))}
        teams={scopedData.teams.filter((team) => canEditTeam(team.teamId))}
        canEdit
        onFormSaved={(form: TeamIntakeForm) => setScopedDataState((current) => current?.scopeKey === availabilityScopeKey ? {
          ...current,
          data: {
            ...current.data,
            forms: upsertById(current.data.forms, "formId", form),
          },
        } : current)}
        onSubmissionSaved={() => undefined}
        onMemberSaved={() => undefined}
        onTeamSaved={() => undefined}
        onRecipientSaved={(recipient: TeamIntakeRecipient) => setScopedDataState((current) => current?.scopeKey === availabilityScopeKey ? {
          ...current,
          data: {
            ...current.data,
            intakeRecipients: upsertById(current.data.intakeRecipients, "recipientId", recipient),
          },
        } : current)}
      />
    );
  }

  return (
    <IntakeManager
      forms={pageData.intakeForms}
      displayForms={visibleForms}
      listHeader={(
        <div className="mb-3 rounded-md border border-gray-700/80 bg-gray-900/70 px-2.5 py-2">
          <RangeSelector
            preset={periodPreset}
            range={periodRange}
            onPresetChange={selectPeriodPreset}
            onCustomRangeChange={selectCustomRange}
          />
        </div>
      )}
      submissions={pageData.intakeSubmissions}
      intakeRecipients={pageData.intakeRecipients}
      smsEligibilityByMemberId={pageData.smsEligibilityByMemberId}
      smsDeliveryAttempts={pageData.smsDeliveryAttempts}
      services={pageData.services}
      schedules={pageData.schedules}
      members={pageData.members}
      positions={pageData.positions}
      teams={pageData.teams}
      canEdit={canEditTeams}
      onFormSaved={(form) => upsertData("intakeForms", "formId", form)}
      onSubmissionSaved={(submission) =>
        upsertData("intakeSubmissions", "submissionId", submission)
      }
      onMemberSaved={(member) => upsertData("members", "memberId", member)}
      onTeamSaved={(team) => upsertData("teams", "teamId", team)}
      onRecipientSaved={(recipient) =>
        upsertData("intakeRecipients", "recipientId", recipient)
      }
      onSmsDeliveryAttemptSaved={(attempt) =>
        upsertData("smsDeliveryAttempts", "attemptId", attempt)
      }
    />
  );
};

export default TeamsFormsPage;
