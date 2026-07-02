import type {
  TeamIntakeForm,
  TeamMemberQualification,
  TeamBlockoutDateRange,
  TeamPosition,
  TeamQualificationArea,
  TeamQualificationLevel,
  TeamRecord,
  TeamRosterMember,
  TeamRole,
  TeamSchedule,
  TeamService,
} from "../../api/authTypes";
import type {
  TeamIntakeFormPayload,
  TeamPayload,
  TeamPositionPayload,
  TeamQualificationAreaPayload,
  TeamQualificationLevelPayload,
  TeamRosterMemberPayload,
  TeamRolePayload,
  TeamSchedulePayload,
} from "../../api/auth";
import type { ServiceTime } from "../../types";
import { formatServiceTiming } from "./teamsUtils";

export type MemberSaveChangeContext = {
  positionNameById: Map<string, string>;
  teamNameById: Map<string, string>;
  roleNameById: Map<string, string>;
};

export type EntityNameContext = {
  teamNameById: Map<string, string>;
  memberNameById?: Map<string, string>;
  serviceNameById?: Map<string, string>;
};

const normalizeText = (value?: string) => (value || "").trim();

export const formatEntitySaveToast = (
  displayName: string,
  isCreate: boolean,
  changes: string[],
  fallbackLabel = "Item",
): string => {
  const label = displayName.trim() || fallbackLabel;
  if (isCreate) {
    return `Added ${label}.`;
  }
  if (changes.length === 0) {
    return `Saved ${label}.`;
  }
  return `Updated ${label}: ${changes.join("; ")}.`;
};

const describeIdListChanges = (
  label: string,
  previousIds: string[],
  nextIds: string[],
  nameById: Map<string, string>,
  fallbackLabel: string,
): string | null => {
  const previousSet = new Set(previousIds);
  const nextSet = new Set(nextIds);
  const added = nextIds.filter((id) => !previousSet.has(id));
  const removed = previousIds.filter((id) => !nextSet.has(id));
  if (added.length === 0 && removed.length === 0) {
    return null;
  }

  const nameFor = (id: string) => nameById.get(id) || fallbackLabel;
  const parts: string[] = [];
  if (added.length > 0) {
    parts.push(`added ${added.map(nameFor).join(", ")}`);
  }
  if (removed.length > 0) {
    parts.push(`removed ${removed.map(nameFor).join(", ")}`);
  }
  return `${label}: ${parts.join("; ")}`;
};

const describeNamedEntityChanges = (
  previous: { name: string; description?: string; icon?: string },
  next: { name: string; description?: string; icon?: string },
  options?: { includeIcon?: boolean },
): string[] => {
  const changes: string[] = [];
  if (normalizeText(previous.name) !== normalizeText(next.name)) {
    changes.push("Name");
  }
  if (normalizeText(previous.description) !== normalizeText(next.description)) {
    changes.push("Description");
  }
  if (options?.includeIcon && (previous.icon || "") !== (next.icon || "")) {
    changes.push("Icon");
  }
  return changes;
};

const normalizeMemberSavePayload = (
  payload: TeamRosterMemberPayload,
): TeamRosterMemberPayload => ({
  ...payload,
  firstName: payload.firstName.trim(),
  lastName: payload.lastName.trim(),
  dateOfBirth: payload.dateOfBirth || "",
  positionIds: [...(payload.positionIds || [])],
  desiredPositionIds: [...(payload.desiredPositionIds || [])],
  teamMemberships: payload.teamMemberships || {},
  qualifications: payload.qualifications || [],
  blockoutDates: (payload.blockoutDates || []).filter(
    (range) => range.startDate || range.endDate,
  ),
  notes: (payload.notes || "").trim(),
});

const memberToSavePayload = (
  member: TeamRosterMember,
): TeamRosterMemberPayload =>
  normalizeMemberSavePayload({
    firstName: member.firstName,
    lastName: member.lastName,
    dateOfBirth: member.dateOfBirth || "",
    positionIds: member.positionIds || [],
    desiredPositionIds: member.desiredPositionIds || [],
    teamMemberships: member.teamMemberships || {},
    qualifications: member.qualifications || [],
    blockoutDates: member.blockoutDates || [],
    notes: member.notes || "",
  });

const normalizeQualificationForCompare = (
  qualification: TeamMemberQualification,
) => ({
  areaId: qualification.areaId || "",
  levelId: qualification.levelId || "",
  status: qualification.status || "in_training",
  completedAt: qualification.completedAt || "",
  expiresAt: qualification.expiresAt || "",
  notes: (qualification.notes || "").trim(),
});

const normalizeBlockoutForCompare = (range: TeamBlockoutDateRange) => ({
  startDate: range.startDate || "",
  endDate: range.endDate || "",
  notes: (range.notes || "").trim(),
});

export const describeMemberSaveChanges = (
  previous: TeamRosterMember | null,
  next: TeamRosterMemberPayload,
  context: MemberSaveChangeContext,
): string[] => {
  if (!previous) {
    return [];
  }

  const prior = memberToSavePayload(previous);
  const saved = normalizeMemberSavePayload(next);
  const changes: string[] = [];

  if (
    prior.firstName !== saved.firstName ||
    prior.lastName !== saved.lastName
  ) {
    changes.push("Name");
  }
  if (prior.dateOfBirth !== saved.dateOfBirth) {
    changes.push("Date of birth");
  }
  if (prior.notes !== saved.notes) {
    changes.push("Notes");
  }

  const positionsChange = describeIdListChanges(
    "Positions",
    prior.positionIds,
    saved.positionIds,
    context.positionNameById,
    "position",
  );
  if (positionsChange) {
    changes.push(positionsChange);
  }

  const desiredPositionsChange = describeIdListChanges(
    "Desired positions",
    prior.desiredPositionIds || [],
    saved.desiredPositionIds || [],
    context.positionNameById,
    "position",
  );
  if (desiredPositionsChange) {
    changes.push(desiredPositionsChange);
  }

  const previousMemberships = prior.teamMemberships || {};
  const nextMemberships = saved.teamMemberships || {};
  const teamIds = Array.from(
    new Set([
      ...Object.keys(previousMemberships),
      ...Object.keys(nextMemberships),
    ]),
  );
  const roleChanges = teamIds.flatMap((teamId) => {
    const previousRoleId = previousMemberships[teamId]?.roleId || "";
    const nextRoleId = nextMemberships[teamId]?.roleId || "";
    if (previousRoleId === nextRoleId) {
      return [];
    }
    const teamLabel = context.teamNameById.get(teamId) || "Team";
    const previousRole = context.roleNameById.get(previousRoleId) || "No role";
    const nextRole = context.roleNameById.get(nextRoleId) || "No role";
    return [`${teamLabel} role: ${previousRole} → ${nextRole}`];
  });
  if (roleChanges.length === 1) {
    changes.push(roleChanges[0]);
  } else if (roleChanges.length > 1) {
    changes.push(`Team roles (${roleChanges.join("; ")})`);
  }

  const previousQualifications = (prior.qualifications || [])
    .map(normalizeQualificationForCompare)
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const nextQualifications = (saved.qualifications || [])
    .map(normalizeQualificationForCompare)
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (
    JSON.stringify(previousQualifications) !==
    JSON.stringify(nextQualifications)
  ) {
    changes.push("Qualifications");
  }

  const previousBlockouts = (prior.blockoutDates || [])
    .map(normalizeBlockoutForCompare)
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const nextBlockouts = (saved.blockoutDates || [])
    .map(normalizeBlockoutForCompare)
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (JSON.stringify(previousBlockouts) !== JSON.stringify(nextBlockouts)) {
    changes.push("Blockout dates");
  }

  return changes;
};

export const formatMemberSaveToast = (
  previous: TeamRosterMember | null,
  next: TeamRosterMemberPayload,
  context: MemberSaveChangeContext,
): string => {
  const saved = normalizeMemberSavePayload(next);
  const name = `${saved.firstName} ${saved.lastName}`.trim() || "Member";
  return formatEntitySaveToast(
    name,
    !previous,
    describeMemberSaveChanges(previous, saved, context),
    "Member",
  );
};

const normalizeTeamPayload = (payload: TeamPayload): TeamPayload => ({
  name: payload.name.trim(),
  description: normalizeText(payload.description),
  icon: payload.icon || "",
  memberIds: [...payload.memberIds],
});

const teamToSavePayload = (team: TeamRecord): TeamPayload =>
  normalizeTeamPayload({
    name: team.name,
    description: team.description || "",
    icon: team.icon || "",
    memberIds: team.memberIds || [],
  });

export const formatTeamSaveToast = (
  previous: TeamRecord | null,
  next: TeamPayload,
  context: Pick<EntityNameContext, "memberNameById">,
): string => {
  const saved = normalizeTeamPayload(next);
  const name = saved.name || "Team";
  const changes: string[] = [];

  if (previous) {
    const prior = teamToSavePayload(previous);
    changes.push(
      ...describeNamedEntityChanges(prior, saved, {
        includeIcon: true,
      }),
    );
    const membersChange = describeIdListChanges(
      "Members",
      prior.memberIds,
      saved.memberIds,
      context.memberNameById || new Map(),
      "member",
    );
    if (membersChange) {
      changes.push(membersChange);
    }
  }

  return formatEntitySaveToast(name, !previous, changes, "Team");
};

const normalizePositionPayload = (
  payload: Pick<TeamPositionPayload, "name" | "description" | "icon">,
) => ({
  name: payload.name.trim(),
  description: normalizeText(payload.description),
  icon: payload.icon || "",
});

const positionToSavePayload = (
  position: TeamPosition,
): Pick<TeamPositionPayload, "name" | "description" | "icon"> =>
  normalizePositionPayload({
    name: position.name,
    description: position.description || "",
    icon: position.icon || "",
  });

export const formatPositionSaveToast = (
  previous: TeamPosition | null,
  next: Pick<TeamPositionPayload, "name" | "description" | "icon">,
): string => {
  const saved = normalizePositionPayload(next);
  const changes = previous
    ? describeNamedEntityChanges(positionToSavePayload(previous), saved, {
        includeIcon: true,
      })
    : [];

  return formatEntitySaveToast(saved.name, !previous, changes, "Position");
};

const normalizeRolePayload = (payload: TeamRolePayload): TeamRolePayload => ({
  teamId: payload.teamId,
  name: payload.name.trim(),
  description: normalizeText(payload.description),
});

const roleToSavePayload = (role: TeamRole): TeamRolePayload =>
  normalizeRolePayload({
    teamId: role.teamId,
    name: role.name,
    description: role.description || "",
  });

export const formatTeamRoleSaveToast = (
  previous: TeamRole | null,
  next: TeamRolePayload,
): string => {
  const saved = normalizeRolePayload(next);
  const changes = previous
    ? describeNamedEntityChanges(roleToSavePayload(previous), saved)
    : [];

  return formatEntitySaveToast(saved.name, !previous, changes, "Role");
};

const normalizeQualificationAreaPayload = (
  payload: TeamQualificationAreaPayload,
): TeamQualificationAreaPayload => ({
  teamId: payload.teamId,
  name: payload.name.trim(),
  description: normalizeText(payload.description),
});

const qualificationAreaToSavePayload = (
  area: TeamQualificationArea,
): TeamQualificationAreaPayload =>
  normalizeQualificationAreaPayload({
    teamId: area.teamId,
    name: area.name,
    description: area.description || "",
  });

export const formatQualificationAreaSaveToast = (
  previous: TeamQualificationArea | null,
  next: TeamQualificationAreaPayload,
): string => {
  const saved = normalizeQualificationAreaPayload(next);
  const changes = previous
    ? describeNamedEntityChanges(
        qualificationAreaToSavePayload(previous),
        saved,
      )
    : [];

  return formatEntitySaveToast(
    saved.name,
    !previous,
    changes,
    "Qualification area",
  );
};

const normalizeQualificationLevelPayload = (
  payload: TeamQualificationLevelPayload,
): TeamQualificationLevelPayload => ({
  areaId: payload.areaId,
  name: payload.name.trim(),
  description: normalizeText(payload.description),
  rank: payload.rank,
});

const qualificationLevelToSavePayload = (
  level: TeamQualificationLevel,
): TeamQualificationLevelPayload =>
  normalizeQualificationLevelPayload({
    areaId: level.areaId,
    name: level.name,
    description: level.description || "",
    rank: level.rank,
  });

export const formatQualificationLevelSaveToast = (
  previous: TeamQualificationLevel | null,
  next: TeamQualificationLevelPayload,
): string => {
  const saved = normalizeQualificationLevelPayload(next);
  const changes: string[] = [];
  if (previous) {
    changes.push(
      ...describeNamedEntityChanges(
        qualificationLevelToSavePayload(previous),
        saved,
      ),
    );
    if (qualificationLevelToSavePayload(previous).rank !== saved.rank) {
      changes.push("Rank");
    }
  }

  return formatEntitySaveToast(
    saved.name,
    !previous,
    changes,
    "Qualification level",
  );
};

const intakeFormToSavePayload = (
  form: TeamIntakeForm,
): TeamIntakeFormPayload => ({
  name: form.name,
  startDate: form.startDate || "",
  endDate: form.endDate || "",
  availabilityServices: form.availabilityServices || [],
  availabilityOccurrences: form.availabilityOccurrences || [],
  teamIds: form.teamIds || [],
  active: form.active ?? true,
  welcomeMessage: form.welcomeMessage || "",
  positionsMessage: form.positionsMessage || "",
  availabilityMessage: form.availabilityMessage || "",
  notesMessage: form.notesMessage || "",
});

const normalizeIntakeFormPayload = (
  payload: TeamIntakeFormPayload,
): TeamIntakeFormPayload => ({
  ...payload,
  name: payload.name.trim(),
  startDate: payload.startDate || "",
  endDate: payload.endDate || "",
  availabilityServices: payload.availabilityServices || [],
  availabilityOccurrences: payload.availabilityOccurrences || [],
  teamIds: [...(payload.teamIds || [])],
  welcomeMessage: normalizeText(payload.welcomeMessage),
  positionsMessage: normalizeText(payload.positionsMessage),
  availabilityMessage: normalizeText(payload.availabilityMessage),
  notesMessage: normalizeText(payload.notesMessage),
});

export const describeIntakeFormSaveChanges = (
  previous: TeamIntakeForm | null,
  next: TeamIntakeFormPayload,
  context: EntityNameContext,
): string[] => {
  if (!previous) {
    return [];
  }

  const prior = normalizeIntakeFormPayload(intakeFormToSavePayload(previous));
  const saved = normalizeIntakeFormPayload(next);
  const changes: string[] = [];

  if (prior.name !== saved.name) {
    changes.push("Name");
  }
  if (prior.startDate !== saved.startDate || prior.endDate !== saved.endDate) {
    changes.push("Date range");
  }
  if (prior.active !== saved.active) {
    changes.push("Active status");
  }

  const teamsChange = describeIdListChanges(
    "Teams",
    prior.teamIds,
    saved.teamIds,
    context.teamNameById,
    "team",
  );
  if (teamsChange) {
    changes.push(teamsChange);
  }

  const previousServiceIds = prior.availabilityServices.map(
    (service) => service.serviceId,
  );
  const nextServiceIds = saved.availabilityServices.map(
    (service) => service.serviceId,
  );
  const servicesChange = describeIdListChanges(
    "Availability services",
    previousServiceIds,
    nextServiceIds,
    context.serviceNameById || new Map(),
    "service",
  );
  if (servicesChange) {
    changes.push(servicesChange);
  }

  if (
    prior.welcomeMessage !== saved.welcomeMessage ||
    prior.positionsMessage !== saved.positionsMessage ||
    prior.availabilityMessage !== saved.availabilityMessage ||
    prior.notesMessage !== saved.notesMessage
  ) {
    changes.push("Form messages");
  }

  return changes;
};

export const formatIntakeFormSaveToast = (
  previous: TeamIntakeForm | null,
  next: TeamIntakeFormPayload,
  context: EntityNameContext,
): string => {
  const saved = normalizeIntakeFormPayload(next);
  return formatEntitySaveToast(
    saved.name,
    !previous,
    describeIntakeFormSaveChanges(previous, saved, context),
    "Intake form",
  );
};

const scheduleToSavePayload = (
  schedule: TeamSchedule,
): TeamSchedulePayload => ({
  name: schedule.name,
  description: schedule.description || "",
  teamId: schedule.teamId,
  startDate: schedule.startDate || "",
  endDate: schedule.endDate || "",
  serviceIds: schedule.serviceIds || [],
});

const normalizeSchedulePayload = (
  payload: TeamSchedulePayload,
): TeamSchedulePayload => ({
  ...payload,
  name: payload.name.trim(),
  description: normalizeText(payload.description),
  startDate: payload.startDate || "",
  endDate: payload.endDate || "",
  serviceIds: [...payload.serviceIds],
});

export const formatScheduleSaveToast = (
  previous: TeamSchedule | null,
  next: TeamSchedulePayload,
  context: EntityNameContext,
): string => {
  const saved = normalizeSchedulePayload(next);
  const changes: string[] = [];

  if (previous) {
    const prior = normalizeSchedulePayload(scheduleToSavePayload(previous));
    changes.push(...describeNamedEntityChanges(prior, saved));
    if (prior.teamId !== saved.teamId) {
      changes.push("Team");
    }
    if (
      prior.startDate !== saved.startDate ||
      prior.endDate !== saved.endDate
    ) {
      changes.push("Date range");
    }
    const servicesChange = describeIdListChanges(
      "Services",
      prior.serviceIds,
      saved.serviceIds,
      context.serviceNameById || new Map(),
      "service",
    );
    if (servicesChange) {
      changes.push(servicesChange);
    }
  }

  return formatEntitySaveToast(saved.name, !previous, changes, "Schedule");
};

const normalizePositionRequirements = (
  requirements?: ServiceTime["positionRequirements"],
) =>
  [...(requirements || [])]
    .map((requirement) => ({
      positionId: requirement.positionId,
      count: requirement.count,
    }))
    .sort(
      (a, b) => a.positionId.localeCompare(b.positionId) || a.count - b.count,
    );

export const formatServiceSaveToast = (
  previous: TeamService | null,
  next: ServiceTime,
  combinedServiceIds: string[],
  services: TeamService[],
): string => {
  const name = normalizeText(next.name) || "Service";
  const changes: string[] = [];

  if (previous) {
    if (normalizeText(previous.name) !== name) {
      changes.push("Name");
    }
    if (formatServiceTiming(previous) !== formatServiceTiming(next)) {
      changes.push("Schedule");
    }
    if (
      JSON.stringify(
        normalizePositionRequirements(previous.positionRequirements),
      ) !==
      JSON.stringify(normalizePositionRequirements(next.positionRequirements))
    ) {
      changes.push("Position requirements");
    }

    const previousPartners = services
      .filter(
        (service) =>
          service.serviceGroupId &&
          service.serviceGroupId === previous.serviceGroupId &&
          service.serviceId !== previous.serviceId,
      )
      .map((service) => service.serviceId)
      .sort();
    const nextPartners = [...combinedServiceIds].sort();
    const partnersChange = describeIdListChanges(
      "Combined services",
      previousPartners,
      nextPartners,
      new Map(services.map((service) => [service.serviceId, service.name])),
      "service",
    );
    if (partnersChange) {
      changes.push(partnersChange);
    }
  }

  return formatEntitySaveToast(name, !previous, changes, "Service");
};
