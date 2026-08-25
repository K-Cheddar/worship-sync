import type {
  TeamMemberServingFrequency,
  TeamMemberRecurringAvailability,
  TeamRosterMember,
} from "../../api/authTypes";
import { isCompleteBirthDate } from "../../utils/birthDate";
import { parsePlainDate } from "../../utils/plainDate";

export const DEFAULT_SERVING_FREQUENCY: TeamMemberServingFrequency = "as_needed";

export const servingFrequencyOptions: Array<{
  value: TeamMemberServingFrequency;
  label: string;
}> = [
  { value: "as_needed", label: "As often as needed" },
  { value: "weekly", label: "Once a week" },
  { value: "twice_monthly", label: "Twice a month" },
  { value: "monthly", label: "Once a month" },
];

export const servingFrequencyLabel = (
  value: TeamRosterMember["servingFrequency"],
) =>
  servingFrequencyOptions.find((option) => option.value === value)?.label ||
  servingFrequencyOptions[0].label;

export const recurringAvailabilityWeekOptions: Array<{
  value: 1 | 2 | 3 | 4 | 5;
  label: string;
}> = [
  { value: 1, label: "1st week" },
  { value: 2, label: "2nd week" },
  { value: 3, label: "3rd week" },
  { value: 4, label: "4th week" },
  { value: 5, label: "5th week" },
];

export const emptyRecurringAvailability = (): TeamMemberRecurringAvailability => ({
  weeksOfMonth: [],
  includeLastWeekOfMonth: false,
});

/**
 * Returns whether a calendar date is allowed by a member's recurring
 * availability. A missing or empty rule intentionally means no restriction.
 */
export const isMemberAvailableOnDate = (
  member: Pick<TeamRosterMember, "recurringAvailability">,
  plainDate: string,
) => {
  const availability = member.recurringAvailability;
  const selectedWeeks = availability?.weeksOfMonth || [];
  if (!plainDate || (!availability?.includeLastWeekOfMonth && selectedWeeks.length === 0)) {
    return true;
  }

  const date = parsePlainDate(plainDate);
  if (!date) return true;
  const dayOfMonth = date.getDate();
  const weekOfMonth = (Math.floor((dayOfMonth - 1) / 7) + 1) as 1 | 2 | 3 | 4 | 5;
  const lastDayOfMonth = new Date(
    date.getFullYear(),
    date.getMonth() + 1,
    0,
  ).getDate();
  const isLastWeekOfMonth = dayOfMonth + 7 > lastDayOfMonth;

  return (
    selectedWeeks.includes(weekOfMonth) ||
    (availability?.includeLastWeekOfMonth && isLastWeekOfMonth)
  );
};

export const recurringAvailabilityLabel = (
  availability: TeamRosterMember["recurringAvailability"],
) => {
  const selectedWeeks = availability?.weeksOfMonth || [];
  const labels = recurringAvailabilityWeekOptions
    .filter((option) => selectedWeeks.includes(option.value))
    .map((option) => option.label);
  if (availability?.includeLastWeekOfMonth) labels.push("last week");
  return labels.length ? labels.join(", ") : "Every week";
};

export const isMinorOnDate = (
  birthDate: TeamRosterMember["birthDate"],
  referenceDate = new Date(),
): boolean | null => {
  if (!birthDate || !isCompleteBirthDate(birthDate)) return null;
  const eighteenthBirthday = new Date(
    birthDate.year! + 18,
    birthDate.month - 1,
    birthDate.day,
  );
  return referenceDate < eighteenthBirthday;
};

export const resolveMemberMinorStatus = (
  member: Pick<TeamRosterMember, "birthDate" | "isMinor">,
  referenceDate = new Date(),
) => isMinorOnDate(member.birthDate, referenceDate) ?? Boolean(member.isMinor);

export const servingFrequencyTargetReached = ({
  servingFrequency,
  occurrenceDate,
  assignedDates,
}: {
  servingFrequency: TeamRosterMember["servingFrequency"];
  occurrenceDate: Date | undefined;
  assignedDates: Date[];
}) => {
  if (!occurrenceDate || !servingFrequency || servingFrequency === "as_needed") {
    return false;
  }

  if (servingFrequency === "weekly") {
    const startOfWeek = new Date(
      occurrenceDate.getFullYear(),
      occurrenceDate.getMonth(),
      occurrenceDate.getDate() - occurrenceDate.getDay(),
    );
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 7);
    return assignedDates.some((date) => date >= startOfWeek && date < endOfWeek);
  }

  const assignmentsThisMonth = assignedDates.filter(
    (date) =>
      date.getFullYear() === occurrenceDate.getFullYear() &&
      date.getMonth() === occurrenceDate.getMonth(),
  ).length;
  return assignmentsThisMonth >= (servingFrequency === "monthly" ? 1 : 2);
};
