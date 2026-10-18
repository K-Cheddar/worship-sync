import {
  applyAssignmentResponses,
  readAssignmentCellHolderId,
} from "./scheduleResponses.js";

// Internal operations only. Callers must resolve identity from a validated
// principal, never deserialize it from a request body. Human and personal-link
// callers share these commit-time membership/publication checks.
export const createVolunteerMutations = ({
  COLLECTIONS, requireFirestore, getDoc, updateDocFields, nowIso, httpError,
  enqueueSchedule, enqueueMember,
}) => {
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
      throw httpError(404, "Your member record is no longer available.");
    }
    if (member.archivedAt) {
      throw httpError(403, "Your member record is archived. Ask an admin to restore it.");
    }
    if (actorUid && member.userId !== actorUid) {
      throw httpError(403, "Your account link changed. Reload My Schedule.");
    }
  };

  const writeAssignmentResponses = async ({
    churchId, scheduleId, memberId, targets, response, actorUid,
    pendingOnly = false, authorize, actorId,
  }) => {
    const db = requireFirestore();
    const mutate = async (transaction) => {
      await authorize?.(transaction);
      const scheduleRef = db?.collection(COLLECTIONS.teamSchedules).doc(scheduleId);
      const memberRef = db?.collection(COLLECTIONS.teamRosterMembers).doc(memberId);
      const read = async (collection, id, ref) => {
        if (!transaction) return getDoc(collection, id);
        const snapshot = await transaction.get(ref);
        return snapshot.exists ? snapshot.data() : null;
      };
      const schedule = await read(COLLECTIONS.teamSchedules, scheduleId, scheduleRef);
      if (!schedule || schedule.churchId !== churchId || schedule.archivedAt ||
          schedule.published === false || (schedule.scheduleId && schedule.scheduleId !== scheduleId)) {
        throw httpError(404, "That schedule is no longer available.");
      }
      const member = await read(COLLECTIONS.teamRosterMembers, memberId, memberRef);
      // Existing schedule-specific email links also support schedule guests.
      // An account principal can never claim a guest record.
      if (member || actorUid || !(schedule.guests || []).some((guest) => guest.guestId === memberId)) {
        assertMember(member, { churchId, memberId, actorUid });
      }
      const currentTargets = targets || Object.entries(schedule.assignments || {})
        .flatMap(([occurrenceId, row]) => Object.keys(row || {})
          .map((cellKey) => ({ occurrenceId, cellKey })));
      const { responses, applied } = applyAssignmentResponses(schedule, {
        memberId, targets: currentTargets, response, pendingOnly,
        respondedAt: nowIso(), readHolder: readAssignmentCellHolderId,
      });
      if (!applied) {
        if (pendingOnly) return { schedule: { scheduleId, ...schedule }, applied: 0 };
        throw httpError(409, "This assignment changed. Your team lead will be in touch.");
      }
      const patch = {
        responses, updatedAt: nextUpdatedAt(schedule.updatedAt),
        ...(actorUid || actorId ? { updatedByUid: actorUid || actorId } : {}),
      };
      // Replace the field, not a recursive merge of response rows.
      if (transaction) transaction.update(scheduleRef, patch);
      else await updateDocFields(COLLECTIONS.teamSchedules, scheduleId, patch);
      return { schedule: { scheduleId, ...schedule, ...patch }, applied };
    };
    return db
      ? db.runTransaction(mutate)
      : enqueueSchedule(scheduleId, () => mutate(null));
  };

  const saveBlockouts = async ({
    churchId, memberId, actorUid, blockoutDates, expectedUpdatedAt, authorize, actorId,
  }) => {
    const db = requireFirestore();
    const mutate = async (transaction) => {
      await authorize?.(transaction);
      const ref = db?.collection(COLLECTIONS.teamRosterMembers).doc(memberId);
      const snapshot = transaction ? await transaction.get(ref) : null;
      const member = transaction
        ? (snapshot.exists ? snapshot.data() : null)
        : await getDoc(COLLECTIONS.teamRosterMembers, memberId);
      assertMember(member, { churchId, memberId, actorUid });
      if (member.updatedAt && expectedUpdatedAt !== member.updatedAt) {
        throw httpError(409, "Your time off changed somewhere else. Check the dates and save again.");
      }
      const patch = {
        blockoutDates, updatedAt: nextUpdatedAt(member.updatedAt),
        ...(actorUid || actorId ? { updatedByUid: actorUid || actorId } : {}),
      };
      if (transaction) transaction.update(ref, patch);
      else await updateDocFields(COLLECTIONS.teamRosterMembers, memberId, patch);
      return {
        previousRanges: member.blockoutDates || [],
        member: { memberId, ...member, ...patch },
      };
    };
    return db
      ? db.runTransaction(mutate)
      : enqueueMember(memberId, () => mutate(null));
  };

  return { writeAssignmentResponses, saveBlockouts };
};
