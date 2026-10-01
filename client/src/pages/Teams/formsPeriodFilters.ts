import type { TeamIntakeForm } from "../../api/authTypes";
import { overlapsInclusiveDateRange } from "./schedule/dateRangeUtils";

export const filterFormsByDateRange = (
  forms: TeamIntakeForm[],
  range: { startDate: string; endDate: string },
) => forms.filter((form) => overlapsInclusiveDateRange(form, range));
