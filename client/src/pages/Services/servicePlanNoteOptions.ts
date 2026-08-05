import type { TeamPosition, TeamRecord } from "../../api/authTypes";
import type {
  ServicePlanMicrophoneAssignment,
  ServicePlanMicrophoneAudience,
  ServicePlanSection,
} from "../../types/servicePlan";
import {
  getServicePlanElementAssignees,
  getServicePlanRoleNotePositionIds,
} from "../../types/servicePlan";
import type {
  ServicePlanRoleNoteOption,
  ServicePlanTeamNoteOption,
} from "./ServicePlanElementRow";
import { getServicePlanRoleNoteRoleName } from "./servicePlanRoleNoteTeam";

/**
 * Which audiences a plan's note controls should offer, and which of them a
 * viewer can filter down to. Shared by the dated-plan editor and the template
 * editor so both build the same pickers from the same church data.
 */

const microphoneAudiencesFor = (
  assignment: ServicePlanMicrophoneAssignment,
  microphoneAudiences: ServicePlanMicrophoneAudience[] | undefined,
) => microphoneAudiences ?? assignment.audiences ?? [];

const elementHasMicrophone = (
  element: ServicePlanSection["elements"][number],
) =>
  getServicePlanElementAssignees(element).some(
    (assignee) => (assignee.microphoneIds || []).length > 0,
  ) || (element.microphoneAssignments || []).length > 0;

/** Unique non-empty team-note labels across the plan, sorted for the filter. */
export const collectServicePlanTeamNoteLabels = (
  sections: ServicePlanSection[] | null | undefined,
  microphoneAudiences?: ServicePlanMicrophoneAudience[],
): string[] => {
  if (!sections?.length) return [];
  const labels = new Set<string>();
  for (const section of sections) {
    for (const element of section.elements) {
      for (const note of element.teamNotes || []) {
        if (note.scope === "role") continue;
        const label = note.label.trim();
        if (label) labels.add(label);
      }
      const microphoneAssignments = element.microphoneAssignments || [];
      const audiences = microphoneAssignments.length
        ? microphoneAssignments.flatMap((assignment) =>
            microphoneAudiencesFor(assignment, microphoneAudiences),
          )
        : elementHasMicrophone(element)
          ? microphoneAudiences || []
          : [];
      for (const audience of audiences) {
        const teamName = audience.teamName || "";
        if (teamName) labels.add(teamName);
      }
    }
  }
  return Array.from(labels).sort((a, b) => a.localeCompare(b));
};

export const collectServicePlanRoleNoteOptions = (
  sections: ServicePlanSection[] | null | undefined,
  positions: TeamPosition[],
  teams: TeamRecord[],
  microphoneAudiences?: ServicePlanMicrophoneAudience[],
): ServicePlanRoleNoteOption[] => {
  const teamNamesById = new Map(teams.map((team) => [team.teamId, team.name]));
  const options = new Map<string, ServicePlanRoleNoteOption>();

  positions
    .filter((position) => !position.archivedAt)
    .forEach((position) => {
      const teamName = teamNamesById.get(position.teamId);
      options.set(position.positionId, {
        positionId: position.positionId,
        roleName: position.name,
        label: position.name,
        teamId: position.teamId,
        teamName,
      });
    });

  for (const section of sections || []) {
    for (const element of section.elements) {
      for (const note of element.teamNotes || []) {
        const positionIds = getServicePlanRoleNotePositionIds(note);
        if (note.scope !== "role" || !positionIds.length) {
          continue;
        }
        positionIds.forEach((positionId) => {
          if (options.has(positionId)) return;
          options.set(positionId, {
            positionId,
            roleName:
              getServicePlanRoleNoteRoleName(note.label) || "Unknown role",
            label: getServicePlanRoleNoteRoleName(note.label) || "Unknown role",
            teamId: note.teamIds?.[0] || note.teamId,
            teamName: note.teamNames?.[0] || note.teamName,
          });
        });
      }
      const microphoneAssignments = element.microphoneAssignments || [];
      const audiences = microphoneAssignments.length
        ? microphoneAssignments.flatMap((assignment) =>
            microphoneAudiencesFor(assignment, microphoneAudiences),
          )
        : elementHasMicrophone(element)
          ? microphoneAudiences || []
          : [];
      for (const audience of audiences) {
        if (options.has(audience.positionId)) continue;
        options.set(audience.positionId, {
          positionId: audience.positionId,
          roleName: audience.roleName || "Unknown role",
          label: audience.roleName || "Unknown role",
          teamId: audience.teamId,
          teamName: audience.teamName,
        });
      }
    }
  }

  return Array.from(options.values()).sort((left, right) =>
    left.label.localeCompare(right.label),
  );
};

/** Team-note audiences: every active team, alphabetical. */
export const collectServicePlanTeamNoteOptions = (
  teams: TeamRecord[],
): ServicePlanTeamNoteOption[] =>
  teams
    .filter((team) => !team.archivedAt)
    .map((team) => ({ teamId: team.teamId, label: team.name }))
    .sort((left, right) => left.label.localeCompare(right.label));
