import { randomUUID } from "node:crypto";
import { calendarDateInTimeZone } from "../shared/teamScheduleOccurrences.ts";
import {
  planSchedulingCycle,
  resolveEffectiveSchedulingSettings,
  schedulingCycleIdFor,
  schedulingSettingsIdFor,
} from "./schedulingCycles.js";

export const SCHEDULING_PROCESSOR_LIMITS = Object.freeze({
  churches: 100,
  teamsPerChurch: 500,
  cyclesPerRun: 250,
  actionsPerRun: 100,
  claimLeaseMs: 5 * 60 * 1000,
  maxAttempts: 5,
  budgetMs: 8 * 60 * 1000,
  lookAheadMonths: 4,
});

export const MINIMUM_AUTOMATIC_AVAILABILITY_RESPONSE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

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

const addDays = (localDate, count) => {
  const parts = dateParts(localDate);
  if (!parts) return "";
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + count));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
};

const iso = (value) => new Date(value).toISOString();
const stableUnique = (values) => [...new Set(values.filter(Boolean))];

const defaultLogger = {
  info: (event) => console.log(JSON.stringify(event)),
  error: (event) => console.error(JSON.stringify(event)),
};

/** Firestore backed, short-lived scheduling processor. It has no provider API. */
export const createSchedulingAutomationProcessor = ({
  firestore,
  collections,
  createAvailabilityRequest,
  now = () => new Date(),
  logger = defaultLogger,
  limits = SCHEDULING_PROCESSOR_LIMITS,
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

  const ensureCycle = async ({ churchId, team, church, defaults, override, periodId, activationAt }) => {
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
        if (!latestDefaults.availabilityAutomationEnabled || !latestDefaults.availabilityFormCreationEnabled ||
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
        const deadline = fresh.cycle.deadlines.availabilityResponse?.dueAt;
        const responseWindowOpen = Date.parse(deadline || "") > now().getTime();
        const runnableTypes = new Set(["availability_request", "availability_follow_up", "leader_summary"]);
        fresh.cycle.automationEnabled = true;
        fresh.cycle.availabilityFormCreationEnabled = true;
        fresh.cycle.activationBoundaryAt = activationAt;
        fresh.cycle.createdByAutomation = true;
        fresh.actions = fresh.actions.map((action) => {
          if (!runnableTypes.has(action.actionType)) return action;
          const withinActivation = Date.parse(action.dueAt || "") >= Date.parse(activationAt || "");
          const enoughTimeToRespond = action.actionType !== "availability_request" ||
            Date.parse(deadline || "") - now().getTime() >= MINIMUM_AUTOMATIC_AVAILABILITY_RESPONSE_WINDOW_MS;
          const state = withinActivation && responseWindowOpen && enoughTimeToRespond ? "pending" : "review_required";
          const reason = state === "pending" ? null : !responseWindowOpen
            ? "The availability response window has closed; a leader must review this cycle."
            : !enoughTimeToRespond
              ? "Less than seven days remain for availability responses; a leader must review this cycle."
            : "This action date predates automation activation; a leader must review this cycle.";
          return { ...action, enabled: state === "pending", state, ...(reason ? { lastError: reason } : {}) };
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
      if (!currentDefaults.availabilityAutomationEnabled || !currentDefaults.availabilityFormCreationEnabled ||
          currentDefaults.availabilityAutomationActivatedAt !== activationAt || !currentEffective.enabled) {
        return { status: "disabled", cycle, actions: [] };
      }
      const actionSnapshots = await Promise.all(actionRefs.map((ref) => transaction.get(ref)));
      const actions = actionSnapshots.filter((snapshot) => snapshot.exists)
        .map((snapshot) => ({ actionId: snapshot.id, ...snapshot.data() }));
      const activationEnabled = currentDefaults.availabilityAutomationEnabled && currentDefaults.availabilityFormCreationEnabled && currentEffective.enabled;
      if (!activationEnabled) return { status: "disabled", cycle, actions };
      if (!cycle.automationEnabled || cycle.activationBoundaryAt !== activationAt || !cycle.availabilityFormCreationEnabled) {
        transaction.set(cycleRef, {
          automationEnabled: true,
          availabilityFormCreationEnabled: true,
          activationBoundaryAt: activationAt,
          updatedAt: now().toISOString(),
        }, { merge: true });
      }
      const runnableTypes = new Set(["availability_request", "availability_follow_up", "leader_summary"]);
      const updatedActions = actions.map((action) => {
        if (!runnableTypes.has(action.actionType) || ["completed", "skipped", "review_required", "canceled", "permanent_failure"].includes(action.state)) return action;
        const dueAt = Date.parse(action.dueAt || "");
        const deadlineAt = Date.parse(cycle.deadlines?.availabilityResponse?.dueAt || "");
        const enoughTimeToRespond = action.actionType !== "availability_request" ||
          deadlineAt - now().getTime() >= MINIMUM_AUTOMATIC_AVAILABILITY_RESPONSE_WINDOW_MS;
        const shouldRun = dueAt >= Date.parse(activationAt || "") && deadlineAt > now().getTime() && enoughTimeToRespond;
        const nextState = shouldRun ? (action.state === "claimed" ? "claimed" : "pending") : "review_required";
        const reason = shouldRun ? null : deadlineAt <= now().getTime()
          ? "The availability response window has closed; a leader must review this cycle."
          : !enoughTimeToRespond
            ? "Less than seven days remain for availability responses; a leader must review this cycle."
          : "The request date predates automation activation; a leader must review this cycle.";
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

  const claimAction = async ({ candidate, runId, claimToken }) => {
    const actionRef = firestore.collection(collections.teamSchedulingActions).doc(candidate.actionId);
    return firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(actionRef);
      if (!snapshot.exists) return null;
      const current = { actionId: snapshot.id, ...snapshot.data() };
      const stateIsClaimable = ["pending", "retryable_failure", "claimed"].includes(current.state);
      const leaseStillActive = current.state === "claimed" && Date.parse(current.claimExpiresAt || "") > now().getTime();
      if (!current.enabled || !stateIsClaimable || leaseStillActive || Date.parse(current.dueAt || "") > now().getTime() ||
          Date.parse(current.nextAttemptAt || "") > now().getTime()) return null;
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

  const finalizeAction = async ({ action, claimToken, state, result = null, error = null, retryAt = null }) => {
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
      const timestamp = now().toISOString();
      const patch = {
        state,
        enabled: state === "retryable_failure",
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
      };
      transaction.set(actionRef, patch, { merge: true });
      if (cycleRef && cycleSnapshot?.exists) {
        const cycle = cycleSnapshot.data();
        const formIds = stableUnique([...(cycle.availabilityFormIds || []), result.formId]);
        transaction.set(cycleRef, { availabilityFormIds: formIds, updatedAt: timestamp }, { merge: true });
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
    if (!church || church.archivedAt || !defaults?.availabilityAutomationEnabled || !defaults?.availabilityFormCreationEnabled) {
      return { eligible: false, reason: "Church availability automation is disabled." };
    }
    if (!team || team.churchId !== action.churchId || team.archivedAt) return { eligible: false, reason: "Team is archived or unavailable." };
    const effective = resolveEffectiveSchedulingSettings({ defaults, override: override || { mode: "inherit" } });
    if (!effective.enabled) return { eligible: false, reason: "Availability automation is disabled for this team." };
    if (!cycle || cycle.churchId !== action.churchId || cycle.teamId !== action.teamId || !cycle.automationEnabled ||
        !cycle.availabilityFormCreationEnabled || cycle.activationBoundaryAt !== defaults.availabilityAutomationActivatedAt) {
      return { eligible: false, reason: "The saved cycle is not eligible under the current activation." };
    }
    const responseDeadline = Date.parse(cycle.deadlines?.availabilityResponse?.dueAt || "");
    if (responseDeadline <= now().getTime()) return { eligible: false, reason: "The availability response window has expired." };
    const schedules = await firestore.collection(collections.teamSchedules)
      .where("churchId", "==", action.churchId)
      .where("teamId", "==", action.teamId)
      .limit(500)
      .select("startDate", "endDate", "published", "archivedAt", "occurrences")
      .get();
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

  const discoverAndEnsure = async ({ dryRun, churchId, teamId, periodId, requestedCycleId, startedAt, signal }) => {
    const scopeQuery = firestore.collection(collections.teamSchedulingAutomationSettings)
      .where("scopeType", "==", "church_defaults")
      .where("availabilityAutomationEnabled", "==", true)
      .limit(limits.churches);
    const scopeSnapshot = churchId
      ? await firestore.collection(collections.teamSchedulingAutomationSettings)
        .where("churchId", "==", churchId)
        .where("scopeType", "==", "church_defaults")
        .where("availabilityAutomationEnabled", "==", true)
        .limit(1).get()
      : await scopeQuery.get();
    const defaultDocs = scopeSnapshot.docs.filter((doc) => {
      const data = doc.data();
      return data.scopeType === "church_defaults" && data.availabilityAutomationEnabled === true;
    });
    const summary = { churchesExamined: 0, cyclesCreated: 0, cyclesReused: 0, actionsReady: 0, actionsHeldForReview: 0, scopesSkipped: 0 };
    const actions = [];
    for (const defaultsDoc of defaultDocs) {
      if (signal?.aborted || now().getTime() - startedAt >= limits.budgetMs || summary.cyclesCreated + summary.cyclesReused >= limits.cyclesPerRun) break;
      const defaults = { id: defaultsDoc.id, ...defaultsDoc.data() };
      const currentChurchId = String(defaults.churchId || "");
      if (!currentChurchId) continue;
      summary.churchesExamined += 1;
      const church = await getData(collections.churches, currentChurchId);
      if (!church || church.archivedAt || (church.status && church.status !== "active")) { summary.scopesSkipped += 1; continue; }
      const timeZone = String(church.serviceTimeZone || "");
      const localDate = calendarDateInTimeZone(now(), timeZone);
      const teamSnapshot = await firestore.collection(collections.teams)
        .where("churchId", "==", currentChurchId)
        .limit(limits.teamsPerChurch)
        .get();
      const teams = teamSnapshot.docs
        .map((doc) => ({ teamId: doc.id, ...doc.data() }))
        .filter((team) => !team.archivedAt && (!teamId || team.teamId === teamId));
      for (const team of teams) {
        if (signal?.aborted || now().getTime() - startedAt >= limits.budgetMs || summary.cyclesCreated + summary.cyclesReused >= limits.cyclesPerRun) break;
        const override = await getData(collections.teamSchedulingAutomationSettings, settingsId(currentChurchId, team.teamId));
        const effective = resolveEffectiveSchedulingSettings({ defaults, override: override || { mode: "inherit" } });
        if (!effective.enabled) { summary.scopesSkipped += 1; continue; }
        const periodIds = periodId ? [periodId] : Array.from({ length: limits.lookAheadMonths }, (_, index) => periodForOffset(localDate, index + 1));
        for (const targetPeriodId of periodIds) {
          if (signal?.aborted || now().getTime() - startedAt >= limits.budgetMs || summary.cyclesCreated + summary.cyclesReused >= limits.cyclesPerRun) break;
          const planned = planSchedulingCycle({ churchId: currentChurchId, teamId: team.teamId, periodId: targetPeriodId,
            serviceTimeZone: timeZone, effective, createdAt: now().toISOString(), createdBy: null });
          if (requestedCycleId && planned.cycle.cycleId !== requestedCycleId) continue;
          const requestAction = planned.actions.find((action) => action.actionType === "availability_request");
          if (!requestAction || Date.parse(planned.cycle.deadlines.availabilityResponse.dueAt) <= now().getTime()) continue;
          const existing = await getData(collections.teamSchedulingCycles, cycleId(currentChurchId, team.teamId, targetPeriodId));
          if (dryRun) {
            const deadlineAt = Date.parse(planned.cycle.deadlines.availabilityResponse.dueAt);
            const withinActivation = Date.parse(requestAction.dueAt) >= Date.parse(defaults.availabilityAutomationActivatedAt || "");
            const enoughTimeToRespond = deadlineAt - now().getTime() >= MINIMUM_AUTOMATIC_AVAILABILITY_RESPONSE_WINDOW_MS;
            const projectedState = withinActivation && enoughTimeToRespond ? "pending" : "review_required";
            const why = !defaults.availabilityFormCreationEnabled
              ? "Automatic form creation is disabled."
              : projectedState === "pending"
                ? existing ? "Existing cycle is retained; eligible due actions will be claimed." : "Cycle and request action are eligible to be ensured."
                : !enoughTimeToRespond
                  ? "Less than seven days remain for responses; leader review is required."
                  : "The request date predates activation; leader review is required.";
            actions.push({ churchId: currentChurchId, teamId: team.teamId, periodId: targetPeriodId,
              cycleId: planned.cycle.cycleId, actionType: requestAction.actionType,
              dueAt: requestAction.dueAt, existingCycle: Boolean(existing), wouldBe: existing ? "reuse" : "ensure",
              projectedState: defaults.availabilityFormCreationEnabled ? projectedState : "disabled", why });
            if (existing) summary.cyclesReused += 1;
            else summary.cyclesCreated += 1;
            continue;
          }
          const result = await ensureCycle({ churchId: currentChurchId, team, church, defaults, override,
            periodId: targetPeriodId, activationAt: defaults.availabilityAutomationActivatedAt });
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
        }
      }
    }
    return { summary, actions };
  };

  const processDueActions = async ({ candidates, runId, dryRun, maxActions, signal, startedAt }) => {
    const counts = { claimed: 0, completed: 0, skipped: 0, retryableFailures: 0, reviewRequired: 0, staleClaims: 0 };
    if (dryRun) return counts;
    for (const candidate of candidates) {
      if (signal?.aborted || now().getTime() - startedAt >= limits.budgetMs) break;
      if (counts.claimed >= maxActions) break;
      const runClaimToken = randomUUID();
      const action = await claimAction({ candidate, runId, claimToken: runClaimToken });
      if (!action) continue;
      counts.claimed += 1;
      try {
        const current = await revalidate(action);
        if (!current.eligible) {
          const finalized = await finalizeAction({ action, claimToken: runClaimToken, state: "skipped", error: current.reason,
            result: { reason: current.reason } });
          if (finalized) counts.skipped += 1;
          else counts.staleClaims += 1;
          continue;
        }
        if (action.actionType !== "availability_request") {
          const finalized = await finalizeAction({ action, claimToken: runClaimToken, state: "review_required",
            error: "Automated delivery for this action is not enabled.", result: { reason: "notification_delivery_disabled" } });
          if (finalized) counts.reviewRequired += 1;
          else counts.staleClaims += 1;
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
          error: result.skipped ? result.reason : null,
          result: { formId: result.formId, recipientCount: Number(result.recipientCount || 0),
            skippedRecipientCount: Number(result.skippedRecipientCount || 0), reused: Boolean(result.reused),
            ...(result.skipped ? { reason: result.reason } : {}) } });
        if (finalized && result.skipped) counts.skipped += 1;
        else if (finalized) counts.completed += 1;
        else counts.staleClaims += 1;
      } catch (error) {
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
      }
    }
    return counts;
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
    if (mode === "live") throw new Error("Live notification delivery is disabled by the server safety switch.");
    const startedAt = now().getTime();
    const startIso = now().toISOString();
    const safeLimit = Math.min(Math.max(Number(limit) || limits.actionsPerRun, 1), limits.actionsPerRun);
    if (requestedCycleId) {
      const selectedCycle = await getData(collections.teamSchedulingCycles, requestedCycleId);
      if (!selectedCycle || (churchId && selectedCycle.churchId !== churchId) || (teamId && selectedCycle.teamId !== teamId) || (periodId && selectedCycle.periodId !== periodId)) {
        throw new Error("The requested cycle does not match the selected church, team, and period.");
      }
      churchId = selectedCycle.churchId;
      teamId = selectedCycle.teamId;
      periodId = selectedCycle.periodId;
    }
    const discovery = await discoverAndEnsure({ dryRun: mode === "dry-run", churchId, teamId, periodId,
      requestedCycleId, startedAt, signal });
    let dueCandidates = [];
    let executionCounts = { claimed: 0, completed: 0, skipped: 0, retryableFailures: 0, reviewRequired: 0, staleClaims: 0 };
    if (mode === "execute") {
      const churches = stableUnique(discovery.actions.map((action) => action.churchId));
      for (const currentChurchId of churches) {
        if (signal?.aborted || now().getTime() - startedAt >= limits.budgetMs || executionCounts.claimed >= safeLimit) break;
        let query = firestore.collection(collections.teamSchedulingActions)
          .where("churchId", "==", currentChurchId)
          .where("enabled", "==", true)
          .where("state", "in", ["pending", "retryable_failure", "claimed"])
          .where("dueAt", "<=", now().toISOString())
          .orderBy("dueAt", "asc")
          .limit(safeLimit - executionCounts.claimed);
        if (teamId) query = query.where("teamId", "==", teamId);
        if (requestedCycleId) query = query.where("cycleId", "==", requestedCycleId);
        const due = await query.get();
        dueCandidates.push(...due.docs.map((doc) => ({ actionId: doc.id, ...doc.data() })));
      }
      executionCounts = await processDueActions({ candidates: dueCandidates, runId, dryRun: false,
        maxActions: safeLimit, signal, startedAt });
    }
    const result = {
      runId,
      mode,
      startedAt: startIso,
      completedAt: now().toISOString(),
      durationMs: now().getTime() - startedAt,
      summary: { ...discovery.summary, ...executionCounts, dueActionsDiscovered: dueCandidates.length },
      actions: mode === "dry-run" ? discovery.actions.slice(0, safeLimit).map((action) => ({
        churchId: action.churchId, teamId: action.teamId, periodId: action.periodId,
        cycleId: action.cycleId, actionType: action.actionType, dueAt: action.dueAt,
        existingCycle: action.existingCycle, wouldBe: action.wouldBe, projectedState: action.projectedState,
        why: action.why,
      })) : [],
    };
    logger.info({ event: "scheduling_processor.completed", ...result });
    return result;
  };

  return { run };
};
