import crypto from "node:crypto";
import { emitTeamsEvent } from "./teamsSse.js";
import {
  addServiceFlowSseClient,
  emitServiceFlowUpdated,
  removeServiceFlowSseClient,
} from "./serviceFlowSse.js";
import {
  buildPublicServicePlanSnapshot,
  publicServingMemberIdsForPlan,
  richTextToPlainText,
} from "./servicePlanPublic.js";
// ServicePlan element titles/notes reuse the exact rich text shape (and its
// normalizer) that the ServiceFlow public "order of service" display already
// validates, so a future ServicePlan -> ServiceFlow publish step needs no
// translation.
import { normalizeRichTextDocument } from "./serviceFlowService.js";
import {
  applyAssignmentResponses,
  normalizeAssignmentResponse,
  pruneStaleResponses,
  readAssignmentCellHolderId,
  readAssignmentResponse,
  withAssignmentResponse,
} from "./scheduleResponses.js";
import {
  ASSIGNMENT_TOKEN_TTL_MS,
  createAssignmentResponseToken,
  readAssignmentResponseToken,
} from "./assignmentResponseToken.js";
import {
  findNewlyBlockedSlots,
  hasAddedBlockoutRanges,
  newBlockoutConflictEntries,
} from "./blockoutConflicts.js";
import {
  createNotificationLedger,
  deliveryKey,
} from "./notificationLedger.js";
import {
  isNotificationEnabled,
  normalizeNotificationPreferences,
} from "./notificationPreferences.js";
import {
  findUnreachableMemberIds,
  resolveMemberAddress,
} from "./notificationRecipients.js";

const APP_BASE_URL =
  process.env.AUTH_APP_BASE_URL?.replace(/\/$/, "") ||
  "https://www.worshipsync.net";

// Separate secret from the intake link: the two grant different things, so a
// leak of one must not mint the other.
const assignmentResponseTokenSecret =
  process.env.AUTH_ASSIGNMENT_RESPONSE_TOKEN_SECRET ||
  process.env.AUTH_SESSION_SECRET ||
  "dev-auth-secret";

const teamIntakeTokenSecret =
  process.env.AUTH_TEAM_INTAKE_TOKEN_SECRET ||
  process.env.AUTH_SESSION_SECRET ||
  "dev-auth-secret";

// Upper bound for a single church's per-collection bootstrap query. Sized to
// cover realistic roster/submission growth while still bounding Firestore reads.
const TEAM_COLLECTION_QUERY_LIMIT = 5000;

// Bounds for the self-service blockout endpoint only.
//
// Entries are never pruned, so a single lifetime cap would eventually lock a
// long-serving volunteer out of declaring next summer's holiday because of
// trips they took years ago. Split in two: what a person can have *ahead* of
// them, and how large the stored array may grow.
//
// 100 upcoming entries is far past any real calendar. 400 total keeps the
// member document well inside Firestore's 1 MB limit even with the 500-char
// note each entry allows, while still permitting decades of history.
const MAX_SELF_UPCOMING_BLOCKOUT_RANGES = 100;
const MAX_SELF_BLOCKOUT_RANGES = 400;

// How long a finished blockout is kept before a self-service save drops it.
//
// A year is chosen so the schedule grid still explains a *recent* past service
// ("why was this slot empty last July?") while the stored array reaches a
// steady state instead of growing for the life of the account. Without this the
// only thing standing between a long-serving volunteer and a hard ceiling is
// arithmetic. Pruning happens only on the member's own save; the admin roster
// editor still shows and keeps everything.
const BLOCKOUT_HISTORY_RETENTION_DAYS = 365;

// Guest records are deliberately schedule-scoped: they can be reused by the
// scheduler without becoming roster members or receiving application access.
// A generous per-schedule cap prevents an accidental unbounded document while
// remaining far above the number of one-time helpers a service plan can need.
const MAX_TEAM_SCHEDULE_GUESTS = 200;

export const createTeamsAuthHandlers = ({
  COLLECTIONS,
  scheduleIntakeSubmissionDigest,
  scheduleAssignmentResponseDigest,
  addSecurityEvent,
  assertCsrf,
  createId,
  deleteDoc,
  enforceRateLimit,
  getClientIp,
  getDoc,
  hashValue,
  httpError,
  listMembershipsForChurch,
  normalizeEmail,
  nowIso,
  queryDocs,
  randomSecret,
  readChurchServiceTimes = async () => [],
  readChurchPublicBoardHeaderLogoUrl,
  readChurchPublicBrandingChrome,
  requireAdminSession,
  // Church membership without any teams grant — the guard a volunteer passes.
  requireHumanSession,
  requireServicesEditSession,
  requireServicePlansViewSession,
  requireTeamsEditSession,
  requireTeamsEditForTeamSession,
  requireTeamsViewSession,
  requireFirestore,
  setDoc,
  updateDocFields,
  updateDocMapKeys,
  getUserByUid,
  getChurchById,
  sendEmail,
  renderScheduleAssignmentEmail,
  sendRosterMemberInvite,
  logAuthEvent,
}) => {
  const requireTeamsEdit = requireTeamsEditSession || requireAdminSession;
  const requireServicesEdit = requireServicesEditSession || requireTeamsEdit;
  const requireTeamsEditForTeam =
    requireTeamsEditForTeamSession ||
    ((req, churchId) => requireTeamsEdit(req, churchId));
  const requireTeamsView = requireTeamsViewSession || requireAdminSession;
  // Narrower than requireTeamsView: also admits a view-only paired
  // workstation, but only for reading saved Service Plans (no roster PII).
  const requireServicePlansView =
    requireServicePlansViewSession || requireTeamsView;

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

  /**
   * The link that goes in an assignment email. One per slot, because the token
   * names the slot; a member on two positions gets two links.
   */
  /**
   * The link that goes in an assignment email.
   *
   * `response` carries the reader's intent so Accept in the email *is* the
   * answer — one click, not click-then-click-again. It rides in the URL hash,
   * which is never sent to the server: the intent only becomes a write when the
   * page POSTs it.
   *
   * That indirection is not ceremony. Corporate mail security (Safe Links,
   * Proofpoint and friends) fetches every link in an email before a human sees
   * it; if a GET recorded the answer, scanners would accept on behalf of people
   * who never opened the message. Scanners do not run a single-page app and do
   * not POST, so the write stays with the reader.
   */
  const buildAssignmentResponseUrl = (payload, response = "") => {
    const token = createAssignmentResponseToken(
      assignmentResponseTokenSecret,
      payload,
      Date.now() + ASSIGNMENT_TOKEN_TTL_MS,
    );
    const query = response
      ? `?${new URLSearchParams({ respond: response }).toString()}`
      : "";
    return `${APP_BASE_URL}/#/schedule-response/${encodeURIComponent(token)}${query}`;
  };

  /**
   * Ledger store over Firestore. Doc id is a hash of church + delivery key, so
   * a "have we sent this?" check is a direct get rather than a query — the
   * batch is one read per candidate and needs no index.
   */
  const notificationLedger = createNotificationLedger({
    listKeys: async (churchId, keys) => {
      const rows = await Promise.all(
        keys.map(async (key) => {
          const doc = await getDoc(
            COLLECTIONS.notificationDeliveries,
            hashValue(`${churchId}|${key}`),
          );
          return doc ? key : "";
        }),
      );
      return rows.filter(Boolean);
    },
    saveKey: async (churchId, entry) =>
      setDoc(
        COLLECTIONS.notificationDeliveries,
        hashValue(`${churchId}|${entry.deliveryKey}`),
        { ...entry, churchId, createdAt: nowIso() },
        { merge: true },
      ),
  });

  /**
   * Delivery identity for one assignment notification.
   *
   * The slot is part of it, not just the service: someone already told about
   * Sunday who is then *also* given a second position that day must still hear
   * about it. Keyed on the occurrence alone, that second slot is suppressed
   * forever — invisible to any roster member without an account, since the app
   * is the only other place it would show.
   */
  const assignmentDeliveryId = (schedule, entry) => ({
    recipient: entry.email,
    event: "schedule.assigned",
    subject: schedule.scheduleId,
    occurrence: `${entry.occurrenceId}#${entry.cellKey}`,
  });

  /** Local date/time for an occurrence, as the reader would say it aloud. */
  const formatAssignmentWhen = (startsAt) => {
    const parsed = startsAt ? new Date(startsAt) : null;
    if (!parsed || Number.isNaN(parsed.getTime())) return "Date to be confirmed";
    return parsed.toLocaleString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  /**
   * Email everyone newly on this schedule, once each.
   *
   * Three filters, in order, each for a different reason:
   * 1. **Reachable** — no address means no email. Reported back so the owner
   *    learns who was not told rather than assuming everyone was.
   * 2. **Opted in** — only for linked accounts; an unlinked roster member has
   *    no membership to hold a preference, and defaults to on.
   * 3. **Not already sent** — the ledger, keyed per occurrence, so adding one
   *    person and re-sending mails only the new slots.
   */
  const notifyScheduleAssignments = async ({ churchId, schedule, slots }) => {
    const church = await getChurchById(churchId);
    const memberships = (await listMembershipsForChurch(churchId)) || [];
    const membershipByUserId = new Map(
      memberships
        .filter((row) => row.status === "active")
        .map((row) => [row.userId, row]),
    );

    // Account addresses for linked members, resolved once.
    const accountByUserId = new Map();
    await Promise.all(
      [...new Set(slots.map((slot) => slot.member.userId).filter(Boolean))].map(
        async (userId) => {
          const user = await getUserByUid(userId);
          accountByUserId.set(userId, {
            email: user?.primaryEmail || user?.email || "",
          });
        },
      ),
    );
    const lookupAccount = (userId) => accountByUserId.get(userId) || null;

    const unreachableMemberIds = [
      ...new Set(
        findUnreachableMemberIds(
          slots.map((slot) => slot.member),
          lookupAccount,
        ),
      ),
    ];

    const candidates = [];
    for (const slot of slots) {
      const { email, reachable } = resolveMemberAddress(
        slot.member,
        lookupAccount,
      );
      if (!reachable) continue;
      const membership = slot.member.userId
        ? membershipByUserId.get(slot.member.userId)
        : null;
      // Unlinked members have no membership and so no stored preference; the
      // category default (on) applies, which is what keeps a roster-only
      // volunteer reachable at all.
      if (
        membership &&
        !isNotificationEnabled(
          "scheduleAssignments",
          normalizeNotificationPreferences(membership.notifications)
            .scheduleAssignments,
        )
      ) {
        continue;
      }
      candidates.push({ ...slot, email });
    }

    const { pending } = await notificationLedger.selectPending(
      churchId,
      candidates.map((candidate) => assignmentDeliveryId(schedule, candidate)),
    );
    const pendingKeys = new Set(pending.map((entry) => entry.deliveryKey));
    const toSend = candidates.filter((candidate) =>
      pendingKeys.has(deliveryKey(assignmentDeliveryId(schedule, candidate))),
    );

    // One email per person listing every slot, not one per slot: three emails
    // for three Sundays is how people learn to ignore them.
    const byRecipient = new Map();
    for (const candidate of toSend) {
      const bucket = byRecipient.get(candidate.email) || [];
      bucket.push(candidate);
      byRecipient.set(candidate.email, bucket);
    }

    let sentCount = 0;
    await Promise.all(
      [...byRecipient.entries()].map(async ([email, entries]) => {
        const ordered = [...entries].sort((a, b) =>
          String(a.startsAt).localeCompare(String(b.startsAt)),
        );
        try {
          const { html, text } = await renderScheduleAssignmentEmail({
            churchName: church?.name || "",
            memberFirstName: ordered[0]?.member?.firstName || "",
            scheduleUrl: `${APP_BASE_URL}/#/my-schedule`,
            // One link for the whole email. It opens a page listing every
            // service below, answerable individually or all at once — four
            // services once meant four links to a page that could not even say
            // which service it was asking about.
            acceptUrl: buildAssignmentResponseUrl(
              {
                churchId,
                scheduleId: schedule.scheduleId,
                memberId: ordered[0].member.memberId,
              },
              "accepted",
            ),
            declineUrl: buildAssignmentResponseUrl(
              {
                churchId,
                scheduleId: schedule.scheduleId,
                memberId: ordered[0].member.memberId,
              },
              "declined",
            ),
            assignments: ordered.map((entry) => ({
              serviceName: entry.serviceName,
              when: formatAssignmentWhen(entry.startsAt),
              positionName: entry.positionName,
              teamName: schedule.teamName || "",
            })),
          });
          await sendEmail({
            to: email,
            subject:
              ordered.length === 1
                ? `You are scheduled for ${ordered[0].serviceName}`
                : `You are scheduled for ${ordered.length} services`,
            textBody: text,
            htmlBody: html,
            tags: { type: "schedule_assigned" },
          });
          sentCount += 1;
          // Recorded only after the send succeeds: a failure should retry on
          // the next send, not be silently marked delivered.
          await Promise.all(
            ordered.map((entry) =>
              notificationLedger.record(
                churchId,
                assignmentDeliveryId(schedule, entry),
              ),
            ),
          );
        } catch (error) {
          logAuthEvent("warn", "schedule.assigned.send-error", {
            scheduleId: schedule.scheduleId,
            errorMessage: error?.message || "send failed",
          });
        }
      }),
    );

    return {
      notified: sentCount,
      alreadyNotified: candidates.length - toSend.length,
      unreachableMemberIds,
    };
  };

  /**
   * Verify an emailed response token, or throw the message the reader needs.
   * Expired is worth distinguishing: they did nothing wrong and the fix is to
   * ask for a fresh link, not to hunt for a typo.
   */
  const assertAssignmentToken = (token) => {
    const read = readAssignmentResponseToken(
      assignmentResponseTokenSecret,
      token,
    );
    if (!read.valid) {
      throw httpError(
        read.reason === "expired" ? 410 : 404,
        read.reason === "expired"
          ? "This link has expired. Ask your team lead to resend it."
          : "This link is not valid. Ask your team lead to resend it.",
      );
    }
    return read.payload;
  };

  /**
   * Responses re-derived against a new assignment map.
   *
   * Called wherever assignments change. Reads already treat a mismatched holder
   * as pending, which is safe for whoever *arrives* in a slot — but the record
   * lingers, so clearing someone off a cell and later putting them back
   * resurrects their old decline as though they had answered again. The owner
   * sees a "no" nobody gave, and the fill count treats the slot as uncovered.
   */
  const prunedResponsesForAssignments = (responses, assignments) =>
    pruneStaleResponses(responses, (occurrenceId, cellKey) =>
      readCellHolderId(assignments?.[occurrenceId]?.[cellKey]),
    );

  /**
   * Re-derive and store responses after a write that rewrote assignments.
   *
   * Deliberately a separate, field-replacing write rather than part of the
   * merged payload: a merged set deep-merges maps, so pruned entries would come
   * straight back and the prune would be a no-op in production while passing in
   * memory.
   */
  const syncScheduleResponsesToAssignments = async (schedule) => {
    if (!schedule?.scheduleId) return schedule;
    const responses = prunedResponsesForAssignments(
      schedule.responses,
      schedule.assignments,
    );
    if (
      JSON.stringify(responses) === JSON.stringify(schedule.responses || {})
    ) {
      return schedule;
    }
    await updateDocFields(COLLECTIONS.teamSchedules, schedule.scheduleId, {
      responses,
    });
    return { ...schedule, responses };
  };

  // One definition, shared with the pure modules that also have to read cells.
  const readCellHolderId = readAssignmentCellHolderId;

  /**
   * Write one or more answers for a member, atomically.
   *
   * **Transactional because the map is replaced wholesale.** `responses` is a
   * single field; a read-modify-write from a stale snapshot silently discards
   * whatever landed in between. Right after a send is exactly when several
   * volunteers answer at once, so the lost write is not a rare race — it is the
   * expected traffic pattern.
   *
   * Slots the member no longer holds are skipped rather than failing the whole
   * batch: with one link covering a whole schedule, an owner reshuffling one
   * date must not block the reader from answering the other three.
   */
  const writeAssignmentResponses = async ({
    churchId,
    scheduleId,
    memberId,
    targets,
    response,
    actorUid,
  }) => {
    // The decision is pure and unit-tested (`applyAssignmentResponses`), because
    // only the in-memory branch below is reachable from the test suite.
    const apply = (schedule) => {
      if (!schedule || schedule.churchId !== churchId) {
        throw httpError(404, "That schedule is no longer available.");
      }
      const result = applyAssignmentResponses(schedule, {
        memberId,
        targets,
        response,
        respondedAt: nowIso(),
        readHolder: readCellHolderId,
      });
      if (result.applied === 0) {
        throw httpError(
          409,
          "This assignment changed. Your team lead will be in touch.",
        );
      }
      return result;
    };

    const db = requireFirestore();
    if (!db) {
      const schedule = await getTeamEntity("schedule", scheduleId);
      const { responses, applied } = apply(schedule);
      await setDoc(
        COLLECTIONS.teamSchedules,
        scheduleId,
        {
          responses,
          updatedAt: nowIso(),
          ...(actorUid ? { updatedByUid: actorUid } : {}),
        },
        { merge: true },
      );
      return { schedule: { ...schedule, responses }, applied };
    }

    return db.runTransaction(async (transaction) => {
      const ref = db.collection(COLLECTIONS.teamSchedules).doc(scheduleId);
      const snapshot = await transaction.get(ref);
      const schedule = readTransactionTeamEntity(
        snapshot,
        "scheduleId",
        "Schedule",
      );
      const { responses, applied } = apply(schedule);
      transaction.set(
        ref,
        {
          responses,
          updatedAt: nowIso(),
          ...(actorUid ? { updatedByUid: actorUid } : {}),
        },
        { merge: true },
      );
      return { schedule: { ...schedule, responses }, applied };
    });
  };

  /**
   * Every slot a member holds on a schedule, with enough context to answer:
   * which service, when, and what they were asked to do. This is what the
   * emailed link needs — a bare "Can you serve?" with no service named is not
   * something anyone can answer.
   */
  const listMemberSlotKeys = (schedule, memberId) => {
    const slots = [];
    Object.entries(schedule.assignments || {}).forEach(([occurrenceId, row]) => {
      Object.entries(row || {}).forEach(([cellKey, cell]) => {
        if (readCellHolderId(cell) === memberId) {
          slots.push({ occurrenceId, cellKey });
        }
      });
    });
    return slots;
  };

  /**
   * Tell owners when a member's own time-off save clashes with a slot they hold.
   *
   * Rides the existing response digest — same 20-minute window, same marker,
   * same email. A blockout and a decline are the same fact to an owner ("this
   * person cannot serve, refill the slot"), and splitting them into two messages
   * twenty minutes apart is worse for the person who has to act on both.
   *
   * The write is a **merging set with no `updatedAt`**. Bumping the stamp would
   * hand a spurious 409 to an editor mid-save over a change that touches nothing
   * they are editing, and merge is what lets two members blocking out at the
   * same moment each land their own keys in the map.
   *
   * Best-effort by construction: the member's save has already succeeded by the
   * time this runs, and failing their request because an owner's email could not
   * be queued would be the wrong trade every time.
   */
  const recordBlockoutConflicts = async ({
    churchId,
    memberId,
    previousRanges,
    nextRanges,
  }) => {
    // Most saves remove a finished trip or fix a note. Reading every schedule in
    // the church for those is pure cost.
    if (!hasAddedBlockoutRanges(previousRanges, nextRanges)) return;

    const schedules = await listTeamCollectionForChurch(
      COLLECTIONS.teamSchedules,
      "scheduleId",
      churchId,
    );
    const blockedAt = nowIso();

    for (const schedule of schedules) {
      if (!schedule?.scheduleId || schedule.archivedAt) continue;
      const slots = findNewlyBlockedSlots(schedule, {
        memberId,
        previousRanges,
        nextRanges,
        readHolder: readCellHolderId,
        fromDate: blockedAt.slice(0, 10),
      });
      if (slots.length === 0) continue;

      const added = newBlockoutConflictEntries(
        schedule.pendingBlockoutConflicts,
        slots.map((slot) => ({ ...slot, memberId })),
        blockedAt,
      );
      if (Object.keys(added).length === 0) continue;

      // Only the new keys, written individually. Writing the merged map back
      // would re-assert everything this snapshot happened to contain — and a
      // digest clearing keys in between would see them resurrected and email
      // the same clash twice.
      await updateDocMapKeys(
        COLLECTIONS.teamSchedules,
        schedule.scheduleId,
        "pendingBlockoutConflicts",
        { set: added },
      );
      await scheduleAssignmentResponseDigest(schedule.scheduleId, blockedAt);
    }
  };

  const listMemberAssignmentsOnSchedule = async (schedule, memberId) => {
    const positions = await listTeamCollectionForChurch(
      COLLECTIONS.teamPositions,
      "positionId",
      schedule.churchId,
    );
    const positionNameById = new Map(
      positions.map((row) => [row.positionId, row.name]),
    );
    const slots = [];
    Object.entries(schedule.assignments || {}).forEach(([occurrenceId, row]) => {
      Object.entries(row || {}).forEach(([cellKey, cell]) => {
        if (readCellHolderId(cell) !== memberId) return;
        const occurrence = (schedule.occurrences || []).find(
          (item) => item?.occurrenceId === occurrenceId,
        );
        slots.push({
          occurrenceId,
          cellKey,
          serviceName: occurrence?.name || "Service",
          startsAt: occurrence?.startsAt || "",
          positionName:
            positionNameById.get(String(cellKey).split("::")[0]) || "",
          ...readAssignmentResponse(
            schedule.responses?.[occurrenceId]?.[cellKey],
            memberId,
          ),
        });
      });
    });
    return slots.sort((a, b) =>
      String(a.startsAt).localeCompare(String(b.startsAt)),
    );
  };

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

  /**
   * A member's email is a **contact address, not an identity**. It is never used
   * to infer which account a member belongs to — linking happens only through an
   * accepted invite or a logged-in intake submission. That is deliberate:
   * addresses are legitimately shared (a parent covering two teen volunteers),
   * so matching on them would attach people to the wrong schedule.
   *
   * Consequently duplicates are allowed and no uniqueness is enforced.
   * Returns "" when absent, so members stay valid without one.
   */
  const normalizeMemberEmail = (value) => {
    const trimmed = normalizeShortText(value, { max: 254 });
    if (!trimmed) return "";
    const normalized = normalizeEmail
      ? normalizeEmail(trimmed)
      : trimmed.toLowerCase();
    // Deliberately permissive: reject only what cannot be an address at all.
    // Over-strict validation rejects valid real-world addresses, and a bad
    // address here costs a bounced notification, not a broken roster.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      throw httpError(400, "Enter a valid email address.");
    }
    return normalized;
  };

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

  const normalizeBirthDate = (value, fieldLabel = "Birthday") => {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "object" || Array.isArray(value)) {
      throw httpError(400, `${fieldLabel} must include a month and day.`);
    }
    const month = Number(value.month);
    const day = Number(value.day);
    const year = value.year === undefined || value.year === null || value.year === ""
      ? undefined
      : Number(value.year);
    const currentYear = new Date().getUTCFullYear();
    if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(day) || day < 1 || day > 31) {
      throw httpError(400, `${fieldLabel} must include a valid month and day.`);
    }
    const validationYear = year === undefined ? 2000 : year;
    if (
      !Number.isInteger(validationYear) ||
      (year !== undefined && (year < 1 || year > currentYear))
    ) {
      throw httpError(400, `${fieldLabel} must include a valid year.`);
    }
    const parsed = new Date(Date.UTC(validationYear, month - 1, day));
    if (parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
      throw httpError(400, `${fieldLabel} must include a valid month and day.`);
    }
    return { month, day, ...(year === undefined ? {} : { year }) };
  };

  const TEAM_MEMBER_SERVING_FREQUENCIES = new Set([
    "as_needed",
    "weekly",
    "twice_monthly",
    "monthly",
  ]);

  const normalizeTeamMemberServingFrequency = (value) => {
    const normalized = String(value || "as_needed").trim();
    if (!TEAM_MEMBER_SERVING_FREQUENCIES.has(normalized)) {
      throw httpError(400, "Choose a valid serving preference.");
    }
    return normalized;
  };

  const normalizeMemberProfileImage = (value, fieldLabel) => {
    const normalized = normalizeShortText(value, { max: 2048 });
    if (!normalized) return "";
    let parsed;
    try {
      parsed = new URL(normalized);
    } catch {
      throw httpError(400, `${fieldLabel} must be a valid URL.`);
    }
    if (parsed.protocol !== "https:" || parsed.hostname !== "res.cloudinary.com") {
      throw httpError(400, `${fieldLabel} must be hosted by Cloudinary.`);
    }
    return normalized;
  };

  const normalizeTeamMemberRecurringAvailability = (value) => {
    if (value === undefined || value === null) {
      return { weeksOfMonth: [], includeLastWeekOfMonth: false };
    }
    if (typeof value !== "object" || Array.isArray(value)) {
      throw httpError(400, "Choose valid recurring availability weeks.");
    }
    const rawWeeks = value.weeksOfMonth;
    if (rawWeeks !== undefined && !Array.isArray(rawWeeks)) {
      throw httpError(400, "Choose valid recurring availability weeks.");
    }
    const weeksOfMonth = Array.from(
      new Set(
        (rawWeeks || []).map((week) => {
          if (!Number.isInteger(week) || week < 1 || week > 5) {
            throw httpError(400, "Choose valid recurring availability weeks.");
          }
          return week;
        }),
      ),
    ).sort((a, b) => a - b);
    if (
      value.includeLastWeekOfMonth !== undefined &&
      typeof value.includeLastWeekOfMonth !== "boolean"
    ) {
      throw httpError(400, "Last-week availability must be true or false.");
    }
    return {
      weeksOfMonth,
      includeLastWeekOfMonth: value.includeLastWeekOfMonth === true,
    };
  };

  const isMinorFromBirthDate = (birthDate, referenceDate = new Date()) => {
    if (!birthDate?.year) return null;
    const { year, month, day } = birthDate;
    const eighteenthBirthday = Date.UTC(year + 18, month - 1, day);
    const today = Date.UTC(
      referenceDate.getUTCFullYear(),
      referenceDate.getUTCMonth(),
      referenceDate.getUTCDate(),
    );
    return today < eighteenthBirthday;
  };

  const normalizeManualMinorStatus = (value) => {
    if (value === undefined) return false;
    if (typeof value !== "boolean") {
      throw httpError(400, "Minor status must be true or false.");
    }
    return value;
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
  const buildServicePlanDocId = (churchId, planKey) =>
    `${churchId}::${planKey}`;

  const MAX_SERVICE_PLAN_TEAM_NOTES = 12;
  const MAX_SERVICE_PLAN_ATTACHMENTS = 20;
  // Keep in sync with MAX_SERVICE_PLAN_MICROPHONES in client/src/types/servicePlan.ts
  const MAX_SERVICE_PLAN_MICROPHONES = 80;
  const MAX_SERVICE_PLAN_MICROPHONE_AUDIENCES = 24;
  const MAX_SERVICE_PLAN_ASSIGNEES = 24;
  const MAX_SERVICE_PLAN_POSITIONS = 40;

  const isRichTextDocEmpty = (doc) =>
    !doc?.blocks?.length ||
    doc.blocks.every((block) => block.spans.every((span) => !span.text.trim()));

  const normalizeServicePlanTeamNote = (raw) => {
    if (!raw || typeof raw !== "object") return null;
    const label = normalizeShortText(raw.label, { max: 80 });
    if (!label) return null;
    const scope = raw.scope === "role" ? "role" : "team";
    const positionIds = Array.from(
      new Set(
        (Array.isArray(raw.positionIds) ? raw.positionIds : [raw.positionId])
          .map((positionId) => normalizeShortText(positionId, { max: 160 }))
          .filter(Boolean),
      ),
    );
    const teamId = normalizeShortText(raw.teamId, { max: 160 });
    const teamName = normalizeShortText(raw.teamName, { max: 80 });
    const teamIds = Array.from(
      new Set(
        (Array.isArray(raw.teamIds) ? raw.teamIds : [teamId])
          .map((id) => normalizeShortText(id, { max: 160 }))
          .filter(Boolean),
      ),
    );
    const teamNames = Array.from(
      new Set(
        (Array.isArray(raw.teamNames) ? raw.teamNames : [teamName])
          .map((name) => normalizeShortText(name, { max: 80 }))
          .filter(Boolean),
      ),
    );
    if (scope === "role" && !positionIds.length) return null;
    return {
      id:
        normalizeShortText(raw.id, { max: 160 }) ||
        createId("servicePlanTeamNote"),
      label,
      note: normalizeRichTextDocument(raw.note),
      ...(scope === "role"
        ? {
            scope,
            positionIds,
            ...(teamIds.length ? { teamIds } : {}),
            ...(teamNames.length ? { teamNames } : {}),
          }
        : {
            ...(teamId ? { teamId } : {}),
            ...(teamName ? { teamName } : {}),
          }),
    };
  };

  const normalizeServicePlanMicrophone = (raw) => {
    if (!raw || typeof raw !== "object") return null;
    const name = normalizeShortText(raw.name, { max: 80 });
    if (!name) return null;
    const color = String(raw.color || "").trim();
    return {
      id:
        normalizeShortText(raw.id, { max: 160 }) ||
        createId("servicePlanMicrophone"),
      name,
      type: normalizeShortText(raw.type, { max: 80 }) || "Microphone",
      color: /^#[0-9a-f]{6}$/i.test(color) ? color : "#9ca3af",
    };
  };

  const normalizeServicePlanMicrophoneAudience = (raw) => {
    if (!raw || typeof raw !== "object") return null;
    const positionId = normalizeShortText(raw.positionId, { max: 160 });
    const roleName = normalizeShortText(raw.roleName, { max: 120 });
    if (!positionId || !roleName) return null;
    const teamId = normalizeShortText(raw.teamId, { max: 160 });
    const teamName = normalizeShortText(raw.teamName, { max: 120 });
    return {
      positionId,
      roleName,
      ...(teamId ? { teamId } : {}),
      ...(teamName ? { teamName } : {}),
    };
  };

  const normalizeServicePlanMicrophoneAudiences = (raw) =>
    (Array.isArray(raw) ? raw : [])
      .map(normalizeServicePlanMicrophoneAudience)
      .filter(Boolean)
      .filter(
        (audience, index, values) =>
          values.findIndex(
            (candidate) => candidate.positionId === audience.positionId,
          ) === index,
      )
      .slice(0, MAX_SERVICE_PLAN_MICROPHONE_AUDIENCES);

  /**
   * Everyone doing an item, and the microphones each of them carries. An entry
   * with no name and no memberId is the unassigned slot: a stand or spare mic.
   * Entries holding nothing at all are dropped rather than stored as blanks.
   */
  const normalizeServicePlanAssignees = (raw) => {
    const usedMicrophoneIds = new Set();
    return (Array.isArray(raw) ? raw : [])
      .map((assignee) => {
        if (!assignee || typeof assignee !== "object") return null;
        const name = normalizeShortText(assignee.name, { max: 200 });
        const memberId = normalizeShortText(assignee.memberId, { max: 160 });
        // A microphone can only be in one pair of hands per item.
        const microphoneIds = (
          Array.isArray(assignee.microphoneIds) ? assignee.microphoneIds : []
        )
          .map((microphoneId) => normalizeShortText(microphoneId, { max: 160 }))
          .filter((microphoneId) => {
            if (!microphoneId || usedMicrophoneIds.has(microphoneId))
              return false;
            usedMicrophoneIds.add(microphoneId);
            return true;
          })
          .slice(0, MAX_SERVICE_PLAN_ATTACHMENTS);
        if (!name && !memberId && !microphoneIds.length) return null;
        return {
          id:
            normalizeShortText(assignee.id, { max: 160 }) ||
            createId("servicePlanAssignee"),
          ...(name ? { name } : {}),
          ...(memberId ? { memberId } : {}),
          ...(microphoneIds.length ? { microphoneIds } : {}),
        };
      })
      .filter(Boolean)
      .slice(0, MAX_SERVICE_PLAN_ASSIGNEES);
  };

  const normalizeServicePlanMicrophoneAssignments = (raw) =>
    (Array.isArray(raw) ? raw : [])
      .map((assignment) => {
        const microphoneId = normalizeShortText(assignment?.microphoneId, {
          max: 160,
        });
        if (!microphoneId) return null;
        const audiences = (
          Array.isArray(assignment?.audiences) ? assignment.audiences : []
        )
          .map(normalizeServicePlanMicrophoneAudience)
          .filter(Boolean)
          .filter(
            (audience, index, values) =>
              values.findIndex(
                (candidate) => candidate.positionId === audience.positionId,
              ) === index,
          )
          .slice(0, MAX_SERVICE_PLAN_MICROPHONE_AUDIENCES);
        return {
          microphoneId,
          ...(audiences.length ? { audiences } : {}),
        };
      })
      .filter(Boolean)
      .filter(
        (assignment, index, values) =>
          values.findIndex(
            (candidate) => candidate.microphoneId === assignment.microphoneId,
          ) === index,
      )
      .slice(0, MAX_SERVICE_PLAN_ATTACHMENTS);

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

  /** A parsed passage reference, not verse text — the Bible item is built from
   * it at push-to-outline time. `book` and `chapter` are the minimum needed to
   * rebuild a reference, so a partial ref is dropped rather than half-stored. */
  const normalizeServicePlanScriptureRef = (raw) => {
    if (!raw || typeof raw !== "object") return undefined;
    const book = normalizeShortText(raw.book, { max: 100 });
    const chapter = normalizeShortText(raw.chapter, { max: 20 });
    if (!book || !chapter) return undefined;
    return {
      label: normalizeShortText(raw.label, { max: 300 }),
      book,
      chapter,
      verseRange: normalizeShortText(raw.verseRange, { max: 50 }),
      version: normalizeShortText(raw.version, { max: 50 }),
    };
  };

  const normalizeServicePlanAttachments = (
    raw,
    normalizeAttachment,
    legacy,
  ) => {
    const values = Array.isArray(raw) ? raw : legacy ? [legacy] : [];
    const normalized = values
      .map(normalizeAttachment)
      .filter(Boolean)
      .slice(0, MAX_SERVICE_PLAN_ATTACHMENTS);
    return normalized.length ? normalized : undefined;
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
    const songRefs = normalizeServicePlanAttachments(
      raw?.songRefs,
      normalizeServicePlanSongRef,
      raw?.songRef,
    );
    const scriptureRefs = normalizeServicePlanAttachments(
      raw?.scriptureRefs,
      normalizeServicePlanScriptureRef,
      raw?.scriptureRef,
    );
    const notes = normalizeRichTextDocument(raw?.notes);
    const teamNotes = Array.isArray(raw?.teamNotes)
      ? raw.teamNotes
          .map(normalizeServicePlanTeamNote)
          .filter(Boolean)
          .slice(0, MAX_SERVICE_PLAN_TEAM_NOTES)
      : undefined;
    const assignees = normalizeServicePlanAssignees(raw?.assignees);
    const microphoneAssignments = normalizeServicePlanMicrophoneAssignments(
      raw?.microphoneAssignments,
    );
    const durationSeconds = normalizeServicePlanDurationSeconds(
      raw?.durationSeconds,
      raw?.durationMinutes,
    );
    return {
      id:
        normalizeShortText(raw?.id, { max: 160 }) ||
        createId("servicePlanElement"),
      ...(raw?.sourcePlanningManaged === true
        ? { sourcePlanningManaged: true }
        : {}),
      type: SERVICE_PLAN_ELEMENT_TYPES.has(raw?.type) ? raw.type : "free",
      title: normalizeRichTextDocument(raw?.title),
      ...(isRichTextDocEmpty(notes) ? {} : { notes }),
      ...(teamNotes?.length ? { teamNotes } : {}),
      ...(assignees.length ? { assignees } : {}),
      // Legacy shapes are still accepted from a client that has not reloaded
      // yet, and converted for good by
      // scripts/migrate-service-plan-assignees.js. Never written alongside
      // `assignees`, so a migrated document keeps exactly one source of truth.
      ...(assignees.length
        ? {}
        : {
            ...(microphoneAssignments.length ? { microphoneAssignments } : {}),
            assignedMemberId:
              normalizeShortText(raw?.assignedMemberId, { max: 160 }) ||
              undefined,
            assignedName:
              normalizeShortText(raw?.assignedName, { max: 200 }) || undefined,
          }),
      startTime: normalizeServicePlanStartTime(raw?.startTime),
      ...(durationSeconds === undefined
        ? {}
        : {
            durationSeconds,
            // Retained while older clients and integrations still read minutes.
            durationMinutes: durationSeconds / 60,
          }),
      songRefs,
      scriptureRefs,
      // The singular fields are still written, the same way durationMinutes is
      // above: mid-rollout an older tab reads only these, and a save it did not
      // make would otherwise look to it like the attachments had vanished.
      songRef: songRefs?.[0],
      scriptureRef: scriptureRefs?.[0],
      positionId:
        normalizeShortText(raw?.positionId, { max: 160 }) || undefined,
      scheduledPositionIds: Array.from(
        new Set(
          (Array.isArray(raw?.scheduledPositionIds)
            ? raw.scheduledPositionIds
            : raw?.positionId
              ? [raw.positionId]
              : []
          )
            .map((positionId) => normalizeShortText(positionId, { max: 160 }))
            .filter(Boolean),
        ),
      ).slice(0, MAX_SERVICE_PLAN_POSITIONS),
      sourceLedByRaw:
        normalizeShortText(raw?.sourceLedByRaw, { max: 200 }) || undefined,
      sourceElementTypeRaw:
        normalizeShortText(raw?.sourceElementTypeRaw, { max: 200 }) ||
        undefined,
      pushedOutlineListId:
        normalizeShortText(raw?.pushedOutlineListId, { max: 160 }) || undefined,
      pushedOutlineListIds: Array.from(
        new Set(
          (Array.isArray(raw?.pushedOutlineListIds)
            ? raw.pushedOutlineListIds
            : []
          )
            .map((listId) => normalizeShortText(listId, { max: 160 }))
            .filter(Boolean),
        ),
      ).slice(0, MAX_SERVICE_PLAN_ATTACHMENTS),
    };
  };

  const normalizeServicePlanSection = (raw) => ({
    id:
      normalizeShortText(raw?.id, { max: 160 }) ||
      createId("servicePlanSection"),
    ...(raw?.sourcePlanningManaged === true
      ? { sourcePlanningManaged: true }
      : {}),
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
    const groupId =
      normalizeShortText(body?.groupId, { max: 160 }) || undefined;
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
    // Optional fields are written as explicit nulls rather than omitted:
    // saves use `merge: true`, so an omitted key leaves the previous value in
    // place and an operator clearing a start time / group / import would
    // silently keep the old one.
    return {
      churchId,
      planKey,
      serviceId,
      serviceIds,
      groupId: groupId ?? null,
      date,
      name,
      startsAt: startsAt ?? null,
      timezone: timezone ?? null,
      sections,
      sourceImport: sourceImport ?? null,
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

  const servicePlanTemplateConflict = (template) => {
    const error = httpError(
      409,
      "This template was updated by another editor. Review the latest changes before saving.",
    );
    error.servicePlanTemplateConflict = template;
    return error;
  };

  /** Same contract as assertServicePlanRevision, for templates. */
  const assertServicePlanTemplateRevision = (existing, baseRevision) => {
    if (baseRevision === undefined || !existing) return;
    if (baseRevision !== getServicePlanRevision(existing)) {
      throw servicePlanTemplateConflict(existing);
    }
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
      (existing?.publicLive?.mode === "manual" ||
        existing?.publicLive?.mode === "anchored") &&
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
    const serviceId =
      normalizeShortText(body?.serviceId, { max: 160 }) || undefined;
    const sections = Array.isArray(body?.sections)
      ? body.sections.map(normalizeServicePlanSection)
      : [];
    return {
      name,
      ...(serviceId ? { serviceId } : {}),
      sections,
    };
  };

  /**
   * Raw share tokens are capabilities: anyone holding one can read the team
   * view, operational notes included. They must never travel to a Teams
   * *viewer*, and never over the church-wide Teams SSE stream, which every
   * viewer is on. Hashes stay server-side too — they're the lookup key.
   */
  const SERVICE_PLAN_SECRET_FIELDS = [
    "publicLinkToken",
    "publicTokenHash",
    "publicGeneralLinkToken",
    "publicGeneralTokenHash",
  ];

  const withoutServicePlanSecrets = (plan) => {
    if (!plan || typeof plan !== "object") return plan;
    const safe = { ...plan };
    for (const field of SERVICE_PLAN_SECRET_FIELDS) delete safe[field];
    return safe;
  };

  /** Whether this request may edit Teams data, as a boolean rather than a throw. */
  const hasServicesEditAccess = async (req, churchId) => {
    try {
      await requireServicesEdit(req, churchId);
      return true;
    } catch {
      return false;
    }
  };

  const createServicePlanPublicToken = () =>
    crypto.randomBytes(24).toString("base64url");

  const buildPublicServicePlanUrl = (token) =>
    `${APP_BASE_URL}/#/services/${encodeURIComponent(String(token || "").trim())}`;

  const ensureChurchCurrentServiceTokens = async (churchId, adminUid) => {
    const church = await getDoc(COLLECTIONS.churches, churchId);
    const currentTeamToken = normalizeShortText(
      church?.currentServiceTeamToken,
      {
        max: 200,
      },
    );
    const currentGeneralToken = normalizeShortText(
      church?.currentServiceGeneralToken,
      {
        max: 200,
      },
    );
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
    const durationMs = (plan?.sections || [])
      .flatMap((section) => section?.elements || [])
      .reduce((total, element) => {
        const minutes = Number(element?.durationMinutes);
        return (
          total +
          (Number.isFinite(minutes) && minutes > 0 ? minutes * 60_000 : 0)
        );
      }, 0);
    return startsAtMs + Math.max(durationMs, MIN_CURRENT_SERVICE_WINDOW_MS);
  };

  /**
   * How far ahead a church's sticky "current service" link will resolve. The
   * link is meant to point at the service happening now or imminently; without
   * a bound it would hand a leaked URL access to every future plan a church
   * ever publishes.
   */
  const CURRENT_SERVICE_LOOKAHEAD_MS = 7 * 24 * 60 * 60_000;

  const getCurrentPublishedServicePlan = async (churchId) => {
    const plans = await queryDocs(
      COLLECTIONS.servicePlans,
      [{ field: "churchId", value: churchId }],
      { limit: TEAM_COLLECTION_QUERY_LIMIT },
    );
    const now = Date.now();
    const eligible = plans
      .filter(
        (plan) => plan?.published && plan?.publicLinkToken && plan?.startsAt,
      )
      .map((plan) => ({
        plan,
        startsAtMs: Date.parse(plan.startsAt),
        endsAtMs: getServicePlanEndMs(plan),
      }))
      .filter(
        ({ startsAtMs, endsAtMs }) =>
          !Number.isNaN(startsAtMs) && endsAtMs !== null,
      );
    const active = eligible
      .filter(({ startsAtMs, endsAtMs }) => startsAtMs <= now && now < endsAtMs)
      .sort((left, right) => right.startsAtMs - left.startsAtMs)[0];
    if (active) return active.plan;
    const next = eligible
      .filter(
        ({ startsAtMs }) =>
          startsAtMs > now && startsAtMs <= now + CURRENT_SERVICE_LOOKAHEAD_MS,
      )
      .sort((left, right) => left.startsAtMs - right.startsAtMs)[0];
    if (next) return next.plan;
    // Deliberately no fall back to the most recent past plan: that made a
    // leaked link a permanent reader of the last service's team notes, and
    // unpublishing the current plan would not revoke it.
    return null;
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
    const startedAtMs = Date.parse(String(raw?.startedAt || ""));
    if (
      raw?.mode === "anchored" &&
      getPlanElementIds(plan).has(currentElementId) &&
      Number.isFinite(startedAtMs)
    ) {
      return {
        mode: "anchored",
        currentElementId,
        startedAt: new Date(startedAtMs).toISOString(),
      };
    }
    if (
      raw?.mode === "manual" &&
      getPlanElementIds(plan).has(currentElementId)
    ) {
      return { mode: "manual", currentElementId };
    }
    return { mode: "schedule" };
  };

  // `docId` is passed explicitly rather than read off `plan.planId`: a doc
  // written before planId was stamped (or a partial one) would otherwise be
  // written under the literal string "undefined", stranding the token hashes.
  const ensureServicePlanPublicTokens = async (plan, adminUid, docId) => {
    const existingTeamToken = normalizeShortText(plan?.publicLinkToken, {
      max: 200,
    });
    const existingGeneralToken = normalizeShortText(
      plan?.publicGeneralLinkToken,
      {
        max: 200,
      },
    );
    const publicLinkToken = existingTeamToken || createServicePlanPublicToken();
    const publicGeneralLinkToken =
      existingGeneralToken || createServicePlanPublicToken();
    if (!existingTeamToken || !existingGeneralToken) {
      await setDoc(
        COLLECTIONS.servicePlans,
        docId,
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
        const plan = await getCurrentPublishedServicePlan(
          currentTeamChurch.churchId,
        );
        if (plan) return { plan, viewMode: "team", token: trimmed };
      }
      const [currentGeneralChurch] = await queryDocs(
        COLLECTIONS.churches,
        [
          {
            field: "currentServiceGeneralTokenHash",
            value: hashValue(trimmed),
          },
        ],
        { limit: 1 },
      );
      if (currentGeneralChurch?.currentServiceGeneralToken) {
        const plan = await getCurrentPublishedServicePlan(
          currentGeneralChurch.churchId,
        );
        if (plan) return { plan, viewMode: "general", token: trimmed };
      }
      throw httpError(404, "Service not found.");
    }
    return { plan: generalPlan, viewMode: "general", token: trimmed };
  };

  const buildPublicServicePlan = async ({ plan, viewMode, token }) => {
    const isGeneralView = viewMode === "general";
    const [church, brandingChrome, positions, teams, schedules] = await Promise.all([
      getDoc(COLLECTIONS.churches, plan.churchId),
      readChurchPublicBrandingChrome(plan.churchId),
      isGeneralView
        ? Promise.resolve([])
        : listTeamCollectionForChurch(
            COLLECTIONS.teamPositions,
            "positionId",
            plan.churchId,
          ),
      isGeneralView
        ? Promise.resolve([])
        : listTeamCollectionForChurch(
            COLLECTIONS.teams,
            "teamId",
            plan.churchId,
          ),
      isGeneralView
        ? Promise.resolve([])
        : listTeamCollectionForChurch(
            COLLECTIONS.teamSchedules,
            "scheduleId",
            plan.churchId,
          ),
    ]);
    const memberIds = isGeneralView
      ? []
      : publicServingMemberIdsForPlan({
          plan,
          schedules,
          timezone: plan.timezone,
        });
    const members = await Promise.all(
      memberIds.map(async (memberId) => {
        const member = await getDoc(COLLECTIONS.teamRosterMembers, memberId);
        return member ? { ...member, memberId } : null;
      }),
    );
    return buildPublicServicePlanSnapshot({
      plan,
      microphones: church?.servicePlanMicrophones || [],
      microphoneAudiences: Array.isArray(church?.servicePlanMicrophoneAudiences)
        ? church.servicePlanMicrophoneAudiences
        : (church?.servicePlanMicrophones || []).some((microphone) =>
              Array.isArray(microphone?.audiences),
            )
          ? church.servicePlanMicrophones.flatMap(
              (microphone) => microphone?.audiences || [],
            )
          : undefined,
      positions,
      teams,
      schedules,
      members: members.filter(Boolean),
      churchName: church?.name || "WorshipSync",
      churchLogoUrl: brandingChrome.logoUrl,
      churchPrimaryColor: brandingChrome.primaryColor,
      churchSecondaryColor: brandingChrome.secondaryColor,
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
      .filter(
        (token, index, tokens) => token && tokens.indexOf(token) === index,
      )
      .forEach((token) => emitServiceFlowUpdated(token, revision));
  };

  /** Re-fetch detailed links when a scheduled person or their mic changes. */
  const emitPublicPlansForScheduleOccurrences = async ({
    churchId,
    occurrences,
    revision,
  }) => {
    const occurrenceKeys = new Set(
      (Array.isArray(occurrences) ? occurrences : [])
        .map((occurrence) => {
          const startsAt = String(occurrence?.startsAt || "").trim();
          const serviceIds = (Array.isArray(occurrence?.serviceIds) && occurrence.serviceIds.length
            ? occurrence.serviceIds
            : [occurrence?.serviceId])
            .map((serviceId) => String(serviceId || "").trim())
            .filter(Boolean);
          return startsAt && serviceIds.length
            ? serviceIds.map((serviceId) => `${startsAt}\u0000${serviceId}`)
            : [];
        })
        .flat(),
    );
    if (!occurrenceKeys.size) return;
    const plans = await queryDocs(
      COLLECTIONS.servicePlans,
      [{ field: "churchId", value: churchId }],
      { limit: TEAM_COLLECTION_QUERY_LIMIT },
    );
    await Promise.all(
      plans
        .filter((plan) => {
          const planStartsAt = String(plan?.startsAt || "").trim();
          if (!plan?.published || !planStartsAt) {
            return false;
          }
          const planServiceIds = (
            Array.isArray(plan?.serviceIds) && plan.serviceIds.length
              ? plan.serviceIds
              : [plan?.serviceId]
          )
            .map((serviceId) => String(serviceId || "").trim())
            .filter(Boolean);
          return planServiceIds.some((serviceId) =>
            occurrenceKeys.has(`${planStartsAt}\u0000${serviceId}`));
        })
        .map((plan) => emitPublicServicePlanUpdated(plan, revision)),
    );
  };

  const emitPublicPlansForScheduleOccurrence = async (args) =>
    emitPublicPlansForScheduleOccurrences({
      ...args,
      occurrences: [args.occurrence],
    });

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

  // Positions are owned by a team, so a set of positions implies a set of teams.
  const collectTeamIdsForPositions = async (churchId, positionIds) => {
    const normalizedPositionIds = normalizeIdArray(positionIds);
    if (normalizedPositionIds.length === 0) return [];
    const positions = await Promise.all(
      normalizedPositionIds.map((positionId) =>
        assertTeamEntityInChurch("position", positionId, churchId, {
          label: "Position",
        }),
      ),
    );
    return Array.from(
      new Set(positions.map((position) => position.teamId).filter(Boolean)),
    );
  };

  const addMemberToTeamsForPositions = async ({
    churchId,
    positionIds,
    memberId,
    adminUserId,
  }) => {
    const normalizedMemberId = normalizeShortText(memberId, { max: 160 });
    if (!normalizedMemberId) return [];
    const teamIds = await collectTeamIdsForPositions(churchId, positionIds);
    if (teamIds.length === 0) return [];
    return addMemberToTeams({
      churchId,
      teamIds,
      memberId: normalizedMemberId,
      adminUserId,
    });
  };

  // Load full team records for ids whose roster we just changed, so a response
  // can hand them back for an immediate local refresh instead of leaving the
  // client's `team.memberIds` stale until its next poll. Skips ids that no
  // longer resolve or belong to another church.
  const loadTeamsByIds = async (churchId, teamIds) => {
    const ids = normalizeIdArray(teamIds);
    if (ids.length === 0) return [];
    const teams = await Promise.all(
      ids.map((teamId) => getTeamEntity("team", teamId)),
    );
    return teams.filter((team) => team && team.churchId === churchId);
  };

  // Non-throwing form of the per-team edit check, for deciding which rosters a
  // request is allowed to touch. Fails closed: anything we cannot confirm is
  // treated as not editable and left alone.
  const canEditTeamForRequest = async (req, churchId, teamId) => {
    try {
      await requireTeamsEditForTeam(req, churchId, teamId);
      return true;
    } catch {
      return false;
    }
  };

  // Drop a member from the given teams' rosters. The mirror of
  // `addMemberToTeams`; returns the team ids whose roster actually changed.
  const removeMemberFromTeams = async ({
    churchId,
    teamIds,
    memberId,
    adminUserId,
  }) => {
    const normalizedMemberId = normalizeShortText(memberId, { max: 160 });
    const ids = normalizeIdArray(teamIds);
    if (!normalizedMemberId || ids.length === 0) return [];
    const now = nowIso();
    const removedTeamIds = [];
    await Promise.all(
      ids.map(async (teamId) => {
        const team = await getDoc(COLLECTIONS.teams, teamId);
        if (!team || team.churchId !== churchId) return;
        const memberIds = team.memberIds || [];
        if (!memberIds.includes(normalizedMemberId)) return;
        await setDoc(
          COLLECTIONS.teams,
          teamId,
          {
            memberIds: memberIds.filter((id) => id !== normalizedMemberId),
            updatedAt: now,
            updatedByUid: adminUserId,
          },
          { merge: true },
        );
        removedTeamIds.push(teamId);
      }),
    );
    return removedTeamIds;
  };

  /**
   * Bring `team.memberIds` in line with the membership a member save asks for.
   *
   * `requestedTeamIds` is the client's desired roster set. Position teams are
   * unioned in unconditionally: eligibility for a team's position is gated on
   * belonging to that team, so dropping the membership would leave a member who
   * is eligible for a position but cannot be assigned to it.
   *
   * Removals are scoped to teams this admin may edit, so a team-scoped admin
   * whose view omits other teams can never strip a roster they cannot see.
   * Passing `requestedTeamIds: null` keeps the older add-only behavior for
   * callers that do not manage membership.
   *
   * Roles for teams the member leaves are dropped too — a stale
   * `teamMemberships` entry still reads as membership to filters and to the
   * permission checks that derive team scope from a member.
   */
  const syncMemberTeamMembership = async ({
    req,
    churchId,
    member,
    positionIds,
    requestedTeamIds,
    adminUserId,
  }) => {
    const memberId = member.memberId;
    if (requestedTeamIds === null || requestedTeamIds === undefined) {
      const addedTeamIds = await addMemberToTeamsForPositions({
        churchId,
        positionIds,
        memberId,
        adminUserId,
      });
      return {
        member,
        teams: await loadTeamsByIds(churchId, addedTeamIds),
      };
    }

    const positionTeamIds = await collectTeamIdsForPositions(
      churchId,
      positionIds,
    );
    const desired = new Set([...requestedTeamIds, ...positionTeamIds]);
    const allTeams = await listTeamCollectionForChurch(
      COLLECTIONS.teams,
      "teamId",
      churchId,
    );
    const currentTeamIds = allTeams
      .filter((team) => (team.memberIds || []).includes(memberId))
      .map((team) => team.teamId);

    const toAdd = Array.from(desired).filter(
      (teamId) => !currentTeamIds.includes(teamId),
    );
    const removable = await Promise.all(
      currentTeamIds
        .filter((teamId) => !desired.has(teamId))
        .map(async (teamId) => ({
          teamId,
          allowed: await canEditTeamForRequest(req, churchId, teamId),
        })),
    );
    const toRemove = removable
      .filter((entry) => entry.allowed)
      .map((entry) => entry.teamId);

    const [addedTeamIds, removedTeamIds] = await Promise.all([
      addMemberToTeams({ churchId, teamIds: toAdd, memberId, adminUserId }),
      removeMemberFromTeams({
        churchId,
        teamIds: toRemove,
        memberId,
        adminUserId,
      }),
    ]);

    let nextMember = member;
    const staleRoleTeamIds = Object.keys(member.teamMemberships || {}).filter(
      (teamId) => removedTeamIds.includes(teamId),
    );
    if (staleRoleTeamIds.length > 0) {
      const teamMemberships = { ...(member.teamMemberships || {}) };
      staleRoleTeamIds.forEach((teamId) => delete teamMemberships[teamId]);
      await setDoc(
        COLLECTIONS.teamRosterMembers,
        memberId,
        {
          teamMemberships,
          updatedAt: nowIso(),
          updatedByUid: adminUserId,
        },
        { merge: true },
      );
      nextMember = await getTeamEntity("member", memberId);
    }

    return {
      member: nextMember,
      teams: await loadTeamsByIds(churchId, [
        ...addedTeamIds,
        ...removedTeamIds,
      ]),
    };
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

  // How far around "today" the bootstrap ships fully-hydrated schedules when the
  // client opts into summaries. Anything outside the window arrives as a summary
  // and is hydrated on demand. One month back keeps the just-finished month's
  // assignments available for credits; two months forward covers the schedules an
  // operator is actively filling.
  const SCHEDULE_HYDRATION_WINDOW_BACK_MONTHS = 1;
  const SCHEDULE_HYDRATION_WINDOW_FORWARD_MONTHS = 2;

  /**
   * Plain YYYY-MM-DD for a date offset from `from` by whole months.
   * Clamps the day so month-end dates (29–31) do not roll into the next
   * month via `setUTCMonth` (e.g. Mar 31 − 1 month → Feb 28/29, not Mar 2/3).
   */
  const shiftIsoDateByMonths = (from, months) => {
    const year = from.getUTCFullYear();
    const month = from.getUTCMonth() + months;
    const day = from.getUTCDate();
    // Day 0 of the following month is the last day of the target month.
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return new Date(Date.UTC(year, month, Math.min(day, lastDay)))
      .toISOString()
      .slice(0, 10);
  };

  /**
   * A schedule with its heavy per-cell maps stripped. Everything the picker, the
   * schedules list, and occurrence matching need stays; `assignments`,
   * `microphoneAssignments`, and `additionalPositionSlots` — which dominate the
   * document size and grow with every position × date — do not.
   *
   * `assignmentsOmitted` is an explicit marker so the client can never mistake a
   * summary for a schedule that genuinely has no assignments.
   */
  /** Member ids in one assignment cell (primary + shadows), legacy shapes included. */
  const assignmentCellMemberIds = (cell) => {
    if (!cell) return [];
    if (typeof cell === "string") return cell ? [cell] : [];
    const shadows = Array.isArray(cell.shadows) ? cell.shadows : [];
    return [cell.primaryMemberId, ...shadows.map((shadow) => shadow?.memberId)]
      .map((id) => String(id || ""))
      .filter(Boolean);
  };

  /**
   * Per-member and per-position cell counts for a schedule. Deleting a member,
   * position, or team shows the operator how many assignments it will clear
   * ("Cleared from 12 schedule assignments"), and that warning must stay exact
   * for summarized schedules too — so the counts travel with the summary rather
   * than being recomputed from cells the client no longer has.
   */
  const buildScheduleAssignmentCounts = (assignments) => {
    const byMemberId = {};
    const byPositionId = {};
    Object.values(assignments || {}).forEach((row) => {
      if (!row || typeof row !== "object") return;
      Object.entries(row).forEach(([cellKey, cell]) => {
        const memberIds = assignmentCellMemberIds(cell);
        memberIds.forEach((memberId) => {
          byMemberId[memberId] = (byMemberId[memberId] || 0) + 1;
        });
        // Mirrors the client's slot-key format: "<positionId>::<slotIndex>".
        const separatorIndex = String(cellKey).lastIndexOf("::");
        const positionId =
          separatorIndex > 0 ? String(cellKey).slice(0, separatorIndex) : "";
        if (positionId && memberIds.length > 0) {
          byPositionId[positionId] = (byPositionId[positionId] || 0) + 1;
        }
      });
    });
    return { byMemberId, byPositionId };
  };

  const summarizeTeamSchedule = (schedule) => {
    const {
      assignments,
      microphoneAssignments,
      additionalPositionSlots,
      optionalPositionSlots,
      ...summary
    } = schedule || {};
    return {
      ...summary,
      assignmentsOmitted: true,
      assignmentCounts: buildScheduleAssignmentCounts(assignments),
    };
  };

  /**
   * Inclusive overlap between a schedule's date window and a plain YYYY-MM-DD
   * range. Schedules with no dates at all (legacy, service-id only) are treated
   * as overlapping so they are never silently stripped of assignments.
   */
  const scheduleOverlapsDateRange = (schedule, startDate, endDate) => {
    const scheduleStart = schedule?.startDate || schedule?.endDate || "";
    const scheduleEnd = schedule?.endDate || schedule?.startDate || "";
    if (!scheduleStart || !scheduleEnd) return true;
    return scheduleStart <= endDate && scheduleEnd >= startDate;
  };

  const buildTeamsBootstrap = async (
    churchId,
    { scheduleMode = "full" } = {},
  ) => {
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
    // Clients that opt in receive schedule summaries plus full hydration for the
    // schedules around today. Older clients omit the flag and still get every
    // schedule fully hydrated, so this stays backward compatible.
    const now = new Date();
    const hydrationStart = shiftIsoDateByMonths(
      now,
      -SCHEDULE_HYDRATION_WINDOW_BACK_MONTHS,
    );
    const hydrationEnd = shiftIsoDateByMonths(
      now,
      SCHEDULE_HYDRATION_WINDOW_FORWARD_MONTHS,
    );
    const normalizedSchedules = schedules.map((schedule) =>
      schedule.additionalPositionSlots || !schedule.optionalPositionSlots
        ? schedule
        : {
            ...schedule,
            additionalPositionSlots:
              normalizeTeamScheduleAdditionalPositionSlots(
                schedule.optionalPositionSlots,
              ),
          },
    );
    const bootstrapSchedules =
      scheduleMode === "summary"
        ? normalizedSchedules.map((schedule) =>
            scheduleOverlapsDateRange(schedule, hydrationStart, hydrationEnd)
              ? schedule
              : summarizeTeamSchedule(schedule),
          )
        : normalizedSchedules;

    return {
      members,
      positions: sortPositionsByOrder(positions),
      teams,
      teamRoles,
      qualificationAreas,
      qualificationLevels,
      schedules: bootstrapSchedules,
      ...(scheduleMode === "summary"
        ? {
            scheduleHydrationWindow: {
              startDate: hydrationStart,
              endDate: hydrationEnd,
            },
          }
        : {}),
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

  const mergeServicePositionRequirements = (services) => {
    const byPosition = new Map();
    (Array.isArray(services) ? services : []).forEach((service) => {
      sanitizePositionRequirements(service?.positionRequirements).forEach(
        (requirement) => {
          const existing = byPosition.get(requirement.positionId);
          if (!existing || requirement.count > existing.count) {
            byPosition.set(requirement.positionId, requirement);
          }
        },
      );
    });
    return [...byPosition.values()];
  };

  /**
   * New schedules carry an immutable occurrence snapshot. Older standalone
   * occurrences stored an empty array, while the client correctly fell back to
   * the service-time requirements. Read that same authoritative source so
   * legacy schedules validate exactly like the grid without requiring a manual
   * schedule refresh.
   */
  const resolveScheduleOccurrenceRequirements = async ({
    churchId,
    occurrence,
  }) => {
    const stored = sanitizePositionRequirements(
      occurrence?.positionRequirements,
    );
    if (stored.length > 0 || !occurrence) return stored;

    const serviceIds = new Set(
      [occurrence.serviceId, ...(occurrence.serviceIds || [])]
        .map((serviceId) => normalizeShortText(serviceId, { max: 160 }))
        .filter(Boolean),
    );
    if (serviceIds.size === 0) return stored;

    const services = await readChurchServiceTimes(churchId);
    return mergeServicePositionRequirements(
      services.filter((service) =>
        serviceIds.has(
          normalizeShortText(service?.serviceId || service?.id, { max: 160 }),
        ),
      ),
    );
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
    const hasBirthDate = Object.prototype.hasOwnProperty.call(body || {}, "birthDate");
    const birthDate = hasBirthDate ? normalizeBirthDate(body?.birthDate) : undefined;
    const isMinor =
      isMinorFromBirthDate(birthDate) ??
      normalizeManualMinorStatus(body?.isMinor);
    const servingFrequency = normalizeTeamMemberServingFrequency(
      body?.servingFrequency,
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
      ...(hasBirthDate ? { birthDate } : {}),
      isMinor,
      servingFrequency,
      positionIds,
      blockoutDates: normalizeBlockoutDates(body?.blockoutDates),
      notes: normalizeLongText(body?.notes),
    };
    if (Object.prototype.hasOwnProperty.call(body || {}, "profileImageUrl")) {
      payload.profileImageUrl = normalizeMemberProfileImage(
        body?.profileImageUrl,
        "Profile image",
      );
    }
    if (Object.prototype.hasOwnProperty.call(body || {}, "profileImagePublicId")) {
      payload.profileImagePublicId = normalizeShortText(
        body?.profileImagePublicId,
        { max: 512 },
      );
    }
    // Conditional like the other optional fields: a partial update that omits
    // `email` must not wipe an address the member already has.
    // `userId` / `invitedAt` are intentionally absent — they are server-owned
    // and set only by the invite-accept path, never by a client payload.
    if (Object.prototype.hasOwnProperty.call(body || {}, "email")) {
      payload.email = normalizeMemberEmail(body?.email);
    }
    if (Object.prototype.hasOwnProperty.call(body || {}, "title")) {
      payload.title = normalizeShortText(body?.title, { max: 40 });
    }
    if (
      Object.prototype.hasOwnProperty.call(body || {}, "recurringAvailability")
    ) {
      payload.recurringAvailability = normalizeTeamMemberRecurringAvailability(
        body?.recurringAvailability,
      );
    }
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

  /**
   * The roster membership a member save asks for. Kept out of the member
   * payload on purpose: membership lives on `team.memberIds`, and storing a
   * second copy on the member is what lets the two sides drift.
   *
   * Returns null when the request says nothing about membership, which keeps
   * the older add-only behavior for callers that do not manage it. Archived
   * teams are allowed through so a member can stay on one.
   */
  const validateMemberTeamIds = async (body, churchId) => {
    if (!Object.prototype.hasOwnProperty.call(body || {}, "teamIds")) {
      return null;
    }
    return assertTeamEntityIdsInChurch("team", body?.teamIds, churchId, {
      label: "Team",
      active: false,
    });
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
      usesMicrophoneAssignments: body?.usesMicrophoneAssignments === true,
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

  const normalizeTeamScheduleMicrophoneAssignments = (value) => {
    if (!value || typeof value !== "object") return {};
    const assignments = {};
    for (const [occurrenceId, rawRow] of Object.entries(value)) {
      const normalizedOccurrenceId = normalizeShortText(occurrenceId, {
        max: 260,
      });
      if (!normalizedOccurrenceId || !rawRow || typeof rawRow !== "object")
        continue;
      const row = {};
      for (const [slotKey, microphoneIds] of Object.entries(rawRow)) {
        if (!parseScheduleSlotKey(slotKey)) continue;
        const ids = normalizeIdArray(microphoneIds).slice(0, 12);
        if (ids.length) row[slotKey] = ids;
      }
      if (Object.keys(row).length) assignments[normalizedOccurrenceId] = row;
    }
    return assignments;
  };

  const normalizeTeamScheduleAdditionalPositionSlots = (value) => {
    if (!value || typeof value !== "object") return {};
    const slots = {};
    for (const [occurrenceId, rawSlotKeys] of Object.entries(value)) {
      const normalizedOccurrenceId = normalizeShortText(occurrenceId, {
        max: 260,
      });
      if (!normalizedOccurrenceId) continue;
      const row = [
        ...new Set(
          (Array.isArray(rawSlotKeys) ? rawSlotKeys : [])
            .map((slotKey) => normalizeShortText(slotKey, { max: 260 }))
            .filter((slotKey) => parseScheduleSlotKey(slotKey)),
        ),
      ];
      if (row.length) slots[normalizedOccurrenceId] = row;
    }
    return slots;
  };

  const validateTeamSchedulePayload = async (body, churchId, existing = null) => {
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
    // Older clients do not send the new schedule-only guest catalog. Preserve
    // it on updates so editing dates or services cannot orphan guest slots.
    const guests = normalizeTeamScheduleGuests(
      body?.guests !== undefined ? body.guests : existing?.guests,
    );
    const microphoneAssignments = normalizeTeamScheduleMicrophoneAssignments(
      body?.microphoneAssignments,
    );
    const additionalPositionSlots =
      normalizeTeamScheduleAdditionalPositionSlots(
        body?.additionalPositionSlots ?? body?.optionalPositionSlots,
      );
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
    return {
      name,
      description: normalizeLongText(body?.description),
      teamId: team.teamId,
      startDate,
      endDate,
      serviceIds,
      occurrences,
      assignments,
      guests,
      microphoneAssignments,
      additionalPositionSlots,
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
        if (!changed) return;
        await setDoc(
          COLLECTIONS.teamSchedules,
          schedule.scheduleId,
          {
            assignments: nextAssignments,
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

  const isMemberBlockedOutForService = (member, service) => {
    const serviceDate = getConcreteTeamServiceDate(service);
    if (!serviceDate) return false;
    return (member.blockoutDates || []).some((range) => {
      const start = String(range?.startDate || "");
      const end = String(range?.endDate || start);
      return start <= serviceDate && serviceDate <= end;
    });
  };

  const isMemberAvailableDuringServiceWeek = (member, service) => {
    const serviceDate = getConcreteTeamServiceDate(service);
    const availability = member.recurringAvailability;
    const selectedWeeks = availability?.weeksOfMonth || [];
    if (
      !serviceDate ||
      (selectedWeeks.length === 0 && !availability?.includeLastWeekOfMonth)
    ) {
      return true;
    }
    const parsed = new Date(`${serviceDate}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) return true;
    const dayOfMonth = parsed.getUTCDate();
    const weekOfMonth = Math.floor((dayOfMonth - 1) / 7) + 1;
    const lastDayOfMonth = new Date(
      Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, 0),
    ).getUTCDate();
    return (
      selectedWeeks.includes(weekOfMonth) ||
      (availability?.includeLastWeekOfMonth && dayOfMonth + 7 > lastDayOfMonth)
    );
  };

  const TEAM_SCHEDULE_SHADOW_KINDS = new Set(["shadow", "reverse_shadow"]);

  const normalizeTeamScheduleGuest = (value, { requireId = true } = {}) => {
    if (!value || typeof value !== "object") return null;
    const guestId = normalizeShortText(value.guestId, { max: 160 });
    const name = normalizeShortText(value.name, { max: 120 });
    if (!name || (requireId && !guestId)) return null;
    const email = normalizeMemberEmail(value.email);
    const phone = normalizeShortText(value.phone, { max: 40 });
    const note = normalizeLongText(value.note, { max: 500 });
    return {
      ...(guestId ? { guestId } : {}),
      name,
      ...(email ? { email } : {}),
      ...(phone ? { phone } : {}),
      ...(note ? { note } : {}),
    };
  };

  const normalizeTeamScheduleGuests = (value) => {
    const byId = new Map();
    (Array.isArray(value) ? value : []).forEach((guest) => {
      const normalized = normalizeTeamScheduleGuest(guest);
      if (normalized) byId.set(normalized.guestId, normalized);
    });
    return [...byId.values()].slice(0, MAX_TEAM_SCHEDULE_GUESTS);
  };

  const resolveTeamScheduleGuestAssignment = ({ schedule, guest, memberId }) => {
    const guests = normalizeTeamScheduleGuests(schedule?.guests);
    if (guest == null) {
      const normalizedMemberId = normalizeShortText(memberId, { max: 160 });
      const existingGuest = guests.find(
        (item) => item.guestId === normalizedMemberId,
      );
      return {
        guests,
        guest: existingGuest || null,
        memberId: normalizedMemberId,
      };
    }
    if (normalizeShortText(memberId, { max: 160 })) {
      throw httpError(400, "Choose either a team member or a guest.");
    }
    const normalized = normalizeTeamScheduleGuest(guest, { requireId: false });
    if (!normalized?.name) {
      throw httpError(400, "Guest name is required.");
    }
    const requestedGuestId = normalizeShortText(normalized.guestId, {
      max: 160,
    });
    const existingIndex = requestedGuestId
      ? guests.findIndex((item) => item.guestId === requestedGuestId)
      : -1;
    if (
      requestedGuestId &&
      existingIndex === -1 &&
      !/^scheduleGuest_[A-Za-z0-9_-]+$/.test(requestedGuestId)
    ) {
      throw httpError(400, "Guest id is invalid. Add the guest again.");
    }
    const guestId =
      existingIndex >= 0
        ? guests[existingIndex].guestId
        : requestedGuestId || createId("scheduleGuest");
    const nextGuest = { ...normalized, guestId };
    if (existingIndex >= 0) {
      guests[existingIndex] = nextGuest;
    } else {
      if (guests.length >= MAX_TEAM_SCHEDULE_GUESTS) {
        const assignedIds = new Set(
          Object.values(schedule?.assignments || {}).flatMap((row) =>
            Object.values(row || {}).flatMap(getScheduleAssignmentCellMemberIds),
          ),
        );
        const unusedIndex = guests.findIndex(
          (item) => !assignedIds.has(item.guestId),
        );
        if (unusedIndex >= 0) guests.splice(unusedIndex, 1);
      }
      if (guests.length >= MAX_TEAM_SCHEDULE_GUESTS) {
        throw httpError(400, "This schedule has reached its guest limit.");
      }
      guests.push(nextGuest);
    }
    return { guests, guest: nextGuest, memberId: guestId };
  };

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

  const TEAM_INTAKE_FIELD_IDS = new Set([
    "firstName",
    "lastName",
    "email",
    "title",
    "birthDate",
    "positions",
    "availability",
    "schedulingPreferences",
    "blockoutDates",
    "notes",
  ]);
  // Forms saved before field selection existed rendered these fields. Keeping
  // this fallback avoids silently changing any live public link.
  const LEGACY_TEAM_INTAKE_FIELDS = [
    "firstName",
    "lastName",
    "email",
    "positions",
    "availability",
    "blockoutDates",
    "notes",
  ];
  const normalizeTeamIntakeFields = (value, existing) => {
    if (value === undefined) {
      return Array.isArray(existing)
        ? existing
        : [...LEGACY_TEAM_INTAKE_FIELDS];
    }
    if (!Array.isArray(value)) {
      throw httpError(400, "Form fields must be a list.");
    }
    return [...new Set(value.filter((field) => TEAM_INTAKE_FIELD_IDS.has(field)))];
  };

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
    const enabledFields = normalizeTeamIntakeFields(
      body?.enabledFields,
      existing?.enabledFields,
    );
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
      enabledFields,
      active: Boolean(body?.active ?? existing?.active),
      // Every selected member-detail field is required on the public form.
      requireEmail:
        enabledFields.includes("email") &&
        true,
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
    const enabledFields = new Set(
      normalizeTeamIntakeFields(undefined, form?.enabledFields),
    );
    const firstName = enabledFields.has("firstName")
      ? normalizeShortText(body?.firstName, { max: 80 })
      : "";
    const lastName = enabledFields.has("lastName")
      ? normalizeShortText(body?.lastName, { max: 80 })
      : "";
    if (enabledFields.has("firstName") && !firstName) {
      throw httpError(400, "First name is required.");
    }
    if (enabledFields.has("lastName") && !lastName) {
      throw httpError(400, "Last name is required.");
    }
    // Intake is the only scalable way to collect member addresses — nothing in
    // the roster has one today.
    //
    // Opt-in per form, not required by default. `/api/team-intake/submit` is a
    // live public endpoint, and defaulting to required would reject real
    // volunteers on every existing form the moment this deploys — before the
    // public form even renders an email field. Churches enable it per form, and
    // the default can flip once the client field has shipped everywhere.
    const email = enabledFields.has("email")
      ? normalizeMemberEmail(body?.email)
      : "";
    if (enabledFields.has("email") && !email) {
      throw httpError(400, "Email is required.");
    }
    const title = enabledFields.has("title")
      ? normalizeShortText(body?.title, { max: 40 })
      : "";
    if (enabledFields.has("title") && !title) {
      throw httpError(400, "Title is required.");
    }
    const birthDate = enabledFields.has("birthDate")
      ? normalizeBirthDate(body?.birthDate)
      : null;
    if (enabledFields.has("birthDate") && !birthDate) {
      throw httpError(400, "Birthday is required.");
    }
    // The public preview only offers positions from the form's scoped teams
    // (empty teamIds means every team). Enforce that same scope on submission so
    // a crafted POST cannot smuggle in positions from teams outside the form.
    const scopedTeamIds = new Set(form.teamIds || []);
    const positionIds = enabledFields.has("positions")
      ? await assertTeamEntityIdsInChurch(
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
      )
      : [];
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
      if (!enabledFields.has("availability")) return;
      if (!occurrenceIds.has(occurrenceId)) return;
      occurrenceAvailability[occurrenceId] =
        availability === "unavailable" ? "unavailable" : "available";
    });
    return {
      firstName,
      lastName,
      email,
      title,
      birthDate,
      normalizedName: normalizePersonNameKey(firstName, lastName),
      positionIds,
      occurrenceAvailability,
      blockoutRanges: enabledFields.has("blockoutDates")
        ? normalizeIntakeBlockoutRanges(
          body?.blockoutRanges,
          form.startDate,
          form.endDate,
        )
        : [],
      notes: enabledFields.has("notes")
        ? normalizeLongText(body?.notes, { max: 2000 })
        : "",
      ...(enabledFields.has("schedulingPreferences")
        ? {
          servingFrequency: normalizeTeamMemberServingFrequency(
            body?.servingFrequency,
          ),
          recurringAvailability: normalizeTeamMemberRecurringAvailability(
            body?.recurringAvailability,
          ),
        }
        : {}),
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

  const scheduleGuestPublicNameParts = (guest) => {
    const parts = String(guest?.name || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    return {
      firstName: parts[0] || "Guest",
      lastName: parts.length > 1 ? parts[parts.length - 1] : "",
    };
  };

  const buildPublicTeamScheduleSnapshot = async (schedule) => {
    const churchId = schedule.churchId;
    const scheduleGuests = normalizeTeamScheduleGuests(schedule.guests);
    const scheduleGuestById = new Map(
      scheduleGuests.map((guest) => [guest.guestId, guest]),
    );
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
        [...assignedMemberIds]
          .filter((memberId) => !scheduleGuestById.has(memberId))
          .map((memberId) => getTeamEntity("member", memberId)),
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
    const assignedGuests = [...assignedMemberIds]
      .map((guestId) => scheduleGuestById.get(guestId))
      .filter(Boolean);
    const publicNameSources = [
      ...assignedMembers,
      ...assignedGuests.map(scheduleGuestPublicNameParts),
    ];
    publicNameSources.forEach((member) => {
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
      })).concat(
        assignedGuests.map((guest) => ({
          memberId: guest.guestId,
          name: scheduleMemberPublicName(
            scheduleGuestPublicNameParts(guest),
            duplicateFirstNames,
          ),
          guest: true,
        })),
      ),
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
    "This person is already scheduled on another team or in another role for this service. Confirm to schedule them anyway.";

  const normalizeAllowCrossTeamConflict = (value) => value === true;
  // Canonical name for all occurrence conflicts. Keep the old field accepted
  // through this release so older clients can still acknowledge warnings.
  const normalizeAllowOccurrenceConflict = (body) =>
    body?.allowOccurrenceConflict === true || body?.allowCrossTeamConflict === true;
  const normalizeAllowBlockout = (value) => value === true;
  const normalizeAllowRecurringAvailability = (value) => value === true;

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
    targetCellKey,
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
        // Bulk validation does not know which cell is being edited and keeps
        // the historical cross-team-only behavior. Direct assignment writes
        // provide the target cell, allowing same-schedule role conflicts too.
        if (
          otherSchedule.scheduleId === schedule.scheduleId &&
          !targetCellKey
        ) continue;
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
          otherSchedule.scheduleId === schedule.scheduleId
            ? assignments?.[otherOccurrence.occurrenceId] || {}
            : otherSchedule.assignments?.[otherOccurrence.occurrenceId] || {};
        const otherMemberIds = new Set(
          Object.entries(otherRow)
            .filter(
              ([cellKey]) =>
                !(
                  otherSchedule.scheduleId === schedule.scheduleId &&
                  cellKey === targetCellKey
                ),
            )
            .flatMap(([, cell]) => getScheduleAssignmentCellMemberIds(cell)),
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
    targetCellKey,
  }) => {
    if (allowCrossTeamConflict) return;
    const conflicts = findCrossTeamScheduleAssignmentConflicts({
      schedule,
      assignments,
      schedules,
      memberIds,
      targetCellKey,
    });
    if (conflicts.length > 0) {
      throw httpError(409, CROSS_TEAM_SCHEDULE_CONFLICT_MESSAGE);
    }
  };

  // A full schedule save includes every already-filled cell. Only validate
  // people newly added to an occurrence: otherwise an older, manually
  // confirmed cross-team assignment prevents unrelated bulk edits (including
  // Auto-fill) from being saved. The dedicated assignment endpoint continues
  // to validate every new individual assignment.
  const getNewScheduleAssignmentConflictChecks = ({
    previousAssignments,
    nextAssignments,
  }) => {
    const checks = {};
    for (const [occurrenceId, nextRow] of Object.entries(
      nextAssignments || {},
    )) {
      const existingMemberIds = new Set(
        Object.values(previousAssignments?.[occurrenceId] || {}).flatMap(
          getScheduleAssignmentCellMemberIds,
        ),
      );
      const nextChecks = {};
      for (const [cellKey, rawCell] of Object.entries(nextRow || {})) {
        const cell = normalizeScheduleAssignmentCell(rawCell);
        const nextCell = serializeScheduleAssignmentCell({
          primaryMemberId: existingMemberIds.has(cell.primaryMemberId)
            ? ""
            : cell.primaryMemberId,
          shadows: cell.shadows.filter(
            (shadow) => !existingMemberIds.has(shadow.memberId),
          ),
        });
        if (nextCell) nextChecks[cellKey] = nextCell;
      }
      if (Object.keys(nextChecks).length > 0) {
        checks[occurrenceId] = nextChecks;
      }
    }
    return checks;
  };

  const buildValidatedScheduleAssignments = async ({
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
    allowBlockout,
    allowRecurringAvailability,
    allowOccurrenceConflict = false,
    guestAssignment = false,
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
    const occurrence = (schedule.occurrences || []).find(
      (item) => item.occurrenceId === serviceId,
    );
    const requirements = await resolveScheduleOccurrenceRequirements({
      churchId,
      occurrence,
    });
    // Services with no explicit requirements use one slot for each team
    // position in the scheduling UI. Preserve that fallback after checking the
    // saved snapshot and, for legacy occurrences, the live service definition.
    const requirement = requirements.find(
      (item) => item?.positionId === basePositionId,
    );
    {
      let requiredCount = Math.max(
        0,
        Math.floor(Number(requirement?.count) || 0),
      );
      if (!requirement && requirements.length === 0) {
        requiredCount = 1;
      }
      const additionalSlots = new Set(
        normalizeTeamScheduleAdditionalPositionSlots(
          schedule.additionalPositionSlots ?? schedule.optionalPositionSlots,
        )[serviceId] || [],
      );
      if (targetSlot.slot >= requiredCount && !additionalSlots.has(cellKey)) {
        throw httpError(400, "Add this position before assigning it.");
      }
    }
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
          !allowBlockout &&
          isMemberBlockedOutForService(member, { date: serviceDate || "" })
        ) {
          throw httpError(400, "That member is unavailable for this service.");
        }
        if (
          !allowRecurringAvailability &&
          !isMemberAvailableDuringServiceWeek(member, {
            date: serviceDate || "",
          })
        ) {
          throw httpError(
            400,
            "That member is unavailable during this week of the month.",
          );
        }
        // Intake service availability is a soft warning surfaced in the picker.
        // Blockout dates and recurring availability require confirmation.

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

    if (!guestAssignment) {
      if (!member || member.churchId !== churchId || member.archivedAt) {
        throw httpError(400, "Member is archived.");
      }
      if (!(team.memberIds || []).includes(normalizedMemberId)) {
        throw httpError(400, "That member is not part of this team.");
      }
      if (!(member.positionIds || []).includes(basePositionId)) {
        throw httpError(400, "That member cannot serve in this position.");
      }
      if (
        !allowBlockout &&
        isMemberBlockedOutForService(member, { date: serviceDate || "" })
      ) {
        throw httpError(400, "That member is unavailable for this service.");
      }
      if (
        !allowRecurringAvailability &&
        !isMemberAvailableDuringServiceWeek(member, {
          date: serviceDate || "",
        })
      ) {
        throw httpError(
          400,
          "That member is unavailable during this week of the month.",
        );
      }
    }
    // Intake service availability is a soft warning surfaced in the picker.
    // Blockout dates and recurring availability require confirmation.

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
    if (isMemberBlockedOutForService(member, { date: serviceDate || "" })) {
      throw httpError(400, "That member is unavailable for this service.");
    }
    if (!isMemberAvailableDuringServiceWeek(member, { date: serviceDate || "" })) {
      throw httpError(
        400,
        "That member is unavailable during this week of the month.",
      );
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
    allowOccurrenceConflict = false,
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
    if (!allowOccurrenceConflict) {
      assertNoDuplicateScheduleMembersForService(row);
    }
    assignments[serviceId] = row;
    return assignments;
  };

  const validateScheduleAssignment = async ({
    churchId,
    scheduleId,
    serviceId,
    positionSlotKey,
    memberId,
    guest,
    serviceDate,
    sourceServiceId,
    sourcePositionSlotKey,
    shadowAction,
    shadowKind,
    allowBlockout,
    allowRecurringAvailability,
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
    const resolvedGuest = resolveTeamScheduleGuestAssignment({
      schedule,
      guest,
      memberId,
    });
    if (resolvedGuest.guest && shadowAction) {
      throw httpError(400, "Guests can only fill the primary assignment.");
    }
    const normalizedMemberId = resolvedGuest.memberId;
    const member =
      normalizedMemberId && !resolvedGuest.guest && shadowAction !== "remove"
        ? await assertTeamEntityInChurch(
            "member",
            normalizedMemberId,
            churchId,
            {
              label: "Member",
            },
          )
        : null;
    const assignments = await buildValidatedScheduleAssignments({
      churchId,
      schedule,
      team,
      position,
      member,
      serviceId,
      positionSlotKey,
      memberId: normalizedMemberId,
      serviceDate,
      sourceServiceId,
      sourcePositionSlotKey,
      shadowAction,
      shadowKind,
      allowBlockout,
      allowRecurringAvailability,
      allowOccurrenceConflict: allowCrossTeamConflict,
      guestAssignment: Boolean(resolvedGuest.guest),
    });
    if (
      normalizedMemberId &&
      !resolvedGuest.guest &&
      shadowAction !== "remove"
    ) {
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
        targetCellKey: positionSlotKey,
      });
    }
    return { assignments, guests: resolvedGuest.guests };
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
    guest,
    serviceDate,
    sourceServiceId,
    sourcePositionSlotKey,
    shadowAction,
    shadowKind,
    allowBlockout,
    allowRecurringAvailability,
    allowCrossTeamConflict,
    adminUserId,
  }) => {
    const db = requireFirestore();
    if (!db) {
      const { assignments, guests } = await validateScheduleAssignment({
        churchId,
        scheduleId,
        serviceId,
        positionSlotKey,
        memberId,
        guest,
        serviceDate,
        sourceServiceId,
        sourcePositionSlotKey,
        shadowAction,
        shadowKind,
        allowBlockout,
        allowRecurringAvailability,
        allowCrossTeamConflict,
      });
      const current = await getTeamEntity("schedule", scheduleId);
      await setDoc(
        COLLECTIONS.teamSchedules,
        scheduleId,
        {
          assignments,
          guests,
          responses: prunedResponsesForAssignments(
            current?.responses,
            assignments,
          ),
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

      const resolvedGuest = resolveTeamScheduleGuestAssignment({
        schedule,
        guest,
        memberId,
      });
      if (resolvedGuest.guest && shadowAction) {
        throw httpError(400, "Guests can only fill the primary assignment.");
      }
      const normalizedMemberId = resolvedGuest.memberId;
      let member = null;
      if (
        normalizedMemberId &&
        !resolvedGuest.guest &&
        shadowAction !== "remove"
      ) {
        const memberSnap = await transaction.get(
          db.collection(COLLECTIONS.teamRosterMembers).doc(normalizedMemberId),
        );
        member = readTransactionTeamEntity(memberSnap, "memberId", "Member");
        if (member.churchId !== churchId) {
          throw httpError(404, "Member not found.");
        }
      }

      const assignments = await buildValidatedScheduleAssignments({
        churchId,
        schedule,
        team,
        position,
        member,
        serviceId,
        positionSlotKey,
        memberId: normalizedMemberId,
        serviceDate,
        sourceServiceId,
        sourcePositionSlotKey,
        shadowAction,
        shadowKind,
        allowBlockout,
        allowRecurringAvailability,
        allowOccurrenceConflict: allowCrossTeamConflict,
        guestAssignment: Boolean(resolvedGuest.guest),
      });
      if (
        normalizedMemberId &&
        !resolvedGuest.guest &&
        shadowAction !== "remove"
      ) {
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
          targetCellKey: positionSlotKey,
        });
      }
      const update = {
        assignments,
        guests: resolvedGuest.guests,
        // Re-derived against the new map so an answer cannot outlive the slot
        // it was about. Without this, clearing someone and putting them back
        // resurrects their old decline as though they had answered again.
        responses: prunedResponsesForAssignments(
          schedule.responses,
          assignments,
        ),
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
        allowOccurrenceConflict: allowCrossTeamConflict,
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
        allowOccurrenceConflict: allowCrossTeamConflict,
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

  return {
    async getTeamsBootstrap(req, res) {
      try {
        await requireTeamsView(req, req.params.churchId);
        // Opt-in: `?schedules=summary` trades full schedule docs for summaries
        // plus a hydrated window around today. Absent (older clients) keeps the
        // original full payload.
        const scheduleMode =
          req.query?.schedules === "summary" ? "summary" : "full";
        return res.json({
          success: true,
          ...(await buildTeamsBootstrap(req.params.churchId, { scheduleMode })),
        });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not load teams.");
      }
    },

    /**
     * Hydrates one schedule on demand, together with the other teams' schedules
     * that overlap its date window. The companions are what the grid needs to
     * warn "also scheduled on <team>" when assigning a member, so they must
     * arrive with the schedule rather than in a second round trip. The set is
     * bounded by team count, not by how many months of history exist.
     */
    async getTeamScheduleDetail(req, res) {
      try {
        await requireTeamsView(req, req.params.churchId);
        const schedule = await getDoc(
          COLLECTIONS.teamSchedules,
          req.params.scheduleId,
        );
        if (!schedule || schedule.churchId !== req.params.churchId) {
          throw httpError(404, "Schedule not found.");
        }
        const hydrated = { scheduleId: req.params.scheduleId, ...schedule };
        const all = await listTeamCollectionForChurch(
          COLLECTIONS.teamSchedules,
          "scheduleId",
          req.params.churchId,
        );
        const startDate = hydrated.startDate || hydrated.endDate || "";
        const endDate = hydrated.endDate || hydrated.startDate || "";
        const relatedSchedules = all.filter(
          (other) =>
            other.scheduleId !== hydrated.scheduleId &&
            !other.archivedAt &&
            other.teamId !== hydrated.teamId &&
            (!startDate ||
              !endDate ||
              scheduleOverlapsDateRange(other, startDate, endDate)),
        );
        return res.json({
          success: true,
          schedule: hydrated,
          relatedSchedules,
        });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not load this schedule.");
      }
    },

    async createTeamRosterMember(req, res) {
      try {
        await assertCsrf(req);
        const payload = await validateTeamMemberPayload(
          req.body,
          req.params.churchId,
        );
        const requestedTeamIds = await validateMemberTeamIds(
          req.body,
          req.params.churchId,
        );
        const admin = await requireTeamsEditForTeamIds(
          req,
          req.params.churchId,
          [
            ...(await collectMemberTeamIds(payload, req.params.churchId)),
            // Joining a team is an edit to that team's roster, so hold the
            // request to the same bar as editing the team itself.
            ...(requestedTeamIds || []),
          ],
        );
        const created = await upsertTeamEntity({
          kind: "member",
          churchId: req.params.churchId,
          payload,
          adminUserId: admin.user.uid,
        });
        // Positions are team-scoped, so being eligible for a team's position
        // implies belonging to that team's roster. Mirror the intake-apply flow
        // and reconcile membership into `team.memberIds`.
        const { member, teams: updatedTeams } = await syncMemberTeamMembership({
          req,
          churchId: req.params.churchId,
          member: created,
          positionIds: payload.positionIds,
          requestedTeamIds,
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_roster_member_created",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          memberId: member.memberId,
        });
        return res.json({
          success: true,
          member,
          ...(updatedTeams.length ? { teams: updatedTeams } : {}),
        });
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
        const requestedTeamIds = await validateMemberTeamIds(
          req.body,
          req.params.churchId,
        );
        const admin = await requireTeamsEditForTeamIds(
          req,
          req.params.churchId,
          [
            ...(await collectMemberTeamIds(existing, req.params.churchId)),
            ...(await collectMemberTeamIds(payload, req.params.churchId)),
            // Joining a team is an edit to that team's roster, so hold the
            // request to the same bar as editing the team itself.
            ...(requestedTeamIds || []),
          ],
        );
        const saved = await upsertTeamEntity({
          kind: "member",
          churchId: req.params.churchId,
          id: req.params.memberId,
          payload,
          adminUserId: admin.user.uid,
        });
        // Positions are team-scoped, so being eligible for a team's position
        // implies belonging to that team's roster. Mirror the intake-apply flow
        // and reconcile membership into `team.memberIds`.
        const { member, teams: updatedTeams } = await syncMemberTeamMembership({
          req,
          churchId: req.params.churchId,
          member: saved,
          positionIds: payload.positionIds,
          requestedTeamIds,
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_roster_member_updated",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          memberId: member.memberId,
        });
        return res.json({
          success: true,
          member,
          ...(updatedTeams.length ? { teams: updatedTeams } : {}),
        });
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

    /**
     * The signed-in person's own roster record and the slots they are on.
     *
     * Self-scoped by construction: the only member considered is the one whose
     * `userId` matches the session, so this needs church membership and no
     * teams permission at all. That matters — a volunteer holds
     * `teams: "none"`, and granting them `view` to see their own schedule would
     * expose the entire roster, every blockout date, and everyone else's
     * assignments.
     *
     * Returns `member: null` rather than erroring when the account has claimed
     * no record; that is the normal state for staff who are not on a team.
     */
    async getMyTeamAssignments(req, res) {
      try {
        const session = await requireHumanSession(req);
        if (session.churchId !== req.params.churchId) {
          throw httpError(403, "Access required");
        }
        const userId = session.user?.uid;
        if (!userId) {
          throw httpError(401, "Authentication required");
        }

        const members = await listTeamCollectionForChurch(
          COLLECTIONS.teamRosterMembers,
          "memberId",
          req.params.churchId,
        );
        const member = members.find((row) => row.userId === userId);
        if (!member) {
          return res.json({ success: true, member: null, occurrences: [] });
        }

        const [schedules, positions, teams] = await Promise.all([
          listTeamCollectionForChurch(
            COLLECTIONS.teamSchedules,
            "scheduleId",
            req.params.churchId,
          ),
          listTeamCollectionForChurch(
            COLLECTIONS.teamPositions,
            "positionId",
            req.params.churchId,
          ),
          listTeamCollectionForChurch(
            COLLECTIONS.teams,
            "teamId",
            req.params.churchId,
          ),
        ]);
        const positionNameById = new Map(
          positions.map((position) => [position.positionId, position.name]),
        );
        const teamNameById = new Map(
          teams.map((team) => [team.teamId, team.name]),
        );
        // `members` is the church roster already fetched to find this person.
        // `members` is the church roster already fetched to find this person.
        const memberById = new Map(members.map((row) => [row.memberId, row]));

        // Same display convention as the public schedule link the church
        // already emails out: first name, plus last initial only when two
        // people share one. Reused so the two views never disagree.
        const firstNameCounts = new Map();
        members.forEach((row) => {
          const firstName = String(row.firstName || "")
            .trim()
            .toLowerCase();
          if (!firstName) return;
          firstNameCounts.set(
            firstName,
            (firstNameCounts.get(firstName) || 0) + 1,
          );
        });
        const duplicateFirstNames = new Set(
          [...firstNameCounts.entries()]
            .filter(([, count]) => count > 1)
            .map(([name]) => name),
        );

        /** occurrenceId -> { startsAt, serving[], plan } */
        const byOccurrence = new Map();
        /**
         * Identity comes from the schedule's own occurrence record, not from
         * parsing the id. A combined occurrence is `group:<groupId>@<date>`, so
         * the id carries neither a serviceId nor an ISO start — reading the
         * record gives the real `startsAt` and every service it covers.
         */
        const ensureOccurrence = (occurrenceId, schedule) => {
          let entry = byOccurrence.get(occurrenceId);
          if (!entry) {
            const record = (schedule.occurrences || []).find(
              (item) => item?.occurrenceId === occurrenceId,
            );
            const startsAt = record?.startsAt || "";
            entry = {
              occurrenceId,
              serviceIds:
                record?.serviceIds?.length > 0
                  ? record.serviceIds
                  : [
                      record?.serviceId || String(occurrenceId).split("@")[0],
                    ].filter(Boolean),
              // Display name for the service, taken from the schedule's own
              // occurrence record — already joined with " & " when several
              // services share a combined date — so the client need not
              // rebuild it.
              name: String(record?.name || "").trim(),
              // Calendar date is what plans are keyed by; fall back to the id
              // suffix, which is already a date for combined occurrences.
              date: (
                startsAt ||
                String(occurrenceId).split("@")[1] ||
                ""
              ).slice(0, 10),
              startsAt,
              serving: [],
              plan: null,
            };
            byOccurrence.set(occurrenceId, entry);
          }
          return entry;
        };

        // First pass: only occurrences this person is on. Everything else stays
        // invisible — this endpoint must never become a roster read.
        schedules.forEach((schedule) => {
          if (schedule.archivedAt) return;
          Object.entries(schedule.assignments || {}).forEach(
            ([occurrenceId, cells]) => {
              Object.entries(cells || {}).forEach(([columnKey, cell]) => {
                if (!assignmentCellMemberIds(cell).includes(member.memberId)) {
                  return;
                }
                ensureOccurrence(occurrenceId, schedule);
              });
            },
          );
        });

        // Second pass: the full serving roster for those services, this person
        // included and flagged. One list rather than "mine" and "theirs" so it
        // reads like the public schedule, with their own row highlighted.
        schedules.forEach((schedule) => {
          if (schedule.archivedAt) return;
          Object.entries(schedule.assignments || {}).forEach(
            ([occurrenceId, cells]) => {
              const entry = byOccurrence.get(occurrenceId);
              if (!entry) return;
              Object.entries(cells || {}).forEach(([columnKey, cell]) => {
                const [positionId] = String(columnKey).split("::");
                const primaryId =
                  typeof cell === "string" ? cell : cell?.primaryMemberId;
                assignmentCellMemberIds(cell).forEach((assignedId) => {
                  const person = memberById.get(assignedId);
                  if (!person) return;
                  const isMe = assignedId === member.memberId;
                  // Only their own answer is returned. Whether a teammate
                  // accepted is the owner's business, not a co-volunteer's.
                  const own =
                    isMe && assignedId === primaryId
                      ? readAssignmentResponse(
                          schedule.responses?.[occurrenceId]?.[columnKey],
                          assignedId,
                        )
                      : null;
                  entry.serving.push({
                    ...(own
                      ? {
                          response: own.response,
                          respondedAt: own.respondedAt,
                        }
                      : {}),
                    memberId: isMe ? assignedId : "",
                    name: isMe
                      ? `${member.firstName} ${member.lastName}`.trim()
                      : scheduleMemberPublicName(person, duplicateFirstNames),
                    isMe,
                    scheduleId: schedule.scheduleId,
                    teamId: schedule.teamId,
                    teamName: teamNameById.get(schedule.teamId) || "",
                    positionId,
                    positionName: positionNameById.get(positionId) || "",
                    columnKey,
                    isPrimary: assignedId === primaryId,
                  });
                });
              });
            },
          );
        });

        // Attach the order of service.
        //
        // Deliberately *not* gated on `published`: that flag is set as a side
        // effect of minting share tokens (see `publishServicePlan`), so it means
        // "someone clicked copy/view once", not "approved for sharing". Gating
        // on it would hide every plan from churches that never use share links.
        //
        // The public link gate stays as it is — that URL is unauthenticated,
        // whereas this reader is signed in and already assigned to the service.
        const plans = await listTeamCollectionForChurch(
          COLLECTIONS.servicePlans,
          "planId",
          req.params.churchId,
        );
        // Keyed on (serviceId, date) — the identity that survives services being
        // combined or un-combined. Keying on `startsAt` alone was wrong twice
        // over: two services can start at the same instant and overwrite each
        // other, and a combined occurrence id is `group:<groupId>@<date>`, whose
        // suffix is a calendar date that never equals an ISO `plan.startsAt`.
        const planByServiceDate = new Map();
        plans.forEach((plan) => {
          if (!plan?.serviceId || !plan?.date) return;
          planByServiceDate.set(`${plan.serviceId}@${plan.date}`, plan);
        });

        byOccurrence.forEach((entry) => {
          const plan = entry.serviceIds
            .map((serviceId) =>
              planByServiceDate.get(`${serviceId}@${entry.date}`),
            )
            .find(Boolean);
          if (!plan) return;
          // Share URLs only when already published. Assigned volunteers already
          // see the plan content here; the public link lets them open or copy
          // the same share view the service plan editor exposes. Do not mint
          // tokens from this read path.
          const published = Boolean(plan.published);
          const publicUrls =
            published && plan.publicLinkToken
              ? {
                  team: buildPublicServicePlanUrl(plan.publicLinkToken),
                  ...(plan.publicGeneralLinkToken
                    ? {
                        general: buildPublicServicePlanUrl(
                          plan.publicGeneralLinkToken,
                        ),
                      }
                    : {}),
                }
              : undefined;
          entry.plan = {
            planId: plan.planId,
            name: plan.name || "",
            published,
            ...(publicUrls ? { publicUrls } : {}),
            sections: (plan.sections || []).map((section) => ({
              name: section?.name || "Section",
              elements: (section?.elements || []).map((element) => ({
                type: element?.type || "free",
                title: richTextToPlainText(element?.title) || "Untitled item",
                startTime: element?.startTime || "",
                durationSeconds: element?.durationSeconds,
              })),
            })),
          };
        });

        const occurrences = [...byOccurrence.values()].sort((a, b) =>
          a.startsAt.localeCompare(b.startsAt),
        );
        occurrences.forEach((entry) => {
          // Their own rows first, then a stable roster order.
          entry.serving.sort(
            (a, b) =>
              Number(b.isMe) - Number(a.isMe) ||
              a.teamName.localeCompare(b.teamName) ||
              a.positionName.localeCompare(b.positionName) ||
              a.name.localeCompare(b.name),
          );
        });

        return res.json({ success: true, member, occurrences });
      } catch (error) {
        return sendTeamsJsonError(
          res,
          error,
          "Could not load your assignments.",
        );
      }
    },

    /**
     * Accept or decline from an emailed link, with no account and no session.
     *
     * This is not a convenience path — it is the *primary* one. Volunteers
     * routinely have no account (roster and account list are deliberately
     * separate), so requiring sign-in to answer would mean the people most
     * likely to need a reminder are the ones who cannot reply to it.
     *
     * Authority comes entirely from the signed token, which names one church,
     * schedule, occurrence, cell, and member. Presenting it answers that one
     * assignment and nothing else: it starts no session, and the response body
     * deliberately carries only what the reader already knew from their own
     * email — the service name and date — never the roster or anyone else's
     * answer.
     *
     * Rate limited on the token, because unlike every other write here there is
     * no session to throttle behind.
     */
    buildAssignmentResponseUrl,

    /**
     * Tell people they are on this schedule.
     *
     * Sending is a **deliberate act, separate from building**. An owner shuffles
     * a grid for twenty minutes; if every assignment mailed on save, volunteers
     * would get a stream of contradictory notices and stop reading them. Nothing
     * leaves until someone presses send, and `sentAt` records that they did.
     *
     * Idempotent by (recipient, event, schedule, occurrence) through the ledger,
     * so pressing send twice does not re-mail anyone. Adding one person later
     * and sending again mails only them — which is the normal way schedules get
     * built, not an edge case.
     *
     * Failures are per-recipient and swallowed: one bad address must not stop
     * the rest of the team being told. Only addresses that actually sent are
     * recorded, so a failure retries on the next send rather than going quiet.
     */
    async sendTeamSchedule(req, res) {
      try {
        await assertCsrf(req);
        const schedule = await assertTeamEntityInChurch(
          "schedule",
          req.params.scheduleId,
          req.params.churchId,
          { label: "Schedule", active: false },
        );
        const admin = await requireTeamsEditForTeamIds(
          req,
          req.params.churchId,
          [schedule.teamId].filter(Boolean),
        );

        const [members, positions, teams] = await Promise.all([
          listTeamCollectionForChurch(
            COLLECTIONS.teamRosterMembers,
            "memberId",
            req.params.churchId,
          ),
          listTeamCollectionForChurch(
            COLLECTIONS.teamPositions,
            "positionId",
            req.params.churchId,
          ),
          listTeamCollectionForChurch(
            COLLECTIONS.teams,
            "teamId",
            req.params.churchId,
          ),
        ]);
        /**
         * Holders include schedule guests, not just the roster.
         *
         * A guest can carry an email, and skipping them meant the toast could
         * report everyone notified while guest slots were silently ignored —
         * the exact false confidence `unreachableMemberIds` exists to prevent.
         * Guests have no account, so they resolve through `member.email` and
         * have no stored preference, which defaults them to on.
         */
        const memberById = new Map(members.map((row) => [row.memberId, row]));
        (schedule.guests || []).forEach((guest) => {
          if (!guest?.guestId || memberById.has(guest.guestId)) return;
          const name = String(guest.name || "").trim();
          memberById.set(guest.guestId, {
            memberId: guest.guestId,
            firstName: name.split(/\s+/)[0] || name,
            lastName: "",
            ...(guest.email ? { email: guest.email } : {}),
          });
        });
        const positionNameById = new Map(
          positions.map((row) => [row.positionId, row.name]),
        );
        const teamName =
          teams.find((row) => row.teamId === schedule.teamId)?.name || "";

        // One entry per (member, occurrence, slot) actually assigned.
        const slots = [];
        Object.entries(schedule.assignments || {}).forEach(
          ([occurrenceId, row]) => {
            Object.entries(row || {}).forEach(([cellKey, cell]) => {
              const memberId =
                typeof cell === "string" ? cell : cell?.primaryMemberId || "";
              const member = memberId ? memberById.get(memberId) : null;
              if (!member || member.archivedAt) return;
              const occurrence = (schedule.occurrences || []).find(
                (item) => item?.occurrenceId === occurrenceId,
              );
              slots.push({
                member,
                occurrenceId,
                cellKey,
                serviceName: occurrence?.name || "Service",
                startsAt: occurrence?.startsAt || "",
                positionName:
                  positionNameById.get(String(cellKey).split("::")[0]) || "",
              });
            });
          },
        );

        const notified = await notifyScheduleAssignments({
          churchId: req.params.churchId,
          schedule,
          slots,
        });

        const sentAt = nowIso();
        await setDoc(
          COLLECTIONS.teamSchedules,
          req.params.scheduleId,
          { sentAt, updatedAt: sentAt, updatedByUid: admin.user.uid },
          { merge: true },
        );
        await addSecurityEvent({
          type: "team_schedule_sent",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          scheduleId: req.params.scheduleId,
        });
        emitTeamsEvent(req.params.churchId, "schedule-updated", {
          schedule: { ...schedule, sentAt },
        });

        return res.json({ success: true, sentAt, ...notified, teamName });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not send this schedule.");
      }
    },

    /**
     * What an emailed link is asking about.
     *
     * Read-only companion to the write below. Without it the page can only say
     * "Can you serve?" with no service named — which is what shipped first, and
     * is not a question anyone can answer.
     *
     * Returns only this member's own slots on this one schedule: no roster, no
     * teammates, no other schedules.
     */
    async getAssignmentResponseContext(req, res) {
      try {
        const token = String(req.query?.token || "").trim();
        await enforcePublicTokenRateLimit({
          req,
          scope: "team_assignment_response_read",
          token,
          limit: 40,
          windowMs: 10 * 60 * 1000,
          blockMs: 10 * 60 * 1000,
        });
        const { churchId, scheduleId, memberId } = assertAssignmentToken(token);

        const schedule = await getTeamEntity("schedule", scheduleId);
        if (!schedule || schedule.churchId !== churchId) {
          throw httpError(404, "That schedule is no longer available.");
        }
        const members = await listTeamCollectionForChurch(
          COLLECTIONS.teamRosterMembers,
          "memberId",
          churchId,
        );
        const member =
          members.find((row) => row.memberId === memberId) ||
          (schedule.guests || []).find((guest) => guest?.guestId === memberId);
        const church = await getChurchById(churchId);

        return res.json({
          success: true,
          churchName: church?.name || "",
          firstName: String(member?.firstName || member?.name || "")
            .trim()
            .split(/\s+/)[0],
          assignments: await listMemberAssignmentsOnSchedule(schedule, memberId),
        });
      } catch (error) {
        return sendTeamsJsonError(
          res,
          error,
          "Could not open this link. Ask your team lead to resend it.",
        );
      }
    },

    /**
     * Accept or decline from an emailed link, with no account and no session.
     *
     * This is not a convenience path — it is the *primary* one. Volunteers
     * routinely have no account (roster and account list are deliberately
     * separate), so requiring sign-in to answer would mean the people most
     * likely to need a reminder are the ones who cannot reply to it.
     *
     * Answers one slot when given `occurrenceId` + `cellKey`, or **all** of the
     * member's slots on this schedule when they are omitted. Answering four
     * services should not mean opening four links.
     *
     * Rate limited on the token, because unlike every other write here there is
     * no session to throttle behind.
     */
    async respondToAssignmentByToken(req, res) {
      try {
        const token = String(req.body?.token || "").trim();
        await enforcePublicTokenRateLimit({
          req,
          scope: "team_assignment_response",
          token,
          limit: 20,
          windowMs: 10 * 60 * 1000,
          blockMs: 10 * 60 * 1000,
        });

        const response = normalizeAssignmentResponse(req.body?.response);
        if (response === "pending") {
          throw httpError(400, "Choose accept or decline.");
        }
        const { churchId, scheduleId, memberId } = assertAssignmentToken(token);

        const existing = await getTeamEntity("schedule", scheduleId);
        if (!existing || existing.churchId !== churchId) {
          throw httpError(404, "That schedule is no longer available.");
        }
        const occurrenceId = normalizeShortText(req.body?.occurrenceId, {
          max: 200,
        });
        const cellKey = normalizeShortText(req.body?.cellKey, { max: 200 });
        // Slot coordinates only — the enriched list needs every position in the
        // church, and that read is already paid for once when the answer is
        // returned below.
        const targets =
          occurrenceId && cellKey
            ? [{ occurrenceId, cellKey }]
            : listMemberSlotKeys(existing, memberId);

        const { schedule, applied } = await writeAssignmentResponses({
          churchId,
          scheduleId,
          memberId,
          targets,
          response,
        });
        emitTeamsEvent(churchId, "schedule-updated", { schedule });
        // Owners learn about this without watching the grid. Coalesced, so a
        // burst of answers after a send arrives as one email.
        await scheduleAssignmentResponseDigest(scheduleId);

        return res.json({
          success: true,
          response,
          applied,
          assignments: await listMemberAssignmentsOnSchedule(schedule, memberId),
        });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not save your response.");
      }
    },

    /**
     * "Send me an account" from the emailed response page.
     *
     * The end of the loop this phase started: someone with no account has just
     * answered from a link, and the next thing they want is the plan, their time
     * off, and reminders. Until now that ended at "ask your team lead", which is
     * the back-and-forth the whole feature exists to remove.
     *
     * **The invite goes to the address on the member record**, resolved by
     * `sendRosterMemberInvite` from the record itself — this handler never sees
     * or forwards an address, and the request body carries nothing but the
     * token. A public endpoint that mailed an address from its body would be a
     * way to send WorshipSync-branded invites anywhere. In practice the invite
     * lands in the same inbox that received the link being redeemed, so
     * redeeming it proves no more than reading that mailbox already did.
     *
     * Rate limited hard: unlike answering, this sends mail, and the only thing
     * throttling it is the token.
     */
    async requestAccountFromAssignmentToken(req, res) {
      try {
        const token = String(req.body?.token || "").trim();
        await enforcePublicTokenRateLimit({
          req,
          scope: "team_assignment_account_request",
          token,
          limit: 3,
          windowMs: 60 * 60 * 1000,
          blockMs: 60 * 60 * 1000,
        });
        const { churchId, memberId } = assertAssignmentToken(token);

        const members = await listTeamCollectionForChurch(
          COLLECTIONS.teamRosterMembers,
          "memberId",
          churchId,
        );
        const member = members.find((row) => row.memberId === memberId);
        // Schedule guests are emailed too and carry no roster record. An account
        // for someone not on the roster would show an empty schedule for ever,
        // so this is a real answer rather than a failure.
        if (!member || member.archivedAt) {
          throw httpError(
            404,
            "You are not on this team's roster. Ask your team lead to add you.",
          );
        }
        if (member.userId) {
          throw httpError(
            409,
            "You already have an account here. Sign in with your email address.",
          );
        }

        const { email } = await sendRosterMemberInvite({ churchId, member });
        await addSecurityEvent({
          type: "team_roster_member_self_invite_requested",
          churchId,
          memberId,
        });

        return res.json({
          success: true,
          // Echoed so the page can say which inbox to check. Safe to return:
          // this is the address the link was mailed to in the first place.
          email,
        });
      } catch (error) {
        return sendTeamsJsonError(
          res,
          error,
          "Could not send your invite. Ask your team lead for one.",
        );
      }
    },

    /**
     * Accept or decline one of the signed-in person's own assignments.
     *
     * Self-scoped like the rest of `/my-schedule`: the member is resolved from
     * the session, and the slot must actually be held by them, so a volunteer
     * cannot answer on anyone else's behalf. Needs no teams permission.
     *
     * Writes only `schedule.responses` — never `assignments`. A volunteer
     * declining must not remove themselves from the grid: the owner decides who
     * covers the slot, and a slot silently emptying itself is how a service
     * ends up short with nobody realising.
     *
     * This is the in-app path. The emailed signed-token path lands with the
     * dispatch work; both write through here so the two can never disagree.
     */
    async respondToMyAssignment(req, res) {
      try {
        await assertCsrf(req);
        const session = await requireHumanSession(req);
        if (session.churchId !== req.params.churchId) {
          throw httpError(403, "Access required");
        }
        const userId = session.user?.uid;
        if (!userId) throw httpError(401, "Authentication required");

        const response = normalizeAssignmentResponse(req.body?.response);
        if (response === "pending") {
          throw httpError(400, "Choose accept or decline.");
        }
        const occurrenceId = normalizeShortText(req.body?.occurrenceId, {
          max: 200,
        });
        const cellKey = normalizeShortText(req.body?.cellKey, { max: 200 });
        const scheduleId = normalizeShortText(req.body?.scheduleId, {
          max: 160,
        });
        if (!occurrenceId || !cellKey || !scheduleId) {
          throw httpError(400, "That assignment is no longer available.");
        }

        const members = await listTeamCollectionForChurch(
          COLLECTIONS.teamRosterMembers,
          "memberId",
          req.params.churchId,
        );
        const member = members.find((row) => row.userId === userId);
        if (!member) {
          throw httpError(
            404,
            "Your account is not linked to a team member yet.",
          );
        }

        // Same writer as the emailed path, so the two can never disagree about
        // who may answer or how a concurrent answer is handled.
        const { schedule } = await writeAssignmentResponses({
          churchId: req.params.churchId,
          scheduleId,
          memberId: member.memberId,
          targets: [{ occurrenceId, cellKey }],
          response,
          actorUid: userId,
        });
        emitTeamsEvent(req.params.churchId, "schedule-updated", { schedule });
        // Owners learn about this without watching the grid. Coalesced, so a
        // burst of answers after a send arrives as one email.
        await scheduleAssignmentResponseDigest(scheduleId);
        return res.json({ success: true, response });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not save your response.");
      }
    },

    /**
     * The signed-in person's own blockout dates.
     *
     * Self-scoped exactly like {@link getMyTeamAssignments}: the record written
     * is the one whose `userId` matches the session, never a `memberId` from the
     * request. A volunteer holds `teams: "none"`, so routing this through the
     * admin roster endpoint would mean granting them edit rights over the whole
     * roster to maintain their own availability.
     *
     * Writes `blockoutDates` and nothing else — the merge in `upsertTeamEntity`
     * leaves positions, qualifications, and links untouched, so this cannot
     * become a self-service path to eligibility.
     *
     * Dates the member is already scheduled for are accepted, not refused. The
     * conflict is real information for both sides; swallowing the blockout to
     * protect the grid would leave the owner believing a slot is covered.
     */
    async updateMyBlockoutDates(req, res) {
      try {
        await assertCsrf(req);
        const session = await requireHumanSession(req);
        if (session.churchId !== req.params.churchId) {
          throw httpError(403, "Access required");
        }
        const userId = session.user?.uid;
        if (!userId) {
          throw httpError(401, "Authentication required");
        }

        const members = await listTeamCollectionForChurch(
          COLLECTIONS.teamRosterMembers,
          "memberId",
          req.params.churchId,
        );
        const member = members.find((row) => row.userId === userId);
        if (!member) {
          throw httpError(
            404,
            "Your account is not linked to a team member yet.",
          );
        }
        // Load-bearing, not defensive: `upsertTeamEntity` writes
        // `archivedAt: null` on every save, so without this an archived
        // volunteer could restore themselves to the roster by saving a date.
        if (member.archivedAt) {
          throw httpError(
            403,
            "Your member record is archived. Ask an admin to restore it.",
          );
        }

        // The write replaces the whole array, so without a precondition an
        // admin editing this member's blockouts loses their change the moment
        // the member saves a page loaded beforehand — silently, with nothing
        // but a securityEvents row saying the member saved. Required rather
        // than advisory: this endpoint has only ever had one client.
        const expectedUpdatedAt = normalizeShortText(
          req.body?.expectedUpdatedAt,
          { max: 64 },
        );
        if (member.updatedAt && expectedUpdatedAt !== member.updatedAt) {
          throw httpError(
            409,
            "Your time off changed somewhere else. Check the dates and save again.",
          );
        }

        const submitted = normalizeBlockoutDates(req.body?.blockoutDates);

        // Drop history past the retention window, so the array reaches a steady
        // state rather than growing for the life of the account.
        const retentionCutoff = new Date(
          Date.now() - BLOCKOUT_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000,
        )
          .toISOString()
          .slice(0, 10);
        const blockoutDates = submitted.filter(
          (range) => (range.endDate || range.startDate) >= retentionCutoff,
        );

        // Two bounds, because they answer different questions.
        //
        // Entries still accumulate within the retention window, so a limit
        // counted across the whole array would blame last year's trips for
        // refusing next month's. Only entries that have not ended yet count
        // against the limit a person can actually feel.
        const today = nowIso().slice(0, 10);
        const upcoming = blockoutDates.filter(
          (range) => (range.endDate || range.startDate) >= today,
        );
        if (upcoming.length > MAX_SELF_UPCOMING_BLOCKOUT_RANGES) {
          throw httpError(
            400,
            `That is over ${MAX_SELF_UPCOMING_BLOCKOUT_RANGES} upcoming blockout entries. Remove one before adding another.`,
          );
        }
        // The absolute ceiling is about document size, not about what anyone
        // needs. The admin roster editor is behind an edit permission; this
        // endpoint is reachable by the narrowest tier there is, and every
        // member document is read on the Teams bootstrap, so one bloated record
        // slows the whole church.
        if (blockoutDates.length > MAX_SELF_BLOCKOUT_RANGES) {
          throw httpError(
            400,
            "That is too many blockout entries to store. Remove some old ones and try again.",
          );
        }

        const saved = await upsertTeamEntity({
          kind: "member",
          churchId: req.params.churchId,
          id: member.memberId,
          payload: { blockoutDates },
          adminUserId: userId,
        });
        await addSecurityEvent({
          type: "team_roster_member_blockouts_self_updated",
          churchId: req.params.churchId,
          userId,
          memberId: member.memberId,
        });

        // Owners have no other way to learn about this. The person who made the
        // change cannot see the schedule, and the amber grid flag only reaches
        // someone who happens to open it. Deliberately after the response is
        // committed and never fatal: the volunteer's time off is saved either
        // way, and a queueing failure must not read to them as a failed save.
        await recordBlockoutConflicts({
          churchId: req.params.churchId,
          memberId: member.memberId,
          previousRanges: member.blockoutDates || [],
          nextRanges: blockoutDates,
        }).catch((error) =>
          logAuthEvent("warn", "schedule.blockout.conflict-notify-error", {
            churchId: req.params.churchId,
            memberId: member.memberId,
            errorMessage: error?.message || "notify failed",
          }),
        );

        return res.json({ success: true, member: saved });
      } catch (error) {
        return sendTeamsJsonError(
          res,
          error,
          "Could not save your blockout dates.",
        );
      }
    },

    /**
     * Claims a roster member record for the signed-in account ("this is me").
     *
     * The invite path cannot serve this case: someone who already belongs to
     * the church is rejected with "You are already a member of this church"
     * (`inviteMembershipGuards`), so staff and admins who are also on the roster
     * had no way to link at all.
     *
     * This stays consistent with the rule that links are never inferred — the
     * identity here is the session, which is as certain as it gets. It is also
     * audited and reversible via the unlink endpoint.
     *
     * Accepts an optional `userId` to link someone other than the caller. That
     * target must hold an **active membership in this church** — without that
     * check a typo'd or guessed uid would hand an outsider a member's schedule
     * and notifications. Omit it to claim the record for yourself.
     */
    async linkTeamRosterMember(req, res) {
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
        const requestedUserId = normalizeShortText(req.body?.userId, {
          max: 160,
        });
        const userId = requestedUserId || admin.user.uid;
        const isSelf = userId === admin.user.uid;

        if (!isSelf) {
          const memberships =
            (await listMembershipsForChurch(req.params.churchId)) || [];
          const target = memberships.find(
            (membership) =>
              membership.userId === userId && membership.status === "active",
          );
          if (!target) {
            throw httpError(
              404,
              "That account is not an active member of this church.",
            );
          }
        }

        if (existing.userId === userId) {
          return res.json({ success: true });
        }
        if (existing.userId) {
          throw httpError(
            400,
            "That member is already linked to another account. Unlink them first.",
          );
        }

        // One account may claim at most one member per church, or notifications
        // would have two candidate records for the same person.
        const members = await listTeamCollectionForChurch(
          COLLECTIONS.teamRosterMembers,
          "memberId",
          req.params.churchId,
        );
        const alreadyClaimed = members.find(
          (member) =>
            member.userId === userId && member.memberId !== req.params.memberId,
        );
        if (alreadyClaimed) {
          throw httpError(
            400,
            isSelf
              ? "Your account is already linked to another member in this church. Unlink that one first."
              : "That account is already linked to another member in this church. Unlink that one first.",
          );
        }

        const now = nowIso();
        await setDoc(
          COLLECTIONS.teamRosterMembers,
          req.params.memberId,
          {
            userId,
            linkedAt: now,
            updatedAt: now,
            updatedByUid: admin.user.uid,
          },
          { merge: true },
        );
        await addSecurityEvent({
          type: "team_member_linked",
          churchId: req.params.churchId,
          // Who performed the link, so the audit trail names the actor rather
          // than the subject.
          userId: admin.user.uid,
          linkedUserId: userId,
          memberId: req.params.memberId,
          source: isSelf ? "self" : "admin",
        });
        return res.json({ success: true });
      } catch (error) {
        return sendTeamsJsonError(
          res,
          error,
          "Could not link this member to your account.",
        );
      }
    },

    /**
     * Detaches a roster member from the account it was linked to.
     *
     * Needed because a wrong link is worse than no link — the member would
     * receive another person's schedule. Clearing `userId` returns them to
     * `unlinked`, after which a fresh member invite can attach the right
     * account. The member record, and their contact email, are untouched.
     */
    async unlinkTeamRosterMember(req, res) {
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
        if (!existing.userId) {
          return res.json({ success: true, member: existing });
        }
        const now = nowIso();
        await setDoc(
          COLLECTIONS.teamRosterMembers,
          req.params.memberId,
          {
            userId: "",
            linkedAt: "",
            invitedAt: "",
            updatedAt: now,
            updatedByUid: admin.user.uid,
          },
          { merge: true },
        );
        await addSecurityEvent({
          type: "team_member_unlinked",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          memberId: req.params.memberId,
          previousUserId: existing.userId,
        });
        return res.json({ success: true });
      } catch (error) {
        return sendTeamsJsonError(
          res,
          error,
          "Could not unlink this member from their account.",
        );
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
            enabledFields: normalizeTeamIntakeFields(
              undefined,
              form.enabledFields,
            ),
            // Sent so the public form can mark the field required up front.
            // Enforcing on submit alone means a volunteer only discovers it
            // after filling the whole form and failing.
            requireEmail: Boolean(form.requireEmail),
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
            allowCrossTeamConflict: normalizeAllowOccurrenceConflict(req.body),
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
        await emitPublicPlansForScheduleOccurrences({
          churchId: req.params.churchId,
          occurrences: schedule.occurrences,
          revision: schedule.updatedAt || nowIso(),
        });
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
          existing,
        );
        const admin = await requireTeamsEditForTeamIds(
          req,
          req.params.churchId,
          [existing.teamId, payload.teamId],
        );
        const newAssignmentConflictChecks =
          getNewScheduleAssignmentConflictChecks({
            previousAssignments: existing.assignments,
            nextAssignments: payload.assignments,
          });
        if (Object.keys(newAssignmentConflictChecks).length > 0) {
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
            assignments: newAssignmentConflictChecks,
            schedules,
            allowCrossTeamConflict: normalizeAllowOccurrenceConflict(req.body),
          });
        }
        const saved = await upsertTeamEntity({
          kind: "schedule",
          churchId: req.params.churchId,
          id: req.params.scheduleId,
          payload,
          adminUserId: admin.user.uid,
        });
        // Editing occurrences rewrites assignments wholesale, so answers about
        // slots that no longer exist have to go with them.
        const schedule = await syncScheduleResponsesToAssignments(saved);
        await addSecurityEvent({
          type: "team_schedule_updated",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          scheduleId: schedule.scheduleId,
        });
        emitTeamsEvent(req.params.churchId, "schedule-updated", { schedule });
        await emitPublicPlansForScheduleOccurrences({
          churchId: req.params.churchId,
          occurrences: schedule.occurrences,
          revision: schedule.updatedAt || nowIso(),
        });
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
        await emitPublicPlansForScheduleOccurrences({
          churchId: req.params.churchId,
          occurrences: existing.occurrences,
          revision: nowIso(),
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
        await requireServicePlansView(req, churchId);
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
          startsAt: doc.startsAt,
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
        await requireServicePlansView(req, churchId);
        const planKey = decodeURIComponent(req.params.planKey);
        const docId = buildServicePlanDocId(churchId, planKey);
        const servicePlan = await getDoc(COLLECTIONS.servicePlans, docId);
        if (!servicePlan || servicePlan.churchId !== churchId) {
          return res.json({ success: true, servicePlan: null });
        }
        // Rebuild the share links for an already-published plan so reopening
        // the editor still shows them — they used to exist only in the publish
        // response, so a reload left an operator with no way to reach the
        // links short of publishing again. Edit-gated: a share URL embeds the
        // capability token, so a Teams *viewer* must not receive one.
        const canEdit = await hasServicesEditAccess(req, churchId);
        let publicUrls;
        if (canEdit && servicePlan.published && servicePlan.publicLinkToken) {
          const church = await getDoc(COLLECTIONS.churches, churchId);
          publicUrls = {
            team: buildPublicServicePlanUrl(servicePlan.publicLinkToken),
            ...(servicePlan.publicGeneralLinkToken
              ? {
                  general: buildPublicServicePlanUrl(
                    servicePlan.publicGeneralLinkToken,
                  ),
                }
              : {}),
            ...(church?.currentServiceTeamToken
              ? {
                  currentTeam: buildPublicServicePlanUrl(
                    church.currentServiceTeamToken,
                  ),
                }
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
          servicePlan: withoutServicePlanSecrets(servicePlan),
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
        const admin = await requireServicesEdit(req, churchId);
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
          await setDoc(COLLECTIONS.servicePlans, docId, nextPlan, {
            merge: Boolean(existing),
          });
          servicePlan = await getDoc(COLLECTIONS.servicePlans, docId);
        }
        emitTeamsEvent(churchId, "service-plan-updated", {
          servicePlan: withoutServicePlanSecrets(servicePlan),
        });
        await emitPublicServicePlanUpdated(
          servicePlan,
          Date.parse(servicePlan?.updatedAt || "") || Date.now(),
        );
        return res.json({
          success: true,
          servicePlan: withoutServicePlanSecrets(servicePlan),
        });
      } catch (error) {
        if (error?.servicePlanConflict) {
          return res.status(409).json({
            success: false,
            conflict: true,
            errorMessage: error.message,
            servicePlan: withoutServicePlanSecrets(error.servicePlanConflict),
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
        const admin = await requireServicesEdit(req, churchId);
        const payload = validateServicePlanTemplatePayload(req.body);
        const requestedId = normalizeShortText(req.body?.templateId, {
          max: 200,
        });
        const baseRevision = getServicePlanBaseRevision(req.body?.baseRevision);
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

        /**
         * Written whole rather than merged: `serviceId` is optional, so a merge
         * would leave a stale scope behind when a template is changed back to
         * "any service". Creation stamps are carried forward explicitly.
         */
        const buildNextTemplate = (current) => ({
          ...payload,
          templateId,
          churchId,
          revision: getServicePlanRevision(current) + 1,
          updatedAt: now,
          updatedByUid: admin.user.uid,
          createdAt: current?.createdAt || now,
          createdByUid: current?.createdByUid || admin.user.uid,
        });

        const db = requireFirestore();
        let template;
        if (db) {
          // Read-check-write in one transaction, so two autosaving editors
          // cannot both pass the revision check and overwrite each other.
          template = await db.runTransaction(async (transaction) => {
            const ref = db
              .collection(COLLECTIONS.servicePlanTemplates)
              .doc(templateId);
            const snapshot = await transaction.get(ref);
            const current = snapshot.exists
              ? { id: snapshot.id, ...snapshot.data() }
              : null;
            if (current && current.churchId !== churchId) {
              throw httpError(404, "Template not found.");
            }
            assertServicePlanTemplateRevision(current, baseRevision);
            const nextTemplate = buildNextTemplate(current);
            transaction.set(ref, nextTemplate, { merge: false });
            return nextTemplate;
          });
        } else {
          assertServicePlanTemplateRevision(existing, baseRevision);
          await setDoc(
            COLLECTIONS.servicePlanTemplates,
            templateId,
            buildNextTemplate(existing),
            { merge: false },
          );
          template = await getDoc(COLLECTIONS.servicePlanTemplates, templateId);
        }
        emitTeamsEvent(churchId, "service-plan-template-updated", { template });
        return res.json({ success: true, template });
      } catch (error) {
        if (error?.servicePlanTemplateConflict) {
          return res.status(409).json({
            success: false,
            conflict: true,
            errorMessage: error.message,
            template: error.servicePlanTemplateConflict,
          });
        }
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
        await requireServicesEdit(req, churchId);
        const templateId = decodeURIComponent(req.params.templateId);
        const existing = await getDoc(
          COLLECTIONS.servicePlanTemplates,
          templateId,
        );
        if (!existing || existing.churchId !== churchId) {
          throw httpError(404, "Template not found.");
        }
        await deleteDoc(COLLECTIONS.servicePlanTemplates, templateId);
        emitTeamsEvent(churchId, "service-plan-template-removed", {
          templateId,
        });
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
        const doc = await getDoc(
          COLLECTIONS.servicePlanAssignmentHistory,
          churchId,
        );
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
        await requireServicesEdit(req, churchId);
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

    async getServicePlanMicrophones(req, res) {
      try {
        const churchId = req.params.churchId;
        await requireTeamsView(req, churchId);
        const church = await getDoc(COLLECTIONS.churches, churchId);
        const microphones = (
          Array.isArray(church?.servicePlanMicrophones)
            ? church.servicePlanMicrophones
            : []
        )
          .map(normalizeServicePlanMicrophone)
          .filter(Boolean)
          .slice(0, MAX_SERVICE_PLAN_MICROPHONES);
        const hasSavedAudiences = Array.isArray(
          church?.servicePlanMicrophoneAudiences,
        );
        const hasLegacyMicrophoneAudiences = (
          church?.servicePlanMicrophones || []
        ).some((microphone) => Array.isArray(microphone?.audiences));
        let audiences;
        if (hasSavedAudiences) {
          audiences = normalizeServicePlanMicrophoneAudiences(
            church.servicePlanMicrophoneAudiences,
          );
        } else if (hasLegacyMicrophoneAudiences) {
          audiences = normalizeServicePlanMicrophoneAudiences(
            church.servicePlanMicrophones.flatMap(
              (microphone) => microphone?.audiences || [],
            ),
          );
        }
        return res.json({
          success: true,
          microphones,
          ...(audiences ? { audiences } : {}),
        });
      } catch (error) {
        return sendTeamsJsonError(
          res,
          error,
          "Could not load the microphone list.",
        );
      }
    },

    async saveServicePlanMicrophones(req, res) {
      try {
        await assertCsrf(req);
        const churchId = req.params.churchId;
        const admin = await requireServicesEdit(req, churchId);
        const microphones = (
          Array.isArray(req.body?.microphones) ? req.body.microphones : []
        )
          .map(normalizeServicePlanMicrophone)
          .filter(Boolean)
          .filter(
            (microphone, index, values) =>
              values.findIndex(
                (candidate) => candidate.id === microphone.id,
              ) === index,
          )
          .slice(0, MAX_SERVICE_PLAN_MICROPHONES);
        const audiences = normalizeServicePlanMicrophoneAudiences(
          req.body?.audiences,
        );
        await setDoc(
          COLLECTIONS.churches,
          churchId,
          {
            servicePlanMicrophones: microphones,
            servicePlanMicrophoneAudiences: audiences,
            updatedAt: nowIso(),
            updatedByUid: admin.user.uid,
          },
          { merge: true },
        );
        return res.json({ success: true, microphones, audiences });
      } catch (error) {
        return sendTeamsJsonError(
          res,
          error,
          "Could not save the microphone list.",
        );
      }
    },

    async publishServicePlan(req, res) {
      try {
        await assertCsrf(req);
        const churchId = req.params.churchId;
        const admin = await requireServicesEdit(req, churchId);
        const planKey = decodeURIComponent(req.params.planKey);
        const docId = buildServicePlanDocId(churchId, planKey);
        const existing = await getDoc(COLLECTIONS.servicePlans, docId);
        if (!existing || existing.churchId !== churchId) {
          throw httpError(404, "Service plan not found.");
        }
        if (!existing.startsAt || Number.isNaN(Date.parse(existing.startsAt))) {
          throw httpError(
            400,
            "Save the service start time before publishing.",
          );
        }
        const { publicLinkToken, publicGeneralLinkToken } =
          await ensureServicePlanPublicTokens(existing, admin.user.uid, docId);
        const {
          teamToken: currentTeamToken,
          generalToken: currentGeneralToken,
        } = await ensureChurchCurrentServiceTokens(churchId, admin.user.uid);
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
        await setDoc(COLLECTIONS.servicePlans, docId, nextPlan, {
          merge: true,
        });
        const servicePlan = await getDoc(COLLECTIONS.servicePlans, docId);
        emitTeamsEvent(churchId, "service-plan-updated", {
          servicePlan: withoutServicePlanSecrets(servicePlan),
        });
        await emitPublicServicePlanUpdated(
          servicePlan,
          Date.parse(now) || Date.now(),
        );
        return res.json({
          success: true,
          servicePlan: withoutServicePlanSecrets(servicePlan),
          publicUrl: buildPublicServicePlanUrl(publicLinkToken),
          teamPublicUrl: buildPublicServicePlanUrl(publicLinkToken),
          generalPublicUrl: buildPublicServicePlanUrl(publicGeneralLinkToken),
          currentTeamPublicUrl: buildPublicServicePlanUrl(currentTeamToken),
          currentGeneralPublicUrl:
            buildPublicServicePlanUrl(currentGeneralToken),
        });
      } catch (error) {
        return sendTeamsJsonError(
          res,
          error,
          "Could not publish this service plan.",
        );
      }
    },

    async unpublishServicePlan(req, res) {
      try {
        await assertCsrf(req);
        const churchId = req.params.churchId;
        const admin = await requireServicesEdit(req, churchId);
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
        emitTeamsEvent(churchId, "service-plan-updated", {
          servicePlan: withoutServicePlanSecrets(servicePlan),
        });
        await emitPublicServicePlanUpdated(
          { ...existing, published: true },
          Date.parse(now) || Date.now(),
        );
        return res.json({
          success: true,
          servicePlan: withoutServicePlanSecrets(servicePlan),
        });
      } catch (error) {
        return sendTeamsJsonError(
          res,
          error,
          "Could not unpublish this service plan.",
        );
      }
    },

    async updateServicePlanPublicLive(req, res) {
      try {
        await assertCsrf(req);
        const churchId = req.params.churchId;
        const admin = await requireServicesEdit(req, churchId);
        const planKey = decodeURIComponent(req.params.planKey);
        const docId = buildServicePlanDocId(churchId, planKey);
        const existing = await getDoc(COLLECTIONS.servicePlans, docId);
        if (!existing || existing.churchId !== churchId) {
          throw httpError(404, "Service plan not found.");
        }
        const now = nowIso();
        // A client may request a timeline re-anchor, but only the server sets
        // the start timestamp so every editor/viewer follows the same clock.
        const requestedLive =
          req.body?.mode === "anchored"
            ? { ...req.body, startedAt: now }
            : req.body;
        const publicLive = normalizePublicLiveState(requestedLive, existing);
        await setDoc(
          COLLECTIONS.servicePlans,
          docId,
          { publicLive, updatedAt: now, updatedByUid: admin.user.uid },
          { merge: true },
        );
        const servicePlan = await getDoc(COLLECTIONS.servicePlans, docId);
        emitTeamsEvent(churchId, "service-plan-updated", {
          servicePlan: withoutServicePlanSecrets(servicePlan),
        });
        await emitPublicServicePlanUpdated(
          servicePlan,
          Date.parse(now) || Date.now(),
        );
        return res.json({
          success: true,
          servicePlan: withoutServicePlanSecrets(servicePlan),
        });
      } catch (error) {
        return sendTeamsJsonError(
          res,
          error,
          "Could not update live service progress.",
        );
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
        const heartbeat = setInterval(
          () => res.write(": keep-alive\n\n"),
          25_000,
        );
        req.on("close", () => {
          clearInterval(heartbeat);
          removeServiceFlowSseClient(token, res);
          res.end();
        });
      } catch (error) {
        return sendTeamsJsonError(
          res,
          error,
          "Could not open service updates.",
        );
      }
    },

    async deleteServicePlan(req, res) {
      try {
        await assertCsrf(req);
        const churchId = req.params.churchId;
        await requireServicesEdit(req, churchId);
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
                title: normalizeShortText(submission.title, { max: 40 }),
                firstName: submission.firstName,
                lastName: submission.lastName,
                email: normalizeMemberEmail(submission.email),
                birthDate: normalizeBirthDate(submission.birthDate),
                isMinor:
                  isMinorFromBirthDate(submission.birthDate) ?? false,
                servingFrequency:
                  submission.servingFrequency || "as_needed",
                recurringAvailability:
                  submission.recurringAvailability ||
                  normalizeTeamMemberRecurringAvailability(null),
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
            // Backfill an address only when the member has none. A member who
            // submits intake is describing themselves, but an admin-entered
            // address is still the more deliberate record — never clobber it.
            const submittedEmail = normalizeMemberEmail(submission.email);
            const nextEmail = member.email ? member.email : submittedEmail;
            const submittedTitle = normalizeShortText(submission.title, {
              max: 40,
            });
            const submittedBirthDate = normalizeBirthDate(submission.birthDate);
            await setDoc(
              COLLECTIONS.teamRosterMembers,
              member.memberId,
              {
                desiredPositionIds: nextDesiredPositionIds,
                serviceAvailability: nextServiceAvailability,
                blockoutDates: nextBlockoutDates,
                ...(nextEmail ? { email: nextEmail } : {}),
                ...(!member.title && submittedTitle
                  ? { title: submittedTitle }
                  : {}),
                ...(!member.birthDate && submittedBirthDate
                  ? {
                    birthDate: submittedBirthDate,
                    isMinor:
                      isMinorFromBirthDate(submittedBirthDate) ??
                      Boolean(member.isMinor),
                  }
                  : {}),
                ...(submission.servingFrequency
                  ? { servingFrequency: submission.servingFrequency }
                  : {}),
                ...(submission.recurringAvailability
                  ? { recurringAvailability: submission.recurringAvailability }
                  : {}),
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
          updatedTeams = await loadTeamsByIds(
            req.params.churchId,
            Array.from(addedTeamIds),
          );
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
          guest: req.body?.guest,
          serviceDate: normalizeOptionalPlainDate(
            req.body?.serviceDate,
            "Service date",
          ),
          sourceServiceId: req.body?.sourceServiceId,
          sourcePositionSlotKey: req.body?.sourcePositionSlotKey,
          shadowAction: req.body?.shadowAction,
          shadowKind: req.body?.shadowKind,
          allowBlockout: normalizeAllowBlockout(req.body?.allowBlockout),
          allowRecurringAvailability: normalizeAllowRecurringAvailability(
            req.body?.allowRecurringAvailability,
          ),
          allowCrossTeamConflict: normalizeAllowOccurrenceConflict(req.body),
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
          guestAssignment: req.body?.guest != null,
        });
        emitTeamsEvent(req.params.churchId, "schedule-updated", { schedule });
        const changedOccurrenceIds = new Set([
          String(req.body?.serviceId || "").trim(),
          String(req.body?.sourceServiceId || "").trim(),
        ]);
        await emitPublicPlansForScheduleOccurrences({
          churchId: req.params.churchId,
          occurrences: (schedule.occurrences || []).filter((item) =>
            changedOccurrenceIds.has(String(item?.occurrenceId || "").trim()),
          ),
          revision: schedule.updatedAt || nowIso(),
        });
        return res.json({ success: true, schedule });
      } catch (error) {
        return sendTeamsJsonError(
          res,
          error,
          "Could not update this assignment.",
        );
      }
    },

    async updateTeamScheduleAssignmentMicrophones(req, res) {
      try {
        await assertCsrf(req);
        const churchId = req.params.churchId;
        const schedule = await assertTeamEntityInChurch(
          "schedule",
          req.params.scheduleId,
          churchId,
          { label: "Schedule", active: false },
        );
        const admin = await requireTeamsEditForTeam(
          req,
          churchId,
          schedule.teamId,
        );
        const team = await assertTeamEntityInChurch(
          "team",
          schedule.teamId,
          churchId,
          {
            label: "Team",
          },
        );
        if (!team.usesMicrophoneAssignments) {
          throw httpError(
            400,
            "This team does not use microphone assignments.",
          );
        }
        const occurrenceId = normalizeShortText(req.body?.serviceId, {
          max: 260,
        });
        const slotKey = normalizeShortText(req.body?.positionSlotKey, {
          max: 260,
        });
        const slot = parseScheduleSlotKey(slotKey);
        if (!slot) throw httpError(400, "Position slot key is invalid.");
        assertScheduleRowContains(schedule, occurrenceId);
        const occurrence = (schedule.occurrences || []).find(
          (item) => item.occurrenceId === occurrenceId,
        );
        const requirements = await resolveScheduleOccurrenceRequirements({
          churchId,
          occurrence,
        });
        const requirement = requirements.find(
          (item) => item?.positionId === slot.positionId,
        );
        {
          const requiredCount = Math.max(
            0,
            Math.floor(Number(requirement?.count) || 0),
          );
          const additionalSlots = new Set(
            normalizeTeamScheduleAdditionalPositionSlots(
              schedule.additionalPositionSlots ??
                schedule.optionalPositionSlots,
            )[occurrenceId] || [],
          );
          const normalizedSlotKey = makeScheduleSlotKey(
            slot.positionId,
            slot.slot,
          );
          if (
            slot.slot >= requiredCount &&
            !additionalSlots.has(normalizedSlotKey)
          ) {
            throw httpError(
              400,
              "Add this position before assigning microphones.",
            );
          }
        }
        const position = await assertTeamEntityInChurch(
          "position",
          slot.positionId,
          churchId,
          { label: "Position" },
        );
        assertSchedulePositionForTeam({ churchId, team, position });
        const church = await getDoc(COLLECTIONS.churches, churchId);
        const knownMicrophoneIds = new Set(
          (Array.isArray(church?.servicePlanMicrophones)
            ? church.servicePlanMicrophones
            : []
          ).map((microphone) => String(microphone?.id || "").trim()),
        );
        const microphoneIds = normalizeIdArray(req.body?.microphoneIds)
          .filter((microphoneId) => knownMicrophoneIds.has(microphoneId))
          .slice(0, 12);
        const microphoneAssignments =
          normalizeTeamScheduleMicrophoneAssignments(
            schedule.microphoneAssignments,
          );
        const row = { ...(microphoneAssignments[occurrenceId] || {}) };
        if (microphoneIds.length) row[slotKey] = microphoneIds;
        else delete row[slotKey];
        if (Object.keys(row).length) microphoneAssignments[occurrenceId] = row;
        else delete microphoneAssignments[occurrenceId];
        const update = {
          microphoneAssignments,
          updatedAt: nowIso(),
          updatedByUid: admin.user.uid,
        };
        await setDoc(COLLECTIONS.teamSchedules, schedule.scheduleId, update, {
          merge: true,
        });
        const updatedSchedule = { ...schedule, ...update };
        emitTeamsEvent(churchId, "schedule-updated", {
          schedule: updatedSchedule,
        });
        await emitPublicPlansForScheduleOccurrence({
          churchId,
          occurrence,
          revision: update.updatedAt,
        });
        return res.json({ success: true, schedule: updatedSchedule });
      } catch (error) {
        return sendTeamsJsonError(
          res,
          error,
          "Could not update microphone assignments.",
        );
      }
    },

    async addTeamSchedulePositionSlot(req, res) {
      try {
        await assertCsrf(req);
        const churchId = req.params.churchId;
        const schedule = await assertTeamEntityInChurch(
          "schedule",
          req.params.scheduleId,
          churchId,
          { label: "Schedule", active: false },
        );
        const admin = await requireTeamsEditForTeam(
          req,
          churchId,
          schedule.teamId,
        );
        const occurrenceId = normalizeShortText(req.body?.serviceId, {
          max: 260,
        });
        const slotKey = normalizeShortText(req.body?.positionSlotKey, {
          max: 260,
        });
        const slot = parseScheduleSlotKey(slotKey);
        if (!slot) throw httpError(400, "Position slot key is invalid.");
        assertScheduleRowContains(schedule, occurrenceId);
        const occurrence = (schedule.occurrences || []).find(
          (item) => item.occurrenceId === occurrenceId,
        );
        const requirements = await resolveScheduleOccurrenceRequirements({
          churchId,
          occurrence,
        });
        const requirement = requirements.find(
          (item) => item?.positionId === slot.positionId,
        );
        const requiredCount = Math.max(
          0,
          Math.floor(Number(requirement?.count) || 0),
        );
        if (slot.slot < requiredCount || slot.slot > 99) {
          throw httpError(
            400,
            "That additional position slot is not available for this service.",
          );
        }
        const position = await assertTeamEntityInChurch(
          "position",
          slot.positionId,
          churchId,
          { label: "Position" },
        );
        const team = await assertTeamEntityInChurch(
          "team",
          schedule.teamId,
          churchId,
          {
            label: "Team",
          },
        );
        assertSchedulePositionForTeam({ churchId, team, position });
        const additionalPositionSlots =
          normalizeTeamScheduleAdditionalPositionSlots(
            schedule.additionalPositionSlots ?? schedule.optionalPositionSlots,
          );
        const row = new Set(additionalPositionSlots[occurrenceId] || []);
        row.add(makeScheduleSlotKey(slot.positionId, slot.slot));
        additionalPositionSlots[occurrenceId] = [...row];
        const update = {
          additionalPositionSlots,
          updatedAt: nowIso(),
          updatedByUid: admin.user.uid,
        };
        await setDoc(COLLECTIONS.teamSchedules, schedule.scheduleId, update, {
          merge: true,
        });
        const updatedSchedule = { ...schedule, ...update };
        emitTeamsEvent(churchId, "schedule-updated", {
          schedule: updatedSchedule,
        });
        return res.json({ success: true, schedule: updatedSchedule });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not add this position.");
      }
    },

    async removeTeamSchedulePositionSlot(req, res) {
      try {
        await assertCsrf(req);
        const churchId = req.params.churchId;
        const existing = await assertTeamEntityInChurch(
          "schedule",
          req.params.scheduleId,
          churchId,
          { label: "Schedule", active: false },
        );
        const admin = await requireTeamsEditForTeam(
          req,
          churchId,
          existing.teamId,
        );
        const occurrenceId = normalizeShortText(req.body?.serviceId, {
          max: 260,
        });
        const slotKey = normalizeShortText(req.body?.positionSlotKey, {
          max: 260,
        });
        const slot = parseScheduleSlotKey(slotKey);
        if (!slot) throw httpError(400, "Position slot key is invalid.");
        const position = await assertTeamEntityInChurch(
          "position",
          slot.positionId,
          churchId,
          { label: "Position" },
        );
        const team = await assertTeamEntityInChurch(
          "team",
          existing.teamId,
          churchId,
          {
            label: "Team",
          },
        );
        assertSchedulePositionForTeam({ churchId, team, position });

        const buildUpdate = (schedule) => {
          assertScheduleRowContains(schedule, occurrenceId);
          const additionalPositionSlots =
            normalizeTeamScheduleAdditionalPositionSlots(
              schedule.additionalPositionSlots ??
                schedule.optionalPositionSlots,
            );
          const addedSlots = new Set(
            additionalPositionSlots[occurrenceId] || [],
          );
          const normalizedSlotKey = makeScheduleSlotKey(
            slot.positionId,
            slot.slot,
          );
          if (!addedSlots.delete(normalizedSlotKey)) {
            throw httpError(
              400,
              "That position was not added to this service.",
            );
          }
          if (addedSlots.size)
            additionalPositionSlots[occurrenceId] = [...addedSlots];
          else delete additionalPositionSlots[occurrenceId];

          const assignments = JSON.parse(
            JSON.stringify(schedule.assignments || {}),
          );
          if (assignments[occurrenceId]) {
            delete assignments[occurrenceId][normalizedSlotKey];
            if (Object.keys(assignments[occurrenceId]).length === 0) {
              delete assignments[occurrenceId];
            }
          }
          const microphoneAssignments =
            normalizeTeamScheduleMicrophoneAssignments(
              schedule.microphoneAssignments,
            );
          if (microphoneAssignments[occurrenceId]) {
            delete microphoneAssignments[occurrenceId][normalizedSlotKey];
            if (Object.keys(microphoneAssignments[occurrenceId]).length === 0) {
              delete microphoneAssignments[occurrenceId];
            }
          }
          return {
            additionalPositionSlots,
            assignments,
            microphoneAssignments,
            updatedAt: nowIso(),
            updatedByUid: admin.user.uid,
          };
        };

        const db = requireFirestore();
        let schedule;
        if (db) {
          schedule = await db.runTransaction(async (transaction) => {
            const scheduleRef = db
              .collection(COLLECTIONS.teamSchedules)
              .doc(existing.scheduleId);
            const snapshot = await transaction.get(scheduleRef);
            const current = readTransactionTeamEntity(
              snapshot,
              "scheduleId",
              "Schedule",
              { active: false },
            );
            if (current.churchId !== churchId) {
              throw httpError(404, "Schedule not found.");
            }
            const update = buildUpdate(current);
            // Replaces each root map so the deleted position and its assignments
            // cannot be resurrected by Firestore's nested merge behavior.
            transaction.update(scheduleRef, update);
            return { ...current, ...update };
          });
        } else {
          const update = buildUpdate(existing);
          schedule = { ...existing, ...update };
          await setDoc(
            COLLECTIONS.teamSchedules,
            existing.scheduleId,
            schedule,
            {
              merge: false,
            },
          );
        }
        emitTeamsEvent(churchId, "schedule-updated", { schedule });
        await emitPublicPlansForScheduleOccurrence({
          churchId,
          occurrence: (schedule.occurrences || []).find(
            (item) => item.occurrenceId === occurrenceId,
          ),
          revision: schedule.updatedAt || nowIso(),
        });
        return res.json({ success: true, schedule });
      } catch (error) {
        return sendTeamsJsonError(
          res,
          error,
          "Could not remove this position.",
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
          allowCrossTeamConflict: normalizeAllowOccurrenceConflict(req.body),
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
        await emitPublicPlansForScheduleOccurrence({
          churchId: req.params.churchId,
          occurrence: (schedule.occurrences || []).find(
            (item) => item.occurrenceId === String(req.body?.serviceId || "").trim(),
          ),
          revision: schedule.updatedAt || nowIso(),
        });
        return res.json({ success: true, schedule });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not apply this swap.");
      }
    },
  };
};
