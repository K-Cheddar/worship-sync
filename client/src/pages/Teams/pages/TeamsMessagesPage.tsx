import { useEffect, useMemo, useRef, useState } from "react";
import Button from "../../../components/Button/Button";
import Checkbox from "../../../components/Checkbox/Checkbox";
import Select from "../../../components/Select/Select";
import {
  getNotificationIntents,
  previewAvailabilityNotifications,
  sendNotificationIntent,
} from "../../../api/auth";
import type { NotificationIntent, NotificationIntentType } from "../../../api/authTypes";
import { useTeamsPage } from "../TeamsPageContext";

const memberName = (member: { firstName?: string; lastName?: string }) =>
  [member.firstName, member.lastName].filter(Boolean).join(" ") || "Volunteer";

const intentLabel = (intent: NotificationIntent) => {
  if (intent.intentType === "availability_request") return "Availability request";
  if (intent.intentType === "availability_reminder") return "Availability reminder";
  return intent.intentType.replaceAll("_", " ");
};

const statusLabel: Record<NotificationIntent["status"], string> = {
  preview: "Preview",
  ready: "Ready",
  sending: "Sending",
  sent: "Sent",
  failed: "Failed · review before retry",
  unknown: "Uncertain · check SMS history",
  suppressed: "Not sent",
};

const TeamsMessagesPage = () => {
  const { churchId, pageData, canEditTeams } = useTeamsPage();
  const churchIdRef = useRef(churchId);
  churchIdRef.current = churchId;
  const [intentType, setIntentType] = useState<
    Extract<NotificationIntentType, "availability_request" | "availability_reminder">
  >("availability_request");
  const [scheduleId, setScheduleId] = useState("");
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [intents, setIntents] = useState<NotificationIntent[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const schedules = useMemo(
    () => pageData.schedules.filter((schedule) => !schedule.archivedAt),
    [pageData.schedules],
  );
  const members = useMemo(
    () => [...pageData.members]
      .filter((member) => !member.archivedAt)
      .sort((a, b) => memberName(a).localeCompare(memberName(b))),
    [pageData.members],
  );

  useEffect(() => {
    let active = true;
    if (!churchId || !canEditTeams) return () => { active = false; };
    setIntents([]);
    setError("");
    setLoading(true);
    getNotificationIntents(churchId)
      .then((response) => { if (active) setIntents(response.intents); })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Could not load message previews."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [churchId, canEditTeams]);

  const refreshIntents = async () => {
    const requestedChurchId = churchId;
    const response = await getNotificationIntents(requestedChurchId);
    if (churchIdRef.current === requestedChurchId) setIntents(response.intents);
  };

  const toggleMember = (memberId: string, checked: boolean) => {
    setSelectedMemberIds((current) => checked
      ? [...new Set([...current, memberId])]
      : current.filter((id) => id !== memberId));
  };

  const makePreview = async () => {
    setError("");
    setNotice("");
    setLoading(true);
    try {
      const response = await previewAvailabilityNotifications(churchId, {
        intentType,
        scheduleId,
        memberIds: selectedMemberIds,
      });
      if (churchIdRef.current !== churchId) return;
      const latest = await getNotificationIntents(churchId);
      if (churchIdRef.current !== churchId) return;
      setIntents(latest.intents);
      setNotice(`${response.intents.length} message preview${response.intents.length === 1 ? "" : "s"} ready. Nothing has been sent.`);
    } catch (caught) {
      if (churchIdRef.current === churchId) setError(caught instanceof Error ? caught.message : "Could not prepare the message previews.");
    } finally {
      if (churchIdRef.current === churchId) setLoading(false);
    }
  };

  const sendPreview = async (intent: NotificationIntent) => {
    setError("");
    setNotice("");
    setSending(true);
    try {
      const response = await sendNotificationIntent(churchId, intent.intentId);
      if (churchIdRef.current !== churchId) return;
      if (!response.success) {
        setError(response.errorMessage || "This message was not confirmed as sent.");
      } else {
        setNotice(`SMS sent to ${memberName(members.find((member) => member.memberId === intent.memberId) || {})}.`);
      }
      await refreshIntents();
      if (churchIdRef.current !== churchId) return;
    } catch (caught) {
      if (churchIdRef.current === churchId) setError(caught instanceof Error ? caught.message : "Could not send this message.");
      await refreshIntents().catch(() => undefined);
    } finally {
      if (churchIdRef.current === churchId) setSending(false);
    }
  };

  const sendAllPreviews = async () => {
    const pending = intents.filter((intent) =>
      ["availability_request", "availability_reminder"].includes(intent.intentType) &&
      ["preview", "ready"].includes(intent.status),
    );
    if (!pending.length) return;
    setError("");
    setNotice(`Sending 1 of ${pending.length} messages…`);
    setSending(true);
    let sent = 0;
    let failed = 0;
    try {
      for (const [index, intent] of pending.entries()) {
        setNotice(`Sending ${index + 1} of ${pending.length}…`);
        if (churchIdRef.current !== churchId) break;
        try {
          const response = await sendNotificationIntent(churchId, intent.intentId);
          if (response.success) sent += 1;
          else failed += 1;
        } catch {
          failed += 1;
        }
        if (churchIdRef.current === churchId) await refreshIntents().catch(() => undefined);
      }
      setNotice(`Finished: ${sent} sent, ${failed} need review. No message was sent without this approval.`);
    } finally {
      if (churchIdRef.current === churchId) setSending(false);
    }
  };

  if (!canEditTeams) {
    return <div className="p-6 text-sm text-gray-300">Teams edit permission is required to prepare or send volunteer messages.</div>;
  }

  const pendingCount = intents.filter((intent) =>
    ["availability_request", "availability_reminder"].includes(intent.intentType) &&
        ["preview", "ready"].includes(intent.status) && intent.previewEligible !== false,
  ).length;

  return (
    <main className="mx-auto w-full max-w-5xl space-y-5 overflow-y-auto p-4 sm:p-6" aria-labelledby="teams-messages-heading">
      <header className="space-y-1">
        <h1 id="teams-messages-heading" className="text-xl font-semibold text-white">Volunteer messages</h1>
        <p className="text-sm text-gray-300">Review each SMS before sending. Schedule events can create previews, but this page is the only way to send them.</p>
      </header>

      <section className="space-y-4 rounded-lg border border-gray-700 bg-gray-900/60 p-4" aria-labelledby="availability-preview-heading">
        <div>
          <h2 id="availability-preview-heading" className="font-semibold text-white">Availability SMS</h2>
          <p className="mt-1 text-sm text-gray-400">Choose volunteers and prepare a preview. Consent and schedule status are checked again when you send.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Message"
            value={intentType}
            onChange={(value) => setIntentType(value as typeof intentType)}
            options={[
              { value: "availability_request", label: "Request availability" },
              { value: "availability_reminder", label: "Remind about availability" },
            ]}
          />
          <Select
            label="Schedule"
            value={scheduleId}
            onChange={setScheduleId}
            options={schedules.map((schedule) => ({
              value: schedule.scheduleId,
              label: `${schedule.name} · ${schedule.startDate || "Dates pending"}`,
            }))}
          />
        </div>
        <div className="max-h-64 space-y-2 overflow-y-auto rounded border border-gray-700 p-3">
          {members.length ? members.map((member) => (
            <Checkbox
              key={member.memberId}
              label={memberName(member)}
              checked={selectedMemberIds.includes(member.memberId)}
              onCheckedChange={(checked) => toggleMember(member.memberId, checked)}
            />
          )) : <p className="text-sm text-gray-400">No active volunteers are available.</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={loading || sending || !scheduleId || selectedMemberIds.length === 0}
            isLoading={loading}
            onClick={() => void makePreview()}
          >Prepare preview</Button>
          {pendingCount > 0 ? (
            <Button disabled={loading || sending} isLoading={sending} onClick={() => void sendAllPreviews()}>
              Approve and send {pendingCount}
            </Button>
          ) : null}
          <Button variant="textLink" disabled={loading || sending} onClick={() => { setLoading(true); refreshIntents().catch((caught) => setError(caught instanceof Error ? caught.message : "Could not refresh previews.")).finally(() => setLoading(false)); }}>
            Refresh previews
          </Button>
        </div>
        {error ? <p role="alert" className="text-sm text-red-200">{error}</p> : null}
        {notice ? <p role="status" className="text-sm text-sky-200">{notice}</p> : null}
      </section>

      <section className="space-y-3" aria-labelledby="preview-list-heading">
        <h2 id="preview-list-heading" className="font-semibold text-white">Message previews and history</h2>
        {loading && !intents.length ? <p className="text-sm text-gray-400">Loading message history…</p> : null}
        {!intents.length && !loading ? <p className="rounded border border-gray-700 p-4 text-sm text-gray-400">No volunteer message previews yet.</p> : null}
        {intents.map((intent) => {
          const member = members.find((item) => item.memberId === intent.memberId);
          const actionable = ["preview", "ready", "failed"].includes(intent.status) && intent.previewEligible !== false;
          return (
            <article key={intent.intentId} className="space-y-2 rounded border border-gray-700 bg-gray-950/50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-medium text-white">{intentLabel(intent)} · {member ? memberName(member) : "Roster member"}</h3>
                  <p className="text-xs text-gray-400">{new Date(intent.createdAt).toLocaleString()} · {statusLabel[intent.status]}</p>
                </div>
                {actionable ? <Button disabled={sending || loading} isLoading={sending} onClick={() => void sendPreview(intent)}>Approve and send</Button> : null}
              </div>
              <p className="rounded bg-gray-900 px-3 py-2 text-sm text-gray-200">{intent.message}</p>
              {intent.previewError ? <p className="text-sm text-amber-200">Not ready to send: {intent.previewError}</p> : null}
              {intent.attemptId ? <p className="text-xs text-gray-400">Delivery record: {intent.attemptStatus || "pending"}{intent.attemptOutcome ? ` · ${intent.attemptOutcome}` : ""}</p> : null}
            </article>
          );
        })}
      </section>
    </main>
  );
};

export default TeamsMessagesPage;
