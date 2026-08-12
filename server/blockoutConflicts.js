/**
 * "Someone just blocked out a date they are scheduled for."
 *
 * The notification counterpart to the amber flag the grid already draws. A
 * volunteer marking time off on `/my-schedule` is deliberately allowed to block
 * a date they are assigned to — refusing the save would leave an owner believing
 * a slot is covered. But that only works if the owner finds out, and nothing
 * else tells them: the person who made the change cannot see the schedule, and
 * the flag only appears to someone who happens to open the grid.
 *
 * **Why conflicts are recorded rather than recomputed.** The response digest
 * derives its entries by filtering `respondedAt >= since`, because a response
 * carries the moment it was given. A blockout range carries no timestamp, so
 * "what changed in this window" is not answerable from the roster alone.
 * Recomputing every current conflict instead would re-report the same unresolved
 * clash every time anyone in the church saved anything — a digest that nags.
 *
 * **But the record is a hint, not a source of truth.** Nothing here is trusted
 * at send time: `verifiedBlockoutConflicts` re-checks the live assignment and
 * the live blockout ranges, so a conflict the owner already fixed — or one the
 * member undid — silently drops out of the email. That is what keeps this from
 * becoming the parallel notification store the architecture rules out; the
 * authoritative facts stay `assignments` and `blockoutDates`.
 *
 * Deliberately **not** written as a fake `responses` record, which would be the
 * shortest path to reusing the digest: `pruneStaleResponses` would fight it, the
 * grid would draw a decline nobody gave, and fill counts would treat it as
 * answered.
 *
 * Pure and unit-tested. The caller supplies the cell reader and the roster.
 */

/** The grid keys blockouts off the calendar day, `TeamScheduleOccurrence.startsAt.slice(0, 10)`. */
export const occurrenceCalendarDate = (occurrence) =>
  String(occurrence?.startsAt || "").slice(0, 10);

/**
 * Mirrors `findBlockoutRangeForDate` on the client. Both sides must agree, or
 * the email and the amber flag disagree about the same date.
 * @param {Array<{ startDate?: string, endDate?: string }>} ranges
 * @param {string} date YYYY-MM-DD
 */
export const isDateBlocked = (ranges, date) => {
  if (!date) return false;
  return (Array.isArray(ranges) ? ranges : []).some((range) => {
    const start = String(range?.startDate || "");
    if (!start) return false;
    const end = String(range?.endDate || start) || start;
    return start <= date && date <= end;
  });
};

const rangeKey = (range) =>
  `${String(range?.startDate || "")}|${String(range?.endDate || "")}`;

/**
 * Whether this save could have blocked anything new.
 *
 * A conservative short-circuit that exists to keep the common save off the
 * expensive path: finding conflicts means reading every schedule in the church,
 * and most saves remove a finished trip or fix a note. Any range not present
 * before counts as new, so re-adding an overlapping range still triggers the
 * read — the precise per-date check in `findNewlyBlockedSlots` then finds
 * nothing. False positives cost one read; a false negative would lose an email,
 * so the bias is deliberate.
 */
export const hasAddedBlockoutRanges = (previousRanges, nextRanges) => {
  const before = new Set((previousRanges || []).map(rangeKey));
  return (nextRanges || []).some((range) => !before.has(rangeKey(range)));
};

/**
 * Slots this member holds that the save just put in conflict.
 *
 * Newly blocked, not merely blocked: a date already covered before the save was
 * reported when it was first blocked, and reporting it again on every unrelated
 * edit is how a digest trains people to ignore it.
 *
 * Past occurrences are skipped. An owner cannot act on a service that already
 * happened, and volunteers routinely log time off after the fact.
 *
 * @param {{ occurrences?: Array<object>, assignments?: object }} schedule
 * @param {{ memberId: string, previousRanges: Array<object>, nextRanges: Array<object>, readHolder: (cell: unknown) => string, fromDate: string }} params
 * @returns {Array<{ occurrenceId: string, cellKey: string }>}
 */
export const findNewlyBlockedSlots = (
  schedule,
  { memberId, previousRanges, nextRanges, readHolder, fromDate = "" },
) => {
  if (!memberId) return [];
  const blocked = [];
  (schedule?.occurrences || []).forEach((occurrence) => {
    const occurrenceId = String(occurrence?.occurrenceId || "");
    if (!occurrenceId) return;
    const date = occurrenceCalendarDate(occurrence);
    if (!date || (fromDate && date < fromDate)) return;
    if (!isDateBlocked(nextRanges, date)) return;
    if (isDateBlocked(previousRanges, date)) return;

    Object.entries(schedule?.assignments?.[occurrenceId] || {}).forEach(
      ([cellKey, cell]) => {
        if (readHolder(cell) === memberId) blocked.push({ occurrenceId, cellKey });
      },
    );
  });
  return blocked;
};

/**
 * Bounds the map so a runaway writer cannot inflate the schedule document,
 * which is read on every grid load. Well past any real burst: a church would
 * need this many fresh conflicts inside one 20-minute window to reach it.
 */
export const MAX_PENDING_BLOCKOUT_CONFLICTS = 200;

/** Stable identity for one conflict, so re-saving the same blockout cannot double it. */
export const blockoutConflictKey = ({ occurrenceId, cellKey, memberId }) =>
  `${occurrenceId}#${cellKey}#${memberId}`;

/**
 * The keys this save adds — **only** the new ones, never the whole map.
 *
 * A map keyed by conflict, not an array, and the caller writes these keys
 * individually. That shape is load-bearing twice over. Two members blocking out
 * at the same moment each add their own keys and both survive, where an array
 * field would be replaced wholesale and one write lost. And returning the delta
 * rather than the merged map means a writer holding a snapshot cannot re-assert
 * keys the digest deleted in the meantime — otherwise a conflict already emailed
 * would reappear and be emailed again.
 *
 * `existing` is consulted only to skip duplicates and to bound growth. Both are
 * advisory: a stale snapshot at worst re-stamps one key's `blockedAt` or lets
 * the map run slightly over the cap, neither of which loses or repeats anything.
 */
export const newBlockoutConflictEntries = (existing, additions, blockedAt) => {
  const current = normalizePendingBlockoutConflicts(existing);
  const created = {};
  let size = Object.keys(current).length;
  (additions || []).forEach(({ occurrenceId, cellKey, memberId }) => {
    const key = blockoutConflictKey({ occurrenceId, cellKey, memberId });
    // Keeping the first `blockedAt` matters: it is what orders the digest, and
    // re-stamping it on an unrelated save would make an old clash read as new.
    if (current[key] || created[key]) return;
    if (size >= MAX_PENDING_BLOCKOUT_CONFLICTS) return;
    created[key] = {
      memberId: String(memberId || ""),
      occurrenceId: String(occurrenceId || ""),
      cellKey: String(cellKey || ""),
      blockedAt: String(blockedAt || ""),
    };
    size += 1;
  });
  return created;
};

/** Drops rows missing any part of their identity, so a partial write cannot produce a nameless line. */
export const normalizePendingBlockoutConflicts = (stored) => {
  const result = {};
  for (const [key, value] of Object.entries(stored || {})) {
    const memberId = String(value?.memberId || "");
    const occurrenceId = String(value?.occurrenceId || "");
    const cellKey = String(value?.cellKey || "");
    if (!key || !memberId || !occurrenceId || !cellKey) continue;
    result[key] = {
      memberId,
      occurrenceId,
      cellKey,
      blockedAt: String(value?.blockedAt || ""),
    };
  }
  return result;
};

/**
 * The conflicts that are still true, oldest first.
 *
 * Re-checked against live state rather than trusted, so the twenty minutes
 * between the blockout and the email are a grace period: an owner who already
 * refilled the slot, or a member who changed their mind, produces no line at
 * all. Reporting a conflict that no longer exists is worse than reporting it
 * late — it sends someone to look at a grid that is fine.
 *
 * @param {object} pending
 * @param {{ schedule: object, blockoutRangesByMemberId: Map<string, Array<object>>, readHolder: (cell: unknown) => string }} params
 */
export const verifiedBlockoutConflicts = (
  pending,
  { schedule, blockoutRangesByMemberId, readHolder },
) => {
  const occurrenceById = new Map(
    (schedule?.occurrences || [])
      .filter((occurrence) => occurrence?.occurrenceId)
      .map((occurrence) => [occurrence.occurrenceId, occurrence]),
  );
  return Object.values(normalizePendingBlockoutConflicts(pending))
    .filter((entry) => {
      const cell = schedule?.assignments?.[entry.occurrenceId]?.[entry.cellKey];
      if (readHolder(cell) !== entry.memberId) return false;
      return isDateBlocked(
        blockoutRangesByMemberId?.get(entry.memberId),
        occurrenceCalendarDate(occurrenceById.get(entry.occurrenceId)),
      );
    })
    .sort((a, b) => String(a.blockedAt).localeCompare(String(b.blockedAt)));
};
