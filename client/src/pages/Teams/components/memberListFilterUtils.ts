import type { MultiCheckboxOption } from "./MultiCheckboxGroup";
import type { EntityIcon } from "../../../components/icons/iconTypes";

export const matchesScopedTeam = (teamId: string, scopedTeamIds: string[]) =>
  scopedTeamIds.length === 0 || scopedTeamIds.includes(teamId);

export const toCheckboxOption = (item: {
  id: string;
  label: string;
  archived?: boolean | string | null;
  icon?: EntityIcon;
}): MultiCheckboxOption => ({
  id: item.id,
  label: item.label,
  archived: Boolean(item.archived),
  icon: item.icon,
});
