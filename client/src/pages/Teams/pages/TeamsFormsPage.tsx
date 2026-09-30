import { useMemo, useState } from "react";
import PeriodRangeFilter from "../schedule/PeriodRangeFilter";
import { rangeFromPreset, type SchedulePeriodPreset } from "../schedule/schedulePeriodUtils";
import { filterFormsByDateRange } from "../formsPeriodFilters";
import IntakeManager from "../managers/IntakeManager";
import { useTeamsPage } from "../TeamsPageContext";

const TeamsFormsPage = () => {
  const { pageData, upsertData, canEditTeams } = useTeamsPage();
  const [periodPreset, setPeriodPreset] = useState<SchedulePeriodPreset>("upcoming");
  const [periodRange, setPeriodRange] = useState(() => rangeFromPreset("upcoming"));
  const visibleForms = useMemo(
    () => filterFormsByDateRange(pageData.intakeForms, {
      startDate: periodRange.start,
      endDate: periodRange.end,
    }),
    [pageData.intakeForms, periodRange.end, periodRange.start],
  );

  const selectPeriodPreset = (preset: SchedulePeriodPreset) => {
    setPeriodPreset(preset);
    if (preset !== "custom") setPeriodRange(rangeFromPreset(preset));
  };

  return (
    <IntakeManager
      forms={pageData.intakeForms}
      displayForms={visibleForms}
      listHeader={(
        <div className="mb-3 rounded-md border border-gray-700/80 bg-gray-900/70 px-2.5 py-2">
          <PeriodRangeFilter
            preset={periodPreset}
            range={periodRange}
            onPresetChange={selectPeriodPreset}
            onCustomRangeChange={({ startDate, endDate }) => {
              if (startDate && endDate) {
                setPeriodRange({ start: startDate, end: endDate });
              }
            }}
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
