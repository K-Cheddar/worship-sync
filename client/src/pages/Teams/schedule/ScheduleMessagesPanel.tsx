import type { NotificationIntent, TeamRosterMember } from "../../../api/authTypes";
import Button from "../../../components/Button/Button";
import Drawer from "../../../components/Drawer/Drawer";
import { scheduleMemberName } from "../teamsUtils";
import ScheduleReplacementInvitationForm, { type ScheduleReplacementVacancy } from "./ScheduleReplacementInvitationForm";

type ScheduleMessageCounts = {
  requested: number;
  accepted: number;
  delivered: number;
  failed: number;
  uncertain: number;
  responded: number;
  waiting: number;
  optedOut: number;
};

type ScheduleMessagesPanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  intents: NotificationIntent[];
  members: TeamRosterMember[];
  duplicateFirstNames: Set<string>;
  counts: ScheduleMessageCounts;
  loading: boolean;
  nextCursor: string;
  sendingIntentId: string;
  getVolunteerResponse: (intent: NotificationIntent) => string;
  onSend: (intent: NotificationIntent) => void;
  onCloseInvitation: (intent: NotificationIntent) => void;
  onLoadOlder: () => void;
  replacementVacancies?: ScheduleReplacementVacancy[];
  onPrepareReplacement?: (vacancy: ScheduleReplacementVacancy, memberId: string) => Promise<void>;
};

const deliveryStatusLabel = (intent: NotificationIntent) => {
  const status = intent.attemptStatus || intent.status;
  const wasSent = intent.status === "sent" || ["accepted", "sent", "delivered", "undelivered"].includes(status);
  if (!wasSent && (intent.status === "unknown" || intent.attemptOutcome === "unknown")) {
    return "We couldn't confirm whether this text was sent";
  }
  if (wasSent) {
    const delivery = status === "delivered" ? "Delivered" : status === "undelivered" || status === "failed" ? "Delivery failed" : ["pending", "accepted", "sent"].includes(status) ? "Waiting for delivery confirmation" : "";
    return `Sent${delivery ? ` · ${delivery}` : ""}`;
  }
  if (status === "sending") return "Sending";
  if (status === "failed") return "Failed";
  if (status === "suppressed") return "Not sent";
  if (status === "preview" || status === "ready") return "Ready to send";
  if (status === "pending") return "Waiting for delivery confirmation";
  return status;
};

const ScheduleMessagesPanel = ({
  open,
  onOpenChange,
  intents,
  members,
  duplicateFirstNames,
  counts,
  loading,
  nextCursor,
  sendingIntentId,
  getVolunteerResponse,
  onSend,
  onCloseInvitation,
  onLoadOlder,
  replacementVacancies = [],
  onPrepareReplacement,
}: ScheduleMessagesPanelProps) => (
  <Drawer
    isOpen={open}
    onClose={() => onOpenChange(false)}
    title="Schedule messages"
    position="right"
    size="xl"
    showBackdrop
    className="!max-w-[min(42rem,50vw)] max-sm:!max-w-full"
    contentPadding="p-0"
    contentClassName="scrollbar-variable min-h-0 flex-1 overflow-y-auto p-4 sm:p-5"
  >
    <div className="mb-4 space-y-1">
      <p className="text-sm text-gray-300">
        Assignment text messages stay in draft until you review and send each one.
      </p>
      <div
        className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-400"
        aria-label="Schedule message and response counts"
      >
        <span>Loaded {counts.requested}</span>
        <span>Sent {counts.accepted}</span>
        <span>Delivered {counts.delivered}</span>
        <span>Failed {counts.failed}</span>
        <span>Needs a status check {counts.uncertain}</span>
        <span>Volunteer responses {counts.responded}</span>
        <span>Waiting for a response {counts.waiting}</span>
        <span>Phone numbers opted out {counts.optedOut}</span>
      </div>
    </div>

    {onPrepareReplacement ? <ScheduleReplacementInvitationForm vacancies={replacementVacancies} members={members} duplicateFirstNames={duplicateFirstNames} onPrepare={onPrepareReplacement} /> : null}
    {loading && intents.length === 0 ? (
      <p className="text-sm text-gray-400" role="status">Loading schedule messages…</p>
    ) : intents.length === 0 ? (
      <p className="text-sm text-gray-400">
        No assignment messages for this schedule.
      </p>
    ) : (
      <div className="space-y-2">
        {intents.map((intent) => {
          const member = members.find((item) => item.memberId === intent.memberId);
          const assignmentResponse = intent.intentType === "schedule_initial_notification"
            ? "per assignment"
            : intent.intentType === "replacement_request"
            ? intent.replacementResolvedAt
              ? "invitation closed"
              : "needs a follow-up"
            : getVolunteerResponse(intent);
          const label = intent.intentType === "schedule_initial_notification"
            ? "Schedule text message"
            : intent.intentType === "assignment_notification"
            ? "Assignment text message"
            : intent.intentType === "assignment_confirmation"
              ? "Assignment response message"
              : intent.intentType === "schedule_change"
                ? "Schedule change"
                : "Replacement invitation";
          const actionable = intent.intentType !== "schedule_initial_notification" && ["preview", "ready"].includes(intent.status) && intent.previewEligible !== false;

          return (
            <article key={intent.intentId} className="rounded border border-gray-700 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm text-gray-100">
                    {label} · {member ? scheduleMemberName(member, duplicateFirstNames) : "Roster member"}
                  </p>
                  <p className="text-xs text-gray-400">
                    {deliveryStatusLabel(intent)} · Volunteer: {assignmentResponse}
                  </p>
                </div>
                {actionable ? (
                  <Button
                    variant="secondary"
                    disabled={Boolean(sendingIntentId)}
                    isLoading={sendingIntentId === intent.intentId}
                    onClick={() => onSend(intent)}
                  >
                    Send text message
                  </Button>
                ) : null}
                {intent.intentType === "replacement_request" && !intent.replacementResolvedAt && !["sending", "unknown"].includes(intent.status) ? (
                  <Button
                    variant="textLink"
                    disabled={Boolean(sendingIntentId)}
                    isLoading={sendingIntentId === intent.intentId}
                    onClick={() => onCloseInvitation(intent)}
                  >
                    Close invitation
                  </Button>
                ) : null}
              </div>
              {intent.replacementResolvedAt ? (
                <p className="mt-1 text-xs text-gray-400">Invitation closed · delivery history retained</p>
              ) : null}
              {intent.messagePreview ? (
                <p className="mt-2 break-words text-xs text-gray-300">{intent.messagePreview}</p>
              ) : null}
              {intent.previewError ? (
                <p className="mt-1 text-xs text-amber-200">{intent.previewError}</p>
              ) : null}
              {intent.attemptOutcome === "unknown" ? (
                <p className="mt-1 text-xs text-amber-200">
                  We couldn't confirm whether this text was sent. Check message history before trying again.
                </p>
              ) : null}
              {intent.intentType === "schedule_initial_notification" && ["preview", "ready"].includes(intent.status) ? (
                <p className="mt-1 text-xs text-amber-200">Schedule text messages are not available right now. Check back later.</p>
              ) : null}
            </article>
          );
        })}
        {nextCursor ? (
          <Button
            variant="secondary"
            disabled={loading || Boolean(sendingIntentId)}
            isLoading={loading}
            onClick={onLoadOlder}
          >
            Load older message history
          </Button>
        ) : null}
      </div>
    )}
  </Drawer>
);

export default ScheduleMessagesPanel;
