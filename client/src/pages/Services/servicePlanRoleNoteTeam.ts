/**
 * Role note labels include their team for people to scan quickly. The explicit
 * teamName is the authority, but older notes only have that label, so retain a
 * small compatibility fallback while filtering.
 */
type RoleNoteTeamSource = {
  label: string;
  teamName?: string;
};

const roleNoteTeamFromLabel = (label: string): string => {
  const separator = label.match(/\s+(?:\u00c2)?\u00b7\s+/i);
  if (!separator?.index) return "";
  return label.slice(0, separator.index).trim();
};

export const getServicePlanRoleNoteTeamName = (
  note: RoleNoteTeamSource,
): string => note.teamName?.trim() || roleNoteTeamFromLabel(note.label);

/** Empty team selection intentionally leaves role notes unscoped. */
export const roleNoteMatchesServicePlanTeam = (
  note: RoleNoteTeamSource,
  teamName: string,
): boolean => !teamName || getServicePlanRoleNoteTeamName(note) === teamName;
