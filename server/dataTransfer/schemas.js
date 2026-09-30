import { formatPortableDate, formatPortableTime } from "./time.js";

export const LIST_DELIMITER = " | ";

export const PORTABLE_SCHEMAS = {
  members: ["First Name", "Last Name", "Title", "Email", "Phone", "Teams", "Positions", "Notes", "Serving Frequency", "Archived", "WorshipSync Member ID", "WorshipSync Team IDs", "WorshipSync Position IDs"],
  teams: ["Team", "Description", "Uses Microphones", "Uses IEMs", "Archived", "WorshipSync Team ID"],
  positions: ["Position", "Team", "Description", "Group", "Order", "Archived", "WorshipSync Position ID", "WorshipSync Team ID", "Icon"],
  services: ["Service", "Recurrence", "Time", "Date", "Days of Week", "Start Date", "End Date", "Week Ordinal", "Weekday", "Combined Group", "Position", "Required Slots", "Archived", "WorshipSync Service ID", "WorshipSync Position ID"],
  schedules: ["Schedule", "Start Date", "End Date", "Service", "Date", "Start Time", "Team", "Position", "Slot", "Person", "Email", "Assignment Type", "Guest", "WorshipSync Schedule ID", "WorshipSync Occurrence ID", "WorshipSync Service ID", "WorshipSync Team ID", "WorshipSync Position ID", "WorshipSync Member ID"],
};
const listNames = (ids, byId) => (ids || []).map((id) => byId.get(id)?.name).filter(Boolean).join(LIST_DELIMITER);
const archived = (record) => record?.archivedAt ? "true" : "false";
const datePart = (iso) => String(iso || "").slice(0, 10);
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const portableServiceGroupLabel = (service, services) => {
  if (!service?.serviceGroupId) return "";
  const members = services.filter((item) => item.serviceGroupId === service.serviceGroupId);
  const descriptions = members.map((item) => {
    const cadence = item.reccurence === "one_time"
      ? datePart(item.dateTimeISO)
      : item.reccurence === "multi_weekly"
        ? (item.daysOfWeek || []).map((day) => `${WEEKDAY_NAMES[day.day] || day.day} ${day.time}`).join(", ")
        : item.reccurence === "monthly"
          ? `${item.ordinal} ${WEEKDAY_NAMES[item.weekday] || item.weekday} ${item.time || ""}`.trim()
          : `${WEEKDAY_NAMES[item.dayOfWeek] || item.dayOfWeek} ${item.time || ""}`.trim();
    const bounds = [item.startDateISO, item.endDateISO].filter(Boolean).join(" to ");
    return `${item.name} (${cadence}${bounds ? `; ${bounds}` : ""})`;
  });
  return descriptions.sort((a, b) => a.localeCompare(b)).join(LIST_DELIMITER);
};

export const buildPortableDatasets = ({ members = [], teams = [], positions = [], services = [], schedules = [] }, { timeZone = "UTC" } = {}) => {
  const teamsById = new Map(teams.map((team) => [team.teamId, team]));
  const positionsById = new Map(positions.map((position) => [position.positionId, position]));
  const membersById = new Map(members.map((member) => [member.memberId, member]));
  const serviceById = new Map(services.map((service) => [service.serviceId || service.id, service]));
  const combinedGroupById = new Map();
  const servicesByGroup = new Map();
  services.forEach((service) => {
    if (!service.serviceGroupId) return;
    servicesByGroup.set(service.serviceGroupId, [...(servicesByGroup.get(service.serviceGroupId) || []), service]);
  });
  services.forEach((service) => combinedGroupById.set(service.serviceId || service.id, portableServiceGroupLabel(service, services)));

  const memberRows = members.map((member) => {
    const effectiveTeamIds = new Set([
      ...(member.teamMemberships && typeof member.teamMemberships === "object"
        ? Object.keys(member.teamMemberships)
        : []),
      ...(member.positionIds || []).map((positionId) => positionsById.get(positionId)?.teamId).filter(Boolean),
      ...teams.filter((team) => (team.memberIds || []).includes(member.memberId)).map((team) => team.teamId),
    ]);
    const memberTeamIds = teams.map((team) => team.teamId).filter((teamId) => effectiveTeamIds.has(teamId));
    return [member.firstName, member.lastName, member.title, member.email, member.phoneNumber,
      listNames(memberTeamIds, teamsById), listNames(member.positionIds, positionsById), member.notes,
      member.servingFrequency, archived(member), member.memberId,
      memberTeamIds.join(LIST_DELIMITER), (member.positionIds || []).join(LIST_DELIMITER)];
  });
  const teamRows = teams.map((team) => [team.name, team.description, Boolean(team.usesMicrophoneAssignments), Boolean(team.usesIemAssignments), archived(team), team.teamId]);
  const positionRows = positions.map((position) => [position.name, teamsById.get(position.teamId)?.name, position.description, position.groupId, position.order, archived(position), position.positionId, position.teamId, serializePortablePositionIcon(position.icon)]);
  const serviceRows = services.flatMap((service) => {
    const requirements = Array.isArray(service.positionRequirements) ? service.positionRequirements : [];
    const rows = requirements.length ? requirements : [null];
    return rows.map((requirement) => [
      service.name, service.reccurence, service.time || (service.reccurence === "one_time" ? String(service.dateTimeISO || "").slice(11, 16) : ""), datePart(service.dateTimeISO),
      (service.daysOfWeek || []).map(({ day, time }) => `${WEEKDAY_NAMES[day] || day}@${time}`).join(LIST_DELIMITER),
      service.startDateISO, service.endDateISO, service.ordinal,
      WEEKDAY_NAMES[service.weekday ?? service.dayOfWeek] || (service.weekday ?? service.dayOfWeek),
      combinedGroupById.get(service.serviceId || service.id) || "",
      requirement ? positionsById.get(requirement.positionId)?.name : "", requirement?.count ?? "",
      archived(service), service.serviceId || service.id, requirement?.positionId || "",
    ]);
  });

  const scheduleRows = [];
  schedules.forEach((schedule) => {
    const team = teamsById.get(schedule.teamId);
    const occurrences = schedule.occurrences || [];
    occurrences.forEach((occurrence) => {
      const required = new Map();
      (occurrence.positionRequirements || []).forEach(({ positionId, count }) => required.set(positionId, Math.max(required.get(positionId) || 0, count || 0)));
      (schedule.additionalPositionSlots?.[occurrence.occurrenceId] || []).forEach((key) => {
        const separator = key.lastIndexOf("::");
        if (separator > 0) {
          const positionId = key.slice(0, separator);
          const slot = Number(key.slice(separator + 2));
          if (Number.isInteger(slot) && slot >= 0) required.set(positionId, Math.max(required.get(positionId) || 0, slot + 1));
        }
      });
      Object.entries(schedule.assignments?.[occurrence.occurrenceId] || {}).forEach(([key]) => {
        const separator = key.lastIndexOf("::");
        if (separator > 0) {
          const positionId = key.slice(0, separator);
          const slot = Number(key.slice(separator + 2));
          required.set(positionId, Math.max(required.get(positionId) || 0, slot + 1));
        }
      });
      const slotRows = [];
      required.forEach((count, positionId) => {
        for (let slot = 0; slot < count; slot += 1) {
          const slotKey = `${positionId}::${slot}`;
          const cell = schedule.assignments?.[occurrence.occurrenceId]?.[slotKey] || {};
          const people = [];
          if (cell.primaryMemberId) people.push({ id: cell.primaryMemberId, kind: "primary" });
          (cell.shadows || []).forEach((shadow) => people.push({ id: shadow.memberId, kind: shadow.kind }));
          if (!people.length) people.push({ id: "", kind: "" });
          people.forEach(({ id, kind }) => {
            const member = membersById.get(id);
            const guest = (schedule.guests || []).find((item) => item.guestId === id);
            const relatedServiceIds = occurrence.serviceIds?.length ? occurrence.serviceIds : [occurrence.serviceId];
            const service = serviceById.get(occurrence.serviceId) || serviceById.get(relatedServiceIds[0]);
            const startTime = service?.time || formatPortableTime(occurrence.startsAt, timeZone);
            slotRows.push([
              schedule.name, schedule.startDate, schedule.endDate, relatedServiceIds.map((serviceId) => serviceById.get(serviceId)?.name).filter(Boolean).join(LIST_DELIMITER),
              formatPortableDate(occurrence.startsAt, timeZone), startTime, team?.name, positionsById.get(positionId)?.name,
              slot + 1, guest?.name || [member?.firstName, member?.lastName].filter(Boolean).join(" "), guest?.email || member?.email,
              kind, guest ? "true" : "false", schedule.scheduleId, occurrence.occurrenceId, service?.serviceId || service?.id,
              schedule.teamId, positionId, guest ? "" : (member?.memberId || id),
            ]);
          });
        }
      });
      if (!slotRows.length) {
        const relatedServiceIds = occurrence.serviceIds?.length ? occurrence.serviceIds : [occurrence.serviceId];
        const service = serviceById.get(occurrence.serviceId) || serviceById.get(relatedServiceIds[0]);
        scheduleRows.push([schedule.name, schedule.startDate, schedule.endDate, relatedServiceIds.map((id) => serviceById.get(id)?.name).filter(Boolean).join(LIST_DELIMITER), formatPortableDate(occurrence.startsAt, timeZone), service?.time || formatPortableTime(occurrence.startsAt, timeZone), team?.name, "", "", "", "", "", "false", schedule.scheduleId, occurrence.occurrenceId, occurrence.serviceId, schedule.teamId, "", ""]);
      } else scheduleRows.push(...slotRows);
    });
  });

  return { members: memberRows, teams: teamRows, positions: positionRows, services: serviceRows, schedules: scheduleRows };
};

export const serializePortablePositionIcon = (icon) => {
  if (!icon) return "";
  return typeof icon === "string" ? icon : JSON.stringify(icon);
};

export const parsePortablePositionIcon = (value) => {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (!text.startsWith("{")) return text;
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an icon object");
    }
    const isLegacyCustom = parsed.source === "custom"
      && typeof parsed.id === "string" && parsed.id.trim();
    const isSupportedReference = ["lucide", "tabler", "worshipsync"].includes(parsed.source)
      && typeof parsed.name === "string" && parsed.name.trim();
    if (!isLegacyCustom && !isSupportedReference) {
      throw new Error("unsupported icon reference");
    }
    return parsed;
  } catch {
    const error = new Error("Position icon data must be a Lucide name or a valid icon reference.");
    error.statusCode = 400;
    throw error;
  }
};
