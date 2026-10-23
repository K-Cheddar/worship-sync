const clean = (value) => String(value ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();

export const mapWithConcurrency = async (values, concurrency, operation) => {
  const results = new Array(values.length);
  let nextIndex = 0;
  let failure = null;
  const workerCount = Math.min(values.length, Math.max(1, Math.floor(concurrency) || 1));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (!failure && nextIndex < values.length) {
      const index = nextIndex++;
      try {
        results[index] = await operation(values[index], index);
      } catch (error) {
        failure ||= error;
      }
    }
  }));
  if (failure) throw failure;
  return results;
};

export const scheduleSlotMemberId = (cell) =>
  typeof cell === "string" ? cell : cell?.primaryMemberId || "";

export const getScheduleAssignedMemberIds = (schedule) => [...new Set(
  Object.values(schedule?.assignments || {}).flatMap((cells) =>
    Object.values(cells || {}).map(scheduleSlotMemberId).filter(Boolean),
  ),
)];

const assignmentDate = (occurrence, timeZone) => {
  const serviceDate = String(occurrence?.serviceDate || "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) {
    const [year, month, day] = serviceDate.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day, 12)).toLocaleDateString("en-US", {
      timeZone: "UTC",
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  }
  const startsAt = new Date(occurrence?.startsAt || "");
  if (Number.isNaN(startsAt.getTime())) return "Date TBD";
  try {
    return startsAt.toLocaleDateString("en-US", {
      timeZone: timeZone || "UTC",
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  } catch {
    return startsAt.toLocaleDateString("en-US", {
      timeZone: "UTC",
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  }
};

/** Resolve a member's current positions from one persisted schedule. */
export const getScheduleMemberAssignments = ({ schedule, memberId, positions = [] }) => {
  const positionById = new Map((positions || []).map((position) => [position.positionId || position.id, position]));
  const occurrenceById = new Map((schedule?.occurrences || []).map((occurrence) => [occurrence.occurrenceId, occurrence]));
  const byOccurrence = new Map();
  Object.entries(schedule?.assignments || {}).forEach(([occurrenceId, cells]) => {
    const occurrence = occurrenceById.get(occurrenceId);
    if (!occurrence) return;
    Object.entries(cells || {}).forEach(([cellKey, cell]) => {
      if (scheduleSlotMemberId(cell) !== memberId) return;
      const positionId = String(cellKey).split("::")[0];
      const position = positionById.get(positionId);
      if (!position || position.churchId !== schedule.churchId || position.teamId !== schedule.teamId) return;
      const assignment = byOccurrence.get(occurrenceId) || {
        occurrenceId,
        serviceName: clean(occurrence.name) || "Service",
        serviceDate: String(occurrence.serviceDate || ""),
        startsAt: String(occurrence.startsAt || ""),
        positions: [],
      };
      assignment.positions.push({ positionId, positionName: clean(position.name || position.label) || "Volunteer position" });
      byOccurrence.set(occurrenceId, assignment);
    });
  });
  return [...byOccurrence.values()]
    .map((assignment) => ({
      ...assignment,
      positions: assignment.positions.sort((left, right) =>
        left.positionName.localeCompare(right.positionName) || left.positionId.localeCompare(right.positionId),
      ),
    }))
    .sort((left, right) =>
      String(left.serviceDate || left.startsAt).localeCompare(String(right.serviceDate || right.startsAt)) ||
      left.serviceName.localeCompare(right.serviceName) || left.occurrenceId.localeCompare(right.occurrenceId),
    );
};

export const buildScheduleInitialSmsMessage = ({ churchName, assignments, responseUrl, timeZone, schedule }) => {
  const introduction = clean(churchName) || "Your church";
  if (/\/s#v_[A-Za-z0-9_-]{32}$/.test(String(responseUrl || ""))) {
    const start = String(schedule?.startDate || "");
    const end = String(schedule?.endDate || "");
    let period = "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end) && start.slice(0, 7) === end.slice(0, 7)) {
      period = `${new Date(`${start}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" })} `;
    }
    return `${introduction}: Your ${period}volunteer schedule is ready. View and respond: ${responseUrl}. Reply STOP to opt out.`;
  }
  const assignmentLines = (assignments || []).map((assignment) => {
    const service = clean(assignment.serviceName) || "Service";
    const date = assignmentDate(assignment, timeZone);
    const positionCounts = new Map();
    (assignment.positions || []).forEach(({ positionName }) => {
      const name = clean(positionName) || "Volunteer position";
      positionCounts.set(name, (positionCounts.get(name) || 0) + 1);
    });
    const positions = [...positionCounts.entries()]
      .map(([name, count]) => count > 1 ? `${name} (${count})` : name)
      .join(", ");
    return `${service} · ${date}${positions ? ` — ${positions}` : ""}`;
  });
  return `${introduction}: Your schedule is ready. You're serving: ${assignmentLines.join("; ")}. View all assignments and respond: ${responseUrl}. Reply STOP to opt out.`;
};

export const scheduleInitialSmsIdempotencyKey = (scheduleId, memberId) =>
  `schedule_initial_notification|${scheduleId}|${memberId}|initial`;
