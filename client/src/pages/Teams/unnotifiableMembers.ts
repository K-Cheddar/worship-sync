import type { TeamRosterMember } from "../../api/authTypes";

/**
 * Whether the existing email/account notification route can reach a member.
 *
 * A phone number alone is not sufficient: SMS has its own phone and
 * church-scoped consent eligibility checks. This helper is used for the email
 * notification route, including the Who's Serving notification indicator.
 *
 * A linked account is sufficient on its own because the account carries an
 * address even when the roster record has none.
 */

export const canNotifyMember = (
  member: Pick<TeamRosterMember, "email" | "userId"> | undefined | null,
): boolean => {
  if (!member) return false;
  if (member.userId) return true;
  return Boolean((member.email || "").trim());
};
