import type {
  NotificationIntentType,
  NotificationIntent,
  SmsMemberEligibility,
  SmsDeliveryAttempt,
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
  notificationIntents = [],
  smsDeliveryAttempts = [],
  form,
  intentType,
}: {
  members: TeamRosterMember[];
  positions: TeamPosition[];
  teams: TeamRecord[];
  recipients: TeamIntakeRecipient[];
  eligibilityByMemberId?: Record<string, SmsMemberEligibility>;
  notificationIntents?: NotificationIntent[];
  smsDeliveryAttempts?: SmsDeliveryAttempt[];
  form: TeamIntakeForm | undefined;
  intentType: Extract<NotificationIntentType, "availability_request" | "availability_reminder">;
}) => {
  const positionTeamById = new Map(positions.map((position) => [position.positionId, position.teamId]));
  const formTeamIds = new Set(form?.teamIds || []);
  const requestIntentByRecipientId = new Map<string, NotificationIntent>();
  notificationIntents.forEach((intent) => {
    if (intent.formId !== form?.formId || intent.intentType !== "availability_request" || !intent.recipientId) return;
    const current = requestIntentByRecipientId.get(intent.recipientId);
    if (!current || (intent.updatedAt || intent.createdAt) > (current.updatedAt || current.createdAt)) {
      requestIntentByRecipientId.set(intent.recipientId, intent);
    }
  });
  const requestAttemptsByRecipientId = new Map<string, SmsDeliveryAttempt[]>();
  smsDeliveryAttempts.forEach((attempt) => {
    if (
      (attempt.formId && attempt.formId !== form?.formId) ||
      !["initial", "availability_request"].includes(attempt.purpose) ||
      !attempt.recipientId
    ) return;
    requestAttemptsByRecipientId.set(attempt.recipientId, [
      ...(requestAttemptsByRecipientId.get(attempt.recipientId) || []),
      attempt,
    ]);
  });
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
    let previousDeliveryStatus: "sent" | "uncertain" | "failed" | "handled" | "" = "";
    if (intentType === "availability_request" && recipient) {
      const intent = requestIntentByRecipientId.get(recipient.recipientId);
      const attempts = requestAttemptsByRecipientId.get(recipient.recipientId) || [];
      const providerAccepted = intent?.status === "sent" || attempts.some((attempt) =>
        ["accepted", "sent", "delivered", "undelivered"].includes(attempt.status) ||
        attempt.outcome === "confirmed",
      );
      const hasDefinitiveFailure = attempts.some((attempt) =>
        attempt.outcome === "not_sent" || attempt.outcome === "failed",
      );
      const deliveryUncertain = ["sending", "unknown"].includes(intent?.status || "") || attempts.some((attempt) =>
        attempt.outcome === "unknown" || attempt.status === "pending" ||
        (attempt.status === "failed" && !attempt.outcome),
      ) || (intent?.status === "failed" && !hasDefinitiveFailure);
      const hasRetryableFailure = hasDefinitiveFailure;
      if (providerAccepted) previousDeliveryStatus = "sent";
      else if (deliveryUncertain) previousDeliveryStatus = "uncertain";
      else if (intent?.status === "suppressed") previousDeliveryStatus = "handled";
      else if (hasRetryableFailure) previousDeliveryStatus = "failed";
    }
    if (!form) {
      reason = "Choose a form first";
    } else if (recipient?.revokedAt) {
      reason = "Response link revoked";
    } else if (recipient?.respondedAt) {
      reason = "Already responded";
    } else if (formTeamIds.size && ![...formTeamIds].some((id) => memberTeamIds.has(id))) {
      reason = "Outside this form’s team scope";
    } else if (previousDeliveryStatus === "sent") {
      reason = "Already sent";
    } else if (previousDeliveryStatus === "uncertain") {
      reason = "Previous send outcome is uncertain. Check message history before sending again.";
    } else if (previousDeliveryStatus === "handled" && eligibility.status === "opted_out") {
      reason = "SMS opted out";
    } else if (previousDeliveryStatus === "handled") {
      reason = "This form request was already handled.";
    } else if (intentType === "availability_reminder" && !recipient) {
      reason = "No response link";
    } else if (!eligibility.eligible) {
      reason = eligibility.status === "no_mobile" ? "Missing or invalid phone" : eligibility.status === "opted_out" ? "SMS opted out" : "SMS consent needed";
    }
    return {
      member,
      memberTeamIds,
      recipient,
      eligibility,
      eligible: Boolean(form) && !reason,
      reason,
      previousDeliveryStatus,
    };
  });
};
