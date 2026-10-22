import { Fragment, useState } from "react";
import { Check, ChevronDown, CircleMinus, MoreHorizontal, UserRound, X } from "lucide-react";
import Button from "../../../components/Button/Button";
import Input from "../../../components/Input/Input";
import Select from "../../../components/Select/Select";
import ResponsiveDataTable, { ResponsiveDataTableSkeleton } from "../../../components/ResponsiveDataTable";
import { useResponsiveTableLayout } from "../../../hooks/useResponsiveTableLayout";
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
  historyError: string;
  serviceTimeZone: string;
  onCreateLink: (memberId: string) => void;
  onCopyLink: (recipient: TeamIntakeRecipient) => void;
  onOpenLink: (recipient: TeamIntakeRecipient) => void;
  onRevoke: (recipient: TeamIntakeRecipient) => void;
  onResendLink: (memberId: string) => void;
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
  historyError,
  serviceTimeZone,
  onCreateLink,
  onCopyLink,
  onOpenLink,
  onRevoke,
  onResendLink,
  onHistory,
  onViewAvailability,
}: Props) => {
  const { containerRef, compact } = useResponsiveTableLayout();
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
    if (row.status === "Not requested") return "Not invited";
    return row.status;
  };

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

  const requestStatusContent = (row: AvailabilityProgressRow) => <>
    {!historyLoaded && !["Responded", "Revoked"].includes(row.status) ? <span aria-hidden="true" className="inline-block h-3 w-24 animate-pulse rounded bg-white/10 align-middle" /> : <span className={`text-xs ${requestTone[row.status] || "text-gray-300"}`}>{requestStatusLabel(row)}</span>}
    {!historyLoaded ? <span aria-hidden="true" className="ml-2 inline-block h-3 w-16 animate-pulse rounded bg-white/10 align-middle" /> : row.delivery !== "—" ? <span className={`ml-2 text-xs ${deliveryTone(row.delivery)}`}>{row.delivery}</span> : null}
  </>;

  const actionsFor = (row: AvailabilityProgressRow) => {
    const { member, recipient } = row;
    const name = memberName(member);
    return <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="tertiary" svg={MoreHorizontal} aria-label={`Actions for ${name}`} disabled={busy} className="min-h-[44px] min-w-[44px]" /></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {canEdit && recipient && !recipient.revokedAt ? <>
          {form.active && historyLoaded && row.hasPreviousRequest ? <DropdownMenuItem onSelect={() => onResendLink(member.memberId)}>Resend link</DropdownMenuItem> : null}
          <DropdownMenuItem onSelect={() => onCopyLink(recipient)}>Copy personal availability link</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onOpenLink(recipient)}>Open personal form</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => onRevoke(recipient)}>Revoke request</DropdownMenuItem>
        </> : null}
        {canEdit && (!recipient || recipient.revokedAt) ? <DropdownMenuItem onSelect={() => onCreateLink(member.memberId)}>{recipient?.revokedAt ? "Create new personal link" : "Create personal link"}</DropdownMenuItem> : null}
        <DropdownMenuItem onSelect={() => onHistory(member.memberId)}>View request and delivery history</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>;
  };

  const detailsFor = (row: AvailabilityProgressRow) => {
    const name = memberName(row.member);
    const answerSummary = summarizeAvailabilityAnswers(row.occurrenceAvailability, occurrences.map((occurrence) => occurrence.occurrenceId));
    return <div id={`availability-${row.member.memberId}`} role="region" aria-label={`${name} availability details`}>
      <p className="mb-2 text-sm font-medium text-white">{name} — Responded · {answerSummary.answered} of {answerSummary.total} answered</p>
      <dl className="max-h-[40vh] divide-y divide-gray-800 overflow-y-auto">{occurrences.map((occurrence) => {
        const answer = row.occurrenceAvailability[occurrence.occurrenceId];
        return <div key={occurrence.occurrenceId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2.5"><dt className="min-w-0 text-sm text-gray-200"><span>{dateLabel(occurrence)}</span><span className="ml-2 text-gray-400">{occurrence.name}</span></dt><dd className={`flex items-center gap-1.5 text-sm ${availabilityTone(answer)}`}>{answer === "available" ? <Check size={15} aria-hidden="true" /> : null}{answer === "unavailable" ? <X size={15} aria-hidden="true" /> : null}{!answer ? <CircleMinus size={15} aria-hidden="true" /> : null}{availabilityLabel(answer)}</dd></div>;
      })}</dl>
    </div>;
  };

  return (
    <section
      ref={containerRef}
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

      {!historyLoaded && !historyError && !rows.length ? <ResponsiveDataTableSkeleton
        label="Availability volunteers"
        loadingLabel="Loading volunteers"
        compact={compact}
        className="max-h-[58vh]"
        minWidthClassName="min-w-[40rem]"
        columns={[
          { label: "Volunteer", widthClassName: "w-[35%]" },
          { label: "Request status", widthClassName: "w-[30%]" },
          { label: "Availability", widthClassName: "w-[25%]" },
          { label: "Actions", widthClassName: "w-[10%]" },
        ]}
      /> : <ResponsiveDataTable
        label="Availability volunteers"
        compact={compact}
        className="max-h-[58vh]"
        minWidthClassName="min-w-[40rem]"
        desktopHeader={<tr><th scope="col" className="w-[35%] px-4 py-1.5">Volunteer</th><th scope="col" className="w-[30%] px-4 py-1.5">Request status</th><th scope="col" className="w-[25%] px-4 py-1.5">Availability</th><th scope="col" className="w-[10%] px-4 py-1.5">Actions</th></tr>}
        desktopRows={() => <>{pageRows.map((row) => {
          const name = memberName(row.member);
          const canExpand = row.status === "Responded" && row.hasResponseDetails && occurrences.length > 0;
          const expanded = expandedMemberId === row.member.memberId && canExpand;
          return <Fragment key={row.member.memberId}>
            <tr className="bg-gray-900/40 hover:bg-cyan-500/5">
              <td className="max-w-0 px-4 py-1.5 font-semibold text-white">{canExpand ? <button type="button" aria-label={`${expanded ? "Hide" : "View"} availability for ${name}`} aria-expanded={expanded} onClick={() => toggleDetails(row.member.memberId)} className="flex max-w-full items-center gap-2 text-left hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"><MemberNameWithIndicator name={name} memberId={row.member.memberId} /><ChevronDown size={15} aria-hidden="true" className={`shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} /></button> : <MemberNameWithIndicator name={name} memberId={row.member.memberId} />}</td>
              <td className="px-4 py-1.5">{requestStatusContent(row)}</td>
              <td className="px-4 py-1.5 text-gray-300">{availabilitySummary(row)}</td>
              <td className="px-4 py-1.5">{actionsFor(row)}</td>
            </tr>
            {expanded ? <tr><td colSpan={4} className="bg-gray-950/40 px-4 py-3">{detailsFor(row)}</td></tr> : null}
          </Fragment>;
        })}{!pageRows.length ? <tr><td colSpan={4} className="px-4 py-6 text-sm text-gray-400">No volunteers match these filters.</td></tr> : null}</>}
        mobileRows={() => <>{pageRows.map((row) => {
          const name = memberName(row.member);
          const canExpand = row.status === "Responded" && row.hasResponseDetails && occurrences.length > 0;
          const expanded = expandedMemberId === row.member.memberId && canExpand;
          return <li key={row.member.memberId} className="px-2 py-0 hover:bg-cyan-500/5">
            <div className="flex min-h-[44px] items-center gap-2">
              <UserRound className="size-5 shrink-0 text-cyan-300" aria-hidden="true" />
              <div className="min-w-0 flex-1">{canExpand ? <button type="button" aria-label={`${expanded ? "Hide" : "View"} availability for ${name}`} aria-expanded={expanded} onClick={() => toggleDetails(row.member.memberId)} className="flex min-h-[44px] w-full min-w-0 items-center gap-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-white"><MemberNameWithIndicator name={name} memberId={row.member.memberId} /></span><span className="block truncate text-xs text-gray-400">{requestStatusContent(row)} · {availabilitySummary(row)}</span></span><ChevronDown size={15} aria-hidden="true" className={`shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} /></button> : <div className="py-1"><span className="block truncate text-sm font-semibold text-white"><MemberNameWithIndicator name={name} memberId={row.member.memberId} /></span><span className="block truncate text-xs text-gray-400">{requestStatusContent(row)} · {availabilitySummary(row)}</span></div>}</div>
              {actionsFor(row)}
            </div>
            {expanded ? <div className="border-t border-gray-700 py-3">{detailsFor(row)}</div> : null}
          </li>;
        })}{!pageRows.length ? <li className="px-3 py-6 text-sm text-gray-400">No volunteers match these filters.</li> : null}</>}
      />}

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
