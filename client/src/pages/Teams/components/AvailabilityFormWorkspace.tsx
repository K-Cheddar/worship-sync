import { useState, type ComponentProps, type ReactNode } from "react";
import { ArrowLeft, MoreHorizontal, Pencil } from "lucide-react";
import Button from "../../../components/Button/Button";
import Modal from "../../../components/Modal/Modal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../components/ui/DropdownMenu";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../../../components/ui/tabs";
import type { AvailabilityProgressRow } from "../availabilityFormProgress";
import { formatPlainDateRangeLabel, memberName } from "../teamsUtils";
import AvailabilityRecipientsTab from "./AvailabilityRecipientsTab";
import AvailabilityResponsesTab from "./AvailabilityResponsesTab";
import AvailabilityFormSendFlow from "./AvailabilityFormSendFlow";

const intentStatusLabels = {
  preview: "Preview · not sent",
  ready: "Prepared · not sent",
  sending: "Sending · check history before retrying",
  sent: "Sent",
  failed: "Failed · check delivery outcome",
  unknown: "Unconfirmed · check history before retrying",
  suppressed: "Not sent",
};
const deliveryStatusLabels = {
  pending: "Waiting for confirmation",
  accepted: "Accepted by provider",
  sent: "Sent",
  delivered: "Delivered",
  undelivered: "Undelivered · resend blocked",
  failed: "Failed",
};

type Props = {
  rows: AvailabilityProgressRow[];
  sendFlowProps: ComponentProps<typeof AvailabilityFormSendFlow>;
  recipientActions: Pick<
    ComponentProps<typeof AvailabilityRecipientsTab>,
    "onCreateLink" | "onCopyLink" | "onOpenLink" | "onRevoke"
  >;
  canEdit: boolean;
  canCopyGeneralLink: boolean;
  linkBusy: boolean;
  serviceTimeZone: string;
  sendOpen: boolean;
  onSend: () => void;
  onEdit: () => void;
  onBack: () => void;
  onCopyGeneralLink: () => Promise<void>;
  onRefresh: () => void;
  refreshing?: boolean;
  refreshError?: string;
  submissionReview?: ReactNode;
};

const AvailabilityFormWorkspace = ({
  rows,
  sendFlowProps,
  recipientActions,
  canEdit,
  canCopyGeneralLink,
  linkBusy,
  serviceTimeZone,
  sendOpen,
  onSend,
  onEdit,
  onBack,
  onCopyGeneralLink,
  onRefresh,
  refreshing,
  refreshError,
  submissionReview,
}: Props) => {
  const [historyMemberId, setHistoryMemberId] = useState("");
  const [copying, setCopying] = useState(false);
  const {
    form,
    teams,
    historyLoaded,
    historyError,
    onRetryHistory,
    notificationIntents,
    smsDeliveryAttempts,
  } = sendFlowProps;
  const historyRow = rows.find(
    (row) => row.member.memberId === historyMemberId,
  );
  const historyRecipient = historyRow?.recipient;
  const intents = notificationIntents.filter(
    (intent) =>
      historyRecipient &&
      intent.recipientId === historyRecipient.recipientId &&
      intent.formId === form.formId,
  );
  const attempts = smsDeliveryAttempts.filter(
    (attempt) =>
      historyRecipient &&
      attempt.recipientId === historyRecipient.recipientId &&
      (!attempt.formId || attempt.formId === form.formId),
  );
  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col rounded-lg bg-gray-900 p-4"
      aria-label={`${form.name} workspace`}
    >
      <div className="mb-3">
        <Button
          variant="textLink"
          svg={ArrowLeft}
          iconSize="sm"
          onClick={onBack}
        >
          All forms
        </Button>
      </div>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-white">
            {form.name}{" "}
            <span className="text-sm font-normal text-gray-400">
              — {form.active ? "Open" : "Closed"}
            </span>
          </h2>
          <p className="mt-1 text-sm text-gray-400">
            {formatPlainDateRangeLabel(form.startDate, form.endDate)} ·{" "}
            {(form.teamIds || [])
              .map((id) => teams.find((team) => team.teamId === id)?.name || id)
              .join(", ") || "All teams"}{" "}
            · {(form.availabilityOccurrences || []).length} service dates
          </p>
        </div>
        {canEdit ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button disabled={!form.active} onClick={onSend}>
              Send requests
            </Button>
            <Button
              variant="secondary"
              svg={Pencil}
              iconSize="sm"
              onClick={onEdit}
            >
              Edit
            </Button>
            {canCopyGeneralLink ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="tertiary"
                    svg={MoreHorizontal}
                    aria-label="More form actions"
                    disabled={copying}
                    isLoading={copying}
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    disabled={!form.active || copying}
                    onSelect={() => {
                      setCopying(true);
                      void onCopyGeneralLink().finally(() => setCopying(false));
                    }}
                  >
                    Copy general form link
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        ) : null}
      </header>
      <div className="mt-4 flex items-center gap-3">
        <Button
          variant="textLink"
          disabled={refreshing}
          isLoading={refreshing}
          onClick={onRefresh}
        >
          Refresh status
        </Button>
        {refreshing ? (
          <span role="status" className="text-sm text-gray-400">
            Refreshing responses…
          </span>
        ) : null}
      </div>
      {refreshError ? (
        <p role="alert" className="mt-2 text-sm text-red-200">
          {refreshError}
        </p>
      ) : null}
      {historyError ? (
        <div
          role="alert"
          className="mt-3 flex flex-wrap items-center gap-3 text-sm text-amber-200"
        >
          <span>{historyError}</span>
          <Button variant="textLink" onClick={onRetryHistory}>
            Retry status check
          </Button>
        </div>
      ) : null}
      <Tabs defaultValue="recipients" className="mt-3 min-h-0 min-w-0">
        <TabsList variant="navigation" aria-label="Availability form details">
          <TabsTrigger value="recipients">Recipients</TabsTrigger>
          <TabsTrigger value="responses">Responses</TabsTrigger>
        </TabsList>
        <TabsContent value="recipients" className="pt-4">
          <AvailabilityRecipientsTab
            rows={rows}
            teams={teams.filter(
              (team) =>
                !(form.teamIds || []).length ||
                form.teamIds?.includes(team.teamId),
            )}
            canEdit={canEdit}
            busy={linkBusy}
            historyLoaded={historyLoaded}
            {...recipientActions}
            onHistory={setHistoryMemberId}
          />
        </TabsContent>
        <TabsContent value="responses" className="min-w-0 pt-4">
          <AvailabilityResponsesTab
            rows={rows.filter((row) => !row.recipient?.revokedAt)}
            form={form}
            serviceTimeZone={serviceTimeZone}
          />
          {submissionReview}
        </TabsContent>
      </Tabs>
      {sendOpen && canEdit && form.active ? (
        <AvailabilityFormSendFlow {...sendFlowProps} dialog />
      ) : null}
      <Modal
        isOpen={Boolean(historyRow)}
        onClose={() => setHistoryMemberId("")}
        title={`Request history${historyRow ? ` · ${memberName(historyRow.member)}` : ""}`}
        size="lg"
      >
        {!historyLoaded ? (
          <p role="status" className="text-sm text-gray-300">
            {historyError || "Loading message history…"}
          </p>
        ) : (
          <div className="space-y-3 text-sm text-gray-300">
            {historyRecipient ? (
              <ul className="space-y-1">
                <li>
                  Personal link created:{" "}
                  {new Date(historyRecipient.createdAt).toLocaleString()}
                </li>
                {historyRecipient.linkCopiedAt ? (
                  <li>
                    Link copied:{" "}
                    {new Date(historyRecipient.linkCopiedAt).toLocaleString()}
                  </li>
                ) : null}
                {historyRecipient.respondedAt ? (
                  <li>
                    Responded:{" "}
                    {new Date(historyRecipient.respondedAt).toLocaleString()}
                  </li>
                ) : null}
                {historyRecipient.revokedAt ? (
                  <li>
                    Revoked:{" "}
                    {new Date(historyRecipient.revokedAt).toLocaleString()}
                  </li>
                ) : null}
              </ul>
            ) : (
              <p>No personal request created yet.</p>
            )}
            {!intents.length && !attempts.length ? (
              <p>No text messages sent yet.</p>
            ) : (
              <>
                <ul className="space-y-2">
                  {intents.map((intent) => (
                    <li key={intent.intentId}>
                      {new Date(
                        intent.updatedAt || intent.createdAt,
                      ).toLocaleString()}{" "}
                      ·{" "}
                      {intent.intentType === "availability_reminder"
                        ? "Reminder"
                        : "Request"}{" "}
                      ·{" "}
                      {intentStatusLabels[intent.status]}
                    </li>
                  ))}
                </ul>
                <ul className="space-y-2">
                  {attempts.map((attempt) => (
                    <li key={attempt.attemptId}>
                      {new Date(attempt.createdAt).toLocaleString()} · Delivery:{" "}
                      {attempt.outcome === "unknown" || (attempt.status === "failed" && !attempt.outcome)
                        ? "Unconfirmed · check history before retrying"
                        : deliveryStatusLabels[attempt.status]}
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-gray-400">
                  Accepted and unconfirmed sends remain blocked. Review advanced
                  delivery details in Messages.
                </p>
              </>
            )}
          </div>
        )}
      </Modal>
    </section>
  );
};

export default AvailabilityFormWorkspace;
