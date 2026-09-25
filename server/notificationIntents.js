import { isChurchMessagingReady, normalizeChurchMessagingConfig } from "./churchMessagingConfig.js";
import { resolveSmsMemberEligibility } from "./smsEligibility.js";
import { smsConsentIdForChurchPhone } from "./smsConsent.js";
import { normalizeSmsDeliveryStatus } from "./smsDeliveryAttempts.js";
import { deliveryKey as notificationDeliveryKey } from "./notificationLedger.js";
import { buildTeamIntakeSms, measureSmsMessage } from "./smsMessage.js";

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
export const NOTIFICATION_PREVIEW_TTL_MS = 10 * 60 * 1000;

// This foundation has no automatic send path. Keep this server-side kill
// switch hard-disabled until a separately reviewed product change authorizes it.
export const AUTOMATIC_NOTIFICATION_SENDS_DISABLED = true;

const normalize = (value) => String(value ?? "").trim();
const safeErrorMessage = (error, fallback) => {
  const value = normalize(error?.message);
  if (!value || /https?:\/\/|(?:^|\/)\/?(?:a|schedule-response|teams\/intake)\//i.test(value)) return fallback;
  return value.slice(0, 300);
};
const intentIdFor = (hashValue, churchId, idempotencyKey) =>
  hashValue(`${churchId}|notification-intent|${idempotencyKey}`);

export const createNotificationIntent = ({
  churchId,
  intentType,
  sourceType,
  sourceId,
  sourceVersion = "",
  memberId,
  formId = "",
  recipientId = "",
  batchId = "",
  reminderRound = 0,
  originalMemberId = "",
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
    ...(normalize(formId) ? { formId: normalize(formId) } : {}),
    ...(normalize(recipientId) ? { recipientId: normalize(recipientId) } : {}),
    ...(normalize(batchId) ? { batchId: normalize(batchId) } : {}),
    ...(reminderRound ? { reminderRound: Number(reminderRound) } : {}),
    ...(normalize(originalMemberId) ? { originalMemberId: normalize(originalMemberId) } : {}),
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
  deleteDoc = async () => undefined,
  getDoc,
  hashValue,
  httpError,
  nowIso,
  queryDocs,
  requireFirestore,
  requireTeamsEdit,
  getSmsConsentForChurchPhone,
  prepareAvailabilityNotificationRecipients = async () => ({ form: null, results: [] }),
  resolveAvailabilityNotificationContext = async () => null,
  resolveScheduleNotificationContext = async () => null,
  validateReplacementCandidate = async () => { throw httpError(501, "Replacement candidate validation is unavailable."); },
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

  const listChurchDocs = (collection, churchId, filters = [], limit = 500) =>
    queryDocs(collection, [{ field: "churchId", value: churchId }, ...filters], { limit });

  const listIntentPage = async ({ churchId, filters, limit, cursor }) => {
    const db = requireFirestore();
    if (db) {
      const collection = db.collection(COLLECTIONS.notificationIntents);
      let query = collection.where("churchId", "==", churchId);
      for (const filter of filters) query = query.where(filter.field, filter.op || "==", filter.value);
      query = query.orderBy("createdAt", "desc").limit(limit + 1);
      if (cursor) {
        const cursorSnapshot = await collection.doc(cursor).get();
        if (!cursorSnapshot.exists || cursorSnapshot.data()?.churchId !== churchId) throw httpError(400, "Message history cursor is invalid.");
        if (filters.some((filter) => cursorSnapshot.data()?.[filter.field] !== filter.value)) throw httpError(400, "Message history cursor is invalid.");
        query = query.startAfter(cursorSnapshot);
      }
      const snapshot = await query.get();
      const docs = snapshot.docs;
      const hasMore = docs.length > limit;
      const pageDocs = docs.slice(0, limit);
      return {
        intents: pageDocs.map((doc) => ({ intentId: doc.id, ...doc.data() })),
        nextCursor: hasMore ? pageDocs[pageDocs.length - 1]?.id || "" : "",
      };
    }
    const all = await listChurchDocs(COLLECTIONS.notificationIntents, churchId, filters, 1000000);
    all.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")) || String(b.intentId || b.id).localeCompare(String(a.intentId || a.id)));
    const cursorIndex = cursor ? all.findIndex((item) => (item.intentId || item.id) === cursor) : -1;
    if (cursor && cursorIndex < 0) throw httpError(400, "Message history cursor is invalid.");
    const start = cursor ? cursorIndex + 1 : 0;
    const page = all.slice(start, start + limit + 1);
    const hasMore = page.length > limit;
    const intents = page.slice(0, limit);
    return { intents, nextCursor: hasMore ? intents[intents.length - 1]?.intentId || intents[intents.length - 1]?.id || "" : "" };
  };

  const loadAttemptsForIntents = async (churchId, intents) => {
    const ids = [...new Set(intents.map((item) => normalize(item.intentId || item.id)).filter(Boolean))];
    const attempts = [];
    for (let index = 0; index < ids.length; index += 30) {
      attempts.push(...await queryDocs(COLLECTIONS.smsDeliveryAttempts, [
        { field: "churchId", value: churchId },
        { field: "notificationIntentId", op: "in", value: ids.slice(index, index + 30) },
      ], { limit: 300 }));
    }
    const byIntent = new Map();
    for (const attempt of attempts.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))) {
      if (!byIntent.has(attempt.notificationIntentId)) byIntent.set(attempt.notificationIntentId, attempt);
    }
    return byIntent;
  };

  const isStaleSending = (item) => {
    const startedAt = new Date(item?.sendStartedAt || item?.approvedAt || 0).getTime();
    return Boolean(startedAt && Date.now() - startedAt > NOTIFICATION_SEND_STALE_AFTER_MS);
  };

  const markUnknownAfterInterruption = async (intent) => {
    const updatedAt = nowIso();
    await setDoc(COLLECTIONS.notificationIntents, intent.intentId, {
      status: "unknown", outcome: "unknown", failureMessage: "The send was interrupted before its provider outcome could be confirmed.", updatedAt,
    }, { merge: true });
    if (intent.attemptId) {
      await setDoc(COLLECTIONS.smsDeliveryAttempts, intent.attemptId, {
        status: "pending", outcome: "unknown", failureCode: "dispatch_interrupted",
        failureMessage: "The send was interrupted before its provider outcome could be confirmed.", updatedAt,
      }, { merge: true });
    }
  };

  const messageFor = ({ intentType, church, schedule, occurrence, form, publicUrl, responseUrl, serviceName, positionName }) => {
    const churchName = normalize(church?.name) || "Your church";
    const currentServiceName = normalize(serviceName || occurrence?.name) || "an upcoming service";
    const date = occurrence?.startsAt
      ? new Date(occurrence.startsAt).toLocaleDateString("en-US", {
          weekday: "short", month: "short", day: "numeric",
        })
      : "an upcoming date";
    const dateRange = form ? `${form.startDate} through ${form.endDate}` : "";
    switch (intentType) {
      case "availability_request":
      case "availability_reminder":
        return buildTeamIntakeSms({
          churchName,
          formName: `${normalize(form?.name) || "availability"}${dateRange ? ` (${dateRange})` : ""}`,
          publicUrl,
        }).body;
      case "assignment_notification":
        return `${churchName}: You are assigned to ${normalize(positionName) || "a volunteer position"} for ${currentServiceName} on ${date}. Respond here: ${responseUrl}. Reply STOP to opt out.`;
      case "assignment_confirmation":
        return `${churchName}: Your response for ${currentServiceName} on ${date} was recorded. View your assignment: ${responseUrl}. Reply STOP to opt out.`;
      case "schedule_change":
        return `${churchName}: Your assignment for ${currentServiceName} on ${date} changed. Review your schedule: ${responseUrl}. Reply STOP to opt out.`;
      case "replacement_request":
        return `${churchName}: Would you be available to serve as ${normalize(positionName) || "a volunteer"} for ${currentServiceName} on ${date}? Reply to your team lead. Your schedule changes only after they assign you. Reply STOP to opt out.`;
      default:
        return "";
    }
  };

  const formResponseDeadlinePassed = (form) => {
    const deadline = normalize(form?.responseDeadline || form?.endDate);
    return Boolean(deadline && deadline < new Date().toISOString().slice(0, 10));
  };

  const validateIntent = async (intent, { requireConsent = true, records = null, responseUrlOverride = "" } = {}) => {
    if (!intent || !NOTIFICATION_INTENT_TYPES.includes(intent.intentType)) {
      throw httpError(404, "Message preview not found.");
    }
    if (!["team_schedule", "team_intake_recipient"].includes(intent.sourceType)) {
      throw httpError(409, "The source for this message is not supported.");
    }
    const churchId = normalize(intent.churchId);
    let schedule = null;
    let form = null;
    let recipient = null;
    let member = records?.member || null;
    let church = records?.church || null;
    let config = records?.config || null;
    let sourceContext = {};
    if (intent.sourceType === "team_schedule") {
      if (records) schedule = records.schedule;
      else {
        sourceContext = await resolveScheduleNotificationContext(intent) || {};
        schedule = sourceContext.schedule;
      }
      if (!church) church = sourceContext.church || await getDoc(COLLECTIONS.churches, churchId);
      if (!member) member = sourceContext.member || await getDoc(COLLECTIONS.teamRosterMembers, intent.memberId);
      if (!config) config = await getDoc(COLLECTIONS.churchMessagingConfigs, churchId);
      if (!schedule || schedule.churchId !== churchId || schedule.archivedAt || !church) throw httpError(409, "The source schedule is no longer available.");
      if (!sourceContext.positionName) {
        const positionId = String(intent.cellKey || "").split("::")[0];
        const position = positionId ? await getDoc(COLLECTIONS.teamPositions, positionId) : null;
        sourceContext.positionName = position?.name || position?.label || "volunteer position";
      }
    } else {
      form = records?.form || null;
      recipient = records?.recipient || null;
      if (!records) {
        sourceContext = await resolveAvailabilityNotificationContext(intent) || {};
        form = sourceContext.form;
        recipient = sourceContext.recipient;
        member = sourceContext.member;
        church = sourceContext.church;
      }
      if (!church) church = await getDoc(COLLECTIONS.churches, churchId);
      if (!config) config = await getDoc(COLLECTIONS.churchMessagingConfigs, churchId);
      if (!form || form.churchId !== churchId || form.archivedAt || !form.active || formResponseDeadlinePassed(form)) {
        throw httpError(409, "This intake form is closed or its response deadline has passed.");
      }
      if (!recipient || recipient.churchId !== churchId || recipient.formId !== form.formId || recipient.revokedAt) {
        throw httpError(409, "This individual intake request is no longer available.");
      }
      if (recipient.respondedAt) throw httpError(409, "This volunteer has already responded.");
    }
    if (!member || member.churchId !== churchId || member.archivedAt) throw httpError(409, "This volunteer is no longer active on this church roster.");
    let occurrence = null;
    if (intent.sourceType === "team_schedule") {
      occurrence = (schedule.occurrences || []).find((item) => item?.occurrenceId === intent.occurrenceId);
      if (!occurrence) throw httpError(409, "This service occurrence has changed or was removed.");
      const cell = (schedule.assignments?.[intent.occurrenceId] || {})[intent.cellKey];
      const holderId = typeof cell === "string" ? cell : cell?.primaryMemberId || "";
      if (intent.intentType === "assignment_notification" && (!schedule.sentAt || holderId !== intent.memberId)) {
        throw httpError(409, "This assignment is no longer published for this volunteer.");
      }
      if (intent.intentType === "assignment_confirmation" && (holderId !== intent.memberId || schedule.responses?.[intent.occurrenceId]?.[intent.cellKey]?.response !== "accepted")) {
        throw httpError(409, "This accepted assignment response is no longer current.");
      }
      if (intent.intentType === "schedule_change" && !schedule.sentAt) {
        throw httpError(409, "This schedule change is not published yet.");
      }
      if (intent.intentType === "replacement_request") {
        if (intent.replacementResolvedAt) throw httpError(409, "This vacancy has already been resolved.");
        const response = schedule.responses?.[intent.occurrenceId]?.[intent.cellKey]?.response;
        if (holderId) {
          if (holderId !== intent.originalMemberId || response !== "declined") {
            throw httpError(409, "This replacement invitation no longer matches the declined assignment.");
          }
        }
        if (holderId === intent.memberId) {
          throw httpError(409, "The volunteer who declined cannot receive their own replacement invitation.");
        }
        const candidate = await validateReplacementCandidate({
          churchId, scheduleId: schedule.scheduleId || schedule.id || intent.sourceId,
          occurrenceId: intent.occurrenceId, cellKey: intent.cellKey, memberId: intent.memberId,
          originalMemberId: intent.originalMemberId || "",
        });
        sourceContext = { ...sourceContext, ...candidate };
      }
    } else if (!["availability_request", "availability_reminder"].includes(intent.intentType)) {
      throw httpError(409, "This notification type does not match an intake request.");
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
      throw httpError(400, messages[finalEligibility.status]);
    }
    const currentMessage = intent.sourceType === "team_intake_recipient"
      ? buildTeamIntakeSms({ churchName: church?.name, formName: `${form.name} (${form.startDate} through ${form.endDate})`, publicUrl: responseUrlOverride || sourceContext.publicUrl }).body
      : messageFor({ intentType: intent.intentType, church, schedule, occurrence, ...sourceContext, responseUrl: responseUrlOverride || sourceContext.responseUrl });
    if (intent.sourceType === "team_schedule" && intent.sourceVersion && intent.sourceVersion !== normalize(schedule.updatedAt) && intent.intentType !== "assignment_notification") {
      throw httpError(409, "The schedule changed after this preview. Refresh the message preview.");
    }
    const cell = schedule?.assignments?.[intent.occurrenceId]?.[intent.cellKey];
    const holderId = typeof cell === "string" ? cell : cell?.primaryMemberId || "";
    const positionName = normalize(sourceContext.positionName);
    const sourceMaterial = intent.sourceType === "team_intake_recipient"
      ? {
          formId: form.formId, name: form.name, startDate: form.startDate, endDate: form.endDate,
          responseDeadline: form.responseDeadline || form.endDate, teamIds: form.teamIds || [],
          availabilityOccurrences: form.availabilityOccurrences || [], enabledFields: form.enabledFields || [],
          recipientId: recipient.recipientId, recipientMemberId: recipient.memberId,
          respondedAt: recipient.respondedAt || "", revokedAt: recipient.revokedAt || "",
        }
      : {
          scheduleId: schedule.scheduleId || intent.sourceId, published: Boolean(schedule.sentAt),
          occurrenceId: occurrence.occurrenceId, serviceName: occurrence.name || "",
          startsAt: occurrence.startsAt || "", cellKey: intent.cellKey, holderId,
          positionName, response: schedule.responses?.[intent.occurrenceId]?.[intent.cellKey]?.response || "",
        };
    return {
      schedule, form, recipient, member, church, config: normalizedConfig, occurrence,
      phoneNumber: finalEligibility.phoneNumber, message: currentMessage,
      eligibilityStatus: finalEligibility.status, consent,
      sourceFingerprint: hashValue(JSON.stringify(sourceMaterial)),
      responseUrl: responseUrlOverride || sourceContext.responseUrl || sourceContext.publicUrl || "",
    };
  };

  const approvalVersionFor = (intent, validated) => hashValue(JSON.stringify({
    intentId: intent.intentId,
    churchId: intent.churchId,
    intentType: intent.intentType,
    memberId: intent.memberId,
    recipientId: intent.recipientId || "",
    sourceFingerprint: validated.sourceFingerprint,
    phoneNumber: validated.phoneNumber || "",
    consent: {
      status: validated.consent?.status || "",
      verifiedAt: validated.consent?.verifiedAt || "",
      consentedAt: validated.consent?.consentedAt || "",
      optedOutAt: validated.consent?.optedOutAt || "",
    },
    message: validated.message,
    segmentCount: measureSmsMessage(validated.message).segmentCount,
  }));

  const prepareIntentReview = async (intent) => {
    const prior = intent.approvalSnapshot;
    const stillFresh = prior && Number(prior.expiresAt || 0) > Date.now();
    const validated = await validateIntent(intent, {
      requireConsent: false,
      responseUrlOverride: stillFresh ? prior.responseUrl || "" : "",
    });
    const approvalVersion = validated.eligibilityStatus === "enabled"
      ? approvalVersionFor(intent, validated)
      : "";
    const reviewedAt = nowIso();
    const snapshot = approvalVersion ? {
      approvalVersion,
      sourceFingerprint: validated.sourceFingerprint,
      phoneHash: hashValue(validated.phoneNumber),
      phoneNumberSnapshot: validated.phoneNumber,
      phoneLast4: String(validated.phoneNumber || "").slice(-4),
      segmentCount: measureSmsMessage(validated.message).segmentCount,
      responseUrl: validated.responseUrl || "",
      reviewedAt,
      expiresAt: Date.now() + NOTIFICATION_PREVIEW_TTL_MS,
    } : null;
    await setDoc(COLLECTIONS.notificationIntents, intent.intentId, {
      message: validated.message,
      approvalSnapshot: snapshot,
      updatedAt: reviewedAt,
    }, { merge: true });
    return {
      intent: { ...intent, message: validated.message, approvalSnapshot: snapshot },
      validated,
      approvalVersion,
      eligible: Boolean(approvalVersion),
    };
  };

  const reviewStillMatches = (intent, validated, approvalVersion) => {
    const snapshot = intent.approvalSnapshot;
    if (!snapshot || !Number(snapshot.expiresAt) || Number(snapshot.expiresAt) <= Date.now()) return false;
    if (!approvalVersion || approvalVersion !== snapshot.approvalVersion) return false;
    if (validated.eligibilityStatus !== "enabled" || validated.message !== intent.message) return false;
    if (snapshot.phoneHash !== hashValue(validated.phoneNumber)) return false;
    if (snapshot.sourceFingerprint !== validated.sourceFingerprint) return false;
    return approvalVersionFor(intent, validated) === snapshot.approvalVersion;
  };

  const reviewedIntentProjection = (reviewed) => ({
    ...safeIntentProjection(reviewed.intent, {
      approvalVersion: reviewed.approvalVersion,
      segmentCount: measureSmsMessage(reviewed.validated.message).segmentCount,
      phoneNumberSnapshot: reviewed.validated.phoneNumber || "",
      maskedPhoneNumber: reviewed.validated.phoneNumber ? `••• ••• ${reviewed.validated.phoneNumber.slice(-4)}` : "",
      previewEligible: reviewed.eligible,
      previewError: reviewed.eligible ? "" : "This volunteer is not currently eligible for SMS.",
    }),
    message: reviewed.validated.message,
  });

  const safeIntentProjection = (intent, extra = {}) => {
    const messagePreview = normalize(intent.message)
      .replace(/(?:https?:\/\/[^\s]+)?\/a\/[^\s?#]+/gi, "/a/[secure link]")
      .replace(/(?:https?:\/\/[^\s]+)?\/(?:schedule-response|teams\/intake)\/[^\s?#]+/gi, "/[secure link]");
    return {
      intentId: intent.intentId,
      churchId: intent.churchId,
      intentType: intent.intentType,
      sourceType: intent.sourceType,
      sourceId: intent.sourceId,
      sourceVersion: intent.sourceVersion || "",
      memberId: intent.memberId,
      formId: intent.formId || "",
      recipientId: intent.recipientId || "",
      batchId: intent.batchId || "",
      reminderRound: intent.reminderRound || 0,
      occurrenceId: intent.occurrenceId || "",
      cellKey: intent.cellKey || "",
      status: intent.status,
      attemptId: intent.attemptId || "",
      createdAt: intent.createdAt,
      updatedAt: intent.updatedAt,
      sentAt: intent.sentAt || "",
      replacementResolvedAt: intent.replacementResolvedAt || "",
      messagePreview: messagePreview,
      ...extra,
    };
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
      const responseContext = await resolveScheduleNotificationContext({
        churchId, sourceId: schedule.scheduleId, memberId, occurrenceId: entry.occurrenceId,
        cellKey: entry.cellKey, intentType,
      }) || {};
      const currentSchedule = responseContext.schedule || schedule;
      const currentOccurrence = (currentSchedule.occurrences || []).find((item) => item?.occurrenceId === entry.occurrenceId) || occurrence;
      const intent = createNotificationIntent({
        churchId, intentType, sourceType: "team_schedule", sourceId: schedule.scheduleId,
        sourceVersion: eventVersion, memberId, occurrenceId: entry.occurrenceId,
        cellKey: entry.cellKey, idempotencyKey: key,
        message: messageFor({ intentType, church: responseContext.church || church, schedule: currentSchedule, occurrence: currentOccurrence, ...responseContext }), now,
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

  const listIntents = async (req, res) => {
    try {
      const churchId = normalize(req.params.churchId);
      await requireTeamsEdit(req, churchId);
      const formId = normalize(req.query?.formId);
      const scheduleId = normalize(req.query?.scheduleId);
      if (formId && scheduleId) throw httpError(400, "Choose an intake form or schedule history view.");
      const filters = formId
        ? [{ field: "formId", value: formId }]
        : scheduleId
          ? [{ field: "sourceId", value: scheduleId }, { field: "sourceType", value: "team_schedule" }]
          : [];
      const limit = Math.max(1, Math.min(100, Number.parseInt(req.query?.limit, 10) || 50));
      const cursor = normalize(req.query?.cursor);
      const page = await listIntentPage({ churchId, filters, limit, cursor });
      const intents = page.intents || [];
      const attemptByIntentId = await loadAttemptsForIntents(churchId, intents);
      const recipients = formId
        ? await listChurchDocs(COLLECTIONS.teamIntakeRecipients, churchId, [{ field: "formId", value: formId }], 1000)
        : [];
      const recipientById = new Map(recipients.map((recipient) => [recipient.recipientId || recipient.id, recipient]));
      const schedule = scheduleId ? await getDoc(COLLECTIONS.teamSchedules, scheduleId) : null;
      const enriched = await Promise.all(intents.map(async (intent) => {
        let currentIntent = intent;
        if (intent.status === "sending" && isStaleSending(intent)) {
          currentIntent = { ...intent, status: "unknown", outcome: "unknown", updatedAt: nowIso() };
          await markUnknownAfterInterruption(intent);
        }
        const attempt = attemptByIntentId.get(currentIntent.intentId);
        const recipient = recipientById.get(currentIntent.recipientId);
        const response = schedule?.responses?.[currentIntent.occurrenceId]?.[currentIntent.cellKey || ""];
        const previewEligible = ["preview", "ready", "failed"].includes(currentIntent.status);
        return safeIntentProjection(currentIntent, {
          previewEligible,
          previewError: currentIntent.status === "unknown"
            ? "Provider outcome is uncertain. Review delivery history before taking further action."
            : previewEligible ? "Open the message preview to recheck eligibility and approve its current content." : "",
          ...(attempt ? { attemptStatus: attempt.status, attemptOutcome: attempt.outcome || "" } : {}),
          respondedAt: recipient?.respondedAt || (response && response.memberId === currentIntent.memberId ? response.respondedAt || response.respondedAtIso || (response.response ? "recorded" : "") : ""),
          responded: Boolean(recipient?.respondedAt || (response?.memberId === currentIntent.memberId && ["accepted", "declined"].includes(response.response))),
        });
      }));
      return res.json({ success: true, intents: enriched, nextCursor: page.nextCursor, limit });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ success: false, errorMessage: safeErrorMessage(error, "Could not load message previews.") });
    }
  };

  const getIntentPreview = async (req, res) => {
    try {
      await assertCsrf(req);
      const churchId = normalize(req.params.churchId);
      await requireTeamsEdit(req, churchId);
      const intent = await getDoc(COLLECTIONS.notificationIntents, normalize(req.params.intentId));
      if (!intent || intent.churchId !== churchId) throw httpError(404, "Message preview not found.");
      if (!["preview", "ready", "failed"].includes(intent.status)) throw httpError(409, "This message is no longer available for preview.");
      const reviewed = await prepareIntentReview(intent);
      const current = reviewed.validated;
      return res.json({
        success: true,
        preview: {
          intentId: intent.intentId,
          intentType: intent.intentType,
          memberId: intent.memberId,
          message: current.message,
          approvalVersion: reviewed.approvalVersion,
          expiresAt: reviewed.intent.approvalSnapshot?.expiresAt || 0,
          eligible: reviewed.eligible,
          eligibilityStatus: current.eligibilityStatus,
          phoneNumberSnapshot: current.phoneNumber || "",
          characterCount: measureSmsMessage(current.message).characterCount,
          segmentCount: measureSmsMessage(current.message).segmentCount,
          maskedPhoneNumber: current.phoneNumber ? `••• ••• ${current.phoneNumber.slice(-4)}` : "",
        },
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ success: false, errorMessage: safeErrorMessage(error, "Could not load this message preview.") });
    }
  };

  const claimIntent = async ({ intentId, churchId, actorUid, attemptId, approvalVersion }) => {
    const db = requireFirestore();
    const claim = async (current, records = null) => {
      if (!current || current.churchId !== churchId) throw httpError(404, "Message preview not found.");
      if (current.status === "unknown" || current.status === "sending") throw httpError(409, "This send has an uncertain or active provider outcome. Review delivery history before retrying.");
      if (["sent", "suppressed"].includes(current.status)) throw httpError(409, "This message has already been handled.");
      if (current.status !== "preview" && current.status !== "ready" && current.status !== "failed") throw httpError(409, "This message is not ready to send.");
      if (!current.approvalSnapshot || !approvalVersion || approvalVersion !== current.approvalSnapshot.approvalVersion) {
        throw httpError(409, "This preview changed or expired. Review the current message and confirm again.");
      }
      let validated;
      try {
        validated = await validateIntent(current, { records, responseUrlOverride: current.approvalSnapshot.responseUrl || "" });
      } catch (error) {
        return { invalidated: true, errorMessage: safeErrorMessage(error, "The recipient or source changed. Review a fresh message preview."), statusCode: error.statusCode || 409 };
      }
      if (!reviewStillMatches(current, validated, approvalVersion)) {
        return { invalidated: true, errorMessage: "The recipient, phone number, consent, source, or message changed. Review and confirm the current preview again.", statusCode: 409 };
      }
      const sendStartedAt = nowIso();
      const next = { ...current, status: "sending", approvedByUid: actorUid, approvedAt: sendStartedAt, sendStartedAt, updatedAt: sendStartedAt };
      return { next, validated };
    };
    if (db) {
      const result = await db.runTransaction(async (transaction) => {
        const intentRef = db.collection(COLLECTIONS.notificationIntents).doc(intentId);
        const snapshot = await transaction.get(intentRef);
        const current = snapshot.exists ? { intentId: snapshot.id, ...snapshot.data() } : null;
        if (!current || current.churchId !== churchId) throw httpError(404, "Message preview not found.");
        const isIntake = current.sourceType === "team_intake_recipient";
        const scheduleRef = isIntake ? null : db.collection(COLLECTIONS.teamSchedules).doc(current.sourceId);
        const formRef = isIntake ? db.collection(COLLECTIONS.teamIntakeForms).doc(current.formId) : null;
        const recipientRef = isIntake ? db.collection(COLLECTIONS.teamIntakeRecipients).doc(current.recipientId || current.sourceId) : null;
        const memberRef = db.collection(COLLECTIONS.teamRosterMembers).doc(current.memberId);
        const churchRef = db.collection(COLLECTIONS.churches).doc(churchId);
        const configRef = db.collection(COLLECTIONS.churchMessagingConfigs).doc(churchId);
        const [scheduleSnap, formSnap, recipientSnap, memberSnap, churchSnap, configSnap] = await Promise.all([
          scheduleRef ? transaction.get(scheduleRef) : Promise.resolve(null),
          formRef ? transaction.get(formRef) : Promise.resolve(null),
          recipientRef ? transaction.get(recipientRef) : Promise.resolve(null),
          transaction.get(memberRef), transaction.get(churchRef), transaction.get(configRef),
        ]);
        const member = memberSnap.exists ? memberSnap.data() : null;
        const preliminary = resolveSmsMemberEligibility({ member, churchId, consent: null });
        const consentId = preliminary.phoneNumber ? smsConsentIdForChurchPhone(churchId, preliminary.phoneNumber) : null;
        const consentSnap = consentId
          ? await transaction.get(db.collection(COLLECTIONS.smsConsents).doc(consentId))
          : null;
        const records = {
          schedule: scheduleSnap?.exists ? { scheduleId: scheduleSnap.id, ...scheduleSnap.data() } : null,
          form: formSnap?.exists ? { formId: formSnap.id, ...formSnap.data() } : null,
          recipient: recipientSnap?.exists ? { recipientId: recipientSnap.id, ...recipientSnap.data() } : null,
          member,
          church: churchSnap.exists ? { churchId: churchSnap.id, ...churchSnap.data() } : null,
          config: configSnap.exists ? { churchId: configSnap.id, ...configSnap.data() } : null,
          consent: consentSnap?.exists ? { consentId, ...consentSnap.data() } : null,
        };
        const result = await claim(current, records);
        if (result.invalidated) {
          transaction.set(intentRef, { status: "preview", approvalSnapshot: null, updatedAt: nowIso() }, { merge: true });
          return result;
        }
        const attempt = {
          attemptId, churchId, recipientType: "notification_intent", recipientId: current.recipientId || current.memberId,
          notificationIntentId: intentId, memberId: current.memberId, formId: current.formId || "",
          scheduleId: current.sourceType === "team_schedule" ? current.sourceId : "",
          occurrenceId: current.occurrenceId, cellKey: current.cellKey,
          batchId: current.batchId || "", reminderRound: current.reminderRound || 0,
          sourceId: current.sourceId, intentType: current.intentType,
          phoneNumberSnapshot: result.validated.phoneNumber, provider: result.validated.config.provider,
          purpose: current.intentType, status: "pending", createdAt: nowIso(), updatedAt: nowIso(),
        };
        transaction.set(intentRef, result.next, { merge: true });
        transaction.create(db.collection(COLLECTIONS.smsDeliveryAttempts).doc(attemptId), attempt);
        return { ...result, attempt };
      });
      if (result.invalidated) throw httpError(result.statusCode, result.errorMessage);
      return result;
    }
    const result = await runMemoryClaim(intentId, async () => {
      const current = await getDoc(COLLECTIONS.notificationIntents, intentId);
      const result = await claim(current);
      if (result.invalidated) {
        await setDoc(COLLECTIONS.notificationIntents, intentId, { status: "preview", approvalSnapshot: null, updatedAt: nowIso() }, { merge: true });
        return result;
      }
      const attempt = {
        attemptId, churchId, recipientType: "notification_intent", recipientId: current.recipientId || current.memberId,
        notificationIntentId: intentId, memberId: current.memberId, formId: current.formId || "",
        scheduleId: current.sourceType === "team_schedule" ? current.sourceId : "",
        occurrenceId: current.occurrenceId, cellKey: current.cellKey,
        batchId: current.batchId || "", reminderRound: current.reminderRound || 0,
        sourceId: current.sourceId, intentType: current.intentType,
        phoneNumberSnapshot: result.validated.phoneNumber, provider: result.validated.config.provider,
        purpose: current.intentType, status: "pending", createdAt: nowIso(), updatedAt: nowIso(),
      };
      await setDoc(COLLECTIONS.notificationIntents, intentId, result.next, { merge: true });
      await setDoc(COLLECTIONS.smsDeliveryAttempts, attemptId, attempt, { merge: false });
      return { ...result, attempt };
    });
    if (result.invalidated) throw httpError(result.statusCode, result.errorMessage);
    return result;
  };

  const sendIntent = async (req, res) => {
    let attemptId = "";
    let intent = null;
    let providerCallStarted = false;
    try {
      await assertCsrf(req);
      const churchId = normalize(req.params.churchId);
      const admin = await requireTeamsEdit(req, churchId);
      if (req.body?.confirmed !== true || !normalize(req.body?.approvalVersion)) throw httpError(400, "Review and confirm this exact SMS before sending.");
      const intentId = normalize(req.params.intentId);
      attemptId = createId("smsAttempt");
      const claimed = await claimIntent({ intentId, churchId, actorUid: admin.user.uid, attemptId, approvalVersion: normalize(req.body.approvalVersion) });
      intent = claimed.next;
      const attempt = claimed.attempt;
      let phoneNumber = claimed.validated.phoneNumber;
      let config = claimed.validated.config;
      // A final read immediately before the external side effect catches a
      // roster edit, opt-out, schedule change, or disablement after approval.
      const finalCheck = await validateIntent(intent, { responseUrlOverride: intent.approvalSnapshot?.responseUrl || "" });
      if (!reviewStillMatches(intent, finalCheck, intent.approvalSnapshot?.approvalVersion || "")) {
        throw httpError(409, "The recipient, phone number, consent, source, or message changed. Review and confirm the current preview again.");
      }
      await requireTeamsEdit(req, churchId);
      phoneNumber = finalCheck.phoneNumber;
      config = finalCheck.config;
      await setDoc(COLLECTIONS.smsDeliveryAttempts, attemptId, {
        phoneNumberSnapshot: phoneNumber,
        updatedAt: nowIso(),
      }, { merge: true });
      const provider = smsProviderFactory({ config, churchId });
      const statusCallbackUrl = validateTwilioStatusCallbackUrl();
      let result;
      providerCallStarted = true;
      try {
        result = await provider.sendMessage({ to: finalCheck.phoneNumber, body: finalCheck.message, statusCallbackUrl });
      } catch (error) {
        // Twilio's five-digit API errors are definitive rejections; network
        // failures and provider errors without an HTTP/Twilio code stay
        // uncertain so they can never be retried as if they were not sent.
        const definitive = Boolean(error?.statusCode && error.statusCode < 500) || Boolean(error?.code && /^\d{5}$/.test(String(error.code)));
        const outcome = definitive ? "failed" : "unknown";
        const updatedAt = nowIso();
        await setDoc(COLLECTIONS.smsDeliveryAttempts, attemptId, {
          status: definitive ? "failed" : "pending", outcome,
          failureCode: String(error?.code || "provider_outcome_uncertain").slice(0, 80),
          failureMessage: safeErrorMessage(error, "SMS provider outcome could not be confirmed."), updatedAt,
        }, { merge: true });
        await setDoc(COLLECTIONS.notificationIntents, intentId, { status: outcome, ...(definitive ? { approvalSnapshot: null } : {}), attemptId, updatedAt }, { merge: true });
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
        subject: intent.formId || intent.sourceId,
        occurrence: [intent.occurrenceId, intent.cellKey, intent.reminderRound || ""].filter(Boolean).join("#"),
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
      return res.json({ success: true, intent: safeIntentProjection({ ...intent, status: "sent", attemptId, providerMessageId, sentAt: updatedAt }), attempt: { ...attempt, providerMessageId, status: normalizeSmsDeliveryStatus(result.status), outcome: "confirmed", updatedAt } });
    } catch (error) {
      if (intent && attemptId && !providerCallStarted) {
        const updatedAt = nowIso();
        await setDoc(COLLECTIONS.smsDeliveryAttempts, attemptId, { status: "failed", outcome: "not_sent", failureCode: String(error?.code || "preflight_failed").slice(0, 80), failureMessage: safeErrorMessage(error, "Message could not be sent."), updatedAt }, { merge: true }).catch(() => {});
        await setDoc(COLLECTIONS.notificationIntents, intent.intentId, { status: "failed", approvalSnapshot: null, attemptId, failureMessage: safeErrorMessage(error, "Message could not be sent."), updatedAt }, { merge: true }).catch(() => {});
      } else if (intent && attemptId) {
        const updatedAt = nowIso();
        await setDoc(COLLECTIONS.smsDeliveryAttempts, attemptId, { status: "pending", outcome: "unknown", failureCode: String(error?.code || "dispatch_interrupted").slice(0, 80), failureMessage: safeErrorMessage(error, "The provider outcome could not be confirmed."), updatedAt }, { merge: true }).catch(() => {});
        await setDoc(COLLECTIONS.notificationIntents, intent.intentId, { status: "unknown", attemptId, updatedAt }, { merge: true }).catch(() => {});
      }
      return res.status(error.statusCode || 500).json({ success: false, errorMessage: safeErrorMessage(error, "Could not send this message.") });
    }
  };

  const ensureTeamIntakeIntent = async ({ churchId, formId, recipientId, actorUid }) => {
    const context = await resolveAvailabilityNotificationContext({
      churchId, formId, recipientId, sourceId: recipientId, memberId: "", intentType: "availability_request",
    }, actorUid);
    if (!context || context.recipient.churchId !== churchId || (formId && context.form.formId !== formId)) {
      throw httpError(404, "Individual intake request not found.");
    }
    const key = `availability_request|${context.form.formId}|${recipientId}`;
    const intentId = intentIdFor(hashValue, churchId, key);
    let intent = await getDoc(COLLECTIONS.notificationIntents, intentId);
    if (intent && ["sent", "sending", "unknown", "suppressed"].includes(intent.status)) {
      throw httpError(409, "This availability request is already handled or has an uncertain provider outcome.");
    }
    if (!intent) {
      const message = buildTeamIntakeSms({
        churchName: context.church?.name,
        formName: `${context.form.name} (${context.form.startDate} through ${context.form.endDate})`,
        publicUrl: context.publicUrl,
      }).body;
      intent = createNotificationIntent({
        churchId, intentType: "availability_request", sourceType: "team_intake_recipient",
        sourceId: recipientId, formId: context.form.formId, recipientId,
        memberId: context.member.memberId, idempotencyKey: key, message, now: nowIso(),
      });
      const db = requireFirestore();
      if (db) {
        await db.runTransaction(async (transaction) => {
          const ref = db.collection(COLLECTIONS.notificationIntents).doc(intentId);
          const snapshot = await transaction.get(ref);
          if (!snapshot.exists) transaction.create(ref, { intentId, ...intent });
        });
        intent = await getDoc(COLLECTIONS.notificationIntents, intentId);
      } else {
        await setDoc(COLLECTIONS.notificationIntents, intentId, { intentId, ...intent }, { merge: false });
        intent = { intentId, ...intent };
      }
    }
    return { intent: { intentId, ...intent }, context };
  };

  const prepareTeamIntakeIntent = async (req, res) => {
    try {
      await assertCsrf(req);
      const churchId = normalize(req.params.churchId);
      const admin = await requireTeamsEdit(req, churchId);
      const { intent, context } = await ensureTeamIntakeIntent({
        churchId, formId: normalize(req.params.formId), recipientId: normalize(req.params.recipientId), actorUid: admin.user.uid,
      });
      const reviewed = await prepareIntentReview(intent);
      const safeRecipient = { ...context.recipient };
      delete safeRecipient.recipientToken;
      delete safeRecipient.recipientTokenHash;
      delete safeRecipient.recipientTokenCiphertext;
      delete safeRecipient.recipientTokenNonce;
      return res.json({
        success: true,
        recipient: safeRecipient,
        preview: {
          intentId: intent.intentId,
          intentType: intent.intentType,
          memberId: intent.memberId,
          message: reviewed.validated.message,
          approvalVersion: reviewed.approvalVersion,
          expiresAt: reviewed.intent.approvalSnapshot?.expiresAt || 0,
          eligible: reviewed.eligible,
          eligibilityStatus: reviewed.validated.eligibilityStatus,
          phoneNumberSnapshot: reviewed.validated.phoneNumber || "",
          characterCount: measureSmsMessage(reviewed.validated.message).characterCount,
          segmentCount: measureSmsMessage(reviewed.validated.message).segmentCount,
          maskedPhoneNumber: reviewed.validated.phoneNumber ? `••• ••• ${reviewed.validated.phoneNumber.slice(-4)}` : "",
        },
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ success: false, errorMessage: safeErrorMessage(error, "Could not prepare this individual intake message.") });
    }
  };

  const sendTeamIntakeIntent = async (req, res) => {
    try {
      await assertCsrf(req);
      const churchId = normalize(req.params.churchId);
      const admin = await requireTeamsEdit(req, churchId);
      if (req.body?.confirmed !== true || !normalize(req.body?.approvalVersion)) {
        throw httpError(400, "Review and confirm this individual availability SMS before sending.");
      }
      const { intent } = await ensureTeamIntakeIntent({
        churchId, formId: normalize(req.params.formId), recipientId: normalize(req.params.recipientId), actorUid: admin.user.uid,
      });
      const attemptResponse = {
        status(code) { res.status(code); return this; },
        json(payload) { return res.json({ ...payload, ...(payload.success ? { attempt: payload.attempt } : {}) }); },
      };
      return sendIntent({ ...req, params: { ...req.params, churchId, intentId: intent.intentId }, body: { confirmed: true, approvalVersion: req.body.approvalVersion } }, attemptResponse);
    } catch (error) {
      return res.status(error.statusCode || 500).json({ success: false, errorMessage: safeErrorMessage(error, "Could not send this individual intake message.") });
    }
  };

  const prepareReplacementInvitation = async (req, res) => {
    try {
      await assertCsrf(req);
      const churchId = normalize(req.params.churchId);
      const admin = await requireTeamsEdit(req, churchId);
      if (automaticSendsDisabled !== true) throw httpError(403, "Automatic notification sends are disabled by the server.");
      const scheduleId = normalize(req.body?.scheduleId);
      const occurrenceId = normalize(req.body?.occurrenceId);
      const cellKey = normalize(req.body?.cellKey);
      const memberId = normalize(req.body?.memberId);
      if (!scheduleId || !occurrenceId || !cellKey || !memberId) throw httpError(400, "Choose a schedule vacancy and replacement candidate.");
      const context = await validateReplacementCandidate({ churchId, scheduleId, occurrenceId, cellKey, memberId });
      const schedule = context.schedule;
      const church = await getDoc(COLLECTIONS.churches, churchId);
      if (!schedule || !church) throw httpError(404, "Schedule not found.");
      const key = `replacement_request|${scheduleId}|${occurrenceId}|${cellKey}|${memberId}`;
      const intentId = intentIdFor(hashValue, churchId, key);
      const existing = await getDoc(COLLECTIONS.notificationIntents, intentId);
      if (existing?.replacementResolvedAt) throw httpError(409, "This replacement invitation was already resolved and cannot be resent.");
      if (existing) return res.json({ success: true, intent: reviewedIntentProjection(await prepareIntentReview({ intentId, ...existing })) });
      const otherVacancyIntent = (await listChurchDocs(COLLECTIONS.notificationIntents, churchId, [
        { field: "sourceId", value: scheduleId },
        { field: "sourceType", value: "team_schedule" },
      ], 250)).find((item) => item.intentType === "replacement_request" && !item.replacementResolvedAt && item.occurrenceId === occurrenceId && item.cellKey === cellKey && ["preview", "ready", "sending", "sent", "unknown"].includes(item.status));
      if (otherVacancyIntent) throw httpError(409, "A replacement invitation is already active for this vacancy. Resolve it in the schedule before inviting another volunteer.");
      const vacancyClaimId = hashValue(`${churchId}|replacement-vacancy|${scheduleId}|${occurrenceId}|${cellKey}`);
      let acquiredVacancyClaim = false;
      const db = requireFirestore();
      if (db) {
        await db.runTransaction(async (transaction) => {
          const claimRef = db.collection(COLLECTIONS.notificationBatches).doc(vacancyClaimId);
          const claimSnapshot = await transaction.get(claimRef);
          const now = Date.now();
          const lockExpired = claimSnapshot.exists && claimSnapshot.data()?.status === "preparing" && Number(claimSnapshot.data()?.expiresAt || 0) <= now;
          if (claimSnapshot.exists) {
            const existingClaim = claimSnapshot.data() || {};
            if (existingClaim.memberId !== memberId && !existingClaim.releasedAt && !lockExpired) throw httpError(409, "Another candidate invitation is already being prepared for this vacancy.");
            if (existingClaim.releasedAt || lockExpired) {
              acquiredVacancyClaim = true;
              transaction.set(claimRef, {
              batchId: vacancyClaimId, kind: "replacement_vacancy_claim", churchId, scheduleId,
              occurrenceId, cellKey, memberId, intentId, createdAt: nowIso(), createdByUid: admin.user.uid,
              status: "preparing", expiresAt: now + 2 * 60 * 1000, releasedAt: "",
              }, { merge: false });
            }
            return;
          }
          acquiredVacancyClaim = true;
          transaction.create(claimRef, {
            batchId: vacancyClaimId, kind: "replacement_vacancy_claim", churchId, scheduleId,
            occurrenceId, cellKey, memberId, intentId, createdAt: nowIso(), createdByUid: admin.user.uid,
            status: "preparing", expiresAt: now + 2 * 60 * 1000,
          });
        });
      } else {
        await runMemoryClaim(vacancyClaimId, async () => {
          const current = await getDoc(COLLECTIONS.notificationBatches, vacancyClaimId);
          const lockExpired = current?.status === "preparing" && Number(current.expiresAt || 0) <= Date.now();
          if (current && current.memberId !== memberId && !current.releasedAt && !lockExpired) throw httpError(409, "Another candidate invitation is already being prepared for this vacancy.");
          if (!current || current.releasedAt || lockExpired) {
            acquiredVacancyClaim = true;
            await setDoc(COLLECTIONS.notificationBatches, vacancyClaimId, {
            batchId: vacancyClaimId, kind: "replacement_vacancy_claim", churchId, scheduleId,
            occurrenceId, cellKey, memberId, intentId, createdAt: nowIso(), createdByUid: admin.user.uid,
            status: "preparing", expiresAt: Date.now() + 2 * 60 * 1000, releasedAt: "",
            }, { merge: false });
          }
        });
      }
      const intent = createNotificationIntent({
        churchId, intentType: "replacement_request", sourceType: "team_schedule", sourceId: scheduleId,
        sourceVersion: normalize(schedule.updatedAt), memberId, occurrenceId, cellKey,
        originalMemberId: context.holderId || "",
        idempotencyKey: key,
        message: messageFor({ intentType: "replacement_request", church, schedule, occurrence: context.occurrence, positionName: context.position?.name || context.position?.label }),
        now: nowIso(),
      });
      let createdIntent = false;
      try {
      if (db) {
        createdIntent = await db.runTransaction(async (transaction) => {
          const target = db.collection(COLLECTIONS.notificationIntents).doc(intentId);
          const snapshot = await transaction.get(target);
          if (snapshot.exists) return false;
          transaction.create(target, { intentId, ...intent, preparedByUid: admin.user.uid });
          return true;
        });
      } else {
        createdIntent = true;
        await setDoc(COLLECTIONS.notificationIntents, intentId, { intentId, ...intent, preparedByUid: admin.user.uid }, { merge: false });
      }
      await setDoc(COLLECTIONS.notificationBatches, vacancyClaimId, { status: "active", expiresAt: 0 }, { merge: true });
      const savedIntent = await getDoc(COLLECTIONS.notificationIntents, intentId) || { intentId, ...intent };
      const reviewed = await prepareIntentReview(savedIntent);
      return res.json({ success: true, intent: reviewedIntentProjection(reviewed) });
      } catch (error) {
        if (createdIntent) await deleteDoc(COLLECTIONS.notificationIntents, intentId).catch(() => {});
        if (acquiredVacancyClaim) {
          await setDoc(COLLECTIONS.notificationBatches, vacancyClaimId, { status: "released", releasedAt: nowIso(), expiresAt: 0 }, { merge: true }).catch(() => {});
        }
        throw error;
      }
    } catch (error) {
      return res.status(error.statusCode || 500).json({ success: false, errorMessage: safeErrorMessage(error, "Could not prepare this replacement invitation.") });
    }
  };

  const resolveReplacementInvitation = async (req, res) => {
    try {
      await assertCsrf(req);
      const churchId = normalize(req.params.churchId);
      const admin = await requireTeamsEdit(req, churchId);
      const intentId = normalize(req.params.intentId);
      const db = requireFirestore();
      const resolve = async (transaction = null) => {
        const intentRef = db?.collection(COLLECTIONS.notificationIntents).doc(intentId);
        const snapshot = transaction ? await transaction.get(intentRef) : null;
        const intent = transaction
          ? snapshot?.exists ? { intentId: snapshot.id, ...snapshot.data() } : null
          : await getDoc(COLLECTIONS.notificationIntents, intentId);
        if (!intent || intent.churchId !== churchId || intent.intentType !== "replacement_request") throw httpError(404, "Replacement invitation not found.");
        if (["sending", "unknown"].includes(intent.status)) throw httpError(409, "The provider outcome is active or uncertain. Review SMS delivery history before closing this invitation.");
        if (intent.replacementResolvedAt) return intent;
        const resolvedAt = nowIso();
        const resolved = { ...intent, replacementResolvedAt: resolvedAt, replacementResolvedByUid: admin.user.uid, updatedAt: resolvedAt };
        const claimId = hashValue(`${churchId}|replacement-vacancy|${intent.sourceId}|${intent.occurrenceId}|${intent.cellKey}`);
        if (transaction) {
          transaction.set(intentRef, { replacementResolvedAt: resolvedAt, replacementResolvedByUid: admin.user.uid, updatedAt: resolvedAt }, { merge: true });
          transaction.set(db.collection(COLLECTIONS.notificationBatches).doc(claimId), { releasedAt: resolvedAt, status: "released" }, { merge: true });
        } else {
          await setDoc(COLLECTIONS.notificationIntents, intentId, { replacementResolvedAt: resolvedAt, replacementResolvedByUid: admin.user.uid, updatedAt: resolvedAt }, { merge: true });
          await setDoc(COLLECTIONS.notificationBatches, claimId, { releasedAt: resolvedAt, status: "released" }, { merge: true });
        }
        return resolved;
      };
      const intent = db
        ? await db.runTransaction((transaction) => resolve(transaction))
        : await runMemoryClaim(intentId, () => resolve());
      return res.json({ success: true, intent: safeIntentProjection(intent) });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ success: false, errorMessage: safeErrorMessage(error, "Could not close this replacement invitation.") });
    }
  };

  const getBatchForChurch = async (batchId, churchId) => {
    const batch = await getDoc(COLLECTIONS.notificationBatches, batchId);
    if (!batch || batch.churchId !== churchId) throw httpError(404, "Message batch not found.");
    return batch;
  };

  const formatBatchDetail = async (batch, { exposeMessages = true } = {}) => {
    const rows = batch.recipients || [];
    const [intents, attempts, recipients] = await Promise.all([
      queryDocs(COLLECTIONS.notificationIntents, [
        { field: "churchId", value: batch.churchId },
        { field: "batchId", value: batch.batchId },
      ], { limit: 1000 }),
      queryDocs(COLLECTIONS.smsDeliveryAttempts, [
        { field: "churchId", value: batch.churchId },
        { field: "batchId", value: batch.batchId },
      ], { limit: 2000 }),
      listChurchDocs(COLLECTIONS.teamIntakeRecipients, batch.churchId, [{ field: "formId", value: batch.formId }], 1000),
    ]);
    const intentById = new Map(intents.map((item) => [item.intentId || item.id, item]));
    const attemptByIntentId = new Map();
    for (const attempt of attempts.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))) {
      if (!attemptByIntentId.has(attempt.notificationIntentId)) attemptByIntentId.set(attempt.notificationIntentId, attempt);
    }
    const recipientById = new Map(recipients.map((recipient) => [recipient.recipientId || recipient.id, recipient]));
    const formatted = rows.map((row) => {
      const intent = intentById.get(row.intentId);
      const attempt = intent ? attemptByIntentId.get(intent.intentId || intent.id) : null;
      const recipient = recipientById.get(row.recipientId);
      const snapshot = intent?.approvalSnapshot;
      const awaitingDispatch = Boolean(intent && ["preview", "ready"].includes(intent.status) && snapshot?.approvalVersion && Number(snapshot.expiresAt) > Date.now());
      const previewEligible = awaitingDispatch;
      const previewError = row.exclusionReason || (intent && !previewEligible && ["preview", "ready"].includes(intent.status)
        ? "This review expired. Prepare and confirm a fresh message preview."
        : "");
      return {
        memberId: row.memberId,
        memberName: row.memberName || "Volunteer",
        recipientId: row.recipientId || "",
        maskedPhoneNumber: snapshot?.phoneLast4 ? `••• ••• ${snapshot.phoneLast4}` : row.maskedPhoneNumber || "",
        eligibilityStatus: row.eligibilityStatus || "",
        eligible: Boolean(intent && previewEligible),
        exclusionReason: previewError,
        intentId: row.intentId || "",
        status: intent?.status || row.status || "excluded",
        attemptId: intent?.attemptId || "",
        attemptStatus: attempt?.status || "",
        attemptOutcome: attempt?.outcome || intent?.outcome || "",
        respondedAt: recipient?.respondedAt || "",
        segmentCount: snapshot?.segmentCount || row.segmentCount || 0,
        approvalVersion: snapshot?.approvalVersion || "",
        phoneNumberSnapshot: snapshot?.phoneNumberSnapshot || "",
        ...(exposeMessages && intent?.approvalSnapshot ? { message: intent.message } : {}),
      };
    });
    const selected = (batch.selectedMemberIds || []).length;
    const eligible = formatted.filter((row) => row.eligible).length;
    const awaitingDispatch = formatted.filter((row) => ["preview", "ready"].includes(row.status) && row.approvalVersion).length;
    const alreadySent = formatted.filter((row) => row.status === "sent" || ["accepted", "sent", "delivered"].includes(row.attemptStatus)).length;
    const segments = formatted.filter((row) => ["preview", "ready"].includes(row.status) && row.approvalVersion).reduce((sum, row) => sum + Number(row.segmentCount || 0), 0);
    const reviewVersion = batch.reviewVersion || hashValue(JSON.stringify({
      batchId: batch.batchId,
      selectedMemberIds: batch.selectedMemberIds || [],
      recipients: formatted.map(({ intentId, approvalVersion, segmentCount, status }) => ({ intentId, approvalVersion, segmentCount, status })),
    }));
    return {
      batchId: batch.batchId,
      churchId: batch.churchId,
      formId: batch.formId,
      intentType: batch.intentType,
      reminderRound: batch.reminderRound || 0,
      status: batch.status,
      selectedMemberIds: batch.selectedMemberIds || [],
      intentIds: batch.intentIds || [],
      recipients: formatted,
      approvalVersion: reviewVersion,
      createdAt: batch.createdAt,
      updatedAt: batch.updatedAt,
      summary: {
        requested: selected,
        selected,
        eligible,
        awaitingDispatch,
        alreadySent,
        excluded: Math.max(0, selected - eligible - alreadySent),
        totalSegments: segments,
        sent: alreadySent,
        delivered: formatted.filter((row) => row.attemptStatus === "delivered").length,
        failed: formatted.filter((row) => ["failed", "undelivered"].includes(row.attemptStatus) || row.status === "failed").length,
        uncertain: formatted.filter((row) => row.status === "unknown" || row.attemptOutcome === "unknown").length,
        responded: formatted.filter((row) => row.respondedAt).length,
        waiting: formatted.filter((row) => ["accepted", "sent", "delivered"].includes(row.attemptStatus) && !row.respondedAt).length,
        optedOut: formatted.filter((row) => row.eligibilityStatus === "opted_out").length,
      },
    };
  };

  const reserveAvailabilityBatch = async ({ churchId, formId, intentType, batchId, actorUid, selectedMemberIds }) => {
    const db = requireFirestore();
    const createBatch = (form, round) => ({
      batchId, churchId, formId, intentType, reminderRound: round,
      status: "preparing", selectedMemberIds, recipients: [], intentIds: [],
      createdAt: nowIso(), createdByUid: actorUid, updatedAt: nowIso(),
    });
    if (db) {
      return db.runTransaction(async (transaction) => {
        const batchRef = db.collection(COLLECTIONS.notificationBatches).doc(batchId);
        const [batchSnapshot, formSnapshot] = await Promise.all([
          transaction.get(batchRef),
          transaction.get(db.collection(COLLECTIONS.teamIntakeForms).doc(formId)),
        ]);
        if (batchSnapshot.exists) {
          const existing = { batchId: batchSnapshot.id, ...batchSnapshot.data() };
          if (existing.churchId !== churchId || existing.formId !== formId || existing.intentType !== intentType) {
            throw httpError(409, "This batch key was already used for a different request.");
          }
          if (JSON.stringify(existing.selectedMemberIds || []) !== JSON.stringify(selectedMemberIds)) throw httpError(409, "This batch key was already used with a different recipient selection.");
          return existing;
        }
        const form = formSnapshot.exists ? { formId: formSnapshot.id, ...formSnapshot.data() } : null;
        if (!form || form.churchId !== churchId || form.archivedAt || !form.active || formResponseDeadlinePassed(form)) {
          throw httpError(409, "This intake form is closed or its response deadline has passed.");
        }
        const round = intentType === "availability_reminder" ? Number(form.reminderRound || 0) + 1 : 0;
        const batch = createBatch(form, round);
        transaction.create(batchRef, batch);
        if (round) transaction.set(db.collection(COLLECTIONS.teamIntakeForms).doc(formId), { reminderRound: round }, { merge: true });
        return batch;
      });
    }
    return runMemoryClaim(batchId, async () => {
      const existing = await getDoc(COLLECTIONS.notificationBatches, batchId);
      if (existing) {
        if (existing.churchId !== churchId || existing.formId !== formId || existing.intentType !== intentType) throw httpError(409, "This batch key was already used for a different request.");
        if (JSON.stringify(existing.selectedMemberIds || []) !== JSON.stringify(selectedMemberIds)) throw httpError(409, "This batch key was already used with a different recipient selection.");
        return existing;
      }
      const form = await getDoc(COLLECTIONS.teamIntakeForms, formId);
      if (!form || form.churchId !== churchId || form.archivedAt || !form.active || formResponseDeadlinePassed(form)) throw httpError(409, "This intake form is closed or its response deadline has passed.");
      const round = intentType === "availability_reminder" ? Number(form.reminderRound || 0) + 1 : 0;
      const batch = createBatch(form, round);
      await setDoc(COLLECTIONS.notificationBatches, batchId, batch, { merge: false });
      if (round) await setDoc(COLLECTIONS.teamIntakeForms, formId, { reminderRound: round }, { merge: true });
      return batch;
    });
  };

  const prepareAvailabilityBatch = async (req, res) => {
    try {
      await assertCsrf(req);
      const churchId = normalize(req.params.churchId);
      const admin = await requireTeamsEdit(req, churchId);
      if (automaticSendsDisabled !== true) throw httpError(403, "Automatic notification sends are disabled by the server.");
      const intentType = normalize(req.body?.intentType);
      if (!["availability_request", "availability_reminder"].includes(intentType)) throw httpError(400, "Choose an availability request or reminder.");
      const formId = normalize(req.body?.formId);
      const memberIds = [...new Set((Array.isArray(req.body?.memberIds) ? req.body.memberIds : []).map(normalize).filter(Boolean))].slice(0, 500);
      const requestKey = normalize(req.body?.requestKey).slice(0, 120);
      if (!formId || !requestKey || !memberIds.length) throw httpError(400, "Choose a form, at least one volunteer, and a batch request key.");
      const batchId = hashValue(`${churchId}|notification-batch|${requestKey}`);
      let batch = await reserveAvailabilityBatch({ churchId, formId, intentType, batchId, actorUid: admin.user.uid, selectedMemberIds: memberIds });
      if (batch.status !== "preparing") return res.json({ success: true, batch: await formatBatchDetail(batch) });
      const prepared = await prepareAvailabilityNotificationRecipients({ churchId, formId, memberIds, purpose: intentType, actorUid: admin.user.uid });
      const rows = [];
      const intentIds = [];
      for (const result of prepared.results) {
        const member = result.member || {};
        const row = {
          memberId: result.memberId,
          memberName: [member.firstName, member.lastName].filter(Boolean).join(" ") || "Volunteer",
          recipientId: result.recipientId || "",
          maskedPhoneNumber: result.maskedPhoneNumber || "",
          eligibilityStatus: result.eligibilityStatus || "",
          exclusionReason: result.exclusionReason || "",
          status: result.eligible ? "preview" : "excluded",
          segmentCount: 0,
        };
        if (result.eligible) {
          if (intentType === "availability_reminder" && batch.reminderRound > 1) {
            const priorKey = `availability_reminder|${formId}|${result.recipientId}|${batch.reminderRound - 1}`;
            const priorIntent = await getDoc(COLLECTIONS.notificationIntents, intentIdFor(hashValue, churchId, priorKey));
            if (priorIntent && ["preview", "ready", "sending", "unknown"].includes(priorIntent.status)) {
              row.status = "excluded";
              row.exclusionReason = priorIntent.status === "unknown"
                ? "A prior reminder has an uncertain provider outcome."
                : "A previous reminder round is still unresolved.";
              rows.push(row);
              continue;
            }
          }
          const key = intentType === "availability_request"
            ? `availability_request|${formId}|${result.recipientId}`
            : `availability_reminder|${formId}|${result.recipientId}|${batch.reminderRound}`;
          const id = intentIdFor(hashValue, churchId, key);
          const existing = await getDoc(COLLECTIONS.notificationIntents, id);
          if (existing?.batchId === batchId) {
            const reviewed = await prepareIntentReview({ intentId: id, ...existing });
            row.intentId = id;
            row.status = reviewed.intent.status;
            row.segmentCount = measureSmsMessage(reviewed.validated.message).segmentCount;
            row.maskedPhoneNumber = reviewed.validated.phoneNumber ? `••• ••• ${reviewed.validated.phoneNumber.slice(-4)}` : "";
            row.eligibilityStatus = reviewed.validated.eligibilityStatus;
            row.approvalVersion = reviewed.approvalVersion;
            if (!reviewed.eligible) {
              row.status = "excluded";
              row.exclusionReason = reviewed.validated.eligibilityStatus === "opted_out" ? "This phone number has opted out of SMS." : "This volunteer is not eligible for SMS.";
              row.intentId = "";
            }
          } else if (existing && ["preview", "ready", "failed"].includes(existing.status)) {
            const previousBatchId = normalize(existing.batchId);
            if (previousBatchId && previousBatchId !== batchId) {
              const previousBatch = await getDoc(COLLECTIONS.notificationBatches, previousBatchId);
              if (previousBatch?.status === "dispatching") {
                row.status = existing.status;
                row.exclusionReason = "A previous batch is currently being dispatched.";
                rows.push(row);
                continue;
              }
              if (previousBatch) await setDoc(COLLECTIONS.notificationBatches, previousBatchId, { status: "superseded", supersededAt: nowIso(), updatedAt: nowIso() }, { merge: true });
            }
            const moved = { ...existing, intentId: id, batchId, status: existing.status === "failed" ? "ready" : existing.status, approvalSnapshot: null };
            await setDoc(COLLECTIONS.notificationIntents, id, { batchId, status: moved.status, approvalSnapshot: null, updatedAt: nowIso() }, { merge: true });
            const reviewed = await prepareIntentReview(moved);
            row.intentId = id;
            row.status = reviewed.eligible ? reviewed.intent.status : "excluded";
            row.segmentCount = measureSmsMessage(reviewed.validated.message).segmentCount;
            row.maskedPhoneNumber = reviewed.validated.phoneNumber ? `••• ••• ${reviewed.validated.phoneNumber.slice(-4)}` : "";
            row.eligibilityStatus = reviewed.validated.eligibilityStatus;
            row.approvalVersion = reviewed.approvalVersion;
            if (!reviewed.eligible) {
              row.intentId = "";
              row.exclusionReason = reviewed.validated.eligibilityStatus === "opted_out" ? "This phone number has opted out of SMS." : "This volunteer is not eligible for SMS.";
            }
          } else if (existing) {
            row.status = existing.status;
            row.exclusionReason = existing.status === "sent" ? "This request was already sent." : existing.status === "unknown" ? "A previous send has an uncertain provider outcome." : existing.status === "sending" ? "A previous send is in progress." : "A prior message for this request already exists.";
          } else {
            const message = buildTeamIntakeSms({
              churchName: result.churchName,
              formName: `${prepared.form.name} (${prepared.form.startDate} through ${prepared.form.endDate})`,
              publicUrl: result.publicUrl,
            });
            const intent = createNotificationIntent({
              churchId, intentType, sourceType: "team_intake_recipient",
              sourceId: result.recipientId, formId, recipientId: result.recipientId,
              batchId, reminderRound: batch.reminderRound, memberId: result.memberId,
              idempotencyKey: key, message: message.body, now: nowIso(),
            });
            const db = requireFirestore();
            if (db) {
              await db.runTransaction(async (transaction) => {
                const ref = db.collection(COLLECTIONS.notificationIntents).doc(id);
                const snapshot = await transaction.get(ref);
                if (!snapshot.exists) transaction.create(ref, { intentId: id, ...intent });
              });
            } else {
              await setDoc(COLLECTIONS.notificationIntents, id, { intentId: id, ...intent }, { merge: false });
            }
            const savedIntent = await getDoc(COLLECTIONS.notificationIntents, id) || { intentId: id, ...intent };
            const reviewed = await prepareIntentReview(savedIntent);
            row.status = reviewed.eligible ? "preview" : "excluded";
            row.intentId = reviewed.eligible ? id : "";
            row.segmentCount = measureSmsMessage(reviewed.validated.message).segmentCount;
            row.maskedPhoneNumber = reviewed.validated.phoneNumber ? `••• ••• ${reviewed.validated.phoneNumber.slice(-4)}` : "";
            row.eligibilityStatus = reviewed.validated.eligibilityStatus;
            row.approvalVersion = reviewed.approvalVersion;
            if (!reviewed.eligible) row.exclusionReason = reviewed.validated.eligibilityStatus === "opted_out" ? "This phone number has opted out of SMS." : "This volunteer is not eligible for SMS.";
          }
          if (row.intentId) intentIds.push(row.intentId);
        }
        rows.push(row);
      }
      batch = {
        ...batch, status: "prepared", selectedMemberIds: memberIds,
        recipients: rows, intentIds,
        reviewVersion: hashValue(JSON.stringify({
          batchId,
          selectedMemberIds: memberIds,
          recipients: rows.map((row) => ({ intentId: row.intentId || "", approvalVersion: row.approvalVersion || "", segmentCount: row.segmentCount || 0 })),
        })),
        preparedAt: nowIso(), updatedAt: nowIso(),
      };
      await setDoc(COLLECTIONS.notificationBatches, batchId, batch, { merge: true });
      return res.json({ success: true, batch: await formatBatchDetail(batch) });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ success: false, errorMessage: safeErrorMessage(error, "Could not prepare this message batch.") });
    }
  };

  const getAvailabilityBatch = async (req, res) => {
    try {
      const churchId = normalize(req.params.churchId);
      await requireTeamsEdit(req, churchId);
      const batch = await getBatchForChurch(normalize(req.params.batchId), churchId);
      if (!batch.formId) throw httpError(404, "Message batch not found.");
      let current = batch;
      if (batch.status === "dispatching" && isStaleSending({ sendStartedAt: batch.dispatchStartedAt })) {
        const db = requireFirestore();
        if (db) {
          current = await db.runTransaction(async (transaction) => {
            const ref = db.collection(COLLECTIONS.notificationBatches).doc(batch.batchId);
            const snapshot = await transaction.get(ref);
            const latest = snapshot.exists ? { batchId: snapshot.id, ...snapshot.data() } : null;
            if (!latest || latest.churchId !== churchId) throw httpError(404, "Message batch not found.");
            if (latest.status !== "dispatching" || !isStaleSending({ sendStartedAt: latest.dispatchStartedAt })) return latest;
            const recovered = { ...latest, status: "partial", dispatchInterruptedAt: nowIso(), updatedAt: nowIso() };
            transaction.set(ref, recovered, { merge: true });
            return recovered;
          });
        } else {
          current = await runMemoryClaim(batch.batchId, async () => {
            const latest = await getBatchForChurch(batch.batchId, churchId);
            if (latest.status !== "dispatching" || !isStaleSending({ sendStartedAt: latest.dispatchStartedAt })) return latest;
            const recovered = { ...latest, status: "partial", dispatchInterruptedAt: nowIso(), updatedAt: nowIso() };
            await setDoc(COLLECTIONS.notificationBatches, batch.batchId, recovered, { merge: true });
            return recovered;
          });
        }
      }
      return res.json({ success: true, batch: await formatBatchDetail(current) });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ success: false, errorMessage: safeErrorMessage(error, "Could not load this message batch.") });
    }
  };

  const dispatchAvailabilityBatch = async (req, res) => {
    try {
      await assertCsrf(req);
      const churchId = normalize(req.params.churchId);
      const admin = await requireTeamsEdit(req, churchId);
      if (req.body?.confirmed !== true) throw httpError(400, "Confirm this exact message batch before sending.");
      const batchId = normalize(req.params.batchId);
      const requestedApprovalVersion = normalize(req.body?.approvalVersion);
      const db = requireFirestore();
      let batch;
      const claim = (current) => {
        if (!current || current.churchId !== churchId) throw httpError(404, "Message batch not found.");
        if (!requestedApprovalVersion || requestedApprovalVersion !== current.reviewVersion) throw httpError(409, "This batch preview changed or expired. Review the current batch and confirm again.");
        if (current.status === "dispatching" && !isStaleSending({ sendStartedAt: current.dispatchStartedAt })) throw httpError(409, "This message batch is already being sent.");
        const recoverableStatus = current.status === "dispatching" ? "partial" : current.status;
        if (!["prepared", "partial"].includes(recoverableStatus)) throw httpError(409, "This message batch has already been completed.");
        return { ...current, status: "dispatching", approvedByUid: admin.user.uid, confirmedAt: nowIso(), dispatchStartedAt: nowIso(), updatedAt: nowIso() };
      };
      if (db) {
        batch = await db.runTransaction(async (transaction) => {
          const ref = db.collection(COLLECTIONS.notificationBatches).doc(batchId);
          const snapshot = await transaction.get(ref);
          const current = snapshot.exists ? { batchId: snapshot.id, ...snapshot.data() } : null;
          const next = claim(current);
          transaction.set(ref, next, { merge: true });
          return next;
        });
      } else {
        batch = await runMemoryClaim(batchId, async () => {
          const current = await getBatchForChurch(batchId, churchId);
          const next = claim(current);
          await setDoc(COLLECTIONS.notificationBatches, batchId, next, { merge: true });
          return next;
        });
      }
      const selectedIds = new Set(batch.intentIds || []);
      const results = [];
      for (const intentId of selectedIds) {
        const current = await getDoc(COLLECTIONS.notificationIntents, intentId);
        const batchRecipient = (batch.recipients || []).find((row) => row.intentId === intentId);
        if (current?.status === "sending" && isStaleSending(current)) {
          await markUnknownAfterInterruption(current);
          results.push({ intentId, status: "unknown", outcome: "unknown" });
          continue;
        }
        if (current?.batchId !== batchId || batchRecipient?.approvalVersion !== current?.approvalSnapshot?.approvalVersion) {
          results.push({ intentId, status: current?.status || "missing", outcome: "not_sent", error: "Review expired or changed." });
          continue;
        }
        if (!current || current.churchId !== churchId || !["preview", "ready"].includes(current.status)) {
          results.push({ intentId, status: current?.status || "missing", outcome: current?.outcome || "" });
          continue;
        }
        const sendRes = {
          statusCode: 200,
          status(code) { this.statusCode = code; return this; },
          json(payload) { this.payload = payload; return this; },
        };
        await sendIntent({ ...req, params: { ...req.params, churchId, intentId }, body: { confirmed: true, approvalVersion: batchRecipient.approvalVersion } }, sendRes);
        const refreshed = await getDoc(COLLECTIONS.notificationIntents, intentId);
        results.push({ intentId, status: refreshed?.status || "failed", outcome: refreshed?.outcome || (sendRes.payload?.success ? "confirmed" : ""), errorMessage: sendRes.payload?.errorMessage || "" });
      }
      const errorByIntentId = new Map(results.filter((row) => row.errorMessage).map((row) => [row.intentId, row.errorMessage]));
      const refreshedRecipients = await Promise.all((batch.recipients || []).map(async (row) => {
        const intent = row.intentId ? await getDoc(COLLECTIONS.notificationIntents, row.intentId) : null;
        const errorMessage = errorByIntentId.get(row.intentId) || "";
        const currentSnapshot = intent?.approvalSnapshot;
        return {
          ...row,
          status: intent?.status || row.status,
          attemptId: intent?.attemptId || "",
          outcome: intent?.outcome || "",
          approvalVersion: currentSnapshot?.approvalVersion || "",
          eligible: Boolean(currentSnapshot?.approvalVersion && Number(currentSnapshot.expiresAt) > Date.now() && ["preview", "ready"].includes(intent?.status)),
          exclusionReason: errorMessage || (!currentSnapshot && ["preview", "ready"].includes(intent?.status) ? "This message needs a fresh preview." : row.exclusionReason),
          ...( /opted out/i.test(errorMessage) ? { eligibilityStatus: "opted_out" } : {}),
        };
      }));
      const allDone = refreshedRecipients.every((row) => !["preview", "ready", "sending"].includes(row.status));
      const anyFailure = refreshedRecipients.some((row) => ["failed", "unknown"].includes(row.status));
      const nextBatch = {
        ...batch,
        status: allDone && !anyFailure ? "sent" : "partial",
        recipients: refreshedRecipients,
        lastDispatchResults: results,
        completedAt: nowIso(),
        updatedAt: nowIso(),
      };
      await setDoc(COLLECTIONS.notificationBatches, batchId, nextBatch, { merge: true });
      return res.json({ success: true, batch: await formatBatchDetail(nextBatch) });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ success: false, errorMessage: safeErrorMessage(error, "Could not send this message batch.") });
    }
  };

  const dispatchAutomatically = async () => {
    throw httpError(403, "Automatic notification sends are disabled by the server.");
  };

  return {
    listIntents,
    getIntentPreview,
    sendIntent,
    sendTeamIntakeIntent,
    prepareTeamIntakeIntent,
    prepareReplacementInvitation,
    resolveReplacementInvitation,
    prepareAvailabilityBatch,
    getAvailabilityBatch,
    dispatchAvailabilityBatch,
    saveEventIntents,
    dispatchAutomatically,
    automaticSendsDisabled: automaticSendsDisabled === true,
  };
};
