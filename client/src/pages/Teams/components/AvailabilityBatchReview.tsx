import type { NotificationBatch, NotificationBatchRecipient } from "../../../api/authTypes";
import Button from "../../../components/Button/Button";
import { MemberNameWithIndicator } from "./CurrentUserMemberIndicator";

type AvailabilityBatchReviewProps = {
  batch: NotificationBatch;
  formName: string;
  busy: boolean;
  privacySafe?: boolean;
  readinessMessage?: string;
  mode?: "panel" | "status" | "confirmation";
  onConfirm?: () => void;
};

const recipientStatusLabel = (recipient: NotificationBatchRecipient, batchStatus: NotificationBatch["status"]) => {
  if (recipient.status === "sent") return "Sent";
  if (recipient.status === "failed") return "Failed";
  if (recipient.status === "unknown" || recipient.attemptOutcome === "unknown") return "Could not confirm whether this was sent";
  if (recipient.status === "sending") return "Sending";
  if (recipient.eligible && ["approved", "dispatching"].includes(batchStatus)) return "Waiting to send";
  return recipient.eligible ? "Ready to send" : "Not included";
};

const plainExclusionReason = (reason: string) => {
  const normalized = reason.trim();
  if (!normalized) return "";
  if (/SMS consent is needed/i.test(normalized)) return "Text message consent is needed.";
  if (/not eligible for SMS/i.test(normalized)) return "Not eligible to receive text messages.";
  if (/no valid mobile number/i.test(normalized)) return "No valid phone number.";
  if (/already (?:received|sent)|already has a request/i.test(normalized)) return "A message was already sent.";
  if (/form response already received|already responded/i.test(normalized)) return "Already responded to this form.";
  if (/provider outcome.*uncertain|could not confirm/i.test(normalized)) return "We couldn't confirm whether this text was sent. Check message history before trying again.";
  if (/outside this form/i.test(normalized)) return "Not part of this form's teams.";
  if (/no individual intake request exists/i.test(normalized)) return "No request exists for this volunteer yet.";
  if (/request was revoked/i.test(normalized)) return "This request is no longer active.";
  if (/no longer active on this roster/i.test(normalized)) return "This volunteer is no longer active on the team.";
  if (/guests do not have roster SMS eligibility/i.test(normalized)) return "This person isn't on the volunteer roster.";
  if (/not linked to an active roster member/i.test(normalized)) return "This person isn't linked to an active volunteer.";
  if (/archived roster members cannot receive schedule SMS/i.test(normalized)) return "This volunteer is no longer active on the roster.";
  if (/no current assignment belongs/i.test(normalized)) return "This volunteer isn't assigned to this team's schedule.";
  if (/fresh preview/i.test(normalized)) return "Review this message again before sending.";
  return normalized.replace(/\bSMS\b/gi, "text message");
};

const AvailabilityBatchReview = ({
  batch,
  formName,
  busy,
  privacySafe = false,
  readinessMessage = "",
  mode = "panel",
  onConfirm,
}: AvailabilityBatchReviewProps) => {
  const canSend = mode === "panel" && ["prepared", "partial"].includes(batch.status) && batch.recipients.some(({ eligible }) => eligible);
  const destinationCounts = new Map<string, number>();
  batch.recipients.forEach(({ phoneNumberSnapshot }) => {
    if (phoneNumberSnapshot) destinationCounts.set(phoneNumberSnapshot, (destinationCounts.get(phoneNumberSnapshot) || 0) + 1);
  });
  const excludedRecipients = batch.recipients.filter(({ eligible }) => !eligible);
  const preparedBatchProgressMessage = batch.summary.sent || batch.summary.delivered
    ? `${batch.summary.sent} message${batch.summary.sent === 1 ? " has" : "s have"} already been sent. Delivery updates are shown separately.`
    : batch.summary.failed || batch.summary.uncertain
      ? "Some messages already have a result. Check message history before trying again."
      : "Messages are ready to review. Nothing has been sent.";
  const progressMessageByStatus: Partial<Record<NotificationBatch["status"], string>> = {
    prepared: preparedBatchProgressMessage,
    approved: "Messages are waiting to send.",
    dispatching: "Messages are sending. Progress saves automatically. You can close this panel.",
    paused: "Sending is paused because access changed. Review and send the remaining messages to continue.",
    complete: "All selected messages have been processed.",
    sent: "Your messages were sent. Delivery updates may take a moment.",
    partial: "Some messages failed or we could not confirm whether they were sent. Check message history before trying again.",
  };
  const progressMessage = progressMessageByStatus[batch.status] || "";
  const reviewDescription = ["approved", "dispatching", "complete", "partial", "paused", "sent"].includes(batch.status)
    ? "Each message includes that volunteer's private response link. Delivery updates are shown separately."
    : "Each message includes that volunteer's private response link. Nothing sends until you confirm.";

  const renderRecipient = (recipient: NotificationBatchRecipient, showStatus: boolean) => {
    const phoneNumber = privacySafe
      ? recipient.maskedPhoneNumber || "Contact hidden"
      : recipient.phoneNumberSnapshot || recipient.maskedPhoneNumber || "No valid phone number";
    const sharedDestinationCount = recipient.phoneNumberSnapshot ? destinationCounts.get(recipient.phoneNumberSnapshot) || 0 : 0;
    const attemptLabel = recipient.attemptStatus === "delivered"
      ? "Delivered"
      : recipient.attemptStatus === "failed" || recipient.attemptStatus === "undelivered"
        ? "Delivery failed"
        : recipient.attemptStatus === "pending" || recipient.attemptStatus === "accepted" || recipient.attemptStatus === "sent" || recipient.status === "sent"
          ? "Waiting for delivery confirmation"
          : "";
    const statusLabel = recipientStatusLabel(recipient, batch.status);

    return (
      <li key={recipient.memberId} className="space-y-1 py-3">
        <div className="flex flex-wrap justify-between gap-2 text-sm">
          <MemberNameWithIndicator
            name={recipient.memberName}
            memberId={recipient.memberId}
            className="font-medium text-white"
          />
          <span className="text-gray-300">
            {phoneNumber}
            {showStatus ? ` · ${statusLabel}${attemptLabel ? ` · ${attemptLabel}` : ""}` : ""}
          </span>
        </div>
        {sharedDestinationCount > 1 ? <p className="text-xs text-sky-200">Shared phone number · each volunteer gets a separate private message.</p> : null}
        {recipient.segmentCount > 1 ? <p className="text-xs text-gray-300">This longer message counts as {recipient.segmentCount} texts.</p> : null}
        {recipient.message ? <details open={mode === "confirmation" && batch.summary.eligible === 1} className="rounded bg-gray-950 px-3 py-2 text-sm text-gray-200"><summary className="cursor-pointer">View message</summary><p className="mt-2 whitespace-pre-wrap break-words">{recipient.message}</p><p className="mt-2 text-xs text-gray-400">{recipient.message.length} characters · {recipient.segmentCount} text segment{recipient.segmentCount === 1 ? "" : "s"}</p></details> : null}
        {!recipient.eligible && recipient.exclusionReason ? <p className="text-sm text-amber-200">Not included: {plainExclusionReason(recipient.exclusionReason)}</p> : null}
        {!recipient.eligible && recipient.status === "failed" && !recipient.exclusionReason ? <p className="text-sm text-amber-200">This message failed. Review message history before preparing a retry.</p> : null}
        {!recipient.eligible && (recipient.status === "unknown" || recipient.attemptOutcome === "unknown") ? <p className="text-sm text-amber-200">We couldn't confirm whether this text was sent. Check message history before trying again.</p> : null}
      </li>
    );
  };

  if (mode === "confirmation") {
    const eligibleRecipients = batch.recipients.filter(({ eligible }) => eligible);
    return (
      <div className="space-y-4 text-sm text-gray-200">
        <div>
          <h2 className="font-semibold text-white">{formName}</h2>
          <p className="mt-1">{batch.summary.eligible} volunteer{batch.summary.eligible === 1 ? " will" : "s will"} receive a text message.</p>
          {batch.summary.eligible > 1 ? <p className="mt-1 text-gray-300">Estimated texts: {batch.summary.totalSegments}.</p> : null}
          {batch.summary.eligible > 1 && batch.summary.totalSegments > batch.summary.eligible ? <p className="mt-1 text-xs text-gray-400">Long messages can count as more than one text.</p> : null}
        </div>
        {excludedRecipients.length ? (
          <div role="alert" className="rounded border border-amber-700 bg-amber-950/30 p-3 text-amber-100">
            <p className="font-medium">{excludedRecipients.length} selected volunteer{excludedRecipients.length === 1 ? " won't" : "s won't"} receive a new message.</p>
            <details className="mt-2"><summary className="cursor-pointer text-xs">View excluded volunteers</summary><ul className="mt-2 max-h-40 divide-y divide-amber-900 overflow-y-auto">
              {excludedRecipients.map((recipient) => (
                <li key={recipient.memberId} className="py-2">
                  <MemberNameWithIndicator
                    name={recipient.memberName}
                    memberId={recipient.memberId}
                    className="font-medium"
                  />
                  {recipient.exclusionReason ? <span>: {plainExclusionReason(recipient.exclusionReason)}</span> : null}
                </li>
              ))}
            </ul></details>
          </div>
        ) : null}
        {eligibleRecipients.length ? (
          <section aria-label="Messages to send">
            <h3 className="font-medium text-white">Messages to send ({eligibleRecipients.length})</h3>
            <ul className="mt-1 max-h-[45vh] divide-y divide-gray-700 overflow-y-auto rounded border border-gray-700 px-3">
              {eligibleRecipients.map((recipient) => renderRecipient(recipient, false))}
            </ul>
          </section>
        ) : <p role="status" className="rounded border border-amber-700 bg-amber-950/30 p-3 text-amber-100">No volunteers are ready to receive a text message. Review the reasons above.</p>}
        <p className="text-xs text-gray-400">Choose Send only after reviewing these text messages.</p>
      </div>
    );
  }

  const sendButton = canSend ? (
    <Button disabled={busy || Boolean(readinessMessage)} onClick={onConfirm}>
      {readinessMessage ? "Sending unavailable" : `Send ${batch.summary.eligible} message${batch.summary.eligible === 1 ? "" : "s"}`}
    </Button>
  ) : null;
  const statusCounts = [
    ["Waiting to send", batch.summary.awaitingExecution ?? batch.summary.awaitingDispatch],
    ["Sending", batch.summary.sending || 0],
    ["Sent", batch.summary.sent],
    ["Delivered", batch.summary.delivered],
    ["Failed", batch.summary.failed],
    ["Could not confirm", batch.summary.uncertain],
    ["Not included", batch.summary.excluded],
  ] as const;
  const statusSummary = statusCounts
    .filter(([, count]) => count > 0)
    .map(([label, count]) => label === "Could not confirm"
      ? `${count} message${count === 1 ? "" : "s"} could not be confirmed`
      : `${count} ${label.toLocaleLowerCase()}`)
    .join(" · ");

  return (
    <section className="space-y-3 rounded-lg border border-sky-700 bg-gray-900/60 p-4" aria-labelledby="batch-review-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="batch-review-heading" className="font-semibold text-white">{mode === "status" ? `Message status · ${formName}` : `Review messages · ${formName}`}</h2>
          <p className="text-sm text-gray-300">{batch.summary.selected} selected · {statusSummary}{mode !== "status" && batch.summary.totalSegments > 0 ? ` · Estimated texts: ${batch.summary.totalSegments}` : ""}</p>
          <p className="text-xs text-gray-400">{reviewDescription}</p>
        </div>
        {sendButton}
      </div>
      <ul className="divide-y divide-gray-800">
        {batch.recipients.map((recipient) => renderRecipient(recipient, true))}
      </ul>
      {progressMessage ? <p role="status" className="rounded border border-gray-700 bg-gray-950/40 p-3 text-sm text-gray-200">{progressMessage}</p> : null}
      {readinessMessage ? <p role="status" className="rounded border border-amber-700 bg-amber-950/30 p-3 text-sm text-amber-100">{readinessMessage}</p> : null}
      {batch.summary.responded !== undefined || batch.summary.waiting !== undefined ? (
        <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          {batch.summary.sent > 0 ? <div><dt className="text-gray-400">Sent</dt><dd className="text-white">{batch.summary.sent}</dd></div> : null}
          <div><dt className="text-gray-400">Delivered</dt><dd className="text-white">{batch.summary.delivered}</dd></div>
          {batch.summary.responded !== undefined ? <div><dt className="text-gray-400">Responded</dt><dd className="text-white">{batch.summary.responded}</dd></div> : null}
          {batch.summary.waiting !== undefined ? <div><dt className="text-gray-400">Waiting for a response</dt><dd className="text-white">{batch.summary.waiting}</dd></div> : null}
        </dl>
      ) : null}
      {batch.summary.failed || batch.summary.uncertain || (!privacySafe && batch.summary.optedOut) ? (
        <p className="text-sm text-amber-200">
          {[batch.summary.failed ? `${batch.summary.failed} failed` : "", batch.summary.uncertain ? `${batch.summary.uncertain} could not be confirmed` : "", !privacySafe && batch.summary.optedOut ? `${batch.summary.optedOut} phone ${batch.summary.optedOut === 1 ? "number" : "numbers"} opted out` : ""].filter(Boolean).join(" · ")}
        </p>
      ) : null}
    </section>
  );
};

export default AvailabilityBatchReview;
