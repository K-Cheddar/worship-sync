import type { TeamPosition, TeamRecord, TeamRosterMember } from "../../api/authTypes";

export type MemberListAssignment = {
  teamId: string;
  teamName: string;
  positionName?: string;
};

const compareNames = (a: string, b: string) => {
  const normalizedA = a.trim().toLowerCase();
  const normalizedB = b.trim().toLowerCase();
  if (normalizedA < normalizedB) return -1;
  if (normalizedA > normalizedB) return 1;
  return 0;
};

/** Derive roster assignments from the existing team membership and position relationships. */
export const getMemberListAssignments = (
  member: TeamRosterMember,
  rosterTeamIds: string[],
  teamsById: Map<string, TeamRecord>,
  positionsById: Map<string, TeamPosition>,
): MemberListAssignment[] => {
  const teamIds = new Set<string>([
    ...Object.keys(member.teamMemberships || {}),
    ...rosterTeamIds,
  ]);
  const positionsByTeamId = new Map<string, TeamPosition[]>();

  (member.positionIds || []).forEach((positionId) => {
    const position = positionsById.get(positionId);
    if (!position || !teamsById.has(position.teamId)) return;
    teamIds.add(position.teamId);
    const teamPositions = positionsByTeamId.get(position.teamId) || [];
    teamPositions.push(position);
    positionsByTeamId.set(position.teamId, teamPositions);
  });

  const assignments: MemberListAssignment[] = [];
  [...teamIds]
    .map((teamId) => teamsById.get(teamId))
    .filter((team): team is TeamRecord => Boolean(team))
    .sort(
      (a, b) =>
        compareNames(a.name, b.name) || compareNames(a.teamId, b.teamId),
    )
    .forEach((team) => {
      const positions = (positionsByTeamId.get(team.teamId) || []).sort(
        (a, b) =>
          compareNames(a.name, b.name) ||
          compareNames(a.positionId, b.positionId),
      );
      const uniquePositions = positions.filter(
        (position, index) =>
          positions.findIndex(
            (candidate) =>
              candidate.name.trim().toLowerCase() ===
              position.name.trim().toLowerCase(),
          ) === index,
      );

      if (uniquePositions.length === 0) {
        assignments.push({ teamId: team.teamId, teamName: team.name });
        return;
      }

      uniquePositions.forEach((position) =>
        assignments.push({
          teamId: team.teamId,
          teamName: team.name,
          positionName: position.name,
        }),
      );
    });

  return assignments;
};
