import crypto from "node:crypto";
import { isDeepStrictEqual } from "node:util";
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
import { createNotificationLedger, deliveryKey } from "./notificationLedger.js";
import {
  isNotificationEnabled,
  normalizeNotificationPreferences,
} from "./notificationPreferences.js";
import {
  findUnreachableMemberIds,
  resolveMemberAddress,
} from "./notificationRecipients.js";
import { normalizeUsPhoneNumber } from "./phoneNumber.js";
import { resolveSmsMemberEligibility } from "./smsEligibility.js";
import {
  createTeamIntakeRecipientToken,
  decryptTeamIntakeRecipientToken,
  encryptTeamIntakeRecipientToken,
  hashTeamIntakeRecipientToken,
  looksLikeTeamIntakeRecipientToken,
  resolveTeamIntakeRecipientTokenSecret,
} from "./teamIntakeRecipientToken.js";
import { hasPersonalizedIntakeResponseFields } from "./teamIntakeFields.js";
import { encodeCsv, parseCsv } from "./dataTransfer/csv.js";
import {
  PORTABLE_SCHEMAS,
  buildPortableDatasets,
  LIST_DELIMITER,
  parsePortableEntityIcon,
} from "./dataTransfer/schemas.js";
import {
  classifyPortablePreviewAction,
  findPortableMatch,
  normalizePortableMatchValue,
  portableServiceMatches,
} from "./dataTransfer/matching.js";
import { createZip } from "./dataTransfer/zip.js";
import { persistPortableCreate } from "./dataTransfer/portableCreatePersister.js";
import {
  isValidPortablePlainDate,
  isValidPortableTimeZone,
  portableWallClockToIso,
} from "./dataTransfer/time.js";

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

const teamIntakeRecipientTokenSecret = resolveTeamIntakeRecipientTokenSecret();

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
  appendIntakeSubmissionToTransaction,
  persistTeamIntakeSubmission,
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
  readChurchServiceTimesForTransfer = readChurchServiceTimes,
  updateChurchServiceTimes = async () => {
    throw new Error("Service storage is unavailable.");
  },
  readChurchPublicBoardHeaderLogoUrl,
  readChurchPublicBrandingChrome,
  requireAdminSession,
  // Church membership without any teams grant — the guard a volunteer passes.
  requireHumanSession,
  requireServicesEditSession,
  requireServicePlansViewSession,
  requireTeamsEditSession,
  requireTeamsEditForTeamSession,
  requireScheduleMicrophoneEditSession,
  requireTeamsViewSession,
  getSessionActorUid = (bootstrap) => bootstrap?.user?.uid || null,
  requireFirestore,
  saveNotificationEventIntents = async () => [],
  sendTeamIntakeNotificationIntent = null,
  prepareTeamIntakeNotificationIntent = null,
  setDoc,
  updateDocFields,
  updateDocMapKeys,
  getUserByUid,
  getChurchById,
  getSmsConsentForChurchPhone = async () => null,
  sendEmail,
  servicePlanFromEmail,
  emailDeliveryConfigured = false,
  renderScheduleAssignmentEmail,
  renderServicePlanShareEmail,
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
  const requireScheduleMicrophoneEdit =
    requireScheduleMicrophoneEditSession || requireTeamsEditForTeam;
  const sessionActorUid = (bootstrap) => {
    const uid = getSessionActorUid(bootstrap);
    if (!uid) {
      throw httpError(403, "Authentication required");
    }
    return uid;
  };
  // The in-memory store used by local development and tests has no
  // transactions. Serialize writes to one schedule so they retain the same
  // no-lost-update guarantee as Firestore transactions.
  const inMemoryScheduleSaveQueues = new Map();
  const portableCreateQueues = new Map();
  const enqueuePortableCreate = (key, task) => {
    const previous = portableCreateQueues.get(key) || Promise.resolve();
    const run = previous.then(task, task);
    const settled = run.then(() => undefined, () => undefined);
    portableCreateQueues.set(key, settled);
    void settled.finally(() => {
      if (portableCreateQueues.get(key) === settled) {
        portableCreateQueues.delete(key);
      }
    });
    return run;
  };
  const enqueueInMemoryScheduleSave = (scheduleId, task) => {
    const previous =
      inMemoryScheduleSaveQueues.get(scheduleId) || Promise.resolve();
    const run = previous.then(task, task);
    const settled = run.then(
      () => undefined,
      () => undefined,
    );
    inMemoryScheduleSaveQueues.set(scheduleId, settled);
    void settled.finally(() => {
      if (inMemoryScheduleSaveQueues.get(scheduleId) === settled) {
        inMemoryScheduleSaveQueues.delete(scheduleId);
      }
    });
    return run;
  };

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
      ...(Array.isArray(error?.occurrenceConflicts)
        ? {
            occurrenceConflicts: error.occurrenceConflicts,
            conflictFingerprint: error.conflictFingerprint || "",
          }
        : {}),
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
   * answer — one click, not click-then-click-again. It rides in the query
   * string and is only applied when the SPA POSTs it.
   *
   * That indirection is not ceremony. Corporate mail security (Safe Links,
   * Proofpoint and friends) fetches every link in an email before a human sees
   * it; if a GET recorded the answer, scanners would accept on behalf of people
   * who never opened the message. Scanners do not run a single-page app and do
   * not POST, so the write stays with the reader. (Share links are path-based
   * for Open Graph previews; GET on this URL must never mutate schedule state.)
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
    // Path URL (not hash): chat crawlers strip fragments, so Open Graph meta is
    // served for `/schedule-response/...` and browsers redirect into HashRouter.
    return `${APP_BASE_URL}/schedule-response/${encodeURIComponent(token)}${query}`;
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
    if (!parsed || Number.isNaN(parsed.getTime()))
      return "Date to be confirmed";
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
    Object.entries(schedule.assignments || {}).forEach(
      ([occurrenceId, row]) => {
        Object.entries(row || {}).forEach(([cellKey, cell]) => {
          if (readCellHolderId(cell) === memberId) {
            slots.push({ occurrenceId, cellKey });
          }
        });
      },
    );
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
    Object.entries(schedule.assignments || {}).forEach(
      ([occurrenceId, row]) => {
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
      },
    );
    return slots.sort((a, b) =>
      String(a.startsAt).localeCompare(String(b.startsAt)),
    );
  };

  const buildTeamIntakePublicUrl = (token) =>
    `${APP_BASE_URL}/teams/intake/${encodeURIComponent(String(token || "").trim())}`;

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

  // The document id is deterministic so concurrent admins ensuring the same
  // team/range contend on one Firestore document instead of creating siblings.
  const generatedPeriodKeyFor = ({ churchId, teamId, startDate, endDate }) =>
    crypto
      .createHash("sha256")
      .update(`${churchId}\u0000${teamId}\u0000${startDate}\u0000${endDate}`)
      .digest("hex");
  const generatedPeriodScheduleId = (key) => `generated_${key}`;
  const generatedPeriodEnsureQueues = new Map();

  const withGeneratedPeriodEnsureLock = async (key, operation) => {
    const previous = generatedPeriodEnsureQueues.get(key) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => {
      release = resolve;
    });
    generatedPeriodEnsureQueues.set(key, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (generatedPeriodEnsureQueues.get(key) === current) {
        generatedPeriodEnsureQueues.delete(key);
      }
    }
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

  const normalizeMemberPhoneNumber = (value) => {
    try {
      return normalizeUsPhoneNumber(value);
    } catch {
      throw httpError(400, "Enter a valid U.S. mobile number.");
    }
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
    if (!isValidPortablePlainDate(date)) {
      throw httpError(400, `${fieldLabel} must be a valid date.`);
    }
    return date;
  };

  const getOccurrenceCalendarParts = (startsAt, timeZone) => {
    const instant = new Date(startsAt);
    if (Number.isNaN(instant.getTime())) {
      throw httpError(400, "Choose a valid service occurrence.");
    }
    let parts;
    try {
      parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(instant);
    } catch {
      throw httpError(400, "Choose a valid time zone for service occurrences.");
    }
    const values = Object.fromEntries(
      parts.map(({ type, value }) => [type, value]),
    );
    const weekdayIndex = [
      "Sun",
      "Mon",
      "Tue",
      "Wed",
      "Thu",
      "Fri",
      "Sat",
    ].indexOf(values.weekday);
    return {
      date: `${values.year}-${values.month}-${values.day}`,
      time: `${values.hour}:${values.minute}`,
      weekday: weekdayIndex,
      startsAt: instant.toISOString(),
    };
  };

  const getServiceOccurrenceTime = (service, localDate, timeZone) => {
    if (!service || service.archivedAt) return null;
    if (service.startDateISO && localDate < service.startDateISO) return null;
    if (service.endDateISO && localDate > service.endDateISO) return null;
    const date = new Date(`${localDate}T00:00:00.000Z`);
    const weekday = date.getUTCDay();
    if (service.reccurence === "one_time") {
      if (!service.dateTimeISO) return null;
      const serviceInstant = new Date(service.dateTimeISO);
      if (Number.isNaN(serviceInstant.getTime())) return null;
      if (
        getOccurrenceCalendarParts(serviceInstant.toISOString(), timeZone)
          .date !== localDate
      )
        return null;
      if (service.archivedAt && serviceInstant > new Date(service.archivedAt))
        return null;
      return getOccurrenceCalendarParts(serviceInstant.toISOString(), timeZone)
        .time;
    }
    if (service.reccurence === "weekly") {
      return Number(service.dayOfWeek) === weekday &&
        /^\d{2}:\d{2}$/.test(String(service.time || ""))
        ? service.time
        : null;
    }
    if (service.reccurence === "multi_weekly") {
      return (
        (service.daysOfWeek || []).find(
          (item) =>
            Number(item?.day) === weekday &&
            /^\d{2}:\d{2}$/.test(String(item?.time || "")),
        )?.time || null
      );
    }
    if (service.reccurence === "monthly") {
      const [year, month, day] = localDate.split("-").map(Number);
      const occurrenceDate = new Date(Date.UTC(year, month - 1, day));
      const ordinal = Number(service.ordinal);
      const isLastWeekday =
        day + 7 > new Date(Date.UTC(year, month, 0)).getUTCDate();
      const matchesOrdinal =
        ordinal === 5 ? isLastWeekday : Math.ceil(day / 7) === ordinal;
      return occurrenceDate.getUTCDay() === Number(service.weekday) &&
        matchesOrdinal &&
        /^\d{2}:\d{2}$/.test(String(service.time || ""))
        ? service.time
        : null;
    }
    return null;
  };

  const assertServiceOccurrence = ({ service, localParts, timeZone }) => {
    const scheduledTime = getServiceOccurrenceTime(
      service,
      localParts.date,
      timeZone,
    );
    if (!scheduledTime || scheduledTime !== localParts.time) {
      throw httpError(
        400,
        "A target does not match its current service recurrence.",
      );
    }
    if (
      service.reccurence === "one_time" &&
      new Date(service.dateTimeISO).toISOString() !== localParts.startsAt
    ) {
      throw httpError(
        400,
        "A target does not match its one-time service occurrence.",
      );
    }
    return scheduledTime;
  };

  const assertOccurrenceServiceGroup = ({
    serviceId,
    serviceIds,
    groupId,
    occurrenceId,
    startsAt,
    localParts,
    timeZone,
    servicesById,
  }) => {
    const primaryService = servicesById.get(serviceId);
    assertServiceOccurrence({ service: primaryService, localParts, timeZone });
    const configuredGroupId = normalizeShortText(
      primaryService?.serviceGroupId,
      { max: 160 },
    );
    const occurringGroupServices = configuredGroupId
      ? [...servicesById.entries()]
          .filter(
            ([, service]) =>
              normalizeShortText(service?.serviceGroupId, { max: 160 }) ===
              configuredGroupId,
          )
          .map(([id, service]) => ({
            id,
            service,
            time: getServiceOccurrenceTime(service, localParts.date, timeZone),
          }))
          .filter((entry) => entry.time)
          .sort(
            (left, right) =>
              left.time.localeCompare(right.time) ||
              String(left.service?.name || "").localeCompare(
                String(right.service?.name || ""),
              ),
          )
      : [];

    if (groupId) {
      const expectedIds = occurringGroupServices.map((entry) => entry.id);
      if (
        configuredGroupId !== groupId ||
        expectedIds.length < 2 ||
        serviceIds.length !== expectedIds.length ||
        serviceIds.some((id, index) => id !== expectedIds[index]) ||
        serviceId !== expectedIds[0]
      ) {
        throw httpError(
          400,
          "A combined occurrence does not match its configured service group.",
        );
      }
      if (occurrenceId !== `group:${groupId}@${startsAt.slice(0, 10)}`) {
        throw httpError(400, "A combined occurrence has an invalid identity.");
      }
      return;
    }

    if (
      serviceIds.length !== 1 ||
      serviceIds[0] !== serviceId ||
      occurringGroupServices.length > 1 ||
      occurrenceId !== `${serviceId}@${startsAt}`
    ) {
      throw httpError(
        400,
        "A service occurrence has an invalid identity or grouping.",
      );
    }
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
    const year =
      value.year === undefined || value.year === null || value.year === ""
        ? undefined
        : Number(value.year);
    const currentYear = new Date().getUTCFullYear();
    if (
      !Number.isInteger(month) ||
      month < 1 ||
      month > 12 ||
      !Number.isInteger(day) ||
      day < 1 ||
      day > 31
    ) {
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
    if (
      parsed.protocol !== "https:" ||
      parsed.hostname !== "res.cloudinary.com"
    ) {
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

  // Compatibility phase: microphone records remain writable only through
  // servicePlanMicrophones. The generic catalog accepts IEMs today and keeps
  // the category field ready for a later ID-preserving microphone migration.
  const MAX_SERVICE_EQUIPMENT = 80;
  const normalizeServiceEquipment = (raw) => {
    if (!raw || typeof raw !== "object" || raw.category !== "iem") return null;
    const name = normalizeShortText(raw.name, { max: 80 });
    if (!name) return null;
    const subtype = normalizeShortText(raw.subtype, { max: 80 });
    const color = String(raw.color || "").trim();
    return {
      id:
        normalizeShortText(raw.id, { max: 160 }) ||
        createId("serviceEquipment"),
      category: "iem",
      name,
      ...(subtype ? { subtype } : {}),
      color: /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : "#9ca3af",
    };
  };

  const normalizeServiceEquipmentCatalog = (raw) =>
    (Array.isArray(raw) ? raw : [])
      .map(normalizeServiceEquipment)
      .filter(Boolean)
      .filter(
        (item, index, values) =>
          values.findIndex((candidate) => candidate.id === item.id) === index,
      )
      .slice(0, MAX_SERVICE_EQUIPMENT);

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
   * Everyone doing an item, and the microphones/IEMs each of them carries. An entry
   * with no name and no memberId is the unassigned slot: a stand or spare mic.
   * Entries holding nothing at all are dropped rather than stored as blanks.
   */
  const normalizeServicePlanAssignees = (raw) => {
    const usedMicrophoneIds = new Set();
    const usedIemIds = new Set();
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
        // IEM IDs have a separate uniqueness domain; raw IDs may overlap mics.
        const iemIds = (Array.isArray(assignee.iemIds) ? assignee.iemIds : [])
          .map((iemId) => normalizeShortText(iemId, { max: 160 }))
          .filter((iemId) => {
            if (!iemId || usedIemIds.has(iemId)) return false;
            usedIemIds.add(iemId);
            return true;
          })
          .slice(0, MAX_SERVICE_PLAN_ATTACHMENTS);
        if (!name && !memberId && !microphoneIds.length && !iemIds.length)
          return null;
        return {
          id:
            normalizeShortText(assignee.id, { max: 160 }) ||
            createId("servicePlanAssignee"),
          ...(name ? { name } : {}),
          ...(memberId ? { memberId } : {}),
          ...(microphoneIds.length ? { microphoneIds } : {}),
          ...(iemIds.length ? { iemIds } : {}),
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
        ...(normalizeShortText(raw.id, { max: 160 })
          ? { id: normalizeShortText(raw.id, { max: 160 }) }
          : {}),
        kind: "library",
        songId,
        songName: normalizeShortText(raw.songName, { max: 300 }),
      };
    }
    if (raw.kind === "pending") {
      const title = normalizeShortText(raw.title, { max: 300 });
      if (!title) return undefined;
      return {
        ...(normalizeShortText(raw.id, { max: 160 })
          ? { id: normalizeShortText(raw.id, { max: 160 }) }
          : {}),
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
      ...(normalizeShortText(raw.id, { max: 160 })
        ? { id: normalizeShortText(raw.id, { max: 160 }) }
        : {}),
      label: normalizeShortText(raw.label, { max: 300 }),
      book,
      chapter,
      verseRange: normalizeShortText(raw.verseRange, { max: 50 }),
      version: normalizeShortText(raw.version, { max: 50 }),
    };
  };

  const normalizeServicePlanResourceData = (raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
    try {
      const serialized = JSON.stringify(raw);
      if (!serialized || serialized.length > 20_000) return undefined;
      return JSON.parse(serialized);
    } catch {
      return undefined;
    }
  };

  const normalizeServicePlanContentResource = (raw) => {
    if (!raw || typeof raw !== "object") return undefined;
    const title = normalizeShortText(raw.title, { max: 300 });
    if (!title) return undefined;
    const type =
      normalizeShortText(raw.type, { max: 80 })?.toLowerCase() || "generic";
    const rawUrl = normalizeShortText(raw.url, { max: 2_000 });
    let url;
    if (rawUrl) {
      try {
        const parsedUrl = new URL(rawUrl);
        if (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:") {
          url = rawUrl;
        }
      } catch {
        // Optional resource URLs are dropped when they are not web URLs.
      }
    }
    const provider = normalizeShortText(raw.provider, { max: 120 });
    const mediaId = normalizeShortText(raw.mediaId, { max: 300 });
    const data = normalizeServicePlanResourceData(raw.data);
    const metadata =
      raw.metadata && typeof raw.metadata === "object"
        ? {
            ...(normalizeShortText(raw.metadata.subtitle, { max: 300 })
              ? {
                  subtitle: normalizeShortText(raw.metadata.subtitle, {
                    max: 300,
                  }),
                }
              : {}),
            ...(Number.isFinite(Number(raw.metadata.duration)) &&
            Number(raw.metadata.duration) >= 0
              ? { duration: Number(raw.metadata.duration) }
              : {}),
            ...(normalizeShortText(raw.metadata.thumbnailUrl, { max: 2_000 })
              ? {
                  thumbnailUrl: normalizeShortText(raw.metadata.thumbnailUrl, {
                    max: 2_000,
                  }),
                }
              : {}),
            ...(normalizeShortText(raw.metadata.mimeType, { max: 160 })
              ? {
                  mimeType: normalizeShortText(raw.metadata.mimeType, {
                    max: 160,
                  }),
                }
              : {}),
          }
        : undefined;
    return {
      id:
        normalizeShortText(raw.id, { max: 160 }) ||
        createId("servicePlanResource"),
      type,
      title,
      ...(url ? { url } : {}),
      ...(provider ? { provider } : {}),
      ...(mediaId ? { mediaId } : {}),
      ...(data ? { data } : {}),
      ...(metadata && Object.keys(metadata).length ? { metadata } : {}),
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

  const normalizeServicePlanSourceLedByAssignments = (raw) => {
    if (!Array.isArray(raw)) return undefined;
    const assignments = raw
      .map((assignment) => {
        if (!assignment || typeof assignment !== "object") return undefined;
        const name = normalizeShortText(assignment.name, { max: 200 });
        if (!name) return undefined;
        const kind =
          assignment.kind === "person" || assignment.kind === "teamPosition"
            ? assignment.kind
            : undefined;
        if (!kind) return undefined;
        const id = normalizeShortText(assignment.id, { max: 160 });
        return { kind, ...(id ? { id } : {}), name };
      })
      .filter(Boolean);
    return assignments.length
      ? assignments.slice(0, MAX_SERVICE_PLAN_POSITIONS)
      : undefined;
  };

  const normalizeServicePlanImportAmbiguity = (raw) => {
    if (!raw || typeof raw !== "object" || raw.source !== "servicePlanning")
      return undefined;
    const sourceKey = normalizeShortText(raw.sourceKey, { max: 300 });
    const sourceFingerprint = normalizeLongText(raw.sourceFingerprint, {
      max: 3000,
    });
    const statuses = new Set([
      "unresolved",
      "deferred",
      "confirmed",
      "acknowledged",
    ]);
    if (!sourceKey || !sourceFingerprint || !statuses.has(raw.status))
      return undefined;
    const kinds = new Set(["scripture", "url", "person", "description"]);
    const destinations = new Set([
      "scripture",
      "resource",
      "assignee",
      "content",
      "notes",
      "unassigned",
    ]);
    const parts = Array.isArray(raw.parts)
      ? raw.parts
          .flatMap((part) => {
            if (
              !part ||
              typeof part !== "object" ||
              !kinds.has(part.kind) ||
              !destinations.has(part.destination)
            )
              return [];
            const value = normalizeLongText(part.value, { max: 1000 });
            if (!value) return [];
            const sourceField = ["title", "note", "ledBy"].includes(
              part.sourceField,
            )
              ? part.sourceField
              : undefined;
            const managedKind = [
              "assignee",
              "scripture",
              "resource",
              "note",
            ].includes(part.managed?.kind)
              ? part.managed.kind
              : undefined;
            const managedId = managedKind
              ? normalizeShortText(part.managed.id, { max: 160 })
              : "";
            const fingerprint = managedId
              ? normalizeLongText(part.managed.fingerprint, { max: 3000 })
              : "";
            return [
              {
                kind: part.kind,
                value,
                destination: part.destination,
                ...(sourceField ? { sourceField } : {}),
                ...(managedKind && managedId && fingerprint
                  ? {
                      managed: {
                        kind: managedKind,
                        id: managedId,
                        fingerprint,
                      },
                    }
                  : {}),
              },
            ];
          })
          .slice(0, 40)
      : [];
    const reasons = Array.isArray(raw.reasons)
      ? raw.reasons
          .map((reason) => normalizeShortText(reason, { max: 300 }))
          .filter(Boolean)
          .slice(0, 20)
      : [];
    return {
      source: "servicePlanning",
      sourceKey,
      sourceElementType: normalizeShortText(raw.sourceElementType, {
        max: 200,
      }),
      sourceTitle: normalizeLongText(raw.sourceTitle, { max: 2000 }),
      sourceLedBy: normalizeLongText(raw.sourceLedBy, { max: 2000 }),
      ...(raw.sourceNote
        ? { sourceNote: normalizeLongText(raw.sourceNote, { max: 2000 }) }
        : {}),
      parts,
      reasons,
      status: raw.status,
      sourceFingerprint,
      ...(raw.authorizationPending === true
        ? { authorizationPending: true }
        : {}),
    };
  };

  const normalizeServicePlanningSourceState = (raw) => {
    if (!raw || typeof raw !== "object") return undefined;
    const normalizeSnapshot = (snapshot) => {
      if (!snapshot || typeof snapshot !== "object") return undefined;
      return {
        elementType: normalizeShortText(snapshot.elementType, { max: 200 }),
        title: normalizeLongText(snapshot.title, { max: 2000 }),
        ledBy: normalizeLongText(snapshot.ledBy, { max: 2000 }),
        note: normalizeLongText(snapshot.note, { max: 2000 }),
      };
    };
    const observed = normalizeSnapshot(raw.observed);
    const applied = normalizeSnapshot(raw.applied);
    if (!observed || !applied) return undefined;
    const fields = new Set(["elementType", "title", "ledBy", "note"]);
    const pendingFields = Array.isArray(raw.pendingFields)
      ? [
          ...new Set(raw.pendingFields.filter((field) => fields.has(field))),
        ].slice(0, 4)
      : [];
    return { observed, applied, pendingFields };
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
    const resources = normalizeServicePlanAttachments(
      raw?.resources,
      normalizeServicePlanContentResource,
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
    const importAmbiguity = normalizeServicePlanImportAmbiguity(
      raw?.importAmbiguity,
    );
    const servicePlanningImport = normalizeServicePlanningSourceState(
      raw?.servicePlanningImport,
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
      resources,
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
      sourceLedByAssignments: normalizeServicePlanSourceLedByAssignments(
        raw?.sourceLedByAssignments,
      ),
      sourceElementTypeRaw:
        normalizeShortText(raw?.sourceElementTypeRaw, { max: 200 }) ||
        undefined,
      sourceContentTitleRaw:
        normalizeShortText(raw?.sourceContentTitleRaw, { max: 300 }) ||
        undefined,
      sourceNoteRaw:
        normalizeLongText(raw?.sourceNoteRaw, { max: 2000 }) || undefined,
      ...(importAmbiguity ? { importAmbiguity } : {}),
      ...(servicePlanningImport ? { servicePlanningImport } : {}),
      ...(raw?.sourceSongReferenceDismissed === true
        ? { sourceSongReferenceDismissed: true }
        : {}),
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
      ...(typeof body?.saveOperationId === "string" &&
      /^[A-Za-z0-9_-]{8,100}$/.test(body.saveOperationId)
        ? { saveOperationId: body.saveOperationId }
        : {}),
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
    const { saveOperationId, ...contentPayload } = payload;
    const resolvedPublicLive = normalizePublicLiveState(existing?.publicLive, {
      ...existing,
      ...contentPayload,
    });
    const nextPublicLive =
      (existing?.publicLive?.mode === "manual" ||
        existing?.publicLive?.mode === "anchored") &&
      resolvedPublicLive.mode === "schedule"
        ? resolvedPublicLive
        : null;
    return {
      ...contentPayload,
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
      lastSaveOperationId: saveOperationId || null,
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
    delete safe.lastSaveOperationId;
    return safe;
  };

  // Service-plan readers without Teams access may read plan content, but they
  // must not receive roster assignments embedded in a saved plan. This covers
  // default paired workstations and human services:view readers. Booth
  // workstations retain the existing Teams-backed plan behavior.
  const hasTeamsPlanAccess = (bootstrap) =>
    bootstrap?.role === "admin" ||
    bootstrap?.permissions?.teams === "view" ||
    bootstrap?.permissions?.teams === "edit" ||
    bootstrap?.permissions?.services === "edit" ||
    Object.keys(bootstrap?.permissions?.teamScopes || {}).length > 0;

  const isPlanOnlyReader = (bootstrap) =>
    bootstrap?.sessionKind === "workstation"
      ? bootstrap.device?.serviceWorkspaceAccess !== true
      : !hasTeamsPlanAccess(bootstrap);

  const withoutServicePlanAssignments = (plan, bootstrap) => {
    const safe = withoutServicePlanSecrets(plan);
    if (!isPlanOnlyReader(bootstrap) || !Array.isArray(safe?.sections)) {
      return safe;
    }
    return {
      ...safe,
      sections: safe.sections.map((section) => ({
        ...section,
        elements: Array.isArray(section?.elements)
          ? section.elements.map((element) => {
              const viewerElement = { ...element };
              delete viewerElement.assignees;
              delete viewerElement.assignedMemberId;
              delete viewerElement.assignedName;
              return viewerElement;
            })
          : [],
      })),
    };
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
    `${APP_BASE_URL}/services/${encodeURIComponent(String(token || "").trim())}`;

  const MAX_SERVICE_PLAN_EMAIL_RECIPIENTS = 10;
  const MAX_SERVICE_PLAN_EMAIL_SUBJECT_LENGTH = 200;
  const MAX_SERVICE_PLAN_EMAIL_MESSAGE_LENGTH = 5000;

  const validateServicePlanEmailText = (value, label, maxLength) => {
    if (typeof value !== "string") {
      throw httpError(400, `${label} is required.`);
    }
    const trimmed = value.trim();
    if (!trimmed) throw httpError(400, `${label} is required.`);
    if (trimmed.length > maxLength) {
      throw httpError(
        400,
        `${label} must be ${maxLength} characters or fewer.`,
      );
    }
    return trimmed;
  };

  const validateServicePlanEmailRecipients = (value) => {
    if (!Array.isArray(value) || value.length === 0) {
      throw httpError(400, "Add at least one email address.");
    }
    if (value.length > MAX_SERVICE_PLAN_EMAIL_RECIPIENTS) {
      throw httpError(
        400,
        `Email up to ${MAX_SERVICE_PLAN_EMAIL_RECIPIENTS} recipients at a time.`,
      );
    }

    const recipients = [];
    for (const rawRecipient of value) {
      if (typeof rawRecipient !== "string") {
        throw httpError(400, "Enter valid email addresses.");
      }
      const recipient = normalizeEmail(rawRecipient);
      if (
        recipient.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)
      ) {
        throw httpError(400, "Enter valid email addresses.");
      }
      if (!recipients.includes(recipient)) recipients.push(recipient);
    }
    return recipients;
  };

  const validateServicePlanShareVersion = (value) => {
    // Omitted values retain the previous email behavior for older clients.
    if (value === undefined) return "simple";
    if (value !== "detailed" && value !== "simple") {
      throw httpError(400, "Choose a valid service plan version.");
    }
    return value;
  };

  const formatServicePlanEmailDate = (date, startsAt) => {
    const dateValue = /^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))
      ? `${date}T00:00:00.000Z`
      : startsAt;
    const parsed = new Date(dateValue || "");
    if (Number.isNaN(parsed.getTime())) return "Date to be confirmed";
    return new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }).format(parsed);
  };

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

  const buildPublicServicePlan = async ({
    plan,
    viewMode,
    token,
    includeTeamDetails = true,
    allowUnpublished = false,
    includeControllerEquipment = false,
  }) => {
    const isGeneralView = viewMode === "general";
    const [church, brandingChrome, positions, teams, schedules] =
      await Promise.all([
        getDoc(COLLECTIONS.churches, plan.churchId),
        readChurchPublicBrandingChrome(plan.churchId),
        isGeneralView || !includeTeamDetails
          ? Promise.resolve([])
          : listTeamCollectionForChurch(
              COLLECTIONS.teamPositions,
              "positionId",
              plan.churchId,
            ),
        isGeneralView || !includeTeamDetails
          ? Promise.resolve([])
          : listTeamCollectionForChurch(
              COLLECTIONS.teams,
              "teamId",
              plan.churchId,
            ),
        isGeneralView || !includeTeamDetails
          ? Promise.resolve([])
          : listTeamCollectionForChurch(
              COLLECTIONS.teamSchedules,
              "scheduleId",
              plan.churchId,
            ),
      ]);
    const memberIds = isGeneralView || !includeTeamDetails
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
      allowUnpublished,
      includeControllerEquipment,
      equipment: church?.serviceEquipment || [],
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
          const serviceIds = (
            Array.isArray(occurrence?.serviceIds) &&
            occurrence.serviceIds.length
              ? occurrence.serviceIds
              : [occurrence?.serviceId]
          )
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
            occurrenceKeys.has(`${planStartsAt}\u0000${serviceId}`),
          );
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

  const replaceServiceAvailabilityForForm = ({
    existingAvailability,
    replacementAvailability,
    form,
  }) => {
    const formOccurrenceIds = new Set(
      (Array.isArray(form?.availabilityOccurrences)
        ? form.availabilityOccurrences
        : []
      )
        .map((occurrence) => String(occurrence?.occurrenceId || "").trim())
        .filter(Boolean),
    );
    const preserved = Object.fromEntries(
      Object.entries(existingAvailability || {}).filter(
        ([occurrenceId]) => !formOccurrenceIds.has(occurrenceId),
      ),
    );
    return { ...preserved, ...(replacementAvailability || {}) };
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

  const shiftPlainDate = (date, days) => {
    const parsed = new Date(`${date}T00:00:00.000Z`);
    parsed.setUTCDate(parsed.getUTCDate() + days);
    return parsed.toISOString().slice(0, 10);
  };

  /**
   * An intake response is the member's current answer for the form period.
   * Replace only that period so older blockouts outside the form remain intact.
   */
  const replaceBlockoutDateRangesInPeriod = ({
    existingRanges,
    replacementRanges,
    startDate,
    endDate,
  }) => {
    const preserved = (
      Array.isArray(existingRanges) ? existingRanges : []
    ).flatMap((range) => {
      if (!range?.startDate) return [];
      const rangeEnd = range.endDate || range.startDate;
      if (rangeEnd < startDate || range.startDate > endDate) {
        return [{ ...range, endDate: rangeEnd }];
      }

      const outside = [];
      if (range.startDate < startDate) {
        outside.push({
          ...range,
          endDate: shiftPlainDate(startDate, -1),
        });
      }
      if (rangeEnd > endDate) {
        outside.push({
          ...range,
          startDate: shiftPlainDate(endDate, 1),
          endDate: rangeEnd,
        });
      }
      return outside;
    });

    return mergeBlockoutDateRanges([
      ...preserved,
      ...(replacementRanges || []),
    ]);
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

  const sanitizeTeamIntakeRecipientForAdmin = (recipient) => {
    const {
      recipientTokenNonce,
      recipientTokenHash,
      recipientTokenCiphertext,
      createdByUid,
      linkCopiedByUid,
      ...clientRecipient
    } = recipient || {};
    return {
      ...clientRecipient,
      ...(createdByUid ? { createdBy: createdByUid } : {}),
      ...(linkCopiedByUid ? { linkCopiedBy: linkCopiedByUid } : {}),
    };
  };

  const sanitizeSmsDeliveryAttemptForAdmin = (attempt) => {
    if (!attempt) return null;
    const { phoneNumberSnapshot, providerMessageId, ...safeAttempt } = attempt;
    return safeAttempt;
  };

  const buildSmsEligibilityByMemberId = async (churchId, members) => {
    const phoneNumbers = [
      ...new Set(
        members
          .map((member) => {
            try {
              return normalizeUsPhoneNumber(member.phoneNumber);
            } catch {
              return "";
            }
          })
          .filter(Boolean),
      ),
    ];
    const consentByPhone = new Map(
      await Promise.all(
        phoneNumbers.map(async (phoneNumber) => [
          phoneNumber,
          await getSmsConsentForChurchPhone(churchId, phoneNumber),
        ]),
      ),
    );
    return Object.fromEntries(
      members.map((member) => {
        let phoneNumber = "";
        try {
          phoneNumber = normalizeUsPhoneNumber(member.phoneNumber);
        } catch {
          // The roster write path normally prevents this; invalid legacy data
          // is surfaced as no mobile rather than treated as eligible.
        }
        return [
          member.memberId,
          resolveSmsMemberEligibility({
            member,
            churchId,
            consent: consentByPhone.get(phoneNumber),
          }),
        ];
      }),
    );
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
  const buildScheduleAssignmentCounts = (assignments, occurrences = []) => {
    const byMemberId = {};
    const byPositionId = {};
    const lastAssignmentDateByMemberId = {};
    const occurrenceDateById = new Map(
      (Array.isArray(occurrences) ? occurrences : []).flatMap((occurrence) => {
        const date = String(occurrence?.startsAt || "").slice(0, 10);
        return occurrence?.occurrenceId && /^\d{4}-\d{2}-\d{2}$/.test(date)
          ? [[occurrence.occurrenceId, date]]
          : [];
      }),
    );
    Object.entries(assignments || {}).forEach(([occurrenceId, row]) => {
      if (!row || typeof row !== "object") return;
      const occurrenceDate = occurrenceDateById.get(occurrenceId);
      Object.entries(row).forEach(([cellKey, cell]) => {
        const memberIds = assignmentCellMemberIds(cell);
        memberIds.forEach((memberId) => {
          byMemberId[memberId] = (byMemberId[memberId] || 0) + 1;
          if (
            occurrenceDate &&
            (!lastAssignmentDateByMemberId[memberId] ||
              occurrenceDate > lastAssignmentDateByMemberId[memberId])
          ) {
            lastAssignmentDateByMemberId[memberId] = occurrenceDate;
          }
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
    return { byMemberId, byPositionId, lastAssignmentDateByMemberId };
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
      hasScheduleData: Boolean(
        Object.keys(assignments || {}).length ||
          Object.keys(microphoneAssignments || {}).length ||
          Object.keys(schedule?.iemAssignments || {}).length ||
          Object.keys(additionalPositionSlots || {}).length ||
          Object.keys(optionalPositionSlots || {}).length ||
          Object.keys(schedule?.responses || {}).length ||
          schedule?.guests?.length,
      ),
      assignmentCounts: buildScheduleAssignmentCounts(
        assignments,
        schedule.occurrences,
      ),
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
      intakeRecipients,
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
      listTeamCollectionForChurch(
        COLLECTIONS.teamIntakeRecipients,
        "recipientId",
        churchId,
        { truncatedCollections },
      ),
    ]);
    const smsEligibilityByMemberId = await buildSmsEligibilityByMemberId(
      churchId,
      members,
    );
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
      smsEligibilityByMemberId,
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
      intakeRecipients: intakeRecipients.map(
        sanitizeTeamIntakeRecipientForAdmin,
      ),
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
            isTeamLead: rawMembership?.isTeamLead === true,
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
    const hasBirthDate = Object.prototype.hasOwnProperty.call(
      body || {},
      "birthDate",
    );
    const birthDate = hasBirthDate
      ? normalizeBirthDate(body?.birthDate)
      : undefined;
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
    if (
      Object.prototype.hasOwnProperty.call(body || {}, "profileImagePublicId")
    ) {
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
    // Like email, an omitted phone field is a partial-update no-op. An explicit
    // empty string is the deliberate clear action. Phone numbers are contact
    // information only: duplicates are valid and never establish identity.
    if (Object.prototype.hasOwnProperty.call(body || {}, "phoneNumber")) {
      payload.phoneNumber = normalizeMemberPhoneNumber(body?.phoneNumber);
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

  const validateEntityIcon = (value, existingIcon, entityLabel) => {
    const label = `${entityLabel} icon`;
    if (value === undefined) return undefined;
    if (value === null || value === "") return "";
    if (typeof value === "string") {
      return normalizeShortText(value, { max: 40 });
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw httpError(400, `${label} is invalid.`);
    }
    const source = typeof value.source === "string"
      ? normalizeShortText(value.source, { max: 20 })
      : "";
    if (source === "custom") {
      if (isDeepStrictEqual(value, existingIcon)) return value;
      throw httpError(400, `Custom ${entityLabel.toLowerCase()} icons are not supported yet.`);
    }
    const color = value.color === undefined
      ? undefined
      : typeof value.color === "string"
        ? normalizeShortText(value.color, { max: 7 })
        : "invalid";
    if (color && !/^#[0-9a-f]{6}$/i.test(color)) {
      throw httpError(
        400,
        `${label} color must be a six-digit hex color.`,
      );
    }
    const colorField = color ? { color: color.toLowerCase() } : {};
    if (
      source !== "lucide" &&
      source !== "tabler" &&
      source !== "worshipsync"
    ) {
      throw httpError(400, `${label} source is invalid.`);
    }
    const name = typeof value.name === "string"
      ? normalizeShortText(value.name, { max: 120 })
      : "";
    if (!name) throw httpError(400, `${label} name is required.`);
    return { source, name, ...colorField };
  };

  const validateTeamPositionPayload = async (body, churchId, existingPosition = null) => {
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
    const defaultMicrophoneId = normalizeShortText(body?.defaultMicrophoneId, {
      max: 160,
    });
    const defaultIemId = normalizeShortText(body?.defaultIemId, { max: 160 });
    if (defaultMicrophoneId) {
      if (!team.usesMicrophoneAssignments) {
        throw httpError(
          400,
          "Enable microphone assignments for this team before setting a default microphone.",
        );
      }
      const church = await getDoc(COLLECTIONS.churches, churchId);
      const knownMicrophoneIds = new Set(
        (Array.isArray(church?.servicePlanMicrophones)
          ? church.servicePlanMicrophones
          : []
        ).map((microphone) => String(microphone?.id || "").trim()),
      );
      if (!knownMicrophoneIds.has(defaultMicrophoneId)) {
        throw httpError(
          400,
          "Default microphone is not in this church's list.",
        );
      }
    }
    if (defaultIemId) {
      if (!team.usesIemAssignments) {
        throw httpError(
          400,
          "Enable IEM assignments for this team before setting a default IEM.",
        );
      }
      const church = await getDoc(COLLECTIONS.churches, churchId);
      const knownIemIds = new Set(
        normalizeServiceEquipmentCatalog(church?.serviceEquipment)
          .filter((item) => item.category === "iem")
          .map((item) => item.id),
      );
      if (!knownIemIds.has(defaultIemId))
        throw httpError(
          400,
          "Default IEM is not in this church's equipment list.",
        );
    }
    const icon = validateEntityIcon(body?.icon, existingPosition?.icon, "Position");
    return {
      name,
      description: normalizeLongText(body?.description),
      ...(icon !== undefined ? { icon } : {}),
      groupId: normalizeShortText(body?.groupId, { max: 160 }) || null,
      qualificationAreaId: qualificationAreaId || null,
      defaultMicrophoneId: defaultMicrophoneId || null,
      defaultIemId: defaultIemId || null,
      teamId: team.teamId,
    };
  };

  const validateTeamPayload = async (body, churchId, existingTeam = null) => {
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
      icon: validateEntityIcon(body?.icon, existingTeam?.icon, "Team") || "",
      memberIds,
      usesMicrophoneAssignments: body?.usesMicrophoneAssignments === true,
      usesIemAssignments: body?.usesIemAssignments === true,
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

  const normalizeTeamScheduleIemAssignments = (value) => {
    if (!value || typeof value !== "object") return {};
    const assignments = {};
    for (const [occurrenceId, rawRow] of Object.entries(value)) {
      const normalizedOccurrenceId = normalizeShortText(occurrenceId, {
        max: 260,
      });
      if (!normalizedOccurrenceId || !rawRow || typeof rawRow !== "object")
        continue;
      const row = {};
      for (const [slotKey, iemIds] of Object.entries(rawRow)) {
        if (!parseScheduleSlotKey(slotKey)) continue;
        const ids = normalizeIdArray(iemIds).slice(0, 12);
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

  const validateTeamSchedulePayload = async (
    body,
    churchId,
    existing = null,
  ) => {
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
    const iemAssignments = normalizeTeamScheduleIemAssignments(
      body?.iemAssignments,
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
    const payload = {
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
      iemAssignments,
      additionalPositionSlots,
      ...(existing?.source === "generated-period" ||
      existing?.source === "custom"
        ? { source: existing.source }
        : {}),
      ...(existing?.generatedPeriodKey
        ? { generatedPeriodKey: existing.generatedPeriodKey }
        : {}),
    };
    // Enforce this at the shared payload boundary so regular edits and bulk
    // schedule imports cannot change an existing generated period's identity.
    if (existing?.source === "generated-period") {
      const sameIds = (left, right) => {
        if (
          !Array.isArray(left) ||
          !Array.isArray(right) ||
          left.length !== right.length
        ) {
          return false;
        }
        const sortedLeft = [...left].sort();
        const sortedRight = [...right].sort();
        return sortedLeft.every((id, index) => id === sortedRight[index]);
      };
      const sameOccurrenceIds = sameIds(
        existing.occurrences?.map((occurrence) => occurrence?.occurrenceId),
        payload.occurrences.map((occurrence) => occurrence.occurrenceId),
      );
      if (
        payload.teamId !== existing.teamId ||
        payload.startDate !== existing.startDate ||
        payload.endDate !== existing.endDate ||
        !sameIds(existing.serviceIds, payload.serviceIds) ||
        !sameOccurrenceIds
      ) {
        throw httpError(
          409,
          "Generated service-period schedules cannot change their team, date range, or services. Copy this schedule to create a custom version.",
        );
      }
    }
    return payload;
  };

  const upsertTeamEntity = async ({
    kind,
    churchId,
    id,
    payload,
    adminUserId,
    portableCreateKey,
  }) => {
    const config = TEAM_ENTITY_CONFIG[kind];
    const now = nowIso();
    const nextId = id || (portableCreateKey
      ? `${config.idPrefix}_${portableCreateKey.slice(0, 40)}`
      : createId(config.idPrefix));
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
    if (!id && portableCreateKey) {
      const ledgerId = crypto.createHash("sha256")
        .update(`${churchId}\u0000${kind}\u0000${portableCreateKey}`)
        .digest("hex");
      const ledger = {
        churchId,
        kind,
        entityId: nextId,
        entityCollection: config.collection,
        createKey: portableCreateKey,
      };
      const saved = await persistPortableCreate({
        db: requireFirestore(),
        entityCollection: config.collection,
        entityId: nextId,
        entity: doc,
        ledgerCollection: COLLECTIONS.portableImportCreates,
        ledgerId,
        ledger,
        enqueue: enqueuePortableCreate,
        getDoc,
        setDoc,
        conflict: () => httpError(409, "This import row could not be safely retried. Preview the file again."),
      });
      return { [config.idField]: nextId, ...saved };
    }
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

  /**
   * A position's default microphone is a starting point for a newly created
   * schedule. Existing schedule rows are never rewritten: date-specific mic
   * choices, including deliberate clears, remain the operator's decision.
   */
  const applyPositionDefaultMicrophones = async ({ churchId, payload }) => {
    const team = await assertTeamEntityInChurch(
      "team",
      payload.teamId,
      churchId,
      {
        label: "Team",
      },
    );
    if (!team.usesMicrophoneAssignments) return payload;

    const [positions, church] = await Promise.all([
      listTeamCollectionForChurch(
        COLLECTIONS.teamPositions,
        "positionId",
        churchId,
      ),
      getDoc(COLLECTIONS.churches, churchId),
    ]);
    const knownMicrophoneIds = new Set(
      (Array.isArray(church?.servicePlanMicrophones)
        ? church.servicePlanMicrophones
        : []
      ).map((microphone) => String(microphone?.id || "").trim()),
    );
    const defaultsByPositionId = new Map(
      positions
        .filter((position) => position.teamId === payload.teamId)
        .map((position) => [
          position.positionId,
          String(position.defaultMicrophoneId || "").trim(),
        ])
        .filter(([, microphoneId]) => knownMicrophoneIds.has(microphoneId)),
    );
    if (!defaultsByPositionId.size) return payload;

    const microphoneAssignments = normalizeTeamScheduleMicrophoneAssignments(
      payload.microphoneAssignments,
    );
    for (const occurrence of payload.occurrences) {
      const requirements = await resolveScheduleOccurrenceRequirements({
        churchId,
        occurrence,
      });
      const row = { ...(microphoneAssignments[occurrence.occurrenceId] || {}) };
      requirements.forEach((requirement) => {
        const microphoneId = defaultsByPositionId.get(requirement.positionId);
        if (!microphoneId) return;
        const count = Math.max(0, Math.floor(Number(requirement.count) || 0));
        for (let slot = 0; slot < count; slot += 1) {
          const slotKey = makeScheduleSlotKey(requirement.positionId, slot);
          if (!row[slotKey]) row[slotKey] = [microphoneId];
        }
      });
      if (Object.keys(row).length)
        microphoneAssignments[occurrence.occurrenceId] = row;
    }
    return { ...payload, microphoneAssignments };
  };

  const applyPositionDefaultIems = async ({ churchId, payload }) => {
    const team = await assertTeamEntityInChurch(
      "team",
      payload.teamId,
      churchId,
      { label: "Team" },
    );
    if (!team.usesIemAssignments) return payload;
    const [positions, church] = await Promise.all([
      listTeamCollectionForChurch(
        COLLECTIONS.teamPositions,
        "positionId",
        churchId,
      ),
      getDoc(COLLECTIONS.churches, churchId),
    ]);
    const knownIemIds = new Set(
      normalizeServiceEquipmentCatalog(church?.serviceEquipment).map(
        (item) => item.id,
      ),
    );
    const defaultsByPositionId = new Map(
      positions
        .filter((position) => position.teamId === payload.teamId)
        .map((position) => [
          position.positionId,
          String(position.defaultIemId || "").trim(),
        ])
        .filter(([, iemId]) => knownIemIds.has(iemId)),
    );
    if (!defaultsByPositionId.size) return payload;
    const iemAssignments = normalizeTeamScheduleIemAssignments(
      payload.iemAssignments,
    );
    for (const occurrence of payload.occurrences) {
      const requirements = await resolveScheduleOccurrenceRequirements({
        churchId,
        occurrence,
      });
      const row = { ...(iemAssignments[occurrence.occurrenceId] || {}) };
      requirements.forEach((requirement) => {
        const iemId = defaultsByPositionId.get(requirement.positionId);
        if (!iemId) return;
        const count = Math.max(0, Math.floor(Number(requirement.count) || 0));
        for (let slot = 0; slot < count; slot += 1) {
          const slotKey = makeScheduleSlotKey(requirement.positionId, slot);
          if (!row[slotKey]) row[slotKey] = [iemId];
        }
      });
      if (Object.keys(row).length)
        iemAssignments[occurrence.occurrenceId] = row;
    }
    return { ...payload, iemAssignments };
  };

  const getServicePlanKeyForOccurrence = (occurrence) => {
    const date = String(occurrence?.startsAt || "").slice(0, 10);
    return occurrence?.groupId
      ? `group:${occurrence.groupId}@${date}`
      : `${occurrence?.serviceId || ""}@${date}`;
  };

  /**
   * A deliberately narrow roster projection for service-plan readers. Unlike
   * Teams bootstrap, this contains no roster contact, availability, or schedule
   * data — only people assigned to the requested plan.
   */
  const buildServicePlanAssignments = async (churchId, planKey) => {
    const [members, positions, teams, schedules] = await Promise.all([
      listTeamCollectionForChurch(
        COLLECTIONS.teamRosterMembers,
        "memberId",
        churchId,
      ),
      listTeamCollectionForChurch(
        COLLECTIONS.teamPositions,
        "positionId",
        churchId,
      ),
      listTeamCollectionForChurch(COLLECTIONS.teams, "teamId", churchId),
      listTeamCollectionForChurch(
        COLLECTIONS.teamSchedules,
        "scheduleId",
        churchId,
      ),
    ]);
    const memberById = new Map(
      members.map((member) => [member.memberId, member]),
    );
    const positionById = new Map(
      positions.map((position) => [position.positionId, position]),
    );
    const teamById = new Map(teams.map((team) => [team.teamId, team]));

    return schedules.flatMap((schedule) => {
      if (schedule.archivedAt) return [];
      const occurrence = (schedule.occurrences || []).find(
        (candidate) => getServicePlanKeyForOccurrence(candidate) === planKey,
      );
      if (!occurrence) return [];
      const guestsById = new Map(
        (schedule.guests || []).map((guest) => [guest.guestId, guest]),
      );
      return Object.entries(
        schedule.assignments?.[occurrence.occurrenceId] || {},
      ).flatMap(([slotKey, cell]) => {
        const separator = slotKey.lastIndexOf("::");
        const positionId = separator > 0 ? slotKey.slice(0, separator) : "";
        const position = positionById.get(positionId);
        const teamId = position?.teamId || schedule.teamId;
        const role = position?.name || "Position";
        // Match the current service workspace: it shows the scheduled primary
        // for each role, while shadows remain schedule-grid detail.
        const memberId = assignmentCellMemberIds(cell)[0];
        if (!memberId) return [];
        return [memberId].flatMap((memberId) => {
          const member = memberById.get(memberId);
          const guest = guestsById.get(memberId);
          const name = member
            ? `${member.firstName || ""} ${member.lastName || ""}`.trim()
            : guest?.name || "";
          if (!name) return [];
          return [
            {
              teamName: teamById.get(teamId)?.name || "Team",
              role,
              name,
              ...(member?.profileImageUrl
                ? { profileImageUrl: member.profileImageUrl }
                : {}),
            },
          ];
        });
      });
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

  const resolveTeamScheduleGuestAssignment = ({
    schedule,
    guest,
    memberId,
  }) => {
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
            Object.values(row || {}).flatMap(
              getScheduleAssignmentCellMemberIds,
            ),
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
    "recurringAvailability",
    "schedulingFrequency",
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
    const rawFields = value === undefined ? existing : value;
    if (rawFields !== undefined && !Array.isArray(rawFields)) {
      throw httpError(400, "Form fields must be a list.");
    }
    const normalizedFields = [
      ...new Set(
        (Array.isArray(rawFields)
          ? rawFields
          : LEGACY_TEAM_INTAKE_FIELDS
        ).filter((field) => TEAM_INTAKE_FIELD_IDS.has(field)),
      ),
    ];
    return normalizedFields.includes("schedulingPreferences")
      ? [
          ...new Set([
            ...normalizedFields.filter(
              (field) => field !== "schedulingPreferences",
            ),
            "recurringAvailability",
            "schedulingFrequency",
          ]),
        ]
      : normalizedFields;
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
    const responseDeadline = assertPlainDate(
      body?.responseDeadline ?? existing?.responseDeadline ?? endDate,
      "Response deadline",
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
      responseDeadline,
      availabilityServices,
      availabilityOccurrences,
      teamIds,
      enabledFields,
      active: Boolean(body?.active ?? existing?.active),
      // Every selected member-detail field is required on the public form.
      requireEmail: enabledFields.includes("email") && true,
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

  const validateTeamIntakeSubmissionPayload = async (
    body,
    form,
    { member: personalizedMember = null } = {},
  ) => {
    const enabledFields = new Set(
      normalizeTeamIntakeFields(undefined, form?.enabledFields),
    );
    const firstName = personalizedMember
      ? normalizeShortText(personalizedMember.firstName, { max: 80 })
      : enabledFields.has("firstName")
        ? normalizeShortText(body?.firstName, { max: 80 })
        : "";
    const lastName = personalizedMember
      ? normalizeShortText(personalizedMember.lastName, { max: 80 })
      : enabledFields.has("lastName")
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
    const email = personalizedMember
      ? ""
      : enabledFields.has("email")
        ? normalizeMemberEmail(body?.email)
        : "";
    if (!personalizedMember && enabledFields.has("email") && !email) {
      throw httpError(400, "Email is required.");
    }
    const title = personalizedMember
      ? ""
      : enabledFields.has("title")
        ? normalizeShortText(body?.title, { max: 40 })
        : "";
    if (!personalizedMember && enabledFields.has("title") && !title) {
      throw httpError(400, "Title is required.");
    }
    const birthDate = personalizedMember
      ? null
      : enabledFields.has("birthDate")
        ? normalizeBirthDate(body?.birthDate)
        : null;
    if (!personalizedMember && enabledFields.has("birthDate") && !birthDate) {
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
              if (
                scopedTeamIds.size > 0 &&
                !scopedTeamIds.has(position.teamId)
              ) {
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
      ...(enabledFields.has("schedulingFrequency") ||
      enabledFields.has("recurringAvailability")
        ? {
            ...(enabledFields.has("schedulingFrequency")
              ? {
                  servingFrequency: normalizeTeamMemberServingFrequency(
                    body?.servingFrequency,
                  ),
                }
              : {}),
            ...(enabledFields.has("recurringAvailability")
              ? {
                  recurringAvailability:
                    normalizeTeamMemberRecurringAvailability(
                      body?.recurringAvailability,
                    ),
                }
              : {}),
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
    const church = await getDoc(COLLECTIONS.churches, churchId);
    const team = schedule.teamId
      ? await getTeamEntity("team", schedule.teamId)
      : null;
    const positions =
      team && team.churchId === churchId
        ? await queryDocs(
            COLLECTIONS.teamPositions,
            [
              { field: "churchId", value: churchId },
              { field: "teamId", value: schedule.teamId },
            ],
            { limit: TEAM_COLLECTION_QUERY_LIMIT },
          )
        : [];
    const teamPositionIds = new Set(
      positions
        .filter((position) => !position.archivedAt)
        .map((position) => position.positionId),
    );
    const microphoneAssignments = normalizeTeamScheduleMicrophoneAssignments(
      schedule.microphoneAssignments,
    );
    const iemAssignments = normalizeTeamScheduleIemAssignments(
      schedule.iemAssignments,
    );
    let publicOccurrences = schedule.occurrences || [];
    if (schedule.source === "generated-period" && teamPositionIds.size > 0) {
      const services = await readChurchServiceTimes(churchId);
      const additionalSlots = normalizeTeamScheduleAdditionalPositionSlots(
        schedule.additionalPositionSlots ?? schedule.optionalPositionSlots,
      );
      publicOccurrences = publicOccurrences.filter((occurrence) => {
        const storedRequirements = sanitizePositionRequirements(
          occurrence.positionRequirements,
        );
        const occurrenceServiceIds = new Set(
          [occurrence.serviceId, ...(occurrence.serviceIds || [])].filter(
            Boolean,
          ),
        );
        const requirements = storedRequirements.length
          ? storedRequirements
          : mergeServicePositionRequirements(
              services.filter((service) =>
                occurrenceServiceIds.has(service.serviceId || service.id),
              ),
            );
        const hasTeamRequirement = requirements.some((item) =>
          teamPositionIds.has(item.positionId),
        );
        const hasTeamSlot = (
          additionalSlots[occurrence.occurrenceId] || []
        ).some((key) => {
          const slot = parseScheduleSlotKey(key);
          return Boolean(slot && teamPositionIds.has(slot.positionId));
        });
        const hasTeamAssignment = Object.keys(
          schedule.assignments?.[occurrence.occurrenceId] || {},
        ).some((key) => {
          const slot = parseScheduleSlotKey(key);
          return Boolean(slot && teamPositionIds.has(slot.positionId));
        });
        const hasTeamEquipmentAssignment = [
          microphoneAssignments[occurrence.occurrenceId],
          iemAssignments[occurrence.occurrenceId],
        ].some((row) =>
          Object.keys(row || {}).some((key) => {
            const slot = parseScheduleSlotKey(key);
            return Boolean(slot && teamPositionIds.has(slot.positionId));
          }),
        );
        return (
          hasTeamRequirement ||
          hasTeamSlot ||
          hasTeamAssignment ||
          hasTeamEquipmentAssignment
        );
      });
    }
    const publicOccurrenceIds = new Set(
      publicOccurrences.map((occurrence) => occurrence.occurrenceId),
    );
    const filterOccurrenceRows = (rows) =>
      Object.fromEntries(
        Object.entries(rows || {}).filter(([occurrenceId]) =>
          publicOccurrenceIds.has(occurrenceId),
        ),
      );
    const publicAssignments =
      schedule.source === "generated-period"
        ? filterOccurrenceRows(schedule.assignments)
        : schedule.assignments || {};
    const publicMicrophoneAssignments =
      schedule.source === "generated-period"
        ? filterOccurrenceRows(microphoneAssignments)
        : microphoneAssignments;
    const publicIemAssignments =
      schedule.source === "generated-period"
        ? filterOccurrenceRows(iemAssignments)
        : iemAssignments;
    const referencedMicrophoneIds = new Set(
      Object.values(publicMicrophoneAssignments).flatMap((row) =>
        Object.values(row).flat(),
      ),
    );
    const referencedIemIds = new Set(
      Object.values(publicIemAssignments).flatMap((row) =>
        Object.values(row).flat(),
      ),
    );
    const scheduleGuests = normalizeTeamScheduleGuests(schedule.guests);
    const scheduleGuestById = new Map(
      scheduleGuests.map((guest) => [guest.guestId, guest]),
    );
    const assignedMemberIds = new Set();
    Object.values(publicAssignments).forEach((row) => {
      Object.values(row || {}).forEach((cell) => {
        getScheduleAssignmentCellMemberIds(cell).forEach((memberId) =>
          assignedMemberIds.add(memberId),
        );
      });
    });
    const [members, churchLogoUrl] = await Promise.all([
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
    const microphones = (
      Array.isArray(church?.servicePlanMicrophones)
        ? church.servicePlanMicrophones
        : []
    )
      .map(normalizeServicePlanMicrophone)
      .filter(
        (microphone) =>
          microphone && referencedMicrophoneIds.has(microphone.id),
      )
      .map((microphone) => ({ ...microphone, category: "microphone" }));
    const serviceEquipment = normalizeServiceEquipmentCatalog(
      church?.serviceEquipment,
    ).filter((equipment) => referencedIemIds.has(equipment.id));
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
        occurrences: publicOccurrences,
        assignments: publicAssignments,
        microphoneAssignments: publicMicrophoneAssignments,
        iemAssignments: publicIemAssignments,
      },
      microphones,
      serviceEquipment,
      positions: sortPositionsByOrder(referencedPositions).map((position) => ({
        positionId: position.positionId,
        name: position.name,
        icon: position.icon || "",
        groupId: position.groupId || "",
        archivedAt: position.archivedAt || null,
      })),
      members: assignedMembers
        .map((member) => ({
          memberId: member.memberId,
          name: scheduleMemberPublicName(member, duplicateFirstNames),
        }))
        .concat(
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

  const assertTeamIntakeFormResponseDeadline = (form) => {
    const responseDeadline = String(
      form?.responseDeadline || form?.endDate || "",
    ).trim();
    if (
      responseDeadline &&
      responseDeadline < new Date().toISOString().slice(0, 10)
    ) {
      throw httpError(409, "The response deadline for this form has passed.");
    }
  };

  const createTeamIntakeRecipientId = (formId, memberId) =>
    `teamIntakeRecipient_${hashValue(`${formId}:${memberId}`).slice(0, 32)}`;

  const buildTeamIntakeRecipientPublicUrl = (token) =>
    `${APP_BASE_URL}/a/${encodeURIComponent(String(token || "").trim())}`;

  const ensureTeamIntakeRecipientToken = async (recipient, updatedByUid) => {
    const updatedAt = nowIso();
    const existingToken = decryptTeamIntakeRecipientToken(
      recipient.recipientTokenCiphertext,
      teamIntakeRecipientTokenSecret,
    );
    const canReuseToken = Boolean(
      existingToken &&
      looksLikeTeamIntakeRecipientToken(existingToken) &&
      hashTeamIntakeRecipientToken(
        existingToken,
        teamIntakeRecipientTokenSecret,
      ) === recipient.recipientTokenHash,
    );
    const token = canReuseToken
      ? existingToken
      : createTeamIntakeRecipientToken();
    const update = {
      ...(canReuseToken
        ? {}
        : {
            recipientTokenHash: hashTeamIntakeRecipientToken(
              token,
              teamIntakeRecipientTokenSecret,
            ),
            recipientTokenCiphertext: encryptTeamIntakeRecipientToken(
              token,
              teamIntakeRecipientTokenSecret,
            ),
            tokenIssuedAt: updatedAt,
          }),
      updatedAt,
      ...(updatedByUid ? { updatedByUid } : {}),
    };
    if (Object.keys(update).length > 2 || !canReuseToken) {
      await setDoc(
        COLLECTIONS.teamIntakeRecipients,
        recipient.recipientId,
        update,
        { merge: true },
      );
    }
    return { token, recipient: { ...recipient, ...update } };
  };

  const getTeamIntakeRecipientContext = async (
    recipient,
    { requireTokenHash = true } = {},
  ) => {
    const recipientId = String(
      recipient?.recipientId || recipient?.id || "",
    ).trim();
    if (
      !recipientId ||
      (requireTokenHash && !recipient?.recipientTokenHash) ||
      recipient.revokedAt
    ) {
      throw httpError(404, "Request not found.");
    }
    const form = await getDoc(COLLECTIONS.teamIntakeForms, recipient.formId);
    const member = await getDoc(
      COLLECTIONS.teamRosterMembers,
      recipient.memberId,
    );
    if (
      !form ||
      form.churchId !== recipient.churchId ||
      form.archivedAt ||
      !member ||
      member.churchId !== recipient.churchId ||
      member.archivedAt
    ) {
      throw httpError(404, "Request not found.");
    }
    assertTeamIntakeFormIsOpen(form);
    return {
      recipient: { recipientId, ...recipient },
      form: { formId: recipient.formId, ...form },
      member: { memberId: recipient.memberId, ...member },
    };
  };

  const getTeamIntakeRecipientContextByToken = async (token) => {
    if (!looksLikeTeamIntakeRecipientToken(token)) {
      throw httpError(404, "Request not found.");
    }
    const [recipient] = await queryDocs(
      COLLECTIONS.teamIntakeRecipients,
      [
        {
          field: "recipientTokenHash",
          value: hashTeamIntakeRecipientToken(
            token,
            teamIntakeRecipientTokenSecret,
          ),
        },
      ],
      { limit: 1 },
    );
    return getTeamIntakeRecipientContext(recipient);
  };

  const writeTeamIntakeRecipientBatch = async (writes) => {
    const db = requireFirestore?.();
    if (db) {
      const batch = db.batch();
      writes.forEach(({ id, data, merge }) => {
        batch.set(
          db.collection(COLLECTIONS.teamIntakeRecipients).doc(id),
          data,
          { merge },
        );
      });
      await batch.commit();
      return;
    }
    for (const { id, data, merge } of writes) {
      await setDoc(COLLECTIONS.teamIntakeRecipients, id, data, { merge });
    }
  };

  const applyTeamIntakeSubmissionToMember = async ({
    submission,
    form,
    churchId,
    memberId,
    createMember = false,
    adminUserId,
    now = nowIso(),
  }) => {
    const formBelongsToChurch = Boolean(form && form.churchId === churchId);
    const formCollectsBlockouts =
      formBelongsToChurch &&
      Boolean(form.startDate && form.endDate) &&
      normalizeTeamIntakeFields(undefined, form.enabledFields).includes(
        "blockoutDates",
      );
    const blockoutDates = mergeBlockoutDateRanges(
      (submission.blockoutRanges || []).map((range) => ({
        startDate: range.startDate,
        endDate: range.endDate,
        notes: "From intake form",
      })),
    );
    const desiredPositionIds = submission.positionIds || [];
    const submissionAvailability = normalizeServiceAvailability(
      submission.occurrenceAvailability,
    );
    const formTeamIds = formBelongsToChurch
      ? normalizeIdArray(form.teamIds)
      : [];
    const addedTeamIds = new Set();
    const trackTeams = (ids) =>
      (ids || []).forEach((id) => addedTeamIds.add(id));
    let member;

    if (createMember) {
      member = await upsertTeamEntity({
        kind: "member",
        churchId,
        payload: {
          title: normalizeShortText(submission.title, { max: 40 }),
          firstName: submission.firstName,
          lastName: submission.lastName,
          email: normalizeMemberEmail(submission.email),
          birthDate: normalizeBirthDate(submission.birthDate),
          isMinor: isMinorFromBirthDate(submission.birthDate) ?? false,
          servingFrequency: submission.servingFrequency || "as_needed",
          recurringAvailability:
            submission.recurringAvailability ||
            normalizeTeamMemberRecurringAvailability(null),
          positionIds: [],
          desiredPositionIds,
          serviceAvailability: submissionAvailability,
          blockoutDates,
          notes: normalizeLongText(submission.notes),
        },
        adminUserId,
      });
      trackTeams(
        await addMemberToTeamsForPositions({
          churchId,
          positionIds: desiredPositionIds,
          memberId: member.memberId,
          adminUserId,
        }),
      );
      trackTeams(
        await addMemberToTeams({
          churchId,
          teamIds: formTeamIds,
          memberId: member.memberId,
          adminUserId,
        }),
      );
    } else {
      member = await assertTeamEntityInChurch("member", memberId, churchId, {
        label: "Member",
        active: false,
      });
      const nextDesiredPositionIds = normalizeIdArray(desiredPositionIds);
      const nextBlockoutDates = formCollectsBlockouts
        ? replaceBlockoutDateRangesInPeriod({
            existingRanges: member.blockoutDates,
            replacementRanges: blockoutDates,
            startDate: form.startDate,
            endDate: form.endDate,
          })
        : formBelongsToChurch
          ? member.blockoutDates || []
          : mergeBlockoutDateRanges([
              ...(member.blockoutDates || []),
              ...blockoutDates,
            ]);
      const nextServiceAvailability = replaceServiceAvailabilityForForm({
        existingAvailability: member.serviceAvailability,
        replacementAvailability: submissionAvailability,
        form,
      });
      const submittedEmail = normalizeMemberEmail(submission.email);
      const submittedTitle = normalizeShortText(submission.title, { max: 40 });
      const submittedBirthDate = normalizeBirthDate(submission.birthDate);
      await setDoc(
        COLLECTIONS.teamRosterMembers,
        member.memberId,
        {
          desiredPositionIds: nextDesiredPositionIds,
          serviceAvailability: nextServiceAvailability,
          blockoutDates: nextBlockoutDates,
          ...(member.email
            ? {}
            : submittedEmail
              ? { email: submittedEmail }
              : {}),
          ...(!member.title && submittedTitle ? { title: submittedTitle } : {}),
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
          updatedByUid: adminUserId,
        },
        { merge: true },
      );
      trackTeams(
        await addMemberToTeamsForPositions({
          churchId,
          positionIds: nextDesiredPositionIds,
          memberId: member.memberId,
          adminUserId,
        }),
      );
      trackTeams(
        await addMemberToTeams({
          churchId,
          teamIds: formTeamIds,
          memberId: member.memberId,
          adminUserId,
        }),
      );
      member = await getTeamEntity("member", member.memberId);
    }

    return {
      member,
      updatedTeams: await loadTeamsByIds(churchId, Array.from(addedTeamIds)),
      application: {
        status: "applied",
        appliedAt: now,
        appliedByUid: adminUserId,
        appliedMemberId: member.memberId,
        appliedMemberCreated: Boolean(createMember),
      },
    };
  };

  const submitTeamIntakeRecipientWithFirestoreTransaction = async ({
    token,
    payload,
  }) => {
    const db = requireFirestore?.();
    if (!db) return null;

    const submittedAt = nowIso();
    return db.runTransaction(async (transaction) => {
      const tokenHash = hashTeamIntakeRecipientToken(
        token,
        teamIntakeRecipientTokenSecret,
      );
      const recipientQuery = db
        .collection(COLLECTIONS.teamIntakeRecipients)
        .where("recipientTokenHash", "==", tokenHash)
        .limit(1);
      const recipientQuerySnapshot = await transaction.get(recipientQuery);
      const recipientDocument = recipientQuerySnapshot.docs[0];
      if (!recipientDocument) throw httpError(404, "Request not found.");

      const recipient = {
        recipientId: recipientDocument.id,
        ...recipientDocument.data(),
      };
      if (recipient.revokedAt) throw httpError(404, "Request not found.");

      const formRef = db
        .collection(COLLECTIONS.teamIntakeForms)
        .doc(recipient.formId);
      const memberRef = db
        .collection(COLLECTIONS.teamRosterMembers)
        .doc(recipient.memberId);
      const formSnapshot = await transaction.get(formRef);
      const memberSnapshot = await transaction.get(memberRef);
      if (!formSnapshot.exists || !memberSnapshot.exists) {
        throw httpError(404, "Request not found.");
      }
      const form = { formId: formSnapshot.id, ...formSnapshot.data() };
      const member = { memberId: memberSnapshot.id, ...memberSnapshot.data() };
      if (
        form.churchId !== recipient.churchId ||
        form.archivedAt ||
        member.churchId !== recipient.churchId ||
        member.archivedAt
      ) {
        throw httpError(404, "Request not found.");
      }
      assertTeamIntakeFormIsOpen(form);

      const submissionId =
        recipient.submissionId ||
        `teamIntakeSubmission_${hashValue(recipient.recipientId).slice(0, 32)}`;

      const desiredPositionIds = normalizeIdArray(payload.positionIds);
      const positionSnapshots = [];
      for (const positionId of desiredPositionIds) {
        positionSnapshots.push(
          await transaction.get(
            db.collection(COLLECTIONS.teamPositions).doc(positionId),
          ),
        );
      }
      const formTeamIds = new Set(normalizeIdArray(form.teamIds));
      const positionTeamIds = new Set();
      for (const positionSnapshot of positionSnapshots) {
        if (!positionSnapshot.exists) {
          throw httpError(
            400,
            "One or more selected positions are no longer available.",
          );
        }
        const position = positionSnapshot.data();
        if (
          position.churchId !== form.churchId ||
          (formTeamIds.size > 0 && !formTeamIds.has(position.teamId))
        ) {
          throw httpError(
            400,
            "One or more selected positions are not available on this form.",
          );
        }
        if (position.teamId) positionTeamIds.add(position.teamId);
      }

      const candidateTeamIds = new Set([...formTeamIds, ...positionTeamIds]);
      const teamSnapshots = [];
      for (const teamId of candidateTeamIds) {
        teamSnapshots.push(
          await transaction.get(db.collection(COLLECTIONS.teams).doc(teamId)),
        );
      }

      const formCollectsBlockouts =
        Boolean(form.startDate && form.endDate) &&
        normalizeTeamIntakeFields(undefined, form.enabledFields).includes(
          "blockoutDates",
        );
      const blockoutDates = mergeBlockoutDateRanges(
        (payload.blockoutRanges || []).map((range) => ({
          startDate: range.startDate,
          endDate: range.endDate,
          notes: "From intake form",
        })),
      );
      const nextBlockoutDates = formCollectsBlockouts
        ? replaceBlockoutDateRangesInPeriod({
            existingRanges: member.blockoutDates,
            replacementRanges: blockoutDates,
            startDate: form.startDate,
            endDate: form.endDate,
          })
        : member.blockoutDates || [];
      const nextServiceAvailability = replaceServiceAvailabilityForForm({
        existingAvailability: member.serviceAvailability,
        replacementAvailability: normalizeServiceAvailability(
          payload.occurrenceAvailability,
        ),
        form,
      });
      const adminUserId = `recipient:${recipient.recipientId}`;
      const memberUpdate = {
        desiredPositionIds,
        serviceAvailability: nextServiceAvailability,
        blockoutDates: nextBlockoutDates,
        ...(member.email || !payload.email
          ? {}
          : { email: normalizeMemberEmail(payload.email) }),
        ...(!member.title && payload.title
          ? { title: normalizeShortText(payload.title, { max: 40 }) }
          : {}),
        ...(!member.birthDate && payload.birthDate
          ? {
              birthDate: normalizeBirthDate(payload.birthDate),
              isMinor:
                isMinorFromBirthDate(payload.birthDate) ??
                Boolean(member.isMinor),
            }
          : {}),
        ...(payload.servingFrequency
          ? { servingFrequency: payload.servingFrequency }
          : {}),
        ...(payload.recurringAvailability
          ? { recurringAvailability: payload.recurringAvailability }
          : {}),
        updatedAt: submittedAt,
        updatedByUid: adminUserId,
      };
      const application = {
        status: "applied",
        appliedAt: submittedAt,
        appliedByUid: adminUserId,
        appliedMemberId: member.memberId,
        appliedMemberCreated: false,
      };
      const submission = {
        ...payload,
        submissionId,
        formId: form.formId,
        churchId: form.churchId,
        status: "applied",
        submittedAt,
        ...application,
        reviewedAt: submittedAt,
        reviewedByUid: adminUserId,
        updatedAt: submittedAt,
        updatedByUid: adminUserId,
      };

      // All reads are complete before any write. Firestore retries this whole
      // callback when another process changes one of these documents, so the
      // member, deterministic audit row, recipient state, and team rosters
      // commit together instead of relying on the process-local queue.
      appendIntakeSubmissionToTransaction({
        transaction,
        formRef,
        formSnapshot,
        submissionRef: db
          .collection(COLLECTIONS.teamIntakeSubmissions)
          .doc(submissionId),
        submission,
      });
      transaction.set(memberRef, memberUpdate, { merge: true });
      for (const teamSnapshot of teamSnapshots) {
        if (!teamSnapshot.exists) continue;
        const team = teamSnapshot.data();
        if (
          team.churchId !== form.churchId ||
          team.archivedAt ||
          (team.memberIds || []).includes(member.memberId)
        ) {
          continue;
        }
        transaction.set(
          teamSnapshot.ref,
          {
            memberIds: [...(team.memberIds || []), member.memberId],
            updatedAt: submittedAt,
            updatedByUid: adminUserId,
          },
          { merge: true },
        );
      }
      transaction.set(
        recipientDocument.ref,
        {
          respondedAt: submittedAt,
          submissionId,
          updatedAt: submittedAt,
          updatedByUid: adminUserId,
        },
        { merge: true },
      );
      return {
        success: true,
        submissionId,
        formId: form.formId,
        submittedAt,
      };
    });
  };

  const teamIntakeRecipientSubmissionQueues = new Map();
  const enqueueTeamIntakeRecipientSubmission = (recipientId, task) => {
    const previous =
      teamIntakeRecipientSubmissionQueues.get(recipientId) || Promise.resolve();
    const run = previous.then(task, task);
    const settled = run.then(
      () => undefined,
      () => undefined,
    );
    teamIntakeRecipientSubmissionQueues.set(recipientId, settled);
    void settled.finally(() => {
      if (teamIntakeRecipientSubmissionQueues.get(recipientId) === settled) {
        teamIntakeRecipientSubmissionQueues.delete(recipientId);
      }
    });
    return run;
  };

  const submitTeamIntakeRecipient = async (req, token) => {
    const result = await enqueueTeamIntakeRecipientSubmission(
      token,
      async () => {
        const { recipient, form, member } =
          await getTeamIntakeRecipientContextByToken(token);
        const payload = await validateTeamIntakeSubmissionPayload(
          req.body,
          form,
          { member },
        );
        const transactionalResult =
          await submitTeamIntakeRecipientWithFirestoreTransaction({
            token,
            payload,
          });
        if (transactionalResult) return transactionalResult;
        const submittedAt = nowIso();
        const submissionId =
          recipient.submissionId ||
          `teamIntakeSubmission_${hashValue(recipient.recipientId).slice(0, 32)}`;
        const submission = {
          ...payload,
          submissionId,
          formId: form.formId,
          churchId: form.churchId,
          status: "new",
          submittedAt,
        };

        // A recipient has one current response. Reusing its deterministic audit
        // record makes retries safe: a lost response or a second submission never
        // creates a second applied side effect or a second queue row.
        if (persistTeamIntakeSubmission) {
          await persistTeamIntakeSubmission(submission);
        } else {
          await setDoc(
            COLLECTIONS.teamIntakeSubmissions,
            submissionId,
            submission,
            { merge: false },
          );
        }
        const application = await applyTeamIntakeSubmissionToMember({
          submission,
          form,
          churchId: form.churchId,
          memberId: member.memberId,
          adminUserId: `recipient:${recipient.recipientId}`,
          now: submittedAt,
        });
        const applicationUpdate = {
          ...application.application,
          reviewedAt: submittedAt,
          reviewedByUid: `recipient:${recipient.recipientId}`,
          updatedAt: submittedAt,
          updatedByUid: `recipient:${recipient.recipientId}`,
        };
        await setDoc(
          COLLECTIONS.teamIntakeSubmissions,
          submissionId,
          applicationUpdate,
          { merge: true },
        );
        await setDoc(
          COLLECTIONS.teamIntakeRecipients,
          recipient.recipientId,
          {
            respondedAt: submittedAt,
            submissionId,
            updatedAt: submittedAt,
            updatedByUid: `recipient:${recipient.recipientId}`,
          },
          { merge: true },
        );
        return {
          success: true,
          submissionId,
          formId: form.formId,
          submittedAt,
        };
      },
    );
    // Both the Firestore transaction and the fallback have committed all
    // submission effects before this shared scheduling point.
    if (scheduleIntakeSubmissionDigest) {
      Promise.resolve(
        scheduleIntakeSubmissionDigest(result.formId, result.submittedAt),
      ).catch((error) =>
        logAuthEvent?.("warn", "intake.digest.schedule_failed", {
          formId: result.formId,
          errorName: error?.name || "Error",
        }),
      );
    }
    return result;
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

  // Legacy boolean fields are deliberately ignored. A conflict can only be
  // acknowledged with the fingerprint returned for the exact server conflict set.
  const normalizeAllowOccurrenceConflict = (body) =>
    typeof body?.confirmedOccurrenceConflictFingerprint === "string"
      ? body.confirmedOccurrenceConflictFingerprint
      : "";
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

  // Joined occurrences use their earliest member time, so shared service ids
  // also match on the same stored calendar date when either side is combined.
  // Legacy schedules without startsAt require overlapping parent date ranges.
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
    const currentServiceIds = getScheduleOccurrenceServiceIds(current);
    const otherServiceIds = getScheduleOccurrenceServiceIds(other);
    const sharesServiceId = [...currentServiceIds].some((serviceId) =>
      otherServiceIds.has(serviceId),
    );
    if (!sharesServiceId) return false;
    if (current.startsAt && other.startsAt) {
      if (current.startsAt === other.startsAt) return true;
      const includesJoinedServices =
        currentServiceIds.size > 1 || otherServiceIds.size > 1;
      return (
        includesJoinedServices &&
        String(current.startsAt).slice(0, 10) ===
          String(other.startsAt).slice(0, 10)
      );
    }
    return Boolean(options.schedulesOverlap);
  };

  const findCrossTeamScheduleAssignmentConflicts = ({
    schedule,
    assignments,
    schedules,
    memberIds,
    targetCellKey,
    targetOccurrenceId,
    targetCellKeysByOccurrence,
    targetOccurrenceIds,
    targetMemberIdsByOccurrence,
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

    const occurrences = getScheduleOccurrencesForConflict(schedule).filter(
      (occurrence) =>
        targetOccurrenceIds?.length
          ? targetOccurrenceIds.includes(occurrence.occurrenceId)
          : !targetOccurrenceId || occurrence.occurrenceId === targetOccurrenceId,
    );
    const conflicts = [];
    for (const currentOccurrence of occurrences) {
      const row = assignments?.[currentOccurrence.occurrenceId] || {};
      const rowMemberIds = new Set(
        Object.values(row).flatMap(getScheduleAssignmentCellMemberIds),
      );
      const occurrenceMemberIds = targetMemberIdsByOccurrence?.[currentOccurrence.occurrenceId]
        ? new Set(targetMemberIdsByOccurrence[currentOccurrence.occurrenceId])
        : memberIdSet;
      const targetMemberIds = [...rowMemberIds].filter((memberId) => occurrenceMemberIds.has(memberId));
      if (targetMemberIds.length === 0) continue;

      for (const otherSchedule of schedules || []) {
        if (!otherSchedule || otherSchedule.archivedAt) continue;
        // Bulk validation does not know which cell is being edited and keeps
        // the historical cross-team-only behavior. Direct assignment writes
        // provide the target cell, allowing same-schedule role conflicts too.
        if (
          otherSchedule.scheduleId === schedule.scheduleId &&
          !targetCellKey &&
          !targetCellKeysByOccurrence
        )
          continue;
        const otherOccurrences = getScheduleOccurrencesForConflict(otherSchedule)
          .filter((candidate) => scheduleOccurrencesConflict(currentOccurrence, candidate, {
            schedulesOverlap: scheduleDateRangesOverlap(schedule, otherSchedule),
          }));
        otherOccurrences.forEach((otherOccurrence) => {
          const otherRow = otherSchedule.scheduleId === schedule.scheduleId
            ? assignments?.[otherOccurrence.occurrenceId] || {}
            : otherSchedule.assignments?.[otherOccurrence.occurrenceId] || {};
          const isExcludedTargetCell = (cellKey) =>
            otherSchedule.scheduleId === schedule.scheduleId && (
              cellKey === targetCellKey ||
              (otherOccurrence.occurrenceId === currentOccurrence.occurrenceId &&
                (targetCellKeysByOccurrence?.[otherOccurrence.occurrenceId] || []).includes(cellKey))
            );
          const otherMemberIds = new Set(
            Object.entries(otherRow)
              .filter(([cellKey]) => !isExcludedTargetCell(cellKey))
              .flatMap(([, cell]) => getScheduleAssignmentCellMemberIds(cell)),
          );
          targetMemberIds.forEach((memberId) => {
            if (otherMemberIds.has(memberId)) {
              conflicts.push({
                memberId,
                scheduleId: otherSchedule.scheduleId,
                scheduleName: otherSchedule.name || "",
                teamId: otherSchedule.teamId || "",
                occurrenceId: currentOccurrence.occurrenceId,
                conflictingOccurrenceId: otherOccurrence.occurrenceId,
                cellKeys: Object.keys(otherRow).filter((cellKey) =>
                  !isExcludedTargetCell(cellKey) &&
                  getScheduleAssignmentCellMemberIds(otherRow[cellKey]).includes(memberId),
                ),
              });
            }
          });
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
    confirmedFingerprint,
    targetCellKey,
    targetOccurrenceId,
    targetCellKeysByOccurrence,
    targetOccurrenceIds,
    targetMemberIdsByOccurrence,
  }) => {
    const conflicts = findCrossTeamScheduleAssignmentConflicts({
      schedule,
      assignments,
      schedules,
      memberIds,
      targetCellKey,
      targetOccurrenceId,
      targetCellKeysByOccurrence,
      targetOccurrenceIds,
      targetMemberIdsByOccurrence,
    });
    const canonicalConflicts = [...new Map(conflicts.map((conflict) => [
      JSON.stringify(conflict), conflict,
    ])).values()].sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b)),
    );
    const fingerprint = hashValue(JSON.stringify({
      churchId: schedule.churchId,
      scheduleId: schedule.scheduleId,
      targetOccurrenceId: targetOccurrenceId || "",
      targetCellKey: targetCellKey || "",
      targetOccurrenceIds: targetOccurrenceIds || [],
      targetCellKeysByOccurrence: targetCellKeysByOccurrence || {},
      targetMemberIdsByOccurrence: targetMemberIdsByOccurrence || {},
      memberIds: [...(memberIds || [])].sort(),
      conflicts: canonicalConflicts,
    }));
    if (canonicalConflicts.length > 0 && confirmedFingerprint !== fingerprint) {
      const error = httpError(409, CROSS_TEAM_SCHEDULE_CONFLICT_MESSAGE);
      error.occurrenceConflicts = canonicalConflicts;
      error.conflictFingerprint = fingerprint;
      throw error;
    }
    if (confirmedFingerprint && confirmedFingerprint !== fingerprint) {
      const error = httpError(409, "The schedule conflicts changed. Review the updated conflict details before continuing.");
      error.occurrenceConflicts = canonicalConflicts;
      error.conflictFingerprint = fingerprint;
      throw error;
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
    const validatedSlot = await assertSchedulePositionSlotExists({
      churchId,
      schedule,
      occurrenceId: serviceId,
      positionSlotKey,
    });
    const targetSlot = validatedSlot.slot;
    const basePositionId = targetSlot.positionId;
    const cellKey = makeScheduleSlotKey(basePositionId, targetSlot.slot);
    const occurrence = validatedSlot.occurrence;
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

  const assertSchedulePositionSlotExists = async ({
    churchId,
    schedule,
    occurrenceId,
    positionSlotKey,
    errorMessage = "Add this position before assigning it.",
    staleSchedule = false,
  }) => {
    const slot = parseScheduleSlotKey(positionSlotKey);
    if (!slot) throw httpError(400, "Position slot key is invalid.");
    if (staleSchedule) {
      const rowIds = (schedule.occurrences || []).map(
        (item) => item.occurrenceId,
      );
      const allowedRowIds =
        rowIds.length > 0 ? rowIds : schedule.serviceIds || [];
      if (!allowedRowIds.includes(occurrenceId))
        throw httpError(409, errorMessage);
    } else {
      assertScheduleRowContains(schedule, occurrenceId);
    }
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
    let requiredCount = Math.max(
      0,
      Math.floor(Number(requirement?.count) || 0),
    );
    if (!requirement && requirements.length === 0) {
      requiredCount = 1;
    }
    const normalizedSlotKey = makeScheduleSlotKey(slot.positionId, slot.slot);
    const additionalSlots = new Set(
      normalizeTeamScheduleAdditionalPositionSlots(
        schedule.additionalPositionSlots ?? schedule.optionalPositionSlots,
      )[occurrenceId] || [],
    );
    if (slot.slot >= requiredCount && !additionalSlots.has(normalizedSlotKey)) {
      throw httpError(staleSchedule ? 409 : 400, errorMessage);
    }
    return {
      slot,
      positionId: slot.positionId,
      slotIndex: slot.slot,
      normalizedSlotKey,
      occurrence,
      requirements,
      requirement,
      requiredCount,
    };
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
    if (
      !isMemberAvailableDuringServiceWeek(member, { date: serviceDate || "" })
    ) {
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
    // A cross-schedule confirmation never grants permission to put one person
    // in two roles in this service row.
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
      const schedules = await listScheduleConflictCandidates({
        churchId,
        schedule,
        occurrenceId: serviceId,
      });
      assertNoCrossTeamScheduleAssignmentConflicts({
        schedule,
        assignments,
        schedules,
        memberIds: new Set([normalizedMemberId]),
        confirmedFingerprint: allowCrossTeamConflict,
        targetCellKey: positionSlotKey,
        targetOccurrenceId: serviceId,
      });
    }
    return { assignments, guests: resolvedGuest.guests };
  };

  const getScheduleConflictDateRange = (schedule, occurrenceId) => {
    const occurrence = getScheduleOccurrencesForConflict(schedule).find(
      (item) => item.occurrenceId === occurrenceId,
    );
    const occurrenceDate = String(occurrence?.startsAt || "").slice(0, 10);
    // Most writes target one concrete service date. Query only that day; use
    // the wider custom schedule range only for legacy occurrences without time
    // details, whose conflict relation depends on overlapping parent ranges.
    const startDate = /^\d{4}-\d{2}-\d{2}$/.test(occurrenceDate)
      ? occurrenceDate
      : schedule?.startDate || schedule?.endDate || "";
    const endDate = /^\d{4}-\d{2}-\d{2}$/.test(occurrenceDate)
      ? occurrenceDate
      : schedule?.endDate || schedule?.startDate || "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      throw httpError(409, "Schedule dates are incomplete, so conflicts cannot be checked safely.");
    }
    return { startDate, endDate };
  };

  const getScheduleConflictDateRangeForOccurrences = (schedule, occurrenceIds) => {
    const ranges = [...new Set(occurrenceIds)].map((occurrenceId) =>
      getScheduleConflictDateRange(schedule, occurrenceId),
    );
    return {
      startDate: ranges.map((range) => range.startDate).sort()[0],
      endDate: ranges.map((range) => range.endDate).sort().at(-1),
    };
  };

  const listScheduleConflictCandidates = async ({
    churchId,
    schedule,
    occurrenceId,
    transaction,
    db,
    occurrenceIds,
  }) => {
    const { startDate, endDate } = occurrenceIds?.length
      ? getScheduleConflictDateRangeForOccurrences(schedule, occurrenceIds)
      : getScheduleConflictDateRange(schedule, occurrenceId);
    const matchesRange = (candidate) => {
      if (!candidate || candidate.churchId !== churchId) return false;
      const candidateStart = candidate.startDate || candidate.endDate || "";
      const candidateEnd = candidate.endDate || candidate.startDate || "";
      // Date-less legacy candidates cannot be excluded safely after a bounded
      // query, so the target write fails closed when one appears in fallback data.
      if (!candidateStart || !candidateEnd) {
        throw httpError(409, "A schedule has incomplete dates, so conflicts cannot be checked safely.");
      }
      return candidateStart <= endDate && candidateEnd >= startDate;
    };
    const firestore = db || requireFirestore();
    if (!transaction && !firestore) {
      const docs = await queryDocs(COLLECTIONS.teamSchedules, [
        { field: "churchId", value: churchId },
      ], { limit: 0 });
      return docs
        .map((doc) => ({ scheduleId: doc.id, ...doc }))
        .filter(matchesRange);
    }

    // The parent range is intentionally used here: legacy rows can have
    // incomplete occurrence details, in which case conflict matching falls
    // back to overlapping schedule ranges. Firestore uses this composite index
    // to read only schedules whose ranges can overlap this schedule window.
    let query = firestore.collection(COLLECTIONS.teamSchedules)
      .where("churchId", "==", churchId)
      .where("startDate", "<=", endDate)
      .where("endDate", ">=", startDate);
    const snapshot = transaction
      ? await transaction.get(query)
      : await query.get();
    return snapshot.docs.map((doc) => ({ scheduleId: doc.id, ...doc.data() }));
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
        const schedules = await listScheduleConflictCandidates({
          transaction,
          db,
          churchId,
          schedule,
          occurrenceId: serviceId,
        });
        assertNoCrossTeamScheduleAssignmentConflicts({
          schedule,
          assignments,
          schedules,
          memberIds: new Set([normalizedMemberId]),
          confirmedFingerprint: allowCrossTeamConflict,
          targetCellKey: positionSlotKey,
          targetOccurrenceId: serviceId,
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

  const updateTeamScheduleAssignmentsBatchInStore = async ({
    churchId,
    scheduleId,
    changes,
    confirmedFingerprint,
    skipChangedCells,
    adminUserId,
  }) => {
    const db = requireFirestore();
    const applyBatch = async (schedule, team, candidateSchedules) => {
      const assignments = JSON.parse(JSON.stringify(schedule.assignments || {}));
      const accepted = [];
      const skipped = [];
      const targetCellKeysByOccurrence = {};
      const targetOccurrenceIds = [...new Set(changes.map((change) => change.serviceId))];
      const introducedMemberIds = new Set();
      const targetMemberIdsByOccurrence = {};

      for (const change of changes) {
        const occurrence = getScheduleOccurrencesForConflict(schedule).find(
          (item) => item.occurrenceId === change.serviceId,
        );
        if (!occurrence) throw httpError(400, "That service is not on this schedule.");
        const slot = await assertSchedulePositionSlotExists({
          churchId,
          schedule,
          occurrenceId: change.serviceId,
          positionSlotKey: change.positionSlotKey,
        });
        const position = await assertTeamEntityInChurch("position", slot.slot.positionId, churchId, { label: "Position" });
        if (position.teamId !== team.teamId) throw httpError(400, "That position is not part of this team.");

        const row = { ...(assignments[change.serviceId] || {}) };
        const currentCell = serializeScheduleAssignmentCell(
          normalizeScheduleAssignmentCell(row[change.positionSlotKey]),
        ) || "";
        const expectedCell = serializeScheduleAssignmentCell(
          normalizeScheduleAssignmentCell(change.expectedCell),
        ) || "";
        if (currentCell !== expectedCell) {
          if (skipChangedCells) {
            skipped.push({ serviceId: change.serviceId, positionSlotKey: change.positionSlotKey });
            continue;
          }
          throw httpError(409, "This schedule changed while the assignments were being prepared. Reload and try again.");
        }

        const desired = serializeScheduleAssignmentCell(
          normalizeScheduleAssignmentCell(change.assignment),
        ) || "";
        const currentMemberIds = new Set(getScheduleAssignmentCellMemberIds(currentCell));
        const desiredMemberIds = getScheduleAssignmentCellMemberIds(desired);
        desiredMemberIds.forEach((memberId) => {
          if (!currentMemberIds.has(memberId)) {
            introducedMemberIds.add(memberId);
            targetMemberIdsByOccurrence[change.serviceId] ||= new Set();
            targetMemberIdsByOccurrence[change.serviceId].add(memberId);
          }
        });

        const serviceDate = String(change.serviceDate || occurrence.startsAt || "").slice(0, 10);
        const normalized = normalizeScheduleAssignmentCell(desired);
        for (const memberId of desiredMemberIds) {
          const member = await assertTeamEntityInChurch("member", memberId, churchId, { label: "Member" });
          if (!(team.memberIds || []).includes(memberId)) throw httpError(400, "That member is not part of this team.");
          if (normalized.primaryMemberId === memberId && !(member.positionIds || []).includes(slot.slot.positionId)) {
            throw httpError(400, "That member cannot serve in this position.");
          }
          if (isMemberBlockedOutForService(member, { date: serviceDate }) || !isMemberAvailableDuringServiceWeek(member, { date: serviceDate })) {
            throw httpError(400, "That member is unavailable for this service.");
          }
        }

        if (desired) row[change.positionSlotKey] = desired;
        else delete row[change.positionSlotKey];
        if (Object.keys(row).length) assignments[change.serviceId] = row;
        else delete assignments[change.serviceId];
        targetCellKeysByOccurrence[change.serviceId] ||= [];
        targetCellKeysByOccurrence[change.serviceId].push(change.positionSlotKey);
        accepted.push({ serviceId: change.serviceId, positionSlotKey: change.positionSlotKey });
      }

      for (const occurrenceId of targetOccurrenceIds) {
        assertNoDuplicateScheduleMembersForService(assignments[occurrenceId] || {});
      }

      if (introducedMemberIds.size) {
        assertNoCrossTeamScheduleAssignmentConflicts({
          schedule,
          assignments,
          schedules: candidateSchedules,
          memberIds: introducedMemberIds,
          confirmedFingerprint,
          targetCellKeysByOccurrence,
          targetOccurrenceIds,
          targetMemberIdsByOccurrence: Object.fromEntries(
            Object.entries(targetMemberIdsByOccurrence).map(([id, memberIds]) => [id, [...memberIds]]),
          ),
        });
      } else if (confirmedFingerprint) {
        assertNoCrossTeamScheduleAssignmentConflicts({
          schedule,
          assignments,
          schedules: candidateSchedules,
          memberIds: new Set(),
          confirmedFingerprint,
          targetCellKeysByOccurrence,
          targetOccurrenceIds,
          targetMemberIdsByOccurrence: {},
        });
      }

      return { assignments, accepted, skipped };
    };

    if (!db) {
      return enqueueInMemoryScheduleSave(scheduleId, async () => {
        const schedule = await assertTeamEntityInChurch("schedule", scheduleId, churchId, { label: "Schedule", active: false });
        const team = await assertTeamEntityInChurch("team", schedule.teamId, churchId, { label: "Team" });
        const candidateSchedules = await listScheduleConflictCandidates({ churchId, schedule, occurrenceIds: [...new Set(changes.map((change) => change.serviceId))] });
        const result = await applyBatch(schedule, team, candidateSchedules);
        const update = {
          assignments: result.assignments,
          responses: prunedResponsesForAssignments(schedule.responses, result.assignments),
          updatedAt: nowIso(),
          updatedByUid: adminUserId,
        };
        const nextSchedule = { ...schedule, ...update };
        await setDoc(COLLECTIONS.teamSchedules, scheduleId, nextSchedule, { merge: false });
        return { schedule: nextSchedule, accepted: result.accepted, skipped: result.skipped };
      });
    }

    return db.runTransaction(async (transaction) => {
      const scheduleRef = db.collection(COLLECTIONS.teamSchedules).doc(scheduleId);
      const scheduleSnap = await transaction.get(scheduleRef);
      const schedule = readTransactionTeamEntity(scheduleSnap, "scheduleId", "Schedule", { active: false });
      if (schedule.churchId !== churchId) throw httpError(404, "Schedule not found.");
      const teamSnap = await transaction.get(db.collection(COLLECTIONS.teams).doc(schedule.teamId));
      const team = readTransactionTeamEntity(teamSnap, "teamId", "Team");
      if (team.churchId !== churchId) throw httpError(404, "Team not found.");
      const candidateSchedules = await listScheduleConflictCandidates({
        transaction,
        db,
        churchId,
        schedule,
        occurrenceIds: [...new Set(changes.map((change) => change.serviceId))],
      });
      const result = await applyBatch(schedule, team, candidateSchedules);
      const update = {
        assignments: result.assignments,
        responses: prunedResponsesForAssignments(schedule.responses, result.assignments),
        updatedAt: nowIso(),
        updatedByUid: adminUserId,
      };
      transaction.update(scheduleRef, update);
      return { schedule: { ...schedule, ...update }, accepted: result.accepted, skipped: result.skipped };
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
        confirmedFingerprint: allowCrossTeamConflict,
        targetOccurrenceId: serviceId,
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
      const schedules = await listScheduleConflictCandidates({
        transaction,
        db,
        churchId,
        schedule,
        occurrenceId: serviceId,
      });
      assertNoCrossTeamScheduleAssignmentConflicts({
        schedule,
        assignments,
        schedules,
        memberIds: new Set([
          normalizedCurrentMemberId,
          normalizedCandidateMemberId,
        ]),
        confirmedFingerprint: allowCrossTeamConflict,
        targetOccurrenceId: serviceId,
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

  const teamIntakeNotificationRecipientQueues = new Map();
  const withTeamIntakeRecipientLock = (recipientId, task) => {
    const previous =
      teamIntakeNotificationRecipientQueues.get(recipientId) ||
      Promise.resolve();
    const run = previous.then(task, task);
    const settled = run.then(
      () => undefined,
      () => undefined,
    );
    teamIntakeNotificationRecipientQueues.set(recipientId, settled);
    void settled.finally(() => {
      if (teamIntakeNotificationRecipientQueues.get(recipientId) === settled) {
        teamIntakeNotificationRecipientQueues.delete(recipientId);
      }
    });
    return run;
  };

  const ensureTeamIntakeNotificationRecipient = async ({
    form,
    member,
    actorUid,
  }) => {
    const recipientId = createTeamIntakeRecipientId(
      form.formId,
      member.memberId,
    );
    const db = requireFirestore?.();
    const buildOrReuse = (
      existing,
      transaction = null,
      recipientRef = null,
    ) => {
      if (existing?.revokedAt)
        return { recipient: existing, token: "", reason: "revoked" };
      if (existing?.respondedAt)
        return { recipient: existing, token: "", reason: "responded" };
      const existingToken = decryptTeamIntakeRecipientToken(
        existing?.recipientTokenCiphertext,
        teamIntakeRecipientTokenSecret,
      );
      const canReuseToken = Boolean(
        existingToken &&
        looksLikeTeamIntakeRecipientToken(existingToken) &&
        hashTeamIntakeRecipientToken(
          existingToken,
          teamIntakeRecipientTokenSecret,
        ) === existing?.recipientTokenHash,
      );
      const token = canReuseToken
        ? existingToken
        : createTeamIntakeRecipientToken();
      const now = nowIso();
      const recipient = {
        ...(existing || {}),
        recipientId,
        churchId: form.churchId,
        formId: form.formId,
        memberId: member.memberId,
        createdAt: existing?.createdAt || now,
        ...(existing?.createdByUid ? {} : { createdByUid: actorUid }),
        ...(!canReuseToken
          ? {
              recipientTokenHash: hashTeamIntakeRecipientToken(
                token,
                teamIntakeRecipientTokenSecret,
              ),
              recipientTokenCiphertext: encryptTeamIntakeRecipientToken(
                token,
                teamIntakeRecipientTokenSecret,
              ),
              tokenIssuedAt: now,
            }
          : {}),
        revokedAt: null,
        updatedAt: now,
        updatedByUid: actorUid,
      };
      if (transaction && recipientRef) {
        transaction.set(recipientRef, recipient, { merge: Boolean(existing) });
      }
      return { recipient, token, reason: "" };
    };

    if (db) {
      return db.runTransaction(async (transaction) => {
        const ref = db
          .collection(COLLECTIONS.teamIntakeRecipients)
          .doc(recipientId);
        const snapshot = await transaction.get(ref);
        const existing = snapshot.exists
          ? { recipientId: snapshot.id, ...snapshot.data() }
          : null;
        return buildOrReuse(existing, transaction, ref);
      });
    }
    return withTeamIntakeRecipientLock(recipientId, async () => {
      const existing = await getDoc(
        COLLECTIONS.teamIntakeRecipients,
        recipientId,
      );
      const result = buildOrReuse(existing);
      if (!existing && !result.reason) {
        await setDoc(
          COLLECTIONS.teamIntakeRecipients,
          recipientId,
          result.recipient,
          { merge: false },
        );
      } else if (
        existing &&
        !result.reason &&
        result.recipient.recipientTokenHash !== existing.recipientTokenHash
      ) {
        await setDoc(
          COLLECTIONS.teamIntakeRecipients,
          recipientId,
          result.recipient,
          { merge: true },
        );
      }
      return result;
    });
  };

  const assertMemberWithinIntakeFormScope = ({
    form,
    member,
    positions,
    teams,
  }) => {
    const formTeamIds = new Set(normalizeIdArray(form.teamIds));
    if (formTeamIds.size === 0) return true;
    const positionTeamById = new Map(
      positions.map((position) => [position.positionId, position.teamId]),
    );
    const memberTeamIds = new Set([
      ...Object.keys(member.teamMemberships || {}),
      ...(member.positionIds || [])
        .map((positionId) => positionTeamById.get(positionId))
        .filter(Boolean),
      ...teams
        .filter((team) => (team.memberIds || []).includes(member.memberId))
        .map((team) => team.teamId),
    ]);
    return [...formTeamIds].some((teamId) => memberTeamIds.has(teamId));
  };

  const prepareAvailabilityNotificationRecipients = async ({
    churchId,
    formId,
    memberIds,
    purpose,
    actorUid,
  }) => {
    const form = await getDoc(COLLECTIONS.teamIntakeForms, formId);
    if (!form || form.churchId !== churchId || form.archivedAt) {
      throw httpError(404, "Intake form not found.");
    }
    assertTeamIntakeFormIsOpen(form);
    assertTeamIntakeFormResponseDeadline(form);
    const enabledFields = normalizeTeamIntakeFields(
      undefined,
      form.enabledFields,
    );
    if (
      !hasPersonalizedIntakeResponseFields(
        enabledFields,
        form.availabilityOccurrences,
      )
    ) {
      throw httpError(
        409,
        "This intake form has no response fields for an existing volunteer.",
      );
    }
    const [members, positions, teams, church] = await Promise.all([
      listTeamCollectionForChurch(
        COLLECTIONS.teamRosterMembers,
        "memberId",
        churchId,
      ),
      listTeamCollectionForChurch(
        COLLECTIONS.teamPositions,
        "positionId",
        churchId,
      ),
      listTeamCollectionForChurch(COLLECTIONS.teams, "teamId", churchId),
      getChurchById(churchId),
    ]);
    const results = [];
    for (const memberId of [...new Set(memberIds)].slice(0, 500)) {
      const member = members.find((item) => item.memberId === memberId);
      if (!member || member.archivedAt) {
        results.push({
          memberId,
          eligible: false,
          exclusionReason: "Volunteer is no longer active on this roster.",
        });
        continue;
      }
      if (
        !assertMemberWithinIntakeFormScope({ form, member, positions, teams })
      ) {
        results.push({
          memberId,
          eligible: false,
          exclusionReason: "Volunteer is outside this form's team scope.",
        });
        continue;
      }
      const recipientId = createTeamIntakeRecipientId(formId, memberId);
      let recipient = await getDoc(
        COLLECTIONS.teamIntakeRecipients,
        recipientId,
      );
      let token = "";
      if (purpose === "availability_request") {
        const ensured = await ensureTeamIntakeNotificationRecipient({
          form,
          member,
          actorUid,
        });
        recipient = ensured.recipient;
        token = ensured.token;
        if (ensured.reason) {
          results.push({
            memberId,
            recipientId,
            recipient,
            eligible: false,
            exclusionReason: ensured.reason,
          });
          continue;
        }
      } else if (!recipient) {
        results.push({
          memberId,
          recipientId,
          eligible: false,
          exclusionReason: "No individual intake request exists.",
        });
        continue;
      }
      if (recipient?.revokedAt) {
        results.push({
          memberId,
          recipientId,
          recipient,
          eligible: false,
          exclusionReason: "Request was revoked.",
        });
        continue;
      }
      if (recipient?.respondedAt) {
        results.push({
          memberId,
          recipientId,
          recipient,
          eligible: false,
          exclusionReason: "Form response already received.",
        });
        continue;
      }
      if (purpose === "availability_reminder") {
        const ensured = await ensureTeamIntakeRecipientToken(
          recipient,
          actorUid,
        );
        recipient = ensured.recipient;
        token = ensured.token;
      }
      const preliminary = resolveSmsMemberEligibility({
        member,
        churchId,
        consent: null,
      });
      const consent = preliminary.phoneNumber
        ? await getSmsConsentForChurchPhone(churchId, preliminary.phoneNumber)
        : null;
      const eligibility = resolveSmsMemberEligibility({
        member,
        churchId,
        consent,
      });
      const publicUrl = token ? buildTeamIntakeRecipientPublicUrl(token) : "";
      results.push({
        memberId,
        recipientId,
        recipient,
        member,
        form: { formId, ...form },
        churchName: church?.name || "WorshipSync",
        publicUrl,
        phoneNumber: eligibility.phoneNumber,
        maskedPhoneNumber: eligibility.phoneNumber
          ? `••• ••• ${eligibility.phoneNumber.slice(-4)}`
          : "",
        eligibilityStatus: eligibility.status,
        eligible: eligibility.eligible,
        exclusionReason: eligibility.eligible
          ? ""
          : {
              no_mobile: "No valid mobile number.",
              consent_needed: "SMS consent is needed.",
              opted_out: "This phone number opted out.",
            }[eligibility.status],
      });
    }
    return { form: { formId, ...form }, results };
  };

  const resolveAvailabilityNotificationContext = async (
    intent,
    actorUid = "",
  ) => {
    const recipient = await getDoc(
      COLLECTIONS.teamIntakeRecipients,
      intent.recipientId || intent.sourceId,
    );
    if (
      !recipient ||
      recipient.churchId !== intent.churchId ||
      (intent.formId && recipient.formId !== intent.formId)
    ) {
      throw httpError(
        409,
        "The individual intake request is no longer available.",
      );
    }
    const { form, member } = await getTeamIntakeRecipientContext(recipient);
    assertTeamIntakeFormIsOpen(form);
    assertTeamIntakeFormResponseDeadline(form);
    if (recipient.revokedAt)
      throw httpError(409, "This intake request was revoked.");
    if (recipient.respondedAt)
      throw httpError(409, "This volunteer has already responded.");
    if (
      !hasPersonalizedIntakeResponseFields(
        normalizeTeamIntakeFields(undefined, form.enabledFields),
        form.availabilityOccurrences,
      )
    ) {
      throw httpError(
        409,
        "This intake form no longer has response fields for an existing volunteer.",
      );
    }
    const ensured = await ensureTeamIntakeRecipientToken(recipient, actorUid);
    return {
      form,
      recipient,
      member,
      church: await getChurchById(intent.churchId),
      publicUrl: buildTeamIntakeRecipientPublicUrl(ensured.token),
    };
  };

  const resolveScheduleNotificationContext = async (intent) => {
    const schedule = await getDoc(COLLECTIONS.teamSchedules, intent.sourceId);
    if (
      !schedule ||
      schedule.churchId !== intent.churchId ||
      schedule.archivedAt
    ) {
      throw httpError(409, "The source schedule is no longer available.");
    }
    const member = await getDoc(COLLECTIONS.teamRosterMembers, intent.memberId);
    const occurrence = (schedule.occurrences || []).find(
      (item) => item.occurrenceId === intent.occurrenceId,
    );
    const positionId = String(intent.cellKey || "").split(
      SCHEDULE_SLOT_KEY_SEPARATOR,
    )[0];
    const [position, church] = await Promise.all([
      positionId ? getDoc(COLLECTIONS.teamPositions, positionId) : null,
      getChurchById(intent.churchId),
    ]);
    return {
      schedule,
      member,
      occurrence,
      church,
      serviceName: occurrence?.name || "service",
      positionName: position?.name || "volunteer position",
      responseUrl: buildAssignmentResponseUrl({
        churchId: intent.churchId,
        scheduleId: intent.sourceId,
        memberId: intent.memberId,
      }),
    };
  };

  const closeResolvedReplacementInvitations = async ({
    churchId,
    scheduleId,
    occurrenceId,
    cellKey,
  }) => {
    const intents = await queryDocs(
      COLLECTIONS.notificationIntents,
      [
        { field: "churchId", value: churchId },
        { field: "sourceId", value: scheduleId },
        { field: "sourceType", value: "team_schedule" },
      ],
      { limit: 250 },
    );
    const now = nowIso();
    for (const intent of intents) {
      if (
        intent.intentType !== "replacement_request" ||
        intent.occurrenceId !== occurrenceId ||
        intent.cellKey !== cellKey ||
        intent.replacementResolvedAt
      )
        continue;
      await setDoc(
        COLLECTIONS.notificationIntents,
        intent.intentId || intent.id,
        {
          replacementResolvedAt: now,
          replacementResolvedBy: "schedule_assignment",
          updatedAt: now,
        },
        { merge: true },
      );
      const claimId = hashValue(
        `${churchId}|replacement-vacancy|${scheduleId}|${occurrenceId}|${cellKey}`,
      );
      await setDoc(
        COLLECTIONS.notificationBatches,
        claimId,
        { releasedAt: now, status: "released" },
        { merge: true },
      );
    }
  };

  const validateReplacementCandidate = async ({
    churchId,
    scheduleId,
    occurrenceId,
    cellKey,
    memberId,
    originalMemberId = "",
  }) => {
    const schedule = await getDoc(COLLECTIONS.teamSchedules, scheduleId);
    if (!schedule || schedule.churchId !== churchId || schedule.archivedAt) {
      throw httpError(404, "Schedule not found.");
    }
    const occurrence = (schedule.occurrences || []).find(
      (item) => item?.occurrenceId === occurrenceId,
    );
    if (!occurrence)
      throw httpError(
        409,
        "This service occurrence is no longer on the schedule.",
      );
    const positionId = String(cellKey || "").split("::")[0];
    const cell = schedule.assignments?.[occurrenceId]?.[cellKey];
    const holderId =
      typeof cell === "string" ? cell : cell?.primaryMemberId || "";
    const response = schedule.responses?.[occurrenceId]?.[cellKey]?.response;
    if (holderId && response !== "declined") {
      throw httpError(
        409,
        "Replacement invitations are available only for a vacant or declined assignment.",
      );
    }
    if (
      memberId === holderId ||
      (originalMemberId && memberId === originalMemberId)
    ) {
      throw httpError(
        400,
        "The volunteer who declined cannot receive the replacement invitation.",
      );
    }
    const churchTeam = await getDoc(COLLECTIONS.teams, schedule.teamId);
    const position = await getDoc(COLLECTIONS.teamPositions, positionId);
    const member = await getDoc(COLLECTIONS.teamRosterMembers, memberId);
    if (
      !churchTeam ||
      churchTeam.churchId !== churchId ||
      !position ||
      position.churchId !== churchId ||
      !member ||
      member.churchId !== churchId ||
      member.archivedAt
    ) {
      throw httpError(
        404,
        "Replacement candidate or schedule position not found in this church.",
      );
    }
    if (member.serviceAvailability?.[occurrenceId] === "unavailable") {
      throw httpError(
        409,
        "This volunteer marked the service unavailable on intake.",
      );
    }
    const vacancySchedule = {
      ...schedule,
      assignments: JSON.parse(JSON.stringify(schedule.assignments || {})),
    };
    const currentCell = vacancySchedule.assignments?.[occurrenceId]?.[cellKey];
    if (currentCell) {
      const normalizedCell = normalizeScheduleAssignmentCell(currentCell);
      const clearedCell = serializeScheduleAssignmentCell({
        primaryMemberId: "",
        shadows: normalizedCell.shadows,
      });
      if (clearedCell)
        vacancySchedule.assignments[occurrenceId][cellKey] = clearedCell;
      else delete vacancySchedule.assignments[occurrenceId][cellKey];
    }
    const serviceDate = String(occurrence.startsAt || "").slice(0, 10);
    const validated = await buildValidatedScheduleAssignments({
      churchId,
      schedule: vacancySchedule,
      team: churchTeam,
      position,
      member,
      serviceId: occurrenceId,
      positionSlotKey: cellKey,
      memberId,
      serviceDate,
      allowBlockout: false,
      allowRecurringAvailability: false,
      allowOccurrenceConflict: false,
    });
    const schedules = await listTeamCollectionForChurch(
      COLLECTIONS.teamSchedules,
      "scheduleId",
      churchId,
    );
    assertNoCrossTeamScheduleAssignmentConflicts({
      schedule: vacancySchedule,
      assignments: validated.assignments,
      schedules,
      memberIds: new Set([memberId]),
      confirmedFingerprint: "",
      targetCellKey: cellKey,
      targetOccurrenceId: occurrenceId,
    });
    return {
      schedule,
      occurrence,
      member,
      team: churchTeam,
      position,
      holderId,
    };
  };

  const readPortableDatasets = async (churchId) => {
    const [members, teams, positions, schedules, services] = await Promise.all([
      queryDocs(
        COLLECTIONS.teamRosterMembers,
        [{ field: "churchId", value: churchId }],
        { limit: 0 },
      ),
      queryDocs(COLLECTIONS.teams, [{ field: "churchId", value: churchId }], {
        limit: 0,
      }),
      queryDocs(
        COLLECTIONS.teamPositions,
        [{ field: "churchId", value: churchId }],
        { limit: 0 },
      ),
      queryDocs(
        COLLECTIONS.teamSchedules,
        [{ field: "churchId", value: churchId }],
        { limit: 0 },
      ),
      readChurchServiceTimesForTransfer(churchId),
    ]);
    return {
      members: members.map(({ id, ...item }) => ({
        ...item,
        memberId: item.memberId || id,
      })),
      teams: teams.map(({ id, ...item }) => ({
        ...item,
        teamId: item.teamId || id,
      })),
      positions: positions.map(({ id, ...item }) => ({
        ...item,
        positionId: item.positionId || id,
      })),
      schedules: schedules.map(({ id, ...item }) => ({
        ...item,
        scheduleId: item.scheduleId || id,
      })),
      services: (Array.isArray(services) ? services : []).map((service) => ({
        ...service,
        serviceId: service.serviceId || service.id,
      })),
    };
  };

  const dataTransferError = (res, error, fallback) => {
    const statusCode =
      Number.isInteger(error?.statusCode) && error.statusCode >= 400
        ? error.statusCode
        : 500;
    if (statusCode >= 500) console.error(fallback, error);
    return res
      .status(statusCode)
      .json({
        success: false,
        errorMessage:
          statusCode < 500 && error?.message ? error.message : fallback,
      });
  };

  const PORTABLE_FIELDS = {
    members: [
      "firstName",
      "lastName",
      "name",
      "title",
      "email",
      "phone",
      "teams",
      "positions",
      "notes",
      "servingFrequency",
      "archived",
      "memberId",
      "teamIds",
      "positionIds",
    ],
    teams: [
      "name",
      "description",
      "usesMicrophones",
      "usesIems",
      "archived",
      "teamId",
      "icon",
    ],
    positions: [
      "name",
      "team",
      "description",
      "group",
      "order",
      "archived",
      "positionId",
      "teamId",
      "icon",
    ],
    services: [
      "name",
      "recurrence",
      "time",
      "date",
      "daysOfWeek",
      "startDate",
      "endDate",
      "weekOrdinal",
      "weekday",
      "combinedGroup",
      "position",
      "requiredSlots",
      "archived",
      "serviceId",
      "positionId",
    ],
    schedules: [
      "name",
      "startDate",
      "endDate",
      "service",
      "date",
      "startTime",
      "team",
      "position",
      "slot",
      "person",
      "email",
      "assignmentType",
      "guest",
      "scheduleId",
      "occurrenceId",
      "serviceId",
      "teamId",
      "positionId",
      "memberId",
    ],
  };
  const HEADER_ALIASES = {
    firstName: ["first name", "firstname", "given name", "forename"],
    lastName: ["last name", "lastname", "surname", "family name"],
    name: [
      "name",
      "team",
      "position",
      "service",
      "schedule",
      "person",
      "volunteer",
      "member",
    ],
    teams: ["teams", "team", "ministry", "ministries"],
    positions: ["positions", "position", "role", "roles"],
    email: ["email", "email address"],
    phone: ["phone", "phone number", "mobile", "cell"],
    date: ["date", "service date", "occurrence date"],
    startDate: ["start date", "schedule start"],
    endDate: ["end date", "schedule end"],
    startTime: ["start time", "service time", "time"],
    recurrence: ["recurrence", "frequency", "repeat"],
    team: ["team", "ministry"],
    person: ["person", "volunteer", "member", "name"],
    assignmentType: ["assignment type", "assignment", "shadow type"],
    memberId: ["worshipsync member id", "member id"],
    teamId: ["worshipsync team id", "team id"],
    positionId: ["worshipsync position id", "position id"],
    teamIds: ["worshipsync team ids", "team ids"],
    positionIds: ["worshipsync position ids", "position ids"],
    serviceId: ["worshipsync service id", "service id"],
    scheduleId: ["worshipsync schedule id", "schedule id"],
    occurrenceId: ["worshipsync occurrence id", "occurrence id"],
    description: ["description", "notes"],
    icon: ["icon", "position icon"],
    combinedGroup: ["combined group", "combined services", "service group"],
  };
  const normalizeHeader = (value) =>
    normalizePortableMatchValue(value).replace(/[^a-z0-9]/g, "");
  const mappingSuggestions = (headers, type) =>
    Object.fromEntries(
      PORTABLE_FIELDS[type].map((field) => {
        const contextualAliases =
          field === "name"
            ? type === "schedules"
              ? ["schedule", "schedule name"]
              : type === "teams"
                ? ["team", "team name", "name"]
                : type === "positions"
                  ? ["position", "role", "position name"]
                  : type === "members"
                    ? [
                        "name",
                        "person",
                        "member",
                        "volunteer",
                        "full name",
                        "display name",
                      ]
                    : ["service", "service name", "name"]
            : HEADER_ALIASES[field];
        const aliases = contextualAliases || [
          field
            .toLowerCase()
            .replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`),
        ];
        const normalizedAliases = aliases.map(normalizeHeader);
        const header = headers.find((candidate) =>
          normalizedAliases.includes(normalizeHeader(candidate)),
        );
        return [field, header || ""];
      }),
    );
  const mappedPortableRows = ({ parsed, type, mapping = {} }) =>
    parsed.rows.map(({ rowNumber, values }) => {
      const record = {};
      PORTABLE_FIELDS[type].forEach((field) => {
        const source = mapping[field];
        if (source && Object.hasOwn(values, source))
          record[field] = values[source];
      });
      if (type === "members" && !record.firstName && record.name) {
        const name = String(record.name).trim().split(/\s+/);
        record.firstName = name.shift() || "";
        record.lastName = name.join(" ");
      }
      return { row: rowNumber, record };
    });
  const portableResolutionId = (approved, field, referenceIndex = 0) => {
    if (Array.isArray(approved?.resolutions)) {
      return (
        approved.resolutions.find(
          (item) =>
            item?.field === field &&
            Number(item.referenceIndex) === referenceIndex,
        )?.selectedId || ""
      );
    }
    const legacy =
      approved?.resolutions && typeof approved.resolutions === "object"
        ? approved.resolutions
        : {};
    return referenceIndex === 0
      ? String(legacy[field] || legacy[`${field}Id`] || "")
      : "";
  };

  return {
    prepareAvailabilityNotificationRecipients,
    resolveAvailabilityNotificationContext,
    resolveScheduleNotificationContext,
    async exportPortableData(req, res) {
      try {
        const churchId = String(req.params.churchId || "").trim();
        await requireAdminSession(req, churchId);
        const type = String(req.params.type || "")
          .trim()
          .toLowerCase();
        const timeZone = String(req.query?.timeZone || "UTC").trim();
        if (!isValidPortableTimeZone(timeZone))
          throw httpError(400, "Choose a valid time zone for this export.");
        if (type === "all") {
          const datasets = buildPortableDatasets(
            await readPortableDatasets(churchId),
            { timeZone },
          );
          const now = new Date().toISOString();
          const entries = Object.keys(PORTABLE_SCHEMAS).map((name) => ({
            name: `${name}.csv`,
            content: encodeCsv(PORTABLE_SCHEMAS[name], datasets[name]),
          }));
          entries.push({
            name: "metadata.json",
            content: JSON.stringify(
              {
                format: "worshipsync-data-transfer",
                version: 1,
                exportedAt: now,
                files: Object.keys(PORTABLE_SCHEMAS).map(
                  (name) => `${name}.csv`,
                ),
              },
              null,
              2,
            ),
          });
          res.set("Content-Type", "application/zip");
          res.set(
            "Content-Disposition",
            'attachment; filename="worshipsync-data-transfer.zip"',
          );
          return res.send(createZip(entries));
        }
        if (!Object.hasOwn(PORTABLE_SCHEMAS, type))
          throw httpError(404, "Choose a supported data type.");
        res.set("Content-Type", "text/csv; charset=utf-8");
        res.set("Content-Disposition", `attachment; filename="${type}.csv"`);
        if (req.query?.template === "true")
          return res.send(encodeCsv(PORTABLE_SCHEMAS[type], []));
        const datasets = buildPortableDatasets(
          await readPortableDatasets(churchId),
          { timeZone },
        );
        return res.send(encodeCsv(PORTABLE_SCHEMAS[type], datasets[type]));
      } catch (error) {
        return dataTransferError(
          res,
          error,
          "Could not export this data. Try again.",
        );
      }
    },
    async inspectPortableImport(req, res) {
      try {
        await assertCsrf(req);
        const churchId = String(req.params.churchId || "").trim();
        await requireAdminSession(req, churchId);
        const type = String(req.body?.type || "")
          .trim()
          .toLowerCase();
        if (!Object.hasOwn(PORTABLE_SCHEMAS, type))
          throw httpError(400, "Choose a data type before uploading a CSV.");
        const csv = String(req.body?.csv || "");
        if (!csv || Buffer.byteLength(csv, "utf8") > 8 * 1024 * 1024)
          throw httpError(400, "Choose a CSV file smaller than 8 MB.");
        const parsed = parseCsv(csv);
        return res.json({
          success: true,
          headers: parsed.headers,
          rowCount: parsed.totalRows,
          columnCount: parsed.headers.length,
          issues: parsed.issues,
          mapping: mappingSuggestions(parsed.headers, type),
          sampleRows: parsed.rows.slice(0, 5).map((row) => row.values),
        });
      } catch (error) {
        return dataTransferError(
          res,
          error,
          "Could not read this CSV. Check the file and try again.",
        );
      }
    },
    async previewPortableImport(req, res) {
      try {
        await assertCsrf(req);
        const churchId = String(req.params.churchId || "").trim();
        await requireAdminSession(req, churchId);
        const type = String(req.body?.type || "")
          .trim()
          .toLowerCase();
        if (!Object.hasOwn(PORTABLE_SCHEMAS, type))
          throw httpError(400, "Choose a supported data type.");
        const parsed = parseCsv(String(req.body?.csv || ""));
        if (parsed.issues.some((issue) => issue.row === 1))
          throw httpError(
            400,
            parsed.issues.find((issue) => issue.row === 1)?.message ||
              "Check the CSV column headers.",
          );
        const records = await readPortableDatasets(churchId);
        const mapped = mappedPortableRows({
          parsed,
          type,
          mapping: req.body?.mapping,
        });
        const rows = mapped.map(({ row, record }) => {
          const issues = parsed.issues
            .filter((issue) => issue.row === row)
            .map((issue) => ({
              field: "csv",
              code: issue.code,
              message: issue.message,
            }));
          let match = null;
          let candidates = [];
          if (type === "members") {
            if (!record.firstName || !record.lastName)
              issues.push({
                field: "firstName",
                code: "required",
                message: "First and last name are required.",
              });
            const importedId = String(record.memberId || "").trim();
            if (importedId) {
              match =
                records.members.find((item) => item.memberId === importedId) ||
                null;
              if (!match) {
                candidates = records.members.filter(
                  (item) =>
                    !item.archivedAt &&
                    normalizePortableMatchValue(item.firstName) ===
                      normalizePortableMatchValue(record.firstName) &&
                    normalizePortableMatchValue(item.lastName) ===
                      normalizePortableMatchValue(record.lastName),
                );
                issues.push({
                  field: "memberId",
                  code: "foreign_or_unknown_record_id",
                  message:
                    "This WorshipSync Member ID does not belong to this church. Choose a local match explicitly or create a new member.",
                  candidates: candidates.map((item) => ({
                    id: item.memberId,
                    name: [item.firstName, item.lastName]
                      .filter(Boolean)
                      .join(" "),
                  })),
                });
              }
            } else if (record.firstName && record.lastName) {
              candidates = records.members.filter(
                (item) =>
                  normalizePortableMatchValue(item.firstName) ===
                    normalizePortableMatchValue(record.firstName) &&
                  normalizePortableMatchValue(item.lastName) ===
                    normalizePortableMatchValue(record.lastName) &&
                  !item.archivedAt,
              );
              if (candidates.length === 1) match = candidates[0];
            }
            const referenceIssue = (
              field,
              name,
              collection,
              key,
              label,
              ids,
            ) => {
              if (!name) return;
              const parts = String(name)
                .split(LIST_DELIMITER)
                .map((value) => value.trim())
                .filter(Boolean);
              const idParts = String(ids || "")
                .split(LIST_DELIMITER)
                .map((value) => value.trim());
              for (const [index, part] of parts.entries()) {
                const found = idParts[index]
                  ? collection.filter(
                      (item) =>
                        item[key] === idParts[index] &&
                        !item.archivedAt &&
                        normalizePortableMatchValue(item.name) ===
                          normalizePortableMatchValue(part),
                    )
                  : collection.filter(
                      (item) =>
                        normalizePortableMatchValue(item.name) ===
                          normalizePortableMatchValue(part) && !item.archivedAt,
                    );
                const candidatesForChoice =
                  idParts[index] && !found.length
                    ? collection.filter(
                        (item) =>
                          normalizePortableMatchValue(item.name) ===
                            normalizePortableMatchValue(part) &&
                          !item.archivedAt,
                      )
                    : found;
                if (found.length !== 1)
                  issues.push({
                    field,
                    referenceIndex: index,
                    referenceValue: part,
                    code: found.length
                      ? "ambiguous_reference"
                      : idParts[index]
                        ? "foreign_or_unknown_reference_id"
                        : candidatesForChoice.length
                          ? "ambiguous_reference"
                          : "missing_reference",
                    message:
                      found.length || candidatesForChoice.length > 1
                        ? `Choose which ${label} "${part}" to use.`
                        : idParts[index]
                          ? `This WorshipSync ${label} ID does not belong to this church.`
                          : `Import or map ${label} "${part}" before importing this member.`,
                    candidates: candidatesForChoice.map((item) => ({
                      id: item[key],
                      name: item.name,
                    })),
                  });
              }
            };
            const importedTeamNames = String(record.teams || "")
              .split(LIST_DELIMITER)
              .map((value) => normalizePortableMatchValue(value))
              .filter(Boolean);
            const matchedTeams = records.teams.filter(
              (item) =>
                !item.archivedAt &&
                importedTeamNames.includes(
                  normalizePortableMatchValue(item.name),
                ),
            );
            referenceIssue(
              "teams",
              record.teams,
              records.teams,
              "teamId",
              "team",
              record.teamIds,
            );
            const positionCandidates = matchedTeams.length
              ? records.positions.filter((item) =>
                  matchedTeams.some((team) => team.teamId === item.teamId),
                )
              : records.positions;
            referenceIssue(
              "positions",
              record.positions,
              positionCandidates,
              "positionId",
              "position",
              record.positionIds,
            );
          } else if (type === "teams") {
            if (!record.name)
              issues.push({
                field: "name",
                code: "required",
                message: "Team name is required.",
              });
            const found = findPortableMatch({
              records: records.teams,
              id: record.teamId,
              idField: "teamId",
              label: record.name,
              includeArchived: true,
            });
            match = found.record;
            candidates = found.foreignOrUnknownId
              ? records.teams.filter(
                  (item) =>
                    !item.archivedAt &&
                    normalizePortableMatchValue(item.name) ===
                      normalizePortableMatchValue(record.name),
                )
              : found.candidates || [];
            if (found.foreignOrUnknownId)
              issues.push({
                field: "teamId",
                code: "foreign_or_unknown_record_id",
                message:
                  "This WorshipSync Team ID does not belong to this church. Choose a local match explicitly or create a new team.",
                candidates: candidates.map((item) => ({
                  id: item.teamId,
                  name: item.name,
                })),
              });
          } else if (type === "positions") {
            if (!record.name || !record.team)
              issues.push({
                field: "team",
                code: "required",
                message: "Position and team are required.",
              });
            const localTeamIdMatch =
              record.teamId &&
              records.teams.find(
                (item) => !item.archivedAt && item.teamId === record.teamId,
              );
            const teamMatches = localTeamIdMatch
              ? [localTeamIdMatch]
              : record.teamId
                ? []
                : records.teams.filter(
                    (item) =>
                      !item.archivedAt &&
                      normalizePortableMatchValue(item.name) ===
                        normalizePortableMatchValue(record.team),
                  );
            if (teamMatches.length !== 1) {
              const choiceCandidates =
                record.teamId && !teamMatches.length
                  ? records.teams.filter(
                      (item) =>
                        !item.archivedAt &&
                        normalizePortableMatchValue(item.name) ===
                          normalizePortableMatchValue(record.team),
                    )
                  : teamMatches;
              const unknownTeamId = Boolean(record.teamId && !localTeamIdMatch);
              const code = unknownTeamId
                ? "foreign_or_unknown_reference_id"
                : choiceCandidates.length
                  ? "ambiguous_reference"
                  : "missing_reference";
              let message;
              if (unknownTeamId && choiceCandidates.length)
                message =
                  "This WorshipSync Team ID is not in this church. Choose which team owns this position.";
              else if (unknownTeamId)
                message = `This WorshipSync Team ID is not in this church, and team "${record.team || ""}" is unavailable. Import the team first.`;
              else if (choiceCandidates.length)
                message = "Choose which team owns this position.";
              else
                message = `Import or map team "${record.team || ""}" before importing this position.`;
              issues.push({
                field: "team",
                referenceIndex: 0,
                referenceValue: record.team,
                code,
                message,
                candidates: choiceCandidates.map((item) => ({
                  id: item.teamId,
                  name: item.name,
                })),
              });
            } else {
              const localPositionIdMatch =
                record.positionId &&
                records.positions.find(
                  (item) =>
                    item.teamId === teamMatches[0].teamId &&
                    item.positionId === record.positionId,
                );
              const matches = localPositionIdMatch
                ? [localPositionIdMatch]
                : record.positionId
                  ? []
                  : records.positions.filter(
                      (item) =>
                        item.teamId === teamMatches[0].teamId &&
                        normalizePortableMatchValue(item.name) ===
                          normalizePortableMatchValue(record.name),
                    );
              if (record.positionId && !localPositionIdMatch) {
                candidates = records.positions.filter(
                  (item) =>
                    !item.archivedAt &&
                    item.teamId === teamMatches[0].teamId &&
                    normalizePortableMatchValue(item.name) ===
                      normalizePortableMatchValue(record.name),
                );
                issues.push({
                  field: "positionId",
                  code: "foreign_or_unknown_record_id",
                  message:
                    "This WorshipSync Position ID does not identify an active position in the selected team. Choose a local match explicitly or create a new position.",
                  candidates: candidates.map((item) => ({
                    id: item.positionId,
                    name: item.name,
                  })),
                });
              }
              if (matches.length === 1) match = matches[0];
              else candidates = matches;
            }
          } else if (type === "services") {
            if (!record.name || !record.recurrence)
              issues.push({
                field: "name",
                code: "required",
                message: "Service name and recurrence are required.",
              });
            const serviceDateFields = record.recurrence === "one_time"
              ? [["date", record.date, "Date"]]
              : [["startDate", record.startDate, "Start Date"], ["endDate", record.endDate, "End Date"]];
            for (const [field, value, label] of serviceDateFields) {
              if ((!value && field === "date") || (value && !isValidPortablePlainDate(String(value)))) {
                issues.push({
                  field,
                  code: "invalid_value",
                  message: `${label} must be a real calendar date in YYYY-MM-DD format.`,
                });
              }
            }
            if (record.startDate && record.endDate
              && isValidPortablePlainDate(String(record.startDate))
              && isValidPortablePlainDate(String(record.endDate))
              && record.startDate > record.endDate) {
              issues.push({
                field: "endDate",
                code: "invalid_value",
                message: "End Date must be on or after Start Date.",
              });
            }
            const positionName = String(record.position || "").trim();
            if (positionName) {
              let positionMatches = record.positionId
                ? records.positions.filter(
                    (item) =>
                      !item.archivedAt && item.positionId === record.positionId,
                  )
                : records.positions.filter(
                    (item) =>
                      !item.archivedAt &&
                      normalizePortableMatchValue(item.name) ===
                        normalizePortableMatchValue(positionName),
                  );
              const unknownId = Boolean(
                record.positionId && !positionMatches.length,
              );
              if (unknownId)
                positionMatches = records.positions.filter(
                  (item) =>
                    !item.archivedAt &&
                    normalizePortableMatchValue(item.name) ===
                      normalizePortableMatchValue(positionName),
                );
              if (positionMatches.length !== 1 || unknownId)
                issues.push({
                  field: "position",
                  referenceIndex: 0,
                  referenceValue: positionName,
                  code: unknownId
                    ? "foreign_or_unknown_reference_id"
                    : positionMatches.length
                      ? "ambiguous_reference"
                      : "missing_reference",
                  message: unknownId
                    ? "This WorshipSync Position ID does not belong to this church. Choose a local position explicitly."
                    : positionMatches.length
                      ? `Choose which position "${positionName}" this service uses.`
                      : `Import or map position "${positionName}" before importing this service.`,
                  candidates: positionMatches.map((item) => ({
                    id: item.positionId,
                    name: item.name,
                  })),
                });
            }
            const importedId = String(record.serviceId || "").trim();
            const localIdMatch =
              importedId &&
              records.services.find(
                (item) => (item.serviceId || item.id) === importedId,
              );
            const serviceMatches = localIdMatch
              ? [localIdMatch]
              : importedId
                ? []
                : records.services.filter(
                    (item) =>
                      normalizePortableMatchValue(item.name) ===
                        normalizePortableMatchValue(record.name) &&
                      portableServiceMatches(item, record, records.services),
                  );
            if (importedId && !localIdMatch) {
              candidates = records.services.filter(
                (item) =>
                  !item.archivedAt &&
                  normalizePortableMatchValue(item.name) ===
                    normalizePortableMatchValue(record.name) &&
                  portableServiceMatches(item, record, records.services),
              );
              issues.push({
                field: "serviceId",
                code: "foreign_or_unknown_record_id",
                message:
                  "This WorshipSync Service ID does not belong to this church. Choose a local match explicitly or create a new service.",
                candidates: candidates.map((item) => ({
                  id: item.serviceId || item.id,
                  name: item.name,
                })),
              });
            }
            if (serviceMatches.length === 1) match = serviceMatches[0];
            else if (!importedId) candidates = serviceMatches;
          } else if (type === "schedules") {
            if (!record.name || !record.team || !record.date || !record.service)
              issues.push({
                field: "date",
                code: "required",
                message: "Schedule, team, service, and date are required.",
              });
            const localTeamIdMatch =
              record.teamId &&
              records.teams.find(
                (item) => !item.archivedAt && item.teamId === record.teamId,
              );
            const teamMatches = localTeamIdMatch
              ? [localTeamIdMatch]
              : record.teamId
                ? []
                : records.teams.filter(
                    (item) =>
                      !item.archivedAt &&
                      normalizePortableMatchValue(item.name) ===
                        normalizePortableMatchValue(record.team),
                  );
            const team = teamMatches.length === 1 ? teamMatches[0] : null;
            const candidateTeamIds = team
              ? [team.teamId]
              : record.teamId
                ? records.teams
                    .filter(
                      (item) =>
                        !item.archivedAt &&
                        normalizePortableMatchValue(item.name) ===
                          normalizePortableMatchValue(record.team),
                    )
                    .map((item) => item.teamId)
                : teamMatches.map((item) => item.teamId);
            if (!team) {
              const choiceCandidates =
                record.teamId && !teamMatches.length
                  ? records.teams.filter(
                      (item) =>
                        !item.archivedAt &&
                        normalizePortableMatchValue(item.name) ===
                          normalizePortableMatchValue(record.team),
                    )
                  : teamMatches;
              const unknownTeamId = Boolean(record.teamId && !localTeamIdMatch);
              const code = unknownTeamId
                ? "foreign_or_unknown_reference_id"
                : choiceCandidates.length
                  ? "ambiguous_reference"
                  : "missing_reference";
              let message;
              if (unknownTeamId && choiceCandidates.length)
                message = `This WorshipSync Team ID is not in this church. Choose which ${record.team} team to use.`;
              else if (unknownTeamId)
                message = `This WorshipSync Team ID is not in this church, and team "${record.team || ""}" is unavailable.`;
              else if (choiceCandidates.length)
                message = `Choose which ${record.team} team to use.`;
              else message = `Import or map team "${record.team || ""}" first.`;
              issues.push({
                field: "team",
                referenceIndex: 0,
                referenceValue: record.team,
                code,
                message,
                candidates: choiceCandidates.map((item) => ({
                  id: item.teamId,
                  name: item.name,
                })),
              });
            }
            const serviceNames = String(record.service || "")
              .split(LIST_DELIMITER)
              .map((name) => name.trim())
              .filter(Boolean);
            const serviceMatches = serviceNames.map((name) =>
              records.services.filter(
                (item) =>
                  !item.archivedAt &&
                  (record.serviceId && serviceNames.length === 1
                    ? (item.serviceId || item.id) === record.serviceId
                    : normalizePortableMatchValue(item.name) ===
                      normalizePortableMatchValue(name)),
              ),
            );
            if (
              record.serviceId &&
              serviceMatches.every((matches) => !matches.length)
            ) {
              const localByName = records.services.filter(
                (item) =>
                  !item.archivedAt &&
                  normalizePortableMatchValue(item.name) ===
                    normalizePortableMatchValue(serviceNames[0]),
              );
              issues.push({
                field: "serviceId",
                referenceIndex: 0,
                referenceValue: serviceNames[0],
                code: "foreign_or_unknown_reference_id",
                message:
                  "This WorshipSync Service ID does not belong to this church. Choose a local service explicitly.",
                candidates: localByName.map((item) => ({
                  id: item.serviceId || item.id,
                  name: item.name,
                })),
              });
              if (serviceNames.length === 1 && localByName.length)
                serviceMatches[0].push(...localByName);
            }
            serviceMatches.forEach((matches, index) => {
              if (
                matches.length !== 1 &&
                !(
                  record.serviceId &&
                  serviceNames.length === 1 &&
                  matches.length > 0
                )
              )
                issues.push({
                  field:
                    serviceNames.length === 1 ? "service" : `service${index}`,
                  referenceIndex: index,
                  referenceValue: serviceNames[index],
                  code: matches.length
                    ? "ambiguous_reference"
                    : "missing_reference",
                  message: matches.length
                    ? `Choose which ${serviceNames[index]} service to use.`
                    : `Import or map service "${serviceNames[index]}" first.`,
                  candidates: matches.map((item) => ({
                    id: item.serviceId || item.id,
                    name: item.name,
                  })),
                });
            });
            if (record.position) {
              const localPositionIdMatch =
                record.positionId &&
                records.positions.find(
                  (item) =>
                    !item.archivedAt &&
                    candidateTeamIds.includes(item.teamId) &&
                    item.positionId === record.positionId,
                );
              const positions = localPositionIdMatch
                ? [localPositionIdMatch]
                : record.positionId
                  ? []
                  : records.positions.filter(
                      (item) =>
                        !item.archivedAt &&
                        candidateTeamIds.includes(item.teamId) &&
                        normalizePortableMatchValue(item.name) ===
                          normalizePortableMatchValue(record.position),
                    );
              if (record.positionId && !localPositionIdMatch) {
                const localByName = records.positions.filter(
                  (item) =>
                    !item.archivedAt &&
                    candidateTeamIds.includes(item.teamId) &&
                    normalizePortableMatchValue(item.name) ===
                      normalizePortableMatchValue(record.position),
                );
                issues.push({
                  field: "position",
                  referenceIndex: 0,
                  referenceValue: record.position,
                  code: "foreign_or_unknown_reference_id",
                  message:
                    "This WorshipSync Position ID is not active within the selected team. Choose a local position explicitly.",
                  candidates: localByName.map((item) => ({
                    id: item.positionId,
                    name: item.name,
                  })),
                });
                if (localByName.length) positions.push(...localByName);
              }
              if (
                positions.length !== 1 &&
                !(
                  record.positionId &&
                  !localPositionIdMatch &&
                  positions.length > 0
                )
              )
                issues.push({
                  field: "position",
                  referenceIndex: 0,
                  referenceValue: record.position,
                  code: positions.length
                    ? "ambiguous_reference"
                    : "missing_reference",
                  message: positions.length
                    ? `Choose which ${record.position} position to use.`
                    : `Import or map position "${record.position}" first.`,
                  candidates: positions.map((item) => ({
                    id: item.positionId,
                    name: item.name,
                  })),
                });
            }
            const guest = String(record.guest || "").toLowerCase() === "true";
            if (record.person && !guest && candidateTeamIds.length) {
              const candidateMemberIds = new Set(
                records.teams
                  .filter((item) => candidateTeamIds.includes(item.teamId))
                  .flatMap((item) => item.memberIds || []),
              );
              const localMemberIdMatch =
                record.memberId &&
                records.members.find(
                  (item) =>
                    !item.archivedAt &&
                    candidateMemberIds.has(item.memberId) &&
                    item.memberId === record.memberId,
                );
              const people = localMemberIdMatch
                ? [localMemberIdMatch]
                : record.memberId
                  ? []
                  : records.members.filter(
                      (item) =>
                        !item.archivedAt &&
                        candidateMemberIds.has(item.memberId) &&
                        normalizePortableMatchValue(
                          [item.firstName, item.lastName]
                            .filter(Boolean)
                            .join(" "),
                        ) === normalizePortableMatchValue(record.person),
                    );
              if (record.memberId && !localMemberIdMatch) {
                const localByName = records.members.filter(
                  (item) =>
                    !item.archivedAt &&
                    candidateMemberIds.has(item.memberId) &&
                    normalizePortableMatchValue(
                      [item.firstName, item.lastName].filter(Boolean).join(" "),
                    ) === normalizePortableMatchValue(record.person),
                );
                issues.push({
                  field: "person",
                  referenceIndex: 0,
                  referenceValue: record.person,
                  code: "foreign_or_unknown_reference_id",
                  message:
                    "This WorshipSync Member ID is not active on the selected team. Choose a local member explicitly.",
                  candidates: localByName.map((item) => ({
                    id: item.memberId,
                    name: [item.firstName, item.lastName]
                      .filter(Boolean)
                      .join(" "),
                  })),
                });
                if (localByName.length) people.push(...localByName);
              }
              if (
                people.length !== 1 &&
                !(record.memberId && !localMemberIdMatch)
              )
                issues.push({
                  field: "person",
                  referenceIndex: 0,
                  referenceValue: record.person,
                  code: people.length
                    ? "ambiguous_reference"
                    : "missing_reference",
                  message: people.length
                    ? `Choose which ${record.person} member to use.`
                    : `Person "${record.person}" is not on this team. Import the member or mark this assignment as a guest.`,
                  candidates: people.map((item) => ({
                    id: item.memberId,
                    name: [item.firstName, item.lastName]
                      .filter(Boolean)
                      .join(" "),
                  })),
                });
            }
            const assignmentType = String(record.assignmentType || "primary")
              .toLowerCase()
              .replace(/[ -]/g, "_");
            if (
              record.person &&
              !["primary", "shadow", "reverse_shadow"].includes(assignmentType)
            )
              issues.push({
                field: "assignmentType",
                code: "invalid_value",
                message:
                  "Assignment type must be primary, shadow, or reverse_shadow.",
              });
            if (!/^\d{4}-\d{2}-\d{2}$/.test(String(record.date || "")))
              issues.push({
                field: "date",
                code: "invalid_value",
                message: "Use a date in YYYY-MM-DD format.",
              });
            const importedScheduleId = String(record.scheduleId || "").trim();
            const idMatch =
              importedScheduleId &&
              records.schedules.find(
                (item) => item.scheduleId === importedScheduleId,
              );
            const scheduleMatches = idMatch
              ? [idMatch]
              : records.schedules.filter(
                  (item) =>
                    !item.archivedAt &&
                    item.teamId === team?.teamId &&
                    normalizePortableMatchValue(item.name) ===
                      normalizePortableMatchValue(record.name) &&
                    String(item.startDate || "") ===
                      String(record.startDate || record.date || ""),
                );
            if (importedScheduleId && !idMatch)
              issues.push({
                field: "scheduleId",
                code: "foreign_or_unknown_record_id",
                message:
                  "This WorshipSync Schedule ID does not belong to this church. Choose a local schedule explicitly or create a new schedule.",
                candidates: scheduleMatches.map((item) => ({
                  id: item.scheduleId,
                  name: item.name,
                })),
              });
            if (
              scheduleMatches.length === 1 &&
              (!importedScheduleId || idMatch)
            )
              match = scheduleMatches[0];
            else if (
              scheduleMatches.length > 1 ||
              (importedScheduleId && !idMatch)
            )
              candidates = scheduleMatches;
          }
          if (String(record.archived || "").toLowerCase() === "true")
            issues.push({
              field: "archived",
              code: "archive_import_unsupported",
              message:
                "Archived rows are included in exports, but importing does not archive or restore records. Skip this row or clear the Archived value.",
            });
          if (match?.archivedAt)
            issues.push({
              field: "id",
              code: "archived_match",
              message:
                "This ID matches an archived record. Choose another row or skip it; imports do not restore archived records.",
            });
          const rowCandidates = candidates.map((item) => ({
            id:
              item.memberId ||
              item.scheduleId ||
              item.teamId ||
              item.positionId ||
              item.serviceId ||
              item.id,
            name:
              item.name ||
              [item.firstName, item.lastName].filter(Boolean).join(" "),
          }));
          const action = classifyPortablePreviewAction({
            issues,
            match,
            candidates: rowCandidates,
          });
          return {
            row,
            record,
            action,
            matchedId: match
              ? match.scheduleId ||
                match.memberId ||
                match.teamId ||
                match.positionId ||
                match.serviceId ||
                match.id
              : null,
            candidates: rowCandidates,
            issues,
          };
        });
        const representedRows = new Set(rows.map((row) => row.row));
        parsed.issues.forEach((issue) => {
          if (issue.row > 1 && !representedRows.has(issue.row)) {
            rows.push({
              row: issue.row,
              record: {},
              action: "invalid",
              matchedId: null,
              candidates: [],
              issues: [
                { field: "csv", code: issue.code, message: issue.message },
              ],
            });
            representedRows.add(issue.row);
          }
        });
        rows.sort((left, right) => left.row - right.row);
        return res.json({
          success: true,
          rows,
          issues: parsed.issues,
          summary: {
            total: parsed.totalRows,
            create: rows.filter((item) => item.action === "create").length,
            update: rows.filter((item) => item.action === "update").length,
            review: rows.filter((item) => item.action === "review").length,
            invalid: rows.filter((item) => item.action === "invalid").length,
          },
        });
      } catch (error) {
        return dataTransferError(
          res,
          error,
          "Could not validate this CSV. Check the file and try again.",
        );
      }
    },
    async commitPortableImport(req, res) {
      try {
        await assertCsrf(req);
        const churchId = String(req.params.churchId || "").trim();
        const admin = await requireAdminSession(req, churchId);
        const type = String(req.body?.type || "")
          .trim()
          .toLowerCase();
        if (!Object.hasOwn(PORTABLE_SCHEMAS, type))
          throw httpError(400, "Choose a supported data type.");
        const approvedRows = Array.isArray(req.body?.approvedRows)
          ? req.body.approvedRows
          : [];
        if (!approvedRows.length || approvedRows.length > 2000)
          throw httpError(400, "Choose up to 2,000 valid rows to import.");
        const stablePortableValue = (value) => {
          if (Array.isArray(value)) return value.map(stablePortableValue);
          if (value && typeof value === "object")
            return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stablePortableValue(value[key])]));
          return value;
        };
        const createBatchIdentity = crypto.createHash("sha256")
          .update(JSON.stringify(stablePortableValue([churchId, type, approvedRows])))
          .digest("hex");
        const portableCreateKey = (approved) => {
          const record = approved.record && typeof approved.record === "object"
            ? approved.record
            : {};
          let identity;
          if (type === "teams") {
            identity = ["team", normalizePortableMatchValue(record.name)];
          } else if (type === "positions") {
            identity = [
              "position",
              String(record.teamId || approved.resolutions?.teamId || "").trim() || normalizePortableMatchValue(record.team),
              normalizePortableMatchValue(record.name),
            ];
          } else if (type === "members") {
            // Only identical imported member rows coalesce. Names and emails
            // alone are not global identity keys; shared email is supported.
            const hasContact = Boolean(
              normalizePortableMatchValue(record.email)
              || String(record.phone || "").replace(/\D/g, ""),
            );
            identity = hasContact
              ? ["member", stablePortableValue(record), stablePortableValue(approved.resolutions || {})]
              : ["member-row", Number(approved.row)];
          } else {
            identity = [type, Number(approved.row)];
          }
          return crypto.createHash("sha256")
            .update(`${createBatchIdentity}:${JSON.stringify(identity)}`)
            .digest("hex");
        };
        const data = await readPortableDatasets(churchId);
        const results = [];
        const replaceDatasetEntity = (key, idField, saved) => {
          const index = data[key].findIndex((item) => item[idField] === saved[idField]);
          if (index < 0) data[key].push(saved);
          else data[key][index] = saved;
        };
        if (type === "services") {
          const groups = new Map();
          approvedRows.forEach((approved) => {
            const record = approved.record || {};
            const key = JSON.stringify([
              approved.recordId || record.serviceId || "",
              record.name || "",
              record.recurrence || "",
              record.time || "",
              record.date || "",
              record.daysOfWeek || "",
              record.startDate || "",
              record.endDate || "",
              record.weekOrdinal || "",
              record.weekday || "",
              record.combinedGroup || "",
              record.archived || "",
            ]);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(approved);
          });
          const dayNumber = (value) => {
            const index = [
              "sunday",
              "monday",
              "tuesday",
              "wednesday",
              "thursday",
              "friday",
              "saturday",
            ].indexOf(normalizePortableMatchValue(value));
            return index >= 0 ? index : Number(value);
          };
          for (const groupRows of groups.values()) {
            const rowNumbers = groupRows.map((item) => Number(item.row));
            try {
              const records = groupRows.map((item) => {
                const record = { ...(item.record || {}) };
                const selectedPosition = portableResolutionId(
                  item,
                  "position",
                  0,
                );
                if (selectedPosition)
                  record.positionId = String(selectedPosition);
                return record;
              });
              const first = records[0];
              const importedId = String(groupRows[0].recordId || "").trim();
              const existing = importedId
                ? data.services.find(
                    (item) =>
                      (item.serviceId || item.id) === importedId &&
                      !item.archivedAt,
                  )
                : null;
              if (importedId && !existing)
                throw httpError(
                  400,
                  "Service ID is missing from this church or archived.",
                );
              if ((groupRows[0].action === "update") !== Boolean(existing))
                throw httpError(
                  409,
                  "This service no longer matches the preview. Preview the file again.",
                );
              const recurrence = String(first.recurrence || "").trim();
              if (
                !["one_time", "weekly", "monthly", "multi_weekly"].includes(
                  recurrence,
                )
              )
                throw httpError(400, "Choose a supported service recurrence.");
              const requirements = [];
              for (const record of records) {
                const positionName = String(record.position || "").trim();
                if (!positionName) continue;
                const matches = data.positions.filter(
                  (position) =>
                    !position.archivedAt &&
                    (record.positionId
                      ? position.positionId === record.positionId &&
                        normalizePortableMatchValue(position.name) ===
                          normalizePortableMatchValue(positionName)
                      : normalizePortableMatchValue(position.name) ===
                        normalizePortableMatchValue(positionName)),
                );
                if (matches.length !== 1)
                  throw httpError(
                    400,
                    `Position "${positionName}" is missing or ambiguous. Import positions first.`,
                  );
                const count = Math.max(
                  1,
                  Math.floor(Number(record.requiredSlots) || 1),
                );
                const previous = requirements.find(
                  (requirement) =>
                    requirement.positionId === matches[0].positionId,
                );
                if (previous) previous.count = count;
                else
                  requirements.push({
                    positionId: matches[0].positionId,
                    count,
                  });
              }
              const time = String(first.time || "");
              if (
                recurrence !== "one_time" &&
                recurrence !== "multi_weekly" &&
                !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)
              )
                throw httpError(400, "Enter the service time as HH:mm.");
              const weekday = dayNumber(first.weekday);
              if (
                (recurrence === "weekly" || recurrence === "monthly") &&
                (!Number.isInteger(weekday) || weekday < 0 || weekday > 6)
              )
                throw httpError(
                  400,
                  "Choose a valid weekday for this service.",
                );
              const daysOfWeek =
                recurrence === "multi_weekly"
                  ? String(first.daysOfWeek || "")
                      .split(LIST_DELIMITER)
                      .filter(Boolean)
                      .map((entry) => {
                        const [day, dayTime] = entry.split("@");
                        return { day: dayNumber(day), time: dayTime };
                      })
                  : undefined;
              if (
                recurrence === "multi_weekly" &&
                (!daysOfWeek?.length ||
                  daysOfWeek.some(
                    (entry) =>
                      !Number.isInteger(entry.day) ||
                      entry.day < 0 ||
                      entry.day > 6 ||
                      !/^([01]\d|2[0-3]):[0-5]\d$/.test(entry.time),
                  ))
              )
                throw httpError(
                  400,
                  "Add at least one valid weekday and time for this multi-day service.",
                );
              const serviceDate = recurrence === "one_time"
                ? assertPlainDate(first.date, "Service date")
                : "";
              const startDate = recurrence !== "one_time" && first.startDate
                ? assertPlainDate(first.startDate, "Service start date")
                : "";
              const endDate = recurrence !== "one_time" && first.endDate
                ? assertPlainDate(first.endDate, "Service end date")
                : "";
              if (startDate && endDate && startDate > endDate)
                throw httpError(400, "Service start date must be on or before its end date.");
              if (
                recurrence === "monthly" &&
                (!Number.isInteger(Number(first.weekOrdinal)) ||
                  Number(first.weekOrdinal) < 1 ||
                  Number(first.weekOrdinal) > 5)
              )
                throw httpError(
                  400,
                  "Choose a valid week ordinal for this monthly service.",
                );
              const id =
                existing?.serviceId || existing?.id || createId("service");
              const existingWithoutGroup = { ...(existing || {}) };
              delete existingWithoutGroup.serviceGroupId;
              const combinedGroupLabel = String(
                first.combinedGroup || "",
              ).trim();
              const serviceGroupId = combinedGroupLabel
                ? `transfer_${crypto.createHash("sha256").update(normalizePortableMatchValue(combinedGroupLabel)).digest("hex").slice(0, 32)}`
                : undefined;
              const nextService = {
                ...existingWithoutGroup,
                id,
                serviceId: id,
                churchId,
                name: String(first.name || "").trim(),
                timerType: "countdown",
                reccurence: recurrence,
                ...(serviceGroupId ? { serviceGroupId } : {}),
                ...(time ? { time } : {}),
                ...(recurrence === "one_time"
                  ? {
                      dateTimeISO: `${serviceDate}T${String(time || "10:00")}:00`,
                    }
                  : {}),
                ...(recurrence === "multi_weekly" ? { daysOfWeek } : {}),
                ...(recurrence === "weekly" ? { dayOfWeek: weekday } : {}),
                ...(recurrence === "monthly"
                  ? { ordinal: Number(first.weekOrdinal), weekday }
                  : {}),
                ...(startDate ? { startDateISO: startDate } : {}),
                ...(endDate ? { endDateISO: endDate } : {}),
                positionRequirements: requirements,
                updatedAt: nowIso(),
              };
              if (!nextService.name)
                throw httpError(400, "Service name is required.");
              await updateChurchServiceTimes(churchId, (current) => {
                const found = current.findIndex(
                  (item) => (item.serviceId || item.id) === id,
                );
                if (found < 0) return [...current, nextService];
                const updated = [...current];
                updated[found] = { ...updated[found], ...nextService };
                if (!serviceGroupId) delete updated[found].serviceGroupId;
                return updated;
              });
              rowNumbers.forEach((row) =>
                results.push({
                  row,
                  status: existing ? "updated" : "created",
                  id,
                }),
              );
            } catch (error) {
              rowNumbers.forEach((row) =>
                results.push({
                  row,
                  status: "failed",
                  code:
                    error?.statusCode === 409 ||
                    groupRows.some(
                      (item) => Object.keys(item.resolutions || {}).length,
                    )
                      ? "stale_preview"
                      : "row_invalid",
                  message: error?.message || "Could not import this service.",
                }),
              );
            }
          }
          return res.json({
            success: true,
            results,
            summary: {
              created: results.filter((item) => item.status === "created")
                .length,
              updated: results.filter((item) => item.status === "updated")
                .length,
              failed: results.filter((item) => item.status === "failed").length,
            },
          });
        }
        if (type === "schedules") {
          const groups = new Map();
          approvedRows.forEach((approved) => {
            const record =
              approved.record && typeof approved.record === "object"
                ? approved.record
                : {};
            const groupKey = JSON.stringify([
              approved.recordId || record.scheduleId || "",
              record.name || "",
              record.teamId || record.team || "",
              record.startDate || "",
              record.endDate || "",
            ]);
            if (!groups.has(groupKey)) groups.set(groupKey, []);
            groups.get(groupKey).push(approved);
          });
          for (const groupRows of groups.values()) {
            const rowNumbers = groupRows.map((item) => Number(item.row));
            try {
              const records = groupRows.map((item) => {
                const record = { ...(item.record || {}) };
                const selectedTeam =
                  portableResolutionId(item, "team", 0) ||
                  portableResolutionId(item, "teamId", 0);
                const selectedPosition =
                  portableResolutionId(item, "position", 0) ||
                  portableResolutionId(item, "positionId", 0);
                const selectedPerson =
                  portableResolutionId(item, "person", 0) ||
                  portableResolutionId(item, "memberId", 0);
                if (selectedTeam) record.teamId = String(selectedTeam);
                if (selectedPosition)
                  record.positionId = String(selectedPosition);
                if (selectedPerson) record.memberId = String(selectedPerson);
                const serviceNames = String(record.service || "")
                  .split(LIST_DELIMITER)
                  .map((name) => name.trim())
                  .filter(Boolean);
                const serviceIds = serviceNames.map(
                  (_, index) =>
                    portableResolutionId(
                      item,
                      serviceNames.length === 1 ? "service" : `service${index}`,
                      index,
                    ) || portableResolutionId(item, "serviceId", index),
                );
                if (serviceIds.some(Boolean))
                  record.resolvedServiceIds = serviceIds.join(LIST_DELIMITER);
                return record;
              });
              const first = records[0];
              const localTeam =
                first.teamId &&
                data.teams.find(
                  (item) =>
                    !item.archivedAt &&
                    item.teamId === first.teamId &&
                    normalizePortableMatchValue(item.name) ===
                      normalizePortableMatchValue(first.team),
                );
              if (first.teamId && !localTeam)
                throw httpError(
                  409,
                  "The selected team is no longer active in this church. Preview the file again.",
                );
              const teamMatches = localTeam
                ? [localTeam]
                : data.teams.filter(
                    (item) =>
                      !item.archivedAt &&
                      normalizePortableMatchValue(item.name) ===
                        normalizePortableMatchValue(first.team),
                  );
              if (teamMatches.length !== 1)
                throw httpError(
                  400,
                  `Team "${first.team || ""}" is missing or ambiguous. Import and resolve teams first.`,
                );
              const team = teamMatches[0];
              const importedScheduleId = String(
                groupRows[0].recordId || "",
              ).trim();
              const existing = importedScheduleId
                ? data.schedules.find(
                    (item) =>
                      item.scheduleId === importedScheduleId &&
                      !item.archivedAt,
                  )
                : null;
              if (importedScheduleId && !existing)
                throw httpError(
                  409,
                  "The selected schedule is no longer active in this church. Preview the file again.",
                );
              const existingByName = data.schedules.filter(
                (item) =>
                  !item.archivedAt &&
                  item.teamId === team.teamId &&
                  normalizePortableMatchValue(item.name) ===
                    normalizePortableMatchValue(first.name) &&
                  String(item.startDate || "") ===
                    String(first.startDate || first.date || ""),
              );
              if (!existing && existingByName.length)
                throw httpError(
                  409,
                  "A schedule with this name and date range already exists. Add its WorshipSync Schedule ID or skip these rows.",
                );
              const occurrencesByKey = new Map();
              const importedGuests = [];
              let assignmentsByOccurrence = JSON.parse(
                JSON.stringify(existing?.assignments || {}),
              );
              let additionalByOccurrence = JSON.parse(
                JSON.stringify(existing?.additionalPositionSlots || {}),
              );
              for (const record of records) {
                const date = String(record.date || "").slice(0, 10);
                const serviceNames = String(record.service || "")
                  .split(LIST_DELIMITER)
                  .map((name) => name.trim())
                  .filter(Boolean);
                if (!date || !serviceNames.length)
                  throw httpError(
                    400,
                    "Schedule rows need a service name and date.",
                  );
                const resolvedServiceIds = String(
                  record.resolvedServiceIds || "",
                )
                  .split(LIST_DELIMITER)
                  .map((value) => value.trim());
                const services = serviceNames.map((name, index) => {
                  const serviceId =
                    resolvedServiceIds[index] ||
                    (serviceNames.length === 1
                      ? String(record.serviceId || "").trim()
                      : "");
                  const idMatch =
                    serviceId &&
                    data.services.find(
                      (service) =>
                        !service.archivedAt &&
                        (service.serviceId || service.id) === serviceId &&
                        normalizePortableMatchValue(service.name) ===
                          normalizePortableMatchValue(name),
                    );
                  if (serviceId && !idMatch)
                    throw httpError(
                      409,
                      "The selected service is no longer active in this church. Preview the file again.",
                    );
                  const matches = idMatch
                    ? [idMatch]
                    : data.services.filter(
                        (service) =>
                          !service.archivedAt &&
                          normalizePortableMatchValue(service.name) ===
                            normalizePortableMatchValue(name),
                      );
                  if (matches.length !== 1)
                    throw httpError(
                      400,
                      `Service "${name}" is missing or ambiguous.`,
                    );
                  return matches[0];
                });
                const serviceIds = services.map(
                  (service) => service.serviceId || service.id,
                );
                if (
                  serviceIds.length > 1 &&
                  (!services[0].serviceGroupId ||
                    services.some(
                      (service) =>
                        service.serviceGroupId !== services[0].serviceGroupId,
                    ))
                )
                  throw httpError(
                    400,
                    "Combined services must share one service group before they can share an occurrence.",
                  );
                const startTime = String(
                  record.startTime || services[0].time || "10:00",
                );
                if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime))
                  throw httpError(
                    400,
                    "Use a valid 24-hour start time, such as 10:30.",
                  );
                const timeZone = String(req.body?.timeZone || "UTC").trim();
                const startsAt = portableWallClockToIso(
                  date,
                  startTime,
                  timeZone,
                );
                if (!startsAt)
                  throw httpError(
                    400,
                    "Use a valid service date, time, and time zone.",
                  );
                const priorOccurrence = existing?.occurrences?.find(
                  (item) =>
                    item.occurrenceId === record.occurrenceId &&
                    String(item.startsAt || "").slice(0, 10) === date,
                );
                const occurrenceId = String(
                  priorOccurrence?.occurrenceId ||
                    (serviceIds.length > 1
                      ? `group:${services[0].serviceGroupId}@${date}`
                      : `${serviceIds[0]}@${startsAt}`),
                );
                const occurrenceKey = `${date}\u0000${startTime}\u0000${serviceIds.join(",")}`;
                if (!occurrencesByKey.has(occurrenceKey)) {
                  const requirementMap = new Map();
                  services.forEach((service) =>
                    (service.positionRequirements || []).forEach(
                      ({ positionId, count }) =>
                        requirementMap.set(
                          positionId,
                          Math.max(
                            requirementMap.get(positionId) || 0,
                            Number(count) || 0,
                          ),
                        ),
                    ),
                  );
                  occurrencesByKey.set(occurrenceKey, {
                    occurrenceId,
                    serviceId: serviceIds[0],
                    ...(serviceIds.length > 1
                      ? { groupId: services[0].serviceGroupId }
                      : {}),
                    ...(serviceIds.length > 1 ? { serviceIds } : {}),
                    name: services.map((service) => service.name).join(" + "),
                    startsAt,
                    positionRequirements: [...requirementMap].map(
                      ([positionId, count]) => ({ positionId, count }),
                    ),
                  });
                }
                const occurrence = occurrencesByKey.get(occurrenceKey);
                const positionName = String(record.position || "").trim();
                const localPosition =
                  record.positionId &&
                  data.positions.find(
                    (position) =>
                      !position.archivedAt &&
                      position.teamId === team.teamId &&
                      position.positionId === record.positionId &&
                      normalizePortableMatchValue(position.name) ===
                        normalizePortableMatchValue(positionName),
                  );
                if (record.positionId && !localPosition)
                  throw httpError(
                    409,
                    "The selected position is no longer active on this team. Preview the file again.",
                  );
                const positionMatches = positionName
                  ? localPosition
                    ? [localPosition]
                    : data.positions.filter(
                        (position) =>
                          !position.archivedAt &&
                          position.teamId === team.teamId &&
                          normalizePortableMatchValue(position.name) ===
                            normalizePortableMatchValue(positionName),
                      )
                  : [];
                if (positionName && positionMatches.length !== 1)
                  throw httpError(
                    400,
                    `Position "${positionName}" is missing or ambiguous within ${team.name}.`,
                  );
                const slot = Math.max(1, Number(record.slot) || 1) - 1;
                if (positionMatches.length) {
                  const position = positionMatches[0];
                  const key = `${position.positionId}::${slot}`;
                  const coreCount = Math.max(
                    0,
                    Number(
                      occurrence.positionRequirements?.find(
                        (item) => item.positionId === position.positionId,
                      )?.count,
                    ) || 0,
                  );
                  if (slot >= coreCount)
                    additionalByOccurrence[occurrence.occurrenceId] = [
                      ...new Set([
                        ...(additionalByOccurrence[occurrence.occurrenceId] ||
                          []),
                        key,
                      ]),
                    ];
                  const assignmentType = String(
                    record.assignmentType || "primary",
                  )
                    .toLowerCase()
                    .replace(/[ -]/g, "_");
                  const guest =
                    record.guest === true ||
                    String(record.guest).toLowerCase() === "true";
                  const personName = String(record.person || "").trim();
                  if (personName) {
                    let member = null;
                    let memberId = String(record.memberId || "").trim();
                    if (memberId)
                      member =
                        data.members.find(
                          (item) =>
                            item.memberId === memberId &&
                            !item.archivedAt &&
                            (team.memberIds || []).includes(item.memberId) &&
                            normalizePortableMatchValue(
                              [item.firstName, item.lastName]
                                .filter(Boolean)
                                .join(" "),
                            ) === normalizePortableMatchValue(personName),
                        ) || null;
                    if (memberId && !member && !guest)
                      throw httpError(
                        409,
                        "The selected member is no longer active in this church. Preview the file again.",
                      );
                    if ((!memberId || (!member && !guest)) && !guest) {
                      const parts = personName.split(/\s+/);
                      const matches = data.members.filter(
                        (item) =>
                          !item.archivedAt &&
                          (team.memberIds || []).includes(item.memberId) &&
                          normalizePortableMatchValue(
                            [item.firstName, item.lastName]
                              .filter(Boolean)
                              .join(" "),
                          ) === normalizePortableMatchValue(personName),
                      );
                      if (matches.length !== 1)
                        throw httpError(
                          400,
                          `Person "${personName}" is missing or ambiguous on ${team.name}.`,
                        );
                      member = matches[0];
                      memberId = member.memberId;
                    }
                    if (guest) {
                      const guestEmail = String(record.email || "")
                        .trim()
                        .toLowerCase();
                      const priorGuests = [
                        ...(existing?.guests || []),
                        ...importedGuests,
                      ];
                      const prior = priorGuests.find(
                        (item) =>
                          (guestEmail &&
                            String(item.email || "")
                              .trim()
                              .toLowerCase() === guestEmail) ||
                          normalizePortableMatchValue(item.name) ===
                            normalizePortableMatchValue(personName),
                      );
                      const guestId = prior?.guestId || createId("guest");
                      if (!prior)
                        importedGuests.push({
                          guestId,
                          name: personName,
                          ...(record.email
                            ? { email: String(record.email) }
                            : {}),
                        });
                      memberId = guestId;
                    } else if (!member)
                      throw httpError(
                        400,
                        `Member "${personName}" was not found in this church.`,
                      );
                    const scheduleDraft = {
                      ...(existing || {}),
                      churchId,
                      teamId: team.teamId,
                      serviceIds: [
                        ...new Set([
                          ...(existing?.serviceIds || []),
                          ...Array.from(occurrencesByKey.values()).flatMap(
                            (item) => [
                              item.serviceId,
                              ...(item.serviceIds || []),
                            ],
                          ),
                        ]),
                      ],
                      occurrences: [
                        ...(existing?.occurrences || []),
                        ...Array.from(occurrencesByKey.values()),
                      ],
                      assignments: assignmentsByOccurrence,
                      additionalPositionSlots: additionalByOccurrence,
                      guests: [...(existing?.guests || []), ...importedGuests],
                    };
                    const existingCell = normalizeScheduleAssignmentCell(
                      assignmentsByOccurrence[occurrence.occurrenceId]?.[key],
                    );
                    if (
                      assignmentType === "primary" &&
                      existingCell.primaryMemberId === memberId
                    )
                      continue;
                    if (
                      (assignmentType === "shadow" ||
                        assignmentType === "reverse_shadow") &&
                      existingCell.shadows.some(
                        (shadow) =>
                          shadow.memberId === memberId &&
                          shadow.kind === assignmentType,
                      )
                    )
                      continue;
                    if (
                      assignmentType === "primary" &&
                      existingCell.primaryMemberId &&
                      existingCell.primaryMemberId !== memberId
                    ) {
                      const clearedAssignments = JSON.parse(
                        JSON.stringify(assignmentsByOccurrence),
                      );
                      const clearedCell = serializeScheduleAssignmentCell({
                        primaryMemberId: "",
                        shadows: existingCell.shadows,
                      });
                      if (clearedCell)
                        clearedAssignments[occurrence.occurrenceId][key] =
                          clearedCell;
                      else
                        delete clearedAssignments[occurrence.occurrenceId][key];
                      assignmentsByOccurrence = clearedAssignments;
                    }
                    let validated;
                    if (
                      assignmentType === "shadow" ||
                      assignmentType === "reverse_shadow"
                    ) {
                      if (!member)
                        throw httpError(
                          400,
                          "Guests can only be imported as primary assignments.",
                        );
                      validated = await buildValidatedScheduleAssignments({
                        churchId,
                        schedule: scheduleDraft,
                        team,
                        position,
                        member,
                        serviceId: occurrence.occurrenceId,
                        positionSlotKey: key,
                        memberId,
                        shadowAction: "add",
                        shadowKind: assignmentType,
                        allowBlockout: false,
                        allowRecurringAvailability: false,
                        allowOccurrenceConflict: false,
                      });
                    } else if (
                      assignmentType === "primary" ||
                      assignmentType === ""
                    ) {
                      validated = await buildValidatedScheduleAssignments({
                        churchId,
                        schedule: scheduleDraft,
                        team,
                        position,
                        member,
                        serviceId: occurrence.occurrenceId,
                        positionSlotKey: key,
                        memberId,
                        serviceDate: date,
                        allowBlockout: false,
                        allowRecurringAvailability: false,
                        allowOccurrenceConflict: false,
                        guestAssignment: guest,
                      });
                    } else
                      throw httpError(
                        400,
                        `Assignment type "${record.assignmentType}" is not supported.`,
                      );
                    assignmentsByOccurrence = validated;
                  }
                }
              }
              const allOccurrences = [
                ...(existing?.occurrences || []),
                ...Array.from(occurrencesByKey.values()),
              ].filter(
                (occurrence, index, list) =>
                  list.findIndex(
                    (item) => item.occurrenceId === occurrence.occurrenceId,
                  ) === index,
              );
              const serviceIds = [
                ...new Set([
                  ...(existing?.serviceIds || []),
                  ...allOccurrences.flatMap((occurrence) => [
                    occurrence.serviceId,
                    ...(occurrence.serviceIds || []),
                  ]),
                ]),
              ];
              const allAssignments = {
                ...(existing?.assignments || {}),
                ...assignmentsByOccurrence,
              };
              const allAdditional = {
                ...(existing?.additionalPositionSlots || {}),
                ...additionalByOccurrence,
              };
              const startDate = String(
                first.startDate ||
                  existing?.startDate ||
                  records.map((item) => item.date).sort()[0] ||
                  "",
              ).slice(0, 10);
              const endDate = String(
                first.endDate ||
                  existing?.endDate ||
                  records
                    .map((item) => item.date)
                    .sort()
                    .at(-1) ||
                  "",
              ).slice(0, 10);
              const payload = await validateTeamSchedulePayload(
                {
                  ...(existing || {}),
                  name: first.name,
                  teamId: team.teamId,
                  startDate,
                  endDate,
                  serviceIds,
                  occurrences: allOccurrences,
                  assignments: allAssignments,
                  additionalPositionSlots: allAdditional,
                  guests: [...(existing?.guests || []), ...importedGuests],
                },
                churchId,
                existing,
              );
              const allSchedules = data.schedules;
              assertNoCrossTeamScheduleAssignmentConflicts({
                schedule: {
                  churchId,
                  scheduleId: existing?.scheduleId || "portable-import",
                  ...payload,
                },
                assignments: payload.assignments,
                schedules: allSchedules,
                confirmedFingerprint: "",
              });
              let saved;
              if (!existing) {
                saved = await upsertTeamEntity({
                  kind: "schedule",
                  churchId,
                  payload,
                  adminUserId: admin.user.uid,
                });
              } else {
                const changedCells = [];
                Object.entries(assignmentsByOccurrence).forEach(
                  ([occurrenceId, row]) => {
                    Object.entries(row || {}).forEach(([cellKey, cell]) => {
                      const before =
                        existing.assignments?.[occurrenceId]?.[cellKey];
                      if (JSON.stringify(before) !== JSON.stringify(cell))
                        changedCells.push({
                          occurrenceId,
                          cellKey,
                          before,
                          cell,
                        });
                    });
                  },
                );
                const mergeUpdate = (current) => {
                  if (
                    !current ||
                    current.churchId !== churchId ||
                    current.archivedAt
                  )
                    throw httpError(
                      409,
                      "This schedule is no longer available. Preview the file again.",
                    );
                  if (
                    current.teamId !== team.teamId ||
                    current.name !== existing.name
                  )
                    throw httpError(
                      409,
                      "This schedule changed while the import was being reviewed. Preview the file again.",
                    );
                  const assignments = JSON.parse(
                    JSON.stringify(current.assignments || {}),
                  );
                  changedCells.forEach(
                    ({ occurrenceId, cellKey, before, cell }) => {
                      const latest = assignments[occurrenceId]?.[cellKey];
                      if (JSON.stringify(latest) !== JSON.stringify(before))
                        throw httpError(
                          409,
                          "A schedule slot changed while the import was being reviewed. Preview the file again.",
                        );
                      if (!assignments[occurrenceId])
                        assignments[occurrenceId] = {};
                      assignments[occurrenceId][cellKey] = cell;
                    },
                  );
                  const occurrences = [...(current.occurrences || [])];
                  const occurrenceIds = new Set(
                    occurrences.map((item) => item.occurrenceId),
                  );
                  Array.from(occurrencesByKey.values()).forEach(
                    (occurrence) => {
                      if (!occurrenceIds.has(occurrence.occurrenceId))
                        occurrences.push(occurrence);
                    },
                  );
                  const additionalPositionSlots = JSON.parse(
                    JSON.stringify(current.additionalPositionSlots || {}),
                  );
                  Object.entries(additionalByOccurrence).forEach(
                    ([occurrenceId, slots]) => {
                      additionalPositionSlots[occurrenceId] = [
                        ...new Set([
                          ...(additionalPositionSlots[occurrenceId] || []),
                          ...slots,
                        ]),
                      ];
                    },
                  );
                  const guests = [...(current.guests || [])];
                  const guestIds = new Set(
                    guests.map((guest) => guest.guestId),
                  );
                  importedGuests.forEach((guest) => {
                    if (!guestIds.has(guest.guestId)) guests.push(guest);
                  });
                  return {
                    ...current,
                    name: payload.name,
                    serviceIds: [
                      ...new Set([
                        ...(current.serviceIds || []),
                        ...payload.serviceIds,
                      ]),
                    ],
                    startDate: [current.startDate, payload.startDate]
                      .filter(Boolean)
                      .sort()[0],
                    endDate: [current.endDate, payload.endDate]
                      .filter(Boolean)
                      .sort()
                      .at(-1),
                    occurrences,
                    assignments,
                    additionalPositionSlots,
                    guests,
                    updatedAt: nowIso(),
                    updatedByUid: admin.user.uid,
                  };
                };
                const db = requireFirestore();
                if (db) {
                  const reference = db
                    .collection(COLLECTIONS.teamSchedules)
                    .doc(existing.scheduleId);
                  await db.runTransaction(async (transaction) => {
                    const snapshot = await transaction.get(reference);
                    const current = snapshot.exists
                      ? { scheduleId: snapshot.id, ...snapshot.data() }
                      : null;
                    if (!current)
                      throw httpError(
                        409,
                        "This schedule is no longer available. Preview the file again.",
                      );
                    transaction.set(reference, mergeUpdate(current), {
                      merge: false,
                    });
                  });
                  const current = await getDoc(
                    COLLECTIONS.teamSchedules,
                    existing.scheduleId,
                  );
                  saved = { scheduleId: existing.scheduleId, ...current };
                } else {
                  const updated = await enqueueInMemoryScheduleSave(
                    existing.scheduleId,
                    async () => {
                      const current = await getDoc(
                        COLLECTIONS.teamSchedules,
                        existing.scheduleId,
                      );
                      const next = mergeUpdate(current);
                      await setDoc(
                        COLLECTIONS.teamSchedules,
                        existing.scheduleId,
                        next,
                        { merge: false },
                      );
                      return next;
                    },
                  );
                  saved = { scheduleId: existing.scheduleId, ...updated };
                }
                saved = await syncScheduleResponsesToAssignments(saved);
              }
              emitTeamsEvent(churchId, "schedule-updated", { schedule: saved });
              rowNumbers.forEach((row) =>
                results.push({
                  row,
                  status: existing ? "updated" : "created",
                  id: saved.scheduleId,
                }),
              );
            } catch (error) {
              rowNumbers.forEach((row) =>
                results.push({
                  row,
                  status: "failed",
                  code:
                    error?.statusCode === 409 ||
                    groupRows.some(
                      (item) => Object.keys(item.resolutions || {}).length,
                    )
                      ? "stale_preview"
                      : "row_invalid",
                  message: error?.message || "Could not import this schedule.",
                }),
              );
            }
          }
          return res.json({
            success: true,
            results,
            summary: {
              created: results.filter((item) => item.status === "created")
                .length,
              updated: results.filter((item) => item.status === "updated")
                .length,
              failed: results.filter((item) => item.status === "failed").length,
            },
          });
        }
        for (const approved of approvedRows) {
          const row = Number(approved.row);
          const record =
            approved.record && typeof approved.record === "object"
              ? { ...approved.record }
              : {};
          const resolutions =
            approved.resolutions && typeof approved.resolutions === "object"
              ? approved.resolutions
              : [];
          const selectedTeam =
            portableResolutionId(approved, "team", 0) ||
            portableResolutionId(approved, "teamId", 0);
          const selectedPosition =
            portableResolutionId(approved, "position", 0) ||
            portableResolutionId(approved, "positionId", 0);
          if (selectedTeam) record.teamId = String(selectedTeam);
          if (selectedPosition) record.positionId = String(selectedPosition);
          if (
            portableResolutionId(approved, "service", 0) ||
            portableResolutionId(approved, "serviceId", 0)
          )
            record.serviceId =
              portableResolutionId(approved, "service", 0) ||
              portableResolutionId(approved, "serviceId", 0);
          if (
            portableResolutionId(approved, "person", 0) ||
            portableResolutionId(approved, "memberId", 0)
          )
            record.memberId =
              portableResolutionId(approved, "person", 0) ||
              portableResolutionId(approved, "memberId", 0);
          const requestedAction = approved.action;
          const importKey = requestedAction === "create" ? portableCreateKey(approved) : "";
          try {
            if (requestedAction !== "create" && requestedAction !== "update")
              throw httpError(400, "Choose create or update for this row.");
            if (type === "teams") {
              const id = String(approved.recordId || record.teamId || "").trim();
              const byId = id
                ? data.teams.find((item) => item.teamId === id)
                : null;
              const createMatches = !id && !record.teamId
                ? data.teams.filter((item) => !item.archivedAt
                  && normalizePortableMatchValue(item.name) === normalizePortableMatchValue(record.name))
                : [];
              const idempotentMatch = importKey && data.teams.find((item) => item._portableCreateKey === importKey);
              if (requestedAction === "create" && createMatches.length && !idempotentMatch) {
                throw httpError(409, "A team with this name changed after preview. Preview the file again.");
              }
              const existing = byId || idempotentMatch;
              const alreadyCreated = requestedAction === "create" && Boolean(existing) && !byId;
              if (id && (!existing || existing.archivedAt))
                throw httpError(
                  409,
                  "The selected team is no longer active in this church. Preview the file again.",
                );
              if ((requestedAction === "update") !== Boolean(existing) && !alreadyCreated)
                throw httpError(
                  409,
                  "This row no longer matches the preview. Preview it again.",
                );
              const payload = await validateTeamPayload(
                {
                  ...(existing || {}),
                  name: record.name,
                  description: record.description ?? existing?.description,
                  usesMicrophoneAssignments:
                    record.usesMicrophones !== undefined
                      ? record.usesMicrophones === true ||
                        String(record.usesMicrophones).toLowerCase() === "true"
                      : existing?.usesMicrophoneAssignments,
                  usesIemAssignments:
                    record.usesIems !== undefined
                      ? record.usesIems === true ||
                        String(record.usesIems).toLowerCase() === "true"
                      : existing?.usesIemAssignments,
                  ...(record.icon !== undefined
                    ? { icon: parsePortableEntityIcon(record.icon) }
                    : {}),
                },
                churchId,
                existing,
              );
              if (importKey) payload._portableCreateKey = importKey;
              const saved = await upsertTeamEntity({
                kind: "team",
                churchId,
                id: existing?.teamId,
                payload,
                adminUserId: admin.user.uid,
                ...(!existing && importKey ? { portableCreateKey: importKey } : {}),
              });
              replaceDatasetEntity("teams", "teamId", saved);
              results.push({
                row,
                status: existing && !alreadyCreated ? "updated" : "created",
                id: saved.teamId,
              });
              continue;
            }
            if (type === "positions") {
              const localTeam =
                record.teamId &&
                data.teams.find(
                  (item) =>
                    item.teamId === String(record.teamId).trim() &&
                    normalizePortableMatchValue(item.name) ===
                      normalizePortableMatchValue(record.team),
                );
              if (record.teamId && (!localTeam || localTeam.archivedAt))
                throw httpError(
                  409,
                  "The selected team is no longer active in this church. Preview the file again.",
                );
              const teamMatches = localTeam
                ? [localTeam]
                : data.teams.filter(
                    (item) =>
                      normalizePortableMatchValue(item.name) ===
                      normalizePortableMatchValue(record.team),
                  );
              const team = teamMatches.length === 1 ? teamMatches[0] : null;
              if (!team || team.archivedAt)
                throw httpError(
                  409,
                  `The selected team "${record.team || ""}" is no longer active. Preview the file again.`,
                );
              // Position previews may use matchedId for their referenced team;
              // the portable position ID is the entity identity for updates.
              const id = String(record.positionId || approved.recordId || "").trim();
              const byId = id
                ? data.positions.find(
                    (item) =>
                      item.positionId === id && item.teamId === team.teamId,
                  )
                : null;
              const createMatches = !id && !record.positionId
                ? data.positions.filter((item) => !item.archivedAt
                  && item.teamId === team.teamId
                  && normalizePortableMatchValue(item.name) === normalizePortableMatchValue(record.name))
                : [];
              const idempotentMatch = importKey && data.positions.find((item) => item._portableCreateKey === importKey);
              if (requestedAction === "create" && createMatches.length && !idempotentMatch) {
                throw httpError(409, "A position with this name changed after preview. Preview the file again.");
              }
              const existing = byId || idempotentMatch;
              const alreadyCreated = requestedAction === "create" && Boolean(existing) && !byId;
              if (id && (!existing || existing.archivedAt))
                throw httpError(
                  409,
                  "The selected position is no longer active in this team. Preview the file again.",
                );
              if ((requestedAction === "update") !== Boolean(existing) && !alreadyCreated)
                throw httpError(
                  409,
                  "This row no longer matches the preview. Preview it again.",
                );
              const payload = await validateTeamPositionPayload(
                {
                  ...(existing || {}),
                  name: record.name,
                  teamId: team.teamId,
                  description: record.description ?? existing?.description,
                  groupId: record.group ?? existing?.groupId,
                  ...(record.order !== "" && record.order != null
                    ? { order: Number(record.order) }
                    : {}),
                  ...(record.icon !== undefined
                    ? { icon: parsePortableEntityIcon(record.icon) }
                    : {}),
                },
                churchId,
                existing,
              );
              if (importKey) payload._portableCreateKey = importKey;
              const saved = await upsertTeamEntity({
                kind: "position",
                churchId,
                id: existing?.positionId,
                payload,
                adminUserId: admin.user.uid,
                ...(!existing && importKey ? { portableCreateKey: importKey } : {}),
              });
              replaceDatasetEntity("positions", "positionId", saved);
              results.push({
                row,
                status: existing && !alreadyCreated ? "updated" : "created",
                id: saved.positionId,
              });
              continue;
            }
            if (type === "members") {
              const id = String(approved.recordId || record.memberId || "").trim();
              const byId = id
                ? data.members.find((item) => item.memberId === id)
                : null;
              const importedEmail = normalizePortableMatchValue(record.email);
              const importedPhone = String(record.phone || "").replace(/\D/g, "");
              const hasStableContact = Boolean(importedEmail || importedPhone);
              const createMatches = !id && !record.memberId && hasStableContact
                ? data.members.filter((item) => !item.archivedAt
                  && normalizePortableMatchValue(item.firstName) === normalizePortableMatchValue(record.firstName)
                  && normalizePortableMatchValue(item.lastName) === normalizePortableMatchValue(record.lastName)
                  && (!importedEmail || normalizePortableMatchValue(item.email) === importedEmail)
                  && (!importedPhone || String(item.phoneNumber || "").replace(/\D/g, "") === importedPhone))
                : [];
              const idempotentMatch = importKey && data.members.find((item) => item._portableCreateKey === importKey);
              const exactImportMatches = createMatches.filter((item) =>
                ["title", "email", "phoneNumber", "notes", "servingFrequency"].every((field) => {
                  const importedField = field === "phoneNumber" ? record.phone : record[field];
                  return importedField === undefined || String(item[field] || "") === String(importedField || "");
                }),
              );
              if (requestedAction === "create" && exactImportMatches.length && !idempotentMatch) {
                throw httpError(409, "A matching member changed after preview. Preview the file again.");
              }
              const existing = byId || idempotentMatch;
              const alreadyCreated = requestedAction === "create" && Boolean(existing) && !byId;
              if (id && (!existing || existing.archivedAt))
                throw httpError(
                  409,
                  "The selected member is no longer active in this church. Preview the file again.",
                );
              if ((requestedAction === "update") !== Boolean(existing) && !alreadyCreated)
                throw httpError(
                  409,
                  "This row no longer matches the preview. Preview it again.",
                );
              const teamNames = String(record.teams || "")
                .split(LIST_DELIMITER)
                .map((name) => name.trim())
                .filter(Boolean);
              const teamIds = String(record.teamIds || "")
                .split(LIST_DELIMITER)
                .map((value) => value.trim());
              const teams = teamNames.map((name, index) => {
                const resolvedId =
                  portableResolutionId(approved, "teams", index) ||
                  teamIds[index];
                return resolvedId
                  ? data.teams.filter(
                      (item) =>
                        !item.archivedAt &&
                        item.teamId === resolvedId &&
                        normalizePortableMatchValue(item.name) ===
                          normalizePortableMatchValue(name),
                    )
                  : data.teams.filter(
                      (item) =>
                        !item.archivedAt &&
                        normalizePortableMatchValue(item.name) ===
                          normalizePortableMatchValue(name),
                    );
              });
              if (teams.some((matches) => matches.length !== 1))
                throw httpError(
                  400,
                  "A team is missing or ambiguous. Import teams first and preview this file again.",
                );
              const positionNames = String(record.positions || "")
                .split(LIST_DELIMITER)
                .map((name) => name.trim())
                .filter(Boolean);
              const positionIds = String(record.positionIds || "")
                .split(LIST_DELIMITER)
                .map((value) => value.trim());
              const positions = positionNames.map((name, index) => {
                const resolvedId =
                  portableResolutionId(approved, "positions", index) ||
                  positionIds[index];
                const belongsToSelectedTeams = (item) =>
                  !teams.length ||
                  teams.some((group) =>
                    group.some((team) => team.teamId === item.teamId),
                  );
                return resolvedId
                  ? data.positions.filter(
                      (item) =>
                        !item.archivedAt &&
                        item.positionId === resolvedId &&
                        normalizePortableMatchValue(item.name) ===
                          normalizePortableMatchValue(name) &&
                        belongsToSelectedTeams(item),
                    )
                  : data.positions.filter(
                      (item) =>
                        !item.archivedAt &&
                        normalizePortableMatchValue(item.name) ===
                          normalizePortableMatchValue(name) &&
                        belongsToSelectedTeams(item),
                    );
              });
              if (positions.some((matches) => matches.length !== 1))
                throw httpError(
                  400,
                  "A position is missing or ambiguous. Import positions first and preview this file again.",
                );
              const priorTeamIds = data.teams
                .filter((team) =>
                  (team.memberIds || []).includes(existing?.memberId),
                )
                .map((team) => team.teamId);
              const body = {
                firstName: record.firstName ?? existing?.firstName,
                lastName: record.lastName ?? existing?.lastName,
                positionIds:
                  record.positions !== undefined
                    ? positions.map((matches) => matches[0].positionId)
                    : existing?.positionIds || [],
                ...(record.teams !== undefined
                  ? { teamIds: teams.map((matches) => matches[0].teamId) }
                  : { teamIds: priorTeamIds }),
                ...(record.title !== undefined ? { title: record.title } : {}),
                ...(record.email !== undefined ? { email: record.email } : {}),
                ...(record.phone !== undefined
                  ? { phoneNumber: record.phone }
                  : {}),
                ...(record.notes !== undefined ? { notes: record.notes } : {}),
                ...(record.servingFrequency !== undefined
                  ? { servingFrequency: record.servingFrequency }
                  : {}),
              };
              const payload = await validateTeamMemberPayload(body, churchId);
              if (importKey) payload._portableCreateKey = importKey;
              const requestedTeamIds = await validateMemberTeamIds(
                body,
                churchId,
              );
              const saved = await upsertTeamEntity({
                kind: "member",
                churchId,
                id: existing?.memberId,
                payload,
                adminUserId: admin.user.uid,
                ...(!existing && importKey ? { portableCreateKey: importKey } : {}),
              });
              const reconciled = await syncMemberTeamMembership({
                req,
                churchId,
                member: saved,
                positionIds: payload.positionIds,
                requestedTeamIds,
                adminUserId: admin.user.uid,
              });
              replaceDatasetEntity("members", "memberId", reconciled.member);
              results.push({
                row,
                status: existing && !alreadyCreated ? "updated" : "created",
                id: reconciled.member.memberId,
              });
              continue;
            }
            throw httpError(400, "This data type cannot be imported.");
          } catch (error) {
            results.push({
              row,
              status: "failed",
              code:
                error?.statusCode === 409 || Object.keys(resolutions).length
                  ? "stale_preview"
                  : "row_invalid",
              message: error?.message || "Could not import this row.",
            });
          }
        }
        return res.json({
          success: true,
          results,
          summary: {
            created: results.filter((item) => item.status === "created").length,
            updated: results.filter((item) => item.status === "updated").length,
            failed: results.filter((item) => item.status === "failed").length,
          },
        });
      } catch (error) {
        return dataTransferError(
          res,
          error,
          "Could not import these rows. Check the connection and try again.",
        );
      }
    },
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
     * Delivery history is loaded only for the intake form the operator opened.
     * Recipient IDs scope legacy attempts that predate the stored formId, while
     * the church filter keeps the query tenant-safe and indexable.
     */
    async getTeamIntakeSmsAttempts(req, res) {
      try {
        await requireTeamsView(req, req.params.churchId);
        const form = await getDoc(
          COLLECTIONS.teamIntakeForms,
          req.params.formId,
        );
        if (!form || form.churchId !== req.params.churchId) {
          throw httpError(404, "Intake form not found.");
        }
        const recipients = await queryDocs(
          COLLECTIONS.teamIntakeRecipients,
          [
            { field: "churchId", value: req.params.churchId },
            { field: "formId", value: req.params.formId },
          ],
          { limit: TEAM_COLLECTION_QUERY_LIMIT },
        );
        const recipientIds = recipients
          .map((recipient) =>
            String(recipient.recipientId || recipient.id || "").trim(),
          )
          .filter(Boolean);
        const attempts = [];
        for (let index = 0; index < recipientIds.length; index += 30) {
          const batch = recipientIds.slice(index, index + 30);
          attempts.push(
            ...(await queryDocs(
              COLLECTIONS.smsDeliveryAttempts,
              [
                { field: "churchId", value: req.params.churchId },
                { field: "recipientId", op: "in", value: batch },
              ],
              { limit: TEAM_COLLECTION_QUERY_LIMIT },
            )),
          );
        }
        const uniqueAttempts = new Map(
          attempts.map((attempt) => [attempt.attemptId || attempt.id, attempt]),
        );
        return res.json({
          success: true,
          attempts: [...uniqueAttempts.values()]
            .sort(
              (a, b) =>
                new Date(b.createdAt || 0).getTime() -
                new Date(a.createdAt || 0).getTime(),
            )
            .map(sanitizeSmsDeliveryAttemptForAdmin)
            .filter(Boolean),
        });
      } catch (error) {
        return sendTeamsJsonError(
          res,
          error,
          "Could not load SMS delivery history.",
        );
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
    validateReplacementCandidate,

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
        try {
          await saveNotificationEventIntents({
            churchId: req.params.churchId,
            schedule: { ...schedule, sentAt, updatedAt: sentAt },
            intentType: "assignment_notification",
            entries: slots.map((slot) => ({
              memberId: slot.member.memberId,
              occurrenceId: slot.occurrenceId,
              cellKey: slot.cellKey,
            })),
          });
        } catch (error) {
          console.error(
            "Could not record schedule notification previews.",
            error,
          );
        }
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
          assignments: await listMemberAssignmentsOnSchedule(
            schedule,
            memberId,
          ),
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
        // A response updates the schedule response record only. Declines expose
        // a vacancy to the scheduler; they never address a replacement message
        // to the volunteer who declined, and accepts do not send confirmations.
        if (response === "accepted") {
          try {
            await saveNotificationEventIntents({
              churchId,
              schedule,
              intentType: "assignment_confirmation",
              entries: targets.map((target) => ({
                memberId,
                occurrenceId: target.occurrenceId,
                cellKey: target.cellKey,
              })),
            });
          } catch (error) {
            console.error(
              "Could not record assignment response message previews",
              error,
            );
          }
        }
        emitTeamsEvent(churchId, "schedule-updated", { schedule });
        // Owners learn about this without watching the grid. Coalesced, so a
        // burst of answers after a send arrives as one email.
        await scheduleAssignmentResponseDigest(scheduleId);

        return res.json({
          success: true,
          response,
          applied,
          assignments: await listMemberAssignmentsOnSchedule(
            schedule,
            memberId,
          ),
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

    async createTeamIntakeRecipients(req, res) {
      try {
        await assertCsrf(req);
        const admin = await requireTeamsEdit(req, req.params.churchId);
        const form = await getDoc(
          COLLECTIONS.teamIntakeForms,
          req.params.formId,
        );
        if (!form || form.churchId !== req.params.churchId) {
          throw httpError(404, "Intake form not found.");
        }
        assertTeamIntakeFormIsOpen(form);
        const memberIds = normalizeIdArray(req.body?.memberIds).slice(0, 500);
        if (memberIds.length === 0) {
          throw httpError(400, "Choose at least one member.");
        }
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
        const positionTeamById = new Map(
          positions.map((position) => [position.positionId, position.teamId]),
        );
        const formTeamIds = new Set(normalizeIdArray(form.teamIds));
        const now = nowIso();
        const recipients = [];
        const existingRecipients = await Promise.all(
          memberIds.map((memberId) =>
            getDoc(
              COLLECTIONS.teamIntakeRecipients,
              createTeamIntakeRecipientId(req.params.formId, memberId),
            ),
          ),
        );
        const writes = [];
        for (const [index, memberId] of memberIds.entries()) {
          const member = members.find((item) => item.memberId === memberId);
          if (!member || member.archivedAt) {
            throw httpError(404, "Member not found or archived.");
          }
          if (formTeamIds.size > 0) {
            const memberTeamIds = new Set([
              ...Object.keys(member.teamMemberships || {}),
              ...(member.positionIds || [])
                .map((positionId) => positionTeamById.get(positionId))
                .filter(Boolean),
              ...teams
                .filter((team) => (team.memberIds || []).includes(memberId))
                .map((team) => team.teamId),
            ]);
            if (![...formTeamIds].some((teamId) => memberTeamIds.has(teamId))) {
              throw httpError(
                400,
                "One or more selected members are outside this form's team scope.",
              );
            }
          }

          const recipientId = createTeamIntakeRecipientId(
            req.params.formId,
            memberId,
          );
          const existing = existingRecipients[index];
          const isActive = Boolean(existing && !existing.revokedAt);
          const existingToken = isActive
            ? decryptTeamIntakeRecipientToken(
                existing.recipientTokenCiphertext,
                teamIntakeRecipientTokenSecret,
              )
            : null;
          const canReuseToken = Boolean(
            isActive &&
            existing.recipientTokenHash &&
            existingToken &&
            looksLikeTeamIntakeRecipientToken(existingToken) &&
            hashTeamIntakeRecipientToken(
              existingToken,
              teamIntakeRecipientTokenSecret,
            ) === existing.recipientTokenHash,
          );
          const token = canReuseToken
            ? existingToken
            : createTeamIntakeRecipientToken();
          const tokenHash = canReuseToken
            ? existing.recipientTokenHash
            : hashTeamIntakeRecipientToken(
                token,
                teamIntakeRecipientTokenSecret,
              );
          const tokenCiphertext = canReuseToken
            ? existing.recipientTokenCiphertext
            : encryptTeamIntakeRecipientToken(
                token,
                teamIntakeRecipientTokenSecret,
              );
          const recipient = isActive
            ? {
                ...existing,
                ...(!canReuseToken
                  ? {
                      recipientTokenHash: tokenHash,
                      recipientTokenCiphertext: tokenCiphertext,
                      tokenIssuedAt: now,
                      updatedAt: now,
                      updatedByUid: admin.user.uid,
                    }
                  : {}),
              }
            : {
                recipientId,
                churchId: req.params.churchId,
                formId: req.params.formId,
                memberId,
                createdAt: existing?.createdAt || now,
                createdByUid: admin.user.uid,
                recipientTokenHash: tokenHash,
                recipientTokenCiphertext: tokenCiphertext,
                tokenIssuedAt: now,
                revokedAt: null,
                respondedAt: null,
                submissionId: null,
                linkCopiedAt: null,
                linkCopiedByUid: null,
                updatedAt: now,
                updatedByUid: admin.user.uid,
              };
          if (!isActive || !canReuseToken) {
            writes.push({
              id: recipientId,
              data: recipient,
              merge: Boolean(existing),
            });
          }
          recipients.push(
            sanitizeTeamIntakeRecipientForAdmin({
              recipientId,
              ...recipient,
            }),
          );
        }
        await writeTeamIntakeRecipientBatch(writes);
        await addSecurityEvent({
          type: "team_intake_recipients_created",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          formId: req.params.formId,
          memberIds,
        });
        return res.json({ success: true, recipients });
      } catch (error) {
        return sendTeamsJsonError(
          res,
          error,
          "Could not create individual intake requests.",
        );
      }
    },

    async getTeamIntakeRecipientLink(req, res) {
      try {
        await assertCsrf(req);
        const admin = await requireTeamsEdit(req, req.params.churchId);
        const recipient = await getDoc(
          COLLECTIONS.teamIntakeRecipients,
          req.params.recipientId,
        );
        if (!recipient || recipient.churchId !== req.params.churchId) {
          throw httpError(404, "Individual request not found.");
        }
        const { form, member } = await getTeamIntakeRecipientContext(
          recipient,
          {
            requireTokenHash: false,
          },
        );
        const markCopied = req.body?.markCopied === true;
        const copiedAt = nowIso();
        const ensured = await ensureTeamIntakeRecipientToken(
          recipient,
          admin.user.uid,
        );
        const update = {
          ...(markCopied
            ? {
                linkCopiedAt: copiedAt,
                linkCopiedByUid: admin.user.uid,
              }
            : {}),
          updatedAt: copiedAt,
          updatedByUid: admin.user.uid,
        };
        await setDoc(
          COLLECTIONS.teamIntakeRecipients,
          recipient.recipientId,
          update,
          { merge: true },
        );
        const nextRecipient = {
          ...ensured.recipient,
          ...update,
        };
        if (markCopied) {
          await addSecurityEvent({
            type: "team_intake_recipient_link_copied",
            churchId: req.params.churchId,
            userId: admin.user.uid,
            formId: form.formId,
            memberId: member.memberId,
            recipientId: recipient.recipientId,
          });
        }
        return res.json({
          success: true,
          recipient: sanitizeTeamIntakeRecipientForAdmin(nextRecipient),
          publicUrl: buildTeamIntakeRecipientPublicUrl(ensured.token),
        });
      } catch (error) {
        return sendTeamsJsonError(
          res,
          error,
          "Could not create the individual intake link.",
        );
      }
    },

    async sendTeamIntakeRecipientSms(req, res) {
      try {
        await assertCsrf(req);
        const admin = await requireTeamsEdit(req, req.params.churchId);
        enforceRateLimit({
          scope: "team-intake-sms-send",
          key: `${req.params.churchId}:${admin.user.uid}:${req.params.recipientId}`,
          limit: 10,
          windowMs: 10 * 60 * 1000,
          blockMs: 10 * 60 * 1000,
        });
        if (typeof sendTeamIntakeNotificationIntent !== "function") {
          throw httpError(
            503,
            "The shared volunteer message dispatcher is unavailable.",
          );
        }
        return await sendTeamIntakeNotificationIntent(req, res);
      } catch (error) {
        return sendTeamsJsonError(
          res,
          error,
          "Could not send the individual intake SMS.",
        );
      }
    },

    async prepareTeamIntakeRecipientSms(req, res) {
      try {
        await assertCsrf(req);
        await requireTeamsEdit(req, req.params.churchId);
        if (typeof prepareTeamIntakeNotificationIntent !== "function") {
          throw httpError(
            503,
            "The shared volunteer message preview is unavailable.",
          );
        }
        return await prepareTeamIntakeNotificationIntent(req, res);
      } catch (error) {
        return sendTeamsJsonError(
          res,
          error,
          "Could not prepare the individual intake SMS.",
        );
      }
    },

    async revokeTeamIntakeRecipient(req, res) {
      try {
        await assertCsrf(req);
        const admin = await requireTeamsEdit(req, req.params.churchId);
        const recipient = await getDoc(
          COLLECTIONS.teamIntakeRecipients,
          req.params.recipientId,
        );
        if (!recipient || recipient.churchId !== req.params.churchId) {
          throw httpError(404, "Individual request not found.");
        }
        const revokedAt = nowIso();
        await setDoc(
          COLLECTIONS.teamIntakeRecipients,
          recipient.recipientId,
          {
            revokedAt,
            updatedAt: revokedAt,
            updatedByUid: admin.user.uid,
          },
          { merge: true },
        );
        const nextRecipient = { ...recipient, revokedAt, updatedAt: revokedAt };
        await addSecurityEvent({
          type: "team_intake_recipient_revoked",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          formId: recipient.formId,
          memberId: recipient.memberId,
          recipientId: recipient.recipientId,
        });
        return res.json({
          success: true,
          recipient: sanitizeTeamIntakeRecipientForAdmin(nextRecipient),
        });
      } catch (error) {
        return sendTeamsJsonError(
          res,
          error,
          "Could not revoke the individual intake request.",
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
        const token = String(req.query?.token || "");
        const recipientOnly =
          req.teamIntakeRecipientOnly === true ||
          req.query?.recipientOnly === "true";
        if (recipientOnly !== looksLikeTeamIntakeRecipientToken(token)) {
          throw httpError(404, "Request not found.");
        }
        const personalizedContext = looksLikeTeamIntakeRecipientToken(token)
          ? await getTeamIntakeRecipientContextByToken(token)
          : null;
        const { form, member } =
          personalizedContext || (await getTeamIntakeFormByToken(token));
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
          ...(member
            ? { recipient: { firstName: member.firstName || "there" } }
            : {}),
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
        const token = String(req.query?.token || "");
        const recipientOnly =
          req.teamIntakeRecipientOnly === true ||
          req.query?.recipientOnly === "true";
        if (recipientOnly !== looksLikeTeamIntakeRecipientToken(token)) {
          throw httpError(404, "Request not found.");
        }
        if (looksLikeTeamIntakeRecipientToken(token)) {
          const result = await submitTeamIntakeRecipient(req, token);
          return res.json({
            success: result.success,
            submissionId: result.submissionId,
          });
        }
        const { form } = await getTeamIntakeFormByToken(token);
        assertTeamIntakeFormIsOpen(form);
        const payload = await validateTeamIntakeSubmissionPayload(
          req.body,
          form,
        );
        const submissionId = createId("teamIntakeSubmission");
        const submittedAt = nowIso();
        const submission = {
          ...payload,
          submissionId,
          formId: form.formId,
          churchId: form.churchId,
          status: "new",
          submittedAt,
        };
        if (persistTeamIntakeSubmission) {
          await persistTeamIntakeSubmission(submission);
        } else {
          await setDoc(
            COLLECTIONS.teamIntakeSubmissions,
            submissionId,
            submission,
            { merge: false },
          );
        }
        // Schedule the lead digest out-of-band after persistence. A scheduling
        // failure must not change the public submission response.
        if (scheduleIntakeSubmissionDigest) {
          Promise.resolve(
            scheduleIntakeSubmissionDigest(form.formId, submittedAt),
          ).catch((error) =>
            logAuthEvent?.("warn", "intake.digest.schedule_failed", {
              formId: form.formId,
              errorName: error?.name || "Error",
            }),
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
        const churchId = req.params.churchId;
        const admin = await requireTeamsEdit(req, churchId);
        const existing = await assertTeamEntityInChurch(
          "position",
          req.params.positionId,
          churchId,
          { active: false, label: "Position" },
        );
        const position = await upsertTeamEntity({
          kind: "position",
          churchId,
          id: req.params.positionId,
          payload: await validateTeamPositionPayload(
            req.body,
            churchId,
            existing,
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
        const existingTeam = await assertTeamEntityInChurch(
          "team",
          req.params.teamId,
          req.params.churchId,
          { label: "Team", active: false },
        );
        const team = await upsertTeamEntity({
          kind: "team",
          churchId: req.params.churchId,
          id: req.params.teamId,
          payload: await validateTeamPayload(req.body, req.params.churchId, existingTeam),
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

    async ensureTeamScheduleForPeriod(req, res) {
      try {
        await assertCsrf(req);
        const churchId = req.params.churchId;
        let payload = await validateTeamSchedulePayload(req.body, churchId);
        const timeZone = normalizeShortText(req.body?.timeZone, { max: 80 });
        if (!timeZone)
          throw httpError(400, "Choose a time zone for this schedule period.");
        const admin = await requireTeamsEditForTeam(
          req,
          churchId,
          payload.teamId,
        );
        const activeServicesById = new Map(
          (await readChurchServiceTimes(churchId))
            .filter((service) => !service?.archivedAt)
            .map((service) => [
              normalizeShortText(service?.serviceId || service?.id, {
                max: 160,
              }),
              service,
            ]),
        );
        if (
          payload.serviceIds.some(
            (serviceId) => !activeServicesById.has(serviceId),
          )
        ) {
          throw httpError(
            400,
            "Choose active services for this schedule period.",
          );
        }
        for (const occurrence of payload.occurrences) {
          const localParts = getOccurrenceCalendarParts(
            occurrence.startsAt,
            timeZone,
          );
          if (
            localParts.date < payload.startDate ||
            localParts.date > payload.endDate
          ) {
            throw httpError(
              400,
              "A service occurrence falls outside this schedule period.",
            );
          }
          const occurrenceServiceIds = normalizeIdArray(
            occurrence.serviceIds?.length
              ? occurrence.serviceIds
              : [occurrence.serviceId],
          );
          if (
            occurrenceServiceIds.some(
              (serviceId) => !payload.serviceIds.includes(serviceId),
            )
          ) {
            throw httpError(
              400,
              "A schedule occurrence uses a service outside the selected period.",
            );
          }
          assertOccurrenceServiceGroup({
            serviceId: occurrence.serviceId,
            serviceIds: occurrenceServiceIds,
            groupId:
              normalizeShortText(occurrence.groupId, { max: 160 }) || undefined,
            occurrenceId: occurrence.occurrenceId,
            startsAt: occurrence.startsAt,
            localParts,
            timeZone,
            servicesById: activeServicesById,
          });
        }
        const generatedPeriodKey = generatedPeriodKeyFor({
          churchId,
          ...payload,
        });
        const canonicalOccurrences = payload.occurrences.map((occurrence) => {
          const serviceIds = normalizeIdArray(
            occurrence.serviceIds?.length
              ? occurrence.serviceIds
              : [occurrence.serviceId],
          );
          const requirements = occurrence.groupId
            ? mergeServicePositionRequirements(
                serviceIds.map((id) => activeServicesById.get(id)),
              )
            : sanitizePositionRequirements(
                activeServicesById.get(occurrence.serviceId)
                  ?.positionRequirements,
              );
          return {
            ...occurrence,
            ...(requirements.length
              ? { positionRequirements: requirements }
              : { positionRequirements: [] }),
          };
        });
        payload = {
          ...payload,
          occurrences: canonicalOccurrences,
          source: "generated-period",
          generatedPeriodKey,
        };
        const visibleOccurrenceIds = Array.isArray(
          req.body?.visibleOccurrenceIds,
        )
          ? normalizeIdArray(req.body.visibleOccurrenceIds)
          : payload.occurrences.map((occurrence) => occurrence.occurrenceId);
        if (
          visibleOccurrenceIds.some(
            (occurrenceId) =>
              !payload.occurrences.some(
                (occurrence) => occurrence.occurrenceId === occurrenceId,
              ),
          )
        ) {
          throw httpError(
            400,
            "Choose visible occurrences from this schedule period.",
          );
        }

        const createIfMissing = async () => {
          const activeTeamSchedules = (
            await listTeamCollectionForChurch(
              COLLECTIONS.teamSchedules,
              "scheduleId",
              churchId,
            )
          ).filter(
            (schedule) =>
              !schedule.archivedAt &&
              schedule.teamId === payload.teamId,
          );
          const hasScheduleData = (schedule) =>
            Boolean(
              schedule.guests?.length ||
                Object.keys(schedule.assignments || {}).length ||
                Object.keys(schedule.microphoneAssignments || {}).length ||
                Object.keys(schedule.iemAssignments || {}).length ||
                Object.keys(schedule.additionalPositionSlots || {}).length ||
                Object.keys(schedule.optionalPositionSlots || {}).length ||
                Object.keys(schedule.responses || {}).length,
            );
          // Resolve the default schedule from the full requested period. A
          // partial custom schedule remains an overlap-picker option.
          const compatible = activeTeamSchedules.filter(
            (schedule) => schedule.churchId === churchId &&
              schedule.startDate && schedule.endDate,
          );
          const canonicalGenerated = compatible.filter(
            (schedule) =>
              schedule.source === "generated-period" &&
              Boolean(schedule.generatedPeriodKey) &&
              schedule.scheduleId ===
                generatedPeriodScheduleId(schedule.generatedPeriodKey),
          );
          const resolutionCandidates = compatible.filter(
            (schedule) => schedule.source != null ||
              !canonicalGenerated.some((generated) =>
                generated.startDate === schedule.startDate &&
                generated.endDate === schedule.endDate,
              ),
          );
          const exact = resolutionCandidates.filter(
            (schedule) => schedule.startDate === payload.startDate &&
              schedule.endDate === payload.endDate,
          );
          const covering = resolutionCandidates.filter(
            (schedule) => schedule.startDate <= payload.startDate &&
              schedule.endDate >= payload.endDate,
          );
          const explicitLegacyOccurrenceDate = normalizeOptionalPlainDate(
            req.body?.legacyOccurrenceDate,
            "Upcoming occurrence date",
          );
          const legacyVisibleStart = normalizeOptionalPlainDate(
            req.body?.visibleStartDate,
            "Visible start date",
          );
          const legacyVisibleEnd = normalizeOptionalPlainDate(
            req.body?.visibleEndDate,
            "Visible end date",
          );
          // Older clients sent the Upcoming occurrence as a one-day visible
          // range. Keep that compatibility for genuine generated records.
          const legacyOccurrenceDate = explicitLegacyOccurrenceDate ||
            (legacyVisibleStart && legacyVisibleStart === legacyVisibleEnd
              ? legacyVisibleStart
              : null);
          const legacyGenerated = resolutionCandidates.filter((schedule) =>
            (schedule.source === "generated-period" ||
              (schedule.source == null && (schedule.generatedPeriodKey ||
                String(schedule.scheduleId || "").startsWith("generated_")))) &&
            legacyOccurrenceDate &&
            schedule.startDate <= legacyOccurrenceDate &&
            schedule.endDate >= legacyOccurrenceDate,
          );
          const candidates = exact.length ? exact : covering.length ? covering : legacyGenerated;
          const validCandidates = [...exact, ...covering, ...legacyGenerated];
          const preferredScheduleId = normalizeShortText(
            req.body?.preferredScheduleId,
            { max: 160 },
          );
          const canonicalForTier = candidates.filter((schedule) =>
            schedule.source === "generated-period" &&
            Boolean(schedule.generatedPeriodKey) &&
            schedule.scheduleId === generatedPeriodScheduleId(schedule.generatedPeriodKey),
          );
          const tierCandidates = candidates.filter((schedule) =>
            schedule.source != null ||
            !canonicalForTier.some((generated) =>
              generated.startDate === schedule.startDate &&
              generated.endDate === schedule.endDate,
            ),
          );
          const selected = validCandidates.find((schedule) =>
            schedule.scheduleId === preferredScheduleId,
          ) || [...tierCandidates].sort((left, right) =>
            Number(hasScheduleData(right)) - Number(hasScheduleData(left)) ||
            Number(canonicalForTier.includes(right)) - Number(canonicalForTier.includes(left)) ||
            String(left.startDate).localeCompare(String(right.startDate)) ||
            String(left.endDate).localeCompare(String(right.endDate)) ||
            String(left.scheduleId).localeCompare(String(right.scheduleId), "en"),
          )[0];
          if (selected) return { schedule: selected, created: false };

          const scheduleId = generatedPeriodScheduleId(generatedPeriodKey);
          const db = requireFirestore();
          if (db) {
            return db.runTransaction(async (transaction) => {
              const ref = db
                .collection(COLLECTIONS.teamSchedules)
                .doc(scheduleId);
              const snapshot = await transaction.get(ref);
              if (snapshot.exists) {
                const existing = {
                  scheduleId: snapshot.id,
                  ...snapshot.data(),
                };
                if (
                  existing.churchId !== churchId ||
                  existing.generatedPeriodKey !== generatedPeriodKey
                ) {
                  throw httpError(
                    409,
                    "The generated schedule identity is unavailable.",
                  );
                }
                return { schedule: existing, created: false };
              }
              const now = nowIso();
              const document = {
                ...payload,
                scheduleId,
                churchId,
                archivedAt: null,
                updatedAt: now,
                updatedByUid: admin.user.uid,
                createdAt: now,
                createdByUid: admin.user.uid,
              };
              transaction.create(ref, document);
              return { schedule: document, created: true };
            });
          }

          return withGeneratedPeriodEnsureLock(generatedPeriodKey, async () => {
            const existing = await getDoc(
              COLLECTIONS.teamSchedules,
              scheduleId,
            );
            if (existing)
              return { schedule: { scheduleId, ...existing }, created: false };
            const now = nowIso();
            const document = {
              ...payload,
              scheduleId,
              churchId,
              archivedAt: null,
              updatedAt: now,
              updatedByUid: admin.user.uid,
              createdAt: now,
              createdByUid: admin.user.uid,
            };
            await setDoc(COLLECTIONS.teamSchedules, scheduleId, document);
            return { schedule: document, created: true };
          });
        };

        // Seed position-default microphone/IEM choices exactly as normal new
        // schedule creation does, before the deterministic record is committed.
        if (
          !Object.prototype.hasOwnProperty.call(
            req.body || {},
            "microphoneAssignments",
          )
        ) {
          payload = await applyPositionDefaultMicrophones({
            churchId,
            payload,
          });
        }
        if (
          !Object.prototype.hasOwnProperty.call(
            req.body || {},
            "iemAssignments",
          )
        ) {
          payload = await applyPositionDefaultIems({ churchId, payload });
        }
        payload = {
          ...payload,
          source: "generated-period",
          generatedPeriodKey,
        };
        const result = await createIfMissing();
        if (result.created) {
          await addSecurityEvent({
            type: "team_schedule_created",
            churchId,
            userId: admin.user.uid,
            scheduleId: result.schedule.scheduleId,
          });
          emitTeamsEvent(churchId, "schedule-updated", {
            schedule: result.schedule,
          });
          await emitPublicPlansForScheduleOccurrences({
            churchId,
            occurrences: result.schedule.occurrences,
            revision: result.schedule.updatedAt || nowIso(),
          });
        }
        return res.json({ success: true, ...result });
      } catch (error) {
        return sendTeamsJsonError(
          res,
          error,
          "Could not open this schedule period.",
        );
      }
    },

    async createTeamSchedule(req, res) {
      try {
        await assertCsrf(req);
        let payload = await validateTeamSchedulePayload(
          req.body,
          req.params.churchId,
        );
        // New schedules without an explicit mic plan start from position
        // defaults. Copies and intentional client-provided allocations retain
        // their own per-date choices unchanged.
        if (
          !Object.prototype.hasOwnProperty.call(
            req.body || {},
            "microphoneAssignments",
          )
        ) {
          payload = await applyPositionDefaultMicrophones({
            churchId: req.params.churchId,
            payload,
          });
        }
        if (
          !Object.prototype.hasOwnProperty.call(
            req.body || {},
            "iemAssignments",
          )
        ) {
          payload = await applyPositionDefaultIems({
            churchId: req.params.churchId,
            payload,
          });
        }
        payload = { ...payload, source: "custom" };
        const admin = await requireTeamsEditForTeam(
          req,
          req.params.churchId,
          payload.teamId,
        );
        if (Object.keys(payload.assignments || {}).length > 0) {
          const schedules = await listScheduleConflictCandidates({
            churchId: req.params.churchId,
            schedule: { churchId: req.params.churchId, ...payload },
          });
          assertNoCrossTeamScheduleAssignmentConflicts({
            schedule: { churchId: req.params.churchId, ...payload },
            assignments: payload.assignments,
            schedules,
            confirmedFingerprint: normalizeAllowOccurrenceConflict(req.body),
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
          const schedules = await listScheduleConflictCandidates({
            churchId: req.params.churchId,
            schedule: { ...existing, ...payload, scheduleId: req.params.scheduleId },
          });
          assertNoCrossTeamScheduleAssignmentConflicts({
            schedule: {
              scheduleId: req.params.scheduleId,
              churchId: req.params.churchId,
              ...payload,
            },
            assignments: newAssignmentConflictChecks,
            schedules,
            confirmedFingerprint: normalizeAllowOccurrenceConflict(req.body),
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
        const removedEntries = [];
        const addedEntries = [];
        for (const occurrenceId of new Set([
          ...Object.keys(existing.assignments || {}),
          ...Object.keys(schedule.assignments || {}),
        ])) {
          const beforeRow = existing.assignments?.[occurrenceId] || {};
          const afterRow = schedule.assignments?.[occurrenceId] || {};
          for (const cellKey of new Set([
            ...Object.keys(beforeRow),
            ...Object.keys(afterRow),
          ])) {
            const beforeCell = beforeRow[cellKey];
            const afterCell = afterRow[cellKey];
            const beforeId =
              typeof beforeCell === "string"
                ? beforeCell
                : beforeCell?.primaryMemberId || "";
            const afterId =
              typeof afterCell === "string"
                ? afterCell
                : afterCell?.primaryMemberId || "";
            if (beforeId === afterId) continue;
            if (beforeId)
              removedEntries.push({
                memberId: beforeId,
                occurrenceId,
                cellKey,
              });
            if (afterId)
              addedEntries.push({ memberId: afterId, occurrenceId, cellKey });
          }
        }
        try {
          for (const { intentType, entries } of [
            { intentType: "schedule_change", entries: removedEntries },
            ...(schedule.sentAt
              ? [
                  {
                    intentType: "assignment_notification",
                    entries: addedEntries,
                  },
                ]
              : []),
          ]) {
            await saveNotificationEventIntents({
              churchId: req.params.churchId,
              schedule,
              intentType,
              entries,
            });
          }
        } catch (error) {
          console.error(
            "Could not record schedule change message previews",
            error,
          );
        }
        if (schedule.sentAt) {
          for (const entry of addedEntries) {
            try {
              await closeResolvedReplacementInvitations({
                churchId: req.params.churchId,
                scheduleId: schedule.scheduleId,
                occurrenceId: entry.occurrenceId,
                cellKey: entry.cellKey,
              });
            } catch (error) {
              console.error(
                "Could not close resolved replacement invitation",
                error,
              );
            }
          }
        }
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
        const reader = await requireServicePlansView(req, churchId);
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
        const responsePlan = withoutServicePlanAssignments(servicePlan, reader);
        if (canEdit && servicePlan.lastSaveOperationId) {
          responsePlan.lastSaveOperationId = servicePlan.lastSaveOperationId;
        }
        return res.json({
          success: true,
          servicePlan: responsePlan,
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

    async getServicePlanPublicSnapshot(req, res) {
      try {
        const churchId = req.params.churchId;
        const reader = await requireServicePlansView(req, churchId);
        if (!hasTeamsPlanAccess(reader)) {
          return res.json({ success: true, snapshot: null });
        }
        const planKey = decodeURIComponent(req.params.planKey);
        const servicePlan = await getDoc(
          COLLECTIONS.servicePlans,
          buildServicePlanDocId(churchId, planKey),
        );
        if (
          !servicePlan ||
          servicePlan.churchId !== churchId ||
          !servicePlan.published ||
          !servicePlan.publicLinkToken
        ) {
          return res.json({ success: true, snapshot: null });
        }
        const snapshot = await buildPublicServicePlan({
          plan: servicePlan,
          viewMode: "team",
          token: servicePlan.publicLinkToken,
        });
        return res.json({ success: true, snapshot });
      } catch (error) {
        return sendTeamsJsonError(
          res,
          error,
          "Could not load the detailed service view.",
        );
      }
    },

    async getServicePlanViewer(req, res) {
      try {
        const churchId = req.params.churchId;
        const reader = await requireServicePlansView(req, churchId);
        const planKey = decodeURIComponent(req.params.planKey);
        const servicePlan = await getDoc(
          COLLECTIONS.servicePlans,
          buildServicePlanDocId(churchId, planKey),
        );
        if (!servicePlan || servicePlan.churchId !== churchId) {
          return res.json({ success: true, plan: null, snapshot: null });
        }

        const hasTeamDetails = hasTeamsPlanAccess(reader);
        const plan = withoutServicePlanAssignments(servicePlan, reader);
        const snapshot = await buildPublicServicePlan({
          // Use the same display-only sanitizer as published team links. A
          // plan-only reader keeps assignment and roster data stripped.
          plan: hasTeamDetails ? servicePlan : plan,
          viewMode: "team",
          token:
            servicePlan.publicLinkToken ||
            `current-service-viewer:${servicePlan.planKey}`,
          includeTeamDetails: hasTeamDetails,
          allowUnpublished: true,
          includeControllerEquipment: hasTeamDetails,
        });
        return res.json({ success: true, plan, snapshot });
      } catch (error) {
        return sendTeamsJsonError(
          res,
          error,
          "Could not load this service viewer.",
        );
      }
    },

    async getServicePlanAssignments(req, res) {
      try {
        const churchId = req.params.churchId;
        const reader = await requireServicePlansView(req, churchId);
        if (isPlanOnlyReader(reader)) {
          return res.json({ success: true, assignments: [] });
        }
        const planKey = decodeURIComponent(req.params.planKey);
        const servicePlan = await getDoc(
          COLLECTIONS.servicePlans,
          buildServicePlanDocId(churchId, planKey),
        );
        if (!servicePlan || servicePlan.churchId !== churchId) {
          return res.json({ success: true, assignments: [] });
        }
        return res.json({
          success: true,
          assignments: await buildServicePlanAssignments(churchId, planKey),
        });
      } catch (error) {
        return sendTeamsJsonError(
          res,
          error,
          "Could not load service plan assignments.",
        );
      }
    },

    async saveServicePlan(req, res) {
      try {
        await assertCsrf(req);
        const churchId = req.params.churchId;
        const admin = await requireServicesEdit(req, churchId);
        const actorUid = sessionActorUid(admin);
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
              adminUid: actorUid,
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
            adminUid: actorUid,
            now,
          });
          await setDoc(COLLECTIONS.servicePlans, docId, nextPlan, {
            merge: Boolean(existing),
          });
          servicePlan = await getDoc(COLLECTIONS.servicePlans, docId);
        }
        emitTeamsEvent(churchId, "service-plan-updated", {
          servicePlan: withoutServicePlanSecrets(servicePlan),
          saveOperationId: payload.saveOperationId,
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
            servicePlan: {
              ...withoutServicePlanSecrets(error.servicePlanConflict),
              ...(error.servicePlanConflict.lastSaveOperationId
                ? {
                    lastSaveOperationId:
                      error.servicePlanConflict.lastSaveOperationId,
                  }
                : {}),
            },
          });
        }
        return sendTeamsJsonError(
          res,
          error,
          "Could not save this service plan.",
        );
      }
    },

    async applyServicePlanTemplateBulk(req, res) {
      try {
        await assertCsrf(req);
        const churchId = req.params.churchId;
        const admin = await requireServicesEdit(req, churchId);
        const actorUid = sessionActorUid(admin);
        const rawTargets = Array.isArray(req.body?.targets)
          ? req.body.targets
          : [];
        if (!rawTargets.length || rawTargets.length > 100) {
          throw httpError(400, "Choose between 1 and 100 service dates.");
        }
        if (req.body?.existingPlanMode !== "skip") {
          throw httpError(400, "Existing plans can only be skipped.");
        }
        const useServiceDefaults = req.body?.useServiceDefaults === true;
        const timeZone = normalizeShortText(req.body?.timeZone, { max: 80 });
        if (!timeZone)
          throw httpError(400, "Choose a time zone for service occurrences.");
        const templateId = normalizeShortText(req.body?.templateId, {
          max: 160,
        });
        if (!useServiceDefaults && !templateId) {
          throw httpError(400, "Choose a service plan template.");
        }
        const selectedTemplate = templateId
          ? await getDoc(COLLECTIONS.servicePlanTemplates, templateId)
          : null;
        if (templateId && selectedTemplate?.churchId !== churchId) {
          throw httpError(
            404,
            "That service plan template is no longer available.",
          );
        }
        const services = await readChurchServiceTimes(churchId);
        const servicesById = new Map(
          services.map((service) => [
            normalizeShortText(service?.serviceId || service?.id, { max: 160 }),
            service,
          ]),
        );
        const targets = rawTargets.map((raw) => {
          const serviceId = normalizeShortText(raw?.serviceId, { max: 160 });
          const serviceIds = normalizeIdArray(
            raw?.serviceIds?.length ? raw.serviceIds : [serviceId],
          );
          const date = assertPlainDate(raw?.date, "Service plan date");
          const startsAt = assertTeamScheduleDateTime(
            raw?.startsAt,
            "Service occurrence date",
          );
          const groupId =
            normalizeShortText(raw?.groupId, { max: 160 }) || undefined;
          const occurrenceId = normalizeShortText(raw?.occurrenceId, {
            max: 260,
          });
          if (!serviceId || !serviceIds.includes(serviceId)) {
            throw httpError(
              400,
              "A target occurrence is missing its service identity.",
            );
          }
          const expectedOccurrenceId = groupId
            ? `group:${groupId}@${date}`
            : `${serviceId}@${startsAt}`;
          if (
            !occurrenceId ||
            occurrenceId !== expectedOccurrenceId ||
            startsAt.slice(0, 10) !== date
          ) {
            throw httpError(
              400,
              "The target does not match its service occurrence.",
            );
          }
          if (
            serviceIds.some(
              (id) => !servicesById.has(id) || servicesById.get(id)?.archivedAt,
            )
          ) {
            throw httpError(
              400,
              "Every target must use active service definitions.",
            );
          }
          const localParts = getOccurrenceCalendarParts(startsAt, timeZone);
          assertOccurrenceServiceGroup({
            serviceId,
            serviceIds,
            groupId,
            occurrenceId,
            startsAt,
            localParts,
            timeZone,
            servicesById,
          });
          const planKey = groupId
            ? `group:${groupId}@${date}`
            : `${serviceId}@${date}`;
          const payload = validateServicePlanPayload(
            {
              serviceId,
              serviceIds,
              groupId,
              date,
              startsAt,
              name: servicesById.get(serviceId)?.name || "Service Plan",
              sections: [],
            },
            { churchId, planKey },
          );
          return {
            planKey,
            docId: buildServicePlanDocId(churchId, planKey),
            payload,
            serviceId,
          };
        });
        if (
          new Set(targets.map((target) => target.planKey)).size !==
          targets.length
        ) {
          throw httpError(
            400,
            "The selected dates contain duplicate plan occurrences.",
          );
        }

        const created = [];
        const skippedExisting = [];
        const skippedNoTemplate = [];
        const failed = [];
        const db = requireFirestore();
        for (const target of targets) {
          const service = servicesById.get(target.serviceId);
          const targetTemplateId = useServiceDefaults
            ? normalizeShortText(service?.defaultPlanTemplateId, { max: 160 })
            : templateId;
          if (!targetTemplateId) {
            skippedNoTemplate.push(target.planKey);
            continue;
          }
          const template =
            targetTemplateId === templateId
              ? selectedTemplate
              : await getDoc(
                  COLLECTIONS.servicePlanTemplates,
                  targetTemplateId,
                );
          if (!template || template.churchId !== churchId) {
            skippedNoTemplate.push(target.planKey);
            continue;
          }
          const sections = (template.sections || []).map((section) => ({
            ...section,
            id: createId("servicePlanSection"),
            elements: (section.elements || []).map((element) => ({
              ...element,
              id: createId("servicePlanElement"),
              assignees: (element.assignees || []).map((assignee) => ({
                ...assignee,
                id: createId("servicePlanAssignee"),
              })),
            })),
          }));
          const payload = validateServicePlanPayload(
            {
              ...target.payload,
              sections,
              clonedFromPlanKey: template.templateId,
            },
            { churchId, planKey: target.planKey },
          );
          try {
            let wasCreated = false;
            if (db) {
              wasCreated = await db.runTransaction(async (transaction) => {
                const ref = db
                  .collection(COLLECTIONS.servicePlans)
                  .doc(target.docId);
                const snapshot = await transaction.get(ref);
                if (snapshot.exists) return false;
                transaction.create(
                  ref,
                  buildServicePlanSaveDocument({
                    existing: null,
                    payload,
                    docId: target.docId,
                    adminUid: actorUid,
                    now: nowIso(),
                  }),
                );
                return true;
              });
            } else {
              wasCreated = await withGeneratedPeriodEnsureLock(
                `service-plan:${target.docId}`,
                async () => {
                  if (await getDoc(COLLECTIONS.servicePlans, target.docId))
                    return false;
                  await setDoc(
                    COLLECTIONS.servicePlans,
                    target.docId,
                    buildServicePlanSaveDocument({
                      existing: null,
                      payload,
                      docId: target.docId,
                      adminUid: actorUid,
                      now: nowIso(),
                    }),
                  );
                  return true;
                },
              );
            }
            if (wasCreated) created.push(target.planKey);
            else skippedExisting.push(target.planKey);
          } catch (error) {
            failed.push({
              planKey: target.planKey,
              error: error?.message || "Could not create this plan.",
            });
          }
        }
        for (const planKey of created) {
          const plan = await getDoc(
            COLLECTIONS.servicePlans,
            buildServicePlanDocId(churchId, planKey),
          );
          if (plan)
            emitTeamsEvent(churchId, "service-plan-updated", {
              servicePlan: withoutServicePlanSecrets(plan),
            });
        }
        return res.json({
          success: true,
          created,
          skippedExisting,
          skippedNoTemplate,
          failed,
        });
      } catch (error) {
        return sendTeamsJsonError(
          res,
          error,
          "Could not apply this service plan template.",
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
        const actorUid = sessionActorUid(admin);
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
          updatedByUid: actorUid,
          createdAt: current?.createdAt || now,
          createdByUid: current?.createdByUid || actorUid,
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
        const actorUid = sessionActorUid(admin);
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
            updatedByUid: actorUid,
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

    async getServiceEquipment(req, res) {
      try {
        const churchId = req.params.churchId;
        await requireTeamsView(req, churchId);
        const church = await getDoc(COLLECTIONS.churches, churchId);
        return res.json({
          success: true,
          equipment: normalizeServiceEquipmentCatalog(church?.serviceEquipment),
        });
      } catch (error) {
        return sendTeamsJsonError(
          res,
          error,
          "Could not load service equipment.",
        );
      }
    },

    async saveServiceEquipment(req, res) {
      try {
        await assertCsrf(req);
        const churchId = req.params.churchId;
        const admin = await requireServicesEdit(req, churchId);
        const rawEquipment = req.body?.equipment;
        if (!Array.isArray(rawEquipment)) {
          throw httpError(400, "Equipment must be a list.");
        }
        if (
          rawEquipment.some(
            (item) =>
              !item ||
              item.category !== "iem" ||
              !normalizeServiceEquipment(item),
          )
        ) {
          throw httpError(400, "Equipment category or name is invalid.");
        }
        const equipment = normalizeServiceEquipmentCatalog(req.body?.equipment);
        await setDoc(
          COLLECTIONS.churches,
          churchId,
          {
            serviceEquipment: equipment,
            updatedAt: nowIso(),
            updatedByUid: sessionActorUid(admin),
          },
          { merge: true },
        );
        return res.json({ success: true, equipment });
      } catch (error) {
        return sendTeamsJsonError(
          res,
          error,
          "Could not save service equipment.",
        );
      }
    },

    async publishServicePlan(req, res) {
      try {
        await assertCsrf(req);
        const churchId = req.params.churchId;
        const admin = await requireServicesEdit(req, churchId);
        const actorUid = sessionActorUid(admin);
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
          await ensureServicePlanPublicTokens(existing, actorUid, docId);
        const {
          teamToken: currentTeamToken,
          generalToken: currentGeneralToken,
        } = await ensureChurchCurrentServiceTokens(churchId, actorUid);
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
          updatedByUid: actorUid,
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

    async sendServicePlanShareEmail(req, res) {
      const churchId = req.params.churchId;
      const planKey = decodeURIComponent(req.params.planKey);
      let recipientCount = 0;
      try {
        await assertCsrf(req);
        const admin = await requireServicesEdit(req, churchId);
        const recipients = validateServicePlanEmailRecipients(
          req.body?.recipients,
        );
        recipientCount = recipients.length;
        const subject = validateServicePlanEmailText(
          req.body?.subject,
          "Subject",
          MAX_SERVICE_PLAN_EMAIL_SUBJECT_LENGTH,
        );
        const message = validateServicePlanEmailText(
          req.body?.message,
          "Message",
          MAX_SERVICE_PLAN_EMAIL_MESSAGE_LENGTH,
        );
        const shareVersion = validateServicePlanShareVersion(
          req.body?.shareVersion,
        );
        enforceRateLimit({
          scope: "service-plan-share-email",
          key: `${getClientIp(req)}:${churchId}`,
          limit: 10,
          windowMs: 60 * 60 * 1000,
          blockMs: 60 * 60 * 1000,
        });

        const servicePlan = await getDoc(
          COLLECTIONS.servicePlans,
          buildServicePlanDocId(churchId, planKey),
        );
        if (!servicePlan || servicePlan.churchId !== churchId) {
          throw httpError(404, "Service plan not found.");
        }
        if (!servicePlan.published) {
          throw httpError(
            400,
            "Enable shared links before emailing this service plan.",
          );
        }
        if (!emailDeliveryConfigured) {
          throw httpError(503, "Email is not configured on this server.");
        }
        const { publicLinkToken, publicGeneralLinkToken } =
          await ensureServicePlanPublicTokens(
            servicePlan,
            sessionActorUid(admin),
            buildServicePlanDocId(churchId, planKey),
          );

        // The server derives the trusted token from the requested version;
        // client-supplied URLs are never accepted.
        const shareToken =
          shareVersion === "detailed"
            ? publicLinkToken
            : publicGeneralLinkToken;
        const shareUrl = buildPublicServicePlanUrl(shareToken);
        const { html, text } = await renderServicePlanShareEmail({
          serviceName: String(servicePlan.name || "Service"),
          serviceDate: formatServicePlanEmailDate(
            servicePlan.date,
            servicePlan.startsAt,
          ),
          message,
          shareUrl,
        });

        const sendResults = await Promise.allSettled(
          recipients.map((to) =>
            sendEmail({
              to,
              subject,
              textBody: text,
              htmlBody: html,
              fromEmail: servicePlanFromEmail,
              tags: {
                type: "service_plan_share",
                churchId,
              },
            }),
          ),
        );
        const failedRecipients = sendResults.flatMap((result, index) =>
          result.status === "rejected" ? [recipients[index]] : [],
        );
        if (failedRecipients.length > 0) {
          const sentCount = recipients.length - failedRecipients.length;
          const firstFailure = sendResults.find(
            (result) => result.status === "rejected",
          );
          const errorMessage =
            firstFailure?.status === "rejected"
              ? firstFailure.reason?.message || "send failed"
              : "send failed";
          if (sentCount === 0) {
            logAuthEvent("warn", "service-plan.share-email.failed", {
              churchId,
              planKey,
              recipientCount: recipients.length,
              errorMessage,
            });
            return sendTeamsJsonError(
              res,
              httpError(502, "Could not send the service plan email."),
              "Could not send the service plan email.",
            );
          }
          logAuthEvent("warn", "service-plan.share-email.partial", {
            churchId,
            planKey,
            sentCount,
            failedCount: failedRecipients.length,
            errorMessage,
          });
          return res.json({
            success: false,
            sent: sentCount,
            failed: failedRecipients.length,
            failedRecipients,
          });
        }
        return res.json({
          success: true,
          sent: recipients.length,
          failed: 0,
          failedRecipients: [],
        });
      } catch (error) {
        if (Number(error?.statusCode || 500) >= 500) {
          logAuthEvent("warn", "service-plan.share-email.failed", {
            churchId,
            planKey,
            recipientCount,
            errorMessage: error?.message || "send failed",
          });
        }
        return sendTeamsJsonError(
          res,
          error,
          Number(error?.statusCode) === 503 && error?.message
            ? error.message
            : "Could not send the service plan email.",
        );
      }
    },

    async unpublishServicePlan(req, res) {
      try {
        await assertCsrf(req);
        const churchId = req.params.churchId;
        const admin = await requireServicesEdit(req, churchId);
        const actorUid = sessionActorUid(admin);
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
          { published: false, updatedAt: now, updatedByUid: actorUid },
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
        const actorUid = sessionActorUid(admin);
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
          { publicLive, updatedAt: now, updatedByUid: actorUid },
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
          const intakeForm = await getDoc(
            COLLECTIONS.teamIntakeForms,
            submission.formId,
          );
          const application = await applyTeamIntakeSubmissionToMember({
            submission,
            form: intakeForm,
            churchId: req.params.churchId,
            memberId: normalizeShortText(req.body?.memberId, { max: 160 }),
            createMember: Boolean(req.body?.createMember),
            adminUserId: admin.user.uid,
            now,
          });
          member = application.member;
          updatedTeams = application.updatedTeams;
          Object.assign(update, application.application);
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
        const changedOccurrenceId = String(req.body?.serviceId || "").trim();
        const changedCellKey = String(req.body?.positionSlotKey || "").trim();
        const previousCell =
          existing.assignments?.[changedOccurrenceId]?.[changedCellKey];
        const previousMemberId =
          typeof previousCell === "string"
            ? previousCell
            : previousCell?.primaryMemberId || "";
        const currentCell =
          schedule.assignments?.[changedOccurrenceId]?.[changedCellKey];
        const currentMemberId =
          typeof currentCell === "string"
            ? currentCell
            : currentCell?.primaryMemberId || "";
        if (schedule.sentAt && currentMemberId !== previousMemberId) {
          if (currentMemberId) {
            try {
              await closeResolvedReplacementInvitations({
                churchId: req.params.churchId,
                scheduleId: schedule.scheduleId,
                occurrenceId: changedOccurrenceId,
                cellKey: changedCellKey,
              });
            } catch (error) {
              console.error(
                "Could not close resolved replacement invitation",
                error,
              );
            }
          }
          try {
            if (previousMemberId) {
              await saveNotificationEventIntents({
                churchId: req.params.churchId,
                schedule,
                intentType: "schedule_change",
                entries: [
                  {
                    memberId: previousMemberId,
                    occurrenceId: changedOccurrenceId,
                    cellKey: changedCellKey,
                  },
                ],
              });
            }
            if (currentMemberId) {
              await saveNotificationEventIntents({
                churchId: req.params.churchId,
                schedule,
                intentType: "assignment_notification",
                entries: [
                  {
                    memberId: currentMemberId,
                    occurrenceId: changedOccurrenceId,
                    cellKey: changedCellKey,
                  },
                ],
              });
            }
          } catch (error) {
            console.error(
              "Could not record schedule assignment message previews",
              error,
            );
          }
        }
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
        const admin = await requireScheduleMicrophoneEdit(
          req,
          churchId,
          schedule.teamId,
        );
        const actorUid = sessionActorUid(admin);
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
        const validatedSlot = await assertSchedulePositionSlotExists({
          churchId,
          schedule,
          occurrenceId,
          positionSlotKey: slotKey,
          errorMessage: "Add this position before assigning microphones.",
        });
        const { slot, occurrence } = validatedSlot;
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
        const microphoneIds = normalizeIdArray(req.body?.microphoneIds);
        if (microphoneIds.length > 12) {
          throw httpError(400, "Choose no more than 12 microphones.");
        }
        if (
          microphoneIds.some(
            (microphoneId) => !knownMicrophoneIds.has(microphoneId),
          )
        ) {
          throw httpError(
            409,
            "One or more microphones are no longer available. Reload and try again.",
          );
        }
        const applyMicrophoneAssignment = (currentSchedule) => {
          const microphoneAssignments =
            normalizeTeamScheduleMicrophoneAssignments(
              currentSchedule.microphoneAssignments,
            );
          const row = { ...(microphoneAssignments[occurrenceId] || {}) };
          if (microphoneIds.length) row[slotKey] = microphoneIds;
          else delete row[slotKey];
          if (Object.keys(row).length)
            microphoneAssignments[occurrenceId] = row;
          else delete microphoneAssignments[occurrenceId];
          return {
            microphoneAssignments,
            updatedAt: nowIso(),
            updatedByUid: actorUid,
          };
        };
        const db = requireFirestore();
        let updatedSchedule;
        if (db) {
          // Microphone controls can be used simultaneously from another
          // browser or device. Re-read and replace the map inside a
          // transaction so a late save cannot restore an older map snapshot.
          updatedSchedule = await db.runTransaction(async (transaction) => {
            const scheduleRef = db
              .collection(COLLECTIONS.teamSchedules)
              .doc(schedule.scheduleId);
            const snapshot = await transaction.get(scheduleRef);
            const currentSchedule = readTransactionTeamEntity(
              snapshot,
              "scheduleId",
              "Schedule",
              { active: false },
            );
            if (currentSchedule.churchId !== churchId) {
              throw httpError(404, "Schedule not found.");
            }
            if (currentSchedule.teamId !== schedule.teamId) {
              throw httpError(
                409,
                "This schedule changed. Reload and try again.",
              );
            }
            await assertSchedulePositionSlotExists({
              churchId,
              schedule: currentSchedule,
              occurrenceId,
              positionSlotKey: slotKey,
              errorMessage:
                "This position slot was removed. Reload the schedule and try again.",
              staleSchedule: true,
            });
            const update = applyMicrophoneAssignment(currentSchedule);
            transaction.update(scheduleRef, update);
            return { ...currentSchedule, ...update };
          });
        } else {
          updatedSchedule = await enqueueInMemoryScheduleSave(
            schedule.scheduleId,
            async () => {
              const currentSchedule = await assertTeamEntityInChurch(
                "schedule",
                schedule.scheduleId,
                churchId,
                { label: "Schedule", active: false },
              );
              if (currentSchedule.teamId !== schedule.teamId) {
                throw httpError(
                  409,
                  "This schedule changed. Reload and try again.",
                );
              }
              await assertSchedulePositionSlotExists({
                churchId,
                schedule: currentSchedule,
                occurrenceId,
                positionSlotKey: slotKey,
                errorMessage:
                  "This position slot was removed. Reload the schedule and try again.",
                staleSchedule: true,
              });
              const update = applyMicrophoneAssignment(currentSchedule);
              await setDoc(
                COLLECTIONS.teamSchedules,
                schedule.scheduleId,
                update,
                {
                  merge: true,
                },
              );
              return { ...currentSchedule, ...update };
            },
          );
        }
        emitTeamsEvent(churchId, "schedule-updated", {
          schedule: updatedSchedule,
        });
        await emitPublicPlansForScheduleOccurrence({
          churchId,
          occurrence,
          revision: updatedSchedule.updatedAt,
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

    async updateTeamScheduleAssignmentIems(req, res) {
      try {
        await assertCsrf(req);
        const churchId = req.params.churchId;
        const schedule = await assertTeamEntityInChurch(
          "schedule",
          req.params.scheduleId,
          churchId,
          { label: "Schedule", active: false },
        );
        const admin = await requireScheduleMicrophoneEdit(
          req,
          churchId,
          schedule.teamId,
        );
        const actorUid = sessionActorUid(admin);
        const team = await assertTeamEntityInChurch(
          "team",
          schedule.teamId,
          churchId,
          {
            label: "Team",
          },
        );
        if (!team.usesIemAssignments) {
          throw httpError(400, "This team does not use IEM assignments.");
        }
        const occurrenceId = normalizeShortText(req.body?.serviceId, {
          max: 260,
        });
        const slotKey = normalizeShortText(req.body?.positionSlotKey, {
          max: 260,
        });
        const validatedSlot = await assertSchedulePositionSlotExists({
          churchId,
          schedule,
          occurrenceId,
          positionSlotKey: slotKey,
          errorMessage: "Add this position before assigning IEMs.",
        });
        const { slot, occurrence } = validatedSlot;
        const position = await assertTeamEntityInChurch(
          "position",
          slot.positionId,
          churchId,
          { label: "Position" },
        );
        assertSchedulePositionForTeam({ churchId, team, position });
        const church = await getDoc(COLLECTIONS.churches, churchId);
        const knownIemIds = new Set(
          normalizeServiceEquipmentCatalog(church?.serviceEquipment)
            .filter((item) => item.category === "iem")
            .map((item) => item.id),
        );
        const iemIds = normalizeIdArray(req.body?.iemIds);
        if (iemIds.length > 12) {
          throw httpError(400, "Choose no more than 12 IEMs.");
        }
        if (iemIds.some((iemId) => !knownIemIds.has(iemId))) {
          throw httpError(
            409,
            "One or more IEMs are no longer available. Reload and try again.",
          );
        }
        const applyIEMAssignment = (currentSchedule) => {
          const iemAssignments = normalizeTeamScheduleIemAssignments(
            currentSchedule.iemAssignments,
          );
          const row = { ...(iemAssignments[occurrenceId] || {}) };
          if (iemIds.length) row[slotKey] = iemIds;
          else delete row[slotKey];
          if (Object.keys(row).length) iemAssignments[occurrenceId] = row;
          else delete iemAssignments[occurrenceId];
          return {
            iemAssignments,
            updatedAt: nowIso(),
            updatedByUid: actorUid,
          };
        };
        const db = requireFirestore();
        let updatedSchedule;
        if (db) {
          // IEM controls can be used simultaneously from another
          // browser or device. Re-read and replace the map inside a
          // transaction so a late save cannot restore an older map snapshot.
          updatedSchedule = await db.runTransaction(async (transaction) => {
            const scheduleRef = db
              .collection(COLLECTIONS.teamSchedules)
              .doc(schedule.scheduleId);
            const snapshot = await transaction.get(scheduleRef);
            const currentSchedule = readTransactionTeamEntity(
              snapshot,
              "scheduleId",
              "Schedule",
              { active: false },
            );
            if (currentSchedule.churchId !== churchId) {
              throw httpError(404, "Schedule not found.");
            }
            if (currentSchedule.teamId !== schedule.teamId) {
              throw httpError(
                409,
                "This schedule changed. Reload and try again.",
              );
            }
            await assertSchedulePositionSlotExists({
              churchId,
              schedule: currentSchedule,
              occurrenceId,
              positionSlotKey: slotKey,
              errorMessage:
                "This position slot was removed. Reload the schedule and try again.",
              staleSchedule: true,
            });
            const update = applyIEMAssignment(currentSchedule);
            transaction.update(scheduleRef, update);
            return { ...currentSchedule, ...update };
          });
        } else {
          updatedSchedule = await enqueueInMemoryScheduleSave(
            schedule.scheduleId,
            async () => {
              const currentSchedule = await assertTeamEntityInChurch(
                "schedule",
                schedule.scheduleId,
                churchId,
                { label: "Schedule", active: false },
              );
              if (currentSchedule.teamId !== schedule.teamId) {
                throw httpError(
                  409,
                  "This schedule changed. Reload and try again.",
                );
              }
              await assertSchedulePositionSlotExists({
                churchId,
                schedule: currentSchedule,
                occurrenceId,
                positionSlotKey: slotKey,
                errorMessage:
                  "This position slot was removed. Reload the schedule and try again.",
                staleSchedule: true,
              });
              const update = applyIEMAssignment(currentSchedule);
              await setDoc(
                COLLECTIONS.teamSchedules,
                schedule.scheduleId,
                update,
                {
                  merge: true,
                },
              );
              return { ...currentSchedule, ...update };
            },
          );
        }
        emitTeamsEvent(churchId, "schedule-updated", {
          schedule: updatedSchedule,
        });
        await emitPublicPlansForScheduleOccurrence({
          churchId,
          occurrence,
          revision: updatedSchedule.updatedAt,
        });
        return res.json({ success: true, schedule: updatedSchedule });
      } catch (error) {
        return sendTeamsJsonError(
          res,
          error,
          "Could not update IEM assignments.",
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
        const normalizedSlotKey = makeScheduleSlotKey(slot.positionId, slot.slot);
        const buildUpdate = async (currentSchedule, currentTeam, currentPosition) => {
          if (currentSchedule.churchId !== churchId || currentSchedule.teamId !== schedule.teamId) {
            throw httpError(409, "This schedule changed. Reload and try again.");
          }
          assertScheduleRowContains(currentSchedule, occurrenceId);
          const occurrence = (currentSchedule.occurrences || []).find(
            (item) => item.occurrenceId === occurrenceId,
          );
          if (!occurrence) throw httpError(400, "That service is not on this schedule.");
          const requirements = await resolveScheduleOccurrenceRequirements({ churchId, occurrence });
          const requirement = requirements.find((item) => item?.positionId === slot.positionId);
          const requiredCount = Math.max(0, Math.floor(Number(requirement?.count) || 0));
          if (slot.slot < requiredCount || slot.slot > 99) {
            throw httpError(400, "That additional position slot is not available for this service.");
          }
          assertSchedulePositionForTeam({ churchId, team: currentTeam, position: currentPosition });
          const additionalPositionSlots = normalizeTeamScheduleAdditionalPositionSlots(
            currentSchedule.additionalPositionSlots ?? currentSchedule.optionalPositionSlots,
          );
          const row = new Set(additionalPositionSlots[occurrenceId] || []);
          row.add(normalizedSlotKey);
          additionalPositionSlots[occurrenceId] = [...row];
          return {
            additionalPositionSlots,
            updatedAt: nowIso(),
            updatedByUid: admin.user.uid,
          };
        };
        const db = requireFirestore();
        let updatedSchedule;
        if (db) {
          updatedSchedule = await db.runTransaction(async (transaction) => {
            const scheduleRef = db.collection(COLLECTIONS.teamSchedules).doc(schedule.scheduleId);
            const teamRef = db.collection(COLLECTIONS.teams).doc(schedule.teamId);
            const positionRef = db.collection(COLLECTIONS.teamPositions).doc(slot.positionId);
            const [scheduleSnapshot, teamSnapshot, positionSnapshot] = await Promise.all([
              transaction.get(scheduleRef),
              transaction.get(teamRef),
              transaction.get(positionRef),
            ]);
            const currentSchedule = readTransactionTeamEntity(scheduleSnapshot, "scheduleId", "Schedule", { active: false });
            const currentTeam = readTransactionTeamEntity(teamSnapshot, "teamId", "Team");
            const currentPosition = readTransactionTeamEntity(positionSnapshot, "positionId", "Position");
            const update = await buildUpdate(currentSchedule, currentTeam, currentPosition);
            transaction.update(scheduleRef, update);
            return { ...currentSchedule, ...update };
          });
        } else {
          updatedSchedule = await enqueueInMemoryScheduleSave(schedule.scheduleId, async () => {
            const currentSchedule = await assertTeamEntityInChurch("schedule", schedule.scheduleId, churchId, { label: "Schedule", active: false });
            const currentTeam = await assertTeamEntityInChurch("team", currentSchedule.teamId, churchId, { label: "Team" });
            const currentPosition = await assertTeamEntityInChurch("position", slot.positionId, churchId, { label: "Position" });
            const update = await buildUpdate(currentSchedule, currentTeam, currentPosition);
            const nextSchedule = { ...currentSchedule, ...update };
            await setDoc(COLLECTIONS.teamSchedules, schedule.scheduleId, nextSchedule, { merge: false });
            return nextSchedule;
          });
        }
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
          const iemAssignments = normalizeTeamScheduleIemAssignments(
            schedule.iemAssignments,
          );
          if (iemAssignments[occurrenceId]) {
            delete iemAssignments[occurrenceId][normalizedSlotKey];
            if (Object.keys(iemAssignments[occurrenceId]).length === 0)
              delete iemAssignments[occurrenceId];
          }
          return {
            additionalPositionSlots,
            assignments,
            microphoneAssignments,
            iemAssignments,
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
          schedule = await enqueueInMemoryScheduleSave(
            existing.scheduleId,
            async () => {
              const current = await assertTeamEntityInChurch(
                "schedule",
                existing.scheduleId,
                churchId,
                { label: "Schedule", active: false },
              );
              const update = buildUpdate(current);
              const nextSchedule = { ...current, ...update };
              await setDoc(
                COLLECTIONS.teamSchedules,
                existing.scheduleId,
                nextSchedule,
                { merge: false },
              );
              return nextSchedule;
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

    async updateTeamScheduleAssignmentsBatch(req, res) {
      try {
        await assertCsrf(req);
        const existing = await assertTeamEntityInChurch(
          "schedule",
          req.params.scheduleId,
          req.params.churchId,
          { label: "Schedule", active: false },
        );
        const admin = await requireTeamsEditForTeam(req, req.params.churchId, existing.teamId);
        const rawChanges = req.body?.changes;
        if (!Array.isArray(rawChanges) || rawChanges.length === 0 || rawChanges.length > 250) {
          throw httpError(400, "Assignment changes must contain between 1 and 250 cells.");
        }
        const seen = new Set();
        const changes = rawChanges.map((raw) => {
          const serviceId = normalizeShortText(raw?.serviceId, { max: 260 });
          const positionSlotKey = normalizeShortText(raw?.positionSlotKey, { max: 260 });
          if (!serviceId || !positionSlotKey || !parseScheduleSlotKey(positionSlotKey)) {
            throw httpError(400, "An assignment cell is invalid.");
          }
          const key = `${serviceId}\u0000${positionSlotKey}`;
          if (seen.has(key)) throw httpError(400, "An assignment cell was included more than once.");
          seen.add(key);
          return {
            serviceId,
            positionSlotKey,
            serviceDate: normalizeOptionalPlainDate(raw?.serviceDate, "Service date"),
            expectedCell: raw?.expectedCell || "",
            assignment: raw?.assignment || "",
          };
        });
        const result = await updateTeamScheduleAssignmentsBatchInStore({
          churchId: req.params.churchId,
          scheduleId: req.params.scheduleId,
          changes,
          confirmedFingerprint: normalizeAllowOccurrenceConflict(req.body),
          skipChangedCells: req.body?.skipChangedCells === true,
          adminUserId: admin.user.uid,
        });
        emitTeamsEvent(req.params.churchId, "schedule-updated", { schedule: result.schedule });
        return res.json({ success: true, ...result });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not update these assignments.");
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
            (item) =>
              item.occurrenceId === String(req.body?.serviceId || "").trim(),
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
