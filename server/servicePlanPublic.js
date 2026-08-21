import { normalizeRichTextDocument } from "./serviceFlowService.js";

/** Shared with the member schedule so both views read plan titles the same way. */
export const richTextToPlainText = (document) =>
  (document?.blocks || [])
    .map((block) =>
      (block?.spans || []).map((span) => span?.text || "").join(""),
    )
    .join("\n")
    .trim();

const getDurationSeconds = (seconds, minutes) => {
  const value = Number(seconds);
  if (Number.isFinite(value) && value > 0) return Math.round(value);
  const minuteValue = Number(minutes);
  return Number.isFinite(minuteValue) && minuteValue > 0
    ? Math.round(minuteValue * 60)
    : 0;
};

const normalizeTimezone = (value) => {
  const timezone = String(value || "").trim();
  if (!timezone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return timezone;
  } catch {
    return "UTC";
  }
};

const PLAN_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

const getFirstElementStartTime = (sections) => {
  for (const section of sections || []) {
    for (const element of section?.elements || []) {
      const startTime = String(element?.startTime || "").trim();
      if (PLAN_TIME_PATTERN.test(startTime)) return startTime;
    }
  }
  return "";
};

/** Minutes past midnight for an instant, read in the plan's own timezone. */
const localMinutesInTimezone = (timeMs, timezone) => {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(timeMs));
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    const minute = Number(parts.find((part) => part.type === "minute")?.value);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    return (hour % 24) * 60 + minute;
  } catch {
    return null;
  }
};

/**
 * The instant the item timeline begins. Viewers see times chained forward from
 * the FIRST element, whose wall clock can sit before the occurrence's own
 * start (a 9:45 pre-service item on a 10:00 service). Anchoring at
 * plan.startsAt there would push every item later by that gap — the editor
 * shows 9:45 / 9:50 / 10:00 while the public page shows 10:00 / 10:05 / 10:15.
 */
const resolveTimelineStartMs = (startsAtMs, timezone, sections) => {
  const match = PLAN_TIME_PATTERN.exec(getFirstElementStartTime(sections));
  if (!match) return startsAtMs;
  const planStartMinutes = localMinutesInTimezone(startsAtMs, timezone);
  if (planStartMinutes == null) return startsAtMs;
  let deltaMinutes =
    Number(match[1]) * 60 + Number(match[2]) - planStartMinutes;
  // Element times are bare wall clocks with no date, so keep the anchor on the
  // nearest side of the service start rather than jumping most of a day.
  if (deltaMinutes > 720) deltaMinutes -= 1440;
  else if (deltaMinutes < -720) deltaMinutes += 1440;
  return startsAtMs + deltaMinutes * 60000;
};

const serializePublicTeamNotes = (teamNotes) =>
  (Array.isArray(teamNotes) ? teamNotes : [])
    .map((teamNote) => {
      const label = String(teamNote?.label || "").trim();
      const notes = normalizeRichTextDocument(teamNote?.note);
      const isRoleNote = teamNote?.scope === "role";
      const positionIds = Array.from(
        new Set(
          (Array.isArray(teamNote?.positionIds)
            ? teamNote.positionIds
            : [teamNote?.positionId]
          )
            .map((positionId) => String(positionId || "").trim())
            .filter(Boolean),
        ),
      );
      const teamId = String(teamNote?.teamId || "").trim();
      const teamName = String(teamNote?.teamName || "").trim();
      const teamIds = Array.from(
        new Set(
          (Array.isArray(teamNote?.teamIds) ? teamNote.teamIds : [teamId])
            .map((id) => String(id || "").trim())
            .filter(Boolean),
        ),
      );
      const teamNames = Array.from(
        new Set(
          (Array.isArray(teamNote?.teamNames) ? teamNote.teamNames : [teamName])
            .map((name) => String(name || "").trim())
            .filter(Boolean),
        ),
      );
      if (isRoleNote && !positionIds.length) return null;
      return label && notes.blocks.length
        ? {
            label,
            notes,
            ...(isRoleNote
              ? {
                  scope: "role",
                  positionIds,
                  ...(teamIds.length ? { teamIds } : {}),
                  ...(teamNames.length ? { teamNames } : {}),
                }
              : {
                  ...(teamId ? { teamId } : {}),
                  ...(teamName ? { teamName } : {}),
                }),
          }
        : null;
    })
    .filter(Boolean);

/**
 * Every assignee on an element, folding in the legacy single-assignee and
 * per-element microphone fields for any document the assignee migration has
 * not reached. Mirrors getServicePlanElementAssignees on the client.
 */
const readServicePlanAssignees = (element) => {
  if (Array.isArray(element?.assignees)) return element.assignees;
  const legacy = [];
  const name = String(element?.assignedName || "").trim();
  const memberId = String(element?.assignedMemberId || "").trim();
  if (name || memberId) {
    legacy.push({
      ...(name ? { name } : {}),
      ...(memberId ? { memberId } : {}),
    });
  }
  const microphoneIds = (
    Array.isArray(element?.microphoneAssignments)
      ? element.microphoneAssignments
      : []
  )
    .map((assignment) => String(assignment?.microphoneId || "").trim())
    .filter(Boolean);
  if (microphoneIds.length) legacy.push({ microphoneIds });
  return legacy;
};

/** The names shown as credits on both public views. */
const publicAssigneeCredit = (element) =>
  readServicePlanAssignees(element)
    .map((assignee) => String(assignee?.name || "").trim())
    .filter(Boolean)
    .join(", ");

/** Church mic catalog keyed by id — built once per public snapshot. */
const buildPublicMicrophonesById = (microphones) =>
  new Map(
    (Array.isArray(microphones) ? microphones : [])
      .map((microphone) => {
        const id = String(microphone?.id || "").trim();
        const name = String(microphone?.name || "").trim();
        if (!id || !name) return null;
        const color = String(microphone?.color || "").trim();
        return [
          id,
          {
            id,
            name,
            type:
              String(microphone?.type || "Microphone").trim() || "Microphone",
            color: /^#[0-9a-f]{6}$/i.test(color) ? color : "#9ca3af",
          },
        ];
      })
      .filter(Boolean),
  );

/** Church-wide role audiences for mic notes — built once per public snapshot. */
const normalizePublicMicrophoneAudiences = (microphoneAudiences) =>
  (Array.isArray(microphoneAudiences) ? microphoneAudiences : [])
    .map((audience) => {
      const positionId = String(audience?.positionId || "").trim();
      const roleName = String(audience?.roleName || "").trim();
      if (!positionId || !roleName) return null;
      const teamId = String(audience?.teamId || "").trim();
      const teamName = String(audience?.teamName || "").trim();
      return {
        positionId,
        roleName,
        ...(teamId ? { teamId } : {}),
        ...(teamName ? { teamName } : {}),
      };
    })
    .filter(Boolean);

/** YYYY-MM-DD for a schedule occurrence in the plan's own timezone. */
const publicOccurrenceDate = (startsAt, timezone) => {
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const part = (type) => parts.find((item) => item.type === type)?.value;
    const year = part("year");
    const month = part("month");
    const day = part("day");
    return year && month && day ? `${year}-${month}-${day}` : "";
  } catch {
    return String(startsAt).slice(0, 10);
  }
};

/**
 * Schedules own their own occurrence ids, while plans key a combined service
 * by service ids plus date. Prefer an exact start-time match, then retain the
 * date-and-service fallback used by the internal plan sidebar for drifted
 * schedule occurrences.
 */
const scheduleOccurrenceForPlan = (schedule, plan, timezone) => {
  const planServiceIds = new Set(
    (Array.isArray(plan?.serviceIds) && plan.serviceIds.length
      ? plan.serviceIds
      : [plan?.serviceId]
    )
      .map((serviceId) => String(serviceId || "").trim())
      .filter(Boolean),
  );
  const planStartsAt = String(plan?.startsAt || "").trim();
  const planDate = String(plan?.date || "").trim();
  return (Array.isArray(schedule?.occurrences) ? schedule.occurrences : []).find(
    (occurrence) => {
      const occurrenceServiceIds = (
        Array.isArray(occurrence?.serviceIds) && occurrence.serviceIds.length
          ? occurrence.serviceIds
          : [occurrence?.serviceId]
      )
        .map((serviceId) => String(serviceId || "").trim())
        .filter(Boolean);
      if (!occurrenceServiceIds.some((serviceId) => planServiceIds.has(serviceId))) {
        return false;
      }
      const occurrenceStartsAt = String(occurrence?.startsAt || "").trim();
      if (planStartsAt && occurrenceStartsAt === planStartsAt) return true;
      return Boolean(
        planDate && publicOccurrenceDate(occurrenceStartsAt, timezone) === planDate,
      );
    },
  );
};

const publicMemberName = (member) =>
  `${String(member?.firstName || "").trim()} ${String(member?.lastName || "").trim()}`.trim();

/**
 * Public detailed links only need roster records for people assigned to the
 * matching schedule occurrence. Keep this selection beside the occurrence
 * matcher so the loader and serializer cannot drift apart.
 */
export const publicServingMemberIdsForPlan = ({
  plan,
  schedules = [],
  timezone,
}) => {
  const memberIds = new Set();
  (Array.isArray(schedules) ? schedules : []).forEach((schedule) => {
    const occurrence = scheduleOccurrenceForPlan(schedule, plan, timezone);
    const occurrenceId = String(occurrence?.occurrenceId || "").trim();
    if (!occurrenceId) return;
    const assignments = schedule?.assignments?.[occurrenceId] || {};
    Object.entries(schedule?.microphoneAssignments?.[occurrenceId] || {}).forEach(
      ([slotKey, microphoneIds]) => {
        if (!Array.isArray(microphoneIds) || !microphoneIds.length) return;
        const assignment = assignments[slotKey];
        const memberId = String(assignment?.primaryMemberId || "").trim();
        if (memberId) memberIds.add(memberId);
      },
    );
  });
  return [...memberIds];
};

/**
 * Minimal roster projection for the detailed/team share link. Only scheduled
 * people on teams that opted into microphone assignments are included, and a
 * row appears only when that person has an allocated church microphone.
 */
export const buildPublicServingTeams = ({
  plan,
  schedules = [],
  positions = [],
  members = [],
  teams = [],
  microphonesById,
  timezone,
}) => {
  const teamsById = new Map(
    (Array.isArray(teams) ? teams : [])
      .map((team) => {
        const teamId = String(team?.teamId || team?.id || "").trim();
        return teamId ? [teamId, team] : null;
      })
      .filter(Boolean),
  );
  const positionsById = new Map(
    (Array.isArray(positions) ? positions : [])
      .map((position) => {
        const positionId = String(position?.positionId || position?.id || "").trim();
        return positionId ? [positionId, position] : null;
      })
      .filter(Boolean),
  );
  const membersById = new Map(
    (Array.isArray(members) ? members : [])
      .map((member) => {
        const memberId = String(member?.memberId || member?.id || "").trim();
        const memberName = publicMemberName(member);
        return memberId && memberName
          ? [
              memberId,
              {
                memberName,
                profileImageUrl: String(member?.profileImageUrl || "").trim(),
              },
            ]
          : null;
      })
      .filter(Boolean),
  );
  const groupedTeams = new Map();

  (Array.isArray(schedules) ? schedules : []).forEach((schedule) => {
    const occurrence = scheduleOccurrenceForPlan(schedule, plan, timezone);
    const occurrenceId = String(occurrence?.occurrenceId || "").trim();
    if (!occurrenceId) return;
    const microphoneRows = schedule?.microphoneAssignments?.[occurrenceId];
    const assignmentRows = schedule?.assignments?.[occurrenceId];
    if (!microphoneRows || !assignmentRows) return;
    const guestsById = new Map(
      (Array.isArray(schedule?.guests) ? schedule.guests : [])
        .map((guest) => [String(guest?.guestId || "").trim(), String(guest?.name || "").trim()])
        .filter((entry) => entry[0] && entry[1]),
    );

    Object.entries(microphoneRows).forEach(([slotKey, microphoneIds]) => {
      const positionId = String(slotKey).split("::")[0];
      const position = positionsById.get(positionId);
      const teamId = String(position?.teamId || schedule?.teamId || "").trim();
      const team = teamsById.get(teamId);
      if (!team?.usesMicrophoneAssignments) return;
      const memberId = String(assignmentRows?.[slotKey]?.primaryMemberId || "").trim();
      const member = membersById.get(memberId);
      const memberName = member?.memberName || guestsById.get(memberId) || "";
      const microphoneList = (Array.isArray(microphoneIds) ? microphoneIds : [])
        .map((microphoneId) => microphonesById?.get(String(microphoneId || "").trim()))
        .filter(Boolean);
      if (!memberName || !microphoneList.length) return;

      const existing = groupedTeams.get(teamId) || {
        teamId,
        teamName: String(team?.name || "Team").trim() || "Team",
        members: [],
      };
      existing.members.push({
        positionId,
        positionName: String(position?.name || "Position").trim() || "Position",
        memberName,
        ...(member?.profileImageUrl
          ? { profileImageUrl: member.profileImageUrl }
          : {}),
        microphones: microphoneList,
      });
      groupedTeams.set(teamId, existing);
    });
  });

  return Array.from(groupedTeams.values())
    .map((team) => ({
      ...team,
      members: team.members.sort((left, right) =>
        left.positionName.localeCompare(right.positionName) ||
        left.memberName.localeCompare(right.memberName),
      ),
    }))
    .sort((left, right) => left.teamName.localeCompare(right.teamName));
};

const serializePublicMicrophoneAssignments = (
  element,
  microphonesById,
  configuredAudiences,
  hasConfiguredAudiences,
) =>
  readServicePlanAssignees(element)
    .flatMap((assignee) =>
      (Array.isArray(assignee?.microphoneIds)
        ? assignee.microphoneIds
        : []
      ).map((microphoneId) => ({ assignee, microphoneId })),
    )
    .map(({ assignee, microphoneId }) => {
      const microphone = microphonesById.get(String(microphoneId || "").trim());
      if (!microphone) return null;
      const holderName = String(assignee?.name || "").trim();
      const legacyAssignment = (element?.microphoneAssignments || []).find(
        (assignment) =>
          String(assignment?.microphoneId || "").trim() ===
          String(microphoneId || "").trim(),
      );
      const audiences = (
        hasConfiguredAudiences
          ? configuredAudiences
          : Array.isArray(legacyAssignment?.audiences)
            ? legacyAssignment.audiences
            : []
      )
        .map((audience) => {
          const positionId = String(audience?.positionId || "").trim();
          const roleName = String(audience?.roleName || "").trim();
          if (!positionId || !roleName) return null;
          const teamId = String(audience?.teamId || "").trim();
          const teamName = String(audience?.teamName || "").trim();
          return {
            positionId,
            roleName,
            ...(teamId ? { teamId } : {}),
            ...(teamName ? { teamName } : {}),
          };
        })
        .filter(Boolean);
      // Previously a microphone with no audiences was dropped entirely. A named
      // holder is itself an answer to "who has this", so it now carries the row.
      return audiences.length || holderName
        ? {
            microphone,
            audiences,
            ...(holderName ? { holderName } : {}),
          }
        : null;
    })
    .filter(Boolean);

/**
 * Slim role roster for the public detailed-view notes/mic filter. Quiet roles
 * (no notes/mics on the plan) must still be selectable so viewers can hide
 * other roles' notes. General/simple view never receives this list.
 */
export const buildPublicFilterRoles = (positions = [], teams = []) => {
  const teamNamesById = new Map(
    (Array.isArray(teams) ? teams : [])
      .map((team) => {
        const teamId = String(team?.teamId || team?.id || "").trim();
        const teamName = String(team?.name || "").trim();
        return teamId && teamName ? [teamId, teamName] : null;
      })
      .filter(Boolean),
  );
  return (Array.isArray(positions) ? positions : [])
    .filter((position) => !position?.archivedAt)
    .map((position) => {
      const positionId = String(
        position?.positionId || position?.id || "",
      ).trim();
      const label = String(position?.name || "").trim();
      if (!positionId || !label) return null;
      const teamId = String(position?.teamId || "").trim();
      const teamName =
        String(position?.teamName || "").trim() ||
        (teamId ? teamNamesById.get(teamId) || "" : "");
      return {
        positionId,
        label,
        ...(teamId ? { teamId } : {}),
        ...(teamName ? { teamName } : {}),
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.label.localeCompare(right.label));
};

/**
 * The serving (detailed) projection includes viewer-selectable team notes and
 * assignee credits. The general (simple) projection is deliberately built
 * without any operational notes, so a broadly shared link cannot reveal them
 * through the client. Assignee credits remain on both views.
 */
export const buildPublicServicePlanSnapshot = ({
  plan,
  microphones = [],
  microphoneAudiences,
  positions = [],
  teams = [],
  schedules = [],
  members = [],
  churchName = "",
  churchLogoUrl = "",
  churchPrimaryColor = "",
  churchSecondaryColor = "",
  serverNowMs = Date.now(),
  viewMode = "team",
  shareId,
}) => {
  if (!plan?.published || !plan.publicLinkToken || !plan.startsAt) return null;
  const startsAtMs = Date.parse(plan.startsAt);
  if (Number.isNaN(startsAtMs)) return null;

  const itemIds = new Set(
    (plan.sections || []).flatMap((section) =>
      (section.elements || []).map((element) => element.id),
    ),
  );
  const anchoredStartsAtMs = Date.parse(
    String(plan.publicLive?.startedAt || ""),
  );
  const live =
    plan.publicLive?.mode === "anchored" &&
    itemIds.has(plan.publicLive.currentElementId) &&
    Number.isFinite(anchoredStartsAtMs)
      ? {
          mode: "anchored",
          currentItemId: plan.publicLive.currentElementId,
          startedAt: new Date(anchoredStartsAtMs).toISOString(),
        }
      : plan.publicLive?.mode === "manual" &&
          itemIds.has(plan.publicLive.currentElementId)
        ? { mode: "manual", currentItemId: plan.publicLive.currentElementId }
        : { mode: "schedule" };

  const isGeneralView = viewMode === "general";
  const publicShareId = String(
    shareId ||
      (isGeneralView ? plan.publicGeneralLinkToken : plan.publicLinkToken) ||
      "",
  ).trim();
  if (!publicShareId) return null;

  const primaryColor = String(churchPrimaryColor || "").trim();
  const secondaryColor = String(churchSecondaryColor || "").trim();
  const timezone = normalizeTimezone(plan.timezone);
  const timelineStartMs = resolveTimelineStartMs(
    startsAtMs,
    timezone,
    plan.sections,
  );
  // Mic catalog + audiences are church-wide; build once for every element.
  const hasConfiguredAudiences = Array.isArray(microphoneAudiences);
  const microphonesById = isGeneralView
    ? null
    : buildPublicMicrophonesById(microphones);
  const configuredAudiences = isGeneralView
    ? null
    : normalizePublicMicrophoneAudiences(microphoneAudiences);
  const roles = isGeneralView ? [] : buildPublicFilterRoles(positions, teams);
  const servingTeams = isGeneralView
    ? []
    : buildPublicServingTeams({
        plan,
        schedules,
        positions,
        members,
        teams,
        microphonesById,
        timezone,
      });

  return {
    success: true,
    churchName: String(churchName || "").trim(),
    ...(String(churchLogoUrl || "").trim()
      ? { churchLogoUrl: String(churchLogoUrl).trim() }
      : {}),
    ...(primaryColor ? { churchPrimaryColor: primaryColor } : {}),
    ...(secondaryColor ? { churchSecondaryColor: secondaryColor } : {}),
    ...(roles.length ? { roles } : {}),
    ...(servingTeams.length ? { servingTeams } : {}),
    serverNowMs,
    service: {
      shareId: publicShareId,
      viewMode: isGeneralView ? "general" : "team",
      title: String(plan.name || "Service").trim() || "Service",
      startsAt: new Date(startsAtMs).toISOString(),
      ...(timelineStartMs !== startsAtMs
        ? { timelineStartsAt: new Date(timelineStartMs).toISOString() }
        : {}),
      timezone,
      revision: Date.parse(plan.updatedAt || "") || 0,
      sections: (plan.sections || []).map((section, sectionIndex) => ({
        id: String(section.id || `section-${sectionIndex + 1}`),
        title: String(section.name || "").trim(),
        items: (section.elements || []).map((element, elementIndex) => ({
          id: String(
            element.id || `item-${sectionIndex + 1}-${elementIndex + 1}`,
          ),
          title: richTextToPlainText(element.title) || "Untitled item",
          durationSeconds: getDurationSeconds(
            element.durationSeconds,
            element.durationMinutes,
          ),
          notes: isGeneralView
            ? { blocks: [] }
            : normalizeRichTextDocument(element.notes),
          teamNotes: isGeneralView
            ? []
            : serializePublicTeamNotes(element.teamNotes),
          microphoneAssignments: isGeneralView
            ? []
            : serializePublicMicrophoneAssignments(
                element,
                microphonesById,
                configuredAudiences,
                hasConfiguredAudiences,
              ),
          ...(publicAssigneeCredit(element)
            ? { creditName: publicAssigneeCredit(element) }
            : {}),
        })),
      })),
      live,
    },
  };
};
