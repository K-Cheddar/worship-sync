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

export type AvailabilityAudienceType = "not_contacted" | "nonresponders" | "specific";

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
  audienceType = intentType === "availability_reminder" ? "nonresponders" : "specific",
}: {
  members: TeamRosterMember[];
  positions: TeamPosition[];
  teams: TeamRecord[];
  recipients: TeamIntakeRecipient[];
  eligibilityByMemberId?: Record<string, Pick<SmsMemberEligibility, "eligible"> & Partial<Pick<SmsMemberEligibility, "status">>>;
  notificationIntents?: NotificationIntent[];
  smsDeliveryAttempts?: SmsDeliveryAttempt[];
  form: TeamIntakeForm | undefined;
  intentType: Extract<NotificationIntentType, "availability_request" | "availability_reminder">;
  audienceType?: AvailabilityAudienceType;
}) => {
  const positionTeamById = new Map(positions.map((position) => [position.positionId, position.teamId]));
  const formTeamIds = new Set(form?.teamIds || []);
  const requestIntentsByRecipientId = new Map<string, NotificationIntent[]>();
  notificationIntents.forEach((intent) => {
    if (intent.formId !== form?.formId || !["availability_request", "availability_reminder"].includes(intent.intentType) || !intent.recipientId) return;
    requestIntentsByRecipientId.set(intent.recipientId, [
      ...(requestIntentsByRecipientId.get(intent.recipientId) || []),
      intent,
    ]);
  });
  const requestAttemptsByRecipientId = new Map<string, SmsDeliveryAttempt[]>();
  smsDeliveryAttempts.forEach((attempt) => {
    if (
      (attempt.formId && attempt.formId !== form?.formId) ||
      !["initial", "availability_request", "availability_reminder", "reminder"].includes(attempt.purpose) ||
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
    const requestIntents = requestIntentsByRecipientId.get(recipient?.recipientId || "") || [];
    const requestAttempts = requestAttemptsByRecipientId.get(recipient?.recipientId || "") || [];
    const intentById = new Map(requestIntents.map((intent) => [intent.intentId, intent]));
    const linkedAttempts = new Map<string, SmsDeliveryAttempt>();
    requestAttempts.forEach((attempt) => {
      if (attempt.notificationIntentId) linkedAttempts.set(attempt.notificationIntentId, attempt);
    });
    const requestActivities = requestIntents.map((intent) => {
      const attempt = linkedAttempts.get(intent.intentId) ||
        requestAttempts.find((item) => item.attemptId === intent.attemptId) ||
        (requestIntents.length === 1 ? requestAttempts.find((item) => !item.notificationIntentId) : undefined);
      const accepted = intent.status === "sent" || Boolean(intent.sentAt) ||
        ["accepted", "sent", "delivered", "undelivered"].includes(attempt?.status || "") ||
        attempt?.outcome === "confirmed";
      const uncertain = ["sending", "unknown"].includes(intent.status) ||
        attempt?.outcome === "unknown" || attempt?.status === "pending" ||
        (attempt?.status === "failed" && !attempt.outcome) ||
        (intent.status === "failed" && !["failed", "not_sent"].includes(intent.attemptOutcome || attempt?.outcome || ""));
      const failed = intent.status === "failed" && ["failed", "not_sent"].includes(intent.attemptOutcome || attempt?.outcome || "");
      const status = accepted ? "sent" : uncertain ? "uncertain" : failed ? "failed" : intent.status === "suppressed" ? "handled" : "";
      return {
        status,
        at: intent.createdAt || intent.updatedAt || "",
        sentAt: accepted ? intent.sentAt || attempt?.acceptedAt || attempt?.sentAt || attempt?.createdAt || intent.updatedAt || intent.createdAt || "" : "",
      };
    }).filter(({ status }) => status);
    requestAttempts.filter((attempt) => !attempt.notificationIntentId || !intentById.has(attempt.notificationIntentId))
      .forEach((attempt) => {
        const accepted = ["accepted", "sent", "delivered", "undelivered"].includes(attempt.status) || attempt.outcome === "confirmed";
        const uncertain = attempt.outcome === "unknown" || attempt.status === "pending" ||
          (attempt.status === "failed" && !attempt.outcome);
        const failed = ["failed", "not_sent"].includes(attempt.outcome || "");
        const status = accepted ? "sent" : uncertain ? "uncertain" : failed ? "failed" : "";
        if (status) requestActivities.push({
          status,
          at: attempt.createdAt || attempt.updatedAt || "",
          sentAt: accepted ? attempt.acceptedAt || attempt.sentAt || attempt.createdAt || attempt.updatedAt || "" : "",
        });
      });
    requestActivities.sort((left, right) => right.at.localeCompare(left.at));
    const previousDeliveryStatus = requestActivities.some(({ status }) => status === "uncertain")
      ? "uncertain"
      : requestActivities[0]?.status || "";
    const hasPreviousRequest = requestActivities.length > 0;
    const lastSentAt = requestActivities.filter(({ status }) => status === "sent")
      .map(({ sentAt }) => sentAt).filter(Boolean).sort().at(-1) || "";
    const hasAcceptedRequest = requestActivities.some(({ status }) => status === "sent");
    const hasUncertainRequest = requestActivities.some(({ status }) => status === "uncertain");
    let reason = "";
    if (!form) {
      reason = "Choose a form first";
    } else if (recipient?.revokedAt) {
      reason = "Response link revoked";
    } else if (recipient?.respondedAt && audienceType !== "specific") {
      reason = "Already responded";
    } else if (audienceType === "nonresponders" && hasUncertainRequest) {
      reason = "We couldn't confirm whether a previous message was sent. Check message history before sending a reminder.";
    } else if (formTeamIds.size && ![...formTeamIds].some((id) => memberTeamIds.has(id))) {
      reason = "Outside this form’s team scope";
    } else if (!eligibility.eligible) {
      reason = !eligibility.status
        ? "Not eligible to receive text messages"
        : eligibility.status === "no_mobile"
          ? "No mobile number"
          : eligibility.status === "opted_out"
            ? "This phone number opted out"
            : "Text message consent needed";
    }
    return {
      member,
      memberTeamIds,
      recipient,
      eligibility,
      eligible: Boolean(form) && !reason,
      reason,
      previousDeliveryStatus,
      hasPreviousRequest,
      hasAcceptedRequest,
      hasUncertainRequest,
      previousSentAt: lastSentAt,
    };
  });
};
