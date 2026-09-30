import type { TeamRosterMember } from "../../api/authTypes";

/** Whether the roster record contains an email address or phone number. */
export const hasMemberContactInfo = (
  member: Pick<TeamRosterMember, "email" | "phoneNumber"> | null | undefined,
): boolean => {
  if (!member) return false;
  return Boolean(member.email?.trim() || member.phoneNumber?.trim());
};
