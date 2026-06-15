import type { PositionRequirement, ServiceTime } from "../types";

export type { PositionRequirement };

/**
 * Shared auth API types (client). Server: authService.js.
 * Hash fields are never returned; lists are sanitized server-side.
 *
 * appAccess matches GlobalInfoContext AccessType ("full" | "music" | "view")
 * without importing context (avoids circular module graphs).
 */

export type SessionKind = "human" | "workstation" | "display" | null;
export type ChurchStatus = "active" | "needs-admin";
export type DesktopAuthProvider = "google" | "microsoft";
export type DesktopAuthStatus =
  | "pending"
  | "awaiting_exchange"
  | "requires_email_code"
  | "completed"
  | "expired"
  | "failed";

export type ChurchLogoAsset = {
  url: string;
  publicId: string;
  width?: number;
  height?: number;
  format?: string;
};

export type ChurchBrandColor = {
  label?: string;
  value: string;
};

export type ChurchBranding = {
  mission: string;
  vision: string;
  logos: {
    square?: ChurchLogoAsset | null;
    wide?: ChurchLogoAsset | null;
  };
  colors: ChurchBrandColor[];
};

export type TeamsPermission = "none" | "view" | "edit";
export type TeamScopedPermission = Exclude<TeamsPermission, "none">;

export type MemberPermissions = {
  teams: TeamsPermission;
  teamScopes?: Record<string, TeamScopedPermission>;
};

export type AuthBootstrap = {
  authenticated: boolean;
  sessionKind: SessionKind;
  churchId?: string;
  churchName?: string;
  churchStatus?: ChurchStatus;
  recoveryEmail?: string;
  csrfToken?: string | null;
  database?: string;
  uploadPreset?: string;
  appAccess?: "full" | "music" | "view";
  permissions?: MemberPermissions;
  role?: string | null;
  user?: {
    uid: string;
    email: string;
    displayName: string;
    primaryEmail?: string;
    linkedMethods?: string[];
  } | null;
  device?: {
    deviceId: string | null;
    label: string | null;
    operatorName: string | null;
    surfaceType: string | null;
  } | null;
  errorMessage?: string;
};

export type AuthUserSummary = {
  uid: string;
  email: string;
  displayName?: string;
  primaryEmail?: string;
  linkedMethods?: string[];
};

/** Trusted device row from GET api/devices/human (flattened per church admins). */
export type TrustedHumanDeviceListItem = {
  deviceId: string;
  membershipId?: string;
  churchId?: string;
  userId?: string;
  user: AuthUserSummary | null;
  label?: string | null;
  platformType?: string | null;
  lastSeenAt?: string;
  createdAt?: string;
  revokedAt?: string | null;
  deviceFingerprintHash?: string;
};

export type ChurchMemberRow = {
  membershipId: string;
  churchId: string;
  userId: string;
  status: string;
  role?: string;
  appAccess?: string;
  permissions?: MemberPermissions;
  user: AuthUserSummary | null;
};

export type ChurchInviteRow = {
  inviteId: string;
  churchId: string;
  email: string;
  role: string;
  appAccess: string;
  permissions?: MemberPermissions;
  status: string;
  expiresAt: string;
  createdAt: string;
  inviteLink?: string;
};

export type TeamBlockoutDateRange = {
  startDate: string;
  endDate: string;
  notes?: string;
};

export type TeamRosterMember = {
  memberId: string;
  churchId: string;
  firstName: string;
  lastName: string;
  dateOfBirth?: string;
  positionIds: string[];
  teamMemberships?: Record<string, TeamMemberMembership>;
  qualifications?: TeamMemberQualification[];
  blockoutDates: TeamBlockoutDateRange[];
  notes?: string;
  archivedAt?: string | null;
};

export type TeamMemberMembership = {
  teamId: string;
  roleId?: string | null;
  /** Snapshot/free-form label used when a role is renamed, archived, or not catalog-backed yet. */
  roleLabel?: string;
  notes?: string;
};

export type TeamMemberQualificationStatus =
  | "in_training"
  | "completed"
  | "expired";

export type TeamMemberQualification = {
  qualificationId: string;
  areaId: string;
  levelId?: string | null;
  teamId?: string;
  status: TeamMemberQualificationStatus;
  completedAt?: string;
  expiresAt?: string;
  verifiedByUid?: string;
  notes?: string;
};

export type TeamPosition = {
  positionId: string;
  churchId: string;
  // positions are owned by a team
  teamId: string;
  name: string;
  description?: string;
  icon?: string;
  // optional umbrella grouping (e.g. "Camera" for Roving/Stationary Camera)
  groupId?: string;
  // explicit display order within the team; also drives schedule column order
  order?: number;
  archivedAt?: string | null;
};

export type TeamRecord = {
  teamId: string;
  churchId: string;
  name: string;
  description?: string;
  icon?: string;
  memberIds: string[];
  // a team's positions are derived from positions where position.teamId === teamId
  archivedAt?: string | null;
};

export type TeamRole = {
  roleId: string;
  churchId: string;
  teamId: string;
  name: string;
  description?: string;
  archivedAt?: string | null;
};

export type TeamQualificationArea = {
  areaId: string;
  churchId: string;
  teamId: string;
  name: string;
  description?: string;
  archivedAt?: string | null;
};

export type TeamQualificationLevel = {
  levelId: string;
  churchId: string;
  areaId: string;
  name: string;
  description?: string;
  rank: number;
  archivedAt?: string | null;
};

export type TeamService = ServiceTime & {
  serviceId: string;
  churchId: string;
  description?: string;
  archivedAt?: string | null;
};

export type TeamScheduleShadowKind = "shadow" | "reverse_shadow";

export type TeamScheduleShadowAssignment = {
  memberId: string;
  kind: TeamScheduleShadowKind;
};

export type TeamScheduleCellAssignment = {
  primaryMemberId?: string;
  shadows?: TeamScheduleShadowAssignment[];
};

export type TeamScheduleAssignments = Record<
  string,
  Record<string, TeamScheduleCellAssignment>
>;

export type TeamScheduleAttendanceStatus = "present" | "absent";

export type TeamScheduleAttendanceEntry = {
  status: TeamScheduleAttendanceStatus;
  columnKey?: string;
  positionId?: string;
  positionLabel?: string;
  updatedAt?: string;
};

export type TeamScheduleAttendance = Record<
  string,
  Record<string, TeamScheduleAttendanceEntry>
>;

export type TeamScheduleOccurrence = {
  occurrenceId: string;
  serviceId: string;
  name: string;
  startsAt: string;
  // optional per-date override of the service's position requirements
  positionRequirements?: PositionRequirement[];
};

/** Sanitized, read-only schedule payload served to the public view-only link. */
export type TeamSchedulePublicSnapshot = {
  success: boolean;
  churchName: string;
  teamName: string;
  churchLogoUrl?: string;
  schedule: {
    scheduleId: string;
    name: string;
    teamId: string;
    startDate: string;
    endDate: string;
    occurrences: TeamScheduleOccurrence[];
    assignments: TeamScheduleAssignments;
  };
  positions: {
    positionId: string;
    name: string;
    groupId: string;
    archivedAt: string | null;
  }[];
  /** Names are pre-resolved server-side (first name + last initial on collision). */
  members: { memberId: string; name: string }[];
};

export type TeamSchedule = {
  scheduleId: string;
  churchId: string;
  name: string;
  description?: string;
  teamId: string;
  startDate?: string;
  endDate?: string;
  serviceIds: string[];
  occurrences?: TeamScheduleOccurrence[];
  assignments: TeamScheduleAssignments;
  attendance?: TeamScheduleAttendance;
  archivedAt?: string | null;
};

export type TeamsBootstrap = {
  success: boolean;
  members: TeamRosterMember[];
  positions: TeamPosition[];
  teams: TeamRecord[];
  teamRoles?: TeamRole[];
  qualificationAreas?: TeamQualificationArea[];
  qualificationLevels?: TeamQualificationLevel[];
  schedules: TeamSchedule[];
  intakeForms?: TeamIntakeForm[];
  intakeSubmissions?: TeamIntakeSubmission[];
  /** True when any collection hit the server row cap, so this view is partial. */
  truncated?: boolean;
};

export type TeamIntakeAvailabilityService = {
  serviceId: string;
  name: string;
};

export type TeamIntakeAvailabilityOccurrence = {
  occurrenceId: string;
  serviceId: string;
  name: string;
  startsAt: string;
};

export type TeamIntakeForm = {
  formId: string;
  churchId: string;
  name: string;
  startDate: string;
  endDate: string;
  availabilityServices: TeamIntakeAvailabilityService[];
  availabilityOccurrences: TeamIntakeAvailabilityOccurrence[];
  // Teams whose positions this form collects availability for. Empty means the
  // form covers every team in the church (the public form groups by team either
  // way).
  teamIds: string[];
  active: boolean;
  publicUrl?: string;
  submissionCount?: number;
  archivedAt?: string | null;
};

export type TeamIntakeSubmissionStatus =
  | "new"
  | "reviewed"
  | "applied"
  | "dismissed";

export type TeamIntakeBlockoutRange = {
  startDate: string;
  endDate: string;
};

export type TeamIntakeSubmission = {
  submissionId: string;
  formId: string;
  churchId: string;
  firstName: string;
  lastName: string;
  normalizedName: string;
  positionIds: string[];
  occurrenceAvailability: Record<string, "available" | "unavailable">;
  blockoutRanges: TeamIntakeBlockoutRange[];
  notes?: string;
  status: TeamIntakeSubmissionStatus;
  submittedAt: string;
  reviewedAt?: string;
  reviewedByUid?: string;
  appliedAt?: string;
  appliedByUid?: string;
  appliedMemberId?: string;
};

export type TeamIntakePreview = {
  success: boolean;
  churchName: string;
  churchLogoUrl?: string;
  form: Pick<
    TeamIntakeForm,
    | "formId"
    | "name"
    | "startDate"
    | "endDate"
    | "availabilityServices"
    | "availabilityOccurrences"
  >;
  /** Allowlisted position fields only — the public link never ships internal columns. */
  positions: Pick<TeamPosition, "positionId" | "teamId" | "name" | "icon">[];
  /** Teams referenced by `positions`, for grouping the public form by team. */
  teams: { teamId: string; name: string }[];
};

/** Pairing object without tokenHash (token may be present once on create). */
export type PairingClient = {
  pairingId: string;
  churchId: string;
  label: string;
  status: string;
  expiresAt: string;
  createdAt: string;
  token?: string;
  appAccess?: string;
  platformType?: string;
  surfaceType?: string;
};

export type WorkstationDeviceClient = {
  deviceId: string;
  churchId: string;
  label: string;
  appAccess: string;
  platformType?: string;
  status: string;
  createdAt: string;
  lastSeenAt?: string;
  lastOperatorName?: string | null;
  revokedAt?: string | null;
};

export type DisplayDeviceClient = {
  deviceId: string;
  churchId: string;
  label: string;
  surfaceType?: string;
  status: string;
  createdAt: string;
  lastSeenAt?: string;
  revokedAt?: string | null;
};

export type RedeemWorkstationPairingResponse = {
  success: boolean;
  credential?: string;
  sessionEstablished?: boolean;
  bootstrap?: AuthBootstrap;
  device: WorkstationDeviceClient;
};

export type RedeemDisplayPairingResponse = {
  success: boolean;
  credential: string;
  device: DisplayDeviceClient;
};

export type DesktopAuthStartResponse = {
  success: boolean;
  desktopAuthId: string;
  desktopAuthSecret: string;
  browserUrl: string;
  expiresAt: string;
  pollIntervalMs: number;
};

export type DesktopAuthCompleteResponse = {
  success: boolean;
  status: DesktopAuthStatus;
  pendingAuthId?: string | null;
  exchangeCode?: string | null;
};

export type DesktopAuthStatusResponse = {
  success: boolean;
  status: DesktopAuthStatus;
  pendingAuthId?: string | null;
  exchangeCode?: string | null;
  exchangeCodeExpiresAt?: string | null;
};
