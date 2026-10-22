import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, MessageSquare } from "lucide-react";
import Modal from "../../../components/Modal/Modal";
import Button from "../../../components/Button/Button";
import Checkbox from "../../../components/Checkbox/Checkbox";
import Input from "../../../components/Input/Input";
import Select from "../../../components/Select/Select";
import TextArea from "../../../components/TextArea/TextArea";
import ResponsiveDataTable, { ResponsiveDataTableSkeleton } from "../../../components/ResponsiveDataTable";
import { dispatchAvailabilityNotificationBatch, getAvailabilityNotificationBatch, getMessageHistory, prepareCustomMessage, type MessageHistoryEntry } from "../../../api/auth";
import type { NotificationBatch } from "../../../api/authTypes";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { getApiErrorStatus } from "../../../utils/apiErrorToast";
import { normalizeUsPhoneNumberForComparison } from "../../../utils/phoneNumber";
import { useTeamsPage } from "../TeamsPageContext";
import { measureMessage } from "../smsEstimate";
import { useResponsiveTableLayout } from "../../../hooks/useResponsiveTableLayout";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "../../../components/ui/DropdownMenu";

const memberName = (member: { firstName?: string; lastName?: string }) =>
  [member.firstName, member.lastName].filter(Boolean).join(" ") || "Volunteer";
const typeLabel: Record<string, string> = {
  custom_message: "Custom message", availability_request: "Availability request", availability_reminder: "Form reminder",
  schedule_initial_notification: "Schedule notification", assignment_notification: "Assignment notification",
  assignment_confirmation: "Assignment response", schedule_change: "Schedule change", replacement_request: "Replacement invitation",
};
const statusLabel = (status: MessageHistoryEntry["status"]) => ({ accepted: "Accepted by provider", delivered: "Delivered",
  failed: "Failed", unconfirmed: "Unconfirmed", sending: "Sending", not_sent: "Not sent" })[status];
const recipientStatus = (row: MessageHistoryEntry["recipients"][number]) => {
  if (row.deliveryStatus === "delivered") return "Delivered";
  if (["failed", "undelivered"].includes(row.deliveryStatus) || row.status === "failed") return "Failed";
  if (row.outcome === "unknown" || row.status === "unknown") return "Unconfirmed";
  if (["accepted", "sent"].includes(row.deliveryStatus) || row.status === "sent") return "Accepted by provider";
  return row.status === "sending" ? "Sending" : "Not sent";
};
const reviewRecipientStatus = (row: NotificationBatch["recipients"][number]) => {
  if (row.eligible) return "Ready";
  if (row.exclusionReason) return row.exclusionReason;
  if (row.status === "sent") return "Accepted by provider";
  if (row.status === "unknown") return "Unconfirmed";
  if (row.status === "failed") return "Failed";
  return "Not eligible";
};
const newKey = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
type EditableMessageDraft = { message: string; memberIds: string[] };
type RecipientPresentation = { memberId: string; memberName: string; maskedPhoneNumber: string };
type ComposerSnapshot = { message: string; memberIds: string[]; segmentCount: number; recipients: RecipientPresentation[] };
type ReviewMode = "bulk" | "changed_single";

const readEditableDraft = (storageKey: string): EditableMessageDraft | null => {
  if (!storageKey || typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) || "null") as Partial<EditableMessageDraft> | null;
    if (!parsed || typeof parsed.message !== "string" || !Array.isArray(parsed.memberIds) ||
      !parsed.memberIds.every((id) => typeof id === "string")) return null;
    return { message: parsed.message, memberIds: [...new Set(parsed.memberIds)] };
  } catch {
    return null;
  }
};

const maskedPhoneFor = (value: string | null | undefined) => {
  const normalized = normalizeUsPhoneNumberForComparison(value);
  return normalized ? `••• ••• ${normalized.slice(-4)}` : "";
};

const sameIds = (left: string[], right: string[]) => {
  if (left.length !== right.length) return false;
  const rightIds = new Set(right);
  return left.every((id) => rightIds.has(id));
};

const matchesComposerSnapshot = (batch: NotificationBatch, snapshot: ComposerSnapshot) => {
  if (batch.message !== snapshot.message || !sameIds(batch.selectedMemberIds, snapshot.memberIds) ||
    batch.recipients.length !== snapshot.recipients.length || batch.summary.eligible !== snapshot.memberIds.length ||
    batch.summary.totalSegments !== snapshot.segmentCount) return false;
  const expected = new Map(snapshot.recipients.map((recipient) => [recipient.memberId, recipient]));
  return batch.recipients.every((recipient) => {
    const shown = expected.get(recipient.memberId);
    return Boolean(shown && recipient.eligible && recipient.segmentCount === snapshot.segmentCount && recipient.memberName === shown.memberName &&
      recipient.maskedPhoneNumber === shown.maskedPhoneNumber);
  });
};

const matchesReviewSnapshot = (left: NotificationBatch, right: NotificationBatch) => {
  if (left.message !== right.message || !sameIds(left.selectedMemberIds, right.selectedMemberIds) ||
    left.summary.eligible !== right.summary.eligible || left.summary.excluded !== right.summary.excluded ||
    left.summary.totalSegments !== right.summary.totalSegments || left.recipients.length !== right.recipients.length) return false;
  const rightRecipients = new Map(right.recipients.map((recipient) => [recipient.memberId, recipient]));
  return left.recipients.every((recipient) => {
    const current = rightRecipients.get(recipient.memberId);
    return Boolean(current && recipient.memberName === current.memberName &&
      recipient.maskedPhoneNumber === current.maskedPhoneNumber && recipient.eligible === current.eligible &&
      recipient.exclusionReason === current.exclusionReason && recipient.segmentCount === current.segmentCount);
  });
};

const hasUnresolvedDelivery = (entry: MessageHistoryEntry) => entry.messageType === "custom_message" &&
  (entry.status === "unconfirmed" || entry.status === "sending" || entry.recipients.some((row) =>
    row.status === "sending" || row.status === "unknown" || row.outcome === "unknown"));
const hasUnresolvedBatchDelivery = (batch: NotificationBatch) => batch.status === "dispatching" || batch.summary.uncertain > 0 ||
  batch.recipients.some((row) => row.status === "sending" || row.status === "unknown" || row.attemptOutcome === "unknown");

const batchRecipientDeliveryStatus = (row: NotificationBatch["recipients"][number]) => {
  if (row.status === "unknown" || row.attemptOutcome === "unknown") return "Unconfirmed";
  if (row.attemptStatus === "delivered") return "Delivered";
  if (["failed", "undelivered"].includes(row.attemptStatus || "") || row.status === "failed") return "Failed";
  if (["accepted", "sent"].includes(row.attemptStatus || "") || row.status === "sent") return "Accepted by provider";
  if (row.status === "sending") return "Sending";
  return row.exclusionReason || "Not sent";
};

const TeamsMessagesPageView = ({ draftStorageKey }: { draftStorageKey: string }) => {
  const { churchId, pageData, canEditTeams, canEditTeam } = useTeamsPage();
  const { containerRef, compact } = useResponsiveTableLayout();
  const [initialDraft] = useState(() => readEditableDraft(draftStorageKey));
  const [entries, setEntries] = useState<MessageHistoryEntry[]>([]);
  const [cursor, setCursor] = useState("");
  const [loading, setLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedHistoryEntry, setSelectedHistoryEntry] = useState<MessageHistoryEntry | null>(null);
  const [checkedBatch, setCheckedBatch] = useState<NotificationBatch | null>(null);
  const [statusCheckError, setStatusCheckError] = useState("");
  const [statusCheckBusy, setStatusCheckBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);
  const [memberOverrides, setMemberOverrides] = useState<Record<string, boolean>>(
    () => Object.fromEntries((initialDraft?.memberIds || []).map((id) => [id, true])),
  );
  const [memberSearch, setMemberSearch] = useState("");
  const [message, setMessage] = useState(initialDraft?.message || "");
  const [review, setReview] = useState<NotificationBatch | null>(null);
  const [reviewMode, setReviewMode] = useState<ReviewMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const sendLock = useRef(false);
  const statusCheckLock = useRef(false);
  const activeRef = useRef(true);
  const churchRef = useRef(churchId);
  churchRef.current = churchId;
  const selectedHistoryIdRef = useRef("");
  selectedHistoryIdRef.current = selectedHistoryEntry?.historyId || "";

  const teamIdsByMember = useMemo(() => {
    const positionTeams = new Map(pageData.positions.map((position) => [position.positionId, position.teamId]));
    return new Map(pageData.members.map((member) => [member.memberId, new Set([
      ...Object.keys(member.teamMemberships || {}),
      ...(member.positionIds || []).map((id) => positionTeams.get(id)).filter((id): id is string => Boolean(id)),
      ...pageData.teams.filter((team) => (team.memberIds || []).includes(member.memberId)).map((team) => team.teamId),
    ])]));
  }, [pageData.members, pageData.positions, pageData.teams]);
  const teams = useMemo(() => pageData.teams.filter((team) => !team.archivedAt && (canEditTeams || canEditTeam(team.teamId))),
    [canEditTeam, canEditTeams, pageData.teams]);
  const members = useMemo(() => pageData.members.filter((member) => !member.archivedAt &&
    (canEditTeams || [...(teamIdsByMember.get(member.memberId) || [])].some(canEditTeam)))
    .sort((a, b) => memberName(a).localeCompare(memberName(b))), [canEditTeam, canEditTeams, pageData.members, teamIdsByMember]);
  const eligibleMembers = useMemo(() => members.filter((member) => pageData.smsEligibilityByMemberId?.[member.memberId]?.eligible),
    [members, pageData.smsEligibilityByMemberId]);
  const activeTeamIds = useMemo(() => selectedTeamIds.filter((id) => teams.some((team) => team.teamId === id)), [selectedTeamIds, teams]);
  const selected = useMemo(() => [...new Set([
    ...members.filter((member) => memberOverrides[member.memberId] !== false &&
      (memberOverrides[member.memberId] === true || (pageData.smsEligibilityByMemberId?.[member.memberId]?.eligible &&
        activeTeamIds.some((id) => teamIdsByMember.get(member.memberId)?.has(id))))).map((member) => member.memberId),
    ...Object.entries(memberOverrides).filter(([, checked]) => checked).map(([id]) => id),
  ])], [activeTeamIds, memberOverrides, members, pageData.smsEligibilityByMemberId, teamIdsByMember]);
  const shownMembers = members.filter((member) => memberName(member).toLowerCase().includes(memberSearch.trim().toLowerCase()));
  const selectedSet = new Set(selected);
  const selectedMembers = selected.map((id) => members.find((member) => member.memberId === id)).filter((member) => Boolean(member));
  const selectedEligibleMembers = selectedMembers.filter((member) => pageData.smsEligibilityByMemberId?.[member!.memberId]?.eligible);
  const selectedMissingCount = selected.length - selectedMembers.length;
  const excludedSelectedCount = selected.length - selectedEligibleMembers.length;
  const hiddenCount = selectedMembers.filter((member) => !shownMembers.some((shown) => shown.memberId === member!.memberId)).length;
  const finalText = message.trim() ? /\bReply STOP to opt out\.?$/i.test(message.trim())
    ? message.trim() : `${message.trim()} Reply STOP to opt out.` : "";
  const estimate = measureMessage(finalText);

  useEffect(() => {
    if (!draftStorageKey || typeof window === "undefined") return;
    try {
      if (!message && !selected.length) window.localStorage.removeItem(draftStorageKey);
      else window.localStorage.setItem(draftStorageKey, JSON.stringify({ message, memberIds: selected } satisfies EditableMessageDraft));
    } catch {
      // The editable draft remains available in this composer when browser storage is unavailable.
    }
  }, [draftStorageKey, message, selected]);

  const refresh = useCallback(async (older = "") => {
    const owner = churchId;
    setLoading(true);
    setHistoryError("");
    try {
      const response = await getMessageHistory(owner, older);
      if (!activeRef.current || churchRef.current !== owner) return;
      setEntries((current) => older ? [...current, ...response.entries.filter((item) => !current.some((old) => old.historyId === item.historyId))] : response.entries);
      if (!older) {
        const selectedEntry = response.entries.find((item) => item.historyId === selectedHistoryIdRef.current);
        if (selectedEntry) setSelectedHistoryEntry(selectedEntry);
      }
      setCursor(response.nextCursor);
    } catch (caught) {
      if (activeRef.current && churchRef.current === owner) setHistoryError(caught instanceof Error ? caught.message : "Could not load message history.");
    } finally {
      if (activeRef.current && churchRef.current === owner) setLoading(false);
    }
  }, [churchId]);
  useEffect(() => {
    activeRef.current = true;
    setEntries([]);
    setCursor("");
    setReview(null);
    setReviewMode(null);
    setOpen(false);
    try { window.localStorage.removeItem(`worshipsync:last-custom-message:${churchId}`); } catch { /* Old review pointers are optional cleanup. */ }
    void refresh();
    return () => { activeRef.current = false; };
  }, [churchId, refresh]);

  const changeSelection = (ids: string[], checked: boolean) => {
    setMemberOverrides((current) => ({ ...current, ...Object.fromEntries(ids.map((id) => [id, checked])) }));
    setReview(null);
    setReviewMode(null);
  };
  const clearSelection = () => {
    setSelectedTeamIds([]);
    setMemberOverrides({});
    setReview(null);
    setReviewMode(null);
  };
  const captureComposerSnapshot = (): ComposerSnapshot => ({
    message: finalText,
    memberIds: [...selected],
    segmentCount: estimate.segmentCount,
    recipients: selected.map((memberId) => {
      const member = members.find((candidate) => candidate.memberId === memberId);
      return { memberId, memberName: member ? memberName(member) : "", maskedPhoneNumber: maskedPhoneFor(member?.phoneNumber) };
    }),
  });

  const clearDraft = () => {
    if (draftStorageKey) {
      try { window.localStorage.removeItem(draftStorageKey); } catch { /* The composer state remains authoritative until it closes. */ }
    }
    setMessage("");
    setSelectedTeamIds([]);
    setMemberOverrides({});
  };

  const finishSend = (batch: NotificationBatch) => {
    if (batch.status === "sent" && batch.summary.sent > 0 && batch.summary.failed === 0 && batch.summary.uncertain === 0) {
      clearDraft();
      setNotice("Message sent. Delivery updates will appear in message history.");
    } else {
      const keepIds = batch.recipients.filter((row) => !["sent", "unknown", "sending"].includes(row.status)).map((row) => row.memberId);
      setSelectedTeamIds([]);
      setMemberOverrides(Object.fromEntries(keepIds.map((id) => [id, true])));
      setMessage((current) => current || batch.message || "");
      setNotice(batch.summary.uncertain > 0
        ? "Delivery is not confirmed for every recipient. Check delivery status in message history before preparing another send."
        : batch.summary.failed > 0
          ? "Some messages failed. Your message and recipients that were not sent are saved."
          : "The message could not be sent to every selected volunteer. Review message history for details.");
    }
    setReview(null);
    setReviewMode(null);
    setOpen(false);
    setError("");
    void refresh();
  };

  const dispatchPreparedBatch = async (
    batch: NotificationBatch,
    expectation: { kind: "composer"; snapshot: ComposerSnapshot; draftMessage: string } |
      { kind: "review"; snapshot: NotificationBatch; draftMessage: string },
    allowFreshApproval = true,
  ) => {
    const owner = churchId;
    try {
      const response = await dispatchAvailabilityNotificationBatch(owner, batch.batchId, batch.approvalVersion);
      if (activeRef.current && churchRef.current === owner) finishSend(response.batch);
    } catch (caught) {
      if (!activeRef.current || churchRef.current !== owner) return;
      try {
        const latest = (await getAvailabilityNotificationBatch(owner, batch.batchId)).batch;
        if (!activeRef.current || churchRef.current !== owner) return;
        const definitelyNotStarted = latest.status === "prepared" && latest.recipients.every((row) =>
          !["sending", "sent", "failed", "unknown"].includes(row.status) && !row.attemptStatus && row.attemptOutcome !== "unknown");
        if (definitelyNotStarted && getApiErrorStatus(caught) === 409 && allowFreshApproval) {
          const fresh = (await prepareCustomMessage(owner, {
            memberIds: expectation.kind === "composer" ? expectation.snapshot.memberIds : expectation.snapshot.selectedMemberIds,
            message: expectation.draftMessage,
            requestKey: newKey(),
          })).batch;
          if (!activeRef.current || churchRef.current !== owner) return;
          const unchanged = expectation.kind === "composer"
            ? matchesComposerSnapshot(fresh, expectation.snapshot)
            : matchesReviewSnapshot(fresh, expectation.snapshot);
          if (unchanged) {
            await dispatchPreparedBatch(fresh, expectation, false);
            return;
          }
          setReview(fresh);
          setReviewMode(expectation.kind === "composer" ? "changed_single" : reviewMode || "bulk");
          setOpen(true);
          setError("The message or recipient details changed. Review the updated information before sending.");
          return;
        }
        if (definitelyNotStarted) {
          setReview(null);
          setReviewMode(null);
          setOpen(true);
          setError("No message was sent. Your draft is saved. Choose Send again to prepare a fresh review.");
          return;
        }
        finishSend(latest);
        if (latest.status === "dispatching" || latest.summary.uncertain > 0) {
          setNotice("We couldn't confirm delivery. Check delivery status in message history before preparing another send.");
        }
      } catch {
        if (!activeRef.current || churchRef.current !== owner) return;
        setOpen(false);
        setReview(null);
        setReviewMode(null);
        setNotice("We couldn't confirm delivery. Your draft is saved. Check delivery status in message history before preparing another send.");
        void refresh();
      }
    }
  };

  const sendFromComposer = async () => {
    if (busy || sendLock.current || !selected.length || !selectedEligibleMembers.length || !message.trim() || selectedMissingCount) return;
    sendLock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const snapshot = captureComposerSnapshot();
    const draftMessage = message;
    const owner = churchId;
    try {
      const prepared = (await prepareCustomMessage(owner, { memberIds: snapshot.memberIds, message: draftMessage, requestKey: newKey() })).batch;
      if (!activeRef.current || churchRef.current !== owner) return;
      if (snapshot.memberIds.length === 1 && matchesComposerSnapshot(prepared, snapshot)) {
        await dispatchPreparedBatch(prepared, { kind: "composer", snapshot, draftMessage });
      } else {
        setReview(prepared);
        setReviewMode(snapshot.memberIds.length === 1 ? "changed_single" : "bulk");
        setOpen(true);
        if (snapshot.memberIds.length === 1) setError("The recipient details changed. Review the updated message before sending.");
      }
    } catch (caught) {
      if (activeRef.current && churchRef.current === owner) setError(caught instanceof Error ? caught.message : "Could not prepare this message.");
    } finally {
      sendLock.current = false;
      if (activeRef.current && churchRef.current === owner) setBusy(false);
    }
  };

  const confirmReview = async () => {
    if (!review || busy || sendLock.current || !review.summary.eligible) return;
    sendLock.current = true;
    setBusy(true);
    setError("");
    const owner = churchId;
    const batch = review;
    const draftMessage = message;
    try {
      await dispatchPreparedBatch(batch, { kind: "review", snapshot: batch, draftMessage });
    } finally {
      sendLock.current = false;
      if (activeRef.current && churchRef.current === owner) setBusy(false);
    }
  };

  const checkDeliveryStatus = async (entry: MessageHistoryEntry) => {
    if (busy || statusCheckLock.current) return;
    statusCheckLock.current = true;
    setStatusCheckBusy(true);
    setStatusCheckError("");
    const owner = churchId;
    try {
      const response = await getAvailabilityNotificationBatch(owner, entry.historyId);
      if (!activeRef.current || churchRef.current !== owner || selectedHistoryIdRef.current !== entry.historyId) return;
      setCheckedBatch(response.batch);
      void refresh();
    } catch (caught) {
      if (activeRef.current && churchRef.current === owner && selectedHistoryIdRef.current === entry.historyId) {
        setStatusCheckError(caught instanceof Error ? caught.message : "Could not check delivery status.");
      }
    } finally {
      statusCheckLock.current = false;
      if (activeRef.current && churchRef.current === owner) setStatusCheckBusy(false);
    }
  };

  const openHistoryEntry = (entry: MessageHistoryEntry) => {
    setSelectedHistoryEntry(entry);
    setCheckedBatch(null);
    setStatusCheckError("");
  };

  const filtered = entries.filter((entry) => (!typeFilter || entry.messageType === typeFilter) &&
    (!statusFilter || entry.status === statusFilter) &&
    (!search.trim() || `${entry.summary} ${entry.recipients.map((row) => row.memberName).join(" ")}`.toLowerCase().includes(search.trim().toLowerCase())));
  const oneEligibleRecipient = selected.length === 1 && selectedEligibleMembers.length === 1;
  const sendLabel = oneEligibleRecipient ? "Send message" : `Send to ${selectedEligibleMembers.length} volunteer${selectedEligibleMembers.length === 1 ? "" : "s"}`;
  const singleRecipient = oneEligibleRecipient ? selectedEligibleMembers[0] : null;
  const reviewButtonLabel = reviewMode === "bulk"
    ? `Send ${review?.summary.eligible || 0} message${review?.summary.eligible === 1 ? "" : "s"}`
    : "Send message";

  return <main ref={containerRef} data-mobile-header-scroll-owner="page" className="mx-auto w-full max-w-5xl space-y-5 overflow-y-auto p-4 sm:p-6" aria-labelledby="messages-heading">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 id="messages-heading" className="text-xl font-semibold text-white">Messages</h1>
      <p className="text-sm text-gray-300">Send text messages to your volunteers.</p></div>
      <Button disabled={!canEditTeams && !teams.length} onClick={() => { setMemberSearch(""); setReview(null); setReviewMode(null); setError(""); setOpen(true); }}>+ New message</Button></header>
    {notice ? <p role="status" className="text-sm text-sky-200">{notice}</p> : null}
    <section className="space-y-3" aria-labelledby="history-heading"><div className="flex justify-between"><h2 id="history-heading" className="font-semibold text-white">Message history</h2>
      <Button variant="textLink" disabled={loading} onClick={() => void refresh()}>Refresh</Button></div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]" aria-label="Message filters">
        <Input className="col-span-2 sm:col-span-1" label="Search messages" labelStyle="compactLight" labelFontSize="text-xs" value={search} onChange={(value) => setSearch(String(value))} placeholder="Search messages or volunteers" />
        <Select label="Type" size="sm" labelFontSize="text-xs" labelClassName="font-medium text-gray-400" value={typeFilter} onChange={setTypeFilter} options={[{ value: "", label: "All types" }, ...Object.entries(typeLabel).map(([value, label]) => ({ value, label }))]} />
        <Select label="Status" size="sm" labelFontSize="text-xs" labelClassName="font-medium text-gray-400" value={statusFilter} onChange={setStatusFilter} options={[{ value: "", label: "All statuses" }, ...(["accepted", "delivered", "failed", "unconfirmed", "sending", "not_sent"] as MessageHistoryEntry["status"][]).map((value) => ({ value, label: statusLabel(value) }))]} />
      </div>
      {historyError ? <p role="alert" className="text-sm text-amber-200">{historyError} <Button variant="textLink" onClick={() => void refresh()}>Try again</Button></p> : null}
      {loading && !entries.length ? <ResponsiveDataTableSkeleton label="Message history table" loadingLabel="Loading messages" compact={compact} className="max-h-[58vh]" minWidthClassName="min-w-[40rem]" columns={[
        { label: "Message", widthClassName: "w-[55%]" },
        { label: "Date", widthClassName: "w-[15%]" },
        { label: "Recipients", widthClassName: "w-[10%]" },
        { label: "Status", widthClassName: "w-[20%]" },
      ]} /> : <ResponsiveDataTable label="Message history table" compact={compact} className="max-h-[58vh]" minWidthClassName="min-w-[40rem]"
        desktopHeader={<tr><th scope="col" className="w-[55%] px-4 py-1.5">Message</th><th scope="col" className="w-[15%] px-4 py-1.5">Date</th><th scope="col" className="w-[10%] px-4 py-1.5">Recipients</th><th scope="col" className="w-[20%] px-4 py-1.5">Status</th></tr>}
        desktopRows={() => <>{filtered.map((entry) => <tr key={entry.historyId} className="bg-gray-900/40 hover:bg-cyan-500/5">
          <td className="max-w-0 px-4 py-1.5"><button type="button" className="w-full truncate text-left font-semibold text-white hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400" aria-label={`View details for ${entry.summary || typeLabel[entry.messageType] || "Message"}`} onClick={() => openHistoryEntry(entry)}>{entry.summary || typeLabel[entry.messageType] || "Message"}</button><span className="block text-xs text-gray-400">{typeLabel[entry.messageType] || "Message"}</span></td>
          <td className="whitespace-nowrap px-4 py-1.5 text-gray-300">{new Date(entry.createdAt).toLocaleDateString()}</td><td className="px-4 py-1.5 text-gray-300">{entry.recipientCount}</td><td className="px-4 py-1.5 text-gray-300">{statusLabel(entry.status)}</td>
        </tr>)}{!loading && !filtered.length ? <tr><td colSpan={4} className="px-4 py-6 text-sm text-gray-400">No messages match these filters.</td></tr> : null}</>}
        mobileRows={() => <>{filtered.map((entry) => <li key={entry.historyId} className="px-3 py-0 hover:bg-cyan-500/5"><div className="flex items-center gap-2"><MessageSquare className="size-5 shrink-0 text-cyan-300" aria-hidden="true" /><button type="button" className="min-h-[44px] min-w-0 flex-1 cursor-pointer text-left outline-none focus-visible:ring-2 focus-visible:ring-cyan-400" aria-label={`View details for ${entry.summary || typeLabel[entry.messageType] || "Message"}`} onClick={() => openHistoryEntry(entry)}><span className="block truncate text-sm font-semibold text-white">{entry.summary || typeLabel[entry.messageType] || "Message"}</span><span className="block truncate text-xs text-gray-400">{typeLabel[entry.messageType] || "Message"} · {entry.recipientCount} recipient{entry.recipientCount === 1 ? "" : "s"} · {new Date(entry.createdAt).toLocaleDateString()}</span></button><span className="max-w-24 shrink-0 text-right text-xs text-gray-300">{statusLabel(entry.status)}</span></div></li>)}{!loading && !filtered.length ? <li className="px-3 py-6 text-sm text-gray-400">No messages match these filters.</li> : null}</>}
      />}
      {cursor ? <Button variant="secondary" disabled={loading} isLoading={loading} onClick={() => void refresh(cursor)}>Load older messages</Button> : null}</section>
    <Modal isOpen={Boolean(selectedHistoryEntry)} onClose={() => { setSelectedHistoryEntry(null); setCheckedBatch(null); setStatusCheckError(""); }} title="Message details" description="Full message text and sending details." size="md" contentClassName="max-md:max-h-[calc(90vh-4rem)]">
      {selectedHistoryEntry ? <div className="space-y-5 text-gray-200">
        <section className="space-y-2" aria-labelledby="history-message-content-heading">
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 id="history-message-content-heading" className="font-medium text-white">Full message</h3><span className="text-xs text-gray-400">{typeLabel[selectedHistoryEntry.messageType] || "Message"}</span></div>
          <div className="max-h-[30vh] overflow-y-auto whitespace-pre-wrap break-words rounded border border-gray-700 bg-gray-950 p-3 text-sm">{selectedHistoryEntry.summary || "No message text is available."}</div>
        </section>
        <section className="space-y-3" aria-labelledby="history-sending-details-heading">
          <h3 id="history-sending-details-heading" className="font-medium text-white">Sending details</h3>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded border border-gray-700 bg-gray-900/50 p-3 text-sm">
            <div><dt className="text-xs text-gray-400">Date</dt><dd>{new Date(selectedHistoryEntry.createdAt).toLocaleString()}</dd></div>
            <div><dt className="text-xs text-gray-400">Recipients</dt><dd>{selectedHistoryEntry.recipientCount}</dd></div>
            <div className="col-span-2"><dt className="text-xs text-gray-400">Overall status</dt><dd>{statusLabel(selectedHistoryEntry.status)}</dd></div>
          </dl>
          <div className="max-h-[30vh] divide-y divide-gray-700 overflow-y-auto rounded border border-gray-700">
            {selectedHistoryEntry.recipients.map((row) => <div key={row.memberId} className="flex flex-wrap justify-between gap-2 px-3 py-2 text-sm">
              <span className="font-medium text-white">{row.memberName}</span>
              <span className="text-gray-300">{recipientStatus(row)}{row.failureMessage ? ` · ${row.failureMessage}` : ""}</span>
            </div>)}
            {!selectedHistoryEntry.recipients.length ? <p className="px-3 py-3 text-sm text-gray-400">Recipient details are unavailable.</p> : null}
          </div>
          {hasUnresolvedDelivery(selectedHistoryEntry) &&
            (checkedBatch?.batchId !== selectedHistoryEntry.historyId || hasUnresolvedBatchDelivery(checkedBatch)) ? <div className="space-y-2">
            <Button variant="secondary" disabled={statusCheckBusy} isLoading={statusCheckBusy} onClick={() => void checkDeliveryStatus(selectedHistoryEntry)}>Check delivery status</Button>
            {statusCheckError ? <p role="alert" className="text-sm text-amber-200">{statusCheckError}</p> : null}
          </div> : null}
          {checkedBatch?.batchId === selectedHistoryEntry.historyId ? <section className="space-y-2" aria-label="Latest delivery status">
            <p role="status" className="text-sm">Latest status: {checkedBatch.summary.sent} accepted · {checkedBatch.summary.delivered} delivered · {checkedBatch.summary.failed} failed · {checkedBatch.summary.uncertain} unconfirmed.</p>
            <div className="max-h-[22vh] divide-y divide-gray-700 overflow-y-auto rounded border border-gray-700">
              {checkedBatch.recipients.map((row) => <div key={row.memberId} className="flex flex-wrap justify-between gap-2 px-3 py-2 text-sm">
                <span className="font-medium text-white">{row.memberName}</span>
                <span className="text-gray-300">{batchRecipientDeliveryStatus(row)}</span>
              </div>)}
            </div>
          </section> : null}
        </section>
      </div> : null}
    </Modal>
    <Modal isOpen={open} onClose={() => { if (!busy) { setOpen(false); setReview(null); setReviewMode(null); setError(""); } }} busy={busy}
      title={review ? reviewMode === "bulk" ? "Confirm message" : "Review updated message" : "New message"}
      description={review ? reviewMode === "bulk" ? "Check the message and recipients before sending." : "The recipient details changed. Review them before sending." : "Choose volunteers and write a text."} size="md" contentClassName="max-md:max-h-[calc(90vh-4rem)]">
      <div className="space-y-4 text-gray-200">
      {!review ? <>
        <div className="space-y-1"><h3 className="font-medium text-white">Recipients</h3><p className="text-xs text-gray-400">Choose teams, then adjust the volunteer list as needed.</p></div>
        {teams.length ? <div className="space-y-1"><span className="block text-sm font-medium text-gray-200">Teams</span><DropdownMenu><DropdownMenuTrigger asChild><button type="button" aria-label="Teams" disabled={busy} className="flex min-h-9 w-full items-center justify-between gap-2 rounded-md border border-gray-600 bg-neutral-900 px-3 text-left text-sm text-white outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:opacity-50"><span className="truncate">{activeTeamIds.length ? `${activeTeamIds.length} team${activeTeamIds.length === 1 ? "" : "s"} selected` : "Choose teams"}</span><ChevronDown className="size-4 shrink-0 text-gray-400" aria-hidden="true" /></button></DropdownMenuTrigger><DropdownMenuContent align="start" className="max-h-64 min-w-[var(--radix-dropdown-menu-trigger-width)]">{teams.map((team) => <DropdownMenuCheckboxItem key={team.teamId} checked={activeTeamIds.includes(team.teamId)} onCheckedChange={(checked) => { setSelectedTeamIds((current) => checked ? [...new Set([...current, team.teamId])] : current.filter((id) => id !== team.teamId)); setReview(null); setReviewMode(null); }} onSelect={(event) => event.preventDefault()}>{team.name}</DropdownMenuCheckboxItem>)}</DropdownMenuContent></DropdownMenu></div> : null}
        <div className="flex flex-wrap items-center justify-between gap-2"><Button variant="textLink" disabled={busy} onClick={() => changeSelection(eligibleMembers.map((member) => member.memberId), true)}>Select all eligible volunteers</Button><Button variant="textLink" disabled={busy || (!selected.length && !activeTeamIds.length)} onClick={clearSelection}>Clear selection</Button></div>
        <Input label="Search volunteers" value={memberSearch} onChange={(value) => setMemberSearch(String(value))} placeholder="Search by name" />
        <div role="list" aria-label="Volunteers" className="max-h-40 overflow-y-auto rounded border border-gray-700 divide-y divide-gray-700">{shownMembers.map((member) => {
          const eligible = Boolean(pageData.smsEligibilityByMemberId?.[member.memberId]?.eligible);
          const eligibilityStatus = pageData.smsEligibilityByMemberId?.[member.memberId]?.status;
          const eligibilityLabel = eligibilityStatus === "consent_needed" ? "Consent needed" : eligibilityStatus === "opted_out" ? "Opted out" : eligibilityStatus === "no_mobile" ? "No mobile number" : "Not eligible";
          return <div role="listitem" key={member.memberId} className="flex items-center justify-between gap-2 px-3 py-2"><Checkbox label={memberName(member)} checked={selectedSet.has(member.memberId)} disabled={busy || (!eligible && !selectedSet.has(member.memberId))} onCheckedChange={(checked) => changeSelection([member.memberId], checked === true)} />{!eligible ? <span className="shrink-0 text-xs text-amber-200">{eligibilityLabel}</span> : null}</div>;
        })}{!shownMembers.length ? <p className="px-3 py-3 text-sm text-gray-400">No volunteers match this search.</p> : null}</div>
        <p aria-live="polite" className="text-xs text-gray-300">{selected.length} selected · {selectedEligibleMembers.length} eligible · {excludedSelectedCount} excluded{hiddenCount ? ` · ${hiddenCount} hidden by search` : ""}</p>
        {selectedMissingCount ? <p role="status" className="text-xs text-amber-200">Some saved recipients are no longer available. Clear the selection or update it to continue.</p> : null}
        <div><TextArea label="Message" value={message} maxLength={1500} disabled={busy} onChange={(value) => { setMessage(value); setReview(null); setReviewMode(null); }} placeholder="Reminder: Praise Team practice is Friday at 6 PM." textareaClassName="min-h-28 bg-gray-950 p-3" /><p className="mt-1 text-xs text-gray-400">{[...message].length} characters · about {estimate.segmentCount} SMS segment{estimate.segmentCount === 1 ? "" : "s"}. {estimate.segmentCount > 1 ? "Long texts may arrive in several parts. " : ""}The final text includes Reply STOP to opt out.</p></div>
        {singleRecipient ? <div className="space-y-2 rounded border border-gray-700 bg-gray-950 p-3 text-sm">
          <p><strong className="text-white">To:</strong> {memberName(singleRecipient)} {maskedPhoneFor(singleRecipient.phoneNumber)}</p>
          <p className="font-medium text-white">Message</p>
          <p className="whitespace-pre-wrap break-words">{finalText || "Your message will appear here."}</p>
        </div> : null}
        <p className="text-xs text-gray-400">Replies are not monitored in Messages.</p>
        {busy ? <p role="status" className="text-sm text-sky-200">{oneEligibleRecipient ? "Preparing and sending your message…" : "Preparing the message for review…"}</p> : null}
        <div className="sticky bottom-0 z-10 -mx-4 -mb-4 flex justify-end gap-2 border-t border-gray-700 bg-gray-800 px-4 py-3"><Button variant="secondary" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button><Button disabled={busy || !selected.length || !selectedEligibleMembers.length || !message.trim() || selectedMissingCount > 0} isLoading={busy} onClick={() => void sendFromComposer()}>{sendLabel}</Button></div>
      </> : <>
        {reviewMode === "bulk" ? <h3 className="font-semibold text-white">Send this message to {review.summary.eligible} volunteer{review.summary.eligible === 1 ? "" : "s"}?</h3> : <h3 className="font-semibold text-white">Review the updated recipient details</h3>}
        {review.selectedMemberIds.length === 1 ? <p><strong className="text-white">To:</strong> {review.recipients[0]?.memberName || "Volunteer"} {review.recipients[0]?.maskedPhoneNumber || ""}</p> : null}
        <p className="text-sm">{review.summary.eligible} eligible · {review.summary.excluded} excluded · {review.summary.totalSegments} estimated SMS segment{review.summary.totalSegments === 1 ? "" : "s"}</p>
        <div className="max-h-[30vh] overflow-y-auto whitespace-pre-wrap break-words rounded border border-gray-700 bg-gray-950 p-3 text-sm">{review.message}</div>
        {review.summary.excluded > 0 ? <p className="text-sm text-amber-200">Some selected volunteers can’t receive this message. Their eligibility details are listed below.</p> : null}
        <details className="rounded border border-gray-700">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-white">Show recipients</summary>
          <div className="max-h-48 divide-y divide-gray-700 overflow-y-auto text-sm">{review.recipients.map((row) => <div key={row.memberId} className="flex flex-wrap justify-between gap-2 px-3 py-2"><span>{row.memberName} {row.maskedPhoneNumber}</span><span className={row.eligible ? "text-emerald-200" : "text-amber-200"}>{reviewRecipientStatus(row)}</span></div>)}</div>
        </details>
        {busy ? <p role="status" className="text-sm text-sky-200">Sending your message…</p> : null}
        <div className="sticky bottom-0 z-10 -mx-4 -mb-4 flex justify-end gap-2 border-t border-gray-700 bg-gray-800 px-4 py-3"><Button variant="secondary" disabled={busy} onClick={() => { setReview(null); setReviewMode(null); setError(""); }}>Cancel</Button><Button disabled={busy || !review.summary.eligible} isLoading={busy} onClick={() => void confirmReview()}>{reviewButtonLabel}</Button></div>
      </>}
      {error ? <p role="alert" className="text-sm text-red-200">{error}</p> : null}
      </div>
    </Modal>
  </main>;
};

const TeamsMessagesPage = () => {
  const { churchId } = useTeamsPage();
  const auth = useContext(GlobalInfoContext);
  const sessionKind = auth?.sessionKind || "";
  const administratorId = sessionKind === "human" ? auth?.userId || "" : "";
  const draftStorageKey = administratorId
    ? `worshipsync:custom-message-draft:v1:${encodeURIComponent(churchId)}:${encodeURIComponent(administratorId)}`
    : "";
  return <TeamsMessagesPageView key={`${churchId}:${sessionKind}:${administratorId}`} draftStorageKey={draftStorageKey} />;
};

export default TeamsMessagesPage;
