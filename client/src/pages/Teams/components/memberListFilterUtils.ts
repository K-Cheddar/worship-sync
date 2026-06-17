import type { MultiCheckboxOption } from "./MultiCheckboxGroup";

export const matchesScopedTeam = (teamId: string, scopedTeamIds: string[]) =>
  scopedTeamIds.length === 0 || scopedTeamIds.includes(teamId);

export const toCheckboxOption = (item: {
  id: string;
  label: string;
  archived?: boolean | null;
}): MultiCheckboxOption => ({
  id: item.id,
  label: item.label,
  archived: Boolean(item.archived),
});
