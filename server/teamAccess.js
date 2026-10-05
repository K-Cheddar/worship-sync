/**
 * Resolve Teams access from explicit permissions and canonical roster membership.
 * Services access intentionally remains outside this model; legacy routes may
 * continue to apply their existing Services-to-Teams compatibility behavior.
 */
export const resolveEffectiveTeamAccess = ({
  bootstrap,
  churchId,
  members = [],
  teams = [],
} = {}) => {
  if (!churchId || bootstrap?.churchId !== churchId) {
    return {
      viewAll: false,
      editAll: false,
      viewTeamIds: new Set(),
      editTeamIds: new Set(),
      memberTeamIds: new Set(),
      explicitlyEditableTeamIds: new Set(),
      explicitlyViewableTeamIds: new Set(),
    };
  }

  const permissions = bootstrap?.permissions || {};
  const viewTeamIds = new Set();
  const editTeamIds = new Set();
  const memberTeamIds = new Set();
  const explicitlyEditableTeamIds = new Set();
  const explicitlyViewableTeamIds = new Set();

  const isAdmin = bootstrap?.role === "admin";
  const globalTeams = permissions.teams;
  const editAll = isAdmin || globalTeams === "edit";
  const viewAll = editAll || globalTeams === "view";

  for (const [teamId, permission] of Object.entries(permissions.teamScopes || {})) {
    if (!teamId) continue;
    if (permission === "view") {
      explicitlyViewableTeamIds.add(teamId);
      viewTeamIds.add(teamId);
    } else if (permission === "edit") {
      explicitlyEditableTeamIds.add(teamId);
      viewTeamIds.add(teamId);
      editTeamIds.add(teamId);
    }
  }

  const userId = bootstrap?.sessionKind === "human"
    ? String(bootstrap?.user?.uid || "")
    : "";
  if (userId && churchId) {
    // User links are unique per church. If malformed data violates that
    // invariant, fail closed instead of combining multiple roster identities.
    const linkedMembers = members.filter((member) =>
      member &&
      member.churchId === churchId &&
      !member.archivedAt &&
      member.userId === userId,
    );
    if (linkedMembers.length === 1) {
      const memberId = linkedMembers[0].memberId;
      if (memberId) {
        for (const team of teams) {
          const teamId = team?.teamId || team?.id;
          if (
            teamId &&
            team.churchId === churchId &&
            !team.archivedAt &&
            Array.isArray(team.memberIds) &&
            team.memberIds.includes(memberId)
          ) {
            memberTeamIds.add(teamId);
            viewTeamIds.add(teamId);
          }
        }
      }
    }
  }

  return {
    viewAll,
    editAll,
    viewTeamIds,
    editTeamIds,
    memberTeamIds,
    explicitlyEditableTeamIds,
    explicitlyViewableTeamIds,
  };
};

export const canViewTeam = (access, teamId) =>
  Boolean(access?.viewAll || access?.viewTeamIds?.has(teamId));

export const canEditTeam = (access, teamId) =>
  Boolean(access?.editAll || access?.editTeamIds?.has(teamId));
