import type {
  PublicServiceFlowItem,
  PublicServiceFlowRole,
  PublicServiceFlowSnapshot,
  PublicServiceFlowTeamNote,
} from "./serviceFlowTypes";
import {
  getServicePlanRoleNoteRoleName,
  getServicePlanRoleNoteTeamName,
  roleNoteMatchesServicePlanTeam,
} from "../pages/Services/servicePlanRoleNoteTeam";

export type ServiceFlowRoleOption = PublicServiceFlowRole;

export type ServiceFlowFilterPreference = {
  teamName: string;
  positionIds: string[];
};

export const serviceFlowRolePositionIds = (note: {
  positionId?: string;
  positionIds?: string[];
}): string[] =>
  note.positionIds?.filter(Boolean) ?? (note.positionId ? [note.positionId] : []);

export const buildServiceFlowTeamLabels = (
  snapshot: PublicServiceFlowSnapshot,
): string[] => {
  if (snapshot.service.viewMode === "general") return [];
  return Array.from(
    new Set([
      ...snapshot.service.sections.flatMap((section) =>
        section.items.flatMap((item) =>
          (item.teamNotes || [])
            .filter((note) => note.scope !== "role")
            .map((note) => note.label),
        ),
      ),
      ...(snapshot.roles || [])
        .map((role) => role.teamName || "")
        .filter(Boolean),
    ]),
  ).sort((left, right) => left.localeCompare(right));
};

/** Prefer the full roster, then retain roles discoverable only in legacy data. */
export const buildServiceFlowRoleOptions = (
  snapshot: PublicServiceFlowSnapshot,
): ServiceFlowRoleOption[] => {
  if (snapshot.service.viewMode === "general") return [];
  const options = new Map<string, ServiceFlowRoleOption>();
  (snapshot.roles || []).forEach((role) => {
    const positionId = String(role.positionId || "").trim();
    const label = String(role.label || "").trim();
    if (!positionId || !label) return;
    options.set(positionId, { ...role, positionId, label });
  });

  snapshot.service.sections.forEach((section) => {
    section.items.forEach((item) => {
      (item.teamNotes || []).forEach((note) => {
        if (note.scope !== "role") return;
        const teamName = getServicePlanRoleNoteTeamName(note) || "Other roles";
        serviceFlowRolePositionIds(note).forEach((positionId) => {
          if (options.has(positionId)) return;
          options.set(positionId, {
            positionId,
            label: getServicePlanRoleNoteRoleName(note.label),
            teamId: note.teamIds?.[0] || note.teamId || `legacy:${teamName}`,
            teamName: note.teamNames?.[0] || teamName,
          });
        });
      });
      (item.microphoneAssignments || []).forEach((assignment) => {
        assignment.audiences.forEach((audience) => {
          const positionId = String(audience.positionId || "").trim();
          if (!positionId || options.has(positionId)) return;
          const teamName = audience.teamName || "Other roles";
          options.set(positionId, {
            positionId,
            label: audience.roleName,
            teamId: audience.teamId || `legacy:${teamName}`,
            teamName,
          });
        });
      });
    });
  });

  return Array.from(options.values()).sort((left, right) =>
    left.label.localeCompare(right.label),
  );
};

export const filterServiceFlowRoleOptions = (
  options: ServiceFlowRoleOption[],
  selectedTeam: string,
): ServiceFlowRoleOption[] =>
  options.filter((role) => roleNoteMatchesServicePlanTeam(role, selectedTeam));

export const selectedServiceFlowRoleTeamNames = (
  options: ServiceFlowRoleOption[],
  selectedRoles: string[],
): string[] => {
  const names: string[] = [];
  const seen = new Set<string>();
  selectedRoles.forEach((positionId) => {
    const teamName = options.find((role) => role.positionId === positionId)?.teamName || "";
    if (!teamName || seen.has(teamName)) return;
    seen.add(teamName);
    names.push(teamName);
  });
  return names;
};

export const visibleServiceFlowNotesForItem = (
  item: PublicServiceFlowItem,
  selectedTeam: string,
  selectedRoles: string[],
  selectedRoleTeamNames: string[],
): PublicServiceFlowTeamNote[] => {
  const audienceTeams = selectedTeam ? [selectedTeam] : selectedRoleTeamNames;
  return (item.teamNotes || []).filter((note) =>
    note.scope === "role"
      ? roleNoteMatchesServicePlanTeam(note, selectedTeam) &&
        (!selectedRoles.length ||
          serviceFlowRolePositionIds(note).some((id) => selectedRoles.includes(id)))
      : !audienceTeams.length || audienceTeams.includes(note.label),
  );
};

export const visibleServiceFlowMicrophoneAssignmentsForItem = (
  item: PublicServiceFlowItem,
  selectedTeam: string,
  selectedRoles: string[],
) =>
  (item.microphoneAssignments || []).filter((assignment) => {
    // An unscoped legacy assignment is useful in the broad view, but must not
    // defeat a deliberate team or role selection.
    if (!assignment.audiences.length) return !selectedTeam && !selectedRoles.length;
    return assignment.audiences.some(
      (audience) =>
        (!selectedTeam || audience.teamName === selectedTeam) &&
        (!selectedRoles.length || selectedRoles.includes(audience.positionId)),
    );
  });

export const serviceFlowItemHasVisibleAudienceContent = (
  item: PublicServiceFlowItem,
  selectedTeam: string,
  selectedRoles: string[],
  selectedRoleTeamNames: string[],
): boolean =>
  Boolean(
    item.notes.blocks.length ||
      visibleServiceFlowNotesForItem(
        item,
        selectedTeam,
        selectedRoles,
        selectedRoleTeamNames,
      ).length ||
      visibleServiceFlowMicrophoneAssignmentsForItem(
        item,
        selectedTeam,
        selectedRoles,
      ).length,
  );
