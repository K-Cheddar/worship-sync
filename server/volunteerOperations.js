import {
  applyAssignmentResponses,
  isVolunteerScheduleVisible,
  readAssignmentCellHolderId,
} from "./scheduleResponses.js";

const memberNotAvailable = () =>
  Object.assign(new Error("Your member record is no longer available."), { statusCode: 404 });

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
  updateDocFields,
  nowIso,
  httpError,
  enqueueSchedule,
  enqueueMember,
  normalizeBlockoutDates = (value) => Array.isArray(value) ? value : [],
  blockoutHistoryRetentionDays = 365,
  maxUpcomingBlockoutRanges = 100,
  maxBlockoutRanges = 400,
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

  return { saveBlockouts, writeAssignmentResponses };
};
