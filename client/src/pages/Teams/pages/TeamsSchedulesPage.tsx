import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { TeamRosterMember } from "../../../api/authTypes";
import ScheduleTab from "../schedule/ScheduleTab";
import { useTeamsPage } from "../TeamsPageContext";
import { buildTeamsMemberEditPath } from "../teamsUtils";
import {
  buildTeamsReturnNavigationState,
  persistTeamsReturnTo,
  TEAMS_SECTION_PATHS,
  type TeamsReturnTo,
} from "../teamsReturnNavigation";
import { getTeamAvailabilityManagementData } from "../../../api/auth";

const TeamsSchedulesPage = () => {
  const navigate = useNavigate();
  const {
    pageData,
    churchId,
    selectedScheduleId,
    scheduleDrafts,
    upsertData,
    removeData,
    trackTeamsSave,
    updateSelectedScheduleId,
    updateScheduleDraft,
    flushScheduleDraft,
    clearScheduleDraft,
    canEditTeams,
    canEditAnyTeam,
    canEditTeam,
    editableMemberIds,
    refresh,
    serviceTimeZone,
  } = useTeamsPage();
  const selectedSchedule = pageData.schedules.find(
    (schedule) => schedule.scheduleId === selectedScheduleId,
  );
  const canEditSelectedSchedule = selectedSchedule
    ? canEditTeam(selectedSchedule.teamId)
    : canEditAnyTeam;
  const editableTeamIds = useMemo(
    () =>
      new Set(
        pageData.teams
          .filter((team) => canEditTeam(team.teamId))
          .map((team) => team.teamId),
      ),
    [pageData.teams, canEditTeam],
  );
  const scopedScheduleAvailability = !canEditTeams && editableTeamIds.size > 0;
  const availabilityScopeKey = `${churchId}:${[...editableTeamIds].sort().join("|")}`;
  const [availabilitySnapshot, setAvailabilitySnapshot] = useState<{
    scopeKey: string;
    byMemberId: Record<string, TeamRosterMember["serviceAvailability"]>;
  } | null>(null);
  const availabilityByMemberId = availabilitySnapshot?.scopeKey === availabilityScopeKey
    ? availabilitySnapshot.byMemberId
    : null;
  const [availabilityError, setAvailabilityError] = useState("");
  const [availabilityRefreshVersion, setAvailabilityRefreshVersion] = useState(0);
  useEffect(() => {
    if (!scopedScheduleAvailability || !churchId) {
      setAvailabilitySnapshot(null);
      setAvailabilityError("");
      return undefined;
    }
    let active = true;
    setAvailabilityError("");
    getTeamAvailabilityManagementData(churchId)
      .then((response) => {
        if (!active) return;
        setAvailabilitySnapshot({
          scopeKey: availabilityScopeKey,
          byMemberId: Object.fromEntries(
            response.members.map((member) => [member.memberId, member.serviceAvailability || {}]),
          ),
        });
      })
      .catch((error: unknown) => {
        if (active) setAvailabilityError(error instanceof Error ? error.message : "Could not load Team availability.");
      });
    return () => { active = false; };
  }, [availabilityScopeKey, churchId, scopedScheduleAvailability, availabilityRefreshVersion]);
  useEffect(() => {
    if (!scopedScheduleAvailability) return undefined;
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        setAvailabilityRefreshVersion((current) => current + 1);
      }
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => document.removeEventListener("visibilitychange", refreshWhenVisible);
  }, [scopedScheduleAvailability]);
  const scheduleData = useMemo(() => {
    if (!scopedScheduleAvailability || !availabilityByMemberId) return pageData;
    return {
      ...pageData,
      members: pageData.members.map((member) => ({
        ...member,
        serviceAvailability: availabilityByMemberId[member.memberId] || {},
      })),
    };
  }, [availabilityByMemberId, pageData, scopedScheduleAvailability]);
  const canEditMember = useCallback(
    (member: TeamRosterMember) =>
      canEditTeams || editableMemberIds.has(member.memberId),
    [canEditTeams, editableMemberIds],
  );
  const handleEditMember = useCallback(
    (memberId: string, returnTo: TeamsReturnTo) => {
      persistTeamsReturnTo(returnTo, TEAMS_SECTION_PATHS.members);
      navigate(buildTeamsMemberEditPath(memberId), {
        state: buildTeamsReturnNavigationState(returnTo),
      });
    },
    [navigate],
  );

  return (
    scopedScheduleAvailability && !availabilityByMemberId ? (
      <main className="space-y-3 p-6" role={availabilityError ? "alert" : "status"}>
        <p className={availabilityError ? "text-sm text-red-200" : "text-sm text-gray-300"}>
          {availabilityError || "Loading availability for your Teams…"}
        </p>
        {availabilityError ? <button className="text-sm text-sky-200 underline" onClick={() => setAvailabilityRefreshVersion((current) => current + 1)}>Try again</button> : null}
      </main>
    ) :
    <ScheduleTab
      data={scheduleData}
      serviceTimeZone={serviceTimeZone}
      canEdit={canEditTeams || canEditSelectedSchedule}
      // Drives the default team filter: someone scoped to a single team gets
      // their schedules narrowed for them on first visit.
      editableTeamIds={editableTeamIds}
      canEditMember={canEditMember}
      onEditMember={handleEditMember}
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
      onScheduleDraftClear={clearScheduleDraft}
      trackTeamsSave={trackTeamsSave}
      onImported={() => void refresh()}
    />
  );
};

export default TeamsSchedulesPage;
