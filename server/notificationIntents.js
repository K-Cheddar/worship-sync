import { isChurchMessagingReady, normalizeChurchMessagingConfig } from "./churchMessagingConfig.js";
import { resolveSmsMemberEligibility } from "./smsEligibility.js";
import { smsConsentIdForChurchPhone } from "./smsConsent.js";
import { normalizeSmsDeliveryStatus } from "./smsDeliveryAttempts.js";
import { deliveryKey as notificationDeliveryKey } from "./notificationLedger.js";

export const NOTIFICATION_INTENT_TYPES = Object.freeze([
  "availability_request",
  "availability_reminder",
  "assignment_notification",
  "assignment_confirmation",
  "schedule_change",
  "replacement_request",
]);

export const NOTIFICATION_INTENT_STATUSES = Object.freeze([
  "preview",
  "ready",
  "sending",
  "sent",
  "failed",
  "unknown",
  "suppressed",
]);
export const NOTIFICATION_SEND_STALE_AFTER_MS = 2 * 60 * 1000;

// This foundation has no automatic send path. Keep this server-side kill
// switch hard-disabled until a separately reviewed product change authorizes it.
export const AUTOMATIC_NOTIFICATION_SENDS_DISABLED = true;

const normalize = (value) => String(value ?? "").trim();
const intentIdFor = (hashValue, churchId, idempotencyKey) =>
  hashValue(`${churchId}|notification-intent|${idempotencyKey}`);

export const createNotificationIntent = ({
  churchId,
  intentType,
  sourceType,
  sourceId,
  sourceVersion = "",
  memberId,
  occurrenceId = "",
  cellKey = "",
  idempotencyKey,
  message,
  now,
}) => {
  const normalizedChurchId = normalize(churchId);
  const normalizedType = normalize(intentType);
  const normalizedMemberId = normalize(memberId);
  if (
    !normalizedChurchId ||
    !NOTIFICATION_INTENT_TYPES.includes(normalizedType) ||
    !normalize(sourceType) ||
    !normalize(sourceId) ||
    !normalizedMemberId ||
    !normalize(idempotencyKey) ||
    !normalize(message)
  ) {
    throw new Error("A valid church, source, member, event, and message are required.");
  }
  return {
    churchId: normalizedChurchId,
    intentType: normalizedType,
    sourceType: normalize(sourceType),
    sourceId: normalize(sourceId),
    sourceVersion: normalize(sourceVersion),
    memberId: normalizedMemberId,
    occurrenceId: normalize(occurrenceId),
    cellKey: normalize(cellKey),
    idempotencyKey: normalize(idempotencyKey),
    channel: "sms",
    message: normalize(message),
    status: "preview",
    createdAt: now,
    updatedAt: now,
  };
};

export const createNotificationIntentHandlers = ({
  COLLECTIONS,
  assertCsrf,
  createId,
  getDoc,
  hashValue,
  httpError,
  nowIso,
  queryDocs,
  requireFirestore,
  requireTeamsEdit,
  getSmsConsentForChurchPhone,
  smsProviderFactory,
  validateTwilioStatusCallbackUrl,
  setDoc,
  automaticSendsDisabled = AUTOMATIC_NOTIFICATION_SENDS_DISABLED,
}) => {
  const memoryClaims = new Map();
  const runMemoryClaim = (id, task) => {
    const previous = memoryClaims.get(id) || Promise.resolve();
    const current = previous.then(task, task);
    memoryClaims.set(id, current.then(() => undefined, () => undefined));
    return current;
  };

  const listChurchDocs = (collection, churchId) =>
    queryDocs(collection, [{ field: "churchId", value: churchId }], { limit: 5000 });

  const messageFor = ({ intentType, church, schedule, occurrence }) => {
    const churchName = normalize(church?.name) || "Your church";
    const serviceName = normalize(occurrence?.name) || "an upcoming service";
    const date = occurrence?.startsAt
      ? new Date(occurrence.startsAt).toLocaleDateString("en-US", {
          weekday: "short", month: "short", day: "numeric",
        })
      : "an upcoming date";
    const scheduleName = normalize(schedule?.name) || "upcoming services";
    const scheduleDates = [...new Set((schedule?.occurrences || [])
      .map((item) => item?.startsAt ? new Date(item.startsAt).toLocaleDateString("en-US", {
        month: "short", day: "numeric",
      }) : "")
      .filter(Boolean))];
    const availabilityDates = [
      ...scheduleDates.slice(0, 6),
      ...(scheduleDates.length > 6 ? ["and more"] : []),
    ].join(", ");
    switch (intentType) {
      case "availability_request":
        return `${churchName}: Please share your availability for ${scheduleName}${availabilityDates ? ` (${availabilityDates})` : ""}. Contact your team lead to respond.`;
      case "availability_reminder":
        return `${churchName}: Reminder to share your availability for ${scheduleName}${availabilityDates ? ` (${availabilityDates})` : ""}. Contact your team lead to respond.`;
      case "assignment_notification":
        return `${churchName}: You have a volunteer assignment for ${serviceName} on ${date}. Check your schedule or contact your team lead.`;
      case "assignment_confirmation":
        return `${churchName}: Your response for ${serviceName} on ${date} was recorded. Contact your team lead if it needs to change.`;
      case "schedule_change":
        return `${churchName}: Your volunteer schedule changed for ${serviceName} on ${date}. Check with your team lead for details.`;
      case "replacement_request":
        return `${churchName}: Your assignment for ${serviceName} on ${date} changed. Contact your team lead if you need details.`;
      default:
        return "";
    }
  };

  const getSource = async (churchId, sourceType, sourceId) => {
    if (sourceType === "team_schedule") {
      const schedule = await getDoc(COLLECTIONS.teamSchedules, sourceId);
      if (!schedule || schedule.churchId !== churchId) return null;
      return { schedule };
    }
    return null;
  };

  const validateIntent = async (intent, { requireConsent = true, records = null } = {}) => {
    if (!intent || !NOTIFICATION_INTENT_TYPES.includes(intent.intentType)) {
      throw httpError(404, "Message preview not found.");
    }
    if (intent.sourceType !== "team_schedule") {
      throw httpError(409, "The source for this message is not supported.");
    }
    const churchId = normalize(intent.churchId);
    const [{ schedule } = {}, members, church, config] = records
      ? [
          { schedule: records.schedule },
          [records.member],
          records.church,
          records.config,
        ]
      : await Promise.all([
          getSource(churchId, intent.sourceType, intent.sourceId),
          listChurchDocs(COLLECTIONS.teamRosterMembers, churchId),
          getDoc(COLLECTIONS.churches, churchId),
          getDoc(COLLECTIONS.churchMessagingConfigs, churchId),
        ]);
    if (!schedule || schedule.archivedAt || !church) throw httpError(409, "The source schedule is no longer available.");
    const member = (members || []).find((item) => item?.memberId === intent.memberId);
    if (!member || member.churchId !== churchId || member.archivedAt) throw httpError(409, "This volunteer is no longer active on this church roster.");
    const occurrence = (schedule.occurrences || []).find(
      (item) => item?.occurrenceId === intent.occurrenceId,
    );
    if (!occurrence) throw httpError(409, "This service occurrence has changed or was removed.");
    const cell = (schedule.assignments?.[intent.occurrenceId] || {})[intent.cellKey];
    const holderId = typeof cell === "string" ? cell : cell?.primaryMemberId || "";
      if (intent.intentType === "assignment_notification" && !schedule.sentAt) {
        throw httpError(409, "This assignment has not been published yet.");
      }
    if (["assignment_notification", "assignment_confirmation", "schedule_change"].includes(intent.intentType) && holderId !== intent.memberId) {
      throw httpError(409, "This volunteer is no longer assigned to that service.");
    }
    if (intent.intentType === "replacement_request") {
      const response = schedule.responses?.[intent.occurrenceId]?.[intent.cellKey];
      const declinedByOriginalHolder = holderId === intent.memberId && response?.response === "declined";
      if (holderId && holderId !== intent.memberId) {
        throw httpError(409, "This service already has a replacement assigned.");
      }
      if (holderId === intent.memberId && !declinedByOriginalHolder) {
        throw httpError(409, "This service no longer needs a replacement request.");
      }
    }
    if (intent.intentType === "availability_request" && schedule.sentAt) {
      throw httpError(409, "This schedule has already been sent; availability requests are closed.");
    }
    if (intent.intentType === "availability_reminder" && !schedule.sentAt) {
      throw httpError(409, "This schedule has not been sent yet.");
    }
    const normalizedConfig = normalizeChurchMessagingConfig(config, churchId);
    if (normalizedConfig?.churchId !== churchId || !isChurchMessagingReady(normalizedConfig)) throw httpError(503, "Church SMS messaging is not configured and enabled.");
    const eligibility = resolveSmsMemberEligibility({ member, churchId, consent: null });
    const consent = eligibility.phoneNumber
      ? records
        ? records.consent
        : await getSmsConsentForChurchPhone(churchId, eligibility.phoneNumber)
      : null;
    const finalEligibility = resolveSmsMemberEligibility({ member, churchId, consent });
    if (requireConsent && !finalEligibility.eligible) {
      const messages = {
        no_mobile: "This volunteer does not have a valid mobile number.",
        consent_needed: "SMS consent is needed for this phone number.",
        opted_out: "This phone number has opted out of SMS.",
      };
      throw httpError(409, messages[finalEligibility.status]);
    }
    const currentMessage = messageFor({ intentType: intent.intentType, church, schedule, occurrence });
    if (intent.sourceVersion && intent.sourceVersion !== normalize(schedule.updatedAt)) {
      throw httpError(409, "The schedule changed after this preview. Refresh the message preview.");
    }
    if (intent.message !== currentMessage) throw httpError(409, "The message details changed. Refresh the preview.");
    return { schedule, member, church, config: normalizedConfig, occurrence, phoneNumber: finalEligibility.phoneNumber };
  };

  const saveEventIntents = async ({ churchId, schedule, entries, intentType }) => {
    if (automaticSendsDisabled !== true) {
      throw new Error("Automatic notifications are disabled by the server.");
    }
    const church = await getDoc(COLLECTIONS.churches, churchId);
    const now = nowIso();
    const saved = [];
    for (const entry of entries || []) {
      const occurrence = (schedule.occurrences || []).find((item) => item?.occurrenceId === entry.occurrenceId);
      const memberId = normalize(entry.memberId);
      if (!memberId || !occurrence) continue;
      const member = await getDoc(COLLECTIONS.teamRosterMembers, memberId);
      if (!member || member.churchId !== churchId || member.archivedAt) continue;
      const eventVersion = intentType === "assignment_notification" ? "" : normalize(schedule.updatedAt);
      const key = `${intentType}|${schedule.scheduleId}|${entry.occurrenceId}|${entry.cellKey}|${memberId}|${eventVersion}`;
      const intent = createNotificationIntent({
        churchId, intentType, sourceType: "team_schedule", sourceId: schedule.scheduleId,
        sourceVersion: eventVersion, memberId, occurrenceId: entry.occurrenceId,
        cellKey: entry.cellKey, idempotencyKey: key,
        message: messageFor({ intentType, church, schedule, occurrence }), now,
      });
      const id = intentIdFor(hashValue, churchId, key);
      const existing = await getDoc(COLLECTIONS.notificationIntents, id);
      if (!existing) {
        await setDoc(COLLECTIONS.notificationIntents, id, { intentId: id, ...intent }, { merge: false });
        saved.push({ intentId: id, ...intent });
      }
    }
    return saved;
  };

  const previewAvailability = async (req, res) => {
    try {
      await assertCsrf(req);
      const churchId = normalize(req.params.churchId);
      await requireTeamsEdit(req, churchId);
      const intentType = normalize(req.body?.intentType);
      if (!["availability_request", "availability_reminder"].includes(intentType)) throw httpError(400, "Choose an availability request or reminder.");
      const scheduleId = normalize(req.body?.scheduleId);
      const schedule = await getDoc(COLLECTIONS.teamSchedules, scheduleId);
      if (!schedule || schedule.churchId !== churchId || schedule.archivedAt) throw httpError(404, "Schedule not found.");
      const church = await getDoc(COLLECTIONS.churches, churchId);
      const memberIds = [...new Set((Array.isArray(req.body?.memberIds) ? req.body.memberIds : []).map(normalize).filter(Boolean))].slice(0, 200);
      if (!memberIds.length) throw httpError(400, "Choose at least one volunteer.");
      const members = await listChurchDocs(COLLECTIONS.teamRosterMembers, churchId);
      const eligibleMembers = members.filter((member) => memberIds.includes(member.memberId) && !member.archivedAt);
      if (eligibleMembers.length !== memberIds.length) throw httpError(404, "One or more volunteers are no longer on this church roster.");
      const occurrence = [...(schedule.occurrences || [])].sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt)))[0];
      if (!occurrence) throw httpError(409, "This schedule has no service dates.");
      const now = nowIso();
      const intents = [];
      for (const member of eligibleMembers) {
        const key = `${intentType}|${scheduleId}|${occurrence.occurrenceId}|${member.memberId}|${schedule.updatedAt || ""}`;
        const intent = createNotificationIntent({ churchId, intentType, sourceType: "team_schedule", sourceId: scheduleId,
          sourceVersion: schedule.updatedAt || "", memberId: member.memberId, occurrenceId: occurrence.occurrenceId,
          idempotencyKey: key, message: messageFor({ intentType, church, schedule, occurrence }), now });
        const intentId = intentIdFor(hashValue, churchId, key);
        const existing = await getDoc(COLLECTIONS.notificationIntents, intentId);
        const row = existing || { intentId, ...intent };
        if (!existing) await setDoc(COLLECTIONS.notificationIntents, intentId, row, { merge: false });
        intents.push(row);
      }
      return res.json({ success: true, intents });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ success: false, errorMessage: error.message || "Could not prepare these message previews." });
    }
  };

  const listIntents = async (req, res) => {
    try {
      const churchId = normalize(req.params.churchId);
      await requireTeamsEdit(req, churchId);
      const intents = await listChurchDocs(COLLECTIONS.notificationIntents, churchId);
      const enriched = await Promise.all((intents || [])
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(0, 500)
        .map(async (intent) => {
          let currentIntent = intent;
          if (intent.status === "sending") {
            const startedAt = new Date(intent.sendStartedAt || intent.approvedAt || 0).getTime();
            if (startedAt && Date.now() - startedAt > NOTIFICATION_SEND_STALE_AFTER_MS) {
              const updatedAt = nowIso();
              currentIntent = { ...intent, status: "unknown", outcome: "unknown", updatedAt };
              await setDoc(COLLECTIONS.notificationIntents, intent.intentId, {
                status: "unknown", outcome: "unknown", failureMessage: "The send was interrupted before its provider outcome could be confirmed.", updatedAt,
              }, { merge: true });
              if (intent.attemptId) {
                await setDoc(COLLECTIONS.smsDeliveryAttempts, intent.attemptId, {
                  status: "pending", outcome: "unknown", failureCode: "dispatch_interrupted",
                  failureMessage: "The send was interrupted before its provider outcome could be confirmed.", updatedAt,
                }, { merge: true });
              }
            }
          }
          try {
            await validateIntent(currentIntent);
            const attempt = currentIntent.attemptId
              ? await getDoc(COLLECTIONS.smsDeliveryAttempts, currentIntent.attemptId)
              : null;
            return {
              ...currentIntent, previewEligible: !["unknown", "sending", "sent", "suppressed"].includes(currentIntent.status),
              previewError: ["unknown", "sending", "sent", "suppressed"].includes(currentIntent.status)
                ? currentIntent.status === "unknown" ? "Provider outcome is uncertain. Review SMS delivery history before taking further action." : ""
                : "",
              ...(attempt ? { attemptStatus: attempt.status, attemptOutcome: attempt.outcome || "" } : {}),
            };
          } catch (error) {
            return { ...currentIntent, previewEligible: false, previewError: error.message || "This message needs review." };
          }
        }));
      return res.json({ success: true, intents: enriched });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ success: false, errorMessage: error.message || "Could not load message previews." });
    }
  };

  const claimIntent = async ({ intentId, churchId, actorUid, attemptId }) => {
    const db = requireFirestore();
    const claim = async (current, records = null) => {
      if (!current || current.churchId !== churchId) throw httpError(404, "Message preview not found.");
      if (current.status === "unknown" || current.status === "sending") throw httpError(409, "This send has an uncertain or active provider outcome. Review delivery history before retrying.");
      if (["sent", "suppressed"].includes(current.status)) throw httpError(409, "This message has already been handled.");
      const validated = await validateIntent(current, { records });
      if (current.status !== "preview" && current.status !== "ready" && current.status !== "failed") throw httpError(409, "This message is not ready to send.");
      const sendStartedAt = nowIso();
      const next = { ...current, status: "sending", approvedByUid: actorUid, approvedAt: sendStartedAt, sendStartedAt, updatedAt: sendStartedAt };
      return { next, validated };
    };
    if (db) {
      return db.runTransaction(async (transaction) => {
        const intentRef = db.collection(COLLECTIONS.notificationIntents).doc(intentId);
        const snapshot = await transaction.get(intentRef);
        const current = snapshot.exists ? { intentId: snapshot.id, ...snapshot.data() } : null;
        if (!current || current.churchId !== churchId) throw httpError(404, "Message preview not found.");
        const scheduleRef = db.collection(COLLECTIONS.teamSchedules).doc(current.sourceId);
        const memberRef = db.collection(COLLECTIONS.teamRosterMembers).doc(current.memberId);
        const churchRef = db.collection(COLLECTIONS.churches).doc(churchId);
        const configRef = db.collection(COLLECTIONS.churchMessagingConfigs).doc(churchId);
        const [scheduleSnap, memberSnap, churchSnap, configSnap] = await Promise.all([
          transaction.get(scheduleRef), transaction.get(memberRef),
          transaction.get(churchRef), transaction.get(configRef),
        ]);
        const member = memberSnap.exists ? memberSnap.data() : null;
        const preliminary = resolveSmsMemberEligibility({ member, churchId, consent: null });
        const consentId = preliminary.phoneNumber ? smsConsentIdForChurchPhone(churchId, preliminary.phoneNumber) : null;
        const consentSnap = consentId
          ? await transaction.get(db.collection(COLLECTIONS.smsConsents).doc(consentId))
          : null;
        const records = {
          schedule: scheduleSnap.exists ? { scheduleId: scheduleSnap.id, ...scheduleSnap.data() } : null,
          member,
          church: churchSnap.exists ? { churchId: churchSnap.id, ...churchSnap.data() } : null,
          config: configSnap.exists ? { churchId: configSnap.id, ...configSnap.data() } : null,
          consent: consentSnap?.exists ? { consentId, ...consentSnap.data() } : null,
        };
        const result = await claim(current, records);
        const attempt = {
          attemptId, churchId, recipientType: "notification_intent", recipientId: intentId,
          memberId: current.memberId, sourceId: current.sourceId, intentType: current.intentType,
          phoneNumberSnapshot: result.validated.phoneNumber, provider: result.validated.config.provider,
          purpose: current.intentType, status: "pending", createdAt: nowIso(), updatedAt: nowIso(),
        };
        transaction.set(intentRef, result.next, { merge: true });
        transaction.create(db.collection(COLLECTIONS.smsDeliveryAttempts).doc(attemptId), attempt);
        return { ...result, attempt };
      });
    }
    return runMemoryClaim(intentId, async () => {
      const current = await getDoc(COLLECTIONS.notificationIntents, intentId);
      const result = await claim(current);
      const attempt = {
        attemptId, churchId, recipientType: "notification_intent", recipientId: intentId,
        memberId: current.memberId, sourceId: current.sourceId, intentType: current.intentType,
        phoneNumberSnapshot: result.validated.phoneNumber, provider: result.validated.config.provider,
        purpose: current.intentType, status: "pending", createdAt: nowIso(), updatedAt: nowIso(),
      };
      await setDoc(COLLECTIONS.notificationIntents, intentId, result.next, { merge: true });
      await setDoc(COLLECTIONS.smsDeliveryAttempts, attemptId, attempt, { merge: false });
      return { ...result, attempt };
    });
  };

  const sendIntent = async (req, res) => {
    let attemptId = "";
    let intent = null;
    let providerCallStarted = false;
    try {
      await assertCsrf(req);
      const churchId = normalize(req.params.churchId);
      const admin = await requireTeamsEdit(req, churchId);
      const intentId = normalize(req.params.intentId);
      attemptId = createId("smsAttempt");
      const claimed = await claimIntent({ intentId, churchId, actorUid: admin.user.uid, attemptId });
      intent = claimed.next;
      const attempt = claimed.attempt;
      const { phoneNumber, config } = claimed.validated;
      // A final read immediately before the external side effect catches a
      // roster edit, opt-out, schedule change, or disablement after approval.
      const finalCheck = await validateIntent(intent);
      await requireTeamsEdit(req, churchId);
      const provider = smsProviderFactory({ config, churchId });
      const statusCallbackUrl = validateTwilioStatusCallbackUrl();
      let result;
      providerCallStarted = true;
      try {
        result = await provider.sendMessage({ to: finalCheck.phoneNumber, body: intent.message, statusCallbackUrl });
      } catch (error) {
        const definitive = Boolean(error?.statusCode && error.statusCode < 500) || Boolean(error?.code && /^216\d{2}$/.test(String(error.code)));
        const outcome = definitive ? "failed" : "unknown";
        const updatedAt = nowIso();
        await setDoc(COLLECTIONS.smsDeliveryAttempts, attemptId, {
          status: definitive ? "failed" : "pending", outcome,
          failureCode: String(error?.code || "provider_outcome_uncertain").slice(0, 80),
          failureMessage: String(error?.message || "SMS provider outcome could not be confirmed.").slice(0, 500), updatedAt,
        }, { merge: true });
        await setDoc(COLLECTIONS.notificationIntents, intentId, { status: outcome, attemptId, updatedAt }, { merge: true });
        return res.status(definitive ? 502 : 202).json({ success: false, outcome, errorMessage: definitive ? "The SMS provider rejected this message." : "The provider outcome is uncertain. Review delivery history before retrying." });
      }
      const providerMessageId = normalize(result?.providerMessageId);
      if (!providerMessageId) throw Object.assign(new Error("Provider accepted an SMS without returning its ID."), { code: "provider_outcome_uncertain" });
      const updatedAt = nowIso();
      await setDoc(COLLECTIONS.smsDeliveryAttempts, attemptId, {
        providerMessageId, status: normalizeSmsDeliveryStatus(result.status), outcome: "confirmed", updatedAt,
      }, { merge: true });
      await setDoc(COLLECTIONS.notificationIntents, intentId, { status: "sent", attemptId, providerMessageId, sentAt: updatedAt, updatedAt }, { merge: true });
      const ledgerEntry = {
        recipient: phoneNumber,
        event: `sms.${intent.intentType}`,
        subject: intent.sourceId,
        occurrence: [intent.occurrenceId, intent.cellKey].filter(Boolean).join("#"),
      };
      await setDoc(
        COLLECTIONS.notificationDeliveries,
        hashValue(`${churchId}|${notificationDeliveryKey(ledgerEntry)}`),
        {
          deliveryKey: notificationDeliveryKey(ledgerEntry),
          ...ledgerEntry,
          churchId,
          channel: "sms",
          intentId,
          attemptId,
          providerMessageId,
          createdAt: updatedAt,
        },
        { merge: true },
      ).catch((error) => console.error("Could not update the shared notification delivery ledger", error));
      return res.json({ success: true, intent: { ...intent, status: "sent", attemptId, providerMessageId, sentAt: updatedAt }, attempt: { ...attempt, providerMessageId, status: normalizeSmsDeliveryStatus(result.status), outcome: "confirmed", updatedAt } });
    } catch (error) {
      if (intent && attemptId && !providerCallStarted) {
        const updatedAt = nowIso();
        await setDoc(COLLECTIONS.smsDeliveryAttempts, attemptId, { status: "failed", outcome: "not_sent", failureCode: String(error?.code || "preflight_failed").slice(0, 80), failureMessage: String(error?.message || "Message could not be sent.").slice(0, 500), updatedAt }, { merge: true }).catch(() => {});
        await setDoc(COLLECTIONS.notificationIntents, intent.intentId, { status: "failed", attemptId, failureMessage: String(error?.message || "Message could not be sent.").slice(0, 500), updatedAt }, { merge: true }).catch(() => {});
      } else if (intent && attemptId) {
        const updatedAt = nowIso();
        await setDoc(COLLECTIONS.smsDeliveryAttempts, attemptId, { status: "pending", outcome: "unknown", failureCode: String(error?.code || "dispatch_interrupted").slice(0, 80), failureMessage: String(error?.message || "The provider outcome could not be confirmed.").slice(0, 500), updatedAt }, { merge: true }).catch(() => {});
        await setDoc(COLLECTIONS.notificationIntents, intent.intentId, { status: "unknown", attemptId, updatedAt }, { merge: true }).catch(() => {});
      }
      return res.status(error.statusCode || 500).json({ success: false, errorMessage: error.message || "Could not send this message." });
    }
  };

  const dispatchAutomatically = async () => {
    throw httpError(403, "Automatic notification sends are disabled by the server.");
  };

  return {
    listIntents,
    previewAvailability,
    sendIntent,
    saveEventIntents,
    dispatchAutomatically,
    automaticSendsDisabled: automaticSendsDisabled === true,
  };
};
