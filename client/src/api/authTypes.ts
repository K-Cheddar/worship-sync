import type { PositionRequirement, ServiceTime } from "../types";
import type { TeamScheduleResponses } from "../pages/Teams/schedule/scheduleResponseState";

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
/**
 * "view" is workstation-only for now (see authService.js buildWorkstationBootstrap) —
 * a human member's services permission is never normalized to "view".
 */
export type ServicesPermission = "none" | "view" | "edit";

export type MemberPermissions = {
  teams: TeamsPermission;
  services?: ServicesPermission;
  teamScopes?: Record<string, TeamScopedPermission>;
};

/** "default" resolves per category at send time; the server stores the tri-state. */
export type NotificationPreference = "on" | "off" | "default";

/**
 * One tri-state per notification *category*, not per event — an event list
 * grows with every feature and nobody wants twelve switches. Catalog of record
 * is `server/notificationPreferences.js`.
 *
 * Member categories (`schedule*` for the volunteer) are offered to everyone;
 * owner categories are gated on team-edit access. Which to render comes from
 * `AuthBootstrap.notificationCategories` rather than being hardcoded here.
 */
export type MemberNotifications = {
  /** Added to, moved on, or removed from a schedule. */
  scheduleAssignments: NotificationPreference;
  /** A nudge before a service you are on. */
  scheduleReminders: NotificationPreference;
  /** Someone accepted, declined, or blocked out a date they are on. */
  scheduleResponses: NotificationPreference;
  /** Someone submitted a team availability form. */
  intakeSubmissions: NotificationPreference;
};

export type NotificationCategory = keyof MemberNotifications;

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
  appAccess?: "full" | "music" | "view" | "member";
  permissions?: MemberPermissions;
  notifications?: MemberNotifications;
  /**
   * Categories this person should be offered, server-derived. Sent rather than
   * computed client-side so the catalog has one owner and cannot drift when a
   * category is added or an audience rule changes.
   */
  notificationCategories?: NotificationCategory[];
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

export type TeamMemberServingFrequency =
  | "as_needed"
  | "weekly"
  | "twice_monthly"
  | "monthly";

export type TeamRosterMember = {
  memberId: string;
  churchId: string;
  firstName: string;
  lastName: string;
  /**
   * Contact address for notifications — **not an identity**. Never used to
   * infer which account this member is; that link is only established by an
   * accepted invite or a logged-in intake submission. Addresses are
   * legitimately shared (a parent covering two teen volunteers), so duplicates
   * are allowed and matching on them would attach people to the wrong schedule.
   * Absent on members added before addresses were collected.
   */
  email?: string;
  /** Account this member is linked to, when one has been confirmed. */
  userId?: string;
  /**
   * When an account invite bound to this member was last sent. Evidence only —
   * superseded by `userId` once accepted, and cleared on unlink.
   */
  invitedAt?: string;
  dateOfBirth?: string;
  /**
   * Privacy flag used when publishing names outside the team workspace. A
   * saved date of birth is authoritative; without one an operator may set this
   * manually.
   */
  isMinor?: boolean;
  /** Desired cadence used as a soft scheduling recommendation signal. */
  servingFrequency?: TeamMemberServingFrequency;
  /** Positions the member can be scheduled for. The hard assignment gate. */
  positionIds: string[];
  /**
   * Positions the member has expressed interest in via intake, independent of
   * eligibility. A soft signal for scheduling; admins promote these into
   * `positionIds` to grant assignability.
   */
  desiredPositionIds?: string[];
  /**
   * Per-occurrence service availability gathered from intake, keyed by
   * occurrenceId (`serviceId@startsAt`). "unavailable" is a hard scheduling
   * constraint: the member cannot be assigned to that occurrence.
   */
  serviceAvailability?: Record<string, "available" | "unavailable">;
  teamMemberships?: Record<string, TeamMemberMembership>;
  qualifications?: TeamMemberQualification[];
  blockoutDates: TeamBlockoutDateRange[];
  notes?: string;
  archivedAt?: string | null;
  /**
   * When this schedule was last sent to the people on it. Set only by the send
   * action, never by saving — building and telling people are separate acts.
   */
  sentAt?: string | null;
  /**
   * Server-owned write stamp. Sent back as `expectedUpdatedAt` on the
   * self-service blockout write so a concurrent admin edit is rejected rather
   * than silently overwritten.
   */
  updatedAt?: string;
  /** Client-only marker on a schedule display person synthesized from a guest. */
  scheduleGuest?: boolean;
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
  /**
   * Qualification area whose levels apply to this position (e.g. "Camera" ->
   * levels 1/2/3). Optional — most positions have no formal level system.
   * Used to balance skill levels across multiple slots of the same position
   * on a schedule, not as a hard eligibility gate.
   */
  qualificationAreaId?: string;
  archivedAt?: string | null;
};

export type TeamRecord = {
  teamId: string;
  churchId: string;
  name: string;
  description?: string;
  icon?: string;
  memberIds: string[];
  /** Whether scheduled role slots for this team can receive church microphones. */
  usesMicrophoneAssignments?: boolean;
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

/** A one-time helper stored with a schedule, never added to the team roster. */
export type TeamScheduleGuest = {
  guestId: string;
  name: string;
  email?: string;
  phone?: string;
  note?: string;
};

export type TeamScheduleShadowAssignment = {
  memberId: string;
  kind: TeamScheduleShadowKind;
};

export type TeamScheduleCellAssignment = {
  primaryMemberId?: string;
  shadows?: TeamScheduleShadowAssignment[];
};

/** Church microphone ids allocated to one scheduled role slot for one day. */
export type TeamScheduleMicrophoneAssignments = Record<
  string,
  Record<string, string[]>
>;

/** Additional role slots added to a specific schedule occurrence. */
export type TeamScheduleAdditionalPositionSlots = Record<string, string[]>;

export type TeamScheduleAssignments = Record<
  string,
  Record<string, TeamScheduleCellAssignment>
>;

export type TeamScheduleOccurrence = {
  occurrenceId: string;
  // representative service for back-compat lookups; for a combined occurrence this
  // is the earliest service of the group. Use `serviceIds` for the full set.
  serviceId: string;
  // set when several combined services merged into this occurrence (the shared
  // serviceGroupId); absent for a plain single-service occurrence.
  groupId?: string;
  // every service this occurrence covers (one for ungrouped, many for a group).
  serviceIds?: string[];
  name: string;
  startsAt: string;
  // optional per-date override of the service's position requirements. For a
  // combined occurrence this holds the union (max count per position) of its
  // grouped services so one set of cells covers them all.
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
  members: { memberId: string; name: string; guest?: boolean }[];
};

/**
 * A schedule without its per-cell maps. The bootstrap returns these for every
 * schedule outside the hydrated date window, so payload size stays flat as a
 * church accumulates a schedule per team per month.
 *
 * This is deliberately a *separate* type rather than `TeamSchedule` with
 * optional assignments: code that needs assignments must narrow through
 * `isHydratedSchedule` first, so a summary can never be silently read as a
 * schedule that legitimately has no one assigned.
 */
export type TeamScheduleSummary = {
  scheduleId: string;
  churchId: string;
  name: string;
  description?: string;
  teamId: string;
  startDate?: string;
  endDate?: string;
  serviceIds: string[];
  occurrences?: TeamScheduleOccurrence[];
  /** Schedule-only people available for guest assignments and recent reuse. */
  guests?: TeamScheduleGuest[];
  archivedAt?: string | null;
  /** Set by the server when the heavy per-cell maps were stripped. */
  assignmentsOmitted?: boolean;
  /**
   * Cell counts kept alongside a summary so deletion-impact warnings stay exact
   * without the full assignment map. Present only on summaries.
   */
  assignmentCounts?: {
    byMemberId: Record<string, number>;
    byPositionId: Record<string, number>;
  };
};

export type TeamSchedule = TeamScheduleSummary & {
  assignments: TeamScheduleAssignments;
  /** Accept/decline state, keyed occurrenceId -> cellKey. */
  responses?: TeamScheduleResponses;
  microphoneAssignments?: TeamScheduleMicrophoneAssignments;
  additionalPositionSlots?: TeamScheduleAdditionalPositionSlots;
};

/**
 * Narrows a schedule record to one that carries its assignment maps. Summaries
 * (from outside the bootstrap's hydration window) return false until the detail
 * endpoint has hydrated them.
 */
export const isHydratedSchedule = (
  schedule: TeamScheduleSummary | TeamSchedule | null | undefined,
): schedule is TeamSchedule =>
  Boolean(schedule) && schedule?.assignmentsOmitted !== true;

/**
 * Keeps only the schedules that carry assignments. Safe for consumers scoped to
 * services around today (credits, the live workspace, the assignments summary):
 * the bootstrap always hydrates that window. Do not use it where an exact
 * all-time total is required — see `describeDeletionImpacts`, which reads the
 * summary's `assignmentCounts` instead.
 */
export const onlyHydratedSchedules = (
  schedules: (TeamSchedule | TeamScheduleSummary)[],
): TeamSchedule[] => schedules.filter(isHydratedSchedule);

export type TeamsBootstrap = {
  success: boolean;
  members: TeamRosterMember[];
  positions: TeamPosition[];
  teams: TeamRecord[];
  teamRoles?: TeamRole[];
  qualificationAreas?: TeamQualificationArea[];
  qualificationLevels?: TeamQualificationLevel[];
  /**
   * Hydrated inside `scheduleHydrationWindow`, summaries outside it. Narrow with
   * `isHydratedSchedule` before reading assignments.
   */
  schedules: (TeamSchedule | TeamScheduleSummary)[];
  /** Present only when the client requested summary mode. */
  scheduleHydrationWindow?: { startDate: string; endDate: string };
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
  /** When true the public form rejects a submission with no email address. */
  requireEmail?: boolean;
  /**
   * Optional copy overrides shown on the public form. When blank, the public
   * form falls back to its built-in default wording.
   */
  welcomeMessage?: string;
  positionsMessage?: string;
  availabilityMessage?: string;
  notesMessage?: string;
  publicUrl?: string;
  submissionCount?: number;
  archivedAt?: string | null;
};

export type TeamIntakeSubmissionStatus = "new" | "applied" | "dismissed";

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
  /** Carried onto the member record on apply; absent on older submissions. */
  email?: string;
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
  /** True when applying created a new member rather than linking an existing one. */
  appliedMemberCreated?: boolean;
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
    | "requireEmail"
    | "availabilityServices"
    | "availabilityOccurrences"
    | "welcomeMessage"
    | "positionsMessage"
    | "availabilityMessage"
    | "notesMessage"
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

export type EmailCodeChallengeFields = {
  requiresEmailCode?: boolean;
  pendingAuthId?: string;
  verificationEmail?: string;
};

export type DesktopAuthCompleteResponse = {
  success: boolean;
  status: DesktopAuthStatus;
  pendingAuthId?: string | null;
  verificationEmail?: string | null;
  exchangeCode?: string | null;
};

export type DesktopAuthStatusResponse = {
  success: boolean;
  status: DesktopAuthStatus;
  pendingAuthId?: string | null;
  verificationEmail?: string | null;
  exchangeCode?: string | null;
  exchangeCodeExpiresAt?: string | null;
};
