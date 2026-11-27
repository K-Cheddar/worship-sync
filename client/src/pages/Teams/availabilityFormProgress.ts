import type {
  TeamAvailabilityResponse,
  TeamIntakeSubmission,
} from "../../api/authTypes";
import { getAvailabilityRecipientRows } from "./availabilityRecipientSelection";

export const getAvailabilityFormProgress = (
  input: Parameters<typeof getAvailabilityRecipientRows>[0],
  responses: TeamAvailabilityResponse[],
  submissions: TeamIntakeSubmission[],
) =>
  getAvailabilityRecipientRows(input).map((row) => {
    const { recipient, previousDeliveryStatus } = row;
    const personalResponse = recipient?.revokedAt ? undefined : responses.find(
      (item) =>
        item.formId === input.form?.formId &&
        item.source !== "general" &&
        item.recipientId === recipient?.recipientId &&
        item.memberId === row.member.memberId &&
        Boolean(recipient?.respondedAt) &&
        item.respondedAt === recipient?.respondedAt,
    );
    const personalSubmission = !recipient?.revokedAt && recipient?.submissionId
      ? submissions.find(
          (item) =>
            item.formId === input.form?.formId &&
            item.submissionId === recipient.submissionId,
        )
      : undefined;
    const generalResponses = responses.filter(
      (item) =>
        item.formId === input.form?.formId &&
        item.source === "general" &&
        item.memberId === row.member.memberId,
    );
    const personalSubmissionIds = new Set(
      input.recipients
        .filter((item) => item.formId === input.form?.formId)
        .map((item) => item.submissionId)
        .filter(Boolean),
    );
    const generalSubmissions = submissions.filter(
      (item) =>
        item.formId === input.form?.formId &&
        item.status === "applied" &&
        item.appliedMemberId === row.member.memberId &&
        !item.appliedMemberCreated &&
        !personalSubmissionIds.has(item.submissionId),
    );
    const responseConflict = Boolean(
      ((personalResponse || personalSubmission) &&
        (generalResponses.length || generalSubmissions.length)) ||
        generalResponses.length + generalSubmissions.length > 1,
    );
    const generalResponse = generalResponses[0];
    const generalSubmission = generalSubmissions[0];
    const response = personalResponse || generalResponse;
    const submission = personalSubmission || generalSubmission;
    const responded = Boolean(
      (!recipient?.revokedAt && (recipient?.respondedAt || personalResponse || personalSubmission)) ||
        generalResponse ||
        generalSubmission,
    );
    const requested =
      !recipient?.revokedAt &&
      (Boolean(recipient?.linkCopiedAt) ||
        ["sent", "uncertain"].includes(previousDeliveryStatus));
    let status = "Not requested";
    if (recipient?.revokedAt && !generalResponse && !generalSubmission) status = "Revoked";
    else if (responseConflict) status = "Review conflict";
    else if (responded) status = "Responded";
    else if (requested) status = "Awaiting response";
    const attempts =
      input.smsDeliveryAttempts?.filter(
        (attempt) =>
          attempt.recipientId === recipient?.recipientId &&
          (!attempt.formId || attempt.formId === input.form?.formId),
      ) || [];
    const latestAttempt = [...attempts].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    )[0];
    const intents =
      input.notificationIntents?.filter(
        (intent) =>
          intent.formId === input.form?.formId &&
          intent.recipientId === recipient?.recipientId,
      ) || [];
    const latestIntent = [...intents].sort((a, b) =>
      (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt),
    )[0];
    const deliveryStatus = latestAttempt?.status || latestIntent?.attemptStatus;
    let delivery = "—";
    if (deliveryStatus === "delivered") delivery = "Delivered";
    else if (deliveryStatus === "undelivered")
      delivery = "Undelivered · resend blocked";
    else if (previousDeliveryStatus === "uncertain")
      delivery = "Unconfirmed · check history";
    else if (previousDeliveryStatus === "failed")
      delivery = "Failed · retry available";
    else if (
      ["accepted", "sent"].includes(deliveryStatus || "") ||
      previousDeliveryStatus === "sent"
    )
      delivery = "Sent";
    else if (latestIntent?.status === "sending" || deliveryStatus === "pending")
      delivery = "Pending confirmation";
    else if (latestIntent?.status === "ready") delivery = "Prepared · not sent";
    else if (latestIntent?.status === "suppressed") delivery = "Not sent";
    return {
      ...row,
      responded,
      status,
      delivery,
      responseConflict,
      hasResponseDetails: !responseConflict && Boolean(response || submission),
      availabilitySource: responseConflict
        ? undefined
        : generalResponse || generalSubmission
          ? "general"
          : response || submission
            ? "personalized"
            : undefined,
      occurrenceAvailability: responseConflict
        ? {}
        : response?.occurrenceAvailability || submission?.occurrenceAvailability || {},
    };
  });

export type AvailabilityProgressRow = ReturnType<
  typeof getAvailabilityFormProgress
>[number];

export const summarizeAvailabilityAnswers = (
  answers: Record<string, "available" | "unavailable">,
  occurrenceIds: string[],
) => {
  const available = occurrenceIds.filter(
    (occurrenceId) => answers[occurrenceId] === "available",
  ).length;
  const unavailable = occurrenceIds.filter(
    (occurrenceId) => answers[occurrenceId] === "unavailable",
  ).length;
  return {
    available,
    unavailable,
    answered: available + unavailable,
    total: occurrenceIds.length,
  };
};
