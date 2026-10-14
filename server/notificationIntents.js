import { randomBytes } from "node:crypto";
import {
  approveReviewedScheduleBatch,
  claimReviewedNotificationBatch,
  createScheduleBatchStoreOperations,
  createScheduleBatchDispatcher,
  executeReviewedNotificationBatch,
  notificationBatchReviewVersion,
  ownsScheduleBatchLease,
} from "./notificationBatches.js";
import { resolveScheduleSmsDispatchConfig } from "./scheduleSmsDispatchConfig.js";
import { isChurchMessagingReady, normalizeChurchMessagingConfig } from "./churchMessagingConfig.js";
import { resolveSmsMemberEligibility } from "./smsEligibility.js";
import { smsConsentIdForChurchPhone } from "./smsConsent.js";
import { createSmsDeliveryReconciler, withSmsDeliveryLock, hasConfirmedSmsEvidence, normalizeSmsDeliveryStatus } from "./smsDeliveryAttempts.js";
import { deliveryKey as notificationDeliveryKey } from "./notificationLedger.js";
import { buildTeamIntakeSms, measureSmsMessage } from "./smsMessage.js";
import {
  buildScheduleInitialSmsMessage,
  getScheduleMemberAssignments,
  mapWithConcurrency,
  scheduleInitialSmsIdempotencyKey,
} from "./scheduleInitialSms.js";
import { hasPersonalizedIntakeResponseFields, intakeFormCollectsServiceAvailability } from "./teamIntakeFields.js";

export const NOTIFICATION_INTENT_TYPES = Object.freeze([
  "availability_request",
  "availability_reminder",
  "assignment_notification",
  "assignment_confirmation",
  "schedule_change",
  "replacement_request",
  "schedule_initial_notification",
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
// The explicit environment switch stays off by default. Segment pacing is
// mandatory so a future activation cannot inherit an unverified send rate.
export const SCHEDULE_BULK_DISPATCH_READY = resolveScheduleSmsDispatchConfig().enabled;

// This foundation has no automatic send path. Keep this server-side kill
// switch hard-disabled until a separately reviewed product change authorizes it.
export const AUTOMATIC_NOTIFICATION_SENDS_DISABLED = true;

const normalize = (value) => String(value ?? "").trim();
const safeErrorMessage = (error, fallback) => {
  const value = normalize(error?.message);
  if (!value || /https?:\/\/|(?:^|\/)\/?(?:a|schedule-response|teams\/intake)\//i.test(value)) return fallback;
  return value.slice(0, 300);
};
const safeProviderFailureMessage = (error, fallback) => {
  const value = normalize(error?.message || error?.details?.message || error?.response?.data?.message);
  if (!value) return fallback;
  return value
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[URL]")
    .slice(0, 500);
};
const publicAttempt = ({ callbackToken: _callbackToken, ...attempt }) => attempt;
const intentIdFor = (hashValue, churchId, idempotencyKey) =>
  hashValue(`${churchId}|notification-intent|${idempotencyKey}`);
const scheduleInitialBatchIdFor = (hashValue, churchId, scheduleId) =>
  hashValue(`${churchId}|notification-batch|schedule_initial_sms|${scheduleId}|initial`);

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
  authorizeSchedule = async (req, churchId) => ({ admin: await requireTeamsEdit(req, churchId), scoped: false }),
  authorizeScheduleActor = async () => { throw httpError(403, "Schedule management access is no longer available."); },
  authorizeAvailabilityForm = async () => {
    throw httpError(403, "Availability form access required.");
  },
  isAvailabilityRecipientInFormScope = async () => true,
  getSmsConsentForChurchPhone,
  prepareAvailabilityNotificationRecipients = async () => ({ form: null, results: [] }),
  prepareScheduleInitialSmsRecipients = async () => [],
  resolveAvailabilityNotificationContext = async () => null,
  resolveScheduleNotificationContext = async () => null,
  validateReplacementCandidate = async () => { throw httpError(501, "Replacement candidate validation is unavailable."); },
  smsProviderFactory,
  validateTwilioStatusCallbackUrl,
  setDoc,
  automaticSendsDisabled = AUTOMATIC_NOTIFICATION_SENDS_DISABLED,
  scheduleBulkDispatchReady = SCHEDULE_BULK_DISPATCH_READY,
  scheduleSmsDispatchConfig = resolveScheduleSmsDispatchConfig(),
  logger = console,
}) => {
  const reconcileDelivery = createSmsDeliveryReconciler({ COLLECTIONS, getDoc, setDoc, requireFirestore, nowIso });
  const isScheduleBulkDispatchReady = () => Boolean(scheduleBulkDispatchReady && requireFirestore());
  const memoryClaims = new Map();
  const backgroundScheduleRequests = new WeakMap();
  let scheduleBatchDispatcher = null;
  const runMemoryClaim = (id, task) => {
    const previous = memoryClaims.get(id) || Promise.resolve();
    const current = previous.then(task, task);
    memoryClaims.set(id, current.then(() => undefined, () => undefined));
    return current;
  };

  const mutateIntent = async (churchId, intentId, change) => {
    const db = requireFirestore();
    const apply = async (read, write) => {
      const current = await read(COLLECTIONS.notificationIntents, intentId);
      const attempt = current?.attemptId ? await read(COLLECTIONS.smsDeliveryAttempts, current.attemptId) : null;
      const patch = change(current, attempt);
      if (patch) await write(patch);
      return patch ? { ...current, ...patch } : current;
    };
    if (db) return db.runTransaction(async (transaction) => apply(
      async (collection, id) => {
        const snap = await transaction.get(db.collection(collection).doc(id));
        return snap.exists ? snap.data() : null;
      },
      (patch) => transaction.set(db.collection(COLLECTIONS.notificationIntents).doc(intentId), patch, { merge: true }),
    ));
    return withSmsDeliveryLock(getDoc, `${churchId}|${intentId}`, () => apply(getDoc,
      (patch) => setDoc(COLLECTIONS.notificationIntents, intentId, patch, { merge: true })));
  };

  const deleteUnusedIntent = async (churchId, intentId) => {
    const unused = (current) => current?.churchId === churchId &&
      ["preview", "ready"].includes(current.status) && !current.attemptId && !current.providerAcceptedAttemptId;
    const db = requireFirestore();
    if (db) return db.runTransaction(async (transaction) => {
      const ref = db.collection(COLLECTIONS.notificationIntents).doc(intentId);
      const snapshot = await transaction.get(ref);
      if (snapshot.exists && unused(snapshot.data())) transaction.delete(ref);
    });
    return withSmsDeliveryLock(getDoc, `${churchId}|${intentId}`, async () => {
      if (unused(await getDoc(COLLECTIONS.notificationIntents, intentId))) await deleteDoc(COLLECTIONS.notificationIntents, intentId);
    });
  };

  const listChurchDocs = (collection, churchId, filters = [], limit = 500) =>
    queryDocs(collection, [{ field: "churchId", value: churchId }, ...filters], { limit });

  const redactPersonalizedLinks = (message) => normalize(message)
    .replace(/(?:https?:\/\/[^\s]+)?\/a\/[^\s?#]+/gi, "[private response link]")
    .replace(/(?:https?:\/\/[^\s]+)?\/(?:schedule-response|teams\/intake)\/[^\s?#]+/gi, "[private response link]");

  const accessFingerprintFor = ({ admin, scoped, schedule } = {}) => {
    if (!scoped) return "";
    const teamScopes = admin?.permissions?.teamScopes || {};
    return hashValue(JSON.stringify({
      uid: admin?.user?.uid || "",
      role: admin?.role || "",
      teams: admin?.permissions?.teams || "none",
      teamScopes: Object.fromEntries(Object.entries(teamScopes).sort(([a], [b]) => a.localeCompare(b))),
      ...(schedule ? { scheduleId: schedule.scheduleId || schedule.id, teamId: schedule.teamId } : {}),
    }));
  };

  const authorizeForm = async (req, churchId, formId) => {
    const form = await getDoc(COLLECTIONS.teamIntakeForms, formId);
    if (!form || form.churchId !== churchId) throw httpError(404, "Availability form not found.");
    let admin;
    try {
      admin = await requireTeamsEdit(req, churchId);
      if (form.purpose !== "team_availability") return { form, admin, scoped: false };
    } catch {
      // The purpose-specific guard below decides whether a selected-Team
      // editor may manage this exact form.
    }
    const access = await authorizeAvailabilityForm(req, churchId, form);
    return { form, ...access };
  };

  const authorizeIntent = async (req, churchId, intent) => {
    if (!intent || intent.churchId !== churchId) throw httpError(404, "Message preview not found.");
    if (intent.sourceType === "team_schedule") {
      return authorizeScheduleSource(req, churchId, intent.sourceId, intent.cellKey);
    }
    if (intent.sourceType !== "team_intake_recipient" || !intent.formId) {
      throw httpError(404, "Message preview not found.");
    }
    const access = await authorizeForm(req, churchId, intent.formId);
    if (
      access.scoped === true &&
      access.form?.purpose === "team_availability" &&
      !(await isAvailabilityRecipientInFormScope({
        churchId,
        formId: intent.formId,
        recipientId: intent.recipientId || intent.sourceId,
        memberId: intent.memberId,
      }))
    ) {
      throw httpError(404, "Message preview not found.");
    }
    return access;
  };

  const authorizeScheduleSource = async (req, churchId, scheduleId, cellKey = "", records = null) => {
    const schedule = records ? records.schedule : await getDoc(COLLECTIONS.teamSchedules, scheduleId);
    if (!schedule || schedule.churchId !== churchId) throw httpError(404, "Schedule not found.");
    return { schedule, ...await authorizeSchedule(req, churchId, schedule, cellKey) };
  };

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
    const result = await reconcileDelivery({
      churchId: intent.churchId, intentId: intent.intentId, attemptId: intent.attemptId,
      expectedIntent: intent, recovery: true, isStaleSending,
      update: { status: "pending", outcome: "unknown", failureCode: "dispatch_interrupted" },
    });
    return result.intent || intent;
  };

  const messageFor = ({ intentType, church, schedule, occurrence, form, publicUrl, responseUrl, serviceName, positionName }) => {
    const churchName = normalize(church?.name) || "Your church";
    const currentServiceName = normalize(serviceName || occurrence?.name) || "an upcoming service";
    let date = "an upcoming date";
    if (occurrence?.serviceDate && /^\d{4}-\d{2}-\d{2}$/.test(occurrence.serviceDate)) {
      const [year, month, day] = occurrence.serviceDate.split("-").map(Number);
      date = new Date(Date.UTC(year, month - 1, day, 12)).toLocaleDateString("en-US", {
        timeZone: "UTC", weekday: "short", month: "short", day: "numeric",
      });
    } else if (occurrence?.startsAt) {
      const startsAt = new Date(occurrence.startsAt);
      if (!Number.isNaN(startsAt.getTime())) {
        try {
          date = startsAt.toLocaleDateString("en-US", {
            timeZone: church?.serviceTimeZone || "UTC",
            weekday: "short", month: "short", day: "numeric",
          });
        } catch {
          date = startsAt.toLocaleDateString("en-US", {
            timeZone: "UTC", weekday: "short", month: "short", day: "numeric",
          });
        }
      }
    }
    switch (intentType) {
      case "availability_request":
      case "availability_reminder":
        return buildTeamIntakeSms({
          churchName,
          formName: normalize(form?.name) || "availability",
          publicUrl,
          intentType,
          collectsAvailability: intakeFormCollectsServiceAvailability(form?.enabledFields, form?.availabilityOccurrences),
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
      if (records) {
        schedule = records.schedule;
        if (intent.intentType === "schedule_initial_notification") {
          sourceContext = {
            schedule,
            member,
            church,
            assignments: getScheduleMemberAssignments({ schedule, memberId: intent.memberId, positions: records.positions || [] }),
            serviceTimeZone: records.serviceTimeZone || "UTC",
            responseUrl: records.responseUrl || "",
          };
        }
      }
      else {
        sourceContext = await resolveScheduleNotificationContext(intent) || {};
        schedule = sourceContext.schedule;
      }
      if (!church) church = sourceContext.church || await getDoc(COLLECTIONS.churches, churchId);
      if (!member) member = sourceContext.member || await getDoc(COLLECTIONS.teamRosterMembers, intent.memberId);
      if (!config) config = await getDoc(COLLECTIONS.churchMessagingConfigs, churchId);
      if (!schedule || schedule.churchId !== churchId || schedule.archivedAt || !church) throw httpError(409, "The source schedule is no longer available.");
      if (schedule.published === false) throw httpError(409, "Publish this schedule before sending messages.");
      if (intent.intentType !== "schedule_initial_notification" && !sourceContext.positionName) {
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
      if (
        !recipient ||
        recipient.churchId !== churchId ||
        recipient.formId !== form.formId ||
        recipient.revokedAt ||
        recipient.memberId !== intent.memberId
      ) {
        throw httpError(409, "This individual intake request is no longer available.");
      }
      if (recipient.respondedAt) throw httpError(409, "This volunteer has already responded.");
    }
    if (!member || member.churchId !== churchId || member.archivedAt) throw httpError(409, "This volunteer is no longer active on this church roster.");
    let occurrence = null;
    if (intent.sourceType === "team_schedule") {
      if (intent.intentType === "schedule_initial_notification") {
        sourceContext.assignments ||= getScheduleMemberAssignments({
          schedule,
          memberId: intent.memberId,
          positions: sourceContext.positions || [],
        });
        if (!sourceContext.assignments.length) throw httpError(409, "This volunteer no longer has assignments on this schedule.");
      } else {
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
      ? buildTeamIntakeSms({ churchName: church?.name, formName: form.name, publicUrl: responseUrlOverride || sourceContext.publicUrl, intentType: intent.intentType, collectsAvailability: intakeFormCollectsServiceAvailability(form.enabledFields, form.availabilityOccurrences) }).body
      : intent.intentType === "schedule_initial_notification"
        ? buildScheduleInitialSmsMessage({ churchName: church?.name, assignments: sourceContext.assignments, responseUrl: responseUrlOverride || sourceContext.responseUrl, timeZone: sourceContext.serviceTimeZone })
        : messageFor({ intentType: intent.intentType, church, schedule, occurrence, ...sourceContext, responseUrl: responseUrlOverride || sourceContext.responseUrl });
    if (intent.sourceType === "team_schedule" && intent.sourceVersion && intent.sourceVersion !== normalize(schedule.updatedAt) && !["assignment_notification", "schedule_initial_notification"].includes(intent.intentType)) {
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
      : intent.intentType === "schedule_initial_notification"
        ? {
            scheduleId: schedule.scheduleId || intent.sourceId,
            published: schedule.published !== false,
            assignments: sourceContext.assignments.map((assignment) => ({
              occurrenceId: assignment.occurrenceId,
              serviceName: assignment.serviceName,
              serviceDate: assignment.serviceDate,
              startsAt: assignment.startsAt,
              positions: assignment.positions.map(({ positionId, positionName }) => ({ positionId, positionName })),
            })),
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
    availabilityAccessFingerprint: validated.availabilityAccessFingerprint || "",
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

  const prepareIntentReview = async (intent, { authorizationFingerprint = "" } = {}) => {
    const prior = intent.approvalSnapshot;
    const stillFresh = prior && Number(prior.expiresAt || 0) > Date.now();
    const validated = await validateIntent(intent, {
      requireConsent: false,
      responseUrlOverride: stillFresh ? prior.responseUrl || "" : "",
    });
    validated.availabilityAccessFingerprint = authorizationFingerprint;
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
      availabilityAccessFingerprint: authorizationFingerprint,
      segmentCount: measureSmsMessage(validated.message).segmentCount,
      responseUrl: validated.responseUrl || "",
      reviewedAt,
      expiresAt: Date.now() + NOTIFICATION_PREVIEW_TTL_MS,
    } : null;
    const reviewedIntent = await mutateIntent(intent.churchId, intent.intentId, (current, attempt) => {
      if (!current || current.churchId !== intent.churchId) throw httpError(404, "Message preview not found.");
      if (!["preview", "ready", "failed"].includes(current.status) || current.providerMessageId ||
          current.providerAcceptedAttemptId || hasConfirmedSmsEvidence(attempt) || attempt?.outcome === "unknown") {
        throw httpError(409, "This message is no longer available for preview.");
      }
      if (["attemptId", "batchId", "sourceType", "sourceId", "sourceVersion", "intentType", "memberId", "recipientId", "formId", "occurrenceId", "cellKey", "reminderRound"]
        .some((key) => normalize(current[key]) !== normalize(intent[key]))) {
        throw httpError(409, "This preview changed or expired. Review the current message and confirm again.");
      }
      return { message: validated.message, approvalSnapshot: snapshot, updatedAt: reviewedAt };
    });
    return {
      intent: { ...reviewedIntent, intentId: intent.intentId },
      validated,
      approvalVersion,
      eligible: Boolean(approvalVersion),
    };
  };

  const reviewStillMatches = (intent, validated, approvalVersion, authorizationFingerprint = "", { allowExpired = false } = {}) => {
    const snapshot = intent.approvalSnapshot;
    if (!snapshot || !Number(snapshot.expiresAt) || (!allowExpired && Number(snapshot.expiresAt) <= Date.now())) return false;
    if (!approvalVersion || approvalVersion !== snapshot.approvalVersion) return false;
    if (validated.eligibilityStatus !== "enabled" || validated.message !== intent.message) return false;
    if (snapshot.phoneHash !== hashValue(validated.phoneNumber)) return false;
    if (snapshot.sourceFingerprint !== validated.sourceFingerprint) return false;
    if ((snapshot.availabilityAccessFingerprint || "") !== authorizationFingerprint) return false;
    validated.availabilityAccessFingerprint = authorizationFingerprint;
    return approvalVersionFor(intent, validated) === snapshot.approvalVersion;
  };

  const reviewedIntentProjection = (reviewed, { scoped = false } = {}) => ({
    ...safeIntentProjection(reviewed.intent, {
      approvalVersion: reviewed.approvalVersion,
      segmentCount: measureSmsMessage(reviewed.validated.message).segmentCount,
      phoneNumberSnapshot: scoped ? "" : reviewed.validated.phoneNumber || "",
      maskedPhoneNumber: reviewed.validated.phoneNumber ? `••• ••• ${reviewed.validated.phoneNumber.slice(-4)}` : "",
      previewEligible: reviewed.eligible,
      previewError: reviewed.eligible ? "" : "This volunteer is not currently eligible for SMS.",
    }),
    message: scoped ? redactPersonalizedLinks(reviewed.validated.message) : reviewed.validated.message,
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
        const created = await mutateIntent(churchId, id, (current) => current ? null : { intentId: id, ...intent });
        saved.push(created);
      }
    }
    return saved;
  };

  const listIntents = async (req, res) => {
    try {
      const churchId = normalize(req.params.churchId);
      const formId = normalize(req.query?.formId);
      const scheduleId = normalize(req.query?.scheduleId);
      if (formId && scheduleId) throw httpError(400, "Choose an intake form or schedule history view.");
      const formAccess = formId ? await authorizeForm(req, churchId, formId) : null;
      let scheduleAccess = scheduleId ? await authorizeScheduleSource(req, churchId, scheduleId) : null;
      if (!formId && !scheduleId) await requireTeamsEdit(req, churchId);
      const filters = formId
        ? [{ field: "formId", value: formId }]
        : scheduleId
          ? [{ field: "sourceId", value: scheduleId }, { field: "sourceType", value: "team_schedule" }]
          : [];
      const limit = Math.max(1, Math.min(100, Number.parseInt(req.query?.limit, 10) || 50));
      const cursor = normalize(req.query?.cursor);
      const page = await listIntentPage({ churchId, filters, limit, cursor });
      let intents = formId
        ? (page.intents || []).filter((intent) =>
            intent?.sourceType === "team_intake_recipient" &&
            intent.formId === formId &&
            intent.churchId === churchId,
          )
        : page.intents || [];
      if (formAccess?.scoped === true && formAccess.form?.purpose === "team_availability") {
        const inScope = [];
        for (const intent of intents) {
          if (await isAvailabilityRecipientInFormScope({
            churchId,
            formId,
            recipientId: intent.recipientId || intent.sourceId,
            memberId: intent.memberId,
          })) inScope.push(intent);
        }
        intents = inScope;
      }
      // Authorize every persisted row before loading attempt details or recovery.
      if (scheduleAccess) {
        scheduleAccess = await authorizeScheduleSource(req, churchId, scheduleId, intents.map((intent) => intent.cellKey));
      }
      const attemptByIntentId = await loadAttemptsForIntents(churchId, intents);
      const recipients = formId
        ? await listChurchDocs(COLLECTIONS.teamIntakeRecipients, churchId, [{ field: "formId", value: formId }], 1000)
        : [];
      const recipientById = new Map(recipients.map((recipient) => [recipient.recipientId || recipient.id, recipient]));
      const schedule = scheduleAccess?.schedule || null;
      const enriched = await Promise.all(intents.map(async (intent) => {
        let currentIntent = intent;
        if ((intent.status === "sending" && isStaleSending(intent)) || intent.status === "unknown") {
          currentIntent = await markUnknownAfterInterruption(intent);
        }
        const attempt = currentIntent.attemptId
          ? await getDoc(COLLECTIONS.smsDeliveryAttempts, currentIntent.attemptId)
          : attemptByIntentId.get(currentIntent.intentId);
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
      return res.status(error.statusCode || 500).json({ success: false, errorMessage: safeErrorMessage(error, "Could not load message previews."), ...(error?.code === "AUTH_CSRF_MISMATCH" ? { code: error.code } : {}) });
    }
  };

  const getIntentPreview = async (req, res) => {
    try {
      await assertCsrf(req);
      const churchId = normalize(req.params.churchId);
      const intent = await getDoc(COLLECTIONS.notificationIntents, normalize(req.params.intentId));
      if (!intent || intent.churchId !== churchId) throw httpError(404, "Message preview not found.");
      const access = await authorizeIntent(req, churchId, intent);
      const authorizationFingerprint = accessFingerprintFor(access);
      if (!["preview", "ready", "failed"].includes(intent.status)) throw httpError(409, "This message is no longer available for preview.");
      const reviewed = await prepareIntentReview(intent, { authorizationFingerprint });
      const current = reviewed.validated;
      const maskedPhoneNumber = current.phoneNumber ? `••• ••• ${current.phoneNumber.slice(-4)}` : "";
      return res.json({
        success: true,
        preview: {
          intentId: intent.intentId,
          intentType: intent.intentType,
          memberId: intent.memberId,
          approvalVersion: reviewed.approvalVersion,
          expiresAt: reviewed.intent.approvalSnapshot?.expiresAt || 0,
          eligible: reviewed.eligible,
          ...(!access.scoped ? { eligibilityStatus: current.eligibilityStatus } : {}),
          message: access.scoped ? redactPersonalizedLinks(current.message) : current.message,
          phoneNumberSnapshot: access.scoped ? maskedPhoneNumber : current.phoneNumber || "",
          characterCount: measureSmsMessage(current.message).characterCount,
          segmentCount: measureSmsMessage(current.message).segmentCount,
          maskedPhoneNumber,
        },
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ success: false, errorMessage: safeErrorMessage(error, "Could not load this message preview."), ...(error?.code === "AUTH_CSRF_MISMATCH" ? { code: error.code } : {}) });
    }
  };

  const claimIntent = async ({ intentId, churchId, actorUid, attemptId, approvalVersion, authorizationFingerprint = "", allowExpiredReview = false }) => {
    const db = requireFirestore();
    const callbackToken = randomBytes(32).toString("hex");
    const claim = async (current, records = null) => {
      if (!current || current.churchId !== churchId) throw httpError(404, "Message preview not found.");
      if (current.providerAcceptedAttemptId) throw httpError(409, "This message was already accepted by the provider.");
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
      validated.availabilityAccessFingerprint = authorizationFingerprint;
      if (!reviewStillMatches(current, validated, approvalVersion, authorizationFingerprint, { allowExpired: allowExpiredReview })) {
        return { invalidated: true, errorMessage: "The recipient, phone number, consent, source, or message changed. Review and confirm the current preview again.", statusCode: 409 };
      }
      const sendStartedAt = nowIso();
      const next = { ...current, status: "sending", outcome: "", attemptId, approvedByUid: actorUid, approvedAt: sendStartedAt, sendStartedAt, updatedAt: sendStartedAt };
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
        const schedule = scheduleSnap?.exists ? { scheduleId: scheduleSnap.id, ...scheduleSnap.data() } : null;
        const positionIds = current.intentType === "schedule_initial_notification"
          ? [...new Set(Object.values(schedule?.assignments || {}).flatMap((cells) =>
              Object.keys(cells || {}).map((cellKey) => String(cellKey).split("::")[0]).filter(Boolean),
            ))]
          : [];
        const positionSnapshots = await Promise.all(positionIds.map((positionId) =>
          transaction.get(db.collection(COLLECTIONS.teamPositions).doc(positionId)),
        ));
        const member = memberSnap.exists ? memberSnap.data() : null;
        const preliminary = resolveSmsMemberEligibility({ member, churchId, consent: null });
        const consentId = preliminary.phoneNumber ? smsConsentIdForChurchPhone(churchId, preliminary.phoneNumber) : null;
        const consentSnap = consentId
          ? await transaction.get(db.collection(COLLECTIONS.smsConsents).doc(consentId))
          : null;
        const records = {
          schedule,
          form: formSnap?.exists ? { formId: formSnap.id, ...formSnap.data() } : null,
          recipient: recipientSnap?.exists ? { recipientId: recipientSnap.id, ...recipientSnap.data() } : null,
          member,
          church: churchSnap.exists ? { churchId: churchSnap.id, ...churchSnap.data() } : null,
          config: configSnap.exists ? { churchId: configSnap.id, ...configSnap.data() } : null,
          consent: consentSnap?.exists ? { consentId, ...consentSnap.data() } : null,
          positions: positionSnapshots.map((snapshot, index) => snapshot.exists
            ? { positionId: positionIds[index], ...snapshot.data() }
            : null).filter(Boolean),
          serviceTimeZone: churchSnap.exists ? churchSnap.data()?.serviceTimeZone || "UTC" : "UTC",
        };
        const previousAttempt = current.attemptId ? await transaction.get(db.collection(COLLECTIONS.smsDeliveryAttempts).doc(current.attemptId)) : null;
        if (previousAttempt?.exists && (hasConfirmedSmsEvidence(previousAttempt.data()) || previousAttempt.data().outcome === "unknown")) throw httpError(409, "This send has a confirmed or uncertain provider outcome.");
        const result = await claim(current, records);
        if (result.invalidated) {
          transaction.set(intentRef, { status: "preview", approvalSnapshot: null, updatedAt: nowIso() }, { merge: true });
          return result;
        }
        const attempt = {
          callbackToken, providerAccountId: result.validated.config.twilioAccountSid || process.env.TWILIO_ACCOUNT_SID || "",
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
    const result = await withSmsDeliveryLock(getDoc, `${churchId}|${intentId}`, async () => {
      const current = await getDoc(COLLECTIONS.notificationIntents, intentId);
      const previousAttempt = current?.attemptId ? await getDoc(COLLECTIONS.smsDeliveryAttempts, current.attemptId) : null;
      if (hasConfirmedSmsEvidence(previousAttempt) || previousAttempt?.outcome === "unknown") throw httpError(409, "This send has a confirmed or uncertain provider outcome.");
      const result = await claim(current);
      if (result.invalidated) {
        await setDoc(COLLECTIONS.notificationIntents, intentId, { status: "preview", approvalSnapshot: null, updatedAt: nowIso() }, { merge: true });
        return result;
      }
      const attempt = {
        callbackToken, providerAccountId: result.validated.config.twilioAccountSid || process.env.TWILIO_ACCOUNT_SID || "",
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
    let scopedAccess = false;
    let confirmedResult = null;
    try {
      const backgroundContext = backgroundScheduleRequests.get(req) || null;
      if (!backgroundContext) await assertCsrf(req);
      const churchId = normalize(req.params.churchId);
      const intentId = normalize(req.params.intentId);
      const currentIntent = await getDoc(COLLECTIONS.notificationIntents, intentId);
      if (!currentIntent || currentIntent.churchId !== churchId) throw httpError(404, "Message preview not found.");
      const readBackgroundApproval = async () => {
        if (!backgroundContext || !isScheduleBulkDispatchReady()) throw httpError(503, "Bulk schedule SMS is not ready for dispatch.");
        const batch = await getBatchForChurch(backgroundContext.batchId, churchId);
        if (!ownsScheduleBatchLease(batch, backgroundContext.ownership) || batch.status !== "dispatching") {
          throw httpError(409, "This schedule dispatcher no longer owns the batch.");
        }
        const recipient = (batch.approval?.recipients || []).find((row) => row.intentId === intentId);
        if (!recipient || recipient.approvalVersion !== currentIntent.approvalSnapshot?.approvalVersion ||
            recipient.message !== currentIntent.message || currentIntent.batchId !== batch.batchId ||
            currentIntent.sourceType !== "team_schedule" || currentIntent.sourceId !== batch.scheduleId) {
          throw httpError(409, "This approved message no longer matches its saved review.");
        }
        const access = await authorizeScheduleActor({
          churchId, scheduleId: batch.scheduleId, actorUid: batch.approval.actorUid,
        });
        return { batch, recipient, access };
      };
      let backgroundApproval = backgroundContext ? await readBackgroundApproval() : null;
      const access = backgroundApproval?.access || await authorizeIntent(req, churchId, currentIntent);
      scopedAccess = Boolean(access.scoped);
      const authorizationFingerprint = accessFingerprintFor(access);
      const actorUid = backgroundApproval?.batch.approval.actorUid || access.admin?.user?.uid;
      if (currentIntent.intentType === "schedule_initial_notification" && !backgroundContext) {
        throw httpError(503, "Bulk schedule SMS is disabled until safe background dispatch and restart recovery are ready.");
      }
      if (req.body?.confirmed !== true || !normalize(req.body?.approvalVersion)) throw httpError(400, "Review and confirm this exact SMS before sending.");
      if (backgroundApproval && normalize(req.body.approvalVersion) !== backgroundApproval.recipient.approvalVersion) {
        throw httpError(409, "This approved message no longer matches its saved review.");
      }
      attemptId = createId("smsAttempt");
      const claimed = await claimIntent({
        intentId, churchId, actorUid, attemptId,
        approvalVersion: normalize(req.body.approvalVersion), authorizationFingerprint,
        allowExpiredReview: Boolean(backgroundContext),
      });
      intent = claimed.next;
      const attempt = claimed.attempt;
      let phoneNumber = claimed.validated.phoneNumber;
      let config = claimed.validated.config;
      // A final read immediately before the external side effect catches a
      // roster edit, opt-out, schedule change, or disablement after approval.
      const finalCheck = await validateIntent(intent, { responseUrlOverride: intent.approvalSnapshot?.responseUrl || "" });
      backgroundApproval = backgroundContext ? await readBackgroundApproval() : null;
      const finalAccess = backgroundApproval?.access || await authorizeIntent(req, churchId, intent);
      const finalAuthorizationFingerprint = accessFingerprintFor(finalAccess);
      finalCheck.availabilityAccessFingerprint = finalAuthorizationFingerprint;
      if (!reviewStillMatches(intent, finalCheck, intent.approvalSnapshot?.approvalVersion || "", finalAuthorizationFingerprint, { allowExpired: Boolean(backgroundContext) })) {
        throw httpError(409, "The recipient, phone number, consent, source, or message changed. Review and confirm the current preview again.");
      }
      phoneNumber = finalCheck.phoneNumber;
      config = finalCheck.config;
      await setDoc(COLLECTIONS.smsDeliveryAttempts, attemptId, {
        phoneNumberSnapshot: phoneNumber,
        updatedAt: nowIso(),
      }, { merge: true });
      const latestClaim = await getDoc(COLLECTIONS.notificationIntents, intentId);
      if (!latestClaim || latestClaim.churchId !== churchId || latestClaim.attemptId !== attemptId ||
          (latestClaim.providerAcceptedAttemptId && latestClaim.providerAcceptedAttemptId !== attemptId)) {
        throw httpError(409, "This send claim changed or a prior attempt was accepted. Review delivery history.");
      }
      const provider = smsProviderFactory({ config, churchId });
      const callbackBase = validateTwilioStatusCallbackUrl();
      const callback = callbackBase ? new URL(callbackBase) : null;
      if (callback) {
        callback.searchParams.set("attempt", attemptId);
        callback.searchParams.set("correlation", attempt.callbackToken);
      }
      const statusCallbackUrl = callback?.toString();
      let result;
      providerCallStarted = true;
      try {
        result = await provider.sendMessage({ to: finalCheck.phoneNumber, body: finalCheck.message, statusCallbackUrl });
      } catch (error) {
        const definitive = error?.definitiveRejection === true;
        const outcome = definitive ? "failed" : "unknown";
        const reconciled = await reconcileDelivery({ churchId, intentId, attemptId, update: {
          status: definitive ? "failed" : "pending", outcome,
          failureCode: String(error?.code || "provider_outcome_uncertain").slice(0, 80),
          failureMessage: safeProviderFailureMessage(error, "SMS provider outcome could not be confirmed."),
        } });
        if (reconciled.intent?.status === "sent") {
          const responseAttempt = publicAttempt(reconciled.attempt || {});
          if (scopedAccess) {
            delete responseAttempt.phoneNumberSnapshot;
            delete responseAttempt.providerMessageId;
          }
          return res.json({ success: true, intent: safeIntentProjection(reconciled.intent), attempt: responseAttempt });
        }
        return res.status(definitive ? 502 : 202).json({ success: false, outcome, errorMessage: definitive ? "The SMS provider rejected this message." : "The provider outcome is uncertain. Review delivery history before retrying." });
      }
      const providerMessageId = normalize(result?.providerMessageId);
      if (!providerMessageId) throw Object.assign(new Error("Provider accepted an SMS without returning its ID."), { code: "provider_outcome_uncertain" });
      const updatedAt = nowIso();
      confirmedResult = { providerMessageId, status: normalizeSmsDeliveryStatus(result.status), outcome: "confirmed" };
      const reconciled = await reconcileDelivery({ churchId, intentId, attemptId, update: confirmedResult });
      if (reconciled.ignored) throw httpError(409, "Provider evidence could not be associated with this send. Review delivery history.");
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
      const responseAttempt = publicAttempt(reconciled.attempt || {
        ...attempt,
        providerMessageId,
        status: normalizeSmsDeliveryStatus(result.status),
        outcome: "confirmed",
        updatedAt,
      });
      if (scopedAccess) {
        delete responseAttempt.phoneNumberSnapshot;
        delete responseAttempt.providerMessageId;
      }
      return res.json({ success: true, intent: safeIntentProjection(reconciled.intent || { ...intent, status: "sent", attemptId, providerMessageId, sentAt: updatedAt }), attempt: responseAttempt });
    } catch (error) {
      if (intent && attemptId) {
        await reconcileDelivery({ churchId: intent.churchId, intentId: intent.intentId, attemptId,
          update: confirmedResult || {
            status: providerCallStarted ? "pending" : "failed",
            outcome: providerCallStarted ? "unknown" : "not_sent",
            failureCode: String(error?.code || "dispatch_interrupted").slice(0, 80),
            failureMessage: safeErrorMessage(error, "The provider outcome could not be confirmed."),
          },
        }).catch(() => {});
      }
      const errorMessage = safeErrorMessage(error, "Could not send this message.");
      const scopedErrorMessage = scopedAccess && /consent|opted out|mobile number|phone number/i.test(errorMessage)
        ? "This volunteer is not currently eligible for SMS."
        : errorMessage;
      return res.status(error.statusCode || 500).json({ success: false, errorMessage: scopedErrorMessage, ...(error?.code === "AUTH_CSRF_MISMATCH" ? { code: error.code } : {}) });
    }
  };

  const sendApprovedScheduleIntent = async ({ batch, ownership, recipient }) => {
    const req = {
      params: { churchId: batch.churchId, intentId: recipient.intentId },
      body: { confirmed: true, approvalVersion: recipient.approvalVersion },
    };
    backgroundScheduleRequests.set(req, { batchId: batch.batchId, ownership });
    const response = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.payload = payload; return this; },
    };
    await sendIntent(req, response);
    return { ...(response.payload || {}), statusCode: response.statusCode };
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
      throw httpError(409, "This form request is already handled or has an uncertain provider outcome.");
    }
    if (!intent) {
      const message = buildTeamIntakeSms({
        churchName: context.church?.name,
        formName: context.form.name,
        publicUrl: context.publicUrl,
        intentType: "availability_request",
        collectsAvailability: intakeFormCollectsServiceAvailability(context.form.enabledFields, context.form.availabilityOccurrences),
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
        intent = await mutateIntent(churchId, intentId, (current) => current ? null : { intentId, ...intent });
      }
    }
    return { intent: { intentId, ...intent }, context };
  };

  const prepareTeamIntakeIntent = async (req, res) => {
    try {
      await assertCsrf(req);
      const churchId = normalize(req.params.churchId);
      const formId = normalize(req.params.formId);
      const recipientId = normalize(req.params.recipientId);
      const access = await authorizeForm(req, churchId, formId);
      if (access.form.purpose === "team_availability" && !(await isAvailabilityRecipientInFormScope({ churchId, formId, recipientId }))) {
        throw httpError(404, "Individual request not found.");
      }
      const admin = access.admin;
      const { intent, context } = await ensureTeamIntakeIntent({
        churchId, formId, recipientId, actorUid: admin.user.uid,
      });
      const reviewed = await prepareIntentReview(intent, {
        authorizationFingerprint: accessFingerprintFor(access),
      });
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
          message: access.scoped
            ? redactPersonalizedLinks(reviewed.validated.message)
            : reviewed.validated.message,
          approvalVersion: reviewed.approvalVersion,
          expiresAt: reviewed.intent.approvalSnapshot?.expiresAt || 0,
          eligible: reviewed.eligible,
          ...(access.scoped ? {} : { eligibilityStatus: reviewed.validated.eligibilityStatus }),
          phoneNumberSnapshot: access.scoped
            ? reviewed.validated.phoneNumber ? `••• ••• ${reviewed.validated.phoneNumber.slice(-4)}` : ""
            : reviewed.validated.phoneNumber || "",
          characterCount: measureSmsMessage(reviewed.validated.message).characterCount,
          segmentCount: measureSmsMessage(reviewed.validated.message).segmentCount,
          maskedPhoneNumber: reviewed.validated.phoneNumber ? `••• ••• ${reviewed.validated.phoneNumber.slice(-4)}` : "",
        },
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ success: false, errorMessage: safeErrorMessage(error, "Could not prepare this individual intake message."), ...(error?.code === "AUTH_CSRF_MISMATCH" ? { code: error.code } : {}) });
    }
  };

  const sendTeamIntakeIntent = async (req, res) => {
    try {
      await assertCsrf(req);
      const churchId = normalize(req.params.churchId);
      const formId = normalize(req.params.formId);
      const recipientId = normalize(req.params.recipientId);
      const access = await authorizeForm(req, churchId, formId);
      if (access.form.purpose === "team_availability" && !(await isAvailabilityRecipientInFormScope({ churchId, formId, recipientId }))) {
        throw httpError(404, "Individual request not found.");
      }
      const admin = access.admin;
      if (req.body?.confirmed !== true || !normalize(req.body?.approvalVersion)) {
        throw httpError(400, "Review and confirm this individual intake form SMS before sending.");
      }
      const { intent } = await ensureTeamIntakeIntent({
        churchId, formId, recipientId, actorUid: admin.user.uid,
      });
      const attemptResponse = {
        status(code) { res.status(code); return this; },
        json(payload) { return res.json({ ...payload, ...(payload.success ? { attempt: payload.attempt } : {}) }); },
      };
      return sendIntent({ ...req, params: { ...req.params, churchId, intentId: intent.intentId }, body: { confirmed: true, approvalVersion: req.body.approvalVersion } }, attemptResponse);
    } catch (error) {
      return res.status(error.statusCode || 500).json({ success: false, errorMessage: safeErrorMessage(error, "Could not send this individual intake message."), ...(error?.code === "AUTH_CSRF_MISMATCH" ? { code: error.code } : {}) });
    }
  };

  const prepareReplacementInvitation = async (req, res) => {
    try {
      await assertCsrf(req);
      const churchId = normalize(req.params.churchId);
      if (automaticSendsDisabled !== true) throw httpError(403, "Automatic notification sends are disabled by the server.");
      const scheduleId = normalize(req.body?.scheduleId);
      const occurrenceId = normalize(req.body?.occurrenceId);
      const cellKey = normalize(req.body?.cellKey);
      const memberId = normalize(req.body?.memberId);
      if (!scheduleId || !occurrenceId || !cellKey || !memberId) throw httpError(400, "Choose a schedule vacancy and replacement candidate.");
      const access = await authorizeScheduleSource(req, churchId, scheduleId, cellKey);
      const admin = access.admin;
      const context = await validateReplacementCandidate({ churchId, scheduleId, occurrenceId, cellKey, memberId });
      const schedule = context.schedule;
      const church = await getDoc(COLLECTIONS.churches, churchId);
      if (!schedule || !church) throw httpError(404, "Schedule not found.");
      const key = `replacement_request|${scheduleId}|${occurrenceId}|${cellKey}|${memberId}`;
      const intentId = intentIdFor(hashValue, churchId, key);
      const existing = await getDoc(COLLECTIONS.notificationIntents, intentId);
      if (existing?.replacementResolvedAt) throw httpError(409, "This replacement invitation was already resolved and cannot be resent.");
      if (existing) {
        const currentAccess = await authorizeIntent(req, churchId, existing);
        return res.json({ success: true, intent: reviewedIntentProjection(await prepareIntentReview({ intentId, ...existing }, { authorizationFingerprint: accessFingerprintFor(currentAccess) }), currentAccess) });
      }
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
        await mutateIntent(churchId, intentId, (current) => {
          createdIntent = !current;
          return current ? null : { intentId, ...intent, preparedByUid: admin.user.uid };
        });
      }
      await setDoc(COLLECTIONS.notificationBatches, vacancyClaimId, { status: "active", expiresAt: 0 }, { merge: true });
      const savedIntent = await getDoc(COLLECTIONS.notificationIntents, intentId) || { intentId, ...intent };
      const currentAccess = await authorizeIntent(req, churchId, savedIntent);
      const reviewed = await prepareIntentReview(savedIntent, { authorizationFingerprint: accessFingerprintFor(currentAccess) });
      return res.json({ success: true, intent: reviewedIntentProjection(reviewed, currentAccess) });
      } catch (error) {
        if (createdIntent) await deleteUnusedIntent(churchId, intentId).catch(() => {});
        if (acquiredVacancyClaim) {
          await setDoc(COLLECTIONS.notificationBatches, vacancyClaimId, { status: "released", releasedAt: nowIso(), expiresAt: 0 }, { merge: true }).catch(() => {});
        }
        throw error;
      }
    } catch (error) {
      return res.status(error.statusCode || 500).json({ success: false, errorMessage: safeErrorMessage(error, "Could not prepare this replacement invitation."), ...(error?.code === "AUTH_CSRF_MISMATCH" ? { code: error.code } : {}) });
    }
  };

  const resolveReplacementInvitation = async (req, res) => {
    try {
      await assertCsrf(req);
      const churchId = normalize(req.params.churchId);
      const intentId = normalize(req.params.intentId);
      const db = requireFirestore();
      const resolve = async (transaction = null) => {
        const intentRef = db?.collection(COLLECTIONS.notificationIntents).doc(intentId);
        const snapshot = transaction ? await transaction.get(intentRef) : null;
        const intent = transaction
          ? snapshot?.exists ? { intentId: snapshot.id, ...snapshot.data() } : null
          : await getDoc(COLLECTIONS.notificationIntents, intentId);
        if (!intent || intent.churchId !== churchId || intent.intentType !== "replacement_request") throw httpError(404, "Replacement invitation not found.");
        if (intent.sourceType !== "team_schedule") throw httpError(404, "Replacement invitation not found.");
        const scheduleSnapshot = transaction
          ? await transaction.get(db.collection(COLLECTIONS.teamSchedules).doc(intent.sourceId))
          : null;
        const records = transaction ? { schedule: scheduleSnapshot?.exists ? { scheduleId: scheduleSnapshot.id, ...scheduleSnapshot.data() } : null } : null;
        const { admin } = await authorizeScheduleSource(req, churchId, intent.sourceId, intent.cellKey, records);
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
      return res.status(error.statusCode || 500).json({ success: false, errorMessage: safeErrorMessage(error, "Could not close this replacement invitation."), ...(error?.code === "AUTH_CSRF_MISMATCH" ? { code: error.code } : {}) });
    }
  };

  const getBatchForChurch = async (batchId, churchId) => {
    const batch = await getDoc(COLLECTIONS.notificationBatches, batchId);
    if (!batch || batch.churchId !== churchId) throw httpError(404, "Message batch not found.");
    return batch;
  };

  const formatBatchDetail = async (batch, { exposeMessages = true, privacySafe = false } = {}) => {
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
    const inScopeRecipients = privacySafe
      ? (await Promise.all(recipients.map(async (recipient) =>
          await isAvailabilityRecipientInFormScope({
            churchId: batch.churchId,
            formId: batch.formId,
            recipientId: recipient.recipientId || recipient.id,
            memberId: recipient.memberId,
          }) ? recipient : null,
        ))).filter(Boolean)
      : recipients;
    const recipientById = new Map(inScopeRecipients.map((recipient) => [recipient.recipientId || recipient.id, recipient]));
    const selectedMemberIds = new Set(batch.selectedMemberIds || []);
    const intakeRecipients = inScopeRecipients
      .filter((recipient) => selectedMemberIds.has(recipient.memberId))
      .map((recipient) => {
        if (privacySafe) {
          return {
            recipientId: recipient.recipientId || recipient.id,
            churchId: batch.churchId,
            formId: batch.formId,
            memberId: recipient.memberId,
            createdAt: recipient.createdAt || "",
            respondedAt: recipient.respondedAt || null,
            revokedAt: recipient.revokedAt || null,
            linkCopiedAt: recipient.linkCopiedAt || null,
          };
        }
        const {
          recipientToken,
          recipientTokenNonce,
          recipientTokenHash,
          recipientTokenCiphertext,
          createdByUid,
          linkCopiedByUid,
          ...clientRecipient
        } = recipient;
        return {
          ...clientRecipient,
          ...(createdByUid ? { createdBy: createdByUid } : {}),
          ...(linkCopiedByUid ? { linkCopiedBy: linkCopiedByUid } : {}),
        };
      });
    const formatted = rows
      .filter((row) => !privacySafe || recipientById.get(row.recipientId)?.memberId === row.memberId)
      .map((row) => {
      const intent = intentById.get(row.intentId);
      const attempt = intent?.attemptId
        ? attempts.find((item) => (item.attemptId || item.id) === intent.attemptId)
        : intent ? attemptByIntentId.get(intent.intentId || intent.id) : null;
      const recipient = recipientById.get(row.recipientId);
      const snapshot = intent?.approvalSnapshot;
      const awaitingDispatch = Boolean(intent && ["preview", "ready"].includes(intent.status) && snapshot?.approvalVersion && Number(snapshot.expiresAt) > Date.now());
      const previewEligible = awaitingDispatch;
      const previewError = row.exclusionReason || (intent && !previewEligible && ["preview", "ready"].includes(intent.status)
        ? "This review expired. Prepare and confirm a fresh message preview."
        : "");
      const exclusionReason = privacySafe && /consent|opted out|mobile number|phone number/i.test(previewError)
        ? "Not eligible for SMS."
        : previewError;
      return {
        memberId: row.memberId,
        memberName: row.memberName || "Volunteer",
        recipientId: row.recipientId || "",
        maskedPhoneNumber: snapshot?.phoneLast4 ? `••• ••• ${snapshot.phoneLast4}` : row.maskedPhoneNumber || "",
        ...(!privacySafe ? { eligibilityStatus: row.eligibilityStatus || "" } : {}),
        eligible: Boolean(intent && previewEligible),
        exclusionReason,
        intentId: row.intentId || "",
        status: intent?.status || row.status || "excluded",
        attemptId: intent?.attemptId || "",
        attemptStatus: attempt?.status || "",
        attemptOutcome: attempt?.outcome || intent?.outcome || "",
        respondedAt: recipient?.respondedAt || "",
        segmentCount: snapshot?.segmentCount || row.segmentCount || 0,
        approvalVersion: snapshot?.approvalVersion || "",
        ...(!privacySafe ? { phoneNumberSnapshot: snapshot?.phoneNumberSnapshot || "" } : {}),
          ...(exposeMessages && intent?.approvalSnapshot
            ? { message: privacySafe ? redactPersonalizedLinks(intent.message) : intent.message }
            : {}),
      };
      });
    const selected = privacySafe ? formatted.length : (batch.selectedMemberIds || []).length;
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
      selectedMemberIds: privacySafe ? formatted.map((row) => row.memberId) : batch.selectedMemberIds || [],
      intentIds: privacySafe ? formatted.map((row) => row.intentId).filter(Boolean) : batch.intentIds || [],
      recipients: formatted,
      intakeRecipients,
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
        optedOut: privacySafe ? 0 : formatted.filter((row) => row.eligibilityStatus === "opted_out").length,
      },
    };
  };

  const scheduleInitialIntentIdFor = (churchId, scheduleId, memberId) =>
    intentIdFor(hashValue, churchId, scheduleInitialSmsIdempotencyKey(scheduleId, memberId));

  const scheduleInitialDeliveryState = (intent, attempt, acceptedAttempt) => {
    if (!intent) return "first_send";
    if (intent.providerAcceptedAttemptId || intent.status === "sent" || hasConfirmedSmsEvidence(attempt) || hasConfirmedSmsEvidence(acceptedAttempt)) return "accepted";
    if (intent.status === "sending" || intent.status === "unknown" || intent.outcome === "unknown" ||
        attempt?.outcome === "unknown" || acceptedAttempt?.outcome === "unknown" || attempt?.status === "pending") return "uncertain";
    if (intent.status === "suppressed") return "handled";
    if (intent.status === "failed" && ["failed", "not_sent"].includes(intent.outcome || attempt?.outcome)) return "failed";
    if (["preview", "ready"].includes(intent.status)) return "first_send";
    return "uncertain";
  };

  const scheduleInitialBatchDetail = async (batch, { privacySafe = false } = {}) => {
    const [intents, attempts] = await Promise.all([
      queryDocs(COLLECTIONS.notificationIntents, [
        { field: "churchId", value: batch.churchId },
        { field: "batchId", value: batch.batchId },
      ], { limit: 1000 }),
      queryDocs(COLLECTIONS.smsDeliveryAttempts, [
        { field: "churchId", value: batch.churchId },
        { field: "batchId", value: batch.batchId },
      ], { limit: 2000 }),
    ]);
    const intentById = new Map(intents.map((intent) => [intent.intentId || intent.id, intent]));
    const attemptById = new Map(attempts.map((attempt) => [attempt.attemptId || attempt.id, attempt]));
    const recipients = (batch.recipients || []).map((row) => {
      const intent = intentById.get(row.intentId);
      const attempt = intent?.attemptId ? attemptById.get(intent.attemptId) : null;
      const snapshot = intent?.approvalSnapshot;
      const approvedRecipient = (batch.approval?.recipients || []).find((item) => item.intentId === row.intentId);
      const { message: storedMessage, ...safeRow } = row;
      delete safeRow.phoneNumberSnapshot;
      const activeApproval = ["approved", "dispatching"].includes(batch.status) &&
        approvedRecipient?.approvalVersion === snapshot?.approvalVersion;
      const message = activeApproval
        ? approvedRecipient.message
        : intent?.approvalSnapshot ? intent.message : storedMessage;
      const awaitingDispatch = Boolean(intent && ["preview", "ready"].includes(intent.status) && snapshot?.approvalVersion &&
        (activeApproval || Number(snapshot.expiresAt) > Date.now()));
      const stale = Boolean(row.sourceStale || (snapshot && row.sourceFingerprint && snapshot.sourceFingerprint !== row.sourceFingerprint));
      const previewError = row.exclusionReason || (stale
        ? "Assignments changed after this review. Review the current schedule again."
        : intent && !awaitingDispatch && ["preview", "ready"].includes(intent.status)
          ? snapshot?.approvalVersion ? "This review expired. Review the current schedule again." : "This message changed after approval. Review the current schedule again."
          : "");
      return {
        ...safeRow,
        eligible: Boolean(awaitingDispatch && !stale),
        eligibilityStatus: privacySafe && row.eligibilityStatus === "opted_out" ? "" : row.eligibilityStatus || "",
        exclusionReason: privacySafe && /opted out/i.test(previewError)
          ? "Not eligible for SMS."
          : previewError,
        status: intent?.status || row.status || "excluded",
        attemptId: intent?.attemptId || "",
        attemptStatus: attempt?.status || "",
        attemptOutcome: attempt?.outcome || intent?.outcome || "",
        segmentCount: snapshot?.segmentCount || row.segmentCount || 0,
        approvalVersion: snapshot?.approvalVersion || "",
        maskedPhoneNumber: snapshot?.phoneLast4 ? `••• ••• ${snapshot.phoneLast4}` : row.maskedPhoneNumber || "",
        ...(!privacySafe ? { phoneNumberSnapshot: snapshot?.phoneNumberSnapshot || "" } : {}),
        ...(message !== undefined ? { message: privacySafe ? redactPersonalizedLinks(message) : message } : {}),
      };
    });
    const selected = (batch.selectedMemberIds || []).length;
    const accepted = recipients.filter((row) => row.status === "sent" || ["accepted", "sent", "delivered", "undelivered"].includes(row.attemptStatus) || row.attemptOutcome === "confirmed").length;
    const failed = recipients.filter((row) => row.status === "failed").length;
    const uncertain = recipients.filter((row) => row.status === "unknown" || row.attemptOutcome === "unknown").length;
    const sending = recipients.filter((row) => row.status === "sending").length;
    const awaiting = recipients.filter((row) => row.eligible && ["preview", "ready"].includes(row.status)).length;
    const delivered = recipients.filter((row) => row.attemptStatus === "delivered").length;
    return {
      batchId: batch.batchId,
      churchId: batch.churchId,
      scheduleId: batch.scheduleId,
      intentType: "schedule_initial_notification",
      status: batch.status,
      selectedMemberIds: batch.selectedMemberIds || [],
      intentIds: batch.intentIds || [],
      recipients,
      privacySafe: Boolean(privacySafe),
      approvalVersion: batch.reviewVersion || "",
      createdAt: batch.createdAt,
      updatedAt: batch.updatedAt,
      summary: {
        requested: selected,
        selected,
        eligible: awaiting,
        awaitingDispatch: awaiting,
        awaitingExecution: ["approved", "dispatching"].includes(batch.status) ? awaiting : 0,
        sending,
        alreadySent: accepted,
        excluded: Math.max(0, recipients.length - awaiting - sending - accepted - failed - uncertain),
        totalSegments: awaiting ? recipients.filter((row) => row.eligible).reduce((sum, row) => sum + Number(row.segmentCount || 0), 0) : 0,
        sent: accepted,
        delivered,
        failed,
        uncertain,
        optedOut: privacySafe ? 0 : recipients.filter((row) => row.eligibilityStatus === "opted_out").length,
      },
    };
  };

  const getScheduleInitialSmsRecipients = async (req, res) => {
    try {
      const churchId = normalize(req.params.churchId);
      const scheduleId = normalize(req.params.scheduleId);
      const access = await authorizeScheduleSource(req, churchId, scheduleId);
      const schedule = access.schedule;
      if (schedule.archivedAt) throw httpError(404, "Schedule not found.");
      const batchId = scheduleInitialBatchIdFor(hashValue, churchId, scheduleId);
      const [baseRows, existingBatch] = await Promise.all([
        prepareScheduleInitialSmsRecipients({ churchId, schedule }),
        getDoc(COLLECTIONS.notificationBatches, batchId),
      ]);
      if (existingBatch && (existingBatch.churchId !== churchId || existingBatch.scheduleId !== scheduleId || existingBatch.intentType !== "schedule_initial_notification")) {
        throw httpError(404, "Message batch not found.");
      }
      const recipients = await mapWithConcurrency(baseRows, 8, async (row) => {
        const intentId = scheduleInitialIntentIdFor(churchId, scheduleId, row.memberId);
        const intent = await getDoc(COLLECTIONS.notificationIntents, intentId);
        if (intent && (intent.churchId !== churchId || intent.sourceType !== "team_schedule" || intent.sourceId !== scheduleId || intent.memberId !== row.memberId || intent.idempotencyKey !== scheduleInitialSmsIdempotencyKey(scheduleId, row.memberId))) {
          throw httpError(404, "Message history is unavailable.");
        }
        const attempt = intent?.attemptId ? await getDoc(COLLECTIONS.smsDeliveryAttempts, intent.attemptId) : null;
        const acceptedAttempt = intent?.providerAcceptedAttemptId
          ? await getDoc(COLLECTIONS.smsDeliveryAttempts, intent.providerAcceptedAttemptId)
          : null;
        const deliveryState = scheduleInitialDeliveryState(intent, attempt, acceptedAttempt);
        const exclusionReason = deliveryState === "accepted"
          ? "Already sent for this schedule."
          : deliveryState === "uncertain"
            ? "A previous send is active or its provider outcome is uncertain."
            : deliveryState === "handled"
              ? "This schedule message was already handled."
              : row.exclusionReason;
        const safeExclusionReason = access.scoped && /opted out/i.test(exclusionReason || "")
          ? "Not eligible for SMS."
          : exclusionReason || "";
        return {
          memberId: row.memberId,
          memberName: row.memberName,
          assignments: row.assignments,
          exclusionKind: row.exclusionKind || "",
          eligibilityStatus: access.scoped && row.eligibilityStatus === "opted_out" ? "" : row.eligibilityStatus || "",
          eligible: Boolean(row.eligible && ["first_send", "failed"].includes(deliveryState)),
          exclusionReason: safeExclusionReason,
          previousDeliveryStatus: deliveryState,
          status: intent?.status || (row.eligible ? "preview" : "excluded"),
          intentId: intent && deliveryState !== "accepted" && deliveryState !== "uncertain" ? intentId : "",
          segmentCount: intent?.approvalSnapshot?.segmentCount || 0,
          ...(access.scoped ? {} : { phoneNumberSnapshot: row.phoneNumber || "" }),
          maskedPhoneNumber: row.phoneNumber ? `••• ••• ${row.phoneNumber.slice(-4)}` : "",
        };
      });
      const selectedMemberIds = new Set(existingBatch?.selectedMemberIds || []);
      const currentBatch = existingBatch?.approval &&
        ["approved", "dispatching", "complete", "partial", "paused"].includes(existingBatch.status)
        ? await scheduleInitialBatchDetail(existingBatch, { privacySafe: access.scoped })
        : null;
      return res.json({
        success: true,
        historyComplete: true,
          dispatchEnabled: isScheduleBulkDispatchReady(),
          dispatchReadinessMessage: isScheduleBulkDispatchReady()
            ? ""
            : scheduleSmsDispatchConfig.readinessMessage || "Bulk schedule SMS requires Firestore and explicit server-side readiness configuration.",
        privacySafe: Boolean(access.scoped),
        hasPreparedSelection: Boolean(existingBatch),
        scheduleId,
        published: schedule.published !== false,
        batchId,
        currentBatch,
        recentBatches: (existingBatch?.approvalHistory || []).map((entry) => ({
          reviewVersion: entry.reviewVersion || "",
          approvedAt: entry.approvedAt || "",
          status: entry.status || "partial",
          selected: Number(entry.selected || entry.recipientCount || 0),
          summary: {
            accepted: Number(entry.summary?.accepted || 0),
            delivered: Number(entry.summary?.delivered || 0),
            failed: Number(entry.summary?.failed || 0),
            uncertain: Number(entry.summary?.uncertain || 0),
            awaiting: Number(entry.summary?.awaiting || 0),
            excluded: Number(entry.summary?.excluded || 0),
          },
        })),
        selectedMemberIds: recipients.filter((row) => row.eligible && selectedMemberIds.has(row.memberId)).map((row) => row.memberId),
        recipients,
        summary: {
          assigned: recipients.filter((row) => row.exclusionKind !== "guest").length,
          total: recipients.length,
          eligible: recipients.filter((row) => row.eligible).length,
          alreadySent: recipients.filter((row) => row.previousDeliveryStatus === "accepted").length,
          failed: recipients.filter((row) => row.previousDeliveryStatus === "failed").length,
          uncertain: recipients.filter((row) => row.previousDeliveryStatus === "uncertain").length,
          ineligible: recipients.filter((row) => !row.eligible && !["accepted", "uncertain"].includes(row.previousDeliveryStatus) && !row.exclusionKind).length,
          missingConsent: recipients.filter((row) => !row.exclusionKind && row.eligibilityStatus === "consent_needed").length,
          optedOut: access.scoped ? 0 : recipients.filter((row) => !row.exclusionKind && row.eligibilityStatus === "opted_out").length,
          missingPhone: recipients.filter((row) => !row.exclusionKind && row.eligibilityStatus === "no_mobile").length,
        },
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ success: false, errorMessage: safeErrorMessage(error, "Could not load schedule SMS recipients."), ...(error?.code === "AUTH_CSRF_MISMATCH" ? { code: error.code } : {}) });
    }
  };

  const reserveScheduleInitialBatch = async ({ churchId, scheduleId, batchId, actorUid, selectedMemberIds }) => {
    const db = requireFirestore();
    const createNext = (existing, schedule) => {
      if (!schedule || schedule.churchId !== churchId || schedule.archivedAt) throw httpError(404, "Schedule not found.");
      if (schedule.published === false) throw httpError(409, "Publish this schedule before reviewing SMS recipients.");
      if (existing && (existing.churchId !== churchId || existing.scheduleId !== scheduleId || existing.intentType !== "schedule_initial_notification")) {
        throw httpError(409, "This message batch belongs to a different schedule.");
      }
      if (["approved", "dispatching"].includes(existing?.status)) {
        throw httpError(409, "An approved schedule batch is already active. Open its progress before preparing another review.");
      }
      const now = nowIso();
      const approvalHistory = existing?.approval
        ? [...(existing.approvalHistory || []), (() => {
            const recipients = existing.recipients || [];
            const accepted = recipients.filter((row) => row.status === "sent" ||
              ["accepted", "sent", "delivered", "undelivered"].includes(row.attemptStatus) || row.attemptOutcome === "confirmed").length;
            const delivered = recipients.filter((row) => row.attemptStatus === "delivered").length;
            const failed = recipients.filter((row) => row.status === "failed").length;
            const uncertain = recipients.filter((row) => row.status === "unknown" || row.attemptOutcome === "unknown").length;
            const awaiting = recipients.filter((row) => ["preview", "ready", "sending"].includes(row.status)).length;
            const selected = Number(existing.selectedMemberIds?.length || existing.approval.recipients?.length || 0);
            return {
              reviewVersion: existing.approval.reviewVersion,
              approvedAt: existing.approval.approvedAt,
              status: existing.status,
              selected,
              summary: {
                accepted, delivered, failed, uncertain, awaiting,
                excluded: Math.max(0, selected - accepted - failed - uncertain - awaiting),
              },
            };
          })()].slice(-10)
        : existing?.approvalHistory || [];
      const next = {
        ...(existing || {}),
        batchId,
        churchId,
        scheduleId,
        sourceType: "team_schedule",
        intentType: "schedule_initial_notification",
        event: "initial",
        status: "preparing",
        selectedMemberIds,
        recipients: [],
        intentIds: [],
        reviewGeneration: Number(existing?.reviewGeneration || 0) + 1,
        approvalHistory,
        createdAt: existing?.createdAt || now,
        createdByUid: existing?.createdByUid || actorUid,
        updatedAt: now,
      };
      delete next.approval;
      delete next.approvedByUid;
      delete next.approvedAt;
      delete next.approvedReviewVersion;
      delete next.dispatchOwnerToken;
      delete next.dispatchLeaseExpiresAt;
      delete next.dispatchHeartbeatAt;
      return next;
    };
    if (db) {
      return db.runTransaction(async (transaction) => {
        const batchRef = db.collection(COLLECTIONS.notificationBatches).doc(batchId);
        const scheduleRef = db.collection(COLLECTIONS.teamSchedules).doc(scheduleId);
        const [batchSnapshot, scheduleSnapshot] = await Promise.all([
          transaction.get(batchRef), transaction.get(scheduleRef),
        ]);
        const existing = batchSnapshot.exists ? { batchId: batchSnapshot.id, ...batchSnapshot.data() } : null;
        const schedule = scheduleSnapshot.exists ? { scheduleId: scheduleSnapshot.id, ...scheduleSnapshot.data() } : null;
        const next = createNext(existing, schedule);
        transaction.set(batchRef, next, { merge: false });
        return next;
      });
    }
    return runMemoryClaim(batchId, async () => {
      const [existing, schedule] = await Promise.all([
        getDoc(COLLECTIONS.notificationBatches, batchId), getDoc(COLLECTIONS.teamSchedules, scheduleId),
      ]);
      const next = createNext(existing, schedule);
      await setDoc(COLLECTIONS.notificationBatches, batchId, next, { merge: false });
      return next;
    });
  };

  const prepareScheduleInitialSmsBatch = async (req, res) => {
    try {
      await assertCsrf(req);
      const churchId = normalize(req.params.churchId);
      const scheduleId = normalize(req.params.scheduleId);
      if (automaticSendsDisabled !== true) throw httpError(403, "Notification sends are disabled by the server.");
      const selectedMemberIds = [...new Set((Array.isArray(req.body?.memberIds) ? req.body.memberIds : []).map(normalize).filter(Boolean))];
      if (!selectedMemberIds.length) throw httpError(400, "Choose at least one eligible volunteer.");
      if (selectedMemberIds.length > 500) throw httpError(400, "Review at most 500 volunteers at a time.");
      const access = await authorizeScheduleSource(req, churchId, scheduleId);
      const schedule = access.schedule;
      if (schedule.archivedAt) throw httpError(404, "Schedule not found.");
      if (schedule.published === false) throw httpError(409, "Publish this schedule before reviewing SMS recipients.");
      const actorUid = access.admin?.user?.uid || "";
      const authorizationFingerprint = accessFingerprintFor({ ...access, schedule });
      const baseRows = await prepareScheduleInitialSmsRecipients({ churchId, schedule });
      const baseByMemberId = new Map(baseRows.map((row) => [row.memberId, row]));
      if (selectedMemberIds.some((memberId) => !baseByMemberId.has(memberId))) {
        throw httpError(409, "A selected volunteer is no longer assigned to this schedule. Refresh the recipient list.");
      }
      const batchId = scheduleInitialBatchIdFor(hashValue, churchId, scheduleId);
      const batch = await reserveScheduleInitialBatch({ churchId, scheduleId, batchId, actorUid, selectedMemberIds });
      const recipients = await mapWithConcurrency(selectedMemberIds, 8, async (memberId) => {
        const row = baseByMemberId.get(memberId);
        const intentId = scheduleInitialIntentIdFor(churchId, scheduleId, memberId);
        const current = await getDoc(COLLECTIONS.notificationIntents, intentId);
        const attempt = current?.attemptId ? await getDoc(COLLECTIONS.smsDeliveryAttempts, current.attemptId) : null;
        const acceptedAttempt = current?.providerAcceptedAttemptId
          ? await getDoc(COLLECTIONS.smsDeliveryAttempts, current.providerAcceptedAttemptId)
          : null;
        const deliveryState = scheduleInitialDeliveryState(current, attempt, acceptedAttempt);
        const blockedReason = deliveryState === "accepted"
          ? "Already sent for this schedule."
          : deliveryState === "uncertain"
            ? "A previous send is active or its provider outcome is uncertain."
            : deliveryState === "handled"
              ? "This schedule message was already handled."
              : "";
        const batchRow = {
          memberId,
          memberName: row.memberName,
          assignments: row.assignments,
          exclusionKind: row.exclusionKind || "",
          eligibilityStatus: row.eligibilityStatus || "",
          status: "excluded",
          eligible: false,
          exclusionReason: blockedReason || row.exclusionReason || "",
          intentId: "",
          segmentCount: 0,
          maskedPhoneNumber: row.phoneNumber ? `••• ••• ${row.phoneNumber.slice(-4)}` : "",
          ...(!access.scoped ? { phoneNumberSnapshot: row.phoneNumber || "" } : {}),
        };
        if (!row.eligible || !["first_send", "failed"].includes(deliveryState)) {
          return batchRow;
        }
        let intent;
        if (current) {
          if (current.churchId !== churchId || current.sourceType !== "team_schedule" || current.sourceId !== scheduleId || current.memberId !== memberId || current.idempotencyKey !== scheduleInitialSmsIdempotencyKey(scheduleId, memberId)) {
            throw httpError(409, "The saved schedule message identity is inconsistent. Review message history before retrying.");
          }
          const adopted = await mutateIntent(churchId, intentId, (latest, latestAttempt) => {
            if (!latest || latest.churchId !== churchId || latest.sourceId !== scheduleId || latest.memberId !== memberId ||
                !["preview", "ready", "failed"].includes(latest.status) || latest.providerAcceptedAttemptId ||
                hasConfirmedSmsEvidence(latestAttempt) || latestAttempt?.outcome === "unknown") return null;
            return {
              batchId,
              status: latest.status === "failed" ? "ready" : latest.status,
              approvalSnapshot: null,
              updatedAt: nowIso(),
            };
          });
          if (adopted?.batchId !== batchId || !["preview", "ready"].includes(adopted.status)) {
            batchRow.exclusionReason = "The prior message changed while it was being reviewed. Refresh and try again.";
            return batchRow;
          }
          intent = adopted;
        } else {
          const key = scheduleInitialSmsIdempotencyKey(scheduleId, memberId);
          const context = await resolveScheduleNotificationContext({ churchId, sourceType: "team_schedule", sourceId: scheduleId, memberId, intentType: "schedule_initial_notification" }) || {};
          const draft = createNotificationIntent({
            churchId,
            intentType: "schedule_initial_notification",
            sourceType: "team_schedule",
            sourceId: scheduleId,
            memberId,
            batchId,
            idempotencyKey: key,
            message: buildScheduleInitialSmsMessage({ churchName: context.church?.name, assignments: context.assignments, responseUrl: context.responseUrl, timeZone: context.serviceTimeZone }),
            now: nowIso(),
          });
          const saved = await mutateIntent(churchId, intentId, (latest) => latest ? null : { intentId, ...draft });
          if (!saved || saved.intentId !== intentId || saved.idempotencyKey !== key) throw httpError(409, "The schedule message changed while it was being prepared. Review the recipients again.");
          intent = saved;
        }
        const reviewed = await prepareIntentReview(intent, { authorizationFingerprint });
        batchRow.intentId = reviewed.eligible ? intentId : "";
        batchRow.status = reviewed.eligible ? reviewed.intent.status : "excluded";
        batchRow.eligible = reviewed.eligible;
        batchRow.exclusionReason = reviewed.eligible
          ? ""
          : {
              no_mobile: "No valid mobile number.",
              consent_needed: "SMS consent is needed for this phone number.",
              opted_out: "This phone number opted out of SMS.",
            }[reviewed.validated.eligibilityStatus] || "This volunteer is not currently eligible for SMS.";
        batchRow.segmentCount = measureSmsMessage(reviewed.validated.message).segmentCount;
        batchRow.approvalVersion = reviewed.approvalVersion;
        batchRow.sourceFingerprint = reviewed.validated.sourceFingerprint;
        batchRow.message = access.scoped ? redactPersonalizedLinks(reviewed.validated.message) : reviewed.validated.message;
        return batchRow;
      });
      const intentIds = recipients.filter((row) => row.eligible && row.intentId).map((row) => row.intentId);
      const latestAccess = await authorizeScheduleSource(req, churchId, scheduleId);
      if (accessFingerprintFor({ ...latestAccess, schedule: latestAccess.schedule }) !== authorizationFingerprint) {
        throw httpError(409, "Team permissions changed while messages were being prepared. Review the messages again.");
      }
      await mapWithConcurrency(intentIds, 8, async (intentId) => {
        const intent = await getDoc(COLLECTIONS.notificationIntents, intentId);
        if (!intent?.approvalSnapshot?.approvalVersion) throw httpError(409, "A message preview changed during preparation. Review the messages again.");
        const validated = await validateIntent(intent, { requireConsent: false, responseUrlOverride: intent.approvalSnapshot.responseUrl || "" });
        validated.availabilityAccessFingerprint = authorizationFingerprint;
        if (!reviewStillMatches(intent, validated, intent.approvalSnapshot.approvalVersion, authorizationFingerprint)) {
          throw httpError(409, "Assignments, consent, or the message changed during preparation. Review the messages again.");
        }
      });
      const prepared = {
        ...batch,
        status: "prepared",
        selectedMemberIds,
        recipients,
        intentIds,
        reviewVersion: notificationBatchReviewVersion(hashValue, { batchId, selectedMemberIds, recipients }),
        preparedAt: nowIso(),
        updatedAt: nowIso(),
      };
      const db = requireFirestore();
      if (db) {
        await db.runTransaction(async (transaction) => {
          const ref = db.collection(COLLECTIONS.notificationBatches).doc(batchId);
          const [latestSnapshot, scheduleSnapshot] = await Promise.all([
            transaction.get(ref), transaction.get(db.collection(COLLECTIONS.teamSchedules).doc(scheduleId)),
          ]);
          const latest = latestSnapshot.exists ? latestSnapshot.data() : null;
          const currentSchedule = scheduleSnapshot.exists ? scheduleSnapshot.data() : null;
          if (!latest || latest.churchId !== churchId || latest.reviewGeneration !== batch.reviewGeneration || latest.status !== "preparing") {
            throw httpError(409, "Another review replaced this schedule batch. Review the current messages.");
          }
          if (!currentSchedule || currentSchedule.churchId !== churchId || currentSchedule.archivedAt || currentSchedule.published === false) {
            throw httpError(409, "This schedule is no longer published and available for SMS review.");
          }
          transaction.set(ref, prepared, { merge: false });
        });
      } else {
        await runMemoryClaim(batchId, async () => {
          const latest = await getDoc(COLLECTIONS.notificationBatches, batchId);
          const currentSchedule = await getDoc(COLLECTIONS.teamSchedules, scheduleId);
          if (!latest || latest.churchId !== churchId || latest.reviewGeneration !== batch.reviewGeneration || latest.status !== "preparing") {
            throw httpError(409, "Another review replaced this schedule batch. Review the current messages.");
          }
          if (!currentSchedule || currentSchedule.churchId !== churchId || currentSchedule.archivedAt || currentSchedule.published === false) {
            throw httpError(409, "This schedule is no longer published and available for SMS review.");
          }
          await setDoc(COLLECTIONS.notificationBatches, batchId, prepared, { merge: false });
        });
      }
      return res.json({ success: true, privacySafe: Boolean(access.scoped), batch: await scheduleInitialBatchDetail(prepared, { privacySafe: access.scoped }) });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ success: false, errorMessage: safeErrorMessage(error, "Could not prepare schedule SMS."), ...(error?.code === "AUTH_CSRF_MISMATCH" ? { code: error.code } : {}) });
    }
  };

  const approvedRecipientSnapshot = (row, intent) => ({
    memberId: row.memberId,
    memberName: row.memberName,
    assignments: row.assignments || [],
    intentId: row.intentId || "",
    status: intent ? "preview" : "excluded",
    eligible: Boolean(intent),
    exclusionReason: intent ? "" : row.exclusionReason || "Not eligible for SMS.",
    approvalVersion: intent?.approvalSnapshot?.approvalVersion || "",
    sourceFingerprint: intent?.approvalSnapshot?.sourceFingerprint || "",
    segmentCount: Number(intent?.approvalSnapshot?.segmentCount || row.segmentCount || 0),
    maskedPhoneNumber: row.maskedPhoneNumber || "",
    ...(intent ? { message: intent.message } : {}),
    ...(intent?.approvalSnapshot?.phoneNumberSnapshot
      ? { phoneNumberSnapshot: intent.approvalSnapshot.phoneNumberSnapshot }
      : {}),
  });

  const readAndValidateScheduleApprovalRecipients = async (batch, authorizationFingerprint) => {
    const rows = await mapWithConcurrency(batch.recipients || [], 8, async (row) => {
      if (!row.intentId) return approvedRecipientSnapshot(row, null);
      const intent = await getDoc(COLLECTIONS.notificationIntents, row.intentId);
      if (!intent || intent.churchId !== batch.churchId || intent.batchId !== batch.batchId ||
          intent.sourceType !== "team_schedule" || intent.sourceId !== batch.scheduleId ||
          intent.memberId !== row.memberId || !["preview", "ready"].includes(intent.status) ||
          row.approvalVersion !== intent.approvalSnapshot?.approvalVersion ||
          Number(intent.approvalSnapshot?.expiresAt || 0) <= Date.now()) {
        throw httpError(409, "A reviewed message changed or expired. Review the current schedule messages again.");
      }
      const validated = await validateIntent(intent, {
        requireConsent: false,
        responseUrlOverride: intent.approvalSnapshot?.responseUrl || "",
      });
      validated.availabilityAccessFingerprint = authorizationFingerprint;
      if (!reviewStillMatches(intent, validated, row.approvalVersion, authorizationFingerprint)) {
        throw httpError(409, "Assignments, consent, or permissions changed. Review the current schedule messages again.");
      }
      return approvedRecipientSnapshot(row, intent);
    });
    if (rows.some((row) => row.intentId && !row.approvalVersion)) {
      throw httpError(409, "A selected message is no longer available for approval.");
    }
    return rows;
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
        if (!hasPersonalizedIntakeResponseFields(form.enabledFields, form.availabilityOccurrences)) {
          throw httpError(409, "This intake form has no response fields for an existing volunteer.");
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
      if (!hasPersonalizedIntakeResponseFields(form.enabledFields, form.availabilityOccurrences)) throw httpError(409, "This intake form has no response fields for an existing volunteer.");
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
      if (automaticSendsDisabled !== true) throw httpError(403, "Automatic notification sends are disabled by the server.");
      const intentType = normalize(req.body?.intentType);
      if (!["availability_request", "availability_reminder"].includes(intentType)) throw httpError(400, "Choose a form request or reminder.");
      const formId = normalize(req.body?.formId);
      const memberIds = [...new Set((Array.isArray(req.body?.memberIds) ? req.body.memberIds : []).map(normalize).filter(Boolean))].slice(0, 500);
      const requestKey = normalize(req.body?.requestKey).slice(0, 120);
      if (!formId || !requestKey || !memberIds.length) throw httpError(400, "Choose a form, at least one volunteer, and a batch request key.");
      const access = await authorizeForm(req, churchId, formId);
      const admin = access.admin;
      const authorizationFingerprint = accessFingerprintFor(access);
      const batchId = hashValue(`${churchId}|notification-batch|${requestKey}`);
      let batch = await reserveAvailabilityBatch({ churchId, formId, intentType, batchId, actorUid: admin.user.uid, selectedMemberIds: memberIds });
      if (batch.status !== "preparing") return res.json({ success: true, batch: await formatBatchDetail(batch, { privacySafe: access.scoped }) });
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
            const reviewed = await prepareIntentReview({ intentId: id, ...existing }, { authorizationFingerprint });
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
            const moved = await mutateIntent(churchId, id, (current, attempt) => {
              if (!current || current.churchId !== churchId || current.batchId !== existing.batchId ||
                  !["preview", "ready", "failed"].includes(current.status) || current.providerAcceptedAttemptId || hasConfirmedSmsEvidence(attempt) || attempt?.outcome === "unknown") return null;
              return { batchId, status: current.status === "failed" ? "ready" : current.status, approvalSnapshot: null, updatedAt: nowIso() };
            });
            if (moved?.batchId !== batchId) {
              row.status = moved?.status || "excluded";
              row.exclusionReason = "A previous send is already handled or unresolved.";
              rows.push(row);
              continue;
            }
            const reviewed = await prepareIntentReview(moved, { authorizationFingerprint });
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
              formName: prepared.form.name,
              publicUrl: result.publicUrl,
              intentType,
              collectsAvailability: intakeFormCollectsServiceAvailability(prepared.form.enabledFields, prepared.form.availabilityOccurrences),
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
              await mutateIntent(churchId, id, (current) => current ? null : { intentId: id, ...intent });
            }
            const savedIntent = await getDoc(COLLECTIONS.notificationIntents, id) || { intentId: id, ...intent };
            const reviewed = await prepareIntentReview(savedIntent, { authorizationFingerprint });
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
        reviewVersion: notificationBatchReviewVersion(hashValue, { batchId, selectedMemberIds: memberIds, recipients: rows }),
        preparedAt: nowIso(), updatedAt: nowIso(),
      };
      const latestAccess = await authorizeForm(req, churchId, formId);
      if (accessFingerprintFor(latestAccess) !== authorizationFingerprint) {
        throw httpError(409, "Team permissions changed while messages were being prepared. Review the messages again.");
      }
      await setDoc(COLLECTIONS.notificationBatches, batchId, batch, { merge: true });
      return res.json({ success: true, batch: await formatBatchDetail(batch, { privacySafe: access.scoped }) });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ success: false, errorMessage: safeErrorMessage(error, "Could not prepare this message batch."), ...(error?.code === "AUTH_CSRF_MISMATCH" ? { code: error.code } : {}) });
    }
  };

  const getAvailabilityBatch = async (req, res) => {
    try {
      const churchId = normalize(req.params.churchId);
      const batch = await getBatchForChurch(normalize(req.params.batchId), churchId);
      if (batch.intentType === "schedule_initial_notification" && batch.scheduleId) {
        const access = await authorizeScheduleSource(req, churchId, batch.scheduleId);
        if (batch.sourceType !== "team_schedule" || batch.event !== "initial") throw httpError(404, "Message batch not found.");
        const authorizationFingerprint = accessFingerprintFor({ ...access, schedule: access.schedule });
        const currentBatch = { ...batch, recipients: await Promise.all((batch.recipients || []).map(async (row) => {
          if (!row.intentId || !row.approvalVersion) return row;
          const intent = await getDoc(COLLECTIONS.notificationIntents, row.intentId);
          if (!intent || intent.churchId !== churchId || intent.batchId !== batch.batchId) {
            return { ...row, sourceStale: true, exclusionReason: "This message is no longer available. Review the current schedule again." };
          }
          try {
            const validated = await validateIntent(intent, { requireConsent: false, responseUrlOverride: intent.approvalSnapshot?.responseUrl || "" });
            validated.availabilityAccessFingerprint = authorizationFingerprint;
            if (!reviewStillMatches(intent, validated, row.approvalVersion, authorizationFingerprint, {
              allowExpired: Boolean(batch.approval?.reviewVersion === batch.reviewVersion && ["approved", "dispatching"].includes(batch.status)),
            })) {
              return { ...row, sourceStale: true, exclusionReason: "Assignments, consent, or permissions changed. Review the current schedule again." };
            }
          } catch {
            return { ...row, sourceStale: true, exclusionReason: "Assignments, consent, or permissions changed. Review the current schedule again." };
          }
          return row;
        })) };
        return res.json({ success: true, privacySafe: Boolean(access.scoped), batch: await scheduleInitialBatchDetail(currentBatch, { privacySafe: access.scoped }) });
      }
      if (!batch.formId) throw httpError(404, "Message batch not found.");
      const access = await authorizeForm(req, churchId, batch.formId);
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
      return res.json({ success: true, batch: await formatBatchDetail(current, { privacySafe: access.scoped }) });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ success: false, errorMessage: safeErrorMessage(error, "Could not load this message batch."), ...(error?.code === "AUTH_CSRF_MISMATCH" ? { code: error.code } : {}) });
    }
  };

  const dispatchAvailabilityBatch = async (req, res) => {
    try {
      await assertCsrf(req);
      const churchId = normalize(req.params.churchId);
      const batchId = normalize(req.params.batchId);
      const existingBatch = await getBatchForChurch(batchId, churchId);
      if (existingBatch.intentType === "schedule_initial_notification" && existingBatch.scheduleId) {
        const access = await authorizeScheduleSource(req, churchId, existingBatch.scheduleId);
        if (existingBatch.sourceType !== "team_schedule" || existingBatch.event !== "initial") throw httpError(404, "Message batch not found.");
        if (access.schedule.published === false) throw httpError(409, "Publish this schedule before sending it.");
        if (existingBatch.status === "paused") {
          throw httpError(409, "This batch paused after management access changed. Review the remaining messages again and approve the new review to resume.");
        }
        const approvalAlreadyRecorded = existingBatch.approval?.reviewVersion === existingBatch.reviewVersion &&
          ["approved", "dispatching", "complete", "partial"].includes(existingBatch.status);
        if (req.body?.confirmed !== true || normalize(req.body?.approvalVersion) !== existingBatch.reviewVersion) {
          throw httpError(409, "This schedule review changed. Review the current messages again.");
        }
        if (!isScheduleBulkDispatchReady()) {
          throw httpError(503, scheduleSmsDispatchConfig.readinessMessage || "Bulk schedule SMS requires Firestore and explicit server-side readiness configuration.");
        }
        const actorUid = access.admin?.user?.uid || "";
        const authorizationFingerprint = accessFingerprintFor({ ...access, schedule: access.schedule });
        let batch = existingBatch;
        if (existingBatch.approval?.reviewVersion !== existingBatch.reviewVersion ||
            !["approved", "dispatching", "complete", "partial", "paused"].includes(existingBatch.status)) {
          const approvedRecipients = await readAndValidateScheduleApprovalRecipients(existingBatch, authorizationFingerprint);
          const db = requireFirestore();
          const commit = async (current, schedule, intentsById) => {
            if (!schedule || schedule.churchId !== churchId || schedule.archivedAt || schedule.published === false) {
              throw httpError(409, "This schedule is no longer published and available for SMS.");
            }
            if (!current || current.reviewVersion !== existingBatch.reviewVersion) {
              throw httpError(409, "This schedule review changed. Review the current messages again.");
            }
            if (current.approval?.reviewVersion === current.reviewVersion &&
                ["approved", "dispatching", "complete", "partial", "paused"].includes(current.status)) return current;
            const latestApprovedRecipients = (current.recipients || []).map((row) => {
              if (!row.intentId) return approvedRecipientSnapshot(row, null);
              const intent = intentsById.get(row.intentId);
              const prevalidated = approvedRecipients.find((item) => item.intentId === row.intentId);
              if (!intent || !prevalidated || intent.churchId !== churchId || intent.batchId !== current.batchId ||
                  intent.sourceType !== "team_schedule" || intent.sourceId !== current.scheduleId ||
                  intent.memberId !== row.memberId || !["preview", "ready"].includes(intent.status) ||
                  intent.approvalSnapshot?.approvalVersion !== row.approvalVersion ||
                  intent.approvalSnapshot?.approvalVersion !== prevalidated.approvalVersion ||
                  intent.message !== prevalidated.message || Number(intent.approvalSnapshot?.expiresAt || 0) <= Date.now()) {
                throw httpError(409, "A reviewed message changed or expired. Review the current schedule messages again.");
              }
              return approvedRecipientSnapshot(row, intent);
            });
            return approveReviewedScheduleBatch({
              current, churchId, scheduleId: existingBatch.scheduleId,
              approvalVersion: normalize(req.body?.approvalVersion), actorUid,
              approvedRecipients: latestApprovedRecipients, now: nowIso(), httpError,
            });
          };
          if (db) {
            batch = await db.runTransaction(async (transaction) => {
              const batchRef = db.collection(COLLECTIONS.notificationBatches).doc(batchId);
              const scheduleRef = db.collection(COLLECTIONS.teamSchedules).doc(existingBatch.scheduleId);
              const [batchSnapshot, scheduleSnapshot] = await Promise.all([
                transaction.get(batchRef), transaction.get(scheduleRef),
              ]);
              const current = batchSnapshot.exists ? { batchId: batchSnapshot.id, ...batchSnapshot.data() } : null;
              const currentSchedule = scheduleSnapshot.exists ? { scheduleId: scheduleSnapshot.id, ...scheduleSnapshot.data() } : null;
              const intentSnapshots = await Promise.all((current?.intentIds || []).map((intentId) =>
                transaction.get(db.collection(COLLECTIONS.notificationIntents).doc(intentId)),
              ));
              const intentsById = new Map(intentSnapshots.map((snapshot, index) => [
                current.intentIds[index], snapshot.exists ? { intentId: snapshot.id, ...snapshot.data() } : null,
              ]));
              const approved = await commit(current, currentSchedule, intentsById);
              if (approved !== current) transaction.set(batchRef, approved, { merge: false });
              return approved;
            });
          } else {
            batch = await runMemoryClaim(batchId, async () => {
              const [current, currentSchedule] = await Promise.all([
                getBatchForChurch(batchId, churchId), getDoc(COLLECTIONS.teamSchedules, existingBatch.scheduleId),
              ]);
              const intentRows = await Promise.all((current.intentIds || []).map((id) => getDoc(COLLECTIONS.notificationIntents, id)));
              const intentsById = new Map((current.intentIds || []).map((id, index) => [id, intentRows[index]]));
              const approved = await commit(current, currentSchedule, intentsById);
              if (approved !== current) await setDoc(COLLECTIONS.notificationBatches, batchId, approved, { merge: false });
              return approved;
            });
          }
        }
        const detail = await scheduleInitialBatchDetail(batch, { privacySafe: access.scoped });
        if (!approvalAlreadyRecorded) {
          logger.info?.("schedule_sms.batch_approved", {
            batchId: batch.batchId,
            scheduleId: batch.scheduleId,
            recipientCount: batch.approval?.recipients?.length || 0,
            totalSegments: (batch.approval?.recipients || []).reduce((sum, recipient) => sum + Number(recipient.segmentCount || 0), 0),
          });
        }
        res.json({
          success: true,
          batch: detail,
        });
        scheduleBatchDispatcher?.wake();
        return;
      }
      if (!existingBatch.formId) throw httpError(404, "Message batch not found.");
      const access = await authorizeForm(req, churchId, existingBatch.formId);
      const admin = access.admin;
      if (req.body?.confirmed !== true) throw httpError(400, "Confirm this exact message batch before sending.");
      const requestedApprovalVersion = normalize(req.body?.approvalVersion);
      const db = requireFirestore();
      let batch;
      const claim = (current) => claimReviewedNotificationBatch({
        current, churchId, approvalVersion: requestedApprovalVersion,
        actorUid: admin.user.uid, now: nowIso(), isStaleSending, httpError,
      });
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
      const nextBatch = await executeReviewedNotificationBatch({
        batch,
        getIntent: (intentId) => getDoc(COLLECTIONS.notificationIntents, intentId),
        matchesSource: (intent) => intent.sourceType === "team_intake_recipient" && intent.formId === batch.formId && intent.intentType === batch.intentType && ["availability_request", "availability_reminder"].includes(intent.intentType),
        isStaleSending,
        markUnknownAfterInterruption,
        nowIso,
        sendReviewedIntent: async ({ intentId, approvalVersion }) => {
          // Compatibility adapter: retain the current authenticated manual-send
          // entry point while the batch executor stays independent of Express.
          const sendRes = {
            statusCode: 200,
            status(code) { this.statusCode = code; return this; },
            json(payload) { this.payload = payload; return this; },
          };
          await sendIntent({ ...req, params: { ...req.params, churchId, intentId }, body: { confirmed: true, approvalVersion } }, sendRes);
          return sendRes.payload;
        },
      });
      await setDoc(COLLECTIONS.notificationBatches, batchId, nextBatch, { merge: true });
      return res.json({ success: true, batch: await formatBatchDetail(nextBatch, { privacySafe: access.scoped }) });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ success: false, errorMessage: safeErrorMessage(error, "Could not send this message batch."), ...(error?.code === "AUTH_CSRF_MISMATCH" ? { code: error.code } : {}) });
    }
  };

  const currentScheduleRecipientState = async (batch, approvedRecipient) => {
    const intent = await getDoc(COLLECTIONS.notificationIntents, approvedRecipient.intentId);
    if (!intent || intent.churchId !== batch.churchId || intent.batchId !== batch.batchId ||
        intent.sourceType !== "team_schedule" || intent.sourceId !== batch.scheduleId ||
        intent.memberId !== approvedRecipient.memberId) {
      return { memberId: approvedRecipient.memberId, intentId: approvedRecipient.intentId, status: "excluded", outcome: "not_sent" };
    }
    const attemptIds = [...new Set([intent.attemptId, intent.providerAcceptedAttemptId].filter(Boolean))];
    const attempts = await Promise.all(attemptIds.map((id) => getDoc(COLLECTIONS.smsDeliveryAttempts, id)));
    const acceptedAttempt = attempts.find(hasConfirmedSmsEvidence);
    if (acceptedAttempt && intent.attemptId !== acceptedAttempt.attemptId) {
      return {
        memberId: approvedRecipient.memberId,
        intentId: approvedRecipient.intentId,
        status: "sent",
        attemptId: acceptedAttempt.attemptId,
        attemptStatus: acceptedAttempt.status || "accepted",
        outcome: "confirmed",
      };
    }
    if (acceptedAttempt && (intent.status !== "sent" || intent.providerAcceptedAttemptId !== acceptedAttempt.attemptId)) {
      await reconcileDelivery({
        churchId: batch.churchId,
        intentId: intent.intentId,
        attemptId: acceptedAttempt.attemptId,
        update: {
          providerMessageId: acceptedAttempt.providerMessageId || "",
          status: acceptedAttempt.status || "accepted",
          outcome: "confirmed",
        },
      });
      return currentScheduleRecipientState(batch, approvedRecipient);
    }
    if (intent.status === "sending" && isStaleSending(intent)) {
      await markUnknownAfterInterruption(intent);
      return currentScheduleRecipientState(batch, approvedRecipient);
    }
    if (["preview", "ready"].includes(intent.status) &&
        intent.approvalSnapshot?.approvalVersion !== approvedRecipient.approvalVersion) {
      return {
        memberId: approvedRecipient.memberId,
        intentId: approvedRecipient.intentId,
        status: "excluded",
        outcome: "not_sent",
        exclusionReason: "This message changed after approval. Review the current schedule again.",
      };
    }
    const attempt = attempts.find((item) => item?.attemptId === intent.attemptId) || null;
    return {
      memberId: approvedRecipient.memberId,
      intentId: approvedRecipient.intentId,
      status: intent.status,
      attemptId: intent.attemptId || "",
      attemptStatus: attempt?.status || "",
      outcome: intent.outcome || attempt?.outcome || "",
      exclusionReason: intent.status === "preview" && !intent.approvalSnapshot?.approvalVersion
        ? "This message is no longer eligible under the approved review."
        : "",
    };
  };

  const scheduleBatchStore = createScheduleBatchStoreOperations({
    requireFirestore, COLLECTIONS, getDoc, setDoc, queryDocs, runMemoryClaim, httpError,
  });
  scheduleBatchDispatcher = createScheduleBatchDispatcher({
    ...scheduleBatchStore,
    isStillAuthorized: async (batch) => {
      try {
        await authorizeScheduleActor({
          churchId: batch.churchId,
          scheduleId: batch.scheduleId,
          actorUid: batch.approval?.actorUid,
        });
        return true;
      } catch {
        return false;
      }
    },
    ...scheduleSmsDispatchConfig,
    processRecipient: async ({ batch, recipient, ownership }) => {
      const intent = await getDoc(COLLECTIONS.notificationIntents, recipient.intentId);
      if (!intent || intent.churchId !== batch.churchId || intent.batchId !== batch.batchId ||
          intent.sourceType !== "team_schedule" || intent.sourceId !== batch.scheduleId ||
          intent.memberId !== recipient.memberId) {
        return { errorMessage: "This approved message is no longer available." };
      }
      if (!ownsScheduleBatchLease(await getBatchForChurch(batch.batchId, batch.churchId), ownership)) return {};
      const result = await sendApprovedScheduleIntent({ batch, ownership, recipient });
      if ([401, 403].includes(result.statusCode)) return { ...result, pause: true };
      return result;
    },
    getRecipientState: (recipient, batch) => currentScheduleRecipientState(batch, recipient),
    createOwnerToken: () => randomBytes(24).toString("base64url"),
    logger,
  });

  const startScheduleBatchDispatcher = () => {
    if (isScheduleBulkDispatchReady()) scheduleBatchDispatcher.start();
  };
  const stopScheduleBatchDispatcher = (options) => scheduleBatchDispatcher.stop(options);

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
    getScheduleInitialSmsRecipients,
    prepareScheduleInitialSmsBatch,
    getAvailabilityBatch,
    dispatchAvailabilityBatch,
    startScheduleBatchDispatcher,
    stopScheduleBatchDispatcher,
    saveEventIntents,
    dispatchAutomatically,
    automaticSendsDisabled: automaticSendsDisabled === true,
  };
};
