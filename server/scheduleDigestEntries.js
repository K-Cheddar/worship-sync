/**
 * What the owner digest actually says.
 *
 * Extracted from the sender for the same reason `applyAssignmentResponses` was:
 * the code around it is unreachable from the suite. The digest fires from an
 * in-process timer twenty minutes after the fact, so no request-level test can
 * observe it, and a crash in here is invisible — owners simply stop being told
 * anything, with nothing failing anywhere. Keeping the decisions pure means the
 * untested remainder is a `queryDocs`, a render, and a `sendEmail`.
 *
 * Two sources feed one list. A **response** carries the moment it was given, so
 * it is filtered by `respondedAt >= since`. A **blockout** carries no timestamp
 * at all, so it arrives as an already-verified conflict from
 * `blockoutConflicts.js`. They are deliberately not separated in the output:
 * to an owner, "declined" and "marked time off" are the same job.
 */

const formatOccurrenceWhen = (startsAt) => {
  const parsed = startsAt ? new Date(startsAt) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return "Date to be confirmed";
  return parsed.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
};

/**
 * Build the digest lines, oldest first.
 *
 * @param {object} params
 * @param {{ occurrences?: Array<object>, responses?: object }} params.schedule
 * @param {string} params.since ISO; responses older than this were already sent.
 * @param {Array<{ memberId: string, occurrenceId: string, cellKey: string, blockedAt: string }>} params.blockoutConflicts
 *        Already verified against live state by the caller.
 * @param {Map<string, string>} params.nameById Roster members *and* schedule guests.
 * @param {Map<string, string>} params.positionNameById
 * @returns {Array<{ at: string, name: string, serviceName: string, when: string, positionName: string, kind: "accepted" | "declined" | "blockout" }>}
 */
export const buildScheduleDigestEntries = ({
  schedule,
  since,
  blockoutConflicts = [],
  nameById = new Map(),
  positionNameById = new Map(),
}) => {
  const occurrenceById = new Map(
    (schedule?.occurrences || [])
      .filter((occurrence) => occurrence?.occurrenceId)
      .map((occurrence) => [occurrence.occurrenceId, occurrence]),
  );

  const describe = ({ occurrenceId, cellKey, memberId, kind, at }) => {
    const occurrence = occurrenceById.get(occurrenceId);
    return {
      at: String(at || ""),
      // "Someone" rather than a blank: a line naming nobody is worse than a
      // vague one, because the owner cannot tell which slot to look at.
      name: nameById.get(memberId) || "Someone",
      serviceName: occurrence?.name || "Service",
      when: formatOccurrenceWhen(occurrence?.startsAt || ""),
      // Cell keys are `positionId::slot`.
      positionName: positionNameById.get(String(cellKey).split("::")[0]) || "",
      kind,
    };
  };

  const entries = [];
  Object.entries(schedule?.responses || {}).forEach(([occurrenceId, row]) => {
    Object.entries(row || {}).forEach(([cellKey, record]) => {
      // No timestamp means it predates response tracking; sending it now would
      // report an old answer as news.
      if (!record?.respondedAt || record.respondedAt < since) return;
      entries.push(
        describe({
          occurrenceId,
          cellKey,
          memberId: record.memberId,
          kind: record.response === "accepted" ? "accepted" : "declined",
          at: record.respondedAt,
        }),
      );
    });
  });

  blockoutConflicts.forEach((conflict) => {
    entries.push(
      describe({
        occurrenceId: conflict.occurrenceId,
        cellKey: conflict.cellKey,
        memberId: conflict.memberId,
        kind: "blockout",
        at: conflict.blockedAt,
      }),
    );
  });

  return entries.sort((a, b) => a.at.localeCompare(b.at));
};

/**
 * Subject line.
 *
 * Driven by the count that needs action. An acceptance is reassurance; a
 * decline and a blockout are both work, and an owner scanning a phone lock
 * screen should not have to open the mail to find out which kind arrived.
 */
export const scheduleDigestSubject = (entries, scheduleName) => {
  const unavailable = (entries || []).filter(
    (entry) => entry.kind !== "accepted",
  ).length;
  const total = (entries || []).length;
  if (unavailable > 0) {
    return `${unavailable} ${unavailable === 1 ? "person" : "people"} cannot serve — ${scheduleName || "schedule"}`;
  }
  return `${total} ${total === 1 ? "response" : "responses"} on ${scheduleName || "your schedule"}`;
};
