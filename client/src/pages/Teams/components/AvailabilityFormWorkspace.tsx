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
import type { AvailabilityProgressRow } from "../availabilityFormProgress";
import { formatPlainDateRangeLabel, memberName } from "../teamsUtils";
import AvailabilityVolunteersList from "./AvailabilityVolunteersList";
import AvailabilityDateComparison from "./AvailabilityDateComparison";
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
    ComponentProps<typeof AvailabilityVolunteersList>,
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
  const [resendMemberId, setResendMemberId] = useState("");
  const [copying, setCopying] = useState(false);
  const [comparisonOpen, setComparisonOpen] = useState(false);
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
  const responded = rows.filter((row) => row.status === "Responded").length;
  const awaiting = rows.filter(
    (row) => row.status === "Awaiting response",
  ).length;
  const notInvited = rows.filter((row) =>
    ["Not requested", "Revoked"].includes(row.status),
  ).length;
  const completion = rows.length
    ? Math.round((responded / rows.length) * 100)
    : 0;
  const openNewSend = () => {
    setResendMemberId("");
    onSend();
  };
  const openResend = (memberId: string) => {
    setResendMemberId(memberId);
    onSend();
  };
  const closeSend = () => {
    setResendMemberId("");
    sendFlowProps.onClose();
  };
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
            <Button variant="cta" disabled={!form.active} onClick={openNewSend}>
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
      <section
        className="mt-4 rounded-md bg-gray-950/50 px-3 py-3"
        aria-label="Response progress"
        aria-busy={refreshing || !historyLoaded}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <dl className="grid flex-1 grid-cols-3 gap-3 sm:max-w-lg sm:gap-8">
            <div>
              <dt className="text-xs text-gray-400">Responded</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums text-emerald-300">
                {responded}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-400">Awaiting response</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums text-white">
                {historyLoaded ? awaiting : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-400">Not invited</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums text-gray-200">
                {historyLoaded ? notInvited : "—"}
              </dd>
            </div>
          </dl>
          <Button
            variant="textLink"
            disabled={refreshing}
            isLoading={refreshing}
            onClick={onRefresh}
          >
            Refresh status
          </Button>
        </div>
        <div
          className="mt-3 h-2 overflow-hidden rounded-full bg-gray-700"
          role="progressbar"
          aria-label="Availability response completion"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={completion}
          aria-valuetext={`${responded} of ${rows.length} responded`}
        >
          <div
            className="h-full rounded-full bg-cyan-500 transition-[width] motion-reduce:transition-none"
            style={{ width: `${completion}%` }}
          />
        </div>
        <p className="mt-1.5 text-xs text-gray-400" aria-live="polite">
          {responded} of {rows.length} responded
          {refreshing ? " · Refreshing…" : ""}
          {!historyLoaded ? <span aria-hidden="true" className="ml-2 inline-block h-3 w-28 animate-pulse rounded bg-white/10 align-middle" /> : null}
        </p>
      </section>
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
      <AvailabilityVolunteersList
        rows={rows}
        form={form}
        teams={teams.filter(
          (team) =>
            !(form.teamIds || []).length ||
            form.teamIds?.includes(team.teamId),
        )}
        canEdit={canEdit}
        busy={linkBusy}
        historyLoaded={historyLoaded}
        historyError={historyError}
        serviceTimeZone={serviceTimeZone}
        {...recipientActions}
        onResendLink={openResend}
        onHistory={setHistoryMemberId}
        onViewAvailability={() => setComparisonOpen(true)}
      />
      {submissionReview}
      <AvailabilityDateComparison
        rows={rows}
        form={form}
        teams={teams.filter(
          (team) =>
            !(form.teamIds || []).length ||
            form.teamIds?.includes(team.teamId),
        )}
        serviceTimeZone={serviceTimeZone}
        isOpen={comparisonOpen}
        onClose={() => setComparisonOpen(false)}
      />
      {sendOpen && canEdit && form.active ? (
        <AvailabilityFormSendFlow
          {...sendFlowProps}
          dialog
          initialAudience={resendMemberId ? "specific" : "not_contacted"}
          initialMemberIds={resendMemberId ? [resendMemberId] : []}
          onClose={closeSend}
        />
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
                      · {intentStatusLabels[intent.status]}
                    </li>
                  ))}
                </ul>
                <ul className="space-y-2">
                  {attempts.map((attempt) => (
                    <li key={attempt.attemptId}>
                      {new Date(attempt.createdAt).toLocaleString()} · Delivery:{" "}
                      {attempt.outcome === "unknown" ||
                      (attempt.status === "failed" && !attempt.outcome)
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
