/**
 * Accept / decline state for schedule assignments.
 *
 * Stored as a sibling map on the schedule — `schedule.responses[occurrenceId]
 * [cellKey]` — rather than inside the assignment cell. The cell is load-bearing
 * in a way that makes it a bad place to grow: it is sometimes a bare member-id
 * string (legacy rows), sometimes `{ primaryMemberId, shadows }`, and it is read
 * or rewritten by autofill, row paste, cascade deletion, and the public
 * schedule. Widening it would put all of that in the blast radius of a feature
 * none of it cares about.
 *
 * Each record carries the `memberId` it belongs to. That is the whole point of
 * the shape: an owner who reassigns a slot must not inherit the previous
 * person's "accepted". A response whose member no longer holds the slot is
 * **stale**, and reads as no response at all.
 */

const RESPONSE_VALUES = new Set(["pending", "accepted", "declined"]);

/**
 * Schedule visibility for volunteer self-service and schedule-specific
 * response links. Publication belongs to the schedule document; service-plan
 * publication remains a separate concern. Missing publication metadata keeps
 * the established Published behavior for legacy schedules.
 */
export const isVolunteerScheduleVisible = (schedule) =>
  Boolean(schedule && !schedule.archivedAt && schedule.published !== false);

/**
 * The member who holds an assignment cell.
 *
 * Lives here, and is shared by everything that has to read a cell, because the
 * shape has two forms — a bare member-id string on legacy rows, and
 * `{ primaryMemberId, shadows }` on the rest. A second copy of this that only
 * handled one form would fail silently on exactly the older churches.
 */
export const readAssignmentCellHolderId = (cell) =>
  typeof cell === "string" ? cell : cell?.primaryMemberId || "";

/**
 * Absence is the normal state — most assignments are never answered — so it
 * normalizes to "pending" rather than being an error. Unknown values also
 * become "pending": an unreadable answer must not be mistaken for a real one.
 * @param {unknown} value
 * @returns {"pending" | "accepted" | "declined"}
 */
export const normalizeAssignmentResponse = (value) => {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return RESPONSE_VALUES.has(normalized) ? normalized : "pending";
};

/**
 * A response only counts for the member who currently holds the slot.
 * @param {{ memberId?: string, response?: unknown, respondedAt?: string } | null | undefined} record
 * @param {string} memberId
 * @returns {{ response: "pending" | "accepted" | "declined", respondedAt: string }}
 */
export const readAssignmentResponse = (record, memberId) => {
  const holder = String(memberId || "");
  if (!record || !holder || String(record.memberId || "") !== holder) {
    return { response: "pending", respondedAt: "" };
  }
  return {
    response: normalizeAssignmentResponse(record.response),
    respondedAt: String(record.respondedAt || ""),
  };
};

/** Whole-schedule normalizer; drops empty rows so the doc does not accrete keys. */
export const normalizeScheduleResponses = (responses) => {
  const result = {};
  for (const [occurrenceId, row] of Object.entries(responses || {})) {
    if (!occurrenceId || !row || typeof row !== "object") continue;
    const nextRow = {};
    for (const [cellKey, record] of Object.entries(row)) {
      const memberId = String(record?.memberId || "");
      if (!cellKey || !memberId) continue;
      nextRow[cellKey] = {
        memberId,
        response: normalizeAssignmentResponse(record?.response),
        respondedAt: String(record?.respondedAt || ""),
      };
    }
    if (Object.keys(nextRow).length > 0) result[occurrenceId] = nextRow;
  }
  return result;
};

/**
 * Record one answer, replacing any previous one for that slot.
 * Returns a new responses map; never mutates the input.
 */
export const withAssignmentResponse = (
  responses,
  { occurrenceId, cellKey, memberId, response, respondedAt },
) => {
  const normalized = normalizeScheduleResponses(responses);
  const row = { ...(normalized[occurrenceId] || {}) };
  row[cellKey] = {
    memberId: String(memberId || ""),
    response: normalizeAssignmentResponse(response),
    respondedAt: String(respondedAt || ""),
  };
  return { ...normalized, [occurrenceId]: row };
};

/**
 * Drop responses whose slot no longer belongs to that member — reassigned,
 * cleared, or deleted. Called when assignments change so the map cannot grow
 * a tail of answers about slots nobody holds.
 * @param {object} responses
 * @param {(occurrenceId: string, cellKey: string) => string} readHolder
 */
export const pruneStaleResponses = (responses, readHolder) => {
  const result = {};
  for (const [occurrenceId, row] of Object.entries(
    normalizeScheduleResponses(responses),
  )) {
    const nextRow = {};
    for (const [cellKey, record] of Object.entries(row)) {
      if (readHolder(occurrenceId, cellKey) === record.memberId) {
        nextRow[cellKey] = record;
      }
    }
    if (Object.keys(nextRow).length > 0) result[occurrenceId] = nextRow;
  }
  return result;
};

/**
 * Decide what a batch of answers becomes, given the schedule as read.
 *
 * Pulled out of the writer deliberately. That writer has two branches — a
 * Firestore transaction and an in-memory fallback — and **the suite only ever
 * exercises the fallback** (`skipUnlessInMemoryAuth`), so any logic living
 * inside the transaction branch is untested by construction. Keeping the
 * decision here means both branches share tested code and the untested part is
 * reduced to Firestore's own read/write, which is not our logic to verify.
 *
 * Slots the member no longer holds are skipped rather than failing the batch:
 * with one link covering a whole schedule, an owner reshuffling one date must
 * not block the reader answering the rest.
 *
 * @param {{ assignments?: object, responses?: object }} schedule
 * @param {{ memberId: string, targets: Array<{occurrenceId: string, cellKey: string}>, response: string, respondedAt: string, readHolder: (cell: unknown) => string }} params
 * @returns {{ responses: object, applied: number }}
 */
export const applyAssignmentResponses = (
  schedule,
  { memberId, targets, response, respondedAt, readHolder },
) => {
  const applicable = (targets || []).filter(
    ({ occurrenceId, cellKey }) =>
      readHolder(schedule?.assignments?.[occurrenceId]?.[cellKey]) === memberId,
  );
  let responses = schedule?.responses;
  applicable.forEach(({ occurrenceId, cellKey }) => {
    responses = withAssignmentResponse(responses, {
      occurrenceId,
      cellKey,
      memberId,
      response,
      respondedAt,
    });
  });
  return {
    responses: responses || normalizeScheduleResponses(schedule?.responses),
    applied: applicable.length,
  };
};

/**
 * Accept only slots that are pending for their current primary holder.
 * Unlike `applyAssignmentResponses`, this operation never replaces a real
 * answer. A stale answer from a prior holder reads as pending through the
 * shared response reader. Only touched response rows/cells are cloned so an
 * unrelated legacy record is not normalized as a side effect.
 *
 * @param {{ assignments?: object, responses?: object }} schedule
 * @param {{ memberId: string, targets: Array<{occurrenceId: string, cellKey: string}>, respondedAt: string }} params
 * @returns {{ responses: object, outcomes: Array<{occurrenceId: string, cellKey: string, status: string}>, newlyAccepted: number, alreadyAccepted: number, alreadyDeclined: number, skipped: number, changed: boolean }}
 */
export const applyPendingAssignmentResponses = (
  schedule,
  { memberId, targets, respondedAt },
) => {
  const holderId = String(memberId || "");
  const seen = new Set();
  const uniqueTargets = (targets || []).filter(({ occurrenceId, cellKey }) => {
    const key = `${String(occurrenceId || "")}\u0000${String(cellKey || "")}`;
    if (!occurrenceId || !cellKey || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  let responses = schedule?.responses && typeof schedule.responses === "object" && !Array.isArray(schedule.responses)
    ? schedule.responses
    : {};
  const outcomes = [];
  let newlyAccepted = 0;
  let alreadyAccepted = 0;
  let alreadyDeclined = 0;
  let skipped = 0;

  uniqueTargets.forEach(({ occurrenceId, cellKey }) => {
    const target = { occurrenceId, cellKey };
    const currentHolder = readAssignmentCellHolderId(
      schedule?.assignments?.[occurrenceId]?.[cellKey],
    );
    if (!holderId || currentHolder !== holderId) {
      outcomes.push({ ...target, status: "skipped" });
      skipped += 1;
      return;
    }

    const current = readAssignmentResponse(
      responses?.[occurrenceId]?.[cellKey],
      holderId,
    );
    if (current.response === "accepted") {
      outcomes.push({ ...target, status: "already_accepted" });
      alreadyAccepted += 1;
      return;
    }
    if (current.response === "declined") {
      outcomes.push({ ...target, status: "already_declined" });
      alreadyDeclined += 1;
      return;
    }

    responses = {
      ...responses,
      [occurrenceId]: {
        ...(responses?.[occurrenceId] && typeof responses[occurrenceId] === "object"
          ? responses[occurrenceId]
          : {}),
        [cellKey]: {
          ...(responses?.[occurrenceId]?.[cellKey]?.memberId === holderId
            ? responses[occurrenceId][cellKey]
            : {}),
          memberId: holderId,
          response: "accepted",
          respondedAt: String(respondedAt || ""),
        },
      },
    };
    outcomes.push({ ...target, status: "accepted" });
    newlyAccepted += 1;
  });

  return {
    responses,
    outcomes,
    newlyAccepted,
    alreadyAccepted,
    alreadyDeclined,
    skipped,
    changed: newlyAccepted > 0,
  };
};
