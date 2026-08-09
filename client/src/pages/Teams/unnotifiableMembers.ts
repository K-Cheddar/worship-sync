import type { TeamRosterMember } from "../../api/authTypes";

/**
 * Whether a person can be reached by a notification at all.
 *
 * A member with no email and no linked account receives nothing, so scheduling
 * them sends nothing. The dangerous case is not the missing notification — it
 * is an owner assuming one went out, which is why this is surfaced in the
 * roster list and in Who's serving.
 *
 * A linked account is sufficient on its own: the account carries an address
 * even when the roster record has none.
 */

export const canNotifyMember = (
  member: Pick<TeamRosterMember, "email" | "userId"> | undefined | null,
): boolean => {
  if (!member) return false;
  if (member.userId) return true;
  return Boolean((member.email || "").trim());
};
