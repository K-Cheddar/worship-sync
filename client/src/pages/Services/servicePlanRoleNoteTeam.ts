/**
 * Role note labels include their team for people to scan quickly. The explicit
 * teamName is the authority, but older notes only have that label, so retain a
 * small compatibility fallback while filtering.
 */
type RoleNoteTeamSource = {
  label: string;
  teamName?: string;
  teamNames?: string[];
};

const roleNoteTeamFromLabel = (label: string): string => {
  const separator = label.match(/\s+(?:\u00c2)?\u00b7\s+/i);
  if (!separator?.index) return "";
  return label.slice(0, separator.index).trim();
};

/** Older notes stored "Team · Role" in one label; new labels are role-only. */
export const getServicePlanRoleNoteRoleName = (label: string): string => {
  const separator = label.match(/\s+(?:\u00c2)?\u00b7\s+/i);
  return separator?.index === undefined
    ? label.trim()
    : label.slice(separator.index + separator[0].length).trim();
};

export const getServicePlanRoleNoteTeamName = (
  note: RoleNoteTeamSource,
): string =>
  note.teamNames?.find((teamName) => teamName.trim())?.trim()
  || note.teamName?.trim()
  || roleNoteTeamFromLabel(note.label);

export const getServicePlanRoleNoteTeamNames = (
  note: RoleNoteTeamSource,
): string[] => {
  const names = note.teamNames?.map((name) => name.trim()).filter(Boolean) ?? [];
  return names.length ? names : [getServicePlanRoleNoteTeamName(note)].filter(Boolean);
};

/** Empty team selection intentionally leaves role notes unscoped. */
export const roleNoteMatchesServicePlanTeam = (
  note: RoleNoteTeamSource,
  teamName: string,
): boolean => !teamName || getServicePlanRoleNoteTeamNames(note).includes(teamName);
