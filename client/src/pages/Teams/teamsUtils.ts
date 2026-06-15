import {
  formatMonthly,
  formatMultiWeekly,
  formatOneTime,
  formatWeekly,
} from "../../containers/ServiceTimes/utils";
import type {
  TeamRecord,
  TeamIntakeForm,
  TeamIntakeSubmission,
  TeamPosition,
  TeamQualificationArea,
  TeamQualificationLevel,
  TeamRole,
  TeamRosterMember,
  TeamSchedule,
  TeamScheduleCellAssignment,
  TeamScheduleShadowAssignment,
  TeamScheduleShadowKind,
  TeamService,
  TeamBlockoutDateRange,
} from "../../api/authTypes";
import type { TeamSchedulePayload } from "../../api/auth";
import type { MonthWeekOrdinal, ServiceTime, Weekday } from "../../types";
import generateRandomId from "../../utils/generateRandomId";
import { parsePlainDate } from "../../utils/plainDate";
import { buildShareableHashRouterUrl } from "../../utils/environment";
import { emptyData } from "./teamsConstants";
import { parseSlotKey } from "./schedule/scheduleRequirements";
import type { TeamsData, TeamsDataKey } from "./types";

const normalizeRosterMember = (member: TeamRosterMember): TeamRosterMember => ({
  ...member,
  positionIds: member.positionIds || [],
  teamMemberships: member.teamMemberships || {},
  qualifications: member.qualifications || [],
  blockoutDates: member.blockoutDates || [],
});

const normalizeIntakeForm = (form: TeamIntakeForm): TeamIntakeForm => ({
  ...form,
  availabilityServices: form.availabilityServices || [],
  availabilityOccurrences: form.availabilityOccurrences || [],
  teamIds: form.teamIds || [],
});

const normalizeIntakeSubmission = (
  submission: TeamIntakeSubmission,
): TeamIntakeSubmission => ({
  ...submission,
  positionIds: submission.positionIds || [],
  blockoutRanges: submission.blockoutRanges || [],
  occurrenceAvailability: submission.occurrenceAvailability || {},
});

// Positions render and schedule-column order both follow `order`. Positions
// without one (legacy/just created) keep their incoming order via a stable sort.
export const sortPositionsByOrder = (
  positions: TeamPosition[],
): TeamPosition[] =>
  [...positions].sort((a, b) => {
    const orderA = Number.isFinite(a?.order)
      ? (a.order as number)
      : Number.MAX_SAFE_INTEGER;
    const orderB = Number.isFinite(b?.order)
      ? (b.order as number)
      : Number.MAX_SAFE_INTEGER;
    return orderA - orderB;
  });

export const normalizeTeamsData = (data?: Partial<TeamsData>): TeamsData => ({
  members: (data?.members || []).map(normalizeRosterMember),
  positions: sortPositionsByOrder(data?.positions || []),
  teams: data?.teams || [],
  teamRoles: data?.teamRoles || [],
  qualificationAreas: data?.qualificationAreas || [],
  qualificationLevels: data?.qualificationLevels || [],
  services: data?.services || [],
  schedules: data?.schedules || [],
  intakeForms: (data?.intakeForms || []).map(normalizeIntakeForm),
  intakeSubmissions: (data?.intakeSubmissions || []).map(
    normalizeIntakeSubmission,
  ),
});

// Normalize a single data collection without touching the rest of the dataset.
// Used when one keyed cache doc arrives over sync so we don't re-map and re-sort
// every other collection on each incoming update.
export const normalizeTeamsDataKey = <K extends TeamsDataKey>(
  key: K,
  items: TeamsData[K],
): TeamsData[K] => {
  switch (key) {
    case "members":
      return (items as TeamRosterMember[]).map(
        normalizeRosterMember,
      ) as TeamsData[K];
    case "positions":
      return sortPositionsByOrder(items as TeamPosition[]) as TeamsData[K];
    case "intakeForms":
      return (items as TeamIntakeForm[]).map(
        normalizeIntakeForm,
      ) as TeamsData[K];
    case "intakeSubmissions":
      return (items as TeamIntakeSubmission[]).map(
        normalizeIntakeSubmission,
      ) as TeamsData[K];
    default:
      return items;
  }
};

export const buildTeamIntakePublicUrl = (token: string): string =>
  buildShareableHashRouterUrl(
    `/teams/intake/${encodeURIComponent(String(token || "").trim())}`,
  );

export const buildTeamSchedulePublicUrl = (token: string): string =>
  buildShareableHashRouterUrl(
    `/teams/schedule/${encodeURIComponent(String(token || "").trim())}`,
  );

export const formatShortOccurrenceDate = (startsAt: string) =>
  new Date(startsAt).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

export const readEntityId = <T extends Record<string, unknown>>(
  item: T,
  idField: string,
) => String(item[idField] || "");

export const upsertListItem = <T extends Record<string, unknown>>(
  list: T[],
  idField: string,
  item: T,
  replaceId?: string,
) => {
  const itemId = readEntityId(item, idField);
  const filtered = replaceId
    ? list.filter((entry) => readEntityId(entry, idField) !== replaceId)
    : list;
  const exists = filtered.some(
    (entry) => readEntityId(entry, idField) === itemId,
  );
  return exists
    ? filtered.map((entry) =>
        readEntityId(entry, idField) === itemId ? item : entry,
      )
    : [...filtered, item];
};

const scrubMemberFromAssignments = (
  assignments: TeamSchedule["assignments"],
  memberId: string,
) =>
  Object.fromEntries(
    Object.entries(assignments || {}).map(([occurrenceId, row]) => [
      occurrenceId,
      Object.fromEntries(
        Object.entries(row || {}).flatMap(([cellKey, cell]) => {
          const normalized = normalizeAssignmentCell(cell);
          const nextCell = serializeAssignmentCell({
            primaryMemberId:
              normalized.primaryMemberId === memberId
                ? ""
                : normalized.primaryMemberId,
            shadows: normalized.shadows.filter(
              (shadow) => shadow.memberId !== memberId,
            ),
          });
          return nextCell ? [[cellKey, nextCell]] : [];
        }),
      ),
    ]),
  );

const scrubPositionsFromAssignments = (
  assignments: TeamSchedule["assignments"],
  positionIds: Set<string>,
) =>
  Object.fromEntries(
    Object.entries(assignments || {}).map(([occurrenceId, row]) => [
      occurrenceId,
      Object.fromEntries(
        Object.entries(row || {}).filter(([cellKey]) => {
          const slot = parseSlotKey(cellKey);
          return !slot || !positionIds.has(slot.positionId);
        }),
      ),
    ]),
  );

export const applyTeamEntityDeletionLocally = (
  data: TeamsData,
  key: TeamsDataKey,
  id: string,
): TeamsData => {
  if (key === "members") {
    return {
      ...data,
      members: data.members.filter((member) => member.memberId !== id),
      teams: data.teams.map((team) => ({
        ...team,
        memberIds: (team.memberIds || []).filter((memberId) => memberId !== id),
      })),
      schedules: data.schedules.map((schedule) => ({
        ...schedule,
        assignments: scrubMemberFromAssignments(schedule.assignments, id),
        attendance: Object.fromEntries(
          Object.entries(schedule.attendance || {}).map(
            ([occurrenceId, row]) => {
              const nextRow = { ...(row || {}) };
              delete nextRow[id];
              return [occurrenceId, nextRow];
            },
          ),
        ),
      })),
    };
  }

  if (key === "positions") {
    const positionIds = new Set([id]);
    return {
      ...data,
      positions: data.positions.filter(
        (position) => !positionIds.has(position.positionId),
      ),
      members: data.members.map((member) => ({
        ...member,
        positionIds: (member.positionIds || []).filter(
          (positionId) => !positionIds.has(positionId),
        ),
      })),
      schedules: data.schedules.map((schedule) => ({
        ...schedule,
        assignments: scrubPositionsFromAssignments(
          schedule.assignments,
          positionIds,
        ),
      })),
    };
  }

  if (key === "teams") {
    const ownedPositionIds = new Set(
      data.positions
        .filter((position) => position.teamId === id)
        .map((position) => position.positionId),
    );
    const ownedAreaIds = new Set(
      data.qualificationAreas
        .filter((area) => area.teamId === id)
        .map((area) => area.areaId),
    );
    const ownedRoleIds = new Set(
      data.teamRoles
        .filter((role) => role.teamId === id)
        .map((role) => role.roleId),
    );
    return {
      ...data,
      teams: data.teams.filter((team) => team.teamId !== id),
      positions: data.positions.filter(
        (position) => !ownedPositionIds.has(position.positionId),
      ),
      teamRoles: data.teamRoles.filter((role) => role.teamId !== id),
      qualificationAreas: data.qualificationAreas.filter(
        (area) => area.teamId !== id,
      ),
      qualificationLevels: data.qualificationLevels.filter(
        (level) => !ownedAreaIds.has(level.areaId),
      ),
      members: data.members.map((member) => ({
        ...member,
        positionIds: (member.positionIds || []).filter(
          (positionId) => !ownedPositionIds.has(positionId),
        ),
        teamMemberships: Object.fromEntries(
          Object.entries(member.teamMemberships || {})
            .filter(([teamId]) => teamId !== id)
            .map(([teamId, membership]) => {
              if (!membership?.roleId || !ownedRoleIds.has(membership.roleId)) {
                return [teamId, membership];
              }
              const { roleId, ...rest } = membership;
              return [teamId, rest];
            }),
        ),
        qualifications: (member.qualifications || []).filter(
          (qualification) =>
            qualification.teamId !== id &&
            !ownedAreaIds.has(qualification.areaId),
        ),
      })),
      schedules: data.schedules.map((schedule) => ({
        ...schedule,
        assignments: scrubPositionsFromAssignments(
          schedule.assignments,
          ownedPositionIds,
        ),
      })),
    };
  }

  return {
    ...data,
    [key]: (data[key] as Record<string, unknown>[]).filter((entry) => {
      const idFieldByKey: Partial<Record<TeamsDataKey, string>> = {
        teamRoles: "roleId",
        qualificationAreas: "areaId",
        qualificationLevels: "levelId",
        schedules: "scheduleId",
        intakeForms: "formId",
        intakeSubmissions: "submissionId",
      };
      const idField = idFieldByKey[key];
      return idField ? String(entry[idField] || "") !== id : true;
    }),
  };
};

export const buildTeamsDataFromBootstrap = (response: {
  members?: TeamRosterMember[];
  positions?: TeamPosition[];
  teams?: TeamRecord[];
  teamRoles?: TeamRole[];
  qualificationAreas?: TeamQualificationArea[];
  qualificationLevels?: TeamQualificationLevel[];
  schedules?: TeamSchedule[];
  intakeForms?: TeamIntakeForm[];
  intakeSubmissions?: TeamIntakeSubmission[];
}) =>
  normalizeTeamsData({
    members: response.members,
    positions: response.positions,
    teams: response.teams,
    teamRoles: response.teamRoles,
    qualificationAreas: response.qualificationAreas,
    qualificationLevels: response.qualificationLevels,
    services: [],
    schedules: response.schedules,
    intakeForms: response.intakeForms,
    intakeSubmissions: response.intakeSubmissions,
  });

export const assignmentFailureKey = (serviceId: string, positionId: string) =>
  `${serviceId}|${positionId}`;

export const normalizeAssignmentCell = (
  cell?: TeamScheduleCellAssignment | null,
) => {
  return {
    primaryMemberId: String(cell?.primaryMemberId || ""),
    shadows: (Array.isArray(cell?.shadows) ? cell.shadows : [])
      .map(
        (shadow): TeamScheduleShadowAssignment => ({
          memberId: String(shadow.memberId || ""),
          kind: shadow.kind === "reverse_shadow" ? "reverse_shadow" : "shadow",
        }),
      )
      .filter((shadow) => shadow.memberId),
  };
};

export const serializeAssignmentCell = ({
  primaryMemberId,
  shadows,
}: {
  primaryMemberId?: string;
  shadows?: TeamScheduleShadowAssignment[];
}): TeamScheduleCellAssignment | "" => {
  const normalizedPrimary = String(primaryMemberId || "").trim();
  const normalizedShadows = (shadows || [])
    .map(
      (shadow): TeamScheduleShadowAssignment => ({
        memberId: String(shadow.memberId || "").trim(),
        kind: shadow.kind === "reverse_shadow" ? "reverse_shadow" : "shadow",
      }),
    )
    .filter((shadow) => shadow.memberId);
  if (normalizedShadows.length > 0) {
    return {
      ...(normalizedPrimary ? { primaryMemberId: normalizedPrimary } : {}),
      shadows: normalizedShadows,
    };
  }
  return normalizedPrimary ? { primaryMemberId: normalizedPrimary } : "";
};

export const getCellPrimaryMemberId = (
  cell?: TeamScheduleCellAssignment | null,
) => normalizeAssignmentCell(cell).primaryMemberId;

export const getCellShadowAssignments = (
  cell?: TeamScheduleCellAssignment | null,
) => normalizeAssignmentCell(cell).shadows;

export const getCellMemberIds = (cell?: TeamScheduleCellAssignment | null) => {
  const normalized = normalizeAssignmentCell(cell);
  return [
    normalized.primaryMemberId,
    ...normalized.shadows.map((shadow) => shadow.memberId),
  ].filter(Boolean);
};

export const shadowKindLabel = (kind: TeamScheduleShadowKind) =>
  kind === "reverse_shadow" ? "Reverse shadow" : "Shadow";

export const scheduleDraftsMatch = (
  first?: TeamSchedulePayload,
  second?: TeamSchedulePayload,
) => JSON.stringify(first || null) === JSON.stringify(second || null);

export const emptyRange = (): TeamBlockoutDateRange => ({
  startDate: "",
  endDate: "",
  notes: "",
});

export const memberName = (member?: TeamRosterMember | null) => {
  if (!member) return "Unassigned";
  return `${member.firstName} ${member.lastName}`.trim();
};

export const compareTeamRosterMembersByName = (
  a: TeamRosterMember,
  b: TeamRosterMember,
) =>
  memberName(a).localeCompare(memberName(b), undefined, {
    sensitivity: "base",
  });

export const getDuplicateScheduleFirstNames = (members: TeamRosterMember[]) => {
  const counts = new Map<string, number>();
  members.forEach((member) => {
    const firstName = member.firstName.trim().toLowerCase();
    if (!firstName) return;
    counts.set(firstName, (counts.get(firstName) || 0) + 1);
  });
  return new Set(
    [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([firstName]) => firstName),
  );
};

export const scheduleMemberName = (
  member: TeamRosterMember | null | undefined,
  duplicateFirstNames: Set<string>,
) => {
  if (!member) return "Unassigned";
  const firstName = member.firstName.trim();
  const lastInitial = member.lastName.trim().charAt(0);
  if (duplicateFirstNames.has(firstName.toLowerCase()) && lastInitial) {
    return `${firstName} ${lastInitial}.`;
  }
  return firstName || memberName(member);
};

export const compareTeamRosterMembersByScheduleDisplay = (
  a: TeamRosterMember,
  b: TeamRosterMember,
  duplicateFirstNames: Set<string>,
) =>
  scheduleMemberName(a, duplicateFirstNames).localeCompare(
    scheduleMemberName(b, duplicateFirstNames),
    undefined,
    { sensitivity: "base" },
  );

export const sortTeamRosterMembersAlphabetically = (
  members: TeamRosterMember[],
) => [...members].sort(compareTeamRosterMembersByName);

export const sortTeamRosterMembersByScheduleDisplay = (
  members: TeamRosterMember[],
  duplicateFirstNames: Set<string>,
) =>
  [...members].sort((a, b) =>
    compareTeamRosterMembersByScheduleDisplay(a, b, duplicateFirstNames),
  );

export const getScheduleMemberPositionNames = (
  member: TeamRosterMember,
  schedulePositions: TeamPosition[],
) =>
  (member.positionIds || [])
    .map(
      (positionId) =>
        schedulePositions.find((position) => position.positionId === positionId)
          ?.name,
    )
    .filter(Boolean) as string[];

const formatBlockoutDisplayDate = (value: string) => {
  const parsed = parsePlainDate(value);
  return parsed
    ? parsed.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : value;
};

export const formatPlainDateLabel = (value: string) => {
  const parsed = parsePlainDate(value);
  return parsed
    ? parsed.toLocaleDateString(undefined, {
        month: "long",
        day: "2-digit",
        year: "numeric",
      })
    : value;
};

export const formatPlainDateRangeLabel = (
  startDate: string,
  endDate: string,
) => {
  const start = formatPlainDateLabel(startDate);
  const end = formatPlainDateLabel(endDate);
  if (start && end) return `${start} – ${end}`;
  return start || end;
};

export const formatBlockoutDateRangeLabel = (range: TeamBlockoutDateRange) => {
  const endDate = range.endDate || range.startDate;
  if (!range.startDate) return "";
  if (range.startDate === endDate) {
    return formatBlockoutDisplayDate(range.startDate);
  }
  return `${formatBlockoutDisplayDate(range.startDate)} – ${formatBlockoutDisplayDate(endDate)}`;
};

export const countScheduleAssignmentsForMember = (
  assignments: TeamSchedule["assignments"] | undefined,
  memberId: string,
) => {
  if (!assignments) return 0;
  return Object.values(assignments).reduce((total, row) => {
    if (!row) return total;
    return (
      total +
      Object.values(row).filter((cell) =>
        getCellMemberIds(cell).includes(memberId),
      ).length
    );
  }, 0);
};

export const entityMatchesQuery = (
  values: Array<string | undefined | null>,
  query: string,
) => {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;
  return values
    .filter(Boolean)
    .map((value) => String(value).toLowerCase())
    .some((value) => value.includes(normalizedQuery));
};

export const memberMatchesScheduleQuery = (
  member: TeamRosterMember,
  query: string,
  duplicateFirstNames: Set<string>,
) =>
  entityMatchesQuery(
    [
      memberName(member),
      scheduleMemberName(member, duplicateFirstNames),
      member.firstName,
      member.lastName,
    ],
    query,
  );

export const memberMatchesListQuery = (
  member: TeamRosterMember,
  query: string,
  positionNames: string[] = [],
) =>
  entityMatchesQuery(
    [
      memberName(member),
      member.firstName,
      member.lastName,
      member.notes,
      ...positionNames,
    ],
    query,
  );

export const positionMatchesListQuery = (
  position: TeamPosition,
  query: string,
) => entityMatchesQuery([position.name, position.description], query);

export const entityStatus = (archivedAt?: string | null) =>
  archivedAt ? "Archived" : "Active";

export const isActive = (item: { archivedAt?: string | null }) =>
  !item.archivedAt;

export const formatServiceTiming = (service?: TeamService | null) => {
  if (!service) return "";
  if (service.overrideDateTimeISO)
    return `Override: ${formatOneTime(service.overrideDateTimeISO)}`;
  if (service.reccurence === "one_time")
    return formatOneTime(service.dateTimeISO);
  if (service.reccurence === "weekly")
    return formatWeekly(service.dayOfWeek, service.time);
  if (service.reccurence === "multi_weekly") {
    return formatMultiWeekly(service.daysOfWeek, service.endDateISO);
  }
  if (service.reccurence === "monthly") {
    return formatMonthly(service.ordinal, service.weekday, service.time);
  }
  return "";
};

export const toTeamService = (service: ServiceTime): TeamService => ({
  ...service,
  serviceId: service.id,
  churchId: "",
});

export const createEmptyServiceDraft = (): Partial<ServiceTime> => ({
  name: "",
  timerType: "countdown",
  reccurence: "weekly",
  time: "10:00",
  dayOfWeek: 0,
  daysOfWeek: [],
  ordinal: 1,
  weekday: 3,
});

export const buildServiceTimeUpdate = (
  draft: Partial<ServiceTime>,
  existing?: ServiceTime | null,
): ServiceTime => {
  const recurrence = draft.reccurence || "weekly";
  const base: ServiceTime = {
    id: existing?.id || generateRandomId(),
    name: String(draft.name || "").trim(),
    timerType: "countdown",
    color: existing?.color,
    background: existing?.background,
    position: existing?.position,
    nameFontSize: existing?.nameFontSize,
    timeFontSize: existing?.timeFontSize,
    shouldShowName: existing?.shouldShowName,
    positionRequirements:
      draft.positionRequirements ?? existing?.positionRequirements,
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    reccurence: recurrence,
  };

  if (recurrence === "one_time") {
    return { ...base, dateTimeISO: draft.dateTimeISO || "" };
  }
  if (recurrence === "multi_weekly") {
    return {
      ...base,
      daysOfWeek: draft.daysOfWeek || [],
      endDateISO: draft.endDateISO || undefined,
    };
  }
  if (recurrence === "monthly") {
    return {
      ...base,
      ordinal: (draft.ordinal as MonthWeekOrdinal) || 1,
      weekday: (draft.weekday as Weekday) ?? 3,
      time: draft.time || "10:00",
    };
  }
  return {
    ...base,
    dayOfWeek: (draft.dayOfWeek as Weekday) ?? 0,
    time: draft.time || "10:00",
  };
};

const pluralize = (count: number, noun: string, plural = `${noun}s`) =>
  `${count} ${count === 1 ? noun : plural}`;

const joinNames = (names: string[], max = 3) => {
  const named = names.filter(Boolean);
  const shown = named.slice(0, max);
  const extra = named.length - shown.length;
  if (shown.length === 0) return "";
  return extra > 0 ? `${shown.join(", ")} +${extra} more` : shown.join(", ");
};

const withNames = (label: string, names: string[]) => {
  const list = joinNames(names);
  return list ? `${label} (${list})` : label;
};

/**
 * Human-readable list of side effects a permanent deletion will cause, mirroring
 * the server cascade in authService.js (`cascadeTeamEntityDeletion`). Positions and
 * members are scrubbed from teams/assignments; teams and services have no
 * cascade, so schedules that reference them are left orphaned — we surface that.
 */
export const describeDeletionImpacts = (
  kind: "position" | "member" | "team" | "service",
  id: string,
  data: TeamsData,
): string[] => {
  const impacts: string[] = [];

  const countCells = (
    predicate: (cellKey: string, cell: TeamScheduleCellAssignment) => boolean,
  ) => {
    let count = 0;
    data.schedules.forEach((schedule) => {
      Object.values(schedule.assignments || {}).forEach((row) => {
        if (!row) return;
        Object.entries(row).forEach(([cellKey, cell]) => {
          if (predicate(cellKey, cell)) count += 1;
        });
      });
    });
    return count;
  };

  // Downstream effects shared by deleting a position (or all of a team's positions).
  const positionSetImpacts = (positionIds: string[]): string[] => {
    const positionIdSet = new Set(positionIds);
    if (positionIdSet.size === 0) return [];
    const lines: string[] = [];
    const members = data.members.filter((member) =>
      (member.positionIds || []).some((positionId) =>
        positionIdSet.has(positionId),
      ),
    );
    const services = data.services.filter((service) =>
      (service.positionRequirements || []).some((req) =>
        positionIdSet.has(req.positionId),
      ),
    );
    const assignmentCount = countCells((cellKey, cell) => {
      const slot = parseSlotKey(cellKey);
      return Boolean(
        slot &&
        positionIdSet.has(slot.positionId) &&
        getCellMemberIds(cell).length > 0,
      );
    });
    if (members.length) {
      lines.push(`Unassigned from ${pluralize(members.length, "member")}`);
    }
    if (services.length) {
      lines.push(
        withNames(
          `Removed from position requirements on ${pluralize(services.length, "service")}`,
          services.map((service) => service.name),
        ),
      );
    }
    if (assignmentCount) {
      lines.push(
        `Cleared from ${pluralize(assignmentCount, "schedule assignment")}`,
      );
    }
    return lines;
  };

  if (kind === "position") {
    impacts.push(...positionSetImpacts([id]));
  }

  if (kind === "member") {
    const teams = data.teams.filter((team) =>
      (team.memberIds || []).includes(id),
    );
    const assignmentCount = countCells((_cellKey, cell) =>
      getCellMemberIds(cell).includes(id),
    );
    if (teams.length) {
      impacts.push(
        withNames(
          `Removed from ${pluralize(teams.length, "team")}`,
          teams.map((team) => team.name),
        ),
      );
    }
    if (assignmentCount) {
      impacts.push(
        `Cleared from ${pluralize(assignmentCount, "schedule assignment")}`,
      );
    }
  }

  if (kind === "team") {
    // Deleting a team deletes its owned positions, which cascade to members,
    // service requirements, and assignments.
    const ownedPositions = data.positions.filter(
      (position) => position.teamId === id,
    );
    if (ownedPositions.length) {
      impacts.push(
        withNames(
          `Deletes ${pluralize(ownedPositions.length, "position")}`,
          ownedPositions.map((position) => position.name),
        ),
      );
    }
    impacts.push(
      ...positionSetImpacts(
        ownedPositions.map((position) => position.positionId),
      ),
    );
    const schedules = data.schedules.filter(
      (schedule) => schedule.teamId === id,
    );
    if (schedules.length) {
      impacts.push(
        withNames(
          `${pluralize(schedules.length, "schedule")} will lose this team and stop showing assignments`,
          schedules.map((schedule) => schedule.name),
        ),
      );
    }
  }

  if (kind === "service") {
    const schedules = data.schedules.filter(
      (schedule) =>
        (schedule.serviceIds || []).includes(id) ||
        (schedule.occurrences || []).some(
          (occurrence) => occurrence.serviceId === id,
        ),
    );
    if (schedules.length) {
      impacts.push(
        withNames(
          `${pluralize(schedules.length, "schedule")} include this service and will lose its dates`,
          schedules.map((schedule) => schedule.name),
        ),
      );
    }
  }

  return impacts;
};

export { getApiErrorMessage } from "../../utils/apiErrorToast";

export { emptyData };
