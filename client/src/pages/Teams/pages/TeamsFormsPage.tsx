import { useCallback, useMemo } from "react";
import RangeSelector from "../components/RangeSelector";
import { resolveRangePreset, useRangeSelection } from "../rangeSelection";
import { filterFormsByDateRange } from "../formsPeriodFilters";
import IntakeManager from "../managers/IntakeManager";
import { useTeamsPage } from "../TeamsPageContext";
import { isActive } from "../teamsUtils";
import { getUpcomingServiceRange } from "../servicePeriodRange";
import { serverDate } from "../../../utils/serverTime";

const TeamsFormsPage = () => {
  const { pageData, upsertData, canEditTeams, serviceTimeZone } = useTeamsPage();
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
