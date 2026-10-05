const copyDefinedFields = (source, fields) => {
  const result = {};
  for (const field of fields) {
    if (Object.hasOwn(source, field)) result[field] = source[field];
  }
  return result;
};

const READ_ONLY_MEMBER_FIELDS = [
  "memberId",
  "churchId",
  "title",
  "firstName",
  "lastName",
  "profileImageUrl",
];
const MANAGER_MEMBER_FIELDS = [
  "email",
  "phoneNumber",
  "birthDate",
  "isMinor",
  "servingFrequency",
  "recurringAvailability",
  "blockoutDates",
  "notes",
  "profileImagePublicId",
];
const QUALIFICATION_FIELDS = [
  "qualificationId",
  "areaId",
  "levelId",
  "status",
  "completedAt",
  "expiresAt",
  "notes",
];

/**
 * Project the full church Teams bootstrap to data a resolved access object may
 * receive. access must come from resolveEffectiveTeamAccess, whose resolver
 * must receive the complete canonical active team set for this church.
 */
export const projectTeamsBootstrapForAccess = ({ data, access } = {}) => {
  if (access?.viewAll === true) return data;

  const source = data && typeof data === "object" ? data : {};
  const visibleTeamIds =
    access?.viewTeamIds instanceof Set ? access.viewTeamIds : new Set();
  const editableTeamIds =
    access?.editTeamIds instanceof Set ? access.editTeamIds : new Set();

  // Recheck active records so archived or malformed teams cannot be exposed
  // through stale scope IDs.
  const teams = (Array.isArray(source.teams) ? source.teams : []).filter(
    (team) =>
      team && !team.archivedAt && visibleTeamIds.has(team.teamId || team.id),
  );
  const projectedTeamIds = new Set(teams.map((team) => team.teamId || team.id));
  const positions = (
    Array.isArray(source.positions) ? source.positions : []
  ).filter((position) => position && projectedTeamIds.has(position.teamId));
  const positionById = new Map(
    positions.map((position) => [position.positionId, position]),
  );
  const teamRoles = (
    Array.isArray(source.teamRoles) ? source.teamRoles : []
  ).filter((role) => role && projectedTeamIds.has(role.teamId));
  const roleById = new Map(teamRoles.map((role) => [role.roleId, role]));
  const qualificationAreas = (
    Array.isArray(source.qualificationAreas) ? source.qualificationAreas : []
  ).filter((area) => area && projectedTeamIds.has(area.teamId));
  const areaById = new Map(
    qualificationAreas.map((area) => [area.areaId, area]),
  );
  const qualificationLevels = (
    Array.isArray(source.qualificationLevels) ? source.qualificationLevels : []
  ).filter((level) => level && areaById.has(level.areaId));
  const levelById = new Map(
    qualificationLevels.map((level) => [level.levelId, level]),
  );
  const memberIds = new Set(
    teams.flatMap((team) =>
      Array.isArray(team.memberIds) ? team.memberIds : [],
    ),
  );
  const membersById = new Map(
    (Array.isArray(source.members) ? source.members : [])
      .filter((member) => member?.memberId && !member.archivedAt)
      .map((member) => [member.memberId, member]),
  );

  const members = [];
  for (const memberId of memberIds) {
    const member = membersById.get(memberId);
    if (!member) continue;

    const memberTeamIds = new Set(
      teams
        .filter((team) => team.memberIds?.includes(memberId))
        .map((team) => team.teamId || team.id),
    );
    const managedMemberTeamIds = new Set(
      [...memberTeamIds].filter((teamId) => editableTeamIds.has(teamId)),
    );
    const isManagerVisible = managedMemberTeamIds.size > 0;
    const projected = copyDefinedFields(member, READ_ONLY_MEMBER_FIELDS);
    projected.positionIds = (
      Array.isArray(member.positionIds) ? member.positionIds : []
    ).filter((positionId) => positionById.has(positionId));

    if (isManagerVisible) {
      Object.assign(
        projected,
        copyDefinedFields(member, MANAGER_MEMBER_FIELDS),
      );
      projected.desiredPositionIds = (
        Array.isArray(member.desiredPositionIds)
          ? member.desiredPositionIds
          : []
      ).filter((positionId) => positionById.has(positionId));

      // Qualification notes and verification metadata are team management
      // data. Only qualifications for teams the caller edits are included.
      projected.qualifications = (
        Array.isArray(member.qualifications) ? member.qualifications : []
      ).flatMap((qualification) => {
        const area = areaById.get(qualification?.areaId);
        if (
          !area ||
          !managedMemberTeamIds.has(area.teamId) ||
          (qualification.teamId && qualification.teamId !== area.teamId)
        ) {
          return [];
        }
        const projectedQualification = copyDefinedFields(
          qualification,
          QUALIFICATION_FIELDS,
        );
        projectedQualification.teamId = area.teamId;
        if (
          projectedQualification.levelId &&
          levelById.get(projectedQualification.levelId)?.areaId !== area.areaId
        ) {
          delete projectedQualification.levelId;
        }
        return [projectedQualification];
      });

      const teamMemberships = {};
      for (const [teamId, membership] of Object.entries(
        member.teamMemberships || {},
      )) {
        // Canonical team membership and visible scope control nested entries.
        if (
          !memberTeamIds.has(teamId) ||
          (membership?.teamId && membership.teamId !== teamId)
        ) {
          continue;
        }
        const projectedMembership = { teamId };
        if (
          membership?.roleId &&
          roleById.get(membership.roleId)?.teamId === teamId
        ) {
          projectedMembership.roleId = membership.roleId;
        }
        if (membership?.roleLabel) {
          projectedMembership.roleLabel = membership.roleLabel;
        }
        // View-only memberships retain role display data at most.
        if (editableTeamIds.has(teamId)) {
          if (typeof membership?.isTeamLead === "boolean") {
            projectedMembership.isTeamLead = membership.isTeamLead;
          }
          if (Object.hasOwn(membership || {}, "notes")) {
            projectedMembership.notes = membership.notes;
          }
        }
        teamMemberships[teamId] = projectedMembership;
      }
      projected.teamMemberships = teamMemberships;
    }

    members.push(projected);
  }

  const result = {
    members,
    positions,
    teams,
    teamRoles,
    qualificationAreas,
    qualificationLevels,
    schedules: (Array.isArray(source.schedules) ? source.schedules : []).filter(
      (schedule) => schedule && projectedTeamIds.has(schedule.teamId),
    ),
  };
  if (source.scheduleHydrationWindow) {
    result.scheduleHydrationWindow = {
      startDate: source.scheduleHydrationWindow.startDate,
      endDate: source.scheduleHydrationWindow.endDate,
    };
  }
  if (source.truncated === true) result.truncated = true;
  return result;
};
