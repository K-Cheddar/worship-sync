import { serializeAuthError } from "./authErrorResponse.js";
import { calendarDateInTimeZone } from "../shared/teamScheduleOccurrences.ts";
import { evaluateAvailabilityRequestTiming } from "../shared/schedulingAutomationPolicy.ts";
import {
  DEFAULT_SCHEDULING_AUTOMATION_SETTINGS,
  SchedulingCycleValidationError,
  normalizeSchedulingAutomationSettings,
  planSchedulingCycle,
  resolveEffectiveSchedulingSettings,
  schedulingCycleIdFor,
  schedulingSettingsIdFor,
} from "./schedulingCycles.js";

const memorySchedulingQueues = new Map();

const withMemorySchedulingLock = async (churchId, operation) => {
  const key = String(churchId || "");
  const previous = memorySchedulingQueues.get(key) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const current = previous.then(() => gate);
  memorySchedulingQueues.set(key, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (memorySchedulingQueues.get(key) === current) memorySchedulingQueues.delete(key);
  }
};

const actorUid = (actor) => String(actor?.user?.uid || actor?.uid || "").trim() || null;
const revisionNumber = (value, label = "Settings revision") => {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new SchedulingCycleValidationError(`${label} is invalid. Reload settings and try again.`);
  }
  return number;
};

export const createSchedulingCycleHandlers = ({
  COLLECTIONS,
  assertCsrf,
  addSecurityEvent = async () => {},
  getDoc,
  httpError,
  nowIso,
  requireAdminSession,
  requireTeamsEditForTeamSession,
  requireFirestore,
  setDoc,
}) => {
  const defaultsId = (churchId) => schedulingSettingsIdFor({ churchId });
  const overrideId = (churchId, teamId) => schedulingSettingsIdFor({ churchId, teamId });
  const cycleId = (churchId, teamId, periodId) => schedulingCycleIdFor({ churchId, teamId, periodId });

  const readChurch = async (churchId) => {
    const church = await getDoc(COLLECTIONS.churches, churchId);
    if (!church) throw httpError(404, "Church not found.");
    return church;
  };

  const readTeam = async (churchId, teamId) => {
    const team = await getDoc(COLLECTIONS.teams, teamId);
    if (!team || team.churchId !== churchId || team.archivedAt) {
      throw httpError(404, "Team not found.");
    }
    return team;
  };

  const authorizeScope = async (req, churchId, teamId = "") => {
    if (!churchId) throw httpError(400, "Church is required.");
    const actor = teamId
      ? await requireTeamsEditForTeamSession(req, churchId, teamId)
      : await requireAdminSession(req, churchId);
    const [church, team] = await Promise.all([
      readChurch(churchId),
      teamId ? readTeam(churchId, teamId) : Promise.resolve(null),
    ]);
    return { actor, church, team };
  };

  const readSettings = async (churchId, teamId) => {
    const [rawDefaults, rawOverride] = await Promise.all([
      getDoc(COLLECTIONS.teamSchedulingAutomationSettings, defaultsId(churchId)),
      teamId ? getDoc(COLLECTIONS.teamSchedulingAutomationSettings, overrideId(churchId, teamId)) : null,
    ]);
    const defaults = rawDefaults || {
      settingsId: defaultsId(churchId),
      churchId,
      scopeType: "church_defaults",
      settings: DEFAULT_SCHEDULING_AUTOMATION_SETTINGS,
      availabilityAutomationEnabled: false,
      availabilityFormCreationEnabled: false,
      availabilityAutomationActivatedAt: null,
      availabilityAutomationDisabledAt: null,
      availabilityFormCreationActivatedAt: null,
      availabilityFormCreationDisabledAt: null,
      availabilityEmailDeliveryEnabled: false,
      availabilityEmailDeliveryActivatedAt: null,
      availabilityEmailDeliveryDisabledAt: null,
      availabilitySmsDeliveryEnabled: false,
      notificationDeliveryEnabled: false,
      notificationDeliveryActivatedAt: null,
      notificationDeliveryDisabledAt: null,
      revision: 0,
      createdAt: null,
      updatedAt: null,
    };
    const override = teamId ? rawOverride || {
      settingsId: overrideId(churchId, teamId),
      churchId,
      teamId,
      scopeType: "team_override",
      mode: "inherit",
      revision: 0,
      settings: null,
      createdAt: null,
      updatedAt: null,
    } : null;
    const effective = resolveEffectiveSchedulingSettings({ defaults, override });
    return { defaults, override, effective };
  };

  const sendError = (res, error, fallback) => res
    .status(error?.statusCode || 500)
    .json(serializeAuthError(error, { errorMessage: error?.message || fallback }));

  const recordSettingsAudit = async ({ actor, churchId, teamId, revision, type = "", details = {} }) => {
    try {
      await addSecurityEvent({
        type: type || (teamId ? "team_scheduling_override_updated" : "church_scheduling_defaults_updated"),
        churchId,
        userId: actorUid(actor),
        details: { teamId: teamId || null, revision, ...details },
      });
    } catch (error) {
      console.error("Could not record scheduling settings audit event.", error);
    }
  };

  const saveRevisionedSettings = async ({ collection, id, churchId, teamId, expectedRevision, buildNext }) => {
    const db = requireFirestore();
    const currentTime = nowIso();
    if (db) {
      const ref = db.collection(collection).doc(id);
      return db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        const current = snapshot.exists ? snapshot.data() : null;
        const actualRevision = Number(current?.revision || 0);
        if (actualRevision !== expectedRevision) {
          throw httpError(409, "Scheduling settings changed in another session. Reload them before saving.");
        }
        const next = buildNext(current, actualRevision + 1, currentTime);
        transaction.set(ref, next, { merge: false });
        return next;
      });
    }
    return withMemorySchedulingLock(churchId, async () => {
      const current = await getDoc(collection, id);
      const actualRevision = Number(current?.revision || 0);
      if (actualRevision !== expectedRevision) {
        throw httpError(409, "Scheduling settings changed in another session. Reload them before saving.");
      }
      const next = buildNext(current, actualRevision + 1, currentTime);
      await setDoc(collection, id, next, { merge: false });
      return next;
    });
  };

  const getSchedulingAutomation = async (req, res) => {
    try {
      const churchId = String(req.params.churchId || "").trim();
      const teamId = String(req.query?.teamId || "").trim();
      const { church, team } = await authorizeScope(req, churchId, teamId);
      const { defaults, override, effective } = await readSettings(churchId, teamId);
      const periodId = String(req.query?.period || "").trim();
      const savedCycle = teamId && /^\d{4}-(0[1-9]|1[0-2])$/.test(periodId)
        ? await getDoc(COLLECTIONS.teamSchedulingCycles, cycleId(churchId, teamId, periodId))
        : null;
      const savedActions = savedCycle?.plannedActionIds?.length
        ? (await Promise.all(savedCycle.plannedActionIds.map((id) => getDoc(COLLECTIONS.teamSchedulingActions, id)))).filter(Boolean)
        : [];
      return res.json({
        success: true,
        churchId,
        team: team ? { teamId: team.teamId, name: team.name } : null,
        serviceTimeZone: church.serviceTimeZone || null,
        defaults,
        override,
        effective,
        savedCycle,
        savedActions,
      });
    } catch (error) {
      return sendError(res, error, "Could not load scheduling settings.");
    }
  };

  const getSchedulingCycle = async (req, res) => {
    try {
      const churchId = String(req.params.churchId || "").trim();
      const teamId = String(req.params.teamId || "").trim();
      const periodId = String(req.params.periodId || "").trim();
      await authorizeScope(req, churchId, teamId);
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodId)) {
        throw httpError(400, "Choose a valid monthly schedule period.");
      }
      const savedCycle = await getDoc(COLLECTIONS.teamSchedulingCycles, cycleId(churchId, teamId, periodId));
      const savedActions = savedCycle?.plannedActionIds?.length
        ? (await Promise.all(savedCycle.plannedActionIds.map((id) => getDoc(COLLECTIONS.teamSchedulingActions, id)))).filter(Boolean)
        : [];
      return res.json({ success: true, savedCycle, savedActions });
    } catch (error) {
      return sendError(res, error, "Could not load this scheduling cycle.");
    }
  };

  const previewSchedulingCycle = async (req, res) => {
    try {
      await assertCsrf(req);
      const churchId = String(req.params.churchId || "").trim();
      const teamId = String(req.body?.teamId || "").trim();
      const periodId = String(req.body?.periodId || "").trim();
      const { actor, church } = await authorizeScope(req, churchId, teamId);
      const { defaults, override, effective: savedEffective } = await readSettings(churchId, teamId);
      let effective = savedEffective;
      if (req.body?.draftDefaults !== undefined || req.body?.draftOverride !== undefined) {
        const nextDefaults = req.body?.draftDefaults !== undefined
          ? { ...defaults, settings: normalizeSchedulingAutomationSettings(req.body.draftDefaults) }
          : defaults;
        const draftOverride = req.body?.draftOverride !== undefined
          ? req.body.draftOverride
          : override;
        if (!draftOverride || !["inherit", "customize", "disabled"].includes(draftOverride.mode)) {
          throw httpError(400, "Choose a valid team scheduling setting.");
        }
        effective = resolveEffectiveSchedulingSettings({ defaults: nextDefaults, override: draftOverride });
      }
      const planned = planSchedulingCycle({
        churchId,
        teamId,
        periodId,
        serviceTimeZone: church.serviceTimeZone,
        effective,
        createdAt: nowIso(),
        createdBy: actorUid(actor),
      });
      const existing = await getDoc(COLLECTIONS.teamSchedulingCycles, planned.cycle.cycleId);
      const requestAction = planned.actions.find((action) => action.actionType === "availability_request");
      const requestTiming = requestAction ? evaluateAvailabilityRequestTiming({
        dueAt: requestAction.dueAt,
        responseExpiresAt: planned.cycle.deadlines.availabilityResponse?.dueAt,
        responseDeadlineLocalDate: planned.cycle.deadlines.availabilityResponse?.localDate,
        serviceTimeZone: church.serviceTimeZone || "UTC",
        activationAt: defaults.availabilityAutomationActivatedAt,
        now: new Date(),
      }) : null;
      return res.json({
        success: true,
        preview: { cycle: planned.cycle, actions: planned.actions, requestTiming },
        savedCycle: existing,
        isUnsavedPreview: req.body?.draftDefaults !== undefined || req.body?.draftOverride !== undefined,
      });
    } catch (error) {
      return sendError(res, error, "Could not preview this scheduling cycle.");
    }
  };

  const saveChurchSchedulingDefaults = async (req, res) => {
    try {
      await assertCsrf(req);
      const churchId = String(req.params.churchId || "").trim();
      const actor = await requireAdminSession(req, churchId);
      await readChurch(churchId);
      const settings = normalizeSchedulingAutomationSettings(req.body?.settings);
      const expectedRevision = revisionNumber(req.body?.revision);
      const id = defaultsId(churchId);
      const saved = await saveRevisionedSettings({
        collection: COLLECTIONS.teamSchedulingAutomationSettings,
        id,
        churchId,
        expectedRevision,
        buildNext: (current, revision, timestamp) => ({
          ...(current?.createdAt ? { createdAt: current.createdAt } : { createdAt: timestamp }),
          settingsId: id,
          churchId,
          teamId: null,
          scopeType: "church_defaults",
          settings,
          availabilityAutomationEnabled: current?.availabilityAutomationEnabled === true,
          availabilityFormCreationEnabled: current?.availabilityFormCreationEnabled === true,
          availabilityFormCreationActivatedAt: current?.availabilityFormCreationActivatedAt || null,
          availabilityFormCreationDisabledAt: current?.availabilityFormCreationDisabledAt || null,
          availabilityAutomationActivatedAt: current?.availabilityAutomationActivatedAt || null,
          availabilityAutomationDisabledAt: current?.availabilityAutomationDisabledAt || null,
          availabilityEmailDeliveryEnabled: current?.availabilityEmailDeliveryEnabled === true,
          availabilityEmailDeliveryActivatedAt: current?.availabilityEmailDeliveryActivatedAt || null,
          availabilityEmailDeliveryDisabledAt: current?.availabilityEmailDeliveryDisabledAt || null,
          availabilitySmsDeliveryEnabled: false,
          notificationDeliveryEnabled: current?.notificationDeliveryEnabled === true,
          notificationDeliveryActivatedAt: current?.notificationDeliveryActivatedAt || null,
          notificationDeliveryDisabledAt: current?.notificationDeliveryDisabledAt || null,
          revision,
          updatedAt: timestamp,
          audit: { updatedBy: actorUid(actor) },
        }),
      });
      await recordSettingsAudit({ actor, churchId, revision: saved.revision });
      return res.json({ success: true, defaults: saved });
    } catch (error) {
      return sendError(res, error, "Could not save church scheduling defaults.");
    }
  };

  const saveTeamSchedulingOverride = async (req, res) => {
    try {
      await assertCsrf(req);
      const churchId = String(req.params.churchId || "").trim();
      const teamId = String(req.params.teamId || "").trim();
      const { actor } = await authorizeScope(req, churchId, teamId);
      const mode = req.body?.mode;
      if (!["inherit", "customize", "disabled"].includes(mode)) {
        throw httpError(400, "Choose inherited, customized, or disabled scheduling settings.");
      }
      const settings = mode === "customize"
        ? normalizeSchedulingAutomationSettings(req.body?.settings)
        : null;
      const expectedRevision = revisionNumber(req.body?.revision);
      const id = overrideId(churchId, teamId);
      const saved = await saveRevisionedSettings({
        collection: COLLECTIONS.teamSchedulingAutomationSettings,
        id,
        churchId,
        teamId,
        expectedRevision,
        buildNext: (current, revision, timestamp) => ({
          ...(current?.createdAt ? { createdAt: current.createdAt } : { createdAt: timestamp }),
          settingsId: id,
          churchId,
          teamId,
          scopeType: "team_override",
          mode,
          settings,
          revision,
          updatedAt: timestamp,
          audit: { updatedBy: actorUid(actor) },
        }),
      });
      await recordSettingsAudit({ actor, churchId, teamId, revision: saved.revision });
      return res.json({ success: true, override: saved });
    } catch (error) {
      return sendError(res, error, "Could not save team scheduling settings.");
    }
  };

  const setAvailabilityAutomation = async (req, res) => {
    try {
      await assertCsrf(req);
      const churchId = String(req.params.churchId || "").trim();
      const actor = await requireAdminSession(req, churchId);
      const church = await readChurch(churchId);
      const enabled = req.body?.enabled;
      const formCreationEnabled = req.body?.formCreationEnabled;
      if (typeof enabled !== "boolean" || (formCreationEnabled !== undefined && typeof formCreationEnabled !== "boolean")) {
        throw httpError(400, "Choose whether church availability automation and form creation are enabled.");
      }
      const teamId = String(req.body?.teamId || "").trim();
      const periodId = String(req.body?.periodId || "").trim();
      let selectedPeriodStarted = false;
      let selectedCycleActions = [];
      if (enabled && (!teamId || !periodId)) {
        throw httpError(400, "Review a team and monthly cycle before enabling church-wide automation.");
      }
      if (teamId || periodId) {
        if (!teamId || !/^\d{4}-(0[1-9]|1[0-2])$/.test(periodId)) {
          throw httpError(400, "Choose a valid team and monthly period for the activation review.");
        }
        await readTeam(churchId, teamId);
        const localToday = calendarDateInTimeZone(new Date(), church.serviceTimeZone || "UTC");
        selectedPeriodStarted = `${periodId}-01` <= localToday;
        const selectedCycle = await getDoc(COLLECTIONS.teamSchedulingCycles, cycleId(churchId, teamId, periodId));
        if (selectedCycle?.plannedActionIds?.length) {
          selectedCycleActions = (await Promise.all(selectedCycle.plannedActionIds.map((actionId) =>
            getDoc(COLLECTIONS.teamSchedulingActions, actionId),
          ))).filter(Boolean).map(({ actionId, actionType, localDate, localTime, state }) => ({
            actionId, actionType, localDate, localTime, state,
          }));
        } else if (enabled) {
          const { effective } = await readSettings(churchId, teamId);
          const preview = planSchedulingCycle({
            churchId, teamId, periodId, serviceTimeZone: church.serviceTimeZone,
            effective, createdAt: nowIso(), createdBy: actorUid(actor),
          });
          selectedCycleActions = preview.actions.map(({ actionId, actionType, localDate, localTime, state }) => ({
            actionId, actionType, localDate, localTime, state,
          }));
        }
      }
      const expectedRevision = revisionNumber(req.body?.revision);
      const id = defaultsId(churchId);
      const timestamp = nowIso();
      const saved = await saveRevisionedSettings({
        collection: COLLECTIONS.teamSchedulingAutomationSettings,
        id,
        churchId,
        expectedRevision,
        buildNext: (current, revision, updatedAt) => {
          const nextFormCreationEnabled = typeof formCreationEnabled === "boolean"
            ? formCreationEnabled
            : current?.availabilityFormCreationEnabled === true;
          const newlyActivating = enabled && (!current?.availabilityAutomationEnabled ||
            (nextFormCreationEnabled && !current?.availabilityFormCreationEnabled));
          if (newlyActivating && selectedPeriodStarted && req.body?.confirmAlreadyStarted !== true) {
            throw httpError(409, "This scheduling period has started. Review its timeline and confirm before enabling automation.");
          }
          return {
          ...(current?.createdAt ? { createdAt: current.createdAt } : { createdAt: updatedAt }),
          settingsId: id,
          churchId,
          teamId: null,
          scopeType: "church_defaults",
          settings: current?.settings || DEFAULT_SCHEDULING_AUTOMATION_SETTINGS,
          availabilityAutomationEnabled: enabled,
          availabilityFormCreationEnabled: nextFormCreationEnabled,
          availabilityFormCreationActivatedAt: nextFormCreationEnabled
            ? (current?.availabilityFormCreationEnabled ? current.availabilityFormCreationActivatedAt || updatedAt : updatedAt)
            : null,
          availabilityFormCreationDisabledAt: nextFormCreationEnabled ? null : updatedAt,
          availabilityAutomationActivatedAt: enabled ? (current?.availabilityAutomationEnabled ? current.availabilityAutomationActivatedAt || updatedAt : updatedAt) : null,
          availabilityAutomationDisabledAt: enabled ? null : updatedAt,
          // Saving cycle activation cannot change the independent delivery switch.
          availabilityEmailDeliveryEnabled: current?.availabilityEmailDeliveryEnabled === true,
          availabilityEmailDeliveryActivatedAt: current?.availabilityEmailDeliveryActivatedAt || null,
          availabilityEmailDeliveryDisabledAt: current?.availabilityEmailDeliveryDisabledAt || null,
          availabilitySmsDeliveryEnabled: false,
          notificationDeliveryEnabled: current?.notificationDeliveryEnabled === true,
          notificationDeliveryActivatedAt: current?.notificationDeliveryActivatedAt || null,
          notificationDeliveryDisabledAt: current?.notificationDeliveryDisabledAt || null,
          revision,
          updatedAt,
          audit: { updatedBy: actorUid(actor) },
          };
        },
      });
      await recordSettingsAudit({ actor, churchId, revision: saved.revision,
        type: "church_availability_automation_activation_updated",
        details: {
          availabilityAutomationEnabled: saved.availabilityAutomationEnabled === true,
          availabilityFormCreationEnabled: saved.availabilityFormCreationEnabled === true,
          availabilityEmailDeliveryEnabled: saved.availabilityEmailDeliveryEnabled === true,
          availabilitySmsDeliveryEnabled: false,
        } });
      return res.json({ success: true, defaults: saved, activationImpact: {
        churchWide: true,
        selectedTeamId: teamId || null,
        selectedPeriodId: periodId || null,
        selectedPeriodStarted,
        upcomingActions: selectedCycleActions,
        notificationDeliveryEnabled: saved.notificationDeliveryEnabled === true,
      } });
    } catch (error) {
      return sendError(res, error, "Could not update availability automation.");
    }
  };

  const setAvailabilityEmailDelivery = async (req, res) => {
    try {
      await assertCsrf(req);
      const churchId = String(req.params.churchId || "").trim();
      const actor = await requireAdminSession(req, churchId);
      await readChurch(churchId);
      const enabled = req.body?.enabled;
      if (typeof enabled !== "boolean") throw httpError(400, "Choose whether automatic availability email is enabled.");
      if (enabled && req.body?.confirmed !== true) {
        throw httpError(409, "Confirm that automatic availability email should be sent to eligible volunteers.");
      }
      const expectedRevision = revisionNumber(req.body?.revision);
      const id = defaultsId(churchId);
      const saved = await saveRevisionedSettings({
        collection: COLLECTIONS.teamSchedulingAutomationSettings,
        id,
        churchId,
        expectedRevision,
        buildNext: (current, revision, timestamp) => {
          if (enabled && !current?.availabilityAutomationEnabled) {
            throw httpError(409, "Enable church availability automation before enabling email delivery.");
          }
          return {
            ...(current?.createdAt ? { createdAt: current.createdAt } : { createdAt: timestamp }),
            settingsId: id,
            churchId,
            teamId: null,
            scopeType: "church_defaults",
            settings: current?.settings || DEFAULT_SCHEDULING_AUTOMATION_SETTINGS,
            availabilityAutomationEnabled: current?.availabilityAutomationEnabled === true,
            availabilityFormCreationEnabled: current?.availabilityFormCreationEnabled === true,
            availabilityAutomationActivatedAt: current?.availabilityAutomationActivatedAt || null,
            availabilityAutomationDisabledAt: current?.availabilityAutomationDisabledAt || null,
            availabilityEmailDeliveryEnabled: enabled,
            availabilityEmailDeliveryActivatedAt: enabled
              ? (current?.availabilityEmailDeliveryEnabled ? current.availabilityEmailDeliveryActivatedAt || timestamp : timestamp)
              : null,
            availabilityEmailDeliveryDisabledAt: enabled ? null : timestamp,
            availabilitySmsDeliveryEnabled: false,
            notificationDeliveryEnabled: current?.notificationDeliveryEnabled === true,
            notificationDeliveryActivatedAt: current?.notificationDeliveryActivatedAt || null,
            notificationDeliveryDisabledAt: current?.notificationDeliveryDisabledAt || null,
            revision,
            updatedAt: timestamp,
            audit: { updatedBy: actorUid(actor) },
          };
        },
      });
      await recordSettingsAudit({ actor, churchId, revision: saved.revision,
        type: enabled ? "church_availability_email_delivery_enabled" : "church_availability_email_delivery_disabled",
        details: { availabilityEmailDeliveryEnabled: enabled, availabilitySmsDeliveryEnabled: false } });
      return res.json({ success: true, defaults: saved, availabilitySmsDeliveryEnabled: false });
    } catch (error) {
      return sendError(res, error, "Could not update automatic availability email.");
    }
  };

  const ensureSchedulingCycle = async (req, res) => {
    try {
      await assertCsrf(req);
      const churchId = String(req.params.churchId || "").trim();
      const teamId = String(req.params.teamId || "").trim();
      const periodId = String(req.body?.periodId || "").trim();
      const { actor, church } = await authorizeScope(req, churchId, teamId);
      const planned = planSchedulingCycle({
        churchId,
        teamId,
        periodId,
        serviceTimeZone: church.serviceTimeZone,
        effective: await readSettings(churchId, teamId).then(({ effective }) => effective),
        createdAt: nowIso(),
        createdBy: actorUid(actor),
      });
      const cycle = planned.cycle;
      const db = requireFirestore();
      let result;
      if (db) {
        result = await db.runTransaction(async (transaction) => {
          const cycleRef = db.collection(COLLECTIONS.teamSchedulingCycles).doc(cycle.cycleId);
          const existing = await transaction.get(cycleRef);
          if (existing.exists) {
            const saved = { cycleId: existing.id, ...existing.data() };
            return { cycle: saved, actionsCreated: false };
          }
          const defaultsRef = db.collection(COLLECTIONS.teamSchedulingAutomationSettings).doc(defaultsId(churchId));
          const overrideRef = db.collection(COLLECTIONS.teamSchedulingAutomationSettings).doc(overrideId(churchId, teamId));
          const [defaultSnapshot, overrideSnapshot] = await Promise.all([
            transaction.get(defaultsRef), transaction.get(overrideRef),
          ]);
          const defaults = defaultSnapshot.exists ? defaultSnapshot.data() : {
            settings: DEFAULT_SCHEDULING_AUTOMATION_SETTINGS,
            revision: 0,
          };
          const override = overrideSnapshot.exists ? overrideSnapshot.data() : { mode: "inherit", revision: 0 };
          const effective = resolveEffectiveSchedulingSettings({ defaults, override });
          if (!effective.enabled) throw httpError(409, "Scheduling automation is disabled for this team.");
          const fresh = planSchedulingCycle({
            churchId,
            teamId,
            periodId,
            serviceTimeZone: church.serviceTimeZone,
            effective,
            createdAt: nowIso(),
            createdBy: actorUid(actor),
          });
          transaction.create(cycleRef, fresh.cycle);
          fresh.actions.forEach((action) => transaction.create(
            db.collection(COLLECTIONS.teamSchedulingActions).doc(action.actionId), action,
          ));
          return { cycle: fresh.cycle, actionsCreated: true };
        });
      } else {
        result = await withMemorySchedulingLock(churchId, async () => {
          const existing = await getDoc(COLLECTIONS.teamSchedulingCycles, cycle.cycleId);
          if (existing) return { cycle: existing, actionsCreated: false };
          const { effective } = await readSettings(churchId, teamId);
          if (!effective.enabled) throw httpError(409, "Scheduling automation is disabled for this team.");
          const fresh = planSchedulingCycle({
            churchId, teamId, periodId, serviceTimeZone: church.serviceTimeZone,
            effective, createdAt: nowIso(), createdBy: actorUid(actor),
          });
          await setDoc(COLLECTIONS.teamSchedulingCycles, fresh.cycle.cycleId, fresh.cycle);
          for (const action of fresh.actions) {
            await setDoc(COLLECTIONS.teamSchedulingActions, action.actionId, action);
          }
          return { cycle: fresh.cycle, actionsCreated: true };
        });
      }
      return res.json({ success: true, ...result });
    } catch (error) {
      return sendError(res, error, "Could not create this scheduling cycle.");
    }
  };

  return {
    getSchedulingAutomation,
    getSchedulingCycle,
    previewSchedulingCycle,
    saveChurchSchedulingDefaults,
    saveTeamSchedulingOverride,
    setAvailabilityAutomation,
    setAvailabilityEmailDelivery,
    ensureSchedulingCycle,
  };
};
