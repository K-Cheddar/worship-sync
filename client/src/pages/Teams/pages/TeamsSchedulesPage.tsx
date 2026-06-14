import ScheduleTab from "../schedule/ScheduleTab";
import { useTeamsPage } from "../TeamsPageContext";

const TeamsSchedulesPage = () => {
  const {
    pageData,
    selectedScheduleId,
    scheduleDrafts,
    upsertData,
    removeData,
    refresh,
    updateSelectedScheduleId,
    updateScheduleDraft,
    flushScheduleDraft,
    canEditTeams,
    canEditAnyTeam,
    canEditTeam,
  } = useTeamsPage();
  const selectedSchedule = pageData.schedules.find(
    (schedule) => schedule.scheduleId === selectedScheduleId,
  );
  const canEditSelectedSchedule = selectedSchedule
    ? canEditTeam(selectedSchedule.teamId)
    : canEditAnyTeam;

  return (
    <ScheduleTab
      data={pageData}
      canEdit={canEditTeams || canEditSelectedSchedule}
      selectedScheduleId={selectedScheduleId}
      setSelectedScheduleId={updateSelectedScheduleId}
      scheduleDrafts={scheduleDrafts}
      onScheduleSaved={(schedule, replaceId) =>
        upsertData("schedules", "scheduleId", schedule, replaceId)
      }
      onScheduleRemoved={(scheduleId) =>
        removeData("schedules", "scheduleId", scheduleId)
      }
      onMemberSaved={(member, replaceId) =>
        upsertData("members", "memberId", member, replaceId)
      }
      onTeamSaved={(team, replaceId) =>
        upsertData("teams", "teamId", team, replaceId)
      }
      onScheduleDraftChanged={updateScheduleDraft}
      onScheduleDraftFlush={flushScheduleDraft}
      onRefresh={() => void refresh()}
    />
  );
};

export default TeamsSchedulesPage;
