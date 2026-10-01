import type {
  NotificationIntentType,
  SmsMemberEligibility,
  TeamIntakeForm,
  TeamIntakeRecipient,
  TeamPosition,
  TeamRecord,
  TeamRosterMember,
} from "../../api/authTypes";

export const getAvailabilityRecipientRows = ({
  members,
  positions,
  teams,
  recipients,
  eligibilityByMemberId,
  form,
  intentType,
}: {
  members: TeamRosterMember[];
  positions: TeamPosition[];
  teams: TeamRecord[];
  recipients: TeamIntakeRecipient[];
  eligibilityByMemberId?: Record<string, SmsMemberEligibility>;
  form: TeamIntakeForm | undefined;
  intentType: Extract<NotificationIntentType, "availability_request" | "availability_reminder">;
}) => {
  const positionTeamById = new Map(positions.map((position) => [position.positionId, position.teamId]));
  const formTeamIds = new Set(form?.teamIds || []);
  return members.map((member) => {
    const memberTeamIds = new Set([
      ...Object.keys(member.teamMemberships || {}),
      ...(member.positionIds || []).map((id) => positionTeamById.get(id)).filter((id): id is string => Boolean(id)),
      ...teams.filter((team) => (team.memberIds || []).includes(member.memberId)).map((team) => team.teamId),
    ]);
    const recipient = recipients.find((item) => item.formId === form?.formId && item.memberId === member.memberId);
    const eligibility = eligibilityByMemberId?.[member.memberId] || {
      status: member.phoneNumber ? "consent_needed" : "no_mobile",
      eligible: false,
    };
    let reason = "";
    if (!form) {
      reason = "Choose a form first";
    } else if (recipient?.revokedAt) {
      reason = "Response link revoked";
    } else if (recipient?.respondedAt) {
      reason = "Already responded";
    } else if (formTeamIds.size && ![...formTeamIds].some((id) => memberTeamIds.has(id))) {
      reason = "Outside this form’s team scope";
    } else if (intentType === "availability_reminder" && !recipient) {
      reason = "No response link";
    } else if (!eligibility.eligible) {
      reason = eligibility.status === "no_mobile" ? "No mobile number" : eligibility.status === "opted_out" ? "SMS opted out" : "SMS consent needed";
    }
    return { member, memberTeamIds, recipient, eligibility, eligible: Boolean(form) && !reason, reason };
  });
};
