import type { NotificationIntent, TeamRosterMember } from "../../../api/authTypes";
import Button from "../../../components/Button/Button";
import Drawer from "../../../components/Drawer/Drawer";
import { scheduleMemberName } from "../teamsUtils";

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
        Assignment SMS stays in draft until you review and send each message.
      </p>
      <div
        className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-400"
        aria-label="Schedule message and response counts"
      >
        <span>Loaded {counts.requested}</span>
        <span>Provider accepted {counts.accepted}</span>
        <span>Delivered {counts.delivered}</span>
        <span>Failed {counts.failed}</span>
        <span>Uncertain {counts.uncertain}</span>
        <span>Volunteer responses {counts.responded}</span>
        <span>Waiting {counts.waiting}</span>
        <span>Opted out {counts.optedOut}</span>
      </div>
    </div>

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
          const assignmentResponse = intent.intentType === "replacement_request"
            ? intent.replacementResolvedAt
              ? "invitation closed"
              : "awaiting manual follow-up"
            : getVolunteerResponse(intent);
          const label = intent.intentType === "assignment_notification"
            ? "Assignment notification"
            : intent.intentType === "assignment_confirmation"
              ? "Assignment response"
              : intent.intentType === "schedule_change"
                ? "Schedule change"
                : "Replacement invitation";
          const actionable = ["preview", "ready"].includes(intent.status) && intent.previewEligible !== false;

          return (
            <article key={intent.intentId} className="rounded border border-gray-700 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm text-gray-100">
                    {label} · {member ? scheduleMemberName(member, duplicateFirstNames) : "Roster member"}
                  </p>
                  <p className="text-xs text-gray-400">
                    Delivery: {intent.attemptStatus || intent.status} · Volunteer: {assignmentResponse}
                  </p>
                </div>
                {actionable ? (
                  <Button
                    variant="secondary"
                    disabled={Boolean(sendingIntentId)}
                    isLoading={sendingIntentId === intent.intentId}
                    onClick={() => onSend(intent)}
                  >
                    Send one SMS
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
                  Provider outcome uncertain. Check SMS delivery history before any further action.
                </p>
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
