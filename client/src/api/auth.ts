import {
  getApiBasePath,
  isPackagedElectronRenderer,
} from "../utils/environment";
import { getCsrfToken, getHumanApiToken } from "../utils/authStorage";
import { notifyAuthError, requestAuthRecovery } from "./authErrorBus";
import type { ChurchIntegrations } from "../types/integrations";
import type {
  AuthBootstrap,
  ChurchBranding,
  ChurchInviteRow,
  ChurchMemberRow,
  EmailCodeChallengeFields,
  MemberNotifications,
  MemberPermissions,
  NotificationPreference,
  DesktopAuthCompleteResponse,
  DesktopAuthProvider,
  DesktopAuthStartResponse,
  DesktopAuthStatusResponse,
  DisplayDeviceClient,
  PairingClient,
  RedeemDisplayPairingResponse,
  RedeemWorkstationPairingResponse,
  TeamRecord,
  TeamPosition,
  TeamQualificationArea,
  TeamQualificationLevel,
  TeamRole,
  TeamIntakeForm,
  TeamIntakePreview,
  TeamIntakeSubmission,
  TeamRosterMember,
  TeamSchedule,
  TeamScheduleAssignments,
  TeamScheduleAttendance,
  TeamScheduleAttendanceStatus,
  TeamSchedulePublicSnapshot,
  TeamScheduleShadowKind,
  TeamsBootstrap,
  TrustedHumanDeviceListItem,
  WorkstationDeviceClient,
} from "./authTypes";

export type { AuthBootstrap, ChurchStatus, SessionKind } from "./authTypes";

export class AuthApiError extends Error {
  status?: number;
  isReachabilityError: boolean;

  constructor(
    message: string,
    options: { status?: number; isReachabilityError?: boolean } = {},
  ) {
    super(message);
    this.name = "AuthApiError";
    this.status = options.status;
    this.isReachabilityError = Boolean(options.isReachabilityError);
  }
}

type JsonBody = Record<string, unknown>;
type ApiFetchConfig = {
  authRecovery?: boolean;
  notifyAuthError?: boolean;
};

const readJsonResponse = async <T>(response: Response) => {
  try {
    return (await response.json()) as T & { errorMessage?: string };
  } catch {
    throw new AuthApiError("Received an invalid server response.", {
      status: response.status,
      isReachabilityError: true,
    });
  }
};

const apiFetch = async <T>(
  path: string,
  options: RequestInit = {},
  extraHeaders?: Record<string, string>,
  config: ApiFetchConfig = {},
) => {
  const runFetch = async () => {
    try {
      const response = await fetch(`${getApiBasePath()}${path}`, {
        credentials: "include",
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...(options.headers || {}),
          ...(extraHeaders || {}),
          ...(isPackagedElectronRenderer() && getHumanApiToken()
            ? { Authorization: `Bearer ${getHumanApiToken()}` }
            : {}),
          ...((options.method || "GET").toUpperCase() !== "GET" && getCsrfToken()
            ? { "x-csrf-token": getCsrfToken() }
            : {}),
        },
      });
      return { response, data: await readJsonResponse<T>(response) };
    } catch (error) {
      if (error instanceof AuthApiError) throw error;
      throw new AuthApiError("Could not reach the server.", {
        isReachabilityError: true,
      });
    }
  };

  let { response, data } = await runFetch();

  if (
    !response.ok &&
    response.status === 401 &&
    config.authRecovery !== false
  ) {
    const recovered = await requestAuthRecovery();
    if (recovered) {
      ({ response, data } = await runFetch());
    }
  }

  if (!response.ok) {
    // A 401 means the session is gone; announce it so the app can prompt a
    // refresh no matter which action triggered the request.
    if (response.status === 401 && config.notifyAuthError !== false) {
      notifyAuthError();
    }
    throw new AuthApiError(data?.errorMessage || "Request failed", {
      status: response.status,
    });
  }

  return data;
};

const apiFetchWithoutAuthRecovery = async <T>(
  path: string,
  options: RequestInit = {},
  config: Pick<ApiFetchConfig, "notifyAuthError"> = {},
) =>
  apiFetch<T>(path, options, undefined, {
    authRecovery: false,
    ...config,
  });

export const getAuthBootstrap = async ({
  workstationToken,
  displayToken,
}: {
  workstationToken?: string;
  displayToken?: string;
}) =>
  apiFetch<AuthBootstrap>(
    "api/auth/me",
    { method: "GET" },
    {
      ...(workstationToken ? { "x-workstation-token": workstationToken } : {}),
      ...(displayToken ? { "x-display-token": displayToken } : {}),
    },
  );

export const createHumanSession = async (
  body: JsonBody,
  config: Pick<ApiFetchConfig, "notifyAuthError"> = {},
) =>
  apiFetchWithoutAuthRecovery<
    {
      success: boolean;
      bootstrap?: AuthBootstrap;
      humanApiToken?: string;
    } & EmailCodeChallengeFields
  >(
    "api/auth/session",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
    config,
  );

export const startDesktopAuth = async (body: {
  provider: DesktopAuthProvider;
  deviceId: string;
  userAgent: string;
  platform: string;
  deviceLabel?: string;
  requestedPath?: string;
}) =>
  apiFetch<DesktopAuthStartResponse>("api/auth/desktop/start", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const completeDesktopAuth = async (body: {
  desktopAuthId: string;
  idToken: string;
}) =>
  apiFetch<DesktopAuthCompleteResponse>("api/auth/desktop/complete", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const getDesktopAuthStatus = async (body: {
  desktopAuthId: string;
  desktopAuthSecret: string;
}) =>
  apiFetch<DesktopAuthStatusResponse>("api/auth/desktop/status", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const exchangeDesktopAuth = async (body: {
  desktopAuthId: string;
  desktopAuthSecret: string;
  exchangeCode: string;
}) =>
  apiFetch<{
    success: boolean;
    bootstrap: AuthBootstrap;
    humanApiToken?: string;
  }>("api/auth/desktop/exchange", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const resendEmailCode = async (body: JsonBody) =>
  apiFetch<
    {
      success: boolean;
      bootstrap?: AuthBootstrap;
      humanApiToken?: string;
    } & EmailCodeChallengeFields
  >("api/auth/resend-email-code", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const getEmailCodeHint = async (body: { pendingAuthId: string }) =>
  apiFetch<{
    success: boolean;
    verificationEmail: string;
  }>("api/auth/email-code-hint", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const verifyEmailCode = async (body: JsonBody) =>
  apiFetch<{
    success: boolean;
    bootstrap: AuthBootstrap;
    humanApiToken?: string;
  }>("api/auth/verify-email-code", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const createChurchAccount = async (body: JsonBody) =>
  apiFetch<{
    success: boolean;
    churchId: string;
    requiresEmailCode: boolean;
    pendingAuthId: string;
    verificationEmail?: string;
  }>("api/auth/churches/create", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const logoutSession = async () =>
  apiFetch<{ success: boolean }>("api/auth/logout", {
    method: "POST",
    body: JSON.stringify({}),
  });

export const forgotPassword = async (email: string) =>
  apiFetch<{ success: boolean }>("api/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  });

export const updateHumanProfile = async (body: { displayName: string }) =>
  apiFetch<{
    success: boolean;
    user: { uid: string; email: string; displayName: string };
  }>("api/auth/profile", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const updateHumanNotificationPreferences = async (body: {
  intakeSubmissions?: NotificationPreference;
}) =>
  apiFetch<{
    success: boolean;
    notifications: MemberNotifications;
  }>("api/auth/notification-preferences", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const getSharedDataToken = async ({
  workstationToken,
  displayToken,
}: {
  workstationToken?: string;
  displayToken?: string;
} = {}) =>
  apiFetch<{ success: boolean; token: string; database: string }>(
    "api/auth/shared-data-token",
    { method: "GET" },
    {
      ...(workstationToken ? { "x-workstation-token": workstationToken } : {}),
      ...(displayToken ? { "x-display-token": displayToken } : {}),
    },
  );

export const listTrustedDevices = async () =>
  apiFetch<{ success: boolean; devices: TrustedHumanDeviceListItem[] }>(
    "api/devices/human",
  );

export const revokeTrustedDevice = async (deviceId: string) =>
  apiFetch<{ success: boolean }>(`api/devices/human/${deviceId}/revoke`, {
    method: "POST",
    body: JSON.stringify({}),
  });

export const listChurchMembers = async (churchId: string) =>
  apiFetch<{ success: boolean; members: ChurchMemberRow[] }>(
    `api/churches/${churchId}/members`,
  );

export const listChurchInvites = async (churchId: string) =>
  apiFetch<{ success: boolean; invites: ChurchInviteRow[] }>(
    `api/churches/${churchId}/invites`,
  );

export const updateRecoveryEmail = async (
  churchId: string,
  recoveryEmail: string,
) =>
  apiFetch<{
    success: boolean;
    church: { churchId: string; recoveryEmail: string };
  }>(`api/churches/${churchId}/recovery-email`, {
    method: "POST",
    body: JSON.stringify({ recoveryEmail }),
  });

export const updateChurchBranding = async (
  churchId: string,
  branding: ChurchBranding,
) =>
  apiFetch<{
    success: boolean;
    branding: ChurchBranding;
  }>(`api/churches/${churchId}/branding`, {
    method: "POST",
    body: JSON.stringify(branding),
  });

export const updateChurchIntegrations = async (
  churchId: string,
  integrations: ChurchIntegrations,
) =>
  apiFetch<{
    success: boolean;
    integrations: ChurchIntegrations;
  }>(`api/churches/${churchId}/integrations`, {
    method: "POST",
    body: JSON.stringify(integrations),
  });

export type TeamRosterMemberPayload = {
  firstName: string;
  lastName: string;
  dateOfBirth?: string;
  positionIds: string[];
  desiredPositionIds?: string[];
  serviceAvailability?: TeamRosterMember["serviceAvailability"];
  teamMemberships?: TeamRosterMember["teamMemberships"];
  qualifications?: TeamRosterMember["qualifications"];
  blockoutDates: TeamRosterMember["blockoutDates"];
  notes?: string;
};

export type TeamPositionPayload = {
  name: string;
  description?: string;
  icon?: string;
  groupId?: string;
  teamId: string;
};

export type TeamPayload = {
  name: string;
  description?: string;
  icon?: string;
  memberIds: string[];
};

export type TeamRolePayload = {
  teamId: string;
  name: string;
  description?: string;
};

export type TeamQualificationAreaPayload = {
  teamId: string;
  name: string;
  description?: string;
};

export type TeamQualificationLevelPayload = {
  areaId: string;
  name: string;
  description?: string;
  rank: number;
};

export type TeamSchedulePayload = {
  name: string;
  description?: string;
  teamId: string;
  startDate?: string;
  endDate?: string;
  serviceIds: string[];
  occurrences?: TeamSchedule["occurrences"];
  assignments?: TeamScheduleAssignments;
  attendance?: TeamScheduleAttendance;
};

export type TeamIntakeFormPayload = {
  name: string;
  startDate: string;
  endDate: string;
  availabilityServices: TeamIntakeForm["availabilityServices"];
  availabilityOccurrences: TeamIntakeForm["availabilityOccurrences"];
  teamIds: string[];
  active: boolean;
  welcomeMessage?: string;
  positionsMessage?: string;
  availabilityMessage?: string;
  notesMessage?: string;
};

export type TeamIntakeSubmissionPayload = {
  firstName: string;
  lastName: string;
  positionIds: string[];
  occurrenceAvailability: TeamIntakeSubmission["occurrenceAvailability"];
  blockoutRanges: TeamIntakeSubmission["blockoutRanges"];
  notes?: string;
};

export const getTeamsBootstrap = async (churchId: string) =>
  apiFetch<TeamsBootstrap>(`api/churches/${churchId}/teams/bootstrap`);

export const createTeamIntakeForm = async (
  churchId: string,
  body: TeamIntakeFormPayload,
) =>
  apiFetch<{
    success: boolean;
    form: TeamIntakeForm;
    publicToken: string;
    publicUrl: string;
  }>(`api/churches/${churchId}/team-intake/forms`, {
    method: "POST",
    body: JSON.stringify(body),
  });

export const updateTeamIntakeForm = async (
  churchId: string,
  formId: string,
  body: Partial<TeamIntakeFormPayload>,
) =>
  apiFetch<{ success: boolean; form: TeamIntakeForm }>(
    `api/churches/${churchId}/team-intake/forms/${formId}`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );

export const getTeamIntakeFormLink = async (churchId: string, formId: string) =>
  apiFetch<{
    success: boolean;
    form: TeamIntakeForm;
    publicToken: string;
    publicUrl: string;
  }>(`api/churches/${churchId}/team-intake/forms/${formId}/link`, {
    method: "POST",
    body: JSON.stringify({}),
  });

export const applyTeamIntakeSubmission = async (
  churchId: string,
  submissionId: string,
  body: {
    action: "new" | "reviewed" | "applied" | "dismissed";
    memberId?: string;
    createMember?: boolean;
  },
) =>
  apiFetch<{
    success: boolean;
    submission: TeamIntakeSubmission;
    member?: TeamRosterMember;
    /** Teams whose rosters changed (member added), for an immediate local refresh. */
    teams?: TeamRecord[];
  }>(`api/churches/${churchId}/team-intake/submissions/${submissionId}`, {
    method: "POST",
    body: JSON.stringify(body),
  });

export const getTeamIntakePreview = async (token: string) =>
  apiFetch<TeamIntakePreview>(
    `api/team-intake/preview?token=${encodeURIComponent(token)}`,
  );

export const getTeamSchedulePublicLink = async (
  churchId: string,
  scheduleId: string,
) =>
  apiFetch<{ success: boolean; publicToken: string }>(
    `api/churches/${churchId}/team-schedules/${scheduleId}/link`,
    { method: "POST", body: JSON.stringify({}) },
  );

export const getPublicTeamSchedule = async (token: string) =>
  apiFetch<TeamSchedulePublicSnapshot>(
    `api/team-schedule/public?token=${encodeURIComponent(token)}`,
  );

export const submitTeamIntake = async (
  token: string,
  body: TeamIntakeSubmissionPayload,
) =>
  apiFetch<{ success: boolean; submissionId: string }>(
    `api/team-intake/submit?token=${encodeURIComponent(token)}`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );

export const createTeamRosterMember = async (
  churchId: string,
  body: TeamRosterMemberPayload,
) =>
  apiFetch<{ success: boolean; member: TeamRosterMember }>(
    `api/churches/${churchId}/team-roster-members`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );

export const updateTeamRosterMember = async (
  churchId: string,
  memberId: string,
  body: TeamRosterMemberPayload,
) =>
  apiFetch<{ success: boolean; member: TeamRosterMember }>(
    `api/churches/${churchId}/team-roster-members/${memberId}`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );

export const archiveTeamRosterMember = async (
  churchId: string,
  memberId: string,
) =>
  apiFetch<{ success: boolean }>(
    `api/churches/${churchId}/team-roster-members/${memberId}/archive`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );

export const deleteTeamRosterMember = async (
  churchId: string,
  memberId: string,
) =>
  apiFetch<{ success: boolean }>(
    `api/churches/${churchId}/team-roster-members/${memberId}/delete`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );

export const createTeamPosition = async (
  churchId: string,
  body: TeamPositionPayload,
) =>
  apiFetch<{ success: boolean; position: TeamPosition }>(
    `api/churches/${churchId}/team-positions`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );

export const updateTeamPosition = async (
  churchId: string,
  positionId: string,
  body: TeamPositionPayload,
) =>
  apiFetch<{ success: boolean; position: TeamPosition }>(
    `api/churches/${churchId}/team-positions/${positionId}`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );

export const reorderTeamPositions = async (
  churchId: string,
  body: { teamId: string; positionIds: string[] },
) =>
  apiFetch<{ success: boolean; positions: TeamPosition[] }>(
    `api/churches/${churchId}/team-positions/reorder`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );

export const archiveTeamPosition = async (
  churchId: string,
  positionId: string,
) =>
  apiFetch<{ success: boolean }>(
    `api/churches/${churchId}/team-positions/${positionId}/archive`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );

export const deleteTeamPosition = async (
  churchId: string,
  positionId: string,
) =>
  apiFetch<{ success: boolean }>(
    `api/churches/${churchId}/team-positions/${positionId}/delete`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );

export const createTeamRole = async (churchId: string, body: TeamRolePayload) =>
  apiFetch<{ success: boolean; role: TeamRole }>(
    `api/churches/${churchId}/team-roles`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );

export const updateTeamRole = async (
  churchId: string,
  roleId: string,
  body: TeamRolePayload,
) =>
  apiFetch<{ success: boolean; role: TeamRole }>(
    `api/churches/${churchId}/team-roles/${roleId}`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );

export const archiveTeamRole = async (churchId: string, roleId: string) =>
  apiFetch<{ success: boolean }>(
    `api/churches/${churchId}/team-roles/${roleId}/archive`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );

export const deleteTeamRole = async (churchId: string, roleId: string) =>
  apiFetch<{ success: boolean }>(
    `api/churches/${churchId}/team-roles/${roleId}/delete`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );

export const createTeamQualificationArea = async (
  churchId: string,
  body: TeamQualificationAreaPayload,
) =>
  apiFetch<{ success: boolean; area: TeamQualificationArea }>(
    `api/churches/${churchId}/team-qualification-areas`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );

export const updateTeamQualificationArea = async (
  churchId: string,
  areaId: string,
  body: TeamQualificationAreaPayload,
) =>
  apiFetch<{ success: boolean; area: TeamQualificationArea }>(
    `api/churches/${churchId}/team-qualification-areas/${areaId}`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );

export const archiveTeamQualificationArea = async (
  churchId: string,
  areaId: string,
) =>
  apiFetch<{ success: boolean }>(
    `api/churches/${churchId}/team-qualification-areas/${areaId}/archive`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );

export const deleteTeamQualificationArea = async (
  churchId: string,
  areaId: string,
) =>
  apiFetch<{ success: boolean }>(
    `api/churches/${churchId}/team-qualification-areas/${areaId}/delete`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );

export const createTeamQualificationLevel = async (
  churchId: string,
  body: TeamQualificationLevelPayload,
) =>
  apiFetch<{ success: boolean; level: TeamQualificationLevel }>(
    `api/churches/${churchId}/team-qualification-levels`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );

export const updateTeamQualificationLevel = async (
  churchId: string,
  levelId: string,
  body: TeamQualificationLevelPayload,
) =>
  apiFetch<{ success: boolean; level: TeamQualificationLevel }>(
    `api/churches/${churchId}/team-qualification-levels/${levelId}`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );

export const archiveTeamQualificationLevel = async (
  churchId: string,
  levelId: string,
) =>
  apiFetch<{ success: boolean }>(
    `api/churches/${churchId}/team-qualification-levels/${levelId}/archive`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );

export const deleteTeamQualificationLevel = async (
  churchId: string,
  levelId: string,
) =>
  apiFetch<{ success: boolean }>(
    `api/churches/${churchId}/team-qualification-levels/${levelId}/delete`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );

export const createTeam = async (churchId: string, body: TeamPayload) =>
  apiFetch<{ success: boolean; team: TeamRecord }>(
    `api/churches/${churchId}/teams`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );

export const updateTeam = async (
  churchId: string,
  teamId: string,
  body: TeamPayload,
) =>
  apiFetch<{ success: boolean; team: TeamRecord }>(
    `api/churches/${churchId}/teams/${teamId}`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );

export const archiveTeam = async (churchId: string, teamId: string) =>
  apiFetch<{ success: boolean }>(
    `api/churches/${churchId}/teams/${teamId}/archive`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );

export const deleteTeam = async (churchId: string, teamId: string) =>
  apiFetch<{ success: boolean }>(
    `api/churches/${churchId}/teams/${teamId}/delete`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );

export const createTeamSchedule = async (
  churchId: string,
  body: TeamSchedulePayload,
) =>
  apiFetch<{ success: boolean; schedule: TeamSchedule }>(
    `api/churches/${churchId}/team-schedules`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );

export const updateTeamSchedule = async (
  churchId: string,
  scheduleId: string,
  body: TeamSchedulePayload,
) =>
  apiFetch<{ success: boolean; schedule: TeamSchedule }>(
    `api/churches/${churchId}/team-schedules/${scheduleId}`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );

export const archiveTeamSchedule = async (
  churchId: string,
  scheduleId: string,
) =>
  apiFetch<{ success: boolean }>(
    `api/churches/${churchId}/team-schedules/${scheduleId}/archive`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );

export const deleteTeamSchedule = async (
  churchId: string,
  scheduleId: string,
) =>
  apiFetch<{ success: boolean }>(
    `api/churches/${churchId}/team-schedules/${scheduleId}/delete`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );

export const updateTeamScheduleAssignment = async (
  churchId: string,
  scheduleId: string,
  body: {
    serviceId: string;
    positionSlotKey: string;
    memberId: string | null;
    serviceDate?: string;
    sourceServiceId?: string;
    sourcePositionSlotKey?: string;
    shadowAction?: "add" | "remove";
    shadowKind?: TeamScheduleShadowKind;
  },
) =>
  apiFetch<{ success: boolean; schedule: TeamSchedule }>(
    `api/churches/${churchId}/team-schedules/${scheduleId}/assignments`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );

export const updateTeamScheduleAttendance = async (
  churchId: string,
  scheduleId: string,
  body: {
    occurrenceId: string;
    memberId: string;
    status: TeamScheduleAttendanceStatus | "";
    columnKey?: string;
    positionId?: string;
    positionLabel?: string;
  },
) =>
  apiFetch<{ success: boolean; schedule: TeamSchedule }>(
    `api/churches/${churchId}/team-schedules/${scheduleId}/attendance`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );

export const createAdminInvite = async (churchId: string, body: JsonBody) =>
  apiFetch<{ success: boolean; invite: ChurchInviteRow }>(
    `api/churches/${churchId}/invites`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );

export const updateChurchInviteAccess = async (
  churchId: string,
  inviteId: string,
  body: JsonBody,
) =>
  apiFetch<{ success: boolean; invite: ChurchInviteRow }>(
    `api/churches/${churchId}/invites/${encodeURIComponent(inviteId)}/access`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );

export const revokeChurchInvite = async (churchId: string, inviteId: string) =>
  apiFetch<{ success: boolean }>(
    `api/churches/${churchId}/invites/${encodeURIComponent(inviteId)}/revoke`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );

export const fetchInvitePreview = async (token: string) =>
  apiFetch<{ success: boolean; churchName?: string }>(
    `api/invites/preview?${new URLSearchParams({ token }).toString()}`,
    { method: "GET" },
  );

export const acceptInvite = async (body: JsonBody) =>
  apiFetch<{ success: boolean; email?: string; churchId?: string }>(
    "api/invites/accept",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );

export const removeAdmin = async (churchId: string, userId: string) =>
  apiFetch<{ success: boolean }>(
    `api/churches/${churchId}/members/${userId}/remove-admin`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );

export const removeChurchMember = async (churchId: string, userId: string) =>
  apiFetch<{ success: boolean }>(
    `api/churches/${churchId}/members/${userId}/remove`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );

export const updateChurchMemberAccess = async (
  churchId: string,
  userId: string,
  appAccess: "full" | "music" | "view",
  permissions: MemberPermissions,
) =>
  apiFetch<{ success: boolean }>(
    `api/churches/${churchId}/members/${userId}/access`,
    {
      method: "POST",
      body: JSON.stringify({ appAccess, permissions }),
    },
  );

export const requestAdminAccess = async (churchId: string) =>
  apiFetch<{ success: boolean }>(
    `api/churches/${churchId}/request-admin-access`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );

export const createWorkstationPairing = async (
  churchId: string,
  body: JsonBody,
) =>
  apiFetch<{ success: boolean; pairing: PairingClient }>(
    `api/churches/${churchId}/workstation-pairings`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );

export const redeemWorkstationPairing = async (body: JsonBody) =>
  apiFetch<RedeemWorkstationPairingResponse>(
    "api/workstation-pairings/redeem",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );

export const listWorkstations = async (churchId: string) =>
  apiFetch<{ success: boolean; workstations: WorkstationDeviceClient[] }>(
    `api/churches/${churchId}/workstations`,
  );

export const revokeWorkstation = async (churchId: string, deviceId: string) =>
  apiFetch<{ success: boolean }>(
    `api/churches/${churchId}/workstations/${deviceId}/revoke`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );

export const updateWorkstationOperator = async (
  deviceId: string,
  operatorName: string,
  workstationToken?: string,
) =>
  apiFetch<{ success: boolean; workstation: WorkstationDeviceClient }>(
    `api/workstations/${deviceId}/operator`,
    {
      method: "POST",
      body: JSON.stringify({ operatorName }),
    },
    {
      ...(workstationToken ? { "x-workstation-token": workstationToken } : {}),
    },
  );

export const unlinkWorkstation = async (
  deviceId: string,
  workstationToken?: string,
) =>
  apiFetch<{ success: boolean }>(
    `api/workstations/${deviceId}/unlink`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
    {
      ...(workstationToken ? { "x-workstation-token": workstationToken } : {}),
    },
  );

export const createDisplayPairing = async (churchId: string, body: JsonBody) =>
  apiFetch<{ success: boolean; pairing: PairingClient }>(
    `api/churches/${churchId}/display-pairings`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );

export const sendPairingCodeEmail = async (
  churchId: string,
  body: { kind: "workstation" | "display"; token: string; to: string },
) =>
  apiFetch<{ success: boolean }>(
    `api/churches/${churchId}/pairing-code-email`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );

export const redeemDisplayPairing = async (body: JsonBody) =>
  apiFetch<RedeemDisplayPairingResponse>("api/display-pairings/redeem", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const listDisplayDevices = async (churchId: string) =>
  apiFetch<{ success: boolean; displayDevices: DisplayDeviceClient[] }>(
    `api/churches/${churchId}/display-devices`,
  );

export const revokeDisplayDevice = async (churchId: string, deviceId: string) =>
  apiFetch<{ success: boolean }>(
    `api/churches/${churchId}/display-devices/${deviceId}/revoke`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );

export const confirmRecoveryRequest = async (token: string) =>
  apiFetch<{ success: boolean; churchId?: string }>("api/recovery/confirm", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
