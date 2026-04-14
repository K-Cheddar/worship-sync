/**
 * Enforces one active church per human account when accepting an invite.
 * @param {{ userId: string, invitedChurchId: string, activeMemberships: Array<{ userId?: string, churchId?: string, status?: string }> }} params
 * @returns {{ statusCode: number, message: string } | null}
 */
export const getInviteMembershipConflict = ({
  userId,
  invitedChurchId,
  activeMemberships,
}) => {
  for (const m of activeMemberships) {
    if (!m || m.status !== "active" || m.userId !== userId) continue;
    const cid = m.churchId;
    if (!cid) continue;
    if (cid === invitedChurchId) {
      return {
        statusCode: 400,
        message: "You are already a member of this church.",
      };
    }
    return {
      statusCode: 409,
      message: "This account already belongs to a church.",
    };
  }
  return null;
};
