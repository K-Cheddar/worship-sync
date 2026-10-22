import { useState } from "react";
import { Check, ChevronDown, CircleMinus, MoreHorizontal, X } from "lucide-react";
import Button from "../../../components/Button/Button";
import Input from "../../../components/Input/Input";
import Select from "../../../components/Select/Select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../components/ui/DropdownMenu";
import type { TeamIntakeForm, TeamIntakeRecipient, TeamRecord } from "../../../api/authTypes";
import {
  summarizeAvailabilityAnswers,
  type AvailabilityProgressRow,
} from "../availabilityFormProgress";
import {
  formatPlainDateRangeLabel,
  formatShortOccurrenceDate,
  memberName,
} from "../teamsUtils";
import { MemberNameWithIndicator } from "./CurrentUserMemberIndicator";

const PAGE_SIZE = 50;

const requestTone: Record<string, string> = {
  Responded: "font-medium text-emerald-300",
  "Awaiting response": "text-gray-200",
  "Not requested": "text-gray-400",
  Revoked: "text-rose-300",
};

const deliveryTone = (delivery: string) => {
  if (/Failed|Unconfirmed|Undelivered|Pending confirmation/.test(delivery))
    return "text-amber-300";
  if (delivery === "Delivered") return "text-emerald-300";
  if (delivery === "Sent") return "text-sky-300";
  return "text-gray-400";
};

const isDeliveryFailed = (row: AvailabilityProgressRow) =>
  row.delivery.startsWith("Failed") || row.delivery.startsWith("Undelivered");
const isDeliveryUncertain = (row: AvailabilityProgressRow) =>
  row.delivery.startsWith("Unconfirmed") || row.delivery.startsWith("Pending confirmation");

const availabilityLabel = (answer: string | undefined) => {
  if (answer === "available") return "Available";
  if (answer === "unavailable") return "Unavailable";
  return "No answer";
};

const availabilityTone = (answer: string | undefined) => {
  if (answer === "available") return "text-emerald-300";
  if (answer === "unavailable") return "text-rose-300";
  return "text-gray-400";
};

type Props = {
  rows: AvailabilityProgressRow[];
  form: TeamIntakeForm;
  teams: TeamRecord[];
  canEdit: boolean;
  busy: boolean;
  historyLoaded: boolean;
  serviceTimeZone: string;
  onCreateLink: (memberId: string) => void;
  onCopyLink: (recipient: TeamIntakeRecipient) => void;
  onOpenLink: (recipient: TeamIntakeRecipient) => void;
  onRevoke: (recipient: TeamIntakeRecipient) => void;
  onHistory: (memberId: string) => void;
  onViewAvailability: () => void;
};

const AvailabilityVolunteersList = ({
  rows,
  form,
  teams,
  canEdit,
  busy,
  historyLoaded,
  serviceTimeZone,
  onCreateLink,
  onCopyLink,
  onOpenLink,
  onRevoke,
  onHistory,
  onViewAvailability,
}: Props) => {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [teamId, setTeamId] = useState("");
  const [expandedMemberId, setExpandedMemberId] = useState("");
  const [page, setPage] = useState(0);
  const occurrences = form.availabilityOccurrences || [];
  const teamsForForm = teams.filter((team) => !team.archivedAt);

  const dateLabel = (occurrence: (typeof occurrences)[number]) => {
    if (occurrence.serviceDate)
      return formatPlainDateRangeLabel(occurrence.serviceDate, occurrence.serviceDate);
    if (serviceTimeZone)
      return formatShortOccurrenceDate(occurrence.startsAt, serviceTimeZone);
    return "Date unavailable";
  };

  const matchesStatus = (row: AvailabilityProgressRow) => {
    if (!status) return true;
    if (status === "Not invited") return row.status === "Not requested";
    if (status === "Delivery failed") return isDeliveryFailed(row);
    if (status === "Uncertain delivery") return isDeliveryUncertain(row);
    if (status === "Incomplete responses")
      return row.status === "Responded" && row.hasResponseDetails &&
        summarizeAvailabilityAnswers(
          row.occurrenceAvailability,
          occurrences.map((occurrence) => occurrence.occurrenceId),
        ).answered < occurrences.length;
    return row.status === status;
  };

  const visibleRows = rows.filter(
    (row) =>
      memberName(row.member)
        .toLowerCase()
        .includes(search.trim().toLowerCase()) &&
      matchesStatus(row) &&
      (!teamId || row.memberTeamIds.has(teamId)),
  );
  const pageCount = Math.ceil(visibleRows.length / PAGE_SIZE);
  const currentPage = Math.min(page, Math.max(0, pageCount - 1));
  const pageRows = visibleRows.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE,
  );

  const availabilitySummary = (row: AvailabilityProgressRow) => {
    if (!row.responded) return "—";
    if (!row.hasResponseDetails) return "Response recorded";
    if (!occurrences.length) return "Submitted";
    const summary = summarizeAvailabilityAnswers(
      row.occurrenceAvailability,
      occurrences.map((occurrence) => occurrence.occurrenceId),
    );
    return `${summary.answered} of ${summary.total} answered`;
  };

  const requestStatusLabel = (row: AvailabilityProgressRow) => {
    if (!historyLoaded && !["Responded", "Revoked"].includes(row.status))
      return "Checking history…";
    if (row.status === "Not requested") return "Not invited";
    return row.status;
  };

  const deliveryLabel = (delivery: string) =>
    historyLoaded ? delivery : "Checking delivery…";

  const statusFilterOptions = [
    { value: "", label: "All statuses" },
    { value: "Responded", label: "Responded" },
    { value: "Awaiting response", label: "Awaiting response" },
    { value: "Not invited", label: "Not invited" },
    { value: "Revoked", label: "Revoked" },
    { value: "Delivery failed", label: "Delivery failed" },
    { value: "Uncertain delivery", label: "Uncertain delivery" },
    { value: "Incomplete responses", label: "Incomplete responses" },
  ];

  const toggleDetails = (memberId: string) =>
    setExpandedMemberId((current) => current === memberId ? "" : memberId);

  return (
    <section
      className="mt-4 min-w-0 space-y-3"
      aria-label="Volunteers"
      aria-busy={!historyLoaded}
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-white">Volunteers</h3>
          <p className="text-xs text-gray-400">Request status and submitted availability</p>
        </div>
        <Button
          variant="secondary"
          padding="px-3 py-1.5"
          onClick={onViewAvailability}
        >
          View availability by date
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]" aria-label="Volunteer filters">
        <Input
          className="col-span-2 sm:col-span-1"
          label="Search volunteers"
          labelStyle="compactLight"
          labelFontSize="text-xs"
          value={search}
          onChange={(value) => {
            setSearch(String(value));
            setPage(0);
          }}
          placeholder="Search by name"
        />
        <Select
          label="Response/request status"
          size="sm"
          labelFontSize="text-xs"
          labelClassName="font-medium text-gray-400"
          value={status}
          onChange={(value) => {
            setStatus(value);
            setPage(0);
          }}
          options={statusFilterOptions}
        />
        <Select
          label="Team"
          size="sm"
          labelFontSize="text-xs"
          labelClassName="font-medium text-gray-400"
          value={teamId}
          onChange={(value) => {
            setTeamId(value);
            setPage(0);
          }}
          options={[
            { value: "", label: "All teams" },
            ...teamsForForm.map((team) => ({
              value: team.teamId,
              label: team.name,
            })),
          ]}
        />
      </div>

      <div className="max-h-[58vh] overflow-y-auto divide-y divide-gray-800" role="table" aria-label="Availability volunteers">
        <div
          className="sr-only sm:not-sr-only sm:sticky sm:top-0 sm:z-10 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_3rem] sm:gap-3 sm:bg-gray-900 sm:py-1 sm:text-xs sm:text-gray-400 sm:grid"
          role="row"
        >
          <span role="columnheader">Volunteer</span>
          <span role="columnheader">Request status</span>
          <span role="columnheader">Availability</span>
          <span role="columnheader">Actions</span>
        </div>
        {pageRows.map((row) => {
          const { member, recipient } = row;
          const name = memberName(member);
          const canExpand = row.status === "Responded" && row.hasResponseDetails && occurrences.length > 0;
          const expanded = expandedMemberId === member.memberId && canExpand;
          const answerSummary = canExpand
            ? summarizeAvailabilityAnswers(
                row.occurrenceAvailability,
                occurrences.map((occurrence) => occurrence.occurrenceId),
              )
            : null;
          return (
            <div key={member.memberId} role="rowgroup" className="py-1">
              <div
                role="row"
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_3rem]"
              >
                <div role="cell" className="min-w-0 text-sm">
                  {canExpand ? (
                    <button
                      type="button"
                      aria-label={`${expanded ? "Hide" : "View"} availability for ${name}`}
                      aria-expanded={expanded}
                      onClick={() => toggleDetails(member.memberId)}
                      className="flex max-w-full items-center gap-2 rounded text-left font-medium text-white hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                    >
                      <MemberNameWithIndicator name={name} memberId={member.memberId} />
                      <ChevronDown size={15} aria-hidden="true" className={`shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />
                    </button>
                  ) : (
                    <MemberNameWithIndicator
                      name={name}
                      memberId={member.memberId}
                      className="font-medium text-white"
                    />
                  )}
                </div>

                <div role="cell" className="col-start-1 row-start-2 min-w-0 sm:col-auto sm:row-auto">
                  <span className={`text-xs ${requestTone[row.status] || "text-gray-300"}`}>
                    {requestStatusLabel(row)}
                  </span>
                  {row.delivery !== "—" ? (
                    <span className={`ml-2 text-xs ${deliveryTone(row.delivery)}`}>
                      {deliveryLabel(row.delivery)}
                    </span>
                  ) : !historyLoaded ? (
                    <span className="ml-2 text-xs text-gray-400">Checking delivery…</span>
                  ) : null}
                </div>

                <div role="cell" className="col-start-2 row-start-2 text-right text-xs text-gray-300 sm:col-start-auto sm:row-start-auto sm:text-left">
                  <span>{availabilitySummary(row)}</span>
                </div>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="tertiary"
                      svg={MoreHorizontal}
                      aria-label={`Actions for ${name}`}
                      disabled={busy}
                      className="col-start-2 row-start-1 sm:col-auto sm:row-auto"
                    />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {canEdit && recipient && !recipient.revokedAt ? (
                      <>
                        <DropdownMenuItem onSelect={() => onCopyLink(recipient)}>
                          Copy personal availability link
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => onOpenLink(recipient)}>
                          Open personal form
                        </DropdownMenuItem>
                        <DropdownMenuItem variant="destructive" onSelect={() => onRevoke(recipient)}>
                          Revoke request
                        </DropdownMenuItem>
                      </>
                    ) : null}
                    {canEdit && (!recipient || recipient.revokedAt) ? (
                      <DropdownMenuItem onSelect={() => onCreateLink(member.memberId)}>
                        {recipient?.revokedAt ? "Create new personal link" : "Create personal link"}
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem onSelect={() => onHistory(member.memberId)}>
                      View request and delivery history
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {expanded && answerSummary ? (
                <div
                  id={`availability-${member.memberId}`}
                  className="mt-3 border-t border-gray-800 pt-3 sm:ml-4"
                  role="region"
                  aria-label={`${name} availability details`}
                >
                  <p className="mb-2 text-sm font-medium text-white">
                    {name} — Responded · {answerSummary.answered} of {answerSummary.total} answered
                  </p>
                  <dl className="max-h-[40vh] divide-y divide-gray-800 overflow-y-auto">
                    {occurrences.map((occurrence) => {
                      const answer = row.occurrenceAvailability[occurrence.occurrenceId];
                      return (
                        <div key={occurrence.occurrenceId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2.5">
                          <dt className="min-w-0 text-sm text-gray-200">
                            <span>{dateLabel(occurrence)}</span>
                            <span className="ml-2 text-gray-400">{occurrence.name}</span>
                          </dt>
                          <dd className={`flex items-center gap-1.5 text-sm ${availabilityTone(answer)}`}>
                            {answer === "available" ? <Check size={15} aria-hidden="true" /> : null}
                            {answer === "unavailable" ? <X size={15} aria-hidden="true" /> : null}
                            {!answer ? <CircleMinus size={15} aria-hidden="true" /> : null}
                            {availabilityLabel(answer)}
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                </div>
              ) : null}
            </div>
          );
        })}
        {!pageRows.length ? (
          <div className="py-6 text-xs text-gray-400" role="row">
            <span role="cell">No volunteers match these filters.</span>
          </div>
        ) : null}
      </div>

      {pageCount > 1 ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-gray-400">
            Page {currentPage + 1} of {pageCount} · {visibleRows.length} volunteers
          </p>
          <div className="flex gap-2">
            <Button variant="tertiary" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</Button>
            <Button variant="tertiary" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}>Next</Button>
          </div>
        </div>
      ) : null}

      {busy ? (
        <p role="status" className="text-sm text-gray-300">Updating personal link…</p>
      ) : null}
    </section>
  );
};

export default AvailabilityVolunteersList;
