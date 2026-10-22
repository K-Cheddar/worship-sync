import { useEffect, useMemo, useRef, useState } from "react";
import Modal from "../../../components/Modal/Modal";
import Button from "../../../components/Button/Button";
import Checkbox from "../../../components/Checkbox/Checkbox";
import Input from "../../../components/Input/Input";
import { dispatchAvailabilityNotificationBatch, getAvailabilityNotificationBatch, getMessageHistory, prepareCustomMessage, type MessageHistoryEntry } from "../../../api/auth";
import type { NotificationBatch } from "../../../api/authTypes";
import { useTeamsPage } from "../TeamsPageContext";
import { measureMessage } from "../smsEstimate";

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
const newKey = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const TeamsMessagesPage = () => {
  const { churchId, pageData, canEditTeams, canEditTeam } = useTeamsPage();
  const [entries, setEntries] = useState<MessageHistoryEntry[]>([]);
  const [cursor, setCursor] = useState("");
  const [loading, setLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [expanded, setExpanded] = useState("");
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [memberSearch, setMemberSearch] = useState("");
  const [message, setMessage] = useState("");
  const [review, setReview] = useState<NotificationBatch | null>(null);
  const [sendEnabled, setSendEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [recoverableId, setRecoverableId] = useState("");
  const sendLock = useRef(false);
  const churchRef = useRef(churchId);
  churchRef.current = churchId;

  const teamIdsByMember = useMemo(() => {
    const positionTeams = new Map(pageData.positions.map((position) => [position.positionId, position.teamId]));
    return new Map(pageData.members.map((member) => [member.memberId, new Set([
      ...Object.keys(member.teamMemberships || {}),
      ...(member.positionIds || []).map((id) => positionTeams.get(id)).filter((id): id is string => Boolean(id)),
      ...pageData.teams.filter((team) => (team.memberIds || []).includes(member.memberId)).map((team) => team.teamId),
    ])]));
  }, [pageData.members, pageData.positions, pageData.teams]);
  const teams = pageData.teams.filter((team) => !team.archivedAt && (canEditTeams || canEditTeam(team.teamId)));
  const members = pageData.members.filter((member) => !member.archivedAt &&
    (canEditTeams || [...(teamIdsByMember.get(member.memberId) || [])].some(canEditTeam)))
    .sort((a, b) => memberName(a).localeCompare(memberName(b)));
  const shownMembers = members.filter((member) => memberName(member).toLowerCase().includes(memberSearch.trim().toLowerCase()));
  const selectedSet = new Set(selected);
  const hiddenCount = selected.filter((id) => !shownMembers.some((member) => member.memberId === id)).length;
  const finalText = message.trim() ? /\bReply STOP to opt out\.?$/i.test(message.trim())
    ? message.trim() : `${message.trim()} Reply STOP to opt out.` : "";
  const estimate = measureMessage(finalText);

  const refresh = async (older = "") => {
    const owner = churchId;
    setLoading(true);
    setHistoryError("");
    try {
      const response = await getMessageHistory(owner, older);
      if (churchRef.current !== owner) return;
      setEntries((current) => older ? [...current, ...response.entries.filter((item) => !current.some((old) => old.historyId === item.historyId))] : response.entries);
      setCursor(response.nextCursor);
    } catch (caught) {
      if (churchRef.current === owner) setHistoryError(caught instanceof Error ? caught.message : "Could not load message history.");
    } finally {
      if (churchRef.current === owner) setLoading(false);
    }
  };
  useEffect(() => {
    setEntries([]);
    setCursor("");
    setReview(null);
    setOpen(false);
    setRecoverableId(window.localStorage.getItem(`worshipsync:last-custom-message:${churchId}`) || "");
    void refresh();
    // The church is the owner of loaded history and unsent reviews.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [churchId]);

  const changeSelection = (ids: string[], checked: boolean) => {
    setSelected((current) => checked ? [...new Set([...current, ...ids])] : current.filter((id) => !ids.includes(id)));
    setReview(null);
  };
  const prepare = async () => {
    if (busy || !selected.length || !message.trim()) return;
    const owner = churchId;
    setBusy(true);
    setError("");
    try {
      const response = await prepareCustomMessage(owner, { memberIds: selected, message, requestKey: newKey() });
      if (churchRef.current !== owner) return;
      setReview(response.batch);
      setSendEnabled(response.enabled);
      window.localStorage.setItem(`worshipsync:last-custom-message:${owner}`, response.batch.batchId);
      setRecoverableId(response.batch.batchId);
    } catch (caught) {
      if (churchRef.current === owner) setError(caught instanceof Error ? caught.message : "Could not prepare this message.");
    } finally {
      if (churchRef.current === owner) setBusy(false);
    }
  };
  const send = async () => {
    if (!review || busy || sendLock.current || !sendEnabled || !review.summary.eligible) return;
    const owner = churchId;
    const batch = review;
    sendLock.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await dispatchAvailabilityNotificationBatch(owner, batch.batchId, batch.approvalVersion);
      if (churchRef.current !== owner) return;
      setReview(response.batch);
      setOpen(false);
      window.localStorage.removeItem(`worshipsync:last-custom-message:${owner}`);
      setRecoverableId("");
      setNotice("Message sending finished. Check delivery status below.");
      void refresh();
    } catch (caught) {
      if (churchRef.current !== owner) return;
      setError("Could not confirm the send result. Checking saved message status.");
      try {
        const response = await getAvailabilityNotificationBatch(owner, batch.batchId);
        if (churchRef.current === owner) {
          setReview(response.batch);
          setError(response.batch.status === "prepared" ? "No send was recorded. Review and try again."
            : "The send result is uncertain. Check message history before starting another message.");
        }
      } catch {
        if (churchRef.current === owner) setError(caught instanceof Error ? caught.message : "Could not check message status.");
      }
    } finally {
      sendLock.current = false;
      if (churchRef.current === owner) setBusy(false);
    }
  };

  const filtered = entries.filter((entry) => (!typeFilter || entry.messageType === typeFilter) &&
    (!statusFilter || entry.status === statusFilter) &&
    (!search.trim() || `${entry.summary} ${entry.recipients.map((row) => row.memberName).join(" ")}`.toLowerCase().includes(search.trim().toLowerCase())));

  return <main data-mobile-header-scroll-owner="page" className="mx-auto w-full max-w-5xl space-y-5 overflow-y-auto p-4 sm:p-6" aria-labelledby="messages-heading">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 id="messages-heading" className="text-xl font-semibold text-white">Messages</h1>
      <p className="text-sm text-gray-300">Send text messages to your volunteers.</p></div>
      <Button disabled={!canEditTeams && !teams.length} onClick={() => { setSelected([]); setMessage(""); setReview(null); setError(""); setOpen(true); }}>+ New message</Button></header>
    {notice ? <p role="status" className="text-sm text-sky-200">{notice}</p> : null}
    {recoverableId ? <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-gray-700 p-3 text-sm text-gray-200"><span>An earlier message review may still need attention.</span><Button variant="textLink" onClick={() => {
      const owner = churchId;
      setBusy(true);
      void getAvailabilityNotificationBatch(owner, recoverableId).then((response) => {
        if (churchRef.current !== owner) return;
        setReview(response.batch);
        setSendEnabled(Boolean(response.enabled));
        setOpen(true);
      }).catch((caught) => { if (churchRef.current === owner) setHistoryError(caught instanceof Error ? caught.message : "Could not restore this message."); })
        .finally(() => { if (churchRef.current === owner) setBusy(false); });
    }}>Review saved message</Button></div> : null}
    <section className="space-y-3" aria-labelledby="history-heading"><div className="flex justify-between"><h2 id="history-heading" className="font-semibold text-white">Message history</h2>
      <Button variant="textLink" disabled={loading} onClick={() => void refresh()}>Refresh</Button></div>
      <div className="grid gap-2 sm:grid-cols-3"><Input label="Search messages" value={search} onChange={(value) => setSearch(String(value))} placeholder="Search messages or volunteers" />
        <label className="text-sm text-gray-300">Type<select aria-label="Message type" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className="mt-1 w-full rounded border border-gray-600 bg-gray-900 p-2 text-white"><option value="">All types</option>{Object.entries(typeLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="text-sm text-gray-300">Status<select aria-label="Message status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="mt-1 w-full rounded border border-gray-600 bg-gray-900 p-2 text-white"><option value="">All statuses</option>{["accepted", "delivered", "failed", "unconfirmed", "sending", "not_sent"].map((value) => <option key={value} value={value}>{statusLabel(value as MessageHistoryEntry["status"])}</option>)}</select></label></div>
      {historyError ? <p role="alert" className="text-sm text-amber-200">{historyError} <Button variant="textLink" onClick={() => void refresh()}>Try again</Button></p> : null}
      {loading && !entries.length ? <p role="status" className="text-sm text-gray-400">Loading message history…</p> : null}
      {!loading && !filtered.length ? <p className="rounded border border-gray-700 p-4 text-sm text-gray-400">No messages match these filters.</p> : null}
      <div className="space-y-2">{filtered.map((entry) => <article key={entry.historyId} className="rounded-lg border border-gray-700 bg-gray-900/50 p-3"><button type="button" className="flex w-full flex-wrap items-center justify-between gap-2 text-left" aria-expanded={expanded === entry.historyId} onClick={() => setExpanded(expanded === entry.historyId ? "" : entry.historyId)}>
        <span className="min-w-0 flex-1"><span className="block truncate font-medium text-white">{entry.summary || typeLabel[entry.messageType] || "Message"}</span><span className="text-xs text-gray-400">{typeLabel[entry.messageType] || "Message"} · {new Date(entry.createdAt).toLocaleDateString()} · {entry.recipientCount} recipient{entry.recipientCount === 1 ? "" : "s"}</span></span><span className="text-xs text-gray-200">{statusLabel(entry.status)}</span></button>
        {expanded === entry.historyId ? <div className="mt-3 space-y-2 border-t border-gray-700 pt-3 text-sm">{entry.recipients.map((row) => <div key={row.memberId} className="flex flex-wrap justify-between gap-2 text-gray-300"><span>{row.memberName}</span><span>{recipientStatus(row)}{row.failureMessage ? ` · ${row.failureMessage}` : ""}</span></div>)}</div> : null}</article>)}</div>
      {cursor ? <Button variant="secondary" disabled={loading} isLoading={loading} onClick={() => void refresh(cursor)}>Load older messages</Button> : null}</section>
    <Modal isOpen={open} onClose={() => { if (!busy) setOpen(false); }} busy={busy} title={review ? "Review message" : "New message"} description="Choose volunteers, write a text, and review it before sending." size="lg"><div className="space-y-4 text-gray-200">
      {!review ? <><div><h3 className="font-medium text-white">Recipients</h3><p className="text-xs text-gray-400">Choose people, teams, or all eligible volunteers.</p></div>
        <div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={busy} onClick={() => changeSelection(members.filter((member) => pageData.smsEligibilityByMemberId?.[member.memberId]?.eligible).map((member) => member.memberId), true)}>Select all eligible</Button><Button variant="textLink" disabled={busy || !selected.length} onClick={() => changeSelection(selected, false)}>Clear selection</Button></div>
        {teams.length ? <div className="flex flex-wrap gap-3" aria-label="Teams">{teams.map((team) => { const ids = members.filter((member) => teamIdsByMember.get(member.memberId)?.has(team.teamId)).map((member) => member.memberId); return <Checkbox key={team.teamId} label={team.name} checked={ids.length > 0 && ids.every((id) => selectedSet.has(id))} disabled={busy || !ids.length} onCheckedChange={(checked) => changeSelection(ids, checked === true)} />; })}</div> : null}
        <Input label="Search volunteers" value={memberSearch} onChange={(value) => setMemberSearch(String(value))} placeholder="Search by name" />
        <div role="list" aria-label="Volunteers" className="max-h-48 overflow-y-auto rounded border border-gray-700 divide-y divide-gray-700">{shownMembers.map((member) => <div role="listitem" key={member.memberId} className="flex items-center justify-between gap-2 px-3 py-2"><Checkbox label={memberName(member)} checked={selectedSet.has(member.memberId)} disabled={busy} onCheckedChange={(checked) => changeSelection([member.memberId], checked === true)} />{!pageData.smsEligibilityByMemberId?.[member.memberId]?.eligible ? <span className="text-xs text-amber-200">Not eligible</span> : null}</div>)}</div>
        <p aria-live="polite" className="text-xs text-gray-300">{selected.length} selected{hiddenCount ? ` · ${hiddenCount} hidden by search` : ""}</p>
        <label className="block space-y-1 text-sm">Message<textarea aria-label="Message" className="min-h-28 w-full rounded border border-gray-600 bg-gray-950 p-3 text-white" value={message} maxLength={1500} disabled={busy} onChange={(event) => setMessage(event.target.value)} placeholder="Reminder: Praise Team practice is Friday at 6 PM." /></label>
        <p className="text-xs text-gray-400">{[...message].length} characters · about {estimate.segmentCount} SMS segment{estimate.segmentCount === 1 ? "" : "s"}. {estimate.segmentCount > 1 ? "Long texts may arrive in several parts. " : ""}The final text includes Reply STOP to opt out.</p><p className="text-xs text-gray-400">Replies are not monitored in Messages.</p>
        <div className="flex justify-end gap-2"><Button variant="secondary" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button><Button disabled={busy || !selected.length || !message.trim()} isLoading={busy} onClick={() => void prepare()}>Review message</Button></div></> : <>
        <p className="text-sm">{review.summary.eligible} eligible · {review.summary.excluded} excluded · about {review.summary.totalSegments} SMS segments</p><div className="rounded border border-gray-700 bg-gray-950 p-3 text-sm whitespace-pre-wrap">{review.message}</div>
        <div className="max-h-48 space-y-1 overflow-y-auto text-sm">{review.recipients.map((row) => <div key={row.memberId} className="flex justify-between gap-2"><span>{row.memberName} {row.maskedPhoneNumber}</span><span>{row.eligible ? "Ready" : row.exclusionReason || "Not eligible"}</span></div>)}</div>
        {!sendEnabled ? <p role="status" className="text-sm text-amber-200">Custom volunteer texts are awaiting SMS campaign and consent approval. Sending is disabled.</p> : null}
        <div className="flex justify-end gap-2"><Button variant="secondary" disabled={busy} onClick={() => setReview(null)}>Back</Button><Button variant="secondary" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button><Button disabled={busy || !sendEnabled || !review.summary.eligible} isLoading={busy} onClick={() => void send()}>Send {review.summary.eligible} messages</Button></div></>}
      {error ? <p role="alert" className="text-sm text-red-200">{error}</p> : null}</div></Modal>
  </main>;
};

export default TeamsMessagesPage;
