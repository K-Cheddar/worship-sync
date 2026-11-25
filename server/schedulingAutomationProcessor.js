import { createHash, randomUUID } from "node:crypto";
import { calendarDateInTimeZone } from "../shared/teamScheduleOccurrences.ts";
import { evaluateAvailabilityRequestTiming } from "../shared/schedulingAutomationPolicy.ts";
import {
  planSchedulingCycle,
  resolveEffectiveSchedulingSettings,
  schedulingActionIdFor,
  schedulingCycleIdFor,
  schedulingSettingsIdFor,
} from "./schedulingCycles.js";

export const SCHEDULING_PROCESSOR_LIMITS = Object.freeze({
  churches: 100,
  teamsPerChurch: 50,
  maxTeamScopesPerRun: 250,
  cyclesPerRun: 250,
  actionsPerRun: 100,
  claimLeaseMs: 5 * 60 * 1000,
  maxAttempts: 5,
  budgetMs: 8 * 60 * 1000,
  lookAheadMonths: 4,
});

export const SCHEDULING_REQUEST_ON_TIME_GRACE_HOURS = 24;
export const SCHEDULING_CATCH_UP_MINIMUM_LOCAL_DAYS = 7;

const dateParts = (value) => {
  const [year, month, day] = String(value || "").split("-").map(Number);
  return year && month && day ? { year, month, day } : null;
};

const periodForOffset = (localDate, offset) => {
  const parts = dateParts(localDate);
  if (!parts) return "";
  const date = new Date(Date.UTC(parts.year, parts.month - 1 + offset, 1));
  return `${String(date.getUTCFullYear()).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
};

const stableUnique = (values) => [...new Set(values.filter(Boolean))];

const timingForAction = ({ action, cycle, activationAt, now }) => evaluateAvailabilityRequestTiming({
  dueAt: action.dueAt,
  responseExpiresAt: cycle?.deadlines?.availabilityResponse?.dueAt,
  responseDeadlineLocalDate: cycle?.deadlines?.availabilityResponse?.localDate,
  serviceTimeZone: action.serviceTimeZone || cycle?.serviceTimeZone || "UTC",
  activationAt,
  now,
  graceHours: SCHEDULING_REQUEST_ON_TIME_GRACE_HOURS,
  catchUpCalendarDays: SCHEDULING_CATCH_UP_MINIMUM_LOCAL_DAYS,
});

const defaultLogger = {
  info: (event) => console.log(JSON.stringify(event)),
  error: (event) => console.error(JSON.stringify(event)),
};

/** Firestore backed, short-lived scheduling processor. It has no provider API. */
export const createSchedulingAutomationProcessor = ({
  firestore,
  collections,
  createAvailabilityRequest,
  deliverAvailabilityEmails = async () => ({ blocked: true, reason: "Email delivery is unavailable." }),
  automaticEmailDeliveryEnabled = false,
  emailDeliveryConfigured = false,
  now = () => new Date(),
  logger = defaultLogger,
  limits = SCHEDULING_PROCESSOR_LIMITS,
  processorStateNamespace = "global",
}) => {
  if (!firestore?.collection || typeof createAvailabilityRequest !== "function") {
    throw new TypeError("Firestore and the shared availability-request operation are required.");
  }

  const getData = async (collection, id) => {
    const snapshot = await firestore.collection(collection).doc(id).get();
    return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
  };

  const settingsId = (churchId, teamId = "defaults") => schedulingSettingsIdFor({ churchId, teamId });
  const cycleId = (churchId, teamId, periodId) => schedulingCycleIdFor({ churchId, teamId, periodId });
  const processorStateCollection = collections.teamSchedulingProcessorState || "teamSchedulingProcessorState";
  const teamCursorId = (churchId) => `${processorStateNamespace}-team-page-${createHash("sha256").update(churchId).digest("hex")}`;
  const readCursor = async (id) => {
    const state = await getData(processorStateCollection, id);
    return { value: String(state?.cursor || ""), revision: Number(state?.revision || 0) };
  };
  const saveCursor = async ({ id, expectedRevision, value, shouldPersist }) => {
    if (!shouldPersist || !value) return false;
    const ref = firestore.collection(processorStateCollection).doc(id);
    return firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const currentRevision = Number(snapshot.exists ? snapshot.data().revision || 0 : 0);
      if (currentRevision !== expectedRevision) return false;
      transaction.set(ref, { namespace: processorStateNamespace, cursor: value, revision: currentRevision + 1, updatedAt: now().toISOString() }, { merge: false });
      return true;
    });
  };
  const readPage = async ({ query, cursor, limit }) => {
    const first = await (cursor ? query.startAfter(cursor).limit(limit).get() : query.limit(limit).get());
    if (first.size > 0 || !cursor) return first.docs;
    return (await query.limit(limit).get()).docs;
  };

  const ensureCycle = async ({ churchId, team, church, defaults, override, periodId, activationAt, mode }) => {
    const effective = resolveEffectiveSchedulingSettings({ defaults, override });
    if (!effective.enabled) return { status: "disabled", cycle: null, actions: [] };
    const planned = planSchedulingCycle({
      churchId,
      teamId: team.teamId || team.id,
      periodId,
      serviceTimeZone: church.serviceTimeZone,
      effective,
      createdAt: now().toISOString(),
      createdBy: null,
    });
    const cycleRef = firestore.collection(collections.teamSchedulingCycles).doc(planned.cycle.cycleId);
    const actionRefs = planned.actions.map((action) => firestore.collection(collections.teamSchedulingActions).doc(action.actionId));
    return firestore.runTransaction(async (transaction) => {
      const existingCycle = await transaction.get(cycleRef);
      if (!existingCycle.exists) {
        const currentDefaultsRef = firestore.collection(collections.teamSchedulingAutomationSettings).doc(settingsId(churchId));
        const currentOverrideRef = firestore.collection(collections.teamSchedulingAutomationSettings).doc(settingsId(churchId, team.teamId || team.id));
        const [defaultsSnapshot, overrideSnapshot] = await Promise.all([
          transaction.get(currentDefaultsRef),
          transaction.get(currentOverrideRef),
        ]);
        const latestDefaults = defaultsSnapshot.exists ? defaultsSnapshot.data() : defaults;
        const latestOverride = overrideSnapshot.exists ? overrideSnapshot.data() : override;
        const latestEffective = resolveEffectiveSchedulingSettings({ defaults: latestDefaults, override: latestOverride });
        if (!latestDefaults.availabilityAutomationEnabled ||
            latestDefaults.availabilityAutomationActivatedAt !== activationAt || !latestEffective.enabled) {
          return { status: "disabled", cycle: null, actions: [] };
        }
        const fresh = planSchedulingCycle({
          churchId,
          teamId: team.teamId || team.id,
          periodId,
          serviceTimeZone: church.serviceTimeZone,
          effective: latestEffective,
          createdAt: now().toISOString(),
          createdBy: null,
        });
        const responseDeadline = fresh.cycle.deadlines.availabilityResponse;
        const runnableTypes = new Set(["availability_request", "availability_follow_up", "leader_summary"]);
        fresh.cycle.automationEnabled = true;
        fresh.cycle.availabilityFormCreationEnabled = latestDefaults.availabilityFormCreationEnabled === true;
        fresh.cycle.activationBoundaryAt = activationAt;
        fresh.cycle.createdByAutomation = true;
        fresh.actions = fresh.actions.map((action) => {
          if (!runnableTypes.has(action.actionType)) return action;
          const timing = action.actionType === "availability_request"
            ? timingForAction({ action, cycle: fresh.cycle, activationAt, now: now() })
            : { eligible: Date.parse(action.dueAt || "") >= Date.parse(activationAt || ""), reason: "The action date predates automation activation; leader review is required." };
          const formCreationPaused = action.actionType === "availability_request" &&
            latestDefaults.availabilityFormCreationEnabled !== true;
          const state = formCreationPaused ? "pending" : timing.eligible ? "pending" : "review_required";
          const reason = timing.eligible ? null : timing.reason;
          return { ...action, enabled: state === "pending" && !formCreationPaused, state,
            ...(formCreationPaused ? { lastError: "Automatic availability form creation is disabled." } : {}),
            ...(!formCreationPaused && reason ? { lastError: reason } : {}) };
        });
        transaction.create(cycleRef, fresh.cycle);
        fresh.actions.forEach((action) => transaction.create(
          firestore.collection(collections.teamSchedulingActions).doc(action.actionId), action,
        ));
        return { status: "created", cycle: fresh.cycle, actions: fresh.actions };
      }

      const cycle = { cycleId: existingCycle.id, ...existingCycle.data() };
      const currentDefaultsRef = firestore.collection(collections.teamSchedulingAutomationSettings).doc(settingsId(churchId));
      const currentOverrideRef = firestore.collection(collections.teamSchedulingAutomationSettings).doc(settingsId(churchId, team.teamId || team.id));
      const [currentDefaultsSnapshot, currentOverrideSnapshot] = await Promise.all([
        transaction.get(currentDefaultsRef),
        transaction.get(currentOverrideRef),
      ]);
      const currentDefaults = currentDefaultsSnapshot.exists ? currentDefaultsSnapshot.data() : defaults;
      const currentOverride = currentOverrideSnapshot.exists ? currentOverrideSnapshot.data() : override;
      const currentEffective = resolveEffectiveSchedulingSettings({ defaults: currentDefaults, override: currentOverride });
      if (!currentDefaults.availabilityAutomationEnabled ||
          currentDefaults.availabilityAutomationActivatedAt !== activationAt || !currentEffective.enabled) {
        return { status: "disabled", cycle, actions: [] };
      }
      const actionSnapshots = await Promise.all(actionRefs.map((ref) => transaction.get(ref)));
      const actions = actionSnapshots.filter((snapshot) => snapshot.exists)
        .map((snapshot) => ({ actionId: snapshot.id, ...snapshot.data() }));
      const missingEmailDelivery = actionSnapshots.find((snapshot, index) =>
        planned.actions[index]?.actionType === "availability_email_delivery" && !snapshot.exists,
      );
      if (missingEmailDelivery) {
        const plannedDelivery = planned.actions.find((action) => action.actionType === "availability_email_delivery");
        const requestAction = actions.find((action) => action.actionType === "availability_request");
        const hasCompletedRequest = requestAction?.state === "completed" && Boolean(requestAction.relatedFormId);
        const compatibleDelivery = {
          ...plannedDelivery,
          state: hasCompletedRequest ? "pending" : "planned",
          enabled: hasCompletedRequest && mode === "live" && automaticEmailDeliveryEnabled && emailDeliveryConfigured &&
            currentDefaults.availabilityEmailDeliveryEnabled === true,
          relatedFormId: hasCompletedRequest ? requestAction.relatedFormId : null,
          result: hasCompletedRequest ? { lifecycle: "awaiting_email_delivery", compatibilityUpgrade: true } : null,
          createdAt: cycle.createdAt || now().toISOString(),
          updatedAt: now().toISOString(),
        };
        transaction.create(
          firestore.collection(collections.teamSchedulingActions).doc(compatibleDelivery.actionId),
          compatibleDelivery,
        );
        actions.push(compatibleDelivery);
        if (!(cycle.plannedActionIds || []).includes(compatibleDelivery.actionId)) {
          cycle.plannedActionIds = [...(cycle.plannedActionIds || []), compatibleDelivery.actionId];
          transaction.set(cycleRef, { plannedActionIds: cycle.plannedActionIds, updatedAt: now().toISOString() }, { merge: true });
        }
      }
      const activationEnabled = currentDefaults.availabilityAutomationEnabled && currentEffective.enabled;
      if (!activationEnabled) return { status: "disabled", cycle, actions };
      if (!cycle.automationEnabled || cycle.activationBoundaryAt !== activationAt ||
          cycle.availabilityFormCreationEnabled !== (currentDefaults.availabilityFormCreationEnabled === true)) {
        transaction.set(cycleRef, {
          automationEnabled: true,
          availabilityFormCreationEnabled: currentDefaults.availabilityFormCreationEnabled === true,
          activationBoundaryAt: activationAt,
          updatedAt: now().toISOString(),
        }, { merge: true });
      }
      const runnableTypes = new Set(["availability_request", "availability_follow_up", "leader_summary"]);
      const updatedActions = actions.map((action) => {
        if (action.actionType === "availability_email_delivery") {
          const shouldEnable = mode === "live" && automaticEmailDeliveryEnabled && emailDeliveryConfigured &&
            action.state === "pending" && Boolean(action.relatedFormId) &&
            currentDefaults.availabilityEmailDeliveryEnabled === true;
          const shouldDisable = currentDefaults.availabilityEmailDeliveryEnabled !== true && action.enabled;
          if (shouldEnable !== action.enabled || shouldDisable) {
            transaction.set(firestore.collection(collections.teamSchedulingActions).doc(action.actionId), {
              enabled: shouldEnable,
              ...(shouldEnable ? { lastError: null } : {}),
              updatedAt: now().toISOString(),
            }, { merge: true });
            return { ...action, enabled: shouldEnable, ...(shouldEnable ? { lastError: null } : {}) };
          }
          return action;
        }
        if (action.actionType === "availability_request" && ["pending", "retryable_failure"].includes(action.state)) {
          if (currentDefaults.availabilityFormCreationEnabled !== true) {
            if (action.enabled || action.lastError !== "Automatic availability form creation is disabled.") {
              transaction.set(firestore.collection(collections.teamSchedulingActions).doc(action.actionId), {
                enabled: false,
                lastError: "Automatic availability form creation is disabled.",
                updatedAt: now().toISOString(),
              }, { merge: true });
            }
            return { ...action, enabled: false, lastError: "Automatic availability form creation is disabled." };
          }
          const timing = timingForAction({ action, cycle, activationAt, now: now() });
          if (!timing.eligible) {
            transaction.set(firestore.collection(collections.teamSchedulingActions).doc(action.actionId), {
              state: "review_required",
              enabled: false,
              lastError: timing.reason,
              updatedAt: now().toISOString(),
            }, { merge: true });
            return { ...action, state: "review_required", enabled: false, lastError: timing.reason };
          }
          if (!action.enabled) {
            transaction.set(firestore.collection(collections.teamSchedulingActions).doc(action.actionId), {
              enabled: true,
              lastError: null,
              updatedAt: now().toISOString(),
            }, { merge: true });
            return { ...action, enabled: true, lastError: null };
          }
          return action;
        }
        if (!runnableTypes.has(action.actionType) || ["completed", "skipped", "review_required", "canceled", "permanent_failure"].includes(action.state)) return action;
        const dueAt = Date.parse(action.dueAt || "");
        if (action.state === "retryable_failure" || action.state === "claimed" || action.state === "pending") return action;
        const timing = action.actionType === "availability_request"
          ? timingForAction({ action, cycle, activationAt, now: now() })
          : { eligible: dueAt >= Date.parse(activationAt || ""), reason: "The action date predates automation activation; leader review is required." };
        const shouldRun = timing.eligible;
        const nextState = shouldRun ? "pending" : "review_required";
        const reason = shouldRun ? null : timing.reason;
        if (action.enabled !== shouldRun || action.state !== nextState || (reason && action.lastError !== reason)) {
          transaction.set(firestore.collection(collections.teamSchedulingActions).doc(action.actionId), {
            enabled: shouldRun,
            state: nextState,
            ...(reason ? { lastError: reason } : {}),
            updatedAt: now().toISOString(),
          }, { merge: true });
        }
        return { ...action, enabled: shouldRun, state: nextState, ...(reason ? { lastError: reason } : {}) };
      });
      return { status: "existing", cycle: { ...cycle, automationEnabled: true, activationBoundaryAt: activationAt }, actions: updatedActions };
    });
  };

  const matchesScope = (action, scope = {}) =>
    (!scope.churchId || action.churchId === scope.churchId) &&
    (!scope.teamId || action.teamId === scope.teamId) &&
    (!scope.periodId || action.periodId === scope.periodId) &&
    (!scope.requestedCycleId || action.cycleId === scope.requestedCycleId);

  const claimAction = async ({ candidate, runId, claimToken, scope }) => {
    const actionRef = firestore.collection(collections.teamSchedulingActions).doc(candidate.actionId);
    return firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(actionRef);
      if (!snapshot.exists) return null;
      const current = { actionId: snapshot.id, ...snapshot.data() };
      if (!matchesScope(current, scope)) return null;
      const stateIsClaimable = ["pending", "retryable_failure", "claimed"].includes(current.state);
      const leaseStillActive = current.state === "claimed" && Date.parse(current.claimExpiresAt || "") > now().getTime();
      if (!current.enabled || !stateIsClaimable || leaseStillActive || Date.parse(current.dueAt || "") > now().getTime() ||
          Date.parse(current.nextAttemptAt || "") > now().getTime()) return null;
      if (Number(current.attemptCount || 0) >= limits.maxAttempts) {
        const timestamp = now().toISOString();
        transaction.set(actionRef, {
          state: "review_required",
          enabled: false,
          claimToken: null,
          claimOwner: null,
          claimedAt: null,
          claimExpiresAt: null,
          nextAttemptAt: null,
          lastError: "The maximum number of interrupted or failed attempts was reached. Leader review is required.",
          lastFailureClassification: "attempts_exhausted",
          updatedAt: timestamp,
        }, { merge: true });
        return { exhausted: true };
      }
      const claimedAt = now().toISOString();
      const claimExpiresAt = new Date(now().getTime() + limits.claimLeaseMs).toISOString();
      const next = {
        state: "claimed",
        claimToken,
        claimOwner: runId,
        claimedAt,
        claimExpiresAt,
        attemptCount: Number(current.attemptCount || 0) + 1,
        lastAttemptAt: claimedAt,
        updatedAt: claimedAt,
      };
      transaction.set(actionRef, next, { merge: true });
      return { ...current, ...next };
    });
  };

  const renewClaim = async ({ action, claimToken }) => {
    const actionRef = firestore.collection(collections.teamSchedulingActions).doc(action.actionId);
    return firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(actionRef);
      if (!snapshot.exists) return false;
      const current = snapshot.data();
      const expiresAt = Date.parse(current.claimExpiresAt || "");
      if (current.state !== "claimed" || current.claimToken !== claimToken || !Number.isFinite(expiresAt) || expiresAt <= now().getTime()) return false;
      const timestamp = now().toISOString();
      transaction.set(actionRef, {
        claimExpiresAt: new Date(now().getTime() + limits.claimLeaseMs).toISOString(),
        claimHeartbeatAt: timestamp,
        updatedAt: timestamp,
      }, { merge: true });
      return true;
    });
  };

  const finalizeAction = async ({ action, claimToken, state, result = null, error = null, retryAt = null,
    enabledOverride, releaseAttempt = false, enableEmailDelivery = false }) => {
    const actionRef = firestore.collection(collections.teamSchedulingActions).doc(action.actionId);
    return firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(actionRef);
      if (!snapshot.exists) return false;
      const current = snapshot.data();
      const leaseExpiresAt = Date.parse(current.claimExpiresAt || "");
      if (current.state !== "claimed" || current.claimToken !== claimToken ||
          !Number.isFinite(leaseExpiresAt) || leaseExpiresAt <= now().getTime()) return false;
      const cycleRef = result?.formId
        ? firestore.collection(collections.teamSchedulingCycles).doc(action.cycleId)
        : null;
      const cycleSnapshot = cycleRef ? await transaction.get(cycleRef) : null;
      const emailDeliveryRef = action.actionType === "availability_request" && result?.formId
        ? firestore.collection(collections.teamSchedulingActions).doc(schedulingActionIdFor(action.cycleId, "availability_email_delivery"))
        : null;
      const emailDeliverySnapshot = emailDeliveryRef ? await transaction.get(emailDeliveryRef) : null;
      const timestamp = now().toISOString();
      const patch = {
        state,
        ...(releaseAttempt ? { attemptCount: Math.max(0, Number(current.attemptCount || 0) - 1) } : {}),
        enabled: enabledOverride === undefined ? state === "retryable_failure" : enabledOverride,
        claimToken: null,
        claimOwner: null,
        claimedAt: null,
        claimExpiresAt: null,
        lastError: error,
        updatedAt: timestamp,
        ...(state === "completed" || state === "skipped" ? { completedAt: timestamp } : {}),
        ...(result ? { result } : {}),
        ...(result?.formId ? { relatedFormId: result.formId } : {}),
        ...(result?.failureClass ? { lastFailureClassification: result.failureClass } :
          state === "completed" ? { lastFailureClassification: null } : {}),
        ...(retryAt ? { nextAttemptAt: retryAt } : {}),
        ...(!retryAt ? { nextAttemptAt: null } : {}),
      };
      transaction.set(actionRef, patch, { merge: true });
      if (cycleRef && cycleSnapshot?.exists) {
        const cycle = cycleSnapshot.data();
        const formIds = stableUnique([...(cycle.availabilityFormIds || []), result.formId]);
        transaction.set(cycleRef, { availabilityFormIds: formIds, updatedAt: timestamp }, { merge: true });
      }
      if (emailDeliverySnapshot?.exists) {
        transaction.set(emailDeliveryRef, {
          state: "pending",
          enabled: enableEmailDelivery,
          relatedFormId: result.formId,
          dueAt: action.dueAt,
          result: { lifecycle: "awaiting_email_delivery", ...(enableEmailDelivery ? {} : { reason: "delivery_not_authorized_in_this_run" }) },
          lastError: enableEmailDelivery ? null : "Email delivery remains disabled until an authorized live run.",
          updatedAt: timestamp,
        }, { merge: true });
      }
      return true;
    });
  };

  const revalidate = async (action) => {
    const [church, defaults, team, override, cycle] = await Promise.all([
      getData(collections.churches, action.churchId),
      getData(collections.teamSchedulingAutomationSettings, settingsId(action.churchId)),
      getData(collections.teams, action.teamId),
      getData(collections.teamSchedulingAutomationSettings, settingsId(action.churchId, action.teamId)),
      getData(collections.teamSchedulingCycles, action.cycleId),
    ]);
    if (!church || church.archivedAt || !defaults?.availabilityAutomationEnabled) {
      return { eligible: false, reason: "Church availability automation is disabled." };
    }
    if (!team || team.churchId !== action.churchId || team.archivedAt) return { eligible: false, reason: "Team is archived or unavailable." };
    const effective = resolveEffectiveSchedulingSettings({ defaults, override: override || { mode: "inherit" } });
    if (!effective.enabled) return { eligible: false, reason: "Availability automation is disabled for this team." };
    if (action.actionType === "availability_email_delivery" && defaults.availabilityEmailDeliveryEnabled !== true) {
      return { eligible: false, reason: "Automatic availability email is disabled for this church." };
    }
    if (action.actionType === "availability_request" && defaults.availabilityFormCreationEnabled !== true) {
      return { eligible: false, reason: "Automatic availability form creation is disabled for this church." };
    }
    if (!cycle || cycle.churchId !== action.churchId || cycle.teamId !== action.teamId || !cycle.automationEnabled ||
        cycle.activationBoundaryAt !== defaults.availabilityAutomationActivatedAt) {
      return { eligible: false, reason: "The saved cycle is not eligible under the current activation." };
    }
    if (action.actionType === "availability_request") {
      const timing = timingForAction({ action, cycle, activationAt: defaults.availabilityAutomationActivatedAt, now: now() });
      if (!timing.eligible) return { eligible: false, reason: timing.reason };
    }
    const responseDeadline = Date.parse(cycle.deadlines?.availabilityResponse?.dueAt || "");
    if (responseDeadline <= now().getTime()) return { eligible: false, reason: "The availability response window has expired." };
    const schedules = await firestore.collection(collections.teamSchedules)
      .where("churchId", "==", action.churchId)
      .where("teamId", "==", action.teamId)
      .limit(500)
      .select("startDate", "endDate", "published", "archivedAt", "occurrences")
      .get();
    if (schedules.size >= 500) {
      return { eligible: false, reason: "The schedule review exceeded its safe read limit; a leader must review this cycle." };
    }
    const published = schedules.docs.some((doc) => {
      const schedule = doc.data();
      if (schedule.archivedAt || schedule.published === false) return false;
      if (String(schedule.startDate || "") <= action.periodEnd && String(schedule.endDate || "") >= action.periodStart) return true;
      return (schedule.occurrences || []).some((occurrence) => {
        const localDate = occurrence.serviceDate || (occurrence.startsAt
          ? calendarDateInTimeZone(occurrence.startsAt, action.serviceTimeZone || "UTC")
          : "");
        return localDate >= action.periodStart && localDate <= action.periodEnd;
      });
    });
    if (published) return { eligible: false, reason: "A published schedule already exists for this period." };
    return { eligible: true, church, defaults, team, cycle };
  };

  const discoverAndEnsure = async ({ dryRun, churchId, teamId, periodId, requestedCycleId, deadlineAt, signal, mode }) => {
    const scoped = Boolean(churchId || teamId || periodId || requestedCycleId);
    const persistCursors = !dryRun && !scoped;
    const stateId = `${processorStateNamespace}-cycle-discovery`;
    const initialChurchCursor = scoped ? { value: "", revision: 0 } : await readCursor(stateId);
    let churchCursor = initialChurchCursor;
    let churchQuery = firestore.collection(collections.teamSchedulingAutomationSettings)
      .where("scopeType", "==", "church_defaults")
      .where("availabilityAutomationEnabled", "==", true)
      .orderBy("churchId");
    if (churchId) churchQuery = churchQuery.where("churchId", "==", churchId);
    const defaultDocs = churchId
      ? (await churchQuery.limit(1).get()).docs
      : await readPage({ query: churchQuery, cursor: churchCursor.value, limit: limits.churches });
    const eligibleDefaultDocs = defaultDocs.filter((doc) => {
      const data = doc.data();
      return data.scopeType === "church_defaults" && data.availabilityAutomationEnabled === true;
    });
    const summary = { churchesExamined: 0, teamsExamined: 0, cyclesCreated: 0, cyclesReused: 0, actionsReady: 0, actionsHeldForReview: 0, scopesSkipped: 0, discoveryIncomplete: false };
    const actions = [];
    let totalTeamScopes = 0;
    for (const defaultsDoc of eligibleDefaultDocs) {
      if (signal?.aborted || now().getTime() >= deadlineAt ||
          summary.cyclesCreated >= limits.cyclesPerRun || totalTeamScopes >= limits.maxTeamScopesPerRun) {
        summary.discoveryIncomplete = true;
        break;
      }
      const defaults = { id: defaultsDoc.id, ...defaultsDoc.data() };
      const currentChurchId = String(defaults.churchId || "");
      if (!currentChurchId) continue;
      summary.churchesExamined += 1;
      const church = await getData(collections.churches, currentChurchId);
      if (!church || church.archivedAt || (church.status && church.status !== "active")) {
        summary.scopesSkipped += 1;
        if (!scoped && currentChurchId) {
          const saved = await saveCursor({ id: stateId, expectedRevision: churchCursor.revision,
            value: currentChurchId, shouldPersist: persistCursors });
          if (saved) churchCursor.revision += 1;
        }
        continue;
      }
      const timeZone = String(church.serviceTimeZone || "");
      let localDate;
      try {
        localDate = calendarDateInTimeZone(now(), timeZone);
      } catch (error) {
        summary.scopesSkipped += 1;
        logger.error({ event: "scheduling_processor.scope_skipped", churchId: currentChurchId,
          reason: "invalid_service_timezone", error: String(error?.message || error).slice(0, 120) });
        if (!scoped) {
          const saved = await saveCursor({ id: stateId, expectedRevision: churchCursor.revision,
            value: currentChurchId, shouldPersist: persistCursors });
          if (saved) churchCursor.revision += 1;
        }
        continue;
      }
      const teamCursor = !scoped ? await readCursor(teamCursorId(currentChurchId)) : { value: "", revision: 0 };
      let teamQuery = firestore.collection(collections.teams).where("churchId", "==", currentChurchId).orderBy("teamId");
      if (teamId) teamQuery = teamQuery.where("teamId", "==", teamId);
      const teamPageLimit = teamId
        ? 1
        : Math.min(scoped ? limits.maxTeamScopesPerRun : limits.teamsPerChurch, limits.maxTeamScopesPerRun - totalTeamScopes);
      const teamDocs = teamId
        ? (await teamQuery.limit(1).get()).docs
        : await readPage({ query: teamQuery, cursor: teamCursor.value, limit: teamPageLimit });
      const teams = teamDocs
        .map((doc) => ({ teamId: doc.id, ...doc.data() }));
      let lastTeamProcessed = "";
      let churchComplete = true;
      for (const team of teams) {
        if (signal?.aborted || now().getTime() >= deadlineAt ||
            summary.cyclesCreated >= limits.cyclesPerRun || totalTeamScopes >= limits.maxTeamScopesPerRun) {
          churchComplete = false;
          summary.discoveryIncomplete = true;
          break;
        }
        if (team.archivedAt || (teamId && team.teamId !== teamId)) {
          lastTeamProcessed = team.teamId;
          continue;
        }
        totalTeamScopes += 1;
        summary.teamsExamined += 1;
        const override = await getData(collections.teamSchedulingAutomationSettings, settingsId(currentChurchId, team.teamId));
        let effective;
        try {
          effective = resolveEffectiveSchedulingSettings({ defaults, override: override || { mode: "inherit" } });
        } catch (error) {
          summary.scopesSkipped += 1;
          lastTeamProcessed = team.teamId;
          logger.error({ event: "scheduling_processor.scope_skipped", churchId: currentChurchId, teamId: team.teamId,
            reason: "invalid_scheduling_configuration", error: String(error?.message || error).slice(0, 120) });
          continue;
        }
        if (!effective.enabled) { summary.scopesSkipped += 1; lastTeamProcessed = team.teamId; continue; }
        const periodIds = periodId ? [periodId] : Array.from({ length: limits.lookAheadMonths }, (_, index) => periodForOffset(localDate, index + 1));
        let teamComplete = true;
        for (const targetPeriodId of periodIds) {
          if (signal?.aborted || now().getTime() >= deadlineAt ||
              summary.cyclesCreated >= limits.cyclesPerRun) {
            teamComplete = false;
            churchComplete = false;
            summary.discoveryIncomplete = true;
            break;
          }
          try {
            const planned = planSchedulingCycle({ churchId: currentChurchId, teamId: team.teamId, periodId: targetPeriodId,
              serviceTimeZone: timeZone, effective, createdAt: now().toISOString(), createdBy: null });
            if (requestedCycleId && planned.cycle.cycleId !== requestedCycleId) continue;
            const requestAction = planned.actions.find((action) => action.actionType === "availability_request");
            if (!requestAction) continue;
            const existing = await getData(collections.teamSchedulingCycles, cycleId(currentChurchId, team.teamId, targetPeriodId));
            if (dryRun) {
              const timing = timingForAction({ action: requestAction, cycle: planned.cycle,
                activationAt: defaults.availabilityAutomationActivatedAt, now: now() });
              const projectedState = timing.eligible ? "pending" : "review_required";
              const availabilityPreview = defaults.availabilityFormCreationEnabled && timing.eligible
                ? await createAvailabilityRequest({
                  churchId: currentChurchId,
                  teamId: team.teamId,
                  cycle: existing || planned.cycle,
                  operationId: `scheduling-availability-${planned.cycle.cycleId}`,
                  dryRun: true,
                })
                : null;
              const why = !defaults.availabilityFormCreationEnabled
                ? "Automatic form creation is disabled."
                : projectedState === "pending"
                  ? existing ? "Existing cycle is retained; eligible due actions will be claimed." : "Cycle and request action are eligible to be ensured."
                  : timing.reason;
              actions.push({ churchId: currentChurchId, teamId: team.teamId, periodId: targetPeriodId,
                cycleId: planned.cycle.cycleId, actionType: requestAction.actionType,
                dueAt: requestAction.dueAt, existingCycle: Boolean(existing), wouldBe: existing ? "reuse" : "ensure",
                projectedState: defaults.availabilityFormCreationEnabled ? projectedState : "disabled", why,
                availabilityPreview });
              const emailAction = planned.actions.find((action) => action.actionType === "availability_email_delivery");
              const savedEmailAction = existing && emailAction
                ? await getData(collections.teamSchedulingActions, emailAction.actionId)
                : null;
              const savedRequestAction = existing
                ? await getData(collections.teamSchedulingActions, requestAction.actionId)
                : null;
              const hasForm = Boolean(savedEmailAction?.relatedFormId || savedRequestAction?.relatedFormId);
              const emailWhy = savedEmailAction?.state === "completed"
                ? "Initial availability email processing is complete; it will not replay."
                : savedEmailAction?.state === "review_required" || savedEmailAction?.result?.uncertainCount
                  ? "An earlier provider outcome needs review; it will not be resent automatically."
                  : !automaticEmailDeliveryEnabled
                    ? "The SCHEDULING_AUTOMATION_EMAIL_ENABLED server gate is off."
                    : !defaults.availabilityEmailDeliveryEnabled
                      ? "Automatic availability email is disabled in church settings."
                      : !emailDeliveryConfigured
                          ? "Resend is not configured on this server."
                          : !hasForm
                            ? "A form and personalized recipients must be prepared first."
                            : timing.eligible ? "The delivery action is eligible for explicit live execution." : timing.reason;
              actions.push({ churchId: currentChurchId, teamId: team.teamId, periodId: targetPeriodId,
                cycleId: planned.cycle.cycleId, actionType: "availability_email_delivery",
                dueAt: savedEmailAction?.dueAt || emailAction?.dueAt || null,
                existingCycle: Boolean(existing), wouldBe: savedEmailAction ? "reuse" : existing ? "upgrade" : "ensure",
                projectedState: savedEmailAction?.state || (automaticEmailDeliveryEnabled && emailDeliveryConfigured &&
                  defaults.availabilityEmailDeliveryEnabled && hasForm && timing.eligible ? "pending" : "disabled"),
                why: emailWhy });
              if (existing) summary.cyclesReused += 1;
              else summary.cyclesCreated += 1;
              continue;
            }
            const result = await ensureCycle({ churchId: currentChurchId, team, church, defaults, override,
              periodId: targetPeriodId, activationAt: defaults.availabilityAutomationActivatedAt, mode });
            if (result.status === "created") summary.cyclesCreated += 1;
            else if (result.status === "existing") summary.cyclesReused += 1;
            result.actions.forEach((action) => {
              if (["availability_request", "availability_follow_up", "leader_summary"].includes(action.actionType) && action.enabled && ["pending", "retryable_failure"].includes(action.state)) {
                summary.actionsReady += 1;
                actions.push(action);
              } else if (["availability_request", "availability_follow_up", "leader_summary"].includes(action.actionType) && action.state === "review_required") {
                summary.actionsHeldForReview += 1;
              }
            });
          } catch (error) {
            summary.scopesSkipped += 1;
            logger.error({ event: "scheduling_processor.scope_skipped", churchId: currentChurchId, teamId: team.teamId,
              periodId: targetPeriodId, reason: "cycle_planning_failed", error: String(error?.message || error).slice(0, 120) });
          }
        }
        if (!teamComplete) break;
        lastTeamProcessed = team.teamId;
      }
      if (!teamId && !scoped && teams.length === teamPageLimit && lastTeamProcessed) {
        const laterTeams = await teamQuery.startAfter(lastTeamProcessed).limit(1).get();
        if (!laterTeams.empty) {
          churchComplete = false;
          summary.discoveryIncomplete = true;
        }
      } else if (!teamId && scoped && teams.length === teamPageLimit && lastTeamProcessed) {
        const laterTeams = await teamQuery.startAfter(lastTeamProcessed).limit(1).get();
        if (!laterTeams.empty) summary.discoveryIncomplete = true;
      }
      if (!teamId && lastTeamProcessed && !scoped) {
        const saved = await saveCursor({ id: teamCursorId(currentChurchId), expectedRevision: teamCursor.revision,
          value: lastTeamProcessed, shouldPersist: persistCursors });
        if (saved) teamCursor.revision += 1;
      }
      if (!scoped && churchComplete) {
        const saved = await saveCursor({ id: stateId, expectedRevision: churchCursor.revision,
          value: currentChurchId, shouldPersist: persistCursors });
        if (saved) churchCursor.revision += 1;
      }
      if (!churchComplete) break;
    }
    return { summary, actions };
  };

  const processDueActions = async ({ candidates, runId, mode, maxActions, signal, startedAt, stopAt = Number.POSITIVE_INFINITY }) => {
    const counts = { claimed: 0, completed: 0, skipped: 0, retryableFailures: 0, reviewRequired: 0, staleClaims: 0, expiredClaimsRecovered: 0, waitingForDelivery: 0 };
    if (mode === "dry-run") return counts;
    for (const candidate of candidates) {
      if (signal?.aborted || now().getTime() >= stopAt || now().getTime() - startedAt >= limits.budgetMs) break;
      if (counts.claimed >= maxActions) break;
      if (candidate.actionType === "availability_email_delivery" && mode !== "live") continue;
      const runClaimToken = randomUUID();
      const action = await claimAction({ candidate, runId, claimToken: runClaimToken, scope: candidate.scope });
      if (!action) continue;
      if (action.exhausted) {
        counts.reviewRequired += 1;
        continue;
      }
      counts.claimed += 1;
      if (candidate.state === "claimed" && Date.parse(candidate.claimExpiresAt || "") <= now().getTime()) {
        counts.expiredClaimsRecovered += 1;
      }
      let heartbeatLost = false;
      let heartbeatInFlight = Promise.resolve();
      const heartbeatTimer = setInterval(() => {
        heartbeatInFlight = heartbeatInFlight.then(async () => {
          if (!heartbeatLost && !await renewClaim({ action, claimToken: runClaimToken })) heartbeatLost = true;
        }).catch(() => { heartbeatLost = true; });
      }, Math.max(1000, Math.floor(limits.claimLeaseMs / 3)));
      heartbeatTimer.unref?.();
      try {
        if (!await renewClaim({ action, claimToken: runClaimToken })) {
          heartbeatLost = true;
          counts.staleClaims += 1;
          continue;
        }
        const current = await revalidate(action);
        if (heartbeatLost) {
          counts.staleClaims += 1;
          continue;
        }
        if (!current.eligible) {
          if (["availability_email_delivery", "availability_request"].includes(action.actionType) &&
              /disabled/i.test(current.reason || "")) {
            const finalized = await finalizeAction({ action, claimToken: runClaimToken, state: "pending", enabledOverride: false,
              error: current.reason, result: { lifecycle: "email_delivery_blocked", reason: current.reason }, releaseAttempt: true });
            if (finalized) counts.waitingForDelivery += 1;
            else counts.staleClaims += 1;
            continue;
          }
          const finalized = await finalizeAction({ action, claimToken: runClaimToken, state: "skipped", error: current.reason,
            result: { reason: current.reason } });
          if (finalized) counts.skipped += 1;
          else counts.staleClaims += 1;
          continue;
        }
        if (action.actionType !== "availability_request") {
          if (action.actionType === "availability_email_delivery") {
            if (mode !== "live") continue;
            if (!automaticEmailDeliveryEnabled || !emailDeliveryConfigured) {
              const finalized = await finalizeAction({ action, claimToken: runClaimToken, state: "pending", enabledOverride: false,
                error: !automaticEmailDeliveryEnabled ? "The server automatic email gate is disabled." : "Resend email delivery is not configured.",
                result: { lifecycle: "email_delivery_blocked", reason: !automaticEmailDeliveryEnabled ? "environment_gate_disabled" : "provider_unavailable" },
                releaseAttempt: true });
              if (finalized) counts.waitingForDelivery += 1;
              else counts.staleClaims += 1;
              continue;
            }
            if (!await renewClaim({ action, claimToken: runClaimToken })) {
              heartbeatLost = true;
              counts.staleClaims += 1;
              continue;
            }
            const delivery = await deliverAvailabilityEmails({
              churchId: action.churchId,
              teamId: action.teamId,
              cycle: current.cycle,
              formId: action.relatedFormId,
              operationId: `scheduling-availability-email-${action.cycleId}`,
              runId,
            });
            if (delivery?.blocked) {
              const finalized = await finalizeAction({ action, claimToken: runClaimToken, state: "pending", enabledOverride: false,
                error: delivery.reason || "Automatic email delivery is temporarily blocked.",
                result: { lifecycle: "email_delivery_blocked", ...delivery }, releaseAttempt: true });
              if (finalized) counts.waitingForDelivery += 1;
              else counts.staleClaims += 1;
              logger.info({ event: "scheduling_processor.availability_email_delivery", runId, operationMode: mode,
                churchId: action.churchId, teamId: action.teamId, periodId: action.periodId,
                cycleId: action.cycleId, actionId: action.actionId, lifecycle: "blocked",
                reason: delivery.reason || "delivery_blocked" });
              continue;
            }
            const completed = Boolean(delivery?.completed);
            const finalized = await finalizeAction({ action, claimToken: runClaimToken,
              state: delivery?.reviewRequired ? "review_required" : completed ? "completed" : delivery?.retryAt ? "retryable_failure" : "pending",
              enabledOverride: delivery?.reviewRequired ? false : !completed,
              error: delivery?.reason || null,
              result: { lifecycle: "availability_email_delivery", ...delivery },
              retryAt: delivery?.retryAt || null,
              releaseAttempt: Boolean(delivery?.retryAt),
            });
            if (finalized && completed) counts.completed += 1;
            else if (finalized && delivery?.reviewRequired) counts.reviewRequired += 1;
            else if (finalized) counts.waitingForDelivery += 1;
            else counts.staleClaims += 1;
            logger.info({ event: "scheduling_processor.availability_email_delivery", runId, operationMode: mode,
              churchId: action.churchId, teamId: action.teamId, periodId: action.periodId,
              cycleId: action.cycleId, actionId: action.actionId,
              lifecycle: delivery?.lifecycle || (delivery?.reviewRequired ? "review_required" : completed ? "completed" : "pending"),
              recipientCount: Number(delivery?.recipientCount || 0),
              emailEligibleCount: Number(delivery?.emailEligibleCount || 0),
              acceptedCount: Number(delivery?.acceptedCount || 0),
              noEmailContactCount: Number(delivery?.noEmailContactCount || 0),
              failedCount: Number(delivery?.failedCount || 0),
              uncertainCount: Number(delivery?.uncertainCount || 0),
              pendingCount: Number(delivery?.pendingCount || 0) });
            continue;
          }
          const waitingReason = "This action is waiting for availability notification delivery to be enabled.";
          const finalized = await finalizeAction({ action, claimToken: runClaimToken, state: "pending", enabledOverride: false,
            error: waitingReason, result: { reason: "notification_delivery_disabled", waitingForDelivery: true } });
          if (finalized) counts.waitingForDelivery += 1;
          else counts.staleClaims += 1;
          continue;
        }
        if (!await renewClaim({ action, claimToken: runClaimToken })) {
          heartbeatLost = true;
          counts.staleClaims += 1;
          continue;
        }
          const result = await createAvailabilityRequest({
          churchId: action.churchId,
          teamId: action.teamId,
          cycle: current.cycle,
          operationId: `scheduling-availability-${action.cycleId}`,
        });
        const finalized = await finalizeAction({ action, claimToken: runClaimToken,
          state: result.skipped ? "skipped" : "completed",
          enableEmailDelivery: mode === "live" && automaticEmailDeliveryEnabled && emailDeliveryConfigured &&
            current.defaults?.availabilityEmailDeliveryEnabled === true,
          error: result.skipped ? result.reason : null,
          result: { formId: result.formId, recipientCount: Number(result.recipientCount || 0),
            skippedRecipientCount: Number(result.skippedRecipientCount || 0), reused: Boolean(result.reused),
            ...(result.skipped ? { reason: result.reason } : {}) } });
        if (finalized && result.skipped) counts.skipped += 1;
        else if (finalized) counts.completed += 1;
        else counts.staleClaims += 1;
      } catch (error) {
        if (heartbeatLost) {
          counts.staleClaims += 1;
          continue;
        }
        const retryable = !error?.reviewRequired && (error?.retryable === true || error?.code === "UNAVAILABLE" || error?.code === "DEADLINE_EXCEEDED" || error?.code === "ABORTED");
        const attemptCount = Number(action.attemptCount || 0);
        const canRetry = retryable && attemptCount < limits.maxAttempts;
        const delay = Math.min(60 * 60 * 1000, 30_000 * (2 ** Math.max(0, attemptCount - 1)));
        const safeMessage = String(error?.safeMessage || error?.message || "Scheduling operation failed.")
          .replace(/https?:\/\/\S+/gi, "[URL]")
          .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
          .replace(/\+?\d[\d ().-]{7,}\d/g, "[phone]")
          .slice(0, 240);
        const failureClass = retryable ? "transient" : error?.reviewRequired ? "review_required" : "uncertain_or_permanent";
        const finalized = await finalizeAction({
          action,
          claimToken: runClaimToken,
          state: canRetry ? "retryable_failure" : "review_required",
          error: safeMessage,
          result: { failureClass },
          retryAt: canRetry ? new Date(now().getTime() + delay).toISOString() : null,
        });
        if (!finalized) counts.staleClaims += 1;
        else if (canRetry) counts.retryableFailures += 1;
        else counts.reviewRequired += 1;
      } finally {
        clearInterval(heartbeatTimer);
        await heartbeatInFlight;
      }
    }
    return counts;
  };

  const discoverDueActions = async ({ scope, limit, selectedCycle }) => {
    const dueBefore = now().toISOString();
    const candidates = [];
    const appendQuery = async (state, field, operator, value) => {
      let query = firestore.collection(collections.teamSchedulingActions)
        .where("enabled", "==", true)
        .where("state", "==", state)
        .where(field, operator, value)
        .orderBy(field, "asc");
      if (scope.churchId) query = query.where("churchId", "==", scope.churchId);
      if (scope.teamId) query = query.where("teamId", "==", scope.teamId);
      if (scope.periodId) query = query.where("periodId", "==", scope.periodId);
      if (scope.requestedCycleId) query = query.where("cycleId", "==", scope.requestedCycleId);
      const result = await query.limit(limit).get();
      for (const doc of result.docs) {
        const action = { actionId: doc.id, ...doc.data(), scope };
        if (matchesScope(action, scope) && Date.parse(action.dueAt || "") <= now().getTime()) candidates.push(action);
      }
    };

    if (selectedCycle?.plannedActionIds?.length) {
      const snapshots = await Promise.all(selectedCycle.plannedActionIds.map((id) =>
        firestore.collection(collections.teamSchedulingActions).doc(id).get(),
      ));
      for (const snapshot of snapshots) {
        if (!snapshot.exists) continue;
        const action = { actionId: snapshot.id, ...snapshot.data(), scope };
        const eligibleState = action.state === "pending" || action.state === "retryable_failure" ||
          (action.state === "claimed" && Date.parse(action.claimExpiresAt || "") <= now().getTime());
        const eligibleTime = action.state === "retryable_failure"
          ? Date.parse(action.nextAttemptAt || "") <= now().getTime()
          : Date.parse(action.dueAt || "") <= now().getTime();
        if (action.enabled && eligibleState && eligibleTime && matchesScope(action, scope)) candidates.push(action);
      }
    } else {
      await Promise.all([
        appendQuery("pending", "dueAt", "<=", dueBefore),
        appendQuery("retryable_failure", "nextAttemptAt", "<=", dueBefore),
        appendQuery("claimed", "claimExpiresAt", "<=", dueBefore),
      ]);
    }
    const unique = [...new Map(candidates.map((action) => [action.actionId, action])).values()];
    return unique.sort((left, right) => Date.parse(left.dueAt || "") - Date.parse(right.dueAt || ""));
  };

  const validateScope = ({ churchId, teamId, periodId, requestedCycleId, limit }) => {
    const idPattern = /^[A-Za-z0-9_-]{1,128}$/;
    for (const [label, value] of [["church", churchId], ["team", teamId], ["cycle", requestedCycleId]]) {
      if (value && !idPattern.test(value)) throw new Error(`The ${label} scope is malformed.`);
    }
    if (teamId && !churchId) throw new Error("A team scope requires --church.");
    if (periodId && (!churchId || !teamId || !/^\d{4}-(0[1-9]|1[0-2])$/.test(periodId))) {
      throw new Error("A period scope requires --church, --team, and a valid YYYY-MM period.");
    }
    const numericLimit = Number(limit);
    if (!Number.isSafeInteger(numericLimit) || numericLimit < 1 || numericLimit > limits.actionsPerRun) {
      throw new Error(`Limit must be a whole number from 1 to ${limits.actionsPerRun}.`);
    }
  };

  const run = async ({
    mode = "dry-run",
    churchId = "",
    teamId = "",
    periodId = "",
    cycleId: requestedCycleId = "",
    limit = limits.actionsPerRun,
    runId = randomUUID(),
    signal,
  } = {}) => {
    if (!new Set(["dry-run", "execute", "live"]).has(mode)) throw new Error("Mode must be dry-run, execute, or live.");
    churchId = String(churchId || "").trim();
    teamId = String(teamId || "").trim();
    periodId = String(periodId || "").trim();
    requestedCycleId = String(requestedCycleId || "").trim();
    validateScope({ churchId, teamId, periodId, requestedCycleId, limit: limit ?? limits.actionsPerRun });
    if (mode === "live" && !automaticEmailDeliveryEnabled) {
      throw new Error("Live email delivery is disabled by the SCHEDULING_AUTOMATION_EMAIL_ENABLED server gate.");
    }
    if (mode === "live" && !emailDeliveryConfigured) throw new Error("Live email delivery requires a configured Resend provider.");
    const startedAt = now().getTime();
    const startIso = now().toISOString();
    const safeLimit = Number(limit ?? limits.actionsPerRun);
    let selectedCycle = null;
    const selectedCycleLookupId = requestedCycleId || (churchId && teamId && periodId
      ? cycleId(churchId, teamId, periodId) : "");
    if (requestedCycleId) {
      selectedCycle = await getData(collections.teamSchedulingCycles, requestedCycleId);
      if (!selectedCycle || (churchId && selectedCycle.churchId !== churchId) || (teamId && selectedCycle.teamId !== teamId) || (periodId && selectedCycle.periodId !== periodId)) {
        throw new Error("The requested cycle does not match the selected church, team, and period.");
      }
      churchId = selectedCycle.churchId;
      teamId = selectedCycle.teamId;
      periodId = selectedCycle.periodId;
    } else if (selectedCycleLookupId) {
      selectedCycle = await getData(collections.teamSchedulingCycles, selectedCycleLookupId);
    }
    const scope = { churchId, teamId, periodId, requestedCycleId };
    const zeroCounts = () => ({ claimed: 0, completed: 0, skipped: 0, retryableFailures: 0,
      reviewRequired: 0, staleClaims: 0, expiredClaimsRecovered: 0, waitingForDelivery: 0 });
    const addCounts = (left, right) => Object.fromEntries(Object.keys(left).map((key) => [key, left[key] + right[key]]));
    let discovery;
    let dueCandidates = [];
    let executionCounts = zeroCounts();
    if (mode === "dry-run") {
      discovery = await discoverAndEnsure({ dryRun: true, churchId, teamId, periodId,
        requestedCycleId, deadlineAt: startedAt + limits.budgetMs, signal, mode });
      if (selectedCycleLookupId && !selectedCycle) selectedCycle = await getData(collections.teamSchedulingCycles, selectedCycleLookupId);
      dueCandidates = await discoverDueActions({ scope, limit: safeLimit, selectedCycle });
    } else {
      // Give already-due and expired work the first execution slice. Discovery
      // then gets an independent bounded slice, followed by one pass over newly
      // created due actions with any time and action capacity still available.
      const earlyCandidates = await discoverDueActions({ scope, limit: safeLimit, selectedCycle });
      const earlyCounts = await processDueActions({ candidates: earlyCandidates, runId, mode,
        maxActions: safeLimit, signal, startedAt, stopAt: startedAt + Math.floor(limits.budgetMs * 0.4) });
      executionCounts = addCounts(executionCounts, earlyCounts);
      discovery = await discoverAndEnsure({ dryRun: false, churchId, teamId, periodId,
        requestedCycleId, deadlineAt: startedAt + Math.floor(limits.budgetMs * 0.82), signal, mode });
      if (selectedCycleLookupId) selectedCycle = await getData(collections.teamSchedulingCycles, selectedCycleLookupId);
      const newlyDue = await discoverDueActions({ scope, limit: safeLimit, selectedCycle });
      dueCandidates = [...new Map([...earlyCandidates, ...newlyDue].map((action) => [action.actionId, action])).values()];
      const remainingActions = Math.max(0, safeLimit - executionCounts.claimed);
      if (remainingActions > 0) {
        const lateCounts = await processDueActions({ candidates: newlyDue, runId, mode,
          maxActions: remainingActions, signal, startedAt, stopAt: startedAt + limits.budgetMs });
        executionCounts = addCounts(executionCounts, lateCounts);
      }
      // Form creation can durably add the separate email action while due
      // actions are being processed. Pick it up in the same bounded live run
      // when the request action left enough capacity and time.
      if (mode === "live" && executionCounts.claimed < safeLimit &&
          !signal?.aborted && now().getTime() < startedAt + limits.budgetMs) {
        const postCreationDue = await discoverDueActions({ scope, limit: safeLimit, selectedCycle });
        dueCandidates = [...new Map([...dueCandidates, ...postCreationDue].map((action) => [action.actionId, action])).values()];
        const postCreationCounts = await processDueActions({ candidates: postCreationDue, runId, mode,
          maxActions: Math.max(0, safeLimit - executionCounts.claimed), signal,
          startedAt, stopAt: startedAt + limits.budgetMs });
        executionCounts = addCounts(executionCounts, postCreationCounts);
      }
    }
    const discoveryActionByKey = new Map(discovery.actions.map((action) =>
      [`${action.cycleId}|${action.actionType}`, action]));
    const dueActionKeys = new Set(dueCandidates.map((action) => `${action.cycleId}|${action.actionType}`));
    const dryRunActions = mode === "dry-run" ? [
      ...dueCandidates.map((action) => ({
        churchId: action.churchId, teamId: action.teamId, periodId: action.periodId,
        cycleId: action.cycleId, actionType: action.actionType, dueAt: action.dueAt,
        ...(discoveryActionByKey.get(`${action.cycleId}|${action.actionType}`)?.availabilityPreview
          ? { availabilityPreview: discoveryActionByKey.get(`${action.cycleId}|${action.actionType}`).availabilityPreview }
          : {}),
        existingCycle: true, wouldBe: "claim",
        projectedState: action.state === "claimed" ? "expired_claim_recovery" : action.state,
        attemptCount: Number(action.attemptCount || 0),
        why: action.state === "claimed" ? "The prior claim expired and can be recovered." :
          action.state === "retryable_failure" ? "The retry time has arrived." : "The action is due and eligible for a claim.",
      })),
      ...discovery.actions.filter((action) => !dueActionKeys.has(`${action.cycleId}|${action.actionType}`)).map((action) => ({
        churchId: action.churchId, teamId: action.teamId, periodId: action.periodId,
        cycleId: action.cycleId, actionType: action.actionType, dueAt: action.dueAt,
        existingCycle: action.existingCycle, wouldBe: action.wouldBe,
        ...(action.availabilityPreview ? { availabilityPreview: action.availabilityPreview } : {}),
        projectedState: action.projectedState, why: action.why,
      })),
    ] : [];
    const result = {
      runId,
      mode,
      startedAt: startIso,
      completedAt: now().toISOString(),
      durationMs: now().getTime() - startedAt,
      summary: { ...discovery.summary, ...executionCounts, dueActionsDiscovered: dueCandidates.length },
      actions: dryRunActions.slice(0, safeLimit),
    };
    logger.info({ event: "scheduling_processor.completed", ...result });
    return result;
  };

  return { run };
};
