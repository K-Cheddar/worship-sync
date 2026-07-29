import crypto from "node:crypto";
import { emitTeamsEvent } from "./teamsSse.js";
import {
  addServiceFlowSseClient,
  emitServiceFlowUpdated,
  removeServiceFlowSseClient,
} from "./serviceFlowSse.js";
import { buildPublicServicePlanSnapshot } from "./servicePlanPublic.js";
// ServicePlan element titles/notes reuse the exact rich text shape (and its
// normalizer) that the ServiceFlow public "order of service" display already
// validates, so a future ServicePlan -> ServiceFlow publish step needs no
// translation.
import { normalizeRichTextDocument } from "./serviceFlowService.js";

const APP_BASE_URL =
  process.env.AUTH_APP_BASE_URL?.replace(/\/$/, "") ||
  "https://www.worshipsync.net";

const teamIntakeTokenSecret =
  process.env.AUTH_TEAM_INTAKE_TOKEN_SECRET ||
  process.env.AUTH_SESSION_SECRET ||
  "dev-auth-secret";

// Upper bound for a single church's per-collection bootstrap query. Sized to
// cover realistic roster/submission growth while still bounding Firestore reads.
const TEAM_COLLECTION_QUERY_LIMIT = 5000;

export const createTeamsAuthHandlers = ({
  COLLECTIONS,
  scheduleIntakeSubmissionDigest,
  addSecurityEvent,
  assertCsrf,
  createId,
  deleteDoc,
  enforceRateLimit,
  getClientIp,
  getDoc,
  hashValue,
  httpError,
  nowIso,
  queryDocs,
  randomSecret,
  readChurchPublicBoardHeaderLogoUrl,
  requireAdminSession,
  requireTeamsEditSession,
  requireTeamsEditForTeamSession,
  requireTeamsViewSession,
  requireFirestore,
  setDoc,
}) => {
  const requireTeamsEdit = requireTeamsEditSession || requireAdminSession;
  const requireTeamsEditForTeam =
    requireTeamsEditForTeamSession ||
    ((req, churchId) => requireTeamsEdit(req, churchId));
  const requireTeamsView = requireTeamsViewSession || requireAdminSession;

  const withTeamsErrorNextStep = (message) => {
    if (/\btry again\b/i.test(message)) {
      return message;
    }
    const trimmed = message.trim().replace(/\.\s*$/, "");
    return `${trimmed}. Try again in a moment.`;
  };

  const sendTeamsJsonError = (res, error, fallbackMessage) => {
    const statusCode =
      Number.isInteger(error?.statusCode) && error.statusCode >= 400
        ? error.statusCode
        : 500;
    if (statusCode >= 500) {
      console.error(fallbackMessage, error);
    }
    return res.status(statusCode).json({
      success: false,
      errorMessage:
        statusCode < 500 && error?.message
          ? error.message
          : withTeamsErrorNextStep(fallbackMessage),
    });
  };

  const buildPublicTokenRateLimitKey = (req, token) => {
    const tokenText = String(token || "").trim();
    return `${getClientIp(req)}:${tokenText ? hashValue(tokenText) : "missing-token"}`;
  };

  const enforcePublicTokenRateLimit = ({
    req,
    scope,
    token,
    limit,
    windowMs,
    blockMs,
  }) =>
    enforceRateLimit({
      scope,
      key: buildPublicTokenRateLimitKey(req, token),
      limit,
      windowMs,
      blockMs,
    });

  const buildTeamIntakePublicUrl = (token) =>
    `${APP_BASE_URL}/#/teams/intake/${encodeURIComponent(String(token || "").trim())}`;

  const TEAM_ENTITY_CONFIG = {
    member: {
      collection: COLLECTIONS.teamRosterMembers,
      idField: "memberId",
      idPrefix: "teamMember",
    },
    position: {
      collection: COLLECTIONS.teamPositions,
      idField: "positionId",
      idPrefix: "teamPosition",
    },
    team: {
      collection: COLLECTIONS.teams,
      idField: "teamId",
      idPrefix: "team",
    },
    role: {
      collection: COLLECTIONS.teamRoles,
      idField: "roleId",
      idPrefix: "teamRole",
    },
    qualificationArea: {
      collection: COLLECTIONS.teamQualificationAreas,
      idField: "areaId",
      idPrefix: "teamQualificationArea",
    },
    qualificationLevel: {
      collection: COLLECTIONS.teamQualificationLevels,
      idField: "levelId",
      idPrefix: "teamQualificationLevel",
    },
    schedule: {
      collection: COLLECTIONS.teamSchedules,
      idField: "scheduleId",
      idPrefix: "teamSchedule",
    },
  };

  const normalizeShortText = (value, { max = 160 } = {}) =>
    String(value || "")
      .trim()
      .slice(0, max);

  const normalizeLongText = (value, { max = 2000 } = {}) =>
    String(value || "")
      .trim()
      .slice(0, max);

  const normalizeIdArray = (value) =>
    Array.from(
      new Set(
        (Array.isArray(value) ? value : [])
          .map((item) => String(item || "").trim())
          .filter(Boolean),
      ),
    );

  const assertPlainDate = (value, fieldLabel) => {
    const date = String(value || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw httpError(400, `${fieldLabel} must be a valid date.`);
    }
    const parsed = new Date(`${date}T00:00:00.000Z`);
    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== date
    ) {
      throw httpError(400, `${fieldLabel} must be a valid date.`);
    }
    return date;
  };

  const normalizeOptionalPlainDate = (value, fieldLabel) => {
    const date = String(value || "").trim();
    return date ? assertPlainDate(date, fieldLabel) : "";
  };

  const assertTeamScheduleDateTime = (value, fieldLabel) => {
    const dateTime = String(value || "").trim();
    if (!dateTime || Number.isNaN(new Date(dateTime).getTime())) {
      throw httpError(400, `${fieldLabel} must be a valid date and time.`);
    }
    return dateTime;
  };

  // Mirrors client/src/types.ts ServiceItem.type minus the presentation-only
  // "timer"/"service-time" kinds, so mapping a plan into the live outline is 1:1.
  const SERVICE_PLAN_ELEMENT_TYPES = new Set([
    "song",
    "video",
    "image",
    "bible",
    "announcement",
    "free",
    "heading",
  ]);

  // Deterministic id so "does an occurrence already have a plan" is a single
  // getDoc, with no query-and-filter needed (only one plan exists per occurrence).
  const buildServicePlanDocId = (churchId, planKey) => `${churchId}::${planKey}`;

  const MAX_SERVICE_PLAN_TEAM_NOTES = 12;

  const isRichTextDocEmpty = (doc) =>
    !doc?.blocks?.length ||
    doc.blocks.every((block) => block.spans.every((span) => !span.text.trim()));

  const normalizeServicePlanTeamNote = (raw) => {
    if (!raw || typeof raw !== "object") return null;
    const label = normalizeShortText(raw.label, { max: 80 });
    if (!label) return null;
    return {
      id:
        normalizeShortText(raw.id, { max: 160 }) ||
        createId("servicePlanTeamNote"),
      label,
      note: normalizeRichTextDocument(raw.note),
    };
  };

  const normalizeServicePlanSongRef = (raw) => {
    if (!raw || typeof raw !== "object") return undefined;
    if (raw.kind === "library") {
      const songId = normalizeShortText(raw.songId, { max: 160 });
      if (!songId) return undefined;
      return {
        kind: "library",
        songId,
        songName: normalizeShortText(raw.songName, { max: 300 }),
      };
    }
    if (raw.kind === "pending") {
      const title = normalizeShortText(raw.title, { max: 300 });
      if (!title) return undefined;
      return {
        kind: "pending",
        title,
        lyricsText: normalizeLongText(raw.lyricsText, { max: 20000 }),
      };
    }
    return undefined;
  };

  const SERVICE_PLAN_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
  const normalizeServicePlanStartTime = (raw) => {
    const value = String(raw || "").trim();
    return SERVICE_PLAN_TIME_PATTERN.test(value) ? value : undefined;
  };

  const normalizeServicePlanTimezone = (raw) => {
    const timezone = normalizeShortText(raw, { max: 100 });
    if (!timezone) return undefined;
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
      return timezone;
    } catch {
      return undefined;
    }
  };

  const normalizeServicePlanDurationMinutes = (raw) => {
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 && value <= 1440
      ? Math.round(value * 60) / 60
      : undefined;
  };

  const normalizeServicePlanDurationSeconds = (rawSeconds, rawMinutes) => {
    const seconds = Number(rawSeconds);
    if (Number.isFinite(seconds) && seconds > 0 && seconds <= 86_400) {
      return Math.round(seconds);
    }
    const minutes = normalizeServicePlanDurationMinutes(rawMinutes);
    return minutes === undefined ? undefined : Math.round(minutes * 60);
  };

  const normalizeServicePlanElement = (raw) => {
    const notes = normalizeRichTextDocument(raw?.notes);
    const teamNotes = Array.isArray(raw?.teamNotes)
      ? raw.teamNotes
          .map(normalizeServicePlanTeamNote)
          .filter(Boolean)
          .slice(0, MAX_SERVICE_PLAN_TEAM_NOTES)
      : undefined;
    const durationSeconds = normalizeServicePlanDurationSeconds(
      raw?.durationSeconds,
      raw?.durationMinutes,
    );
    return {
      id:
        normalizeShortText(raw?.id, { max: 160 }) ||
        createId("servicePlanElement"),
      type: SERVICE_PLAN_ELEMENT_TYPES.has(raw?.type) ? raw.type : "free",
      title: normalizeRichTextDocument(raw?.title),
      ...(isRichTextDocEmpty(notes) ? {} : { notes }),
      ...(teamNotes?.length ? { teamNotes } : {}),
      startTime: normalizeServicePlanStartTime(raw?.startTime),
      ...(durationSeconds === undefined ? {} : {
        durationSeconds,
        // Retained while older clients and integrations still read minutes.
        durationMinutes: durationSeconds / 60,
      }),
      songRef: normalizeServicePlanSongRef(raw?.songRef),
      assignedMemberId:
        normalizeShortText(raw?.assignedMemberId, { max: 160 }) || undefined,
      assignedName: normalizeShortText(raw?.assignedName, { max: 200 }) || undefined,
      positionId: normalizeShortText(raw?.positionId, { max: 160 }) || undefined,
      sourceLedByRaw:
        normalizeShortText(raw?.sourceLedByRaw, { max: 200 }) || undefined,
      pushedOutlineListId:
        normalizeShortText(raw?.pushedOutlineListId, { max: 160 }) || undefined,
    };
  };

  const normalizeServicePlanSection = (raw) => ({
    id: normalizeShortText(raw?.id, { max: 160 }) || createId("servicePlanSection"),
    name: normalizeShortText(raw?.name, { max: 200 }) || "Section",
    elements: Array.isArray(raw?.elements)
      ? raw.elements.map(normalizeServicePlanElement)
      : [],
  });

  const validateServicePlanPayload = (body, { churchId, planKey }) => {
    const serviceId = normalizeShortText(body?.serviceId, { max: 160 });
    if (!serviceId) {
      throw httpError(400, "A service is required.");
    }
    const date = assertPlainDate(body?.date, "Service plan date");
    const name = normalizeShortText(body?.name, { max: 200 }) || "Service Plan";
    const serviceIds = normalizeIdArray(
      Array.isArray(body?.serviceIds) && body.serviceIds.length
        ? body.serviceIds
        : [serviceId],
    );
    const groupId = normalizeShortText(body?.groupId, { max: 160 }) || undefined;
    const clonedFromPlanKey =
      normalizeShortText(body?.clonedFromPlanKey, { max: 300 }) || undefined;
    const rawStartsAt = String(body?.startsAt || "").trim();
    const startsAt =
      rawStartsAt && !Number.isNaN(Date.parse(rawStartsAt))
        ? new Date(rawStartsAt).toISOString()
        : undefined;
    const timezone = normalizeServicePlanTimezone(body?.timezone);
    const sections = Array.isArray(body?.sections)
      ? body.sections.map(normalizeServicePlanSection)
      : [];
    const rawSourceImport = body?.sourceImport;
    const sourceImport =
      rawSourceImport && typeof rawSourceImport === "object"
        ? {
            source: "servicePlanning",
            sourceUrl: normalizeShortText(rawSourceImport.sourceUrl, {
              max: 2000,
            }),
            loadedAt: normalizeShortText(rawSourceImport.loadedAt, { max: 60 }),
            planLabel: normalizeShortText(rawSourceImport.planLabel, {
              max: 200,
            }),
          }
        : undefined;
    return {
      churchId,
      planKey,
      serviceId,
      serviceIds,
      ...(groupId ? { groupId } : {}),
      date,
      name,
      ...(startsAt ? { startsAt } : {}),
      ...(timezone ? { timezone } : {}),
      sections,
      ...(sourceImport ? { sourceImport } : {}),
      ...(clonedFromPlanKey ? { clonedFromPlanKey } : {}),
    };
  };

  const getServicePlanRevision = (plan) =>
    Number.isSafeInteger(plan?.revision) && plan.revision >= 0
      ? plan.revision
      : 0;

  const getServicePlanBaseRevision = (value) =>
    Number.isSafeInteger(value) && value >= 0 ? value : undefined;

  const servicePlanConflict = (servicePlan) => {
    const error = httpError(
      409,
      "This plan was updated by another editor. Review the latest changes before saving.",
    );
    error.servicePlanConflict = servicePlan;
    return error;
  };

  const assertServicePlanRevision = (existing, baseRevision) => {
    // Older clients can continue their current manual-save workflow during the
    // rollout. Autosave clients always send a revision and receive conflicts
    // instead of silently replacing another editor's full plan document.
    if (baseRevision === undefined || !existing) return;
    if (baseRevision !== getServicePlanRevision(existing)) {
      throw servicePlanConflict(existing);
    }
  };

  const buildServicePlanSaveDocument = ({
    existing,
    payload,
    docId,
    adminUid,
    now,
  }) => {
    const resolvedPublicLive = normalizePublicLiveState(existing?.publicLive, {
      ...existing,
      ...payload,
    });
    const nextPublicLive =
      existing?.publicLive?.mode === "manual" &&
      resolvedPublicLive.mode === "schedule"
        ? resolvedPublicLive
        : null;
    return {
      ...payload,
      planId: docId,
      pushedToOutlineAt: existing?.pushedToOutlineAt || null,
      published: Boolean(existing?.published),
      ...(existing
        ? nextPublicLive
          ? { publicLive: nextPublicLive }
          : {}
        : { publicLive: { mode: "schedule" } }),
      ...(existing?.publicLinkToken
        ? {
            publicLinkToken: existing.publicLinkToken,
            publicTokenHash: existing.publicTokenHash,
          }
        : {}),
      ...(existing?.publicGeneralLinkToken
        ? {
            publicGeneralLinkToken: existing.publicGeneralLinkToken,
            publicGeneralTokenHash: existing.publicGeneralTokenHash,
          }
        : {}),
      revision: getServicePlanRevision(existing) + 1,
      updatedAt: now,
      updatedByUid: adminUid,
      ...(existing ? {} : { createdAt: now, createdByUid: adminUid }),
    };
  };

  /** Templates hold structure only — no date, no live/public state, and the
   * per-week specifics are stripped client-side before they get here. */
  const validateServicePlanTemplatePayload = (body) => {
    const name = normalizeShortText(body?.name, { max: 200 });
    if (!name) {
      throw httpError(400, "A template name is required.");
    }
    const serviceId = normalizeShortText(body?.serviceId, { max: 160 }) || undefined;
    const sections = Array.isArray(body?.sections)
      ? body.sections.map(normalizeServicePlanSection)
      : [];
    return {
      name,
      ...(serviceId ? { serviceId } : {}),
      sections,
    };
  };

  const createServicePlanPublicToken = () =>
    crypto.randomBytes(24).toString("base64url");

  const buildPublicServicePlanUrl = (token) =>
    `${APP_BASE_URL}/#/services/${encodeURIComponent(String(token || "").trim())}`;

  const ensureChurchCurrentServiceTokens = async (churchId, adminUid) => {
    const church = await getDoc(COLLECTIONS.churches, churchId);
    const currentTeamToken = normalizeShortText(church?.currentServiceTeamToken, {
      max: 200,
    });
    const currentGeneralToken = normalizeShortText(church?.currentServiceGeneralToken, {
      max: 200,
    });
    const teamToken = currentTeamToken || createServicePlanPublicToken();
    const generalToken = currentGeneralToken || createServicePlanPublicToken();
    if (!currentTeamToken || !currentGeneralToken) {
      await setDoc(
        COLLECTIONS.churches,
        churchId,
        {
          ...(!currentTeamToken
            ? {
                currentServiceTeamToken: teamToken,
                currentServiceTeamTokenHash: hashValue(teamToken),
              }
            : {}),
          ...(!currentGeneralToken
            ? {
                currentServiceGeneralToken: generalToken,
                currentServiceGeneralTokenHash: hashValue(generalToken),
              }
            : {}),
          updatedAt: nowIso(),
          updatedByUid: adminUid,
        },
        { merge: true },
      );
    }
    return { teamToken, generalToken };
  };

  /**
   * How long a plan still counts as "the current service" past its start when
   * its own item durations don't say otherwise. Plans frequently carry no
   * durations at all (imports often omit them), which would otherwise make
   * every plan end the instant it starts — so a sticky "current service" link
   * would skip straight past today's service to next week's.
   */
  const MIN_CURRENT_SERVICE_WINDOW_MS = 3 * 60 * 60_000;

  const getServicePlanEndMs = (plan) => {
    const startsAtMs = Date.parse(plan?.startsAt || "");
    if (Number.isNaN(startsAtMs)) return null;
    const durationMs = (plan?.sections || []).flatMap((section) => section?.elements || [])
      .reduce((total, element) => {
        const minutes = Number(element?.durationMinutes);
        return total + (Number.isFinite(minutes) && minutes > 0 ? minutes * 60_000 : 0);
      }, 0);
    return startsAtMs + Math.max(durationMs, MIN_CURRENT_SERVICE_WINDOW_MS);
  };

  const getCurrentPublishedServicePlan = async (churchId) => {
    const plans = await queryDocs(
      COLLECTIONS.servicePlans,
      [{ field: "churchId", value: churchId }],
      { limit: TEAM_COLLECTION_QUERY_LIMIT },
    );
    const now = Date.now();
    const eligible = plans
      .filter((plan) => plan?.published && plan?.publicLinkToken && plan?.startsAt)
      .map((plan) => ({
        plan,
        startsAtMs: Date.parse(plan.startsAt),
        endsAtMs: getServicePlanEndMs(plan),
      }))
      .filter(({ startsAtMs, endsAtMs }) => !Number.isNaN(startsAtMs) && endsAtMs !== null);
    const active = eligible
      .filter(({ startsAtMs, endsAtMs }) => startsAtMs <= now && now < endsAtMs)
      .sort((left, right) => right.startsAtMs - left.startsAtMs)[0];
    if (active) return active.plan;
    const next = eligible
      .filter(({ startsAtMs }) => startsAtMs > now)
      .sort((left, right) => left.startsAtMs - right.startsAtMs)[0];
    if (next) return next.plan;
    return eligible.sort((left, right) => right.startsAtMs - left.startsAtMs)[0]?.plan || null;
  };

  const getPlanElementIds = (plan) =>
    new Set(
      (plan?.sections || [])
        .flatMap((section) =>
          (section?.elements || []).map((element) =>
            String(element?.id || "").trim(),
          ),
        )
        .filter(Boolean),
    );

  const normalizePublicLiveState = (raw, plan) => {
    const currentElementId = normalizeShortText(raw?.currentElementId, {
      max: 160,
    });
    if (raw?.mode === "manual" && getPlanElementIds(plan).has(currentElementId)) {
      return { mode: "manual", currentElementId };
    }
    return { mode: "schedule" };
  };

  const ensureServicePlanPublicTokens = async (plan, adminUid) => {
    const existingTeamToken = normalizeShortText(plan?.publicLinkToken, {
      max: 200,
    });
    const existingGeneralToken = normalizeShortText(plan?.publicGeneralLinkToken, {
      max: 200,
    });
    const publicLinkToken = existingTeamToken || createServicePlanPublicToken();
    const publicGeneralLinkToken = existingGeneralToken || createServicePlanPublicToken();
    if (!existingTeamToken || !existingGeneralToken) {
      await setDoc(
        COLLECTIONS.servicePlans,
        plan.planId,
        {
          ...(!existingTeamToken
            ? { publicLinkToken, publicTokenHash: hashValue(publicLinkToken) }
            : {}),
          ...(!existingGeneralToken
            ? {
                publicGeneralLinkToken,
                publicGeneralTokenHash: hashValue(publicGeneralLinkToken),
              }
            : {}),
          updatedAt: nowIso(),
          updatedByUid: adminUid,
        },
        { merge: true },
      );
    }
    return { publicLinkToken, publicGeneralLinkToken };
  };

  const getPublicServicePlanByToken = async (token) => {
    const trimmed = String(token || "").trim();
    if (!trimmed) throw httpError(404, "Service not found.");
    const [teamPlan] = await queryDocs(
      COLLECTIONS.servicePlans,
      [{ field: "publicTokenHash", value: hashValue(trimmed) }],
      { limit: 1 },
    );
    if (teamPlan?.published && teamPlan.publicLinkToken) {
      return { plan: teamPlan, viewMode: "team", token: trimmed };
    }
    const [generalPlan] = await queryDocs(
      COLLECTIONS.servicePlans,
      [{ field: "publicGeneralTokenHash", value: hashValue(trimmed) }],
      { limit: 1 },
    );
    if (!generalPlan?.published || !generalPlan.publicGeneralLinkToken) {
      const [currentTeamChurch] = await queryDocs(
        COLLECTIONS.churches,
        [{ field: "currentServiceTeamTokenHash", value: hashValue(trimmed) }],
        { limit: 1 },
      );
      if (currentTeamChurch?.currentServiceTeamToken) {
        const plan = await getCurrentPublishedServicePlan(currentTeamChurch.churchId);
        if (plan) return { plan, viewMode: "team", token: trimmed };
      }
      const [currentGeneralChurch] = await queryDocs(
        COLLECTIONS.churches,
        [{ field: "currentServiceGeneralTokenHash", value: hashValue(trimmed) }],
        { limit: 1 },
      );
      if (currentGeneralChurch?.currentServiceGeneralToken) {
        const plan = await getCurrentPublishedServicePlan(currentGeneralChurch.churchId);
        if (plan) return { plan, viewMode: "general", token: trimmed };
      }
      throw httpError(404, "Service not found.");
    }
    return { plan: generalPlan, viewMode: "general", token: trimmed };
  };

  const buildPublicServicePlan = async ({ plan, viewMode, token }) => {
    const [church, churchLogoUrl] = await Promise.all([
      getDoc(COLLECTIONS.churches, plan.churchId),
      readChurchPublicBoardHeaderLogoUrl(plan.churchId),
    ]);
    return buildPublicServicePlanSnapshot({
      plan,
      churchName: church?.name || "WorshipSync",
      churchLogoUrl,
      viewMode,
      shareId: token,
    });
  };

  const emitPublicServicePlanUpdated = async (plan, revision) => {
    if (!plan?.published) return;
    const church = await getDoc(COLLECTIONS.churches, plan.churchId);
    [
      plan.publicLinkToken,
      plan.publicGeneralLinkToken,
      church?.currentServiceTeamToken,
      church?.currentServiceGeneralToken,
    ]
      .map((token) => String(token || "").trim())
      .filter((token, index, tokens) => token && tokens.indexOf(token) === index)
      .forEach((token) => emitServiceFlowUpdated(token, revision));
  };

  const normalizeBlockoutDates = (value) => {
    const ranges = Array.isArray(value) ? value : [];
    return ranges
      .map((range) => {
        const startDate = normalizeOptionalPlainDate(
          range?.startDate,
          "Blockout start date",
        );
        const endDate = normalizeOptionalPlainDate(
          range?.endDate,
          "Blockout end date",
        );
        if (!startDate && !endDate) return null;
        const normalizedStart = startDate || endDate;
        const normalizedEnd = endDate || startDate;
        if (normalizedStart > normalizedEnd) {
          throw httpError(
            400,
            "Blockout end date must be after the start date.",
          );
        }
        return {
          startDate: normalizedStart,
          endDate: normalizedEnd,
          notes: normalizeLongText(range?.notes, { max: 500 }),
        };
      })
      .filter(Boolean);
  };

  // Per-occurrence availability map keyed by occurrenceId (`serviceId@startsAt`).
  // Any value other than "unavailable" is treated as available.
  const normalizeServiceAvailability = (value) => {
    const result = {};
    if (value && typeof value === "object") {
      Object.entries(value).forEach(([occurrenceId, status]) => {
        const key = normalizeShortText(occurrenceId, { max: 200 });
        if (!key) return;
        result[key] = status === "unavailable" ? "unavailable" : "available";
      });
    }
    return result;
  };

  // Combine the notes of merged blockout ranges, de-duplicating individual
  // entries (split on ";") so repeated intake submissions don't stack identical
  // notes like "From intake form".
  const combineBlockoutNotes = (...notes) => {
    const seen = new Set();
    const parts = [];
    notes.forEach((note) => {
      String(note || "")
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean)
        .forEach((part) => {
          if (seen.has(part)) return;
          seen.add(part);
          parts.push(part);
        });
    });
    return parts.join("; ");
  };

  // Collapse overlapping or duplicate blockout ranges into the fewest entries
  // that cover the same days. Ranges are plain "YYYY-MM-DD" strings, so string
  // comparison is a valid date comparison. Adjacent-but-not-overlapping ranges
  // (e.g. 6/23 then 6/24) are intentionally left separate.
  const mergeBlockoutDateRanges = (ranges) => {
    const valid = (Array.isArray(ranges) ? ranges : []).filter(
      (range) => range && range.startDate && range.endDate,
    );
    const sorted = [...valid].sort((a, b) =>
      a.startDate === b.startDate
        ? a.endDate.localeCompare(b.endDate)
        : a.startDate.localeCompare(b.startDate),
    );
    const merged = [];
    sorted.forEach((range) => {
      const current = merged[merged.length - 1];
      // Sorted by start, so an overlap exists when this range starts on or
      // before the running range's end. Fold it in and extend the end.
      if (current && range.startDate <= current.endDate) {
        if (range.endDate > current.endDate) current.endDate = range.endDate;
        current.notes = combineBlockoutNotes(current.notes, range.notes);
      } else {
        merged.push({ ...range });
      }
    });
    return merged;
  };

  const getTeamEntity = async (kind, id) => {
    const config = TEAM_ENTITY_CONFIG[kind];
    const trimmedId = String(id || "").trim();
    if (!config || !trimmedId) return null;
    const doc = await getDoc(config.collection, trimmedId);
    return doc ? { [config.idField]: doc.id, ...doc } : null;
  };

  const assertTeamEntityInChurch = async (
    kind,
    id,
    churchId,
    { active = true, label } = {},
  ) => {
    const entity = await getTeamEntity(kind, id);
    const entityLabel = label || kind;
    if (!entity || entity.churchId !== churchId) {
      throw httpError(404, `${entityLabel} not found.`);
    }
    if (active && entity.archivedAt) {
      throw httpError(400, `${entityLabel} is archived.`);
    }
    return entity;
  };

  const assertTeamEntityIdsInChurch = async (
    kind,
    ids,
    churchId,
    { label, active = true, assertEntity } = {},
  ) => {
    const normalizedIds = normalizeIdArray(ids);
    await Promise.all(
      normalizedIds.map(async (id) => {
        const entity = await assertTeamEntityInChurch(kind, id, churchId, {
          active,
          label,
        });
        if (assertEntity) assertEntity(entity);
      }),
    );
    return normalizedIds;
  };

  const collectMemberTeamIds = async (member, churchId) => {
    const teamIds = new Set();
    Object.keys(member?.teamMemberships || {}).forEach((teamId) => {
      if (teamId) teamIds.add(teamId);
    });
    (member?.qualifications || []).forEach((qualification) => {
      if (qualification?.teamId) teamIds.add(qualification.teamId);
    });
    await Promise.all(
      (member?.positionIds || []).map(async (positionId) => {
        const position = await assertTeamEntityInChurch(
          "position",
          positionId,
          churchId,
          { label: "Position", active: false },
        );
        if (position.teamId) teamIds.add(position.teamId);
      }),
    );
    return Array.from(teamIds);
  };

  const requireTeamsEditForTeamIds = async (req, churchId, teamIds) => {
    const uniqueTeamIds = Array.from(new Set(teamIds.filter(Boolean)));
    if (uniqueTeamIds.length === 0) {
      return requireTeamsEdit(req, churchId);
    }
    let admin = null;
    for (const teamId of uniqueTeamIds) {
      admin = await requireTeamsEditForTeam(req, churchId, teamId);
    }
    return admin;
  };

  const requireTeamsEditForMember = async (req, churchId, member) =>
    requireTeamsEditForTeamIds(
      req,
      churchId,
      await collectMemberTeamIds(member, churchId),
    );

  // Add a member to each given team's roster. Tolerant of stale/foreign/archived
  // team ids (skipped), since callers may pass ids from intake forms that could
  // be out of date. Returns the team ids whose roster actually changed.
  const addMemberToTeams = async ({
    churchId,
    teamIds,
    memberId,
    adminUserId,
  }) => {
    const normalizedMemberId = normalizeShortText(memberId, { max: 160 });
    const ids = normalizeIdArray(teamIds);
    if (!normalizedMemberId || ids.length === 0) return [];
    const now = nowIso();
    const addedTeamIds = [];
    await Promise.all(
      ids.map(async (teamId) => {
        const team = await getDoc(COLLECTIONS.teams, teamId);
        if (!team || team.churchId !== churchId || team.archivedAt) return;
        if ((team.memberIds || []).includes(normalizedMemberId)) return;
        await setDoc(
          COLLECTIONS.teams,
          teamId,
          {
            memberIds: [...(team.memberIds || []), normalizedMemberId],
            updatedAt: now,
            updatedByUid: adminUserId,
          },
          { merge: true },
        );
        addedTeamIds.push(teamId);
      }),
    );
    return addedTeamIds;
  };

  const addMemberToTeamsForPositions = async ({
    churchId,
    positionIds,
    memberId,
    adminUserId,
  }) => {
    const normalizedPositionIds = normalizeIdArray(positionIds);
    const normalizedMemberId = normalizeShortText(memberId, { max: 160 });
    if (!normalizedMemberId || normalizedPositionIds.length === 0) return [];
    const positions = await Promise.all(
      normalizedPositionIds.map((positionId) =>
        assertTeamEntityInChurch("position", positionId, churchId, {
          label: "Position",
        }),
      ),
    );
    const teamIds = Array.from(
      new Set(positions.map((position) => position.teamId).filter(Boolean)),
    );
    return addMemberToTeams({
      churchId,
      teamIds,
      memberId: normalizedMemberId,
      adminUserId,
    });
  };

  const listTeamCollectionForChurch = async (
    collectionName,
    idField,
    churchId,
    { truncatedCollections } = {},
  ) => {
    const docs = await queryDocs(
      collectionName,
      [{ field: "churchId", value: churchId }],
      { limit: TEAM_COLLECTION_QUERY_LIMIT },
    );
    // A full page back means there may be more rows we silently dropped. Surface
    // it so a church outgrowing the cap is observable instead of quietly losing
    // members, submissions, etc. from the admin view.
    if (docs.length >= TEAM_COLLECTION_QUERY_LIMIT) {
      console.warn(
        `Teams: ${collectionName} returned the ${TEAM_COLLECTION_QUERY_LIMIT}-row query cap for church ${churchId}; results may be truncated.`,
      );
      // Let the caller (the bootstrap) tell the admin their view is incomplete.
      if (truncatedCollections) truncatedCollections.push(collectionName);
    }
    return docs
      .map((doc) => ({
        [idField]: doc.id,
        ...doc,
      }))
      .sort(
        (a, b) =>
          new Date(a.createdAt || 0).getTime() -
          new Date(b.createdAt || 0).getTime(),
      );
  };

  // Positions carry an explicit `order` so admins can arrange them; the schedule
  // columns follow this same order. Positions without an order (legacy/just
  // created) fall back to creation order, which is how they already arrive here.
  const sortPositionsByOrder = (positions) =>
    [...positions].sort((a, b) => {
      const orderA = Number.isFinite(a?.order)
        ? a.order
        : Number.MAX_SAFE_INTEGER;
      const orderB = Number.isFinite(b?.order)
        ? b.order
        : Number.MAX_SAFE_INTEGER;
      return orderA - orderB;
    });

  // Next order index for a newly created position: append after the team's
  // current positions so new positions land at the end.
  const nextPositionOrder = async (churchId, teamId) => {
    const positions = await listTeamCollectionForChurch(
      COLLECTIONS.teamPositions,
      "positionId",
      churchId,
    );
    const orders = positions
      .filter((position) => position.teamId === teamId)
      .map((position) =>
        Number.isFinite(position.order) ? position.order : -1,
      );
    return Math.max(-1, ...orders) + 1;
  };

  const sanitizeTeamIntakeFormForAdmin = (form, submissionCount = 0) => {
    const {
      publicTokenHash,
      publicTokenNonce,
      publicLinkToken,
      ...clientForm
    } = form || {};
    return {
      ...clientForm,
      submissionCount,
      ...(publicLinkToken
        ? { publicUrl: buildTeamIntakePublicUrl(publicLinkToken) }
        : {}),
    };
  };

  const buildTeamsBootstrap = async (churchId) => {
    // Collects any collection that hit the row cap so we can warn the admin their
    // view is incomplete instead of silently showing a partial roster/schedule.
    const truncatedCollections = [];
    const [
      members,
      positions,
      teams,
      teamRoles,
      qualificationAreas,
      qualificationLevels,
      schedules,
      rawIntakeForms,
      intakeSubmissions,
    ] = await Promise.all([
      listTeamCollectionForChurch(
        COLLECTIONS.teamRosterMembers,
        "memberId",
        churchId,
        { truncatedCollections },
      ),
      listTeamCollectionForChurch(
        COLLECTIONS.teamPositions,
        "positionId",
        churchId,
        { truncatedCollections },
      ),
      listTeamCollectionForChurch(COLLECTIONS.teams, "teamId", churchId, {
        truncatedCollections,
      }),
      listTeamCollectionForChurch(COLLECTIONS.teamRoles, "roleId", churchId, {
        truncatedCollections,
      }),
      listTeamCollectionForChurch(
        COLLECTIONS.teamQualificationAreas,
        "areaId",
        churchId,
        { truncatedCollections },
      ),
      listTeamCollectionForChurch(
        COLLECTIONS.teamQualificationLevels,
        "levelId",
        churchId,
        { truncatedCollections },
      ),
      listTeamCollectionForChurch(
        COLLECTIONS.teamSchedules,
        "scheduleId",
        churchId,
        { truncatedCollections },
      ),
      listTeamCollectionForChurch(
        COLLECTIONS.teamIntakeForms,
        "formId",
        churchId,
        { truncatedCollections },
      ),
      listTeamCollectionForChurch(
        COLLECTIONS.teamIntakeSubmissions,
        "submissionId",
        churchId,
        { truncatedCollections },
      ),
    ]);
    const submissionCountByForm = new Map();
    intakeSubmissions.forEach((submission) => {
      submissionCountByForm.set(
        submission.formId,
        (submissionCountByForm.get(submission.formId) || 0) + 1,
      );
    });
    const intakeForms = rawIntakeForms.map((form) =>
      sanitizeTeamIntakeFormForAdmin(
        form,
        submissionCountByForm.get(form.formId) || 0,
      ),
    );
    return {
      members,
      positions: sortPositionsByOrder(positions),
      teams,
      teamRoles,
      qualificationAreas,
      qualificationLevels,
      schedules,
      intakeForms,
      intakeSubmissions,
      ...(truncatedCollections.length > 0 ? { truncated: true } : {}),
    };
  };

  const sanitizePositionRequirements = (value) => {
    const byPosition = new Map();
    (Array.isArray(value) ? value : []).forEach((req) => {
      const positionId = normalizeShortText(req?.positionId, { max: 160 });
      const count = Math.floor(Number(req?.count));
      if (!positionId || !Number.isFinite(count) || count < 1) return;
      const minLevelId = normalizeShortText(req?.minLevelId, { max: 160 });
      byPosition.set(positionId, {
        positionId,
        count,
        ...(minLevelId ? { minLevelId } : {}),
      });
    });
    return [...byPosition.values()];
  };

  const normalizeTeamMemberships = async (value, churchId) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }
    const entries = await Promise.all(
      Object.entries(value).map(async ([key, rawMembership]) => {
        const teamId = normalizeShortText(rawMembership?.teamId || key, {
          max: 160,
        });
        if (!teamId) return null;
        await assertTeamEntityInChurch("team", teamId, churchId, {
          label: "Team",
        });
        const roleId = normalizeShortText(rawMembership?.roleId, { max: 160 });
        const roleLabel = normalizeShortText(rawMembership?.roleLabel, {
          max: 120,
        });
        if (roleId) {
          const role = await assertTeamEntityInChurch(
            "role",
            roleId,
            churchId,
            {
              label: "Team role",
            },
          );
          if (role.teamId !== teamId) {
            throw httpError(400, "Team role must belong to the selected team.");
          }
        }
        return [
          teamId,
          {
            teamId,
            ...(roleId ? { roleId } : {}),
            ...(roleLabel ? { roleLabel } : {}),
            notes: normalizeLongText(rawMembership?.notes, { max: 500 }),
          },
        ];
      }),
    );
    return Object.fromEntries(entries.filter(Boolean));
  };

  const normalizeTeamMemberQualifications = async (value, churchId) => {
    const rows = Array.isArray(value) ? value : [];
    const normalized = await Promise.all(
      rows.map(async (rawQualification) => {
        const areaId = normalizeShortText(rawQualification?.areaId, {
          max: 160,
        });
        if (!areaId) return null;
        const area = await assertTeamEntityInChurch(
          "qualificationArea",
          areaId,
          churchId,
          { label: "Qualification area" },
        );
        const levelId = normalizeShortText(rawQualification?.levelId, {
          max: 160,
        });
        if (levelId) {
          const level = await assertTeamEntityInChurch(
            "qualificationLevel",
            levelId,
            churchId,
            { label: "Qualification level" },
          );
          if (level.areaId !== areaId) {
            throw httpError(
              400,
              "Qualification level must belong to the selected area.",
            );
          }
        }
        const teamId = normalizeShortText(rawQualification?.teamId, {
          max: 160,
        });
        if (teamId) {
          await assertTeamEntityInChurch("team", teamId, churchId, {
            label: "Team",
          });
          if (area.teamId !== teamId) {
            throw httpError(
              400,
              "Qualification area must belong to the selected team.",
            );
          }
        }
        const statusValues = new Set(["in_training", "completed", "expired"]);
        const status = statusValues.has(rawQualification?.status)
          ? rawQualification.status
          : "in_training";
        return {
          qualificationId:
            normalizeShortText(rawQualification?.qualificationId, {
              max: 160,
            }) || createId("memberQualification"),
          areaId,
          ...(levelId ? { levelId } : {}),
          teamId: teamId || area.teamId,
          status,
          completedAt: normalizeOptionalPlainDate(
            rawQualification?.completedAt,
            "Qualification completion date",
          ),
          expiresAt: normalizeOptionalPlainDate(
            rawQualification?.expiresAt,
            "Qualification expiration date",
          ),
          verifiedByUid: normalizeShortText(rawQualification?.verifiedByUid, {
            max: 160,
          }),
          notes: normalizeLongText(rawQualification?.notes, { max: 500 }),
        };
      }),
    );
    return normalized.filter(Boolean);
  };

  const validateTeamMemberPayload = async (body, churchId) => {
    const firstName = normalizeShortText(body?.firstName, { max: 80 });
    const lastName = normalizeShortText(body?.lastName, { max: 80 });
    if (!firstName) {
      throw httpError(400, "First name is required.");
    }
    if (!lastName) {
      throw httpError(400, "Last name is required.");
    }
    const dateOfBirth = normalizeOptionalPlainDate(
      body?.dateOfBirth,
      "Date of birth",
    );
    const positionIds = await assertTeamEntityIdsInChurch(
      "position",
      body?.positionIds,
      churchId,
      { label: "Position" },
    );
    const payload = {
      firstName,
      lastName,
      dateOfBirth,
      positionIds,
      blockoutDates: normalizeBlockoutDates(body?.blockoutDates),
      notes: normalizeLongText(body?.notes),
    };
    if (Object.prototype.hasOwnProperty.call(body || {}, "teamMemberships")) {
      payload.teamMemberships = await normalizeTeamMemberships(
        body?.teamMemberships,
        churchId,
      );
    }
    if (Object.prototype.hasOwnProperty.call(body || {}, "qualifications")) {
      payload.qualifications = await normalizeTeamMemberQualifications(
        body?.qualifications,
        churchId,
      );
    }
    if (
      Object.prototype.hasOwnProperty.call(body || {}, "desiredPositionIds")
    ) {
      payload.desiredPositionIds = await assertTeamEntityIdsInChurch(
        "position",
        body?.desiredPositionIds,
        churchId,
        { label: "Position" },
      );
    }
    if (
      Object.prototype.hasOwnProperty.call(body || {}, "serviceAvailability")
    ) {
      payload.serviceAvailability = normalizeServiceAvailability(
        body?.serviceAvailability,
      );
    }
    return payload;
  };

  const validateTeamPositionPayload = async (body, churchId) => {
    const name = normalizeShortText(body?.name);
    if (!name) {
      throw httpError(400, "Position name is required.");
    }
    // Positions are owned by a team; the team must exist in this church.
    const team = await assertTeamEntityInChurch(
      "team",
      body?.teamId,
      churchId,
      {
        label: "Team",
      },
    );
    const qualificationAreaId = normalizeShortText(body?.qualificationAreaId, {
      max: 160,
    });
    if (qualificationAreaId) {
      const area = await assertTeamEntityInChurch(
        "qualificationArea",
        qualificationAreaId,
        churchId,
        { label: "Qualification area" },
      );
      if (area.teamId !== team.teamId) {
        throw httpError(
          400,
          "Qualification area must belong to the selected team.",
        );
      }
    }
    return {
      name,
      description: normalizeLongText(body?.description),
      icon: normalizeShortText(body?.icon, { max: 40 }),
      groupId: normalizeShortText(body?.groupId, { max: 160 }) || null,
      qualificationAreaId: qualificationAreaId || null,
      teamId: team.teamId,
    };
  };

  const validateTeamPayload = async (body, churchId) => {
    const name = normalizeShortText(body?.name);
    if (!name) {
      throw httpError(400, "Team name is required.");
    }
    const memberIds = await assertTeamEntityIdsInChurch(
      "member",
      body?.memberIds,
      churchId,
      { label: "Member" },
    );
    // Positions are owned by the team (position.teamId), not selected onto it, so
    // a team's positions are derived.
    return {
      name,
      description: normalizeLongText(body?.description),
      icon: normalizeShortText(body?.icon, { max: 40 }),
      memberIds,
    };
  };

  const validateTeamRolePayload = async (body, churchId) => {
    const name = normalizeShortText(body?.name, { max: 120 });
    if (!name) {
      throw httpError(400, "Role name is required.");
    }
    const team = await assertTeamEntityInChurch(
      "team",
      body?.teamId,
      churchId,
      {
        label: "Team",
      },
    );
    return {
      teamId: team.teamId,
      name,
      description: normalizeLongText(body?.description),
    };
  };

  const validateQualificationAreaPayload = async (body, churchId) => {
    const name = normalizeShortText(body?.name, { max: 120 });
    if (!name) {
      throw httpError(400, "Qualification area name is required.");
    }
    const team = await assertTeamEntityInChurch(
      "team",
      body?.teamId,
      churchId,
      {
        label: "Team",
      },
    );
    return {
      teamId: team.teamId,
      name,
      description: normalizeLongText(body?.description),
    };
  };

  const validateQualificationLevelPayload = async (body, churchId) => {
    const name = normalizeShortText(body?.name, { max: 120 });
    if (!name) {
      throw httpError(400, "Qualification level name is required.");
    }
    const area = await assertTeamEntityInChurch(
      "qualificationArea",
      body?.areaId,
      churchId,
      { label: "Qualification area" },
    );
    const rank = Number(body?.rank);
    if (!Number.isFinite(rank)) {
      throw httpError(400, "Qualification level rank is required.");
    }
    return {
      areaId: area.areaId,
      name,
      description: normalizeLongText(body?.description),
      rank,
    };
  };

  const normalizeTeamScheduleOccurrences = (value, serviceIds) => {
    const occurrences = Array.isArray(value) ? value : [];
    if (occurrences.length === 0) {
      throw httpError(400, "At least one service occurrence is required.");
    }
    const serviceIdSet = new Set(serviceIds);
    const seen = new Set();
    return occurrences.map((occurrence) => {
      const occurrenceId = normalizeShortText(occurrence?.occurrenceId, {
        max: 260,
      });
      const serviceId = normalizeShortText(occurrence?.serviceId, { max: 160 });
      if (!occurrenceId) {
        throw httpError(400, "Service occurrence id is required.");
      }
      if (seen.has(occurrenceId)) {
        throw httpError(400, "Service occurrence ids must be unique.");
      }
      seen.add(occurrenceId);
      if (!serviceIdSet.has(serviceId)) {
        throw httpError(
          400,
          "Service occurrence must reference a selected service.",
        );
      }
      // Combined occurrences merge several selected services that share a group.
      const groupId = normalizeShortText(occurrence?.groupId, { max: 160 });
      const serviceIds = Array.isArray(occurrence?.serviceIds)
        ? occurrence.serviceIds
            .map((id) => normalizeShortText(id, { max: 160 }))
            .filter((id) => serviceIdSet.has(id))
        : [];
      return {
        occurrenceId,
        serviceId,
        ...(groupId ? { groupId } : {}),
        ...(serviceIds.length ? { serviceIds } : {}),
        name: normalizeShortText(occurrence?.name),
        startsAt: assertTeamScheduleDateTime(
          occurrence?.startsAt,
          "Service occurrence date",
        ),
        positionRequirements: sanitizePositionRequirements(
          occurrence?.positionRequirements,
        ),
      };
    });
  };

  const normalizeTeamScheduleAttendance = ({
    value,
    occurrenceIds,
    teamMemberIds,
  }) => {
    const rawAttendance = value && typeof value === "object" ? value : {};
    const occurrenceIdSet = new Set(occurrenceIds);
    const teamMemberIdSet = new Set(teamMemberIds || []);
    const attendance = {};
    for (const [occurrenceId, row] of Object.entries(rawAttendance)) {
      if (
        !occurrenceIdSet.has(occurrenceId) ||
        !row ||
        typeof row !== "object"
      ) {
        continue;
      }
      for (const [memberId, rawEntry] of Object.entries(row)) {
        const normalizedMemberId = normalizeShortText(memberId, { max: 160 });
        if (!teamMemberIdSet.has(normalizedMemberId)) continue;
        const status =
          rawEntry?.status === "present" || rawEntry?.status === "absent"
            ? rawEntry.status
            : "";
        if (!status) continue;
        const columnKey = normalizeShortText(rawEntry?.columnKey, { max: 180 });
        const positionId = normalizeShortText(rawEntry?.positionId, {
          max: 160,
        });
        const positionLabel = normalizeShortText(rawEntry?.positionLabel, {
          max: 160,
        });
        const updatedAt = normalizeShortText(rawEntry?.updatedAt, { max: 80 });
        if (!attendance[occurrenceId]) attendance[occurrenceId] = {};
        attendance[occurrenceId][normalizedMemberId] = {
          status,
          ...(columnKey ? { columnKey } : {}),
          ...(positionId ? { positionId } : {}),
          ...(positionLabel ? { positionLabel } : {}),
          ...(updatedAt ? { updatedAt } : {}),
        };
      }
    }
    return attendance;
  };

  // Apply a single attendance change to a schedule's attendance map. Used by the
  // dedicated attendance endpoint so marking one person present/absent merges a
  // single cell instead of re-PUTting the whole schedule (which races with other
  // editors). Returns the next attendance object; throws on invalid input.
  const buildNextScheduleAttendance = ({
    schedule,
    team,
    occurrenceId,
    memberId,
    status,
    columnKey,
    positionId,
    positionLabel,
  }) => {
    const normalizedOccurrenceId = normalizeShortText(occurrenceId, {
      max: 180,
    });
    if (!normalizedOccurrenceId) {
      throw httpError(400, "Occurrence is required.");
    }
    const occurrenceIds = new Set(
      (schedule.occurrences || []).map((occurrence) => occurrence.occurrenceId),
    );
    if (!occurrenceIds.has(normalizedOccurrenceId)) {
      throw httpError(404, "Occurrence not found on this schedule.");
    }
    const normalizedMemberId = normalizeShortText(memberId, { max: 160 });
    if (!normalizedMemberId) {
      throw httpError(400, "Member is required.");
    }
    if (!(team.memberIds || []).includes(normalizedMemberId)) {
      throw httpError(400, "That member is not part of this team.");
    }
    const normalizedStatus =
      status === "present" || status === "absent" ? status : "";

    const attendance = { ...(schedule.attendance || {}) };
    const row = { ...(attendance[normalizedOccurrenceId] || {}) };
    if (normalizedStatus) {
      const normalizedColumnKey = normalizeShortText(columnKey, { max: 180 });
      const normalizedPositionId = normalizeShortText(positionId, { max: 160 });
      const normalizedPositionLabel = normalizeShortText(positionLabel, {
        max: 160,
      });
      row[normalizedMemberId] = {
        status: normalizedStatus,
        ...(normalizedColumnKey ? { columnKey: normalizedColumnKey } : {}),
        ...(normalizedPositionId ? { positionId: normalizedPositionId } : {}),
        ...(normalizedPositionLabel
          ? { positionLabel: normalizedPositionLabel }
          : {}),
        updatedAt: nowIso(),
      };
    } else {
      // An empty status clears the mark.
      delete row[normalizedMemberId];
    }
    if (Object.keys(row).length > 0) {
      attendance[normalizedOccurrenceId] = row;
    } else {
      delete attendance[normalizedOccurrenceId];
    }
    return attendance;
  };

  const validateTeamScheduleAttendanceUpdatePayload = (body) => {
    const occurrenceId = normalizeShortText(body?.occurrenceId, { max: 180 });
    if (!occurrenceId) {
      throw httpError(400, "Occurrence is required.");
    }
    const memberId = normalizeShortText(body?.memberId, { max: 160 });
    if (!memberId) {
      throw httpError(400, "Member is required.");
    }
    const status = normalizeShortText(body?.status, { max: 40 });
    if (status && status !== "present" && status !== "absent") {
      throw httpError(400, "Attendance status must be present or absent.");
    }
    return {
      occurrenceId,
      memberId,
      status,
      columnKey: normalizeShortText(body?.columnKey, { max: 180 }),
      positionId: normalizeShortText(body?.positionId, { max: 160 }),
      positionLabel: normalizeShortText(body?.positionLabel, { max: 160 }),
    };
  };

  const validateTeamSchedulePayload = async (body, churchId) => {
    const name = normalizeShortText(body?.name);
    if (!name) {
      throw httpError(400, "Schedule name is required.");
    }
    const team = await assertTeamEntityInChurch(
      "team",
      body?.teamId,
      churchId,
      {
        label: "Team",
      },
    );
    const serviceIds = normalizeIdArray(body?.serviceIds);
    if (serviceIds.length === 0) {
      throw httpError(400, "At least one service is required.");
    }
    const startDate = assertPlainDate(body?.startDate, "Schedule start date");
    const endDate = assertPlainDate(body?.endDate, "Schedule end date");
    if (startDate > endDate) {
      throw httpError(400, "Schedule end date must be after the start date.");
    }
    const occurrences = normalizeTeamScheduleOccurrences(
      body?.occurrences,
      serviceIds,
    );
    const occurrenceIds = occurrences.map(
      (occurrence) => occurrence.occurrenceId,
    );
    const assignments = {};
    const rawAssignments =
      body?.assignments && typeof body.assignments === "object"
        ? body.assignments
        : {};
    for (const occurrenceId of occurrenceIds) {
      const row = rawAssignments[occurrenceId];
      if (!row || typeof row !== "object") continue;
      // Sanitize each provided cell by its explicit slot key. Per-assignment position/member
      // validation happens on the dedicated assignment endpoint.
      for (const [cellKey, rawCell] of Object.entries(row)) {
        if (!parseScheduleSlotKey(cellKey)) continue;
        const cell = normalizeScheduleAssignmentCell(rawCell);
        const nextCell = serializeScheduleAssignmentCell(cell);
        if (nextCell) {
          if (!assignments[occurrenceId]) assignments[occurrenceId] = {};
          assignments[occurrenceId][cellKey] = nextCell;
        }
      }
    }
    const attendance = normalizeTeamScheduleAttendance({
      value: body?.attendance,
      occurrenceIds,
      teamMemberIds: team.memberIds || [],
    });
    return {
      name,
      description: normalizeLongText(body?.description),
      teamId: team.teamId,
      startDate,
      endDate,
      serviceIds,
      occurrences,
      assignments,
      attendance,
    };
  };

  const upsertTeamEntity = async ({
    kind,
    churchId,
    id,
    payload,
    adminUserId,
  }) => {
    const config = TEAM_ENTITY_CONFIG[kind];
    const now = nowIso();
    const nextId = id || createId(config.idPrefix);
    if (id) {
      await assertTeamEntityInChurch(kind, id, churchId, {
        active: false,
        label: kind,
      });
    }
    const doc = {
      ...payload,
      [config.idField]: nextId,
      churchId,
      archivedAt: null,
      updatedAt: now,
      updatedByUid: adminUserId,
      ...(id
        ? {}
        : {
            createdAt: now,
            createdByUid: adminUserId,
          }),
    };
    await setDoc(config.collection, nextId, doc, { merge: Boolean(id) });
    return {
      [config.idField]: nextId,
      ...(await getDoc(config.collection, nextId)),
    };
  };

  const archiveTeamEntity = async ({ kind, churchId, id, adminUserId }) => {
    const config = TEAM_ENTITY_CONFIG[kind];
    const entity = await assertTeamEntityInChurch(kind, id, churchId, {
      active: false,
      label: kind,
    });
    if (!entity.archivedAt) {
      await setDoc(
        config.collection,
        id,
        {
          archivedAt: nowIso(),
          archivedByUid: adminUserId,
          updatedAt: nowIso(),
          updatedByUid: adminUserId,
        },
        { merge: true },
      );
    }
  };

  // Keep references consistent after a permanent deletion:
  //  - team: delete its owned positions (each position cascade scrubs members/assignments),
  //          roles, and qualification areas;
  //          schedules that reference the team are intentionally left orphaned.
  //  - member: remove from team rosters + schedule assignments.
  //  - position: remove from members' positionIds + schedule assignments.
  //  - role/qualification metadata: remove only guidance labels, not scheduling history.
  const cascadeTeamEntityDeletion = async ({
    kind,
    churchId,
    id,
    adminUserId,
  }) => {
    const touch = { updatedAt: nowIso(), updatedByUid: adminUserId };

    if (kind === "team") {
      const [positions, roles, areas] = await Promise.all([
        listTeamCollectionForChurch(
          COLLECTIONS.teamPositions,
          "positionId",
          churchId,
        ),
        listTeamCollectionForChurch(COLLECTIONS.teamRoles, "roleId", churchId),
        listTeamCollectionForChurch(
          COLLECTIONS.teamQualificationAreas,
          "areaId",
          churchId,
        ),
      ]);
      await Promise.all([
        ...positions
          .filter((position) => position.teamId === id)
          .map((position) =>
            deleteTeamEntity({
              kind: "position",
              churchId,
              id: position.positionId,
              adminUserId,
            }),
          ),
        ...roles
          .filter((role) => role.teamId === id)
          .map((role) =>
            deleteTeamEntity({
              kind: "role",
              churchId,
              id: role.roleId,
              adminUserId,
            }),
          ),
        ...areas
          .filter((area) => area.teamId === id)
          .map((area) =>
            deleteTeamEntity({
              kind: "qualificationArea",
              churchId,
              id: area.areaId,
              adminUserId,
            }),
          ),
      ]);
      return;
    }

    if (kind === "qualificationArea") {
      const levels = await listTeamCollectionForChurch(
        COLLECTIONS.teamQualificationLevels,
        "levelId",
        churchId,
      );
      await Promise.all(
        levels
          .filter((level) => level.areaId === id)
          .map((level) =>
            deleteTeamEntity({
              kind: "qualificationLevel",
              churchId,
              id: level.levelId,
              adminUserId,
            }),
          ),
      );
    }

    if (
      kind !== "member" &&
      kind !== "position" &&
      kind !== "role" &&
      kind !== "qualificationArea" &&
      kind !== "qualificationLevel"
    )
      return;

    if (kind === "member") {
      const teams = await listTeamCollectionForChurch(
        COLLECTIONS.teams,
        "teamId",
        churchId,
      );
      await Promise.all(
        teams.map(async (team) => {
          const memberIds = team.memberIds || [];
          const nextMemberIds = memberIds.filter((mid) => mid !== id);
          if (nextMemberIds.length === memberIds.length) return;
          await setDoc(
            COLLECTIONS.teams,
            team.teamId,
            { memberIds: nextMemberIds, ...touch },
            { merge: true },
          );
        }),
      );
    }

    if (kind === "position") {
      const members = await listTeamCollectionForChurch(
        COLLECTIONS.teamRosterMembers,
        "memberId",
        churchId,
      );
      await Promise.all(
        members.map(async (member) => {
          const positionIds = member.positionIds || [];
          if (!positionIds.includes(id)) return;
          await setDoc(
            COLLECTIONS.teamRosterMembers,
            member.memberId,
            { positionIds: positionIds.filter((pid) => pid !== id), ...touch },
            { merge: true },
          );
        }),
      );
    }

    if (
      kind === "role" ||
      kind === "qualificationArea" ||
      kind === "qualificationLevel"
    ) {
      const members = await listTeamCollectionForChurch(
        COLLECTIONS.teamRosterMembers,
        "memberId",
        churchId,
      );
      await Promise.all(
        members.map(async (member) => {
          let changed = false;
          let nextTeamMemberships = member.teamMemberships || {};
          let nextQualifications = member.qualifications || [];

          if (kind === "role") {
            nextTeamMemberships = Object.fromEntries(
              Object.entries(nextTeamMemberships).map(
                ([teamId, membership]) => {
                  if (membership?.roleId !== id) return [teamId, membership];
                  changed = true;
                  const { roleId, ...rest } = membership;
                  return [teamId, rest];
                },
              ),
            );
          }

          if (kind === "qualificationArea") {
            const filtered = nextQualifications.filter(
              (qualification) => qualification?.areaId !== id,
            );
            changed = filtered.length !== nextQualifications.length;
            nextQualifications = filtered;
          }

          if (kind === "qualificationLevel") {
            nextQualifications = nextQualifications.map((qualification) => {
              if (qualification?.levelId !== id) return qualification;
              changed = true;
              const { levelId, ...rest } = qualification;
              return rest;
            });
          }

          if (!changed) return;
          await setDoc(
            COLLECTIONS.teamRosterMembers,
            member.memberId,
            {
              teamMemberships: nextTeamMemberships,
              qualifications: nextQualifications,
              ...touch,
            },
            { merge: true },
          );
        }),
      );
    }

    if (
      kind === "role" ||
      kind === "qualificationArea" ||
      kind === "qualificationLevel"
    )
      return;

    const schedules = await listTeamCollectionForChurch(
      COLLECTIONS.teamSchedules,
      "scheduleId",
      churchId,
    );
    await Promise.all(
      schedules.map(async (schedule) => {
        const assignments = schedule.assignments || {};
        const attendance = schedule.attendance || {};
        let changed = false;
        const nextAssignments = {};
        for (const [occurrenceId, row] of Object.entries(assignments)) {
          const nextRow = {};
          for (const [cellKey, cell] of Object.entries(row || {})) {
            // Scrub every slot of the deleted position (e.g. "camera::0" and "camera::1").
            const slot = parseScheduleSlotKey(cellKey);
            if (kind === "position" && slot?.positionId === id) {
              changed = true;
              continue;
            }
            if (kind === "member") {
              // Remove the deleted member from both the primary slot and any
              // shadow, and drop the cell only if nothing is left.
              const normalized = normalizeScheduleAssignmentCell(cell);
              const isPrimary = normalized.primaryMemberId === id;
              const isShadow = normalized.shadows.some(
                (shadow) => shadow.memberId === id,
              );
              if (isPrimary || isShadow) {
                changed = true;
                const nextCell = serializeScheduleAssignmentCell({
                  primaryMemberId: isPrimary ? "" : normalized.primaryMemberId,
                  shadows: normalized.shadows.filter(
                    (shadow) => shadow.memberId !== id,
                  ),
                });
                if (nextCell) {
                  nextRow[cellKey] = nextCell;
                }
                continue;
              }
            }
            nextRow[cellKey] = cell;
          }
          nextAssignments[occurrenceId] = nextRow;
        }
        const nextAttendance = {};
        for (const [occurrenceId, row] of Object.entries(attendance)) {
          const nextRow = { ...(row || {}) };
          if (
            kind === "member" &&
            Object.prototype.hasOwnProperty.call(nextRow, id)
          ) {
            delete nextRow[id];
            changed = true;
          }
          nextAttendance[occurrenceId] = nextRow;
        }
        if (!changed) return;
        await setDoc(
          COLLECTIONS.teamSchedules,
          schedule.scheduleId,
          {
            assignments: nextAssignments,
            attendance: nextAttendance,
            ...touch,
          },
          { merge: true },
        );
      }),
    );
  };

  const deleteTeamEntity = async ({ kind, churchId, id, adminUserId }) => {
    const config = TEAM_ENTITY_CONFIG[kind];
    // Enforce church ownership before permanently removing. Allow deleting
    // archived entities too, so `active: false`.
    await assertTeamEntityInChurch(kind, id, churchId, {
      active: false,
      label: kind,
    });
    await deleteDoc(config.collection, id);
    await cascadeTeamEntityDeletion({ kind, churchId, id, adminUserId });
  };

  const getConcreteTeamServiceDate = (service) => {
    const iso = service?.overrideDateTimeISO || service?.dateTimeISO || "";
    if (iso) return String(iso).slice(0, 10);
    return String(service?.date || "");
  };

  const isMemberUnavailableForService = (member, service) => {
    const serviceDate = getConcreteTeamServiceDate(service);
    if (!serviceDate) return false;
    return (member.blockoutDates || []).some((range) => {
      const start = String(range?.startDate || "");
      const end = String(range?.endDate || start);
      return start <= serviceDate && serviceDate <= end;
    });
  };

  const TEAM_SCHEDULE_SHADOW_KINDS = new Set(["shadow", "reverse_shadow"]);

  const normalizeScheduleAssignmentCell = (cell) => {
    if (!cell || typeof cell !== "object") {
      return { primaryMemberId: "", shadows: [] };
    }
    return {
      primaryMemberId: normalizeShortText(cell.primaryMemberId, { max: 160 }),
      shadows: (Array.isArray(cell.shadows) ? cell.shadows : [])
        .map((shadow) => ({
          memberId: normalizeShortText(shadow?.memberId, { max: 160 }),
          kind: shadow?.kind === "reverse_shadow" ? "reverse_shadow" : "shadow",
        }))
        .filter((shadow) => shadow.memberId),
    };
  };

  const serializeScheduleAssignmentCell = ({ primaryMemberId, shadows }) => {
    const normalizedPrimary = normalizeShortText(primaryMemberId, { max: 160 });
    const normalizedShadows = (Array.isArray(shadows) ? shadows : [])
      .map((shadow) => ({
        memberId: normalizeShortText(shadow?.memberId, { max: 160 }),
        kind: shadow?.kind === "reverse_shadow" ? "reverse_shadow" : "shadow",
      }))
      .filter((shadow) => shadow.memberId);
    if (normalizedShadows.length > 0) {
      return {
        ...(normalizedPrimary ? { primaryMemberId: normalizedPrimary } : {}),
        shadows: normalizedShadows,
      };
    }
    return normalizedPrimary ? { primaryMemberId: normalizedPrimary } : "";
  };

  const normalizePersonNameKey = (firstName, lastName) =>
    `${normalizeShortText(firstName, { max: 80 }).toLowerCase()} ${normalizeShortText(
      lastName,
      { max: 80 },
    ).toLowerCase()}`
      .trim()
      .replace(/\s+/g, " ");

  const normalizeIntakeAvailabilityServices = (value) =>
    (Array.isArray(value) ? value : [])
      .map((service) => {
        const serviceId = normalizeShortText(service?.serviceId, { max: 160 });
        if (!serviceId) return null;
        return {
          serviceId,
          name: normalizeShortText(service?.name) || "Service",
        };
      })
      .filter(Boolean);

  const normalizeIntakeAvailabilityOccurrences = (value) =>
    (Array.isArray(value) ? value : [])
      .map((occurrence) => {
        const occurrenceId = normalizeShortText(occurrence?.occurrenceId, {
          max: 260,
        });
        const serviceId = normalizeShortText(occurrence?.serviceId, {
          max: 160,
        });
        if (!occurrenceId || !serviceId) return null;
        return {
          occurrenceId,
          serviceId,
          name: normalizeShortText(occurrence?.name) || "Service",
          startsAt: assertTeamScheduleDateTime(
            occurrence?.startsAt,
            "Availability service date",
          ),
        };
      })
      .filter(Boolean);

  const validateTeamIntakeFormPayload = (body, existing = null) => {
    const name = normalizeShortText(body?.name ?? existing?.name);
    if (!name) {
      throw httpError(400, "Form name is required.");
    }
    const startDate = assertPlainDate(
      body?.startDate ?? existing?.startDate,
      "Form start date",
    );
    const endDate = assertPlainDate(
      body?.endDate ?? existing?.endDate,
      "Form end date",
    );
    if (startDate > endDate) {
      throw httpError(400, "Form end date must be after the start date.");
    }
    const availabilityServices =
      body?.availabilityServices !== undefined
        ? normalizeIntakeAvailabilityServices(body.availabilityServices)
        : existing?.availabilityServices || [];
    const availabilityOccurrences =
      body?.availabilityOccurrences !== undefined
        ? normalizeIntakeAvailabilityOccurrences(body.availabilityOccurrences)
        : existing?.availabilityOccurrences || [];
    // Teams this form scopes to. Empty means every team in the church. Existence
    // isn't enforced here: the public preview simply shows the positions of
    // whatever teams still exist, so a stale id is harmless and admin-only.
    const teamIds =
      body?.teamIds !== undefined
        ? normalizeIdArray(body.teamIds)
        : existing?.teamIds || [];
    // Optional public-form copy overrides. Empty means "use the built-in
    // default" on the public form, so we store "" rather than a placeholder.
    const normalizeMessage = (key) =>
      body?.[key] !== undefined
        ? normalizeLongText(body[key], { max: 500 })
        : existing?.[key] || "";
    return {
      name,
      startDate,
      endDate,
      availabilityServices,
      availabilityOccurrences,
      teamIds,
      active: Boolean(body?.active ?? existing?.active),
      welcomeMessage: normalizeMessage("welcomeMessage"),
      positionsMessage: normalizeMessage("positionsMessage"),
      availabilityMessage: normalizeMessage("availabilityMessage"),
      notesMessage: normalizeMessage("notesMessage"),
    };
  };

  const normalizeIntakeBlockoutRanges = (value, startDate, endDate) =>
    (Array.isArray(value) ? value : [])
      .map((range) => {
        const start = normalizeOptionalPlainDate(
          range?.startDate,
          "Blockout start date",
        );
        const end = normalizeOptionalPlainDate(
          range?.endDate,
          "Blockout end date",
        );
        if (!start && !end) return null;
        const normalizedStart = start || end;
        const normalizedEnd = end || start;
        if (normalizedStart > normalizedEnd) {
          throw httpError(
            400,
            "Blockout end date must be after the start date.",
          );
        }
        if (normalizedStart < startDate || normalizedEnd > endDate) {
          throw httpError(
            400,
            "Blockout dates must be inside the form period.",
          );
        }
        return { startDate: normalizedStart, endDate: normalizedEnd };
      })
      .filter(Boolean);

  const validateTeamIntakeSubmissionPayload = async (body, form) => {
    const firstName = normalizeShortText(body?.firstName, { max: 80 });
    const lastName = normalizeShortText(body?.lastName, { max: 80 });
    if (!firstName || !lastName) {
      throw httpError(400, "First and last name are required.");
    }
    // The public preview only offers positions from the form's scoped teams
    // (empty teamIds means every team). Enforce that same scope on submission so
    // a crafted POST cannot smuggle in positions from teams outside the form.
    const scopedTeamIds = new Set(form.teamIds || []);
    const positionIds = await assertTeamEntityIdsInChurch(
      "position",
      body?.positionIds,
      form.churchId,
      {
        label: "Position",
        assertEntity: (position) => {
          if (scopedTeamIds.size > 0 && !scopedTeamIds.has(position.teamId)) {
            throw httpError(
              400,
              "One or more selected positions are not available on this form.",
            );
          }
        },
      },
    );
    const occurrenceIds = new Set(
      (form.availabilityOccurrences || []).map(
        (occurrence) => occurrence.occurrenceId,
      ),
    );
    const occurrenceAvailability = {};
    const rawAvailability =
      body?.occurrenceAvailability &&
      typeof body.occurrenceAvailability === "object"
        ? body.occurrenceAvailability
        : {};
    Object.entries(rawAvailability).forEach(([occurrenceId, availability]) => {
      if (!occurrenceIds.has(occurrenceId)) return;
      occurrenceAvailability[occurrenceId] =
        availability === "unavailable" ? "unavailable" : "available";
    });
    return {
      firstName,
      lastName,
      normalizedName: normalizePersonNameKey(firstName, lastName),
      positionIds,
      occurrenceAvailability,
      blockoutRanges: normalizeIntakeBlockoutRanges(
        body?.blockoutRanges,
        form.startDate,
        form.endDate,
      ),
      notes: normalizeLongText(body?.notes, { max: 2000 }),
    };
  };

  const createTeamIntakePublicTokenNonce = () => randomSecret(16);

  const createTeamIntakeShortPublicToken = () =>
    crypto.randomBytes(9).toString("base64url");

  const ensureTeamIntakePublicLinkToken = async (
    formId,
    existing,
    adminUid,
  ) => {
    const storedToken = String(existing?.publicLinkToken || "").trim();
    if (storedToken) {
      return storedToken;
    }
    const publicLinkToken = createTeamIntakeShortPublicToken();
    await setDoc(
      COLLECTIONS.teamIntakeForms,
      formId,
      {
        publicLinkToken,
        publicTokenHash: hashValue(publicLinkToken),
        updatedAt: nowIso(),
        updatedByUid: adminUid,
      },
      { merge: true },
    );
    return publicLinkToken;
  };

  const signTeamIntakePublicToken = (formId, nonce) =>
    crypto
      .createHmac("sha256", teamIntakeTokenSecret)
      .update(`${formId}:${nonce}`)
      .digest("base64url");

  const createTeamIntakePublicToken = (formId, nonce) =>
    `${formId}.${nonce}.${signTeamIntakePublicToken(formId, nonce)}`;

  const isValidTeamIntakePublicToken = (formId, nonce, signature) => {
    const expected = signTeamIntakePublicToken(formId, nonce);
    const expectedBuffer = Buffer.from(expected);
    const signatureBuffer = Buffer.from(String(signature || ""));
    return (
      expectedBuffer.length === signatureBuffer.length &&
      crypto.timingSafeEqual(expectedBuffer, signatureBuffer)
    );
  };

  const getTeamIntakeFormByToken = async (token) => {
    if (!String(token || "").trim()) {
      throw httpError(404, "Form not found.");
    }
    const [formId, nonce, signature] = String(token).split(".");
    if (formId && nonce && signature) {
      const form = await getDoc(COLLECTIONS.teamIntakeForms, formId);
      if (
        form &&
        !form.archivedAt &&
        form.publicTokenNonce === nonce &&
        isValidTeamIntakePublicToken(formId, nonce, signature)
      ) {
        return { form: { formId, ...form }, publicTokenKey: hashValue(token) };
      }
    }

    const publicTokenHash = hashValue(String(token || ""));
    const [form] = await queryDocs(
      COLLECTIONS.teamIntakeForms,
      [{ field: "publicTokenHash", value: publicTokenHash }],
      { limit: 1 },
    );
    if (!form || form.archivedAt) {
      throw httpError(404, "Form not found.");
    }
    return {
      form: { formId: form.id, ...form },
      publicTokenKey: publicTokenHash,
    };
  };

  // --- Public (view-only) schedule links -------------------------------------
  // Mirrors the intake public-link pattern: a short token stored alongside its
  // hash, looked up by hash for the unauthenticated read endpoint.

  const createTeamScheduleShortPublicToken = () =>
    crypto.randomBytes(9).toString("base64url");

  const ensureTeamSchedulePublicLinkToken = async (
    scheduleId,
    existing,
    adminUid,
  ) => {
    const storedToken = String(existing?.publicLinkToken || "").trim();
    if (storedToken) {
      return storedToken;
    }
    const publicLinkToken = createTeamScheduleShortPublicToken();
    await setDoc(
      COLLECTIONS.teamSchedules,
      scheduleId,
      {
        publicLinkToken,
        publicTokenHash: hashValue(publicLinkToken),
        updatedAt: nowIso(),
        updatedByUid: adminUid,
      },
      { merge: true },
    );
    return publicLinkToken;
  };

  const getTeamScheduleByToken = async (token) => {
    const trimmed = String(token || "").trim();
    if (!trimmed) {
      throw httpError(404, "Schedule not found.");
    }
    const publicTokenHash = hashValue(trimmed);
    const [schedule] = await queryDocs(
      COLLECTIONS.teamSchedules,
      [{ field: "publicTokenHash", value: publicTokenHash }],
      { limit: 1 },
    );
    if (!schedule || schedule.archivedAt) {
      throw httpError(404, "Schedule not found.");
    }
    return {
      schedule: { scheduleId: schedule.id, ...schedule },
      publicTokenKey: publicTokenHash,
    };
  };

  // First name, plus a last initial only when first names collide. Keeps full
  // last names and contact details from ever leaving the server on a public link.
  const scheduleMemberPublicName = (member, duplicateFirstNames) => {
    const firstName = String(member?.firstName || "").trim();
    const lastInitial = String(member?.lastName || "")
      .trim()
      .charAt(0);
    // Never let a full last name leave the server: fall back to an initial only.
    if (!firstName) {
      return lastInitial ? `${lastInitial}.` : "Member";
    }
    if (duplicateFirstNames.has(firstName.toLowerCase()) && lastInitial) {
      return `${firstName} ${lastInitial}.`;
    }
    return firstName;
  };

  const buildPublicTeamScheduleSnapshot = async (schedule) => {
    const churchId = schedule.churchId;
    const assignedMemberIds = new Set();
    Object.values(schedule.assignments || {}).forEach((row) => {
      Object.values(row || {}).forEach((cell) => {
        getScheduleAssignmentCellMemberIds(cell).forEach((memberId) =>
          assignedMemberIds.add(memberId),
        );
      });
    });
    const church = await getDoc(COLLECTIONS.churches, churchId);
    const team = schedule.teamId
      ? await getTeamEntity("team", schedule.teamId)
      : null;
    const [positions, members, churchLogoUrl] = await Promise.all([
      team && team.churchId === churchId
        ? queryDocs(
            COLLECTIONS.teamPositions,
            [
              { field: "churchId", value: churchId },
              { field: "teamId", value: schedule.teamId },
            ],
            { limit: TEAM_COLLECTION_QUERY_LIMIT },
          )
        : [],
      Promise.all(
        [...assignedMemberIds].map((memberId) =>
          getTeamEntity("member", memberId),
        ),
      ),
      readChurchPublicBoardHeaderLogoUrl(churchId),
    ]);

    const assignedMembers = members.filter(
      (member) => member && member.churchId === churchId,
    );
    const referencedPositions = positions.filter(
      (position) =>
        position &&
        position.churchId === churchId &&
        position.teamId === schedule.teamId,
    );

    const firstNameCounts = new Map();
    assignedMembers.forEach((member) => {
      const firstName = String(member.firstName || "")
        .trim()
        .toLowerCase();
      if (!firstName) return;
      firstNameCounts.set(firstName, (firstNameCounts.get(firstName) || 0) + 1);
    });
    const duplicateFirstNames = new Set(
      [...firstNameCounts.entries()]
        .filter(([, count]) => count > 1)
        .map(([name]) => name),
    );

    return {
      churchName: church?.name || "WorshipSync",
      teamName:
        team && team.churchId === churchId
          ? String(team.name || "").trim()
          : "",
      ...(churchLogoUrl ? { churchLogoUrl } : {}),
      schedule: {
        scheduleId: schedule.scheduleId,
        name: schedule.name || "",
        teamId: schedule.teamId || "",
        startDate: schedule.startDate || "",
        endDate: schedule.endDate || "",
        occurrences: schedule.occurrences || [],
        assignments: schedule.assignments || {},
      },
      positions: sortPositionsByOrder(referencedPositions).map((position) => ({
        positionId: position.positionId,
        name: position.name,
        groupId: position.groupId || "",
        archivedAt: position.archivedAt || null,
      })),
      members: assignedMembers.map((member) => ({
        memberId: member.memberId,
        name: scheduleMemberPublicName(member, duplicateFirstNames),
      })),
    };
  };

  const assertTeamIntakeFormIsOpen = (form) => {
    if (!form.active) {
      throw httpError(400, "This form is closed.");
    }
  };

  const getScheduleAssignmentCellMemberIds = (cell) => {
    const normalized = normalizeScheduleAssignmentCell(cell);
    return [
      normalized.primaryMemberId,
      ...normalized.shadows.map((shadow) => shadow.memberId),
    ].filter(Boolean);
  };

  // Schedule assignments are keyed by a "slot key" so one position can be filled
  // multiple times per service. Every slot is explicit: `${positionId}::${slot}`.
  // Mirrors the client helpers in
  // client/src/pages/Teams/schedule/scheduleRequirements.ts.
  const SCHEDULE_SLOT_KEY_SEPARATOR = "::";

  const makeScheduleSlotKey = (positionId, slot) =>
    `${positionId}${SCHEDULE_SLOT_KEY_SEPARATOR}${slot}`;

  const CROSS_TEAM_SCHEDULE_CONFLICT_MESSAGE =
    "This person is already scheduled on another team for this service. Confirm to schedule them anyway.";

  const normalizeAllowCrossTeamConflict = (value) => value === true;

  const parseScheduleSlotKey = (value) => {
    const raw = String(value || "");
    const idx = raw.lastIndexOf(SCHEDULE_SLOT_KEY_SEPARATOR);
    if (idx === -1) return null;
    const base = raw.slice(0, idx);
    const slot = Number.parseInt(
      raw.slice(idx + SCHEDULE_SLOT_KEY_SEPARATOR.length),
      10,
    );
    if (!base || !Number.isInteger(slot) || slot < 0) {
      return null;
    }
    return { positionId: base, slot };
  };

  const getScheduleOccurrenceServiceIds = (occurrence) =>
    new Set(
      [occurrence?.serviceId, ...(occurrence?.serviceIds || [])]
        .map((id) => String(id || "").trim())
        .filter(Boolean),
    );

  const getScheduleOccurrencesForConflict = (schedule) =>
    schedule?.occurrences?.length
      ? schedule.occurrences
      : (schedule?.serviceIds || []).map((serviceId) => ({
          occurrenceId: serviceId,
          serviceId,
          startsAt: "",
        }));

  const scheduleDateRangesOverlap = (a, b) => {
    const aStart = a?.startDate || a?.endDate || "";
    const aEnd = a?.endDate || a?.startDate || "";
    const bStart = b?.startDate || b?.endDate || "";
    const bEnd = b?.endDate || b?.startDate || "";
    if (!aStart || !aEnd || !bStart || !bEnd) return true;
    return aStart <= bEnd && aEnd >= bStart;
  };

  // Prefer shared occurrence identity / start time. When either side lacks
  // startsAt (legacy schedules), match on shared service ids only if the parent
  // schedules' date ranges overlap — so unrelated months do not false-positive.
  const scheduleOccurrencesConflict = (current, other, options = {}) => {
    if (!current || !other) return false;
    if (
      current.occurrenceId &&
      other.occurrenceId &&
      current.occurrenceId === other.occurrenceId &&
      current.startsAt &&
      other.startsAt
    ) {
      return true;
    }
    if (current.startsAt && other.startsAt) {
      if (current.startsAt !== other.startsAt) return false;
      const currentServiceIds = getScheduleOccurrenceServiceIds(current);
      const otherServiceIds = getScheduleOccurrenceServiceIds(other);
      return [...currentServiceIds].some((serviceId) =>
        otherServiceIds.has(serviceId),
      );
    }
    if (!options.schedulesOverlap) return false;
    const currentServiceIds = getScheduleOccurrenceServiceIds(current);
    const otherServiceIds = getScheduleOccurrenceServiceIds(other);
    return [...currentServiceIds].some((serviceId) =>
      otherServiceIds.has(serviceId),
    );
  };

  const findCrossTeamScheduleAssignmentConflicts = ({
    schedule,
    assignments,
    schedules,
    memberIds,
  }) => {
    const memberIdSet = memberIds?.size
      ? memberIds
      : new Set(
          Object.values(assignments || {}).flatMap((row) =>
            Object.values(row || {}).flatMap(
              getScheduleAssignmentCellMemberIds,
            ),
          ),
        );
    if (memberIdSet.size === 0) return [];

    const occurrences = getScheduleOccurrencesForConflict(schedule);
    const conflicts = [];
    for (const currentOccurrence of occurrences) {
      const row = assignments?.[currentOccurrence.occurrenceId] || {};
      const rowMemberIds = new Set(
        Object.values(row).flatMap(getScheduleAssignmentCellMemberIds),
      );
      const targetMemberIds = [...rowMemberIds].filter((memberId) =>
        memberIdSet.has(memberId),
      );
      if (targetMemberIds.length === 0) continue;

      for (const otherSchedule of schedules || []) {
        if (!otherSchedule || otherSchedule.archivedAt) continue;
        if (otherSchedule.scheduleId === schedule.scheduleId) continue;
        if (otherSchedule.teamId === schedule.teamId) continue;
        const otherOccurrence = getScheduleOccurrencesForConflict(
          otherSchedule,
        ).find((candidate) =>
          scheduleOccurrencesConflict(currentOccurrence, candidate, {
            schedulesOverlap: scheduleDateRangesOverlap(
              schedule,
              otherSchedule,
            ),
          }),
        );
        if (!otherOccurrence) continue;
        const otherRow =
          otherSchedule.assignments?.[otherOccurrence.occurrenceId] || {};
        const otherMemberIds = new Set(
          Object.values(otherRow).flatMap(getScheduleAssignmentCellMemberIds),
        );
        targetMemberIds.forEach((memberId) => {
          if (otherMemberIds.has(memberId)) {
            conflicts.push({
              memberId,
              scheduleId: otherSchedule.scheduleId,
              teamId: otherSchedule.teamId,
              occurrenceId: currentOccurrence.occurrenceId,
            });
          }
        });
      }
    }
    return conflicts;
  };

  const assertNoCrossTeamScheduleAssignmentConflicts = ({
    schedule,
    assignments,
    schedules,
    memberIds,
    allowCrossTeamConflict,
  }) => {
    if (allowCrossTeamConflict) return;
    const conflicts = findCrossTeamScheduleAssignmentConflicts({
      schedule,
      assignments,
      schedules,
      memberIds,
    });
    if (conflicts.length > 0) {
      throw httpError(409, CROSS_TEAM_SCHEDULE_CONFLICT_MESSAGE);
    }
  };

  const buildValidatedScheduleAssignments = ({
    churchId,
    schedule,
    team,
    position,
    member,
    serviceId,
    positionSlotKey,
    memberId,
    serviceDate,
    sourceServiceId,
    sourcePositionSlotKey,
    shadowAction,
    shadowKind,
  }) => {
    const rowIds = (schedule.occurrences || []).map(
      (occurrence) => occurrence.occurrenceId,
    );
    const allowedRowIds =
      rowIds.length > 0 ? rowIds : schedule.serviceIds || [];
    if (!allowedRowIds.includes(serviceId)) {
      throw httpError(400, "That service occurrence is not in this schedule.");
    }
    const targetSlot = parseScheduleSlotKey(positionSlotKey);
    if (!targetSlot) {
      throw httpError(400, "Position slot key is invalid.");
    }
    const basePositionId = targetSlot.positionId;
    const cellKey = makeScheduleSlotKey(basePositionId, targetSlot.slot);
    if (!position || position.churchId !== churchId || position.archivedAt) {
      throw httpError(400, "Position is archived.");
    }
    if (position.teamId !== team.teamId) {
      throw httpError(400, "That position is not part of this team.");
    }

    const assignments = JSON.parse(JSON.stringify(schedule.assignments || {}));
    const normalizedSourceServiceId = String(sourceServiceId || "").trim();
    const sourceSlot = parseScheduleSlotKey(sourcePositionSlotKey);
    const normalizedSourcePositionSlotKey =
      String(sourcePositionSlotKey || "").trim() && sourceSlot
        ? makeScheduleSlotKey(sourceSlot.positionId, sourceSlot.slot)
        : "";
    if (
      normalizedSourceServiceId &&
      normalizedSourcePositionSlotKey &&
      assignments[normalizedSourceServiceId]
    ) {
      const sourceCell = normalizeScheduleAssignmentCell(
        assignments[normalizedSourceServiceId][normalizedSourcePositionSlotKey],
      );
      const nextSourceCell = serializeScheduleAssignmentCell({
        primaryMemberId: "",
        shadows: sourceCell.shadows,
      });
      if (nextSourceCell) {
        assignments[normalizedSourceServiceId][
          normalizedSourcePositionSlotKey
        ] = nextSourceCell;
      } else {
        delete assignments[normalizedSourceServiceId][
          normalizedSourcePositionSlotKey
        ];
      }
      if (Object.keys(assignments[normalizedSourceServiceId]).length === 0) {
        delete assignments[normalizedSourceServiceId];
      }
    }

    const normalizedMemberId = String(memberId || "").trim();
    const normalizedShadowAction = String(shadowAction || "").trim();
    const normalizedShadowKind = String(shadowKind || "").trim();
    const isShadowUpdate =
      normalizedShadowAction === "add" || normalizedShadowAction === "remove";
    if (isShadowUpdate) {
      if (!normalizedMemberId) {
        throw httpError(400, "Member is required.");
      }
      if (!TEAM_SCHEDULE_SHADOW_KINDS.has(normalizedShadowKind)) {
        throw httpError(400, "Shadow type is required.");
      }

      const targetRow = { ...(assignments[serviceId] || {}) };
      const targetCell = normalizeScheduleAssignmentCell(targetRow[cellKey]);

      if (normalizedShadowAction === "add") {
        if (!member || member.churchId !== churchId || member.archivedAt) {
          throw httpError(400, "Member is archived.");
        }
        if (!(team.memberIds || []).includes(normalizedMemberId)) {
          throw httpError(400, "That member is not part of this team.");
        }
        if (
          normalizedShadowKind === "reverse_shadow" &&
          !(member.positionIds || []).includes(basePositionId)
        ) {
          throw httpError(400, "That member cannot serve in this position.");
        }
        if (
          isMemberUnavailableForService(member, { date: serviceDate || "" })
        ) {
          throw httpError(400, "That member is unavailable for this service.");
        }
        // Note: intake service availability ("didn't pick this service") is a
        // soft scheduling warning surfaced in the picker, not a hard block — only
        // blockout dates make a member truly unavailable.

        const serviceAssignments = assignments[serviceId] || {};
        const assignedElsewhere = Object.values(serviceAssignments).some(
          (cell) =>
            getScheduleAssignmentCellMemberIds(cell).includes(
              normalizedMemberId,
            ),
        );
        if (assignedElsewhere) {
          throw httpError(
            400,
            "Members can only serve one position per service.",
          );
        }
      }

      const nextShadows =
        normalizedShadowAction === "add"
          ? [
              ...targetCell.shadows.filter(
                (shadow) => shadow.memberId !== normalizedMemberId,
              ),
              { memberId: normalizedMemberId, kind: normalizedShadowKind },
            ]
          : targetCell.shadows.filter(
              (shadow) =>
                !(
                  shadow.memberId === normalizedMemberId &&
                  shadow.kind === normalizedShadowKind
                ),
            );
      const nextTargetCell = serializeScheduleAssignmentCell({
        primaryMemberId: targetCell.primaryMemberId,
        shadows: nextShadows,
      });
      if (nextTargetCell) {
        targetRow[cellKey] = nextTargetCell;
      } else {
        delete targetRow[cellKey];
      }
      if (Object.keys(targetRow).length > 0) {
        assignments[serviceId] = targetRow;
      } else {
        delete assignments[serviceId];
      }
      return assignments;
    }

    if (!normalizedMemberId) {
      if (assignments[serviceId]) {
        const targetCell = normalizeScheduleAssignmentCell(
          assignments[serviceId][cellKey],
        );
        const nextTargetCell = serializeScheduleAssignmentCell({
          primaryMemberId: "",
          shadows: targetCell.shadows,
        });
        if (nextTargetCell) {
          assignments[serviceId][cellKey] = nextTargetCell;
        } else {
          delete assignments[serviceId][cellKey];
        }
        if (Object.keys(assignments[serviceId]).length === 0) {
          delete assignments[serviceId];
        }
      }
      return assignments;
    }

    if (!member || member.churchId !== churchId || member.archivedAt) {
      throw httpError(400, "Member is archived.");
    }
    if (!(team.memberIds || []).includes(normalizedMemberId)) {
      throw httpError(400, "That member is not part of this team.");
    }
    if (!(member.positionIds || []).includes(basePositionId)) {
      throw httpError(400, "That member cannot serve in this position.");
    }
    if (isMemberUnavailableForService(member, { date: serviceDate || "" })) {
      throw httpError(400, "That member is unavailable for this service.");
    }
    // Intake service availability is a soft warning only (surfaced in the
    // picker); only blockout dates hard-block assignment here.

    const serviceAssignments = assignments[serviceId] || {};
    const assignedElsewhere = Object.entries(serviceAssignments).some(
      ([assignedPositionSlotKey, cell]) => {
        const normalizedCell = normalizeScheduleAssignmentCell(cell);
        if (assignedPositionSlotKey === cellKey) {
          return normalizedCell.shadows.some(
            (shadow) => shadow.memberId === normalizedMemberId,
          );
        }
        return getScheduleAssignmentCellMemberIds(cell).includes(
          normalizedMemberId,
        );
      },
    );
    if (assignedElsewhere) {
      throw httpError(400, "Members can only serve one position per service.");
    }

    const targetCell = normalizeScheduleAssignmentCell(
      serviceAssignments[cellKey],
    );
    const nextTargetCell = serializeScheduleAssignmentCell({
      primaryMemberId: normalizedMemberId,
      shadows: targetCell.shadows,
    });
    assignments[serviceId] = {
      ...serviceAssignments,
      [cellKey]: nextTargetCell,
    };
    return assignments;
  };

  const assertScheduleRowContains = (schedule, serviceId) => {
    const rowIds = (schedule.occurrences || []).map(
      (occurrence) => occurrence.occurrenceId,
    );
    const allowedRowIds =
      rowIds.length > 0 ? rowIds : schedule.serviceIds || [];
    if (!allowedRowIds.includes(serviceId)) {
      throw httpError(400, "That service occurrence is not in this schedule.");
    }
  };

  const assertSchedulePositionForTeam = ({
    churchId,
    team,
    position,
    label = "Position",
  }) => {
    if (!position || position.churchId !== churchId || position.archivedAt) {
      throw httpError(400, `${label} is archived.`);
    }
    if (position.teamId !== team.teamId) {
      throw httpError(400, "That position is not part of this team.");
    }
  };

  const assertScheduleMemberForPosition = ({
    churchId,
    team,
    member,
    memberId,
    positionId,
    serviceDate,
  }) => {
    if (!member || member.churchId !== churchId || member.archivedAt) {
      throw httpError(400, "Member is archived.");
    }
    if (!(team.memberIds || []).includes(memberId)) {
      throw httpError(400, "That member is not part of this team.");
    }
    if (!(member.positionIds || []).includes(positionId)) {
      throw httpError(400, "That member cannot serve in this position.");
    }
    if (isMemberUnavailableForService(member, { date: serviceDate || "" })) {
      throw httpError(400, "That member is unavailable for this service.");
    }
  };

  const assertNoDuplicateScheduleMembersForService = (row) => {
    const seen = new Set();
    for (const cell of Object.values(row || {})) {
      for (const memberId of getScheduleAssignmentCellMemberIds(cell)) {
        if (seen.has(memberId)) {
          throw httpError(
            400,
            "Members can only serve one position per service.",
          );
        }
        seen.add(memberId);
      }
    }
  };

  const buildValidatedScheduleAssignmentSwap = ({
    churchId,
    schedule,
    team,
    serviceId,
    targetPositionSlotKey,
    sourcePositionSlotKey,
    currentMember,
    currentMemberId,
    candidateMember,
    candidateMemberId,
    targetPosition,
    sourcePosition,
    serviceDate,
  }) => {
    assertScheduleRowContains(schedule, serviceId);
    const targetSlot = parseScheduleSlotKey(targetPositionSlotKey);
    const sourceSlot = parseScheduleSlotKey(sourcePositionSlotKey);
    if (!targetSlot || !sourceSlot) {
      throw httpError(400, "Position slot key is invalid.");
    }
    const normalizedTargetSlotKey = makeScheduleSlotKey(
      targetSlot.positionId,
      targetSlot.slot,
    );
    const normalizedSourceSlotKey = makeScheduleSlotKey(
      sourceSlot.positionId,
      sourceSlot.slot,
    );
    if (normalizedTargetSlotKey === normalizedSourceSlotKey) {
      throw httpError(400, "Choose two different schedule slots.");
    }

    const normalizedCurrentMemberId = normalizeShortText(currentMemberId, {
      max: 160,
    });
    const normalizedCandidateMemberId = normalizeShortText(candidateMemberId, {
      max: 160,
    });
    if (!normalizedCurrentMemberId || !normalizedCandidateMemberId) {
      throw httpError(400, "Both members are required for this swap.");
    }

    assertSchedulePositionForTeam({
      churchId,
      team,
      position: targetPosition,
      label: "Target position",
    });
    assertSchedulePositionForTeam({
      churchId,
      team,
      position: sourcePosition,
      label: "Source position",
    });
    assertScheduleMemberForPosition({
      churchId,
      team,
      member: candidateMember,
      memberId: normalizedCandidateMemberId,
      positionId: targetSlot.positionId,
      serviceDate,
    });
    assertScheduleMemberForPosition({
      churchId,
      team,
      member: currentMember,
      memberId: normalizedCurrentMemberId,
      positionId: sourceSlot.positionId,
      serviceDate,
    });

    const assignments = JSON.parse(JSON.stringify(schedule.assignments || {}));
    const row = { ...(assignments[serviceId] || {}) };
    const targetCell = normalizeScheduleAssignmentCell(
      row[normalizedTargetSlotKey],
    );
    const sourceCell = normalizeScheduleAssignmentCell(
      row[normalizedSourceSlotKey],
    );
    if (
      targetCell.primaryMemberId !== normalizedCurrentMemberId ||
      sourceCell.primaryMemberId !== normalizedCandidateMemberId
    ) {
      throw httpError(
        409,
        "This swap is no longer available. Refresh the schedule and try again.",
      );
    }

    row[normalizedTargetSlotKey] = serializeScheduleAssignmentCell({
      primaryMemberId: normalizedCandidateMemberId,
      shadows: targetCell.shadows,
    });
    row[normalizedSourceSlotKey] = serializeScheduleAssignmentCell({
      primaryMemberId: normalizedCurrentMemberId,
      shadows: sourceCell.shadows,
    });
    assertNoDuplicateScheduleMembersForService(row);
    assignments[serviceId] = row;
    return assignments;
  };

  const validateScheduleAssignment = async ({
    churchId,
    scheduleId,
    serviceId,
    positionSlotKey,
    memberId,
    serviceDate,
    sourceServiceId,
    sourcePositionSlotKey,
    shadowAction,
    shadowKind,
    allowCrossTeamConflict,
  }) => {
    const schedule = await assertTeamEntityInChurch(
      "schedule",
      scheduleId,
      churchId,
      { label: "Schedule" },
    );
    const team = await assertTeamEntityInChurch(
      "team",
      schedule.teamId,
      churchId,
      {
        label: "Team",
      },
    );
    const slot = parseScheduleSlotKey(positionSlotKey);
    if (!slot) {
      throw httpError(400, "Position slot key is invalid.");
    }
    const position = await assertTeamEntityInChurch(
      "position",
      slot.positionId,
      churchId,
      { label: "Position" },
    );
    const normalizedMemberId = String(memberId || "").trim();
    const member =
      normalizedMemberId && shadowAction !== "remove"
        ? await assertTeamEntityInChurch(
            "member",
            normalizedMemberId,
            churchId,
            {
              label: "Member",
            },
          )
        : null;
    const assignments = buildValidatedScheduleAssignments({
      churchId,
      schedule,
      team,
      position,
      member,
      serviceId,
      positionSlotKey,
      memberId,
      serviceDate,
      sourceServiceId,
      sourcePositionSlotKey,
      shadowAction,
      shadowKind,
    });
    if (normalizedMemberId && shadowAction !== "remove") {
      const schedules = await listTeamCollectionForChurch(
        COLLECTIONS.teamSchedules,
        "scheduleId",
        churchId,
      );
      assertNoCrossTeamScheduleAssignmentConflicts({
        schedule,
        assignments,
        schedules,
        memberIds: new Set([normalizedMemberId]),
        allowCrossTeamConflict,
      });
    }
    return assignments;
  };

  const listTransactionSchedulesForChurch = async (
    transaction,
    db,
    churchId,
  ) => {
    const snapshot = await transaction.get(
      db
        .collection(COLLECTIONS.teamSchedules)
        .where("churchId", "==", churchId)
        .limit(TEAM_COLLECTION_QUERY_LIMIT),
    );
    if (snapshot.docs.length >= TEAM_COLLECTION_QUERY_LIMIT) {
      console.warn(
        `Teams: ${COLLECTIONS.teamSchedules} returned the ${TEAM_COLLECTION_QUERY_LIMIT}-row query cap for church ${churchId}; conflict checks may be truncated.`,
      );
    }
    return snapshot.docs.map((doc) => ({
      scheduleId: doc.id,
      ...doc.data(),
    }));
  };

  const readTransactionTeamEntity = (
    snapshot,
    idField,
    label,
    { active = true } = {},
  ) => {
    if (!snapshot.exists) {
      throw httpError(404, `${label} not found.`);
    }
    const entity = { [idField]: snapshot.id, ...snapshot.data() };
    if (active && entity.archivedAt) {
      throw httpError(400, `${label} is archived.`);
    }
    return entity;
  };

  const updateTeamScheduleAssignmentInStore = async ({
    churchId,
    scheduleId,
    serviceId,
    positionSlotKey,
    memberId,
    serviceDate,
    sourceServiceId,
    sourcePositionSlotKey,
    shadowAction,
    shadowKind,
    allowCrossTeamConflict,
    adminUserId,
  }) => {
    const db = requireFirestore();
    if (!db) {
      const assignments = await validateScheduleAssignment({
        churchId,
        scheduleId,
        serviceId,
        positionSlotKey,
        memberId,
        serviceDate,
        sourceServiceId,
        sourcePositionSlotKey,
        shadowAction,
        shadowKind,
        allowCrossTeamConflict,
      });
      await setDoc(
        COLLECTIONS.teamSchedules,
        scheduleId,
        {
          assignments,
          updatedAt: nowIso(),
          updatedByUid: adminUserId,
        },
        { merge: true },
      );
      return getTeamEntity("schedule", scheduleId);
    }

    return db.runTransaction(async (transaction) => {
      const scheduleRef = db
        .collection(COLLECTIONS.teamSchedules)
        .doc(scheduleId);
      const scheduleSnap = await transaction.get(scheduleRef);
      const schedule = readTransactionTeamEntity(
        scheduleSnap,
        "scheduleId",
        "Schedule",
      );
      if (schedule.churchId !== churchId) {
        throw httpError(404, "Schedule not found.");
      }

      const teamSnap = await transaction.get(
        db.collection(COLLECTIONS.teams).doc(schedule.teamId),
      );
      const team = readTransactionTeamEntity(teamSnap, "teamId", "Team");
      if (team.churchId !== churchId) {
        throw httpError(404, "Team not found.");
      }

      const targetSlot = parseScheduleSlotKey(positionSlotKey);
      if (!targetSlot) {
        throw httpError(400, "Position slot key is invalid.");
      }
      const positionSnap = await transaction.get(
        db.collection(COLLECTIONS.teamPositions).doc(targetSlot.positionId),
      );
      const position = readTransactionTeamEntity(
        positionSnap,
        "positionId",
        "Position",
      );
      if (position.churchId !== churchId) {
        throw httpError(404, "Position not found.");
      }

      const normalizedMemberId = String(memberId || "").trim();
      let member = null;
      if (normalizedMemberId && shadowAction !== "remove") {
        const memberSnap = await transaction.get(
          db.collection(COLLECTIONS.teamRosterMembers).doc(normalizedMemberId),
        );
        member = readTransactionTeamEntity(memberSnap, "memberId", "Member");
        if (member.churchId !== churchId) {
          throw httpError(404, "Member not found.");
        }
      }

      const assignments = buildValidatedScheduleAssignments({
        churchId,
        schedule,
        team,
        position,
        member,
        serviceId,
        positionSlotKey,
        memberId,
        serviceDate,
        sourceServiceId,
        sourcePositionSlotKey,
        shadowAction,
        shadowKind,
      });
      if (normalizedMemberId && shadowAction !== "remove") {
        const schedules = await listTransactionSchedulesForChurch(
          transaction,
          db,
          churchId,
        );
        assertNoCrossTeamScheduleAssignmentConflicts({
          schedule,
          assignments,
          schedules,
          memberIds: new Set([normalizedMemberId]),
          allowCrossTeamConflict,
        });
      }
      const update = {
        assignments,
        updatedAt: nowIso(),
        updatedByUid: adminUserId,
      };
      // Use update (not set with merge) so the assignments map is replaced
      // wholesale. A merged set deep-merges nested maps, which would keep
      // cleared/moved cell keys we deleted and resurrect old assignments.
      transaction.update(scheduleRef, update);
      return { ...schedule, ...update };
    });
  };

  const updateTeamScheduleAssignmentSwapInStore = async ({
    churchId,
    scheduleId,
    serviceId,
    targetPositionSlotKey,
    sourcePositionSlotKey,
    currentMemberId,
    candidateMemberId,
    serviceDate,
    allowCrossTeamConflict,
    adminUserId,
  }) => {
    const normalizedCurrentMemberId = normalizeShortText(currentMemberId, {
      max: 160,
    });
    const normalizedCandidateMemberId = normalizeShortText(candidateMemberId, {
      max: 160,
    });
    if (!normalizedCurrentMemberId || !normalizedCandidateMemberId) {
      throw httpError(400, "Both members are required for this swap.");
    }

    const db = requireFirestore();
    if (!db) {
      const schedule = await assertTeamEntityInChurch(
        "schedule",
        scheduleId,
        churchId,
        { label: "Schedule" },
      );
      const team = await assertTeamEntityInChurch(
        "team",
        schedule.teamId,
        churchId,
        { label: "Team" },
      );
      const targetSlot = parseScheduleSlotKey(targetPositionSlotKey);
      const sourceSlot = parseScheduleSlotKey(sourcePositionSlotKey);
      if (!targetSlot || !sourceSlot) {
        throw httpError(400, "Position slot key is invalid.");
      }
      const [targetPosition, sourcePosition, currentMember, candidateMember] =
        await Promise.all([
          assertTeamEntityInChurch(
            "position",
            targetSlot.positionId,
            churchId,
            {
              label: "Target position",
            },
          ),
          assertTeamEntityInChurch(
            "position",
            sourceSlot.positionId,
            churchId,
            {
              label: "Source position",
            },
          ),
          assertTeamEntityInChurch(
            "member",
            normalizedCurrentMemberId,
            churchId,
            {
              label: "Current member",
            },
          ),
          assertTeamEntityInChurch(
            "member",
            normalizedCandidateMemberId,
            churchId,
            {
              label: "Candidate member",
            },
          ),
        ]);
      const assignments = buildValidatedScheduleAssignmentSwap({
        churchId,
        schedule,
        team,
        serviceId,
        targetPositionSlotKey,
        sourcePositionSlotKey,
        currentMember,
        currentMemberId: normalizedCurrentMemberId,
        candidateMember,
        candidateMemberId: normalizedCandidateMemberId,
        targetPosition,
        sourcePosition,
        serviceDate,
      });
      const schedules = await listTeamCollectionForChurch(
        COLLECTIONS.teamSchedules,
        "scheduleId",
        churchId,
      );
      assertNoCrossTeamScheduleAssignmentConflicts({
        schedule,
        assignments,
        schedules,
        memberIds: new Set([
          normalizedCurrentMemberId,
          normalizedCandidateMemberId,
        ]),
        allowCrossTeamConflict,
      });
      await setDoc(
        COLLECTIONS.teamSchedules,
        scheduleId,
        {
          assignments,
          updatedAt: nowIso(),
          updatedByUid: adminUserId,
        },
        { merge: true },
      );
      return getTeamEntity("schedule", scheduleId);
    }

    return db.runTransaction(async (transaction) => {
      const scheduleRef = db
        .collection(COLLECTIONS.teamSchedules)
        .doc(scheduleId);
      const scheduleSnap = await transaction.get(scheduleRef);
      const schedule = readTransactionTeamEntity(
        scheduleSnap,
        "scheduleId",
        "Schedule",
      );
      if (schedule.churchId !== churchId) {
        throw httpError(404, "Schedule not found.");
      }

      const teamSnap = await transaction.get(
        db.collection(COLLECTIONS.teams).doc(schedule.teamId),
      );
      const team = readTransactionTeamEntity(teamSnap, "teamId", "Team");
      if (team.churchId !== churchId) {
        throw httpError(404, "Team not found.");
      }

      const targetSlot = parseScheduleSlotKey(targetPositionSlotKey);
      const sourceSlot = parseScheduleSlotKey(sourcePositionSlotKey);
      if (!targetSlot || !sourceSlot) {
        throw httpError(400, "Position slot key is invalid.");
      }
      const [
        targetPositionSnap,
        sourcePositionSnap,
        currentMemberSnap,
        candidateMemberSnap,
      ] = await Promise.all([
        transaction.get(
          db.collection(COLLECTIONS.teamPositions).doc(targetSlot.positionId),
        ),
        transaction.get(
          db.collection(COLLECTIONS.teamPositions).doc(sourceSlot.positionId),
        ),
        transaction.get(
          db
            .collection(COLLECTIONS.teamRosterMembers)
            .doc(normalizedCurrentMemberId),
        ),
        transaction.get(
          db
            .collection(COLLECTIONS.teamRosterMembers)
            .doc(normalizedCandidateMemberId),
        ),
      ]);
      const targetPosition = readTransactionTeamEntity(
        targetPositionSnap,
        "positionId",
        "Target position",
      );
      const sourcePosition = readTransactionTeamEntity(
        sourcePositionSnap,
        "positionId",
        "Source position",
      );
      const currentMember = readTransactionTeamEntity(
        currentMemberSnap,
        "memberId",
        "Current member",
      );
      const candidateMember = readTransactionTeamEntity(
        candidateMemberSnap,
        "memberId",
        "Candidate member",
      );

      const assignments = buildValidatedScheduleAssignmentSwap({
        churchId,
        schedule,
        team,
        serviceId,
        targetPositionSlotKey,
        sourcePositionSlotKey,
        currentMember,
        currentMemberId: normalizedCurrentMemberId,
        candidateMember,
        candidateMemberId: normalizedCandidateMemberId,
        targetPosition,
        sourcePosition,
        serviceDate,
      });
      const schedules = await listTransactionSchedulesForChurch(
        transaction,
        db,
        churchId,
      );
      assertNoCrossTeamScheduleAssignmentConflicts({
        schedule,
        assignments,
        schedules,
        memberIds: new Set([
          normalizedCurrentMemberId,
          normalizedCandidateMemberId,
        ]),
        allowCrossTeamConflict,
      });
      const update = {
        assignments,
        updatedAt: nowIso(),
        updatedByUid: adminUserId,
      };
      transaction.update(scheduleRef, update);
      return { ...schedule, ...update };
    });
  };

  const updateTeamScheduleAttendanceInStore = async ({
    churchId,
    scheduleId,
    occurrenceId,
    memberId,
    status,
    columnKey,
    positionId,
    positionLabel,
    adminUserId,
  }) => {
    const db = requireFirestore();
    if (!db) {
      const schedule = await assertTeamEntityInChurch(
        "schedule",
        scheduleId,
        churchId,
        { label: "Schedule", active: false },
      );
      const team = await assertTeamEntityInChurch(
        "team",
        schedule.teamId,
        churchId,
        { label: "Team", active: false },
      );
      const attendance = buildNextScheduleAttendance({
        schedule,
        team,
        occurrenceId,
        memberId,
        status,
        columnKey,
        positionId,
        positionLabel,
      });
      await setDoc(
        COLLECTIONS.teamSchedules,
        scheduleId,
        { attendance, updatedAt: nowIso(), updatedByUid: adminUserId },
        { merge: true },
      );
      return getTeamEntity("schedule", scheduleId);
    }

    return db.runTransaction(async (transaction) => {
      const scheduleRef = db
        .collection(COLLECTIONS.teamSchedules)
        .doc(scheduleId);
      const scheduleSnap = await transaction.get(scheduleRef);
      const schedule = readTransactionTeamEntity(
        scheduleSnap,
        "scheduleId",
        "Schedule",
      );
      if (schedule.churchId !== churchId) {
        throw httpError(404, "Schedule not found.");
      }
      const teamSnap = await transaction.get(
        db.collection(COLLECTIONS.teams).doc(schedule.teamId),
      );
      const team = readTransactionTeamEntity(teamSnap, "teamId", "Team");
      if (team.churchId !== churchId) {
        throw httpError(404, "Team not found.");
      }
      const attendance = buildNextScheduleAttendance({
        schedule,
        team,
        occurrenceId,
        memberId,
        status,
        columnKey,
        positionId,
        positionLabel,
      });
      const update = {
        attendance,
        updatedAt: nowIso(),
        updatedByUid: adminUserId,
      };
      // Use update (not set with merge) so the attendance map is replaced
      // wholesale; a merged set would resurrect cleared attendance marks.
      transaction.update(scheduleRef, update);
      return { ...schedule, ...update };
    });
  };

  return {
    async getTeamsBootstrap(req, res) {
      try {
        await requireTeamsView(req, req.params.churchId);
        return res.json({
          success: true,
          ...(await buildTeamsBootstrap(req.params.churchId)),
        });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not load teams.");
      }
    },

    async createTeamRosterMember(req, res) {
      try {
        await assertCsrf(req);
        const payload = await validateTeamMemberPayload(
          req.body,
          req.params.churchId,
        );
        const admin = await requireTeamsEditForMember(
          req,
          req.params.churchId,
          payload,
        );
        const member = await upsertTeamEntity({
          kind: "member",
          churchId: req.params.churchId,
          payload,
          adminUserId: admin.user.uid,
        });
        // Positions are team-scoped, so being eligible for a team's position
        // implies belonging to that team's roster. Mirror the intake-apply flow
        // and reconcile membership into `team.memberIds` (idempotent, add-only).
        await addMemberToTeamsForPositions({
          churchId: req.params.churchId,
          positionIds: payload.positionIds,
          memberId: member.memberId,
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_roster_member_created",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          memberId: member.memberId,
        });
        return res.json({ success: true, member });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not save this member.");
      }
    },

    async updateTeamRosterMember(req, res) {
      try {
        await assertCsrf(req);
        const existing = await assertTeamEntityInChurch(
          "member",
          req.params.memberId,
          req.params.churchId,
          { label: "Member", active: false },
        );
        const payload = await validateTeamMemberPayload(
          req.body,
          req.params.churchId,
        );
        const admin = await requireTeamsEditForTeamIds(
          req,
          req.params.churchId,
          [
            ...(await collectMemberTeamIds(existing, req.params.churchId)),
            ...(await collectMemberTeamIds(payload, req.params.churchId)),
          ],
        );
        const member = await upsertTeamEntity({
          kind: "member",
          churchId: req.params.churchId,
          id: req.params.memberId,
          payload,
          adminUserId: admin.user.uid,
        });
        // Positions are team-scoped, so being eligible for a team's position
        // implies belonging to that team's roster. Mirror the intake-apply flow
        // and reconcile membership into `team.memberIds` (idempotent, add-only).
        await addMemberToTeamsForPositions({
          churchId: req.params.churchId,
          positionIds: payload.positionIds,
          memberId: member.memberId,
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_roster_member_updated",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          memberId: member.memberId,
        });
        return res.json({ success: true, member });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not save this member.");
      }
    },

    async archiveTeamRosterMember(req, res) {
      try {
        await assertCsrf(req);
        const existing = await assertTeamEntityInChurch(
          "member",
          req.params.memberId,
          req.params.churchId,
          { label: "Member", active: false },
        );
        const admin = await requireTeamsEditForMember(
          req,
          req.params.churchId,
          existing,
        );
        await archiveTeamEntity({
          kind: "member",
          churchId: req.params.churchId,
          id: req.params.memberId,
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_roster_member_archived",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          memberId: req.params.memberId,
        });
        return res.json({ success: true });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not archive this member.");
      }
    },

    async createTeamPosition(req, res) {
      try {
        await assertCsrf(req);
        const admin = await requireTeamsEdit(req, req.params.churchId);
        const payload = await validateTeamPositionPayload(
          req.body,
          req.params.churchId,
        );
        const position = await upsertTeamEntity({
          kind: "position",
          churchId: req.params.churchId,
          payload: {
            ...payload,
            order: await nextPositionOrder(req.params.churchId, payload.teamId),
          },
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_position_created",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          positionId: position.positionId,
        });
        return res.json({ success: true, position });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not save this position.");
      }
    },

    async createTeamIntakeForm(req, res) {
      try {
        await assertCsrf(req);
        const admin = await requireTeamsEdit(req, req.params.churchId);
        const formId = createId("teamIntakeForm");
        const publicLinkToken = createTeamIntakeShortPublicToken();
        const payload = validateTeamIntakeFormPayload(req.body);
        const now = nowIso();
        const form = {
          ...payload,
          formId,
          churchId: req.params.churchId,
          publicLinkToken,
          publicTokenHash: hashValue(publicLinkToken),
          archivedAt: null,
          createdAt: now,
          createdByUid: admin.user.uid,
          updatedAt: now,
          updatedByUid: admin.user.uid,
        };
        await setDoc(COLLECTIONS.teamIntakeForms, formId, form, {
          merge: false,
        });
        await addSecurityEvent({
          type: "team_intake_form_created",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          formId,
        });
        return res.json({
          success: true,
          form: sanitizeTeamIntakeFormForAdmin(form, 0),
          publicToken: publicLinkToken,
          publicUrl: buildTeamIntakePublicUrl(publicLinkToken),
        });
      } catch (error) {
        return sendTeamsJsonError(
          res,
          error,
          "Could not save this intake form.",
        );
      }
    },

    async updateTeamIntakeForm(req, res) {
      try {
        await assertCsrf(req);
        const admin = await requireTeamsEdit(req, req.params.churchId);
        const existing = await getDoc(
          COLLECTIONS.teamIntakeForms,
          req.params.formId,
        );
        if (!existing || existing.churchId !== req.params.churchId) {
          throw httpError(404, "Intake form not found.");
        }
        const payload = validateTeamIntakeFormPayload(req.body, existing);
        const update = {
          ...payload,
          updatedAt: nowIso(),
          updatedByUid: admin.user.uid,
        };
        await setDoc(COLLECTIONS.teamIntakeForms, req.params.formId, update, {
          merge: true,
        });
        const nextForm = {
          formId: req.params.formId,
          ...existing,
          ...update,
        };
        await addSecurityEvent({
          type: "team_intake_form_updated",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          formId: req.params.formId,
        });
        return res.json({
          success: true,
          form: sanitizeTeamIntakeFormForAdmin(nextForm),
        });
      } catch (error) {
        return sendTeamsJsonError(
          res,
          error,
          "Could not save this intake form.",
        );
      }
    },

    async getTeamIntakeFormLink(req, res) {
      try {
        await assertCsrf(req);
        const admin = await requireTeamsEdit(req, req.params.churchId);
        const existing = await getDoc(
          COLLECTIONS.teamIntakeForms,
          req.params.formId,
        );
        if (!existing || existing.churchId !== req.params.churchId) {
          throw httpError(404, "Intake form not found.");
        }
        const publicLinkToken = await ensureTeamIntakePublicLinkToken(
          req.params.formId,
          existing,
          admin.user.uid,
        );
        const nextForm = {
          formId: req.params.formId,
          ...existing,
          publicLinkToken,
          publicTokenHash: hashValue(publicLinkToken),
          updatedAt: nowIso(),
          updatedByUid: admin.user.uid,
        };
        await addSecurityEvent({
          type: "team_intake_form_link_copied",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          formId: req.params.formId,
        });
        return res.json({
          success: true,
          form: sanitizeTeamIntakeFormForAdmin(nextForm),
          publicToken: publicLinkToken,
          publicUrl: buildTeamIntakePublicUrl(publicLinkToken),
        });
      } catch (error) {
        return sendTeamsJsonError(
          res,
          error,
          "Could not create a new intake link.",
        );
      }
    },

    async getTeamIntakePreview(req, res) {
      try {
        enforcePublicTokenRateLimit({
          req,
          scope: "team-intake-preview",
          token: req.query?.token,
          limit: 30,
          windowMs: 10 * 60 * 1000,
          blockMs: 10 * 60 * 1000,
        });
        const { form } = await getTeamIntakeFormByToken(req.query?.token);
        assertTeamIntakeFormIsOpen(form);
        const church = await getDoc(COLLECTIONS.churches, form.churchId);
        const churchLogoUrl = await readChurchPublicBoardHeaderLogoUrl(
          form.churchId,
        );
        const [allPositions, allTeams] = await Promise.all([
          listTeamCollectionForChurch(
            COLLECTIONS.teamPositions,
            "positionId",
            form.churchId,
          ),
          listTeamCollectionForChurch(
            COLLECTIONS.teams,
            "teamId",
            form.churchId,
          ),
        ]);
        // An empty teamIds scopes the form to every team in the church.
        const scopedTeamIds = new Set(form.teamIds || []);
        const positions = sortPositionsByOrder(
          allPositions.filter(
            (position) =>
              !position.archivedAt &&
              (scopedTeamIds.size === 0 || scopedTeamIds.has(position.teamId)),
          ),
        );
        // Only the teams the shown positions belong to, so the public form can
        // group positions under a team header.
        const referencedTeamIds = new Set(
          positions.map((position) => position.teamId),
        );
        const teams = allTeams
          .filter((team) => referencedTeamIds.has(team.teamId))
          .map((team) => ({ teamId: team.teamId, name: team.name || "Team" }));
        return res.json({
          success: true,
          churchName: church?.name || "WorshipSync",
          ...(churchLogoUrl ? { churchLogoUrl } : {}),
          form: {
            formId: form.formId,
            name: form.name,
            startDate: form.startDate,
            endDate: form.endDate,
            availabilityServices: form.availabilityServices || [],
            availabilityOccurrences: form.availabilityOccurrences || [],
            welcomeMessage: form.welcomeMessage || "",
            positionsMessage: form.positionsMessage || "",
            availabilityMessage: form.availabilityMessage || "",
            notesMessage: form.notesMessage || "",
          },
          // Allowlist the fields the public form needs — never ship internal
          // position columns (description, order, timestamps) on a public link.
          positions: positions.map((position) => ({
            positionId: position.positionId,
            teamId: position.teamId,
            name: position.name,
            icon: position.icon || "",
          })),
          teams,
        });
      } catch (error) {
        return sendTeamsJsonError(
          res,
          error,
          "Could not load this intake form.",
        );
      }
    },

    async submitTeamIntake(req, res) {
      try {
        enforcePublicTokenRateLimit({
          req,
          scope: "team-intake-submit",
          token: req.query?.token,
          limit: 10,
          windowMs: 10 * 60 * 1000,
          blockMs: 30 * 60 * 1000,
        });
        const { form } = await getTeamIntakeFormByToken(req.query?.token);
        assertTeamIntakeFormIsOpen(form);
        const payload = await validateTeamIntakeSubmissionPayload(
          req.body,
          form,
        );
        const submissionId = createId("teamIntakeSubmission");
        const submittedAt = nowIso();
        await setDoc(
          COLLECTIONS.teamIntakeSubmissions,
          submissionId,
          {
            ...payload,
            submissionId,
            formId: form.formId,
            churchId: form.churchId,
            status: "new",
            submittedAt,
          },
          { merge: false },
        );
        // Notify editors out-of-band; a failure here must not fail the public
        // submission (the response is already saved).
        if (scheduleIntakeSubmissionDigest) {
          Promise.resolve(
            scheduleIntakeSubmissionDigest(form.formId, submittedAt),
          ).catch((error) =>
            console.error("Could not schedule intake digest", error),
          );
        }
        return res.json({ success: true, submissionId });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not submit this form.");
      }
    },

    async updateTeamPosition(req, res) {
      try {
        await assertCsrf(req);
        const admin = await requireTeamsEdit(req, req.params.churchId);
        const position = await upsertTeamEntity({
          kind: "position",
          churchId: req.params.churchId,
          id: req.params.positionId,
          payload: await validateTeamPositionPayload(
            req.body,
            req.params.churchId,
          ),
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_position_updated",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          positionId: position.positionId,
        });
        return res.json({ success: true, position });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not save this position.");
      }
    },

    async reorderTeamPositions(req, res) {
      try {
        await assertCsrf(req);
        const admin = await requireTeamsEdit(req, req.params.churchId);
        const churchId = req.params.churchId;
        // The team scopes the reorder so we never renumber another team's positions.
        const team = await assertTeamEntityInChurch(
          "team",
          req.body?.teamId,
          churchId,
          { label: "Team", active: false },
        );
        const positionIds = normalizeIdArray(req.body?.positionIds);
        if (!positionIds.length) {
          throw httpError(400, "No positions to reorder.");
        }
        // Every id must be an existing position in this church owned by the team
        // (archived included — order applies to the whole list).
        const positions = await Promise.all(
          positionIds.map(async (positionId) => {
            const position = await assertTeamEntityInChurch(
              "position",
              positionId,
              churchId,
              { label: "Position", active: false },
            );
            if (position.teamId !== team.teamId) {
              throw httpError(400, "That position is not part of this team.");
            }
            return position;
          }),
        );
        const now = nowIso();
        await Promise.all(
          positionIds.map((positionId, index) =>
            setDoc(
              COLLECTIONS.teamPositions,
              positionId,
              {
                order: index,
                updatedAt: now,
                updatedByUid: admin.user.uid,
              },
              { merge: true },
            ),
          ),
        );
        await addSecurityEvent({
          type: "team_positions_reordered",
          churchId,
          userId: admin.user.uid,
          teamId: team.teamId,
        });
        const reordered = positions.map((position, index) => ({
          ...position,
          order: index,
        }));
        return res.json({ success: true, positions: reordered });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not reorder positions.");
      }
    },

    async archiveTeamPosition(req, res) {
      try {
        await assertCsrf(req);
        const admin = await requireTeamsEdit(req, req.params.churchId);
        await archiveTeamEntity({
          kind: "position",
          churchId: req.params.churchId,
          id: req.params.positionId,
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_position_archived",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          positionId: req.params.positionId,
        });
        return res.json({ success: true });
      } catch (error) {
        return sendTeamsJsonError(
          res,
          error,
          "Could not archive this position.",
        );
      }
    },

    async createTeamRole(req, res) {
      try {
        await assertCsrf(req);
        const admin = await requireTeamsEdit(req, req.params.churchId);
        const role = await upsertTeamEntity({
          kind: "role",
          churchId: req.params.churchId,
          payload: await validateTeamRolePayload(req.body, req.params.churchId),
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_role_created",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          roleId: role.roleId,
        });
        return res.json({ success: true, role });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not save this role.");
      }
    },

    async updateTeamRole(req, res) {
      try {
        await assertCsrf(req);
        const admin = await requireTeamsEdit(req, req.params.churchId);
        const role = await upsertTeamEntity({
          kind: "role",
          churchId: req.params.churchId,
          id: req.params.roleId,
          payload: await validateTeamRolePayload(req.body, req.params.churchId),
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_role_updated",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          roleId: role.roleId,
        });
        return res.json({ success: true, role });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not save this role.");
      }
    },

    async archiveTeamRole(req, res) {
      try {
        await assertCsrf(req);
        const admin = await requireTeamsEdit(req, req.params.churchId);
        await archiveTeamEntity({
          kind: "role",
          churchId: req.params.churchId,
          id: req.params.roleId,
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_role_archived",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          roleId: req.params.roleId,
        });
        return res.json({ success: true });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not archive this role.");
      }
    },

    async deleteTeamRole(req, res) {
      try {
        await assertCsrf(req);
        const admin = await requireTeamsEdit(req, req.params.churchId);
        await deleteTeamEntity({
          kind: "role",
          churchId: req.params.churchId,
          id: req.params.roleId,
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_role_deleted",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          roleId: req.params.roleId,
        });
        return res.json({ success: true });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not delete this role.");
      }
    },

    async createTeamQualificationArea(req, res) {
      try {
        await assertCsrf(req);
        const admin = await requireTeamsEdit(req, req.params.churchId);
        const area = await upsertTeamEntity({
          kind: "qualificationArea",
          churchId: req.params.churchId,
          payload: await validateQualificationAreaPayload(
            req.body,
            req.params.churchId,
          ),
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_qualification_area_created",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          areaId: area.areaId,
        });
        return res.json({ success: true, area });
      } catch (error) {
        return sendTeamsJsonError(
          res,
          error,
          "Could not save this qualification area.",
        );
      }
    },

    async updateTeamQualificationArea(req, res) {
      try {
        await assertCsrf(req);
        const admin = await requireTeamsEdit(req, req.params.churchId);
        const area = await upsertTeamEntity({
          kind: "qualificationArea",
          churchId: req.params.churchId,
          id: req.params.areaId,
          payload: await validateQualificationAreaPayload(
            req.body,
            req.params.churchId,
          ),
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_qualification_area_updated",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          areaId: area.areaId,
        });
        return res.json({ success: true, area });
      } catch (error) {
        return sendTeamsJsonError(
          res,
          error,
          "Could not save this qualification area.",
        );
      }
    },

    async archiveTeamQualificationArea(req, res) {
      try {
        await assertCsrf(req);
        const admin = await requireTeamsEdit(req, req.params.churchId);
        await archiveTeamEntity({
          kind: "qualificationArea",
          churchId: req.params.churchId,
          id: req.params.areaId,
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_qualification_area_archived",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          areaId: req.params.areaId,
        });
        return res.json({ success: true });
      } catch (error) {
        return sendTeamsJsonError(
          res,
          error,
          "Could not archive this qualification area.",
        );
      }
    },

    async deleteTeamQualificationArea(req, res) {
      try {
        await assertCsrf(req);
        const admin = await requireTeamsEdit(req, req.params.churchId);
        await deleteTeamEntity({
          kind: "qualificationArea",
          churchId: req.params.churchId,
          id: req.params.areaId,
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_qualification_area_deleted",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          areaId: req.params.areaId,
        });
        return res.json({ success: true });
      } catch (error) {
        return sendTeamsJsonError(
          res,
          error,
          "Could not delete this qualification area.",
        );
      }
    },

    async createTeamQualificationLevel(req, res) {
      try {
        await assertCsrf(req);
        const admin = await requireTeamsEdit(req, req.params.churchId);
        const level = await upsertTeamEntity({
          kind: "qualificationLevel",
          churchId: req.params.churchId,
          payload: await validateQualificationLevelPayload(
            req.body,
            req.params.churchId,
          ),
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_qualification_level_created",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          levelId: level.levelId,
        });
        return res.json({ success: true, level });
      } catch (error) {
        return sendTeamsJsonError(
          res,
          error,
          "Could not save this qualification level.",
        );
      }
    },

    async updateTeamQualificationLevel(req, res) {
      try {
        await assertCsrf(req);
        const admin = await requireTeamsEdit(req, req.params.churchId);
        const level = await upsertTeamEntity({
          kind: "qualificationLevel",
          churchId: req.params.churchId,
          id: req.params.levelId,
          payload: await validateQualificationLevelPayload(
            req.body,
            req.params.churchId,
          ),
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_qualification_level_updated",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          levelId: level.levelId,
        });
        return res.json({ success: true, level });
      } catch (error) {
        return sendTeamsJsonError(
          res,
          error,
          "Could not save this qualification level.",
        );
      }
    },

    async archiveTeamQualificationLevel(req, res) {
      try {
        await assertCsrf(req);
        const admin = await requireTeamsEdit(req, req.params.churchId);
        await archiveTeamEntity({
          kind: "qualificationLevel",
          churchId: req.params.churchId,
          id: req.params.levelId,
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_qualification_level_archived",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          levelId: req.params.levelId,
        });
        return res.json({ success: true });
      } catch (error) {
        return sendTeamsJsonError(
          res,
          error,
          "Could not archive this qualification level.",
        );
      }
    },

    async deleteTeamQualificationLevel(req, res) {
      try {
        await assertCsrf(req);
        const admin = await requireTeamsEdit(req, req.params.churchId);
        await deleteTeamEntity({
          kind: "qualificationLevel",
          churchId: req.params.churchId,
          id: req.params.levelId,
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_qualification_level_deleted",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          levelId: req.params.levelId,
        });
        return res.json({ success: true });
      } catch (error) {
        return sendTeamsJsonError(
          res,
          error,
          "Could not delete this qualification level.",
        );
      }
    },

    async createTeam(req, res) {
      try {
        await assertCsrf(req);
        const admin = await requireTeamsEdit(req, req.params.churchId);
        const team = await upsertTeamEntity({
          kind: "team",
          churchId: req.params.churchId,
          payload: await validateTeamPayload(req.body, req.params.churchId),
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_created",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          teamId: team.teamId,
        });
        return res.json({ success: true, team });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not save this team.");
      }
    },

    async updateTeam(req, res) {
      try {
        await assertCsrf(req);
        const admin = await requireTeamsEdit(req, req.params.churchId);
        const team = await upsertTeamEntity({
          kind: "team",
          churchId: req.params.churchId,
          id: req.params.teamId,
          payload: await validateTeamPayload(req.body, req.params.churchId),
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_updated",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          teamId: team.teamId,
        });
        return res.json({ success: true, team });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not save this team.");
      }
    },

    async archiveTeam(req, res) {
      try {
        await assertCsrf(req);
        const admin = await requireTeamsEdit(req, req.params.churchId);
        await archiveTeamEntity({
          kind: "team",
          churchId: req.params.churchId,
          id: req.params.teamId,
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_archived",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          teamId: req.params.teamId,
        });
        return res.json({ success: true });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not archive this team.");
      }
    },

    async createTeamSchedule(req, res) {
      try {
        await assertCsrf(req);
        const payload = await validateTeamSchedulePayload(
          req.body,
          req.params.churchId,
        );
        const admin = await requireTeamsEditForTeam(
          req,
          req.params.churchId,
          payload.teamId,
        );
        if (Object.keys(payload.assignments || {}).length > 0) {
          const schedules = await listTeamCollectionForChurch(
            COLLECTIONS.teamSchedules,
            "scheduleId",
            req.params.churchId,
          );
          assertNoCrossTeamScheduleAssignmentConflicts({
            schedule: { churchId: req.params.churchId, ...payload },
            assignments: payload.assignments,
            schedules,
            allowCrossTeamConflict: normalizeAllowCrossTeamConflict(
              req.body?.allowCrossTeamConflict,
            ),
          });
        }
        const schedule = await upsertTeamEntity({
          kind: "schedule",
          churchId: req.params.churchId,
          payload,
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_schedule_created",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          scheduleId: schedule.scheduleId,
        });
        emitTeamsEvent(req.params.churchId, "schedule-updated", { schedule });
        return res.json({ success: true, schedule });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not save this schedule.");
      }
    },

    async getTeamSchedulePublicLink(req, res) {
      try {
        await assertCsrf(req);
        const existing = await getDoc(
          COLLECTIONS.teamSchedules,
          req.params.scheduleId,
        );
        if (!existing || existing.churchId !== req.params.churchId) {
          throw httpError(404, "Schedule not found.");
        }
        const admin = await requireTeamsEditForTeam(
          req,
          req.params.churchId,
          existing.teamId,
        );
        const publicLinkToken = await ensureTeamSchedulePublicLinkToken(
          req.params.scheduleId,
          existing,
          admin.user.uid,
        );
        await addSecurityEvent({
          type: "team_schedule_link_copied",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          scheduleId: req.params.scheduleId,
        });
        return res.json({ success: true, publicToken: publicLinkToken });
      } catch (error) {
        return sendTeamsJsonError(
          res,
          error,
          "Could not create a public link.",
        );
      }
    },

    async getPublicTeamSchedule(req, res) {
      try {
        enforcePublicTokenRateLimit({
          req,
          scope: "team-schedule-public",
          token: req.query?.token,
          limit: 60,
          windowMs: 10 * 60 * 1000,
          blockMs: 10 * 60 * 1000,
        });
        const { schedule } = await getTeamScheduleByToken(req.query?.token);
        const snapshot = await buildPublicTeamScheduleSnapshot(schedule);
        return res.json({ success: true, ...snapshot });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not load this schedule.");
      }
    },

    async updateTeamSchedule(req, res) {
      try {
        await assertCsrf(req);
        const existing = await assertTeamEntityInChurch(
          "schedule",
          req.params.scheduleId,
          req.params.churchId,
          { label: "Schedule", active: false },
        );
        const payload = await validateTeamSchedulePayload(
          req.body,
          req.params.churchId,
        );
        const admin = await requireTeamsEditForTeamIds(
          req,
          req.params.churchId,
          [existing.teamId, payload.teamId],
        );
        if (Object.keys(payload.assignments || {}).length > 0) {
          const schedules = await listTeamCollectionForChurch(
            COLLECTIONS.teamSchedules,
            "scheduleId",
            req.params.churchId,
          );
          assertNoCrossTeamScheduleAssignmentConflicts({
            schedule: {
              scheduleId: req.params.scheduleId,
              churchId: req.params.churchId,
              ...payload,
            },
            assignments: payload.assignments,
            schedules,
            allowCrossTeamConflict: normalizeAllowCrossTeamConflict(
              req.body?.allowCrossTeamConflict,
            ),
          });
        }
        const schedule = await upsertTeamEntity({
          kind: "schedule",
          churchId: req.params.churchId,
          id: req.params.scheduleId,
          payload,
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_schedule_updated",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          scheduleId: schedule.scheduleId,
        });
        emitTeamsEvent(req.params.churchId, "schedule-updated", { schedule });
        return res.json({ success: true, schedule });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not save this schedule.");
      }
    },

    async archiveTeamSchedule(req, res) {
      try {
        await assertCsrf(req);
        const existing = await assertTeamEntityInChurch(
          "schedule",
          req.params.scheduleId,
          req.params.churchId,
          { label: "Schedule", active: false },
        );
        const admin = await requireTeamsEditForTeam(
          req,
          req.params.churchId,
          existing.teamId,
        );
        await archiveTeamEntity({
          kind: "schedule",
          churchId: req.params.churchId,
          id: req.params.scheduleId,
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_schedule_archived",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          scheduleId: req.params.scheduleId,
        });
        emitTeamsEvent(req.params.churchId, "schedule-removed", {
          scheduleId: req.params.scheduleId,
        });
        return res.json({ success: true });
      } catch (error) {
        return sendTeamsJsonError(
          res,
          error,
          "Could not archive this schedule.",
        );
      }
    },

    async deleteTeamRosterMember(req, res) {
      try {
        await assertCsrf(req);
        const existing = await assertTeamEntityInChurch(
          "member",
          req.params.memberId,
          req.params.churchId,
          { label: "Member", active: false },
        );
        const admin = await requireTeamsEditForMember(
          req,
          req.params.churchId,
          existing,
        );
        await deleteTeamEntity({
          kind: "member",
          churchId: req.params.churchId,
          id: req.params.memberId,
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_roster_member_deleted",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          memberId: req.params.memberId,
        });
        return res.json({ success: true });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not delete this member.");
      }
    },

    async deleteTeamPosition(req, res) {
      try {
        await assertCsrf(req);
        const admin = await requireTeamsEdit(req, req.params.churchId);
        await deleteTeamEntity({
          kind: "position",
          churchId: req.params.churchId,
          id: req.params.positionId,
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_position_deleted",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          positionId: req.params.positionId,
        });
        return res.json({ success: true });
      } catch (error) {
        return sendTeamsJsonError(
          res,
          error,
          "Could not delete this position.",
        );
      }
    },

    async deleteTeam(req, res) {
      try {
        await assertCsrf(req);
        const admin = await requireTeamsEdit(req, req.params.churchId);
        await deleteTeamEntity({
          kind: "team",
          churchId: req.params.churchId,
          id: req.params.teamId,
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_deleted",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          teamId: req.params.teamId,
        });
        return res.json({ success: true });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not delete this team.");
      }
    },

    async deleteTeamSchedule(req, res) {
      try {
        await assertCsrf(req);
        const existing = await assertTeamEntityInChurch(
          "schedule",
          req.params.scheduleId,
          req.params.churchId,
          { label: "Schedule", active: false },
        );
        const admin = await requireTeamsEditForTeam(
          req,
          req.params.churchId,
          existing.teamId,
        );
        await deleteTeamEntity({
          kind: "schedule",
          churchId: req.params.churchId,
          id: req.params.scheduleId,
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_schedule_deleted",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          scheduleId: req.params.scheduleId,
        });
        emitTeamsEvent(req.params.churchId, "schedule-removed", {
          scheduleId: req.params.scheduleId,
        });
        return res.json({ success: true });
      } catch (error) {
        return sendTeamsJsonError(
          res,
          error,
          "Could not delete this schedule.",
        );
      }
    },

    // Service Plans: the per-occurrence order-of-service content plan (build
    // from scratch or import, then edit) — separate from ServiceTime (the
    // recurring day/time/positions definition) and from the live PouchDB
    // outline it eventually gets pushed into.
    async listServicePlans(req, res) {
      try {
        const churchId = req.params.churchId;
        await requireTeamsView(req, churchId);
        const docs = await queryDocs(
          COLLECTIONS.servicePlans,
          [{ field: "churchId", value: churchId }],
          { limit: TEAM_COLLECTION_QUERY_LIMIT },
        );
        // Lightweight projection for the Plans list — enough to show "does
        // this date already have a plan" without shipping every plan's
        // full section/element content down for a list view.
        const servicePlans = docs.map((doc) => ({
          planKey: doc.planKey,
          serviceId: doc.serviceId,
          serviceIds: doc.serviceIds,
          groupId: doc.groupId,
          date: doc.date,
          name: doc.name,
          published: Boolean(doc.published),
        }));
        return res.json({ success: true, servicePlans });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not load service plans.");
      }
    },

    async getServicePlan(req, res) {
      try {
        const churchId = req.params.churchId;
        await requireTeamsView(req, churchId);
        const planKey = decodeURIComponent(req.params.planKey);
        const docId = buildServicePlanDocId(churchId, planKey);
        const servicePlan = await getDoc(COLLECTIONS.servicePlans, docId);
        if (!servicePlan || servicePlan.churchId !== churchId) {
          return res.json({ success: true, servicePlan: null });
        }
        // Rebuild the share links for an already-published plan so reopening
        // the editor still shows them — they used to exist only in the publish
        // response, so a reload left an operator with no way to reach the
        // links short of publishing again.
        let publicUrls;
        if (servicePlan.published && servicePlan.publicLinkToken) {
          const church = await getDoc(COLLECTIONS.churches, churchId);
          publicUrls = {
            team: buildPublicServicePlanUrl(servicePlan.publicLinkToken),
            ...(servicePlan.publicGeneralLinkToken
              ? { general: buildPublicServicePlanUrl(servicePlan.publicGeneralLinkToken) }
              : {}),
            ...(church?.currentServiceTeamToken
              ? { currentTeam: buildPublicServicePlanUrl(church.currentServiceTeamToken) }
              : {}),
            ...(church?.currentServiceGeneralToken
              ? {
                  currentGeneral: buildPublicServicePlanUrl(
                    church.currentServiceGeneralToken,
                  ),
                }
              : {}),
          };
        }
        return res.json({
          success: true,
          servicePlan,
          ...(publicUrls ? { publicUrls } : {}),
        });
      } catch (error) {
        return sendTeamsJsonError(
          res,
          error,
          "Could not load this service plan.",
        );
      }
    },

    async saveServicePlan(req, res) {
      try {
        await assertCsrf(req);
        const churchId = req.params.churchId;
        const admin = await requireTeamsEdit(req, churchId);
        const planKey = decodeURIComponent(req.params.planKey);
        const docId = buildServicePlanDocId(churchId, planKey);
        const existing = await getDoc(COLLECTIONS.servicePlans, docId);
        const payload = validateServicePlanPayload(req.body, {
          churchId,
          planKey,
        });
        const baseRevision = getServicePlanBaseRevision(req.body?.baseRevision);
        const now = nowIso();
        const db = requireFirestore();
        let servicePlan;
        if (db) {
          servicePlan = await db.runTransaction(async (transaction) => {
            const ref = db.collection(COLLECTIONS.servicePlans).doc(docId);
            const snapshot = await transaction.get(ref);
            const current = snapshot.exists
              ? { planId: snapshot.id, ...snapshot.data() }
              : null;
            assertServicePlanRevision(current, baseRevision);
            const nextPlan = buildServicePlanSaveDocument({
              existing: current,
              payload,
              docId,
              adminUid: admin.user.uid,
              now,
            });
            transaction.set(ref, nextPlan, { merge: Boolean(current) });
            return { ...current, ...nextPlan };
          });
        } else {
          assertServicePlanRevision(existing, baseRevision);
          const nextPlan = buildServicePlanSaveDocument({
            existing,
            payload,
            docId,
            adminUid: admin.user.uid,
            now,
          });
          await setDoc(
            COLLECTIONS.servicePlans,
            docId,
            nextPlan,
            { merge: Boolean(existing) },
          );
          servicePlan = await getDoc(COLLECTIONS.servicePlans, docId);
        }
        emitTeamsEvent(churchId, "service-plan-updated", { servicePlan });
        await emitPublicServicePlanUpdated(
          servicePlan,
          Date.parse(servicePlan?.updatedAt || "") || Date.now(),
        );
        return res.json({ success: true, servicePlan });
      } catch (error) {
        if (error?.servicePlanConflict) {
          return res.status(409).json({
            success: false,
            conflict: true,
            errorMessage: error.message,
            servicePlan: error.servicePlanConflict,
          });
        }
        return sendTeamsJsonError(
          res,
          error,
          "Could not save this service plan.",
        );
      }
    },

    // Service plan templates: reusable order-of-service skeletons a plan can be
    // built from. Church-scoped, optionally narrowed to one service.
    async listServicePlanTemplates(req, res) {
      try {
        const churchId = req.params.churchId;
        await requireTeamsView(req, churchId);
        const docs = await queryDocs(
          COLLECTIONS.servicePlanTemplates,
          [{ field: "churchId", value: churchId }],
          { limit: TEAM_COLLECTION_QUERY_LIMIT },
        );
        const templates = docs
          .filter((doc) => doc?.churchId === churchId)
          .sort((left, right) =>
            String(left?.name || "").localeCompare(String(right?.name || "")),
          );
        return res.json({ success: true, templates });
      } catch (error) {
        return sendTeamsJsonError(
          res,
          error,
          "Could not load service plan templates.",
        );
      }
    },

    async saveServicePlanTemplate(req, res) {
      try {
        await assertCsrf(req);
        const churchId = req.params.churchId;
        const admin = await requireTeamsEdit(req, churchId);
        const payload = validateServicePlanTemplatePayload(req.body);
        const requestedId = normalizeShortText(req.body?.templateId, { max: 200 });
        const now = nowIso();

        let templateId = requestedId;
        let existing = null;
        if (templateId) {
          existing = await getDoc(COLLECTIONS.servicePlanTemplates, templateId);
          // A template id from another church must never be overwritten.
          if (existing && existing.churchId !== churchId) {
            throw httpError(404, "Template not found.");
          }
        } else {
          templateId = createId("servicePlanTemplate");
        }

        await setDoc(
          COLLECTIONS.servicePlanTemplates,
          templateId,
          {
            ...payload,
            templateId,
            churchId,
            updatedAt: now,
            updatedByUid: admin.user.uid,
            ...(existing ? {} : { createdAt: now, createdByUid: admin.user.uid }),
          },
          { merge: Boolean(existing) },
        );
        const template = await getDoc(COLLECTIONS.servicePlanTemplates, templateId);
        emitTeamsEvent(churchId, "service-plan-template-updated", { template });
        return res.json({ success: true, template });
      } catch (error) {
        return sendTeamsJsonError(
          res,
          error,
          "Could not save this service plan template.",
        );
      }
    },

    async deleteServicePlanTemplate(req, res) {
      try {
        await assertCsrf(req);
        const churchId = req.params.churchId;
        await requireTeamsEdit(req, churchId);
        const templateId = decodeURIComponent(req.params.templateId);
        const existing = await getDoc(COLLECTIONS.servicePlanTemplates, templateId);
        if (!existing || existing.churchId !== churchId) {
          throw httpError(404, "Template not found.");
        }
        await deleteDoc(COLLECTIONS.servicePlanTemplates, templateId);
        emitTeamsEvent(churchId, "service-plan-template-removed", { templateId });
        return res.json({ success: true });
      } catch (error) {
        return sendTeamsJsonError(
          res,
          error,
          "Could not delete this service plan template.",
        );
      }
    },

    // Assignment history: free-text names typed into a plan element's
    // "Assigned to" field, remembered per church so future elements can
    // suggest them — same "members + history" suggestion pattern as
    // Overlays/Credits, but stored in Firestore (one small doc per church)
    // since ServicePlan is Firestore-backed, not PouchDB-backed.
    async getServicePlanAssignmentHistory(req, res) {
      try {
        const churchId = req.params.churchId;
        await requireTeamsView(req, churchId);
        const doc = await getDoc(COLLECTIONS.servicePlanAssignmentHistory, churchId);
        return res.json({ success: true, values: doc?.values || [] });
      } catch (error) {
        return sendTeamsJsonError(
          res,
          error,
          "Could not load assignment suggestions.",
        );
      }
    },

    async saveServicePlanAssignmentHistory(req, res) {
      try {
        await assertCsrf(req);
        const churchId = req.params.churchId;
        await requireTeamsEdit(req, churchId);
        const values = Array.isArray(req.body?.values)
          ? [
              ...new Set(
                req.body.values
                  .map((value) => String(value || "").trim())
                  .filter(Boolean),
              ),
            ].slice(0, 500)
          : [];
        await setDoc(
          COLLECTIONS.servicePlanAssignmentHistory,
          churchId,
          { churchId, values, updatedAt: nowIso() },
          { merge: true },
        );
        return res.json({ success: true, values });
      } catch (error) {
        return sendTeamsJsonError(
          res,
          error,
          "Could not save assignment suggestions.",
        );
      }
    },

    async publishServicePlan(req, res) {
      try {
        await assertCsrf(req);
        const churchId = req.params.churchId;
        const admin = await requireTeamsEdit(req, churchId);
        const planKey = decodeURIComponent(req.params.planKey);
        const docId = buildServicePlanDocId(churchId, planKey);
        const existing = await getDoc(COLLECTIONS.servicePlans, docId);
        if (!existing || existing.churchId !== churchId) {
          throw httpError(404, "Service plan not found.");
        }
        if (!existing.startsAt || Number.isNaN(Date.parse(existing.startsAt))) {
          throw httpError(400, "Save the service start time before publishing.");
        }
        const { publicLinkToken, publicGeneralLinkToken } =
          await ensureServicePlanPublicTokens(existing, admin.user.uid);
        const { teamToken: currentTeamToken, generalToken: currentGeneralToken } =
          await ensureChurchCurrentServiceTokens(churchId, admin.user.uid);
        const now = nowIso();
        const nextPlan = {
          ...existing,
          publicLinkToken,
          publicTokenHash: hashValue(publicLinkToken),
          publicGeneralLinkToken,
          publicGeneralTokenHash: hashValue(publicGeneralLinkToken),
          published: true,
          publicLive: normalizePublicLiveState(existing.publicLive, existing),
          updatedAt: now,
          updatedByUid: admin.user.uid,
        };
        await setDoc(COLLECTIONS.servicePlans, docId, nextPlan, { merge: true });
        const servicePlan = await getDoc(COLLECTIONS.servicePlans, docId);
        emitTeamsEvent(churchId, "service-plan-updated", { servicePlan });
        await emitPublicServicePlanUpdated(servicePlan, Date.parse(now) || Date.now());
        return res.json({
          success: true,
          servicePlan,
          publicUrl: buildPublicServicePlanUrl(publicLinkToken),
          teamPublicUrl: buildPublicServicePlanUrl(publicLinkToken),
          generalPublicUrl: buildPublicServicePlanUrl(publicGeneralLinkToken),
          currentTeamPublicUrl: buildPublicServicePlanUrl(currentTeamToken),
          currentGeneralPublicUrl: buildPublicServicePlanUrl(currentGeneralToken),
        });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not publish this service plan.");
      }
    },

    async unpublishServicePlan(req, res) {
      try {
        await assertCsrf(req);
        const churchId = req.params.churchId;
        const admin = await requireTeamsEdit(req, churchId);
        const planKey = decodeURIComponent(req.params.planKey);
        const docId = buildServicePlanDocId(churchId, planKey);
        const existing = await getDoc(COLLECTIONS.servicePlans, docId);
        if (!existing || existing.churchId !== churchId) {
          throw httpError(404, "Service plan not found.");
        }
        const now = nowIso();
        await setDoc(
          COLLECTIONS.servicePlans,
          docId,
          { published: false, updatedAt: now, updatedByUid: admin.user.uid },
          { merge: true },
        );
        const servicePlan = await getDoc(COLLECTIONS.servicePlans, docId);
        emitTeamsEvent(churchId, "service-plan-updated", { servicePlan });
        await emitPublicServicePlanUpdated(
          { ...existing, published: true },
          Date.parse(now) || Date.now(),
        );
        return res.json({ success: true, servicePlan });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not unpublish this service plan.");
      }
    },

    async updateServicePlanPublicLive(req, res) {
      try {
        await assertCsrf(req);
        const churchId = req.params.churchId;
        const admin = await requireTeamsEdit(req, churchId);
        const planKey = decodeURIComponent(req.params.planKey);
        const docId = buildServicePlanDocId(churchId, planKey);
        const existing = await getDoc(COLLECTIONS.servicePlans, docId);
        if (!existing || existing.churchId !== churchId) {
          throw httpError(404, "Service plan not found.");
        }
        const publicLive = normalizePublicLiveState(req.body, existing);
        const now = nowIso();
        await setDoc(
          COLLECTIONS.servicePlans,
          docId,
          { publicLive, updatedAt: now, updatedByUid: admin.user.uid },
          { merge: true },
        );
        const servicePlan = await getDoc(COLLECTIONS.servicePlans, docId);
        emitTeamsEvent(churchId, "service-plan-updated", { servicePlan });
        await emitPublicServicePlanUpdated(servicePlan, Date.parse(now) || Date.now());
        return res.json({ success: true, servicePlan });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not update live service progress.");
      }
    },

    async getPublicServicePlan(req, res) {
      try {
        enforcePublicTokenRateLimit({
          req,
          scope: "service-plan-public",
          token: req.query?.token,
          limit: 60,
          windowMs: 10 * 60 * 1000,
          blockMs: 10 * 60 * 1000,
        });
        const publicPlan = await getPublicServicePlanByToken(req.query?.token);
        const snapshot = await buildPublicServicePlan(publicPlan);
        if (!snapshot) throw httpError(404, "Service not found.");
        return res.json(snapshot);
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not load this service.");
      }
    },

    async openPublicServicePlanStream(req, res) {
      try {
        enforcePublicTokenRateLimit({
          req,
          scope: "service-plan-public-stream",
          token: req.query?.token,
          limit: 60,
          windowMs: 10 * 60 * 1000,
          blockMs: 10 * 60 * 1000,
        });
        const { token } = await getPublicServicePlanByToken(req.query?.token);
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.flushHeaders?.();
        res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);
        addServiceFlowSseClient(token, res);
        const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), 25_000);
        req.on("close", () => {
          clearInterval(heartbeat);
          removeServiceFlowSseClient(token, res);
          res.end();
        });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not open service updates.");
      }
    },

    async deleteServicePlan(req, res) {
      try {
        await assertCsrf(req);
        const churchId = req.params.churchId;
        await requireTeamsEdit(req, churchId);
        const planKey = decodeURIComponent(req.params.planKey);
        const docId = buildServicePlanDocId(churchId, planKey);
        const existing = await getDoc(COLLECTIONS.servicePlans, docId);
        await deleteDoc(COLLECTIONS.servicePlans, docId);
        emitTeamsEvent(churchId, "service-plan-removed", { planKey });
        // Deleting revokes public access just as unpublishing does, so already
        // open viewers must be told to re-fetch (and get a 404) instead of
        // sitting on a snapshot of now-deleted serving notes. `published` is
        // forced because the emit helper skips unpublished plans, and the doc
        // we are announcing is already gone.
        if (existing?.churchId === churchId) {
          await emitPublicServicePlanUpdated(
            { ...existing, published: true },
            Date.now(),
          );
        }
        return res.json({ success: true });
      } catch (error) {
        return sendTeamsJsonError(
          res,
          error,
          "Could not delete this service plan.",
        );
      }
    },

    async updateTeamIntakeSubmission(req, res) {
      try {
        await assertCsrf(req);
        const admin = await requireTeamsEdit(req, req.params.churchId);
        const submission = await getDoc(
          COLLECTIONS.teamIntakeSubmissions,
          req.params.submissionId,
        );
        if (!submission || submission.churchId !== req.params.churchId) {
          throw httpError(404, "Submission not found.");
        }
        const action = String(req.body?.action || "").trim();
        const now = nowIso();
        let member = null;
        // Teams whose rosters changed by this apply, returned so the client can
        // refresh memberships immediately (so a created member shows up on the
        // schedule without waiting for a full reload).
        let updatedTeams = [];
        const update = {
          status: action,
          reviewedAt: now,
          reviewedByUid: admin.user.uid,
          updatedAt: now,
          updatedByUid: admin.user.uid,
        };

        if (action === "applied") {
          const blockoutDates = mergeBlockoutDateRanges(
            (submission.blockoutRanges || []).map((range) => ({
              startDate: range.startDate,
              endDate: range.endDate,
              notes: "From intake form",
            })),
          );
          // Intake positions are what the member *wants* to do, not what they
          // are eligible to be scheduled for. Apply records desire only; an
          // admin promotes desired positions into `positionIds` (the schedule
          // gate) explicitly. Never auto-grant eligibility here.
          const desiredPositionIds = submission.positionIds || [];
          // Per-service availability the submitter marked. "unavailable" entries
          // become a hard scheduling constraint on the member.
          const submissionAvailability = normalizeServiceAvailability(
            submission.occurrenceAvailability,
          );
          // Teams the member should join so they appear on those schedules
          // (shadow-eligible even with no positions): the teams that own their
          // requested positions, plus the teams the form explicitly collects
          // for. An all-teams form (empty teamIds) intentionally adds no extra
          // teams beyond the requested-position ones — we never mass-add.
          const intakeForm = await getDoc(
            COLLECTIONS.teamIntakeForms,
            submission.formId,
          );
          const formTeamIds =
            intakeForm && intakeForm.churchId === req.params.churchId
              ? normalizeIdArray(intakeForm.teamIds)
              : [];
          const addedTeamIds = new Set();
          const trackTeams = (ids) =>
            (ids || []).forEach((id) => addedTeamIds.add(id));
          if (req.body?.createMember) {
            member = await upsertTeamEntity({
              kind: "member",
              churchId: req.params.churchId,
              payload: {
                firstName: submission.firstName,
                lastName: submission.lastName,
                dateOfBirth: "",
                positionIds: [],
                desiredPositionIds,
                serviceAvailability: submissionAvailability,
                blockoutDates,
                notes: normalizeLongText(submission.notes),
              },
              adminUserId: admin.user.uid,
            });
            // Surface the new member on the rosters of teams that own their
            // desired positions, plus the form's scoped teams, so an admin can
            // find and (if needed) promote them. This is team visibility only;
            // assignability is still gated by `positionIds`, which stays empty
            // until promotion — so they can only be shadowed in for now.
            trackTeams(
              await addMemberToTeamsForPositions({
                churchId: req.params.churchId,
                positionIds: desiredPositionIds,
                memberId: member.memberId,
                adminUserId: admin.user.uid,
              }),
            );
            trackTeams(
              await addMemberToTeams({
                churchId: req.params.churchId,
                teamIds: formTeamIds,
                memberId: member.memberId,
                adminUserId: admin.user.uid,
              }),
            );
          } else {
            const memberId = normalizeShortText(req.body?.memberId, {
              max: 160,
            });
            member = await assertTeamEntityInChurch(
              "member",
              memberId,
              req.params.churchId,
              { label: "Member", active: false },
            );
            // Latest intake wins for desired positions; eligibility
            // (`positionIds`) is left untouched.
            const nextDesiredPositionIds = normalizeIdArray(desiredPositionIds);
            // Merge the intake blockouts into the member's existing ones so
            // repeat submissions and overlapping ranges don't pile up duplicates.
            const nextBlockoutDates = mergeBlockoutDateRanges([
              ...(member.blockoutDates || []),
              ...blockoutDates,
            ]);
            // Merge availability per occurrence; the latest submission wins for
            // any occurrence it covers, while older occurrences are preserved.
            const nextServiceAvailability = {
              ...(member.serviceAvailability || {}),
              ...submissionAvailability,
            };
            await setDoc(
              COLLECTIONS.teamRosterMembers,
              member.memberId,
              {
                desiredPositionIds: nextDesiredPositionIds,
                serviceAvailability: nextServiceAvailability,
                blockoutDates: nextBlockoutDates,
                updatedAt: now,
                updatedByUid: admin.user.uid,
              },
              { merge: true },
            );
            // Mirror the create path: surface the linked member on the rosters
            // of teams that own their desired positions, plus the form's scoped
            // teams. Visibility only — assignability stays gated by
            // `positionIds`, which we never touch here.
            trackTeams(
              await addMemberToTeamsForPositions({
                churchId: req.params.churchId,
                positionIds: nextDesiredPositionIds,
                memberId: member.memberId,
                adminUserId: admin.user.uid,
              }),
            );
            trackTeams(
              await addMemberToTeams({
                churchId: req.params.churchId,
                teamIds: formTeamIds,
                memberId: member.memberId,
                adminUserId: admin.user.uid,
              }),
            );
            member = await getTeamEntity("member", member.memberId);
          }
          update.status = "applied";
          update.appliedAt = now;
          update.appliedByUid = admin.user.uid;
          update.appliedMemberId = member.memberId;
          update.appliedMemberCreated = Boolean(req.body?.createMember);
          updatedTeams = (
            await Promise.all(
              Array.from(addedTeamIds).map((teamId) =>
                getDoc(COLLECTIONS.teams, teamId),
              ),
            )
          ).filter((team) => team && team.churchId === req.params.churchId);
        } else if (action === "dismissed") {
          update.status = "dismissed";
        } else if (action === "reviewed") {
          // Legacy clients may still send "reviewed"; keep accepting it.
          update.status = "reviewed";
        } else if (action === "new") {
          // Restore a dismissed submission back into the active queue. The
          // submission data was never deleted, so this is a safe undo.
          update.status = "new";
        } else {
          throw httpError(
            400,
            action
              ? `Unsupported submission action: "${action}".`
              : "Review action is required.",
          );
        }

        await setDoc(
          COLLECTIONS.teamIntakeSubmissions,
          req.params.submissionId,
          update,
          { merge: true },
        );
        await addSecurityEvent({
          type: `team_intake_submission_${update.status}`,
          churchId: req.params.churchId,
          userId: admin.user.uid,
          submissionId: req.params.submissionId,
          memberId: member?.memberId || null,
        });
        return res.json({
          success: true,
          submission: {
            submissionId: req.params.submissionId,
            ...submission,
            ...update,
          },
          ...(member ? { member } : {}),
          ...(updatedTeams.length ? { teams: updatedTeams } : {}),
        });
      } catch (error) {
        return sendTeamsJsonError(
          res,
          error,
          "Could not update this submission.",
        );
      }
    },

    async updateTeamScheduleAssignment(req, res) {
      try {
        await assertCsrf(req);
        const existing = await assertTeamEntityInChurch(
          "schedule",
          req.params.scheduleId,
          req.params.churchId,
          { label: "Schedule", active: false },
        );
        const admin = await requireTeamsEditForTeam(
          req,
          req.params.churchId,
          existing.teamId,
        );
        const schedule = await updateTeamScheduleAssignmentInStore({
          churchId: req.params.churchId,
          scheduleId: req.params.scheduleId,
          serviceId: String(req.body?.serviceId || "").trim(),
          positionSlotKey: String(req.body?.positionSlotKey || "").trim(),
          memberId: req.body?.memberId == null ? "" : String(req.body.memberId),
          serviceDate: normalizeOptionalPlainDate(
            req.body?.serviceDate,
            "Service date",
          ),
          sourceServiceId: req.body?.sourceServiceId,
          sourcePositionSlotKey: req.body?.sourcePositionSlotKey,
          shadowAction: req.body?.shadowAction,
          shadowKind: req.body?.shadowKind,
          allowCrossTeamConflict: normalizeAllowCrossTeamConflict(
            req.body?.allowCrossTeamConflict,
          ),
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_schedule_assignment_updated",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          scheduleId: req.params.scheduleId,
          serviceId: String(req.body?.serviceId || "").trim(),
          positionSlotKey: String(req.body?.positionSlotKey || "").trim(),
          memberId: req.body?.memberId || null,
        });
        emitTeamsEvent(req.params.churchId, "schedule-updated", { schedule });
        return res.json({ success: true, schedule });
      } catch (error) {
        return sendTeamsJsonError(
          res,
          error,
          "Could not update this assignment.",
        );
      }
    },

    async updateTeamScheduleAssignmentSwap(req, res) {
      try {
        await assertCsrf(req);
        const existing = await assertTeamEntityInChurch(
          "schedule",
          req.params.scheduleId,
          req.params.churchId,
          { label: "Schedule", active: false },
        );
        const admin = await requireTeamsEditForTeam(
          req,
          req.params.churchId,
          existing.teamId,
        );
        const schedule = await updateTeamScheduleAssignmentSwapInStore({
          churchId: req.params.churchId,
          scheduleId: req.params.scheduleId,
          serviceId: String(req.body?.serviceId || "").trim(),
          targetPositionSlotKey: String(
            req.body?.targetPositionSlotKey || "",
          ).trim(),
          sourcePositionSlotKey: String(
            req.body?.sourcePositionSlotKey || "",
          ).trim(),
          currentMemberId: String(req.body?.currentMemberId || "").trim(),
          candidateMemberId: String(req.body?.candidateMemberId || "").trim(),
          serviceDate: normalizeOptionalPlainDate(
            req.body?.serviceDate,
            "Service date",
          ),
          allowCrossTeamConflict: normalizeAllowCrossTeamConflict(
            req.body?.allowCrossTeamConflict,
          ),
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_schedule_assignment_swap_updated",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          scheduleId: req.params.scheduleId,
          serviceId: String(req.body?.serviceId || "").trim(),
          targetPositionSlotKey: String(
            req.body?.targetPositionSlotKey || "",
          ).trim(),
          sourcePositionSlotKey: String(
            req.body?.sourcePositionSlotKey || "",
          ).trim(),
          currentMemberId: req.body?.currentMemberId || null,
          candidateMemberId: req.body?.candidateMemberId || null,
        });
        emitTeamsEvent(req.params.churchId, "schedule-updated", { schedule });
        return res.json({ success: true, schedule });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not apply this swap.");
      }
    },

    async updateTeamScheduleAttendance(req, res) {
      try {
        await assertCsrf(req);
        const existing = await assertTeamEntityInChurch(
          "schedule",
          req.params.scheduleId,
          req.params.churchId,
          { label: "Schedule", active: false },
        );
        const admin = await requireTeamsEditForTeam(
          req,
          req.params.churchId,
          existing.teamId,
        );
        const payload = validateTeamScheduleAttendanceUpdatePayload(req.body);
        const schedule = await updateTeamScheduleAttendanceInStore({
          churchId: req.params.churchId,
          scheduleId: req.params.scheduleId,
          ...payload,
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_schedule_attendance_updated",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          scheduleId: req.params.scheduleId,
          occurrenceId: payload.occurrenceId,
          memberId: payload.memberId,
        });
        emitTeamsEvent(req.params.churchId, "schedule-updated", { schedule });
        return res.json({ success: true, schedule });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not update attendance.");
      }
    },
  };
};
