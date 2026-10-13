import Button from "../../../components/Button/Button";
import type { NotificationBatch } from "../../../api/authTypes";

const AvailabilityBatchReview = ({
  batch,
  formName,
  busy,
  privacySafe = false,
  readinessMessage = "",
  onConfirm,
}: {
  batch: NotificationBatch;
  formName: string;
  busy: boolean;
  privacySafe?: boolean;
  readinessMessage?: string;
  onConfirm?: () => void;
}) => {
  const canSend = ["prepared", "partial"].includes(batch.status) && batch.recipients.some(({ eligible }) => eligible);
  const destinationCounts = new Map<string, number>();
  batch.recipients.forEach(({ phoneNumberSnapshot }) => {
    if (phoneNumberSnapshot) destinationCounts.set(phoneNumberSnapshot, (destinationCounts.get(phoneNumberSnapshot) || 0) + 1);
  });
  const progressMessageByStatus: Record<string, string> = {
    approved: "Approved. Waiting for sending to start.",
    dispatching: "Sending progress saves automatically. You can close this panel.",
    paused: "Sending paused because Team management access changed. Review and approve the remaining messages again to continue.",
    complete: "All approved recipients have been processed.",
    partial: "Some messages failed or have an uncertain provider outcome. Review each result before preparing another send.",
  };
  const progressMessage = progressMessageByStatus[batch.status] || "";
  const reviewDescription = ["approved", "dispatching", "complete", "partial", "paused"].includes(batch.status)
    ? "Approved messages include each member’s private response link. Delivery progress is saved with the batch."
    : "Each message includes that member’s private response link. Nothing sends until you confirm.";
  return (
    <section className="space-y-3 rounded-lg border border-sky-700 bg-gray-900/60 p-4" aria-labelledby="batch-review-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="batch-review-heading" className="font-semibold text-white">Review messages · {formName}</h2>
          <p className="text-sm text-gray-300">{batch.summary.selected} selected · {batch.summary.awaitingExecution ?? batch.summary.awaitingDispatch} awaiting execution · {batch.summary.sending || 0} sending · {batch.summary.sent} accepted by provider · {batch.summary.delivered} delivered · {batch.summary.failed} failed · {batch.summary.uncertain} uncertain · {batch.summary.excluded} excluded · {batch.summary.totalSegments} expected SMS segments</p>
          <p className="text-xs text-gray-400">{reviewDescription}</p>
        </div>
        {canSend ? <Button disabled={busy || Boolean(readinessMessage)} onClick={onConfirm}>{readinessMessage ? "Sending unavailable" : `Send ${batch.summary.eligible} message${batch.summary.eligible === 1 ? "" : "s"}`}</Button> : null}
      </div>
      <ul className="divide-y divide-gray-800">
        {batch.recipients.map((recipient) => {
          let statusLabel = `${recipient.segmentCount} SMS segment${recipient.segmentCount === 1 ? "" : "s"} · Ready to send`;
          if (!recipient.eligible) {
            statusLabel = privacySafe ? "Not eligible" : recipient.eligibilityStatus || "Not eligible";
          }
          if (recipient.status === "sent") statusLabel = "Accepted by provider";
          else if (recipient.status === "failed") statusLabel = "Failed";
          else if (recipient.status === "unknown") statusLabel = "Uncertain";
          else if (recipient.status === "sending") statusLabel = "Sending";
          else if (recipient.eligible && ["approved", "dispatching"].includes(batch.status)) statusLabel = "Awaiting execution";
          const attemptLabel = recipient.attemptStatus === "delivered"
            ? "Delivered"
            : recipient.attemptStatus === "failed" || recipient.attemptStatus === "undelivered"
              ? "Delivery failed"
              : recipient.attemptStatus === "pending"
                ? "Delivery pending"
                : "";
          return (
          <li key={recipient.memberId} className="space-y-1 py-3">
            <div className="flex flex-wrap justify-between gap-2 text-sm">
              <span className="font-medium text-white">{recipient.memberName}</span>
              <span className="text-gray-300">{privacySafe ? recipient.maskedPhoneNumber || "Contact hidden" : recipient.phoneNumberSnapshot || recipient.maskedPhoneNumber || "No mobile"} · {statusLabel}{attemptLabel ? ` · ${attemptLabel}` : ""}{recipient.attemptOutcome === "unknown" && recipient.status !== "unknown" ? " · Uncertain" : ""}</span>
            </div>
            {recipient.phoneNumberSnapshot && (destinationCounts.get(recipient.phoneNumberSnapshot) || 0) > 1 ? <p className="text-xs text-sky-200">Shared destination · {destinationCounts.get(recipient.phoneNumberSnapshot)} members receive separate private links.</p> : null}
            {recipient.message ? <details className="rounded bg-gray-950 px-3 py-2 text-sm text-gray-200"><summary className="cursor-pointer">View message</summary><p className="mt-2 break-words">{recipient.message}</p></details> : null}
            {!recipient.eligible && recipient.exclusionReason ? <p className="text-sm text-amber-200">Excluded: {recipient.exclusionReason}</p> : null}
            {!recipient.eligible && recipient.status === "failed" && !recipient.exclusionReason ? <p className="text-sm text-amber-200">The provider rejected this message. Review the delivery history before preparing another send.</p> : null}
            {!recipient.eligible && recipient.status === "unknown" ? <p className="text-sm text-amber-200">Check SMS history before taking further action. This message will not be retried automatically.</p> : null}
          </li>
          );
        })}
      </ul>
      {progressMessage ? <p role="status" className="rounded border border-gray-700 bg-gray-950/40 p-3 text-sm text-gray-200">{progressMessage}</p> : null}
      {readinessMessage ? <p role="status" className="rounded border border-amber-700 bg-amber-950/30 p-3 text-sm text-amber-100">{readinessMessage}</p> : null}
      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div><dt className="text-gray-400">Accepted by provider</dt><dd className="text-white">{batch.summary.sent}</dd></div>
        <div><dt className="text-gray-400">Delivered</dt><dd className="text-white">{batch.summary.delivered}</dd></div>
        {batch.summary.responded !== undefined ? <div><dt className="text-gray-400">Responded</dt><dd className="text-white">{batch.summary.responded}</dd></div> : null}
        {batch.summary.waiting !== undefined ? <div><dt className="text-gray-400">Waiting</dt><dd className="text-white">{batch.summary.waiting}</dd></div> : null}
      </dl>
      {batch.summary.failed || batch.summary.uncertain || (!privacySafe && batch.summary.optedOut) ? (
        <p className="text-sm text-amber-200">
          {[batch.summary.failed ? `${batch.summary.failed} failed` : "", batch.summary.uncertain ? `${batch.summary.uncertain} uncertain` : "", !privacySafe && batch.summary.optedOut ? `${batch.summary.optedOut} opted out` : ""].filter(Boolean).join(" · ")}
        </p>
      ) : null}
    </section>
  );
};

export default AvailabilityBatchReview;
