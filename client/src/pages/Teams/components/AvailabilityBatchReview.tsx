import Button from "../../../components/Button/Button";
import type { NotificationBatch } from "../../../api/authTypes";

const AvailabilityBatchReview = ({
  batch,
  formName,
  busy,
  privacySafe = false,
  onConfirm,
}: {
  batch: NotificationBatch;
  formName: string;
  busy: boolean;
  privacySafe?: boolean;
  onConfirm: () => void;
}) => {
  const canSend = ["prepared", "partial"].includes(batch.status) && batch.recipients.some(({ eligible }) => eligible);
  const destinationCounts = new Map<string, number>();
  batch.recipients.forEach(({ phoneNumberSnapshot }) => {
    if (phoneNumberSnapshot) destinationCounts.set(phoneNumberSnapshot, (destinationCounts.get(phoneNumberSnapshot) || 0) + 1);
  });
  return (
    <section className="space-y-3 rounded-lg border border-sky-700 bg-gray-900/60 p-4" aria-labelledby="batch-review-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="batch-review-heading" className="font-semibold text-white">Review messages · {formName}</h2>
          <p className="text-sm text-gray-300">{batch.summary.selected} selected · {batch.summary.eligible} eligible · {batch.summary.excluded} excluded · {batch.summary.totalSegments} expected SMS segments</p>
          <p className="text-xs text-gray-400">Each message includes that member’s private response link. Nothing sends until you confirm.</p>
        </div>
        {canSend ? <Button disabled={busy} onClick={onConfirm}>Send {batch.summary.eligible} message{batch.summary.eligible === 1 ? "" : "s"}</Button> : null}
      </div>
      <ul className="divide-y divide-gray-800">
        {batch.recipients.map((recipient) => {
          const statusLabel = recipient.status === "sent"
            ? "Accepted by provider"
            : recipient.status === "failed"
              ? "Failed"
              : recipient.status === "unknown"
                ? "Uncertain"
                : recipient.status === "sending"
                  ? "Sending"
                  : recipient.eligible
                    ? `${recipient.segmentCount} SMS segment${recipient.segmentCount === 1 ? "" : "s"} · Ready to send`
                    : privacySafe
                      ? "Not eligible"
                      : recipient.eligibilityStatus || "Not eligible";
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
      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div><dt className="text-gray-400">Accepted by provider</dt><dd className="text-white">{batch.summary.sent}</dd></div>
        <div><dt className="text-gray-400">Delivered</dt><dd className="text-white">{batch.summary.delivered}</dd></div>
        <div><dt className="text-gray-400">Responded</dt><dd className="text-white">{batch.summary.responded}</dd></div>
        <div><dt className="text-gray-400">Waiting</dt><dd className="text-white">{batch.summary.waiting}</dd></div>
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
