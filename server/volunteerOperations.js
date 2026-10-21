import {
  applyAssignmentResponses,
  applyPendingAssignmentResponses,
  isVolunteerScheduleVisible,
  readAssignmentCellHolderId,
  readAssignmentResponse,
} from "./scheduleResponses.js";
import {
  volunteerAccountLockKeys,
  withVolunteerIdentityMutationLocks,
} from "./volunteerIdentity.js";

const memberNotAvailable = () =>
  Object.assign(new Error("Your member record is no longer available."), { statusCode: 404 });

const ACCEPT_PENDING_DISCOVERY_PAGE_SIZE = 100;

const scheduleNotAvailable = () =>
  Object.assign(new Error("That schedule is no longer available."), { statusCode: 404 });

/**
 * Persistence operations shared by trusted volunteer identities. The caller
 * resolves authentication; this module rechecks identity and current ownership
 * at the Firestore commit boundary.
 */
export const createVolunteerOperations = ({
  COLLECTIONS,
  requireFirestore,
  getDoc,
  queryDocs,
  updateDocFields,
  nowIso,
  httpError,
  enqueueSchedule,
  enqueueMember,
  normalizeBlockoutDates = (value) => Array.isArray(value) ? value : [],
  blockoutHistoryRetentionDays = 365,
  maxUpcomingBlockoutRanges = 100,
  maxBlockoutRanges = 400,
  maxScheduleGroupsPerRequest = 25,
}) => {
  const error = httpError || ((statusCode, message) => Object.assign(new Error(message), { statusCode }));

  const nextUpdatedAt = (previous) => {
    const current = nowIso();
    const previousMs = Date.parse(previous);
    return Number.isFinite(previousMs) && previousMs >= Date.parse(current)
      ? new Date(previousMs + 1).toISOString()
      : current;
  };

  const assertMember = (member, { churchId, memberId, actorUid }) => {
    if (!member || member.churchId !== churchId ||
        (member.memberId && member.memberId !== memberId)) {
      throw error(404, "Your member record is no longer available.");
    }
    if (member.archivedAt) {
      throw error(403, "Your member record is archived. Ask an admin to restore it.");
    }
    if (actorUid && member.userId !== actorUid) {
      throw error(403, "Your account link changed. Reload My Schedule.");
    }
  };

  const saveBlockouts = async ({
    churchId,
    memberId,
    actorUid,
    blockoutDates: submittedBlockouts,
    expectedUpdatedAt,
  }) => {
    const submitted = normalizeBlockoutDates(submittedBlockouts);
    const retentionCutoff = new Date(
      Date.now() - blockoutHistoryRetentionDays * 24 * 60 * 60 * 1000,
    ).toISOString().slice(0, 10);
    const blockoutDates = submitted.filter(
      (range) => (range.endDate || range.startDate) >= retentionCutoff,
    );
    const today = nowIso().slice(0, 10);
    const upcoming = blockoutDates.filter(
      (range) => (range.endDate || range.startDate) >= today,
    );
    if (upcoming.length > maxUpcomingBlockoutRanges) {
      throw error(400, `That is over ${maxUpcomingBlockoutRanges} upcoming blockout entries. Remove one before adding another.`);
    }
    if (blockoutDates.length > maxBlockoutRanges) {
      throw error(400, "That is too many blockout entries to store. Remove some old ones and try again.");
    }

    const db = requireFirestore();
    const mutate = async (transaction) => {
      const ref = db?.collection(COLLECTIONS.teamRosterMembers).doc(memberId);
      let member;
      if (transaction) {
        const snapshot = await transaction.get(ref);
        member = snapshot.exists ? snapshot.data() : null;
      } else {
        member = await getDoc(COLLECTIONS.teamRosterMembers, memberId);
      }
      assertMember(member, { churchId, memberId, actorUid });
      if (member.updatedAt && expectedUpdatedAt !== member.updatedAt) {
        throw error(409, "Your time off changed somewhere else. Check the dates and save again.");
      }

      // Deliberately patch only the availability and revision/audit fields.
      // In particular, this can never clear archivedAt or restore stale roster
      // permissions, qualifications, contacts, or account links.
      const patch = {
        blockoutDates,
        updatedAt: nextUpdatedAt(member.updatedAt),
        ...(actorUid ? { updatedByUid: actorUid } : {}),
      };
      if (transaction) transaction.update(ref, patch);
      else await updateDocFields(COLLECTIONS.teamRosterMembers, memberId, patch);

      return {
        previousRanges: member.blockoutDates || [],
        blockoutDates,
        member: { memberId, ...member, ...patch },
      };
    };

    return db
      ? db.runTransaction(mutate)
      : enqueueMember(memberId, () => mutate(null));
  };

  const writeAssignmentResponses = async ({
    churchId,
    scheduleId,
    memberId,
    targets,
    response,
    actorUid,
  }) => {
    const db = requireFirestore();
    const mutate = async (transaction) => {
      const scheduleRef = db?.collection(COLLECTIONS.teamSchedules).doc(scheduleId);
      const memberRef = db?.collection(COLLECTIONS.teamRosterMembers).doc(memberId);
      let schedule;
      let member;
      if (transaction) {
        const scheduleSnapshot = await transaction.get(scheduleRef);
        const memberSnapshot = await transaction.get(memberRef);
        schedule = scheduleSnapshot.exists ? scheduleSnapshot.data() : null;
        member = memberSnapshot.exists ? memberSnapshot.data() : null;
      } else {
        [schedule, member] = await Promise.all([
          getDoc(COLLECTIONS.teamSchedules, scheduleId),
          getDoc(COLLECTIONS.teamRosterMembers, memberId),
        ]);
      }

      if (!schedule || schedule.churchId !== churchId ||
          (schedule.scheduleId && schedule.scheduleId !== scheduleId) ||
          !isVolunteerScheduleVisible(schedule)) {
        throw scheduleNotAvailable();
      }
      if (member) {
        if (member.churchId !== churchId ||
            (member.memberId && member.memberId !== memberId) || member.archivedAt) {
          throw scheduleNotAvailable();
        }
        if (actorUid && member.userId !== actorUid) {
          throw error(403, "Your account link changed. Reload My Schedule.");
        }
      } else if (actorUid || !(schedule.guests || []).some((guest) => guest?.guestId === memberId)) {
        // A signed-in account always needs its roster link. A missing roster
        // record is valid only for the pre-existing schedule-scoped guest path.
        throw memberNotAvailable();
      }

      const { responses, applied } = applyAssignmentResponses(schedule, {
        memberId,
        targets,
        response,
        respondedAt: nowIso(),
        readHolder: readAssignmentCellHolderId,
      });
      if (!applied) {
        throw error(409, "This assignment changed. Your team lead will be in touch.");
      }

      const patch = {
        responses,
        updatedAt: nowIso(),
        ...(actorUid ? { updatedByUid: actorUid } : {}),
      };
      if (transaction) transaction.update(scheduleRef, patch);
      else await updateDocFields(COLLECTIONS.teamSchedules, scheduleId, patch);
      return { schedule: { scheduleId, ...schedule, ...patch }, applied };
    };

    return db
      ? db.runTransaction(mutate)
      : enqueueSchedule(scheduleId, () => mutate(null));
  };

  const upcomingPrimaryTargets = (schedule, memberId, nowMs) => {
    const occurrenceStartsAt = new Map(
      (Array.isArray(schedule?.occurrences) ? schedule.occurrences : [])
        .map((occurrence) => [
          String(occurrence?.occurrenceId || ""),
          Date.parse(String(occurrence?.startsAt || "")),
        ]),
    );
    const targets = [];
    Object.entries(schedule?.assignments || {}).forEach(([occurrenceId, cells]) => {
      const startsAt = occurrenceStartsAt.get(occurrenceId);
      if (!Number.isFinite(startsAt) || startsAt < nowMs) return;
      Object.entries(cells || {}).forEach(([cellKey, cell]) => {
        if (readAssignmentCellHolderId(cell) === memberId) {
          targets.push({ occurrenceId, cellKey });
        }
      });
    });
    return targets;
  };

  const identityChanged = (statusCode, message, code = "VOLUNTEER_IDENTITY_CHANGED") =>
    Object.assign(error(statusCode, message), { code });

  /**
   * Accept current pending primary assignments across published schedules.
   * Discovery is paged by schedule; each selected schedule has its own
   * transaction, so a failed schedule cannot roll back another schedule.
   */
  const acceptPendingAssignments = async ({
    churchId: rawChurchId,
    memberId: rawMemberId,
    actorUid: rawActorUid,
    afterScheduleId: rawAfterScheduleId,
  }) => {
    const churchId = String(rawChurchId || "").trim();
    const memberId = String(rawMemberId || "").trim();
    const actorUid = String(rawActorUid || "").trim();
    const afterScheduleId = String(rawAfterScheduleId || "").trim();
    if (!churchId || !memberId) {
      throw error(400, "A church and volunteer identity are required.");
    }
    if (typeof queryDocs !== "function") {
      throw new Error("Schedule listing is unavailable.");
    }

    const schedules = await queryDocs(
      COLLECTIONS.teamSchedules,
      [{ field: "churchId", value: churchId }],
      {
        limit: ACCEPT_PENDING_DISCOVERY_PAGE_SIZE,
        orderById: true,
        startAfterId: afterScheduleId,
        includeDocumentId: true,
      },
    );
    const discoveryNow = Date.parse(nowIso());
    const groups = schedules
      .map((schedule) => ({
        scheduleId: String(schedule?.documentId || schedule?.id || schedule?.scheduleId || ""),
        schedule,
      }))
      .filter(({ scheduleId, schedule }) =>
        scheduleId &&
        schedule?.churchId === churchId &&
        (!schedule.scheduleId || schedule.scheduleId === scheduleId) &&
        isVolunteerScheduleVisible(schedule),
      )
      .map(({ scheduleId, schedule }) => ({
        scheduleId,
        schedule,
        targets: upcomingPrimaryTargets(schedule, memberId, discoveryNow),
      }))
      .filter(({ schedule, targets }) =>
        targets.some(({ occurrenceId, cellKey }) =>
          readAssignmentResponse(
            schedule?.responses?.[occurrenceId]?.[cellKey],
            memberId,
          ).response === "pending"),
      )
      .map(({ scheduleId, targets }) => ({ scheduleId, targets }));

    const groupLimit = Math.max(1, Number(maxScheduleGroupsPerRequest) || 25);
    const pageGroups = groups.slice(0, groupLimit);
    const moreGroupsInScan = groups.length > pageGroups.length;
    const moreSchedulesToScan = schedules.length === ACCEPT_PENDING_DISCOVERY_PAGE_SIZE;
    const hasMore = moreGroupsInScan || moreSchedulesToScan;
    const nextCursor = moreGroupsInScan
      ? pageGroups.at(-1)?.scheduleId || null
      : moreSchedulesToScan
        ? String(schedules.at(-1)?.documentId || schedules.at(-1)?.id || schedules.at(-1)?.scheduleId || "") || null
        : null;
    const db = requireFirestore();
    const result = {
      newlyAccepted: 0,
      alreadyAccepted: 0,
      alreadyDeclined: 0,
      skipped: 0,
      failedScheduleCount: 0,
      schedules: [],
      updatedSchedules: [],
      authorizationChanged: false,
      hasMore,
      nextCursor,
    };

    const processGroup = async ({ scheduleId, targets }) => {
      const mutate = async (transaction) => {
        const scheduleRef = db?.collection(COLLECTIONS.teamSchedules).doc(scheduleId);
        const memberRef = db?.collection(COLLECTIONS.teamRosterMembers).doc(memberId);
        const membershipId = `${churchId}_${actorUid}`;
        const membershipRef = actorUid
          ? db?.collection(COLLECTIONS.memberships).doc(membershipId)
          : null;
        const linkedMembersQuery = actorUid
          ? db
            ?.collection(COLLECTIONS.teamRosterMembers)
            .where("churchId", "==", churchId)
            .where("userId", "==", actorUid)
            .limit(2)
          : null;

        let schedule;
        let member;
        let membership;
        let linkedMembers = [];
        if (transaction) {
          const [scheduleSnapshot, memberSnapshot, membershipSnapshot, linkedMembersSnapshot] =
            await Promise.all([
              transaction.get(scheduleRef),
              transaction.get(memberRef),
              actorUid ? transaction.get(membershipRef) : null,
              actorUid ? transaction.get(linkedMembersQuery) : null,
            ]);
          schedule = scheduleSnapshot.exists ? scheduleSnapshot.data() : null;
          member = memberSnapshot.exists ? memberSnapshot.data() : null;
          membership = membershipSnapshot?.exists ? membershipSnapshot.data() : null;
          linkedMembers = linkedMembersSnapshot?.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
          })) || [];
        } else {
          const [scheduleResult, memberResult, membershipResult, linkedMemberResults] =
            await Promise.all([
              getDoc(COLLECTIONS.teamSchedules, scheduleId),
              getDoc(COLLECTIONS.teamRosterMembers, memberId),
              actorUid
                ? getDoc(COLLECTIONS.memberships, membershipId)
                : null,
              actorUid
                ? queryDocs(COLLECTIONS.teamRosterMembers, [
                  { field: "churchId", value: churchId },
                  { field: "userId", value: actorUid },
                ], { limit: 2 })
                : [],
            ]);
          schedule = scheduleResult;
          member = memberResult;
          membership = membershipResult;
          linkedMembers = linkedMemberResults || [];
        }

        if (!member || member.churchId !== churchId ||
            (member.memberId && member.memberId !== memberId) || member.archivedAt) {
          throw identityChanged(403, "Your member record is no longer available. Reload My Schedule.");
        }
        if (actorUid) {
          if (member.userId !== actorUid) {
            throw identityChanged(403, "Your account link changed. Reload My Schedule.");
          }
          if (!membership || membership.churchId !== churchId ||
              membership.userId !== actorUid || membership.status !== "active") {
            throw identityChanged(403, "Your church membership changed. Reload My Schedule.");
          }
          if (linkedMembers.length !== 1 ||
              String(linkedMembers[0]?.id || linkedMembers[0]?.memberId || "") !== memberId) {
            throw identityChanged(409, "Your account has conflicting roster links here. Ask a church administrator to correct them, then try again.");
          }
        }

        if (!schedule || schedule.churchId !== churchId ||
            (schedule.scheduleId && schedule.scheduleId !== scheduleId) ||
            !isVolunteerScheduleVisible(schedule)) {
          return {
            scheduleId,
            status: "skipped",
            newlyAccepted: 0,
            alreadyAccepted: 0,
            alreadyDeclined: 0,
            skipped: targets.length,
            acceptedTargets: [],
            schedule: null,
          };
        }

        const currentTargets = upcomingPrimaryTargets(
          schedule,
          memberId,
          Date.parse(nowIso()),
        );
        const currentTargetKeys = new Set(
          currentTargets.map(({ occurrenceId, cellKey }) => `${occurrenceId}\u0000${cellKey}`),
        );
        const removedOrIneligible = targets.filter(
          ({ occurrenceId, cellKey }) =>
            !currentTargetKeys.has(`${occurrenceId}\u0000${cellKey}`),
        ).length;
        const decision = applyPendingAssignmentResponses(schedule, {
          memberId,
          targets: currentTargets,
          respondedAt: nowIso(),
        });
        const skipped = decision.skipped + removedOrIneligible;
        const acceptedTargets = decision.outcomes
          .filter((outcome) => outcome.status === "accepted")
          .map(({ occurrenceId, cellKey }) => ({ occurrenceId, cellKey }));
        let nextSchedule = schedule;
        if (decision.changed) {
          const patch = {
            responses: decision.responses,
            updatedAt: nowIso(),
            ...(actorUid ? { updatedByUid: actorUid } : {}),
          };
          if (transaction) transaction.update(scheduleRef, patch);
          else await updateDocFields(COLLECTIONS.teamSchedules, scheduleId, patch);
          nextSchedule = { scheduleId, ...schedule, ...patch };
        }

        return {
          scheduleId,
          status: decision.changed ? "updated" : skipped ? "skipped" : "unchanged",
          newlyAccepted: decision.newlyAccepted,
          alreadyAccepted: decision.alreadyAccepted,
          alreadyDeclined: decision.alreadyDeclined,
          skipped,
          acceptedTargets,
          schedule: decision.changed ? nextSchedule : null,
        };
      };

      return db
        ? db.runTransaction(mutate)
        : enqueueSchedule(scheduleId, () => mutate(null));
    };

    const executePage = async () => {
      for (let index = 0; index < pageGroups.length; index += 1) {
        const group = pageGroups[index];
        let outcome;
        try {
          outcome = await processGroup(group);
        } catch (caught) {
          outcome = {
            scheduleId: group.scheduleId,
            status: "failed",
            newlyAccepted: 0,
            alreadyAccepted: 0,
            alreadyDeclined: 0,
            skipped: 0,
            errorCode: caught?.code === "VOLUNTEER_IDENTITY_CHANGED"
              ? "identity_changed"
              : "schedule_failed",
          };
          if (caught?.code === "VOLUNTEER_IDENTITY_CHANGED") {
            result.authorizationChanged = true;
          }
        }
        result.schedules.push({
          scheduleId: outcome.scheduleId,
          status: outcome.status,
          newlyAccepted: outcome.newlyAccepted,
          alreadyAccepted: outcome.alreadyAccepted,
          alreadyDeclined: outcome.alreadyDeclined,
          skipped: outcome.skipped,
          ...(outcome.errorCode ? { errorCode: outcome.errorCode } : {}),
        });
        result.newlyAccepted += outcome.newlyAccepted;
        result.alreadyAccepted += outcome.alreadyAccepted;
        result.alreadyDeclined += outcome.alreadyDeclined;
        result.skipped += outcome.skipped;
        if (outcome.status === "failed") result.failedScheduleCount += 1;
        if (outcome.schedule) {
          result.updatedSchedules.push({
            scheduleId: outcome.scheduleId,
            schedule: outcome.schedule,
            acceptedTargets: outcome.acceptedTargets,
          });
        }
        if (result.authorizationChanged) {
          for (const remaining of pageGroups.slice(index + 1)) {
            result.schedules.push({
              scheduleId: remaining.scheduleId,
              status: "failed",
              newlyAccepted: 0,
              alreadyAccepted: 0,
              alreadyDeclined: 0,
              skipped: 0,
              errorCode: "identity_changed",
            });
            result.failedScheduleCount += 1;
          }
          break;
        }
      }
      return result;
    };

    return db
      ? executePage()
      : withVolunteerIdentityMutationLocks(
        volunteerAccountLockKeys(churchId, actorUid, memberId),
        executePage,
      );
  };

  return { saveBlockouts, writeAssignmentResponses, acceptPendingAssignments };
};
