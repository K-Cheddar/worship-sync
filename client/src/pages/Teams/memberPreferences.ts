import type {
  TeamMemberServingFrequency,
  TeamRosterMember,
} from "../../api/authTypes";
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

export const isMinorOnDate = (
  dateOfBirth: string,
  referenceDate = new Date(),
): boolean | null => {
  const birthDate = parsePlainDate(dateOfBirth);
  if (!birthDate) return null;
  const eighteenthBirthday = new Date(
    birthDate.getFullYear() + 18,
    birthDate.getMonth(),
    birthDate.getDate(),
  );
  return referenceDate < eighteenthBirthday;
};

export const resolveMemberMinorStatus = (
  member: Pick<TeamRosterMember, "dateOfBirth" | "isMinor">,
  referenceDate = new Date(),
) => isMinorOnDate(member.dateOfBirth || "", referenceDate) ?? Boolean(member.isMinor);

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
