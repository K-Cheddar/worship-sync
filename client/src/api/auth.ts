import {
  getApiBasePath,
  isPackagedElectronRenderer,
} from "../utils/environment";
import {
  getCsrfToken,
  getHumanApiToken,
  getWorkstationToken,
  getDisplayToken,
} from "../utils/authStorage";
import { notifyAuthError, requestAuthRecovery } from "./authErrorBus";
import { logAuthDiagnostic } from "../utils/authDiagnostics";
import type { ChurchIntegrations } from "../types/integrations";
import type {
  ServicePlan,
  ServicePlanPayload,
  ServicePlanSummary,
  ServicePlanTemplate,
  ServicePlanTemplatePayload,
  ServicePlanMicrophone,
  ServicePlanMicrophoneAudience,
} from "../types/servicePlan";
import type {
  AuthBootstrap,
  ChurchBranding,
  ChurchInviteRow,
  ChurchMemberRow,
  EmailCodeChallengeFields,
  MemberNotifications,
  MemberPermissions,
  NotificationCategory,
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
  TeamScheduleGuest,
  TeamSchedulePublicSnapshot,
  TeamScheduleShadowKind,
  TeamsBootstrap,
  TrustedHumanDeviceListItem,
  WorkstationDeviceClient,
} from "./authTypes";
import type { SongAudio } from "../types";

export type RichLinkPreview = {
  provider: "youtube" | "spotify";
  kind:
    | "video"
    | "track"
    | "album"
    | "artist"
    | "playlist"
    | "show"
    | "episode"
    | "audiobook"
    | "unknown";
  resourceId: string;
  title: string;
  creator?: string;
  thumbnailUrl?: string;
  thumbnailWidth?: number;
  thumbnailHeight?: number;
  canonicalUrl: string;
  embedUrl: string;
  embedWidth?: number;
  embedHeight?: number;
  supportsSegments: boolean;
};

export type { AuthBootstrap, ChurchStatus, SessionKind } from "./authTypes";

export class AuthApiError extends Error {
  status?: number;
  isReachabilityError: boolean;
  details?: unknown;

  constructor(
    message: string,
    options: {
      status?: number;
      isReachabilityError?: boolean;
      details?: unknown;
    } = {},
  ) {
    super(message);
    this.name = "AuthApiError";
    this.status = options.status;
    this.isReachabilityError = Boolean(options.isReachabilityError);
    this.details = options.details;
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
      const workstationToken = getWorkstationToken();
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
          ...(workstationToken
            ? { "x-workstation-token": workstationToken }
            : {}),
          ...((options.method || "GET").toUpperCase() !== "GET" &&
          getCsrfToken()
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

  let recoveryAttempted = false;
  let recoverySucceeded = false;

  if (
    !response.ok &&
    response.status === 401 &&
    config.authRecovery !== false
  ) {
    recoveryAttempted = true;
    recoverySucceeded = await requestAuthRecovery();
    if (recoverySucceeded) {
      ({ response, data } = await runFetch());
    }
  }

  if (!response.ok) {
    // A 401 means the session is gone; announce it so the app can prompt a
    // refresh no matter which action triggered the request.
    if (response.status === 401 && config.notifyAuthError !== false) {
      logAuthDiagnostic("error", "auth_api_unauthorized", {
        path,
        recoveryAttempted,
        recoverySucceeded,
        responseMessage: data?.errorMessage || "",
        hasWorkstationToken: Boolean(getWorkstationToken()),
        hasDisplayToken: Boolean(getDisplayToken()),
        hasHumanApiToken: Boolean(getHumanApiToken()),
      });
      notifyAuthError();
    }
    throw new AuthApiError(data?.errorMessage || "Request failed", {
      status: response.status,
      details: data,
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

type SongAudioUploadIntent = {
  audio: Pick<
    SongAudio,
    "id" | "key" | "fileName" | "contentType" | "sizeBytes"
  >;
  uploadUrl: string;
  expiresAt: string;
};

const songAudioPath = (churchId: string, songId: string) =>
  `api/churches/${encodeURIComponent(churchId)}/song-audio/${encodeURIComponent(songId)}`;

export const getRichLinkPreview = async (url: string) => {
  const result = await apiFetch<{ preview: RichLinkPreview }>(
    `api/link-previews?${new URLSearchParams({ url }).toString()}`,
  );
  return result.preview;
};

const uploadSongAudioFromPackagedElectron = async ({
  churchId,
  songId,
  file,
  contentType,
  previousAudio,
}: {
  churchId: string;
  songId: string;
  file: File;
  contentType: string;
  previousAudio?: SongAudio;
}): Promise<SongAudio> => {
  let response: Response;
  try {
    response = await fetch(
      `${getApiBasePath()}${songAudioPath(churchId, songId)}/upload-from-app?${new URLSearchParams({ fileName: file.name }).toString()}`,
      {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": contentType,
          ...(getHumanApiToken()
            ? { Authorization: `Bearer ${getHumanApiToken()}` }
            : {}),
          ...(getCsrfToken() ? { "x-csrf-token": getCsrfToken() } : {}),
          ...(previousAudio
            ? {
                "x-song-audio-id": previousAudio.id,
                "x-song-audio-key": previousAudio.key,
              }
            : {}),
        },
        body: file,
      },
    );
  } catch {
    throw new AuthApiError(
      "Could not upload the MP3. Check the connection and try again.",
      {
        isReachabilityError: true,
      },
    );
  }

  const data = (await response.json().catch(() => ({}))) as {
    audio?: SongAudio;
    error?: string;
  };
  if (!response.ok || !data.audio) {
    throw new AuthApiError(
      data.error || "The MP3 upload was not accepted. Try again.",
      {
        status: response.status,
      },
    );
  }
  return data.audio;
};

/** Uploads directly to private R2 storage, then verifies it through the API. */
export const uploadSongAudio = async ({
  churchId,
  songId,
  file,
  previousAudio,
}: {
  churchId: string;
  songId: string;
  file: File;
  previousAudio?: SongAudio;
}): Promise<SongAudio> => {
  const contentType = file.type || "audio/mpeg";
  if (isPackagedElectronRenderer()) {
    return uploadSongAudioFromPackagedElectron({
      churchId,
      songId,
      file,
      contentType,
      previousAudio,
    });
  }
  const intent = await apiFetch<SongAudioUploadIntent>(
    `${songAudioPath(churchId, songId)}/upload`,
    {
      method: "POST",
      body: JSON.stringify({
        fileName: file.name,
        contentType,
        sizeBytes: file.size,
      }),
    },
  );

  let uploadResponse: Response;
  try {
    uploadResponse = await fetch(intent.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": intent.audio.contentType },
      body: file,
    });
  } catch {
    throw new AuthApiError(
      "Could not upload the MP3. Check the connection and try again.",
      {
        isReachabilityError: true,
      },
    );
  }

  if (!uploadResponse.ok) {
    throw new AuthApiError("The MP3 upload was not accepted. Try again.", {
      status: uploadResponse.status,
    });
  }

  const completed = await apiFetch<{ audio: SongAudio }>(
    `${songAudioPath(churchId, songId)}/complete`,
    {
      method: "POST",
      body: JSON.stringify({ audio: intent.audio, previousAudio }),
    },
  );
  return completed.audio;
};

export const getSongAudioUrl = async ({
  churchId,
  songId,
  audio,
  disposition,
}: {
  churchId: string;
  songId: string;
  audio: SongAudio;
  disposition: "inline" | "attachment";
}) => {
  const query = new URLSearchParams({
    key: audio.key,
    fileName: audio.fileName,
    disposition,
  });
  return apiFetch<{ url: string; expiresAt: string }>(
    `${songAudioPath(churchId, songId)}/${encodeURIComponent(audio.id)}/url?${query.toString()}`,
  );
};

export const deleteSongAudio = async ({
  churchId,
  songId,
  audio,
}: {
  churchId: string;
  songId: string;
  audio: SongAudio;
}) =>
  apiFetch<{ success: true }>(
    `${songAudioPath(churchId, songId)}/${encodeURIComponent(audio.id)}`,
    {
      method: "DELETE",
      body: JSON.stringify({ key: audio.key }),
    },
  );

export const deleteSongAudioWithRetry = async (
  args: Parameters<typeof deleteSongAudio>[0],
) => {
  try {
    return await deleteSongAudio(args);
  } catch (error) {
    if (error instanceof AuthApiError && error.status === 404) {
      return { success: true as const };
    }
    const canRetry =
      !(error instanceof AuthApiError) ||
      error.isReachabilityError ||
      !error.status ||
      error.status === 429 ||
      error.status >= 500;
    if (!canRetry) throw error;
    return deleteSongAudio(args);
  }
};

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

/**
 * Saves a subset of notification categories. The server preserves the ones not
 * sent, so a client that does not know about a newer category cannot reset it.
 */
export const updateHumanNotificationPreferences = async (
  body: Partial<Record<NotificationCategory, NotificationPreference>>,
) =>
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
  title?: string;
  firstName: string;
  lastName: string;
  /** Omit to leave an existing address untouched; send "" to clear it. */
  email?: string;
  dateOfBirth?: string;
  isMinor?: boolean;
  servingFrequency?: TeamRosterMember["servingFrequency"];
  recurringAvailability?: TeamRosterMember["recurringAvailability"];
  positionIds: string[];
  desiredPositionIds?: string[];
  /**
   * Rosters this member should belong to. Membership is stored on
   * `team.memberIds`, so this is a desired-state instruction, not a member
   * field — the server reconciles both directions and unions in the teams that
   * own `positionIds`. Omit it entirely to leave membership alone.
   */
  teamIds?: string[];
  serviceAvailability?: TeamRosterMember["serviceAvailability"];
  teamMemberships?: TeamRosterMember["teamMemberships"];
  qualifications?: TeamRosterMember["qualifications"];
  blockoutDates: TeamRosterMember["blockoutDates"];
  notes?: string;
  profileImageUrl?: string;
  profileImagePublicId?: string;
};

export type TeamPositionPayload = {
  name: string;
  description?: string;
  icon?: string;
  groupId?: string;
  qualificationAreaId?: string;
  teamId: string;
};

export type TeamPayload = {
  name: string;
  description?: string;
  icon?: string;
  memberIds: string[];
  usesMicrophoneAssignments?: boolean;
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
  guests?: TeamScheduleGuest[];
  microphoneAssignments?: TeamSchedule["microphoneAssignments"];
  additionalPositionSlots?: TeamSchedule["additionalPositionSlots"];
  allowCrossTeamConflict?: boolean;
};

export type TeamIntakeFormPayload = {
  name: string;
  startDate: string;
  endDate: string;
  availabilityServices: TeamIntakeForm["availabilityServices"];
  availabilityOccurrences: TeamIntakeForm["availabilityOccurrences"];
  teamIds: string[];
  active: boolean;
  requireEmail?: boolean;
  welcomeMessage?: string;
  positionsMessage?: string;
  availabilityMessage?: string;
  notesMessage?: string;
};

export type TeamIntakeSubmissionPayload = {
  firstName: string;
  lastName: string;
  /** Optional server-side; forms may opt into requiring it. */
  email?: string;
  positionIds: string[];
  occurrenceAvailability: TeamIntakeSubmission["occurrenceAvailability"];
  blockoutRanges: TeamIntakeSubmission["blockoutRanges"];
  notes?: string;
};

/**
 * Loads the Teams dataset. Requests schedule summaries (plus a hydrated window
 * around today) so the payload does not grow with every month of history; the
 * schedule the operator opens is hydrated on demand via
 * `getTeamScheduleDetail`.
 */
export const getTeamsBootstrap = async (churchId: string) =>
  apiFetch<TeamsBootstrap>(
    `api/churches/${churchId}/teams/bootstrap?schedules=summary`,
  );

/**
 * Hydrates one schedule plus the other teams' schedules overlapping its dates —
 * the latter back the "also scheduled on <team>" warning in the grid.
 */
export const getTeamScheduleDetail = async (
  churchId: string,
  scheduleId: string,
) =>
  apiFetch<{
    success: boolean;
    schedule: TeamSchedule;
    relatedSchedules: TeamSchedule[];
  }>(`api/churches/${churchId}/team-schedules/${scheduleId}`);

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

/**
 * Saving positions also joins the member to those positions' teams on the
 * server, so both member endpoints hand back the rosters they changed for an
 * immediate local refresh (same contract as `applyTeamIntakeSubmission`).
 */
type TeamRosterMemberSaveResponse = {
  success: boolean;
  member: TeamRosterMember;
  /** Teams whose rosters changed (member added). Absent when none did. */
  teams?: TeamRecord[];
};

export const createTeamRosterMember = async (
  churchId: string,
  body: TeamRosterMemberPayload,
) =>
  apiFetch<TeamRosterMemberSaveResponse>(
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
  apiFetch<TeamRosterMemberSaveResponse>(
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

export type MyScheduleServing = {
  /** Set only for this person's own rows; others are name-only by design. */
  memberId: string;
  /** Their own full name; everyone else uses the public first-name convention. */
  name: string;
  isMe: boolean;
  scheduleId: string;
  teamId: string;
  teamName: string;
  positionId: string;
  positionName: string;
  columnKey: string;
  /** False when shadowing the slot rather than holding it. */
  isPrimary: boolean;
  /**
   * Present only on this person's own primary rows. A teammate's answer is the
   * owner's business, not a co-volunteer's, so it is never sent here.
   */
  response?: "pending" | "accepted" | "declined";
  respondedAt?: string;
};

export type MySchedulePlanElement = {
  type: string;
  title: string;
  startTime: string;
  durationSeconds?: number;
};

export type MySchedulePlan = {
  planId: string;
  name: string;
  /** True when share links have been enabled for this plan. */
  published?: boolean;
  /** Present only when published — team (detailed) and optional general (simple). */
  publicUrls?: {
    team: string;
    general?: string;
  };
  sections: { name: string; elements: MySchedulePlanElement[] }[];
};

export type MyScheduleOccurrence = {
  occurrenceId: string;
  /**
   * Service name, or "A & B" when services are combined. Empty when older
   * schedules never stored one.
   */
  name: string;
  /** Every service this occurrence covers; more than one when combined. */
  serviceIds: string[];
  /** Calendar date (YYYY-MM-DD) — how plans are keyed. */
  date: string;
  /** ISO start of the service; "" when the id carries no timestamp. */
  startsAt: string;
  /** Everyone on this service, this person included and flagged `isMe`. */
  serving: MyScheduleServing[];
  /**
   * Order of service for this date, or null when no plan exists yet.
   * Not gated on the plan being "published" — that flag is a side effect of
   * minting share links, and this reader is signed in and assigned to the
   * service rather than an anonymous link holder. Public URLs are included
   * only when the plan is already published.
   */
  plan: MySchedulePlan | null;
};

/**
 * The signed-in person's services: when they serve, in what capacity, who else
 * is on with them, and what is planned.
 *
 * Self-scoped server-side — only occurrences this person is assigned to are
 * returned — so it needs church membership and no teams permission. Co-serving
 * names use the same convention as the public schedule link.
 *
 * `member` is null when this account has claimed no roster record.
 */
export const getMyTeamAssignments = async (churchId: string) =>
  apiFetch<{
    success: boolean;
    member: TeamRosterMember | null;
    occurrences: MyScheduleOccurrence[];
  }>(`api/churches/${churchId}/my-team-assignments`);

/**
 * Answer an assignment from an emailed link, with no session.
 *
 * Public by design: volunteers routinely have no account. Authority is the
 * signed token, which covers exactly one slot. The answer is chosen here rather
 * than baked into the link, so a forwarded URL cannot answer for someone.
 */
export type AssignmentResponseSlot = {
  occurrenceId: string;
  cellKey: string;
  serviceName: string;
  startsAt: string;
  positionName: string;
  response: "pending" | "accepted" | "declined";
  respondedAt?: string;
};

/**
 * What an emailed link is asking about: this person's slots on one schedule,
 * with service names and dates. Without it the page can only say "Can you
 * serve?" and name nothing.
 */
export const getAssignmentResponseContext = async (token: string) =>
  apiFetch<{
    success: boolean;
    churchName: string;
    firstName: string;
    assignments: AssignmentResponseSlot[];
  }>(
    `api/team-schedule-response?${new URLSearchParams({ token }).toString()}`,
  );

/**
 * Answer from an emailed link. Omit `occurrenceId`/`cellKey` to answer every
 * slot the link covers — answering four services should not need four links.
 */
export const respondToAssignmentByToken = async (body: {
  token: string;
  response: "accepted" | "declined";
  occurrenceId?: string;
  cellKey?: string;
}) =>
  apiFetch<{
    success: boolean;
    response: "accepted" | "declined";
    applied: number;
    assignments: AssignmentResponseSlot[];
  }>("api/team-schedule-response", {
    method: "POST",
    body: JSON.stringify(body),
  });

/**
 * Ask for an account from the emailed response page.
 *
 * Takes nothing but the token. The invite is addressed to the email already on
 * the roster record — deliberately not something this call can influence, or a
 * public endpoint would become a way to send WorshipSync-branded mail anywhere.
 * The address comes back only so the page can say which inbox to check.
 */
export const requestAccountFromAssignmentToken = async (token: string) =>
  apiFetch<{ success: boolean; email: string }>(
    "api/team-schedule-response/invite",
    {
      method: "POST",
      body: JSON.stringify({ token }),
    },
  );

/**
 * Sends a schedule to everyone on it.
 *
 * Separate from saving on purpose: an owner shuffles a grid for a while, and
 * mailing on every save would train volunteers to ignore the emails. Idempotent
 * per person per service, so pressing send again only mails newly added slots.
 */
export const sendTeamSchedule = async (churchId: string, scheduleId: string) =>
  apiFetch<{
    success: boolean;
    sentAt: string;
    notified: number;
    alreadyNotified: number;
    /** Members with no address and no linked account — nobody told them. */
    unreachableMemberIds: string[];
  }>(`api/churches/${churchId}/team-schedules/${scheduleId}/send`, {
    method: "POST",
    body: JSON.stringify({}),
  });

/**
 * Accept or decline one of the signed-in person's own assignments.
 *
 * Self-scoped server-side: the slot must be held by the member linked to this
 * account, so this cannot answer for anyone else. Writes only the response —
 * declining never removes them from the schedule, because who covers the slot
 * is the owner's call.
 *
 * Returns 409 when the slot moved to someone else between loading the page and
 * answering; refetch rather than retrying.
 */
export const respondToMyAssignment = async (
  churchId: string,
  body: {
    scheduleId: string;
    occurrenceId: string;
    cellKey: string;
    response: "accepted" | "declined";
  },
) =>
  apiFetch<{ success: boolean; response: "accepted" | "declined" }>(
    `api/churches/${churchId}/my-assignments/respond`,
    { method: "POST", body: JSON.stringify(body) },
  );

/**
 * Replaces the signed-in person's own blockout dates.
 *
 * Self-scoped server-side — the record written is the one linked to this
 * account — so a schedule-only volunteer can keep their availability current
 * without any teams permission. Only `blockoutDates` is written; nothing else
 * on the member record is touched.
 *
 * Dates they are already scheduled for are accepted. The conflict is surfaced
 * to the volunteer here and to owners in the schedule grid, rather than being
 * refused.
 *
 * `expectedUpdatedAt` is the `updatedAt` of the member record this edit started
 * from, and is required: the write replaces the whole array, so without it an
 * admin's concurrent edit is silently discarded. A mismatch returns 409.
 */
export const updateMyBlockoutDates = async (
  churchId: string,
  blockoutDates: TeamRosterMember["blockoutDates"],
  expectedUpdatedAt: string,
) =>
  apiFetch<{ success: boolean; member: TeamRosterMember }>(
    `api/churches/${churchId}/my-blockout-dates`,
    {
      method: "POST",
      body: JSON.stringify({ blockoutDates, expectedUpdatedAt }),
    },
  );

/**
 * Links a member record to an account.
 *
 * Omit `userId` to claim the record for the signed-in account. Pass one to link
 * someone else — the server requires that account to hold an active membership
 * in this church.
 *
 * Links are never inferred from a matching email; addresses are shared between
 * people. This is also the path for anyone who already belongs to the church,
 * since the invite flow rejects an existing member.
 */
export const linkTeamRosterMember = async (
  churchId: string,
  memberId: string,
  userId?: string,
) =>
  apiFetch<{ success: boolean }>(
    `api/churches/${churchId}/team-roster-members/${memberId}/link`,
    {
      method: "POST",
      body: JSON.stringify(userId ? { userId } : {}),
    },
  );

export const unlinkTeamRosterMember = async (
  churchId: string,
  memberId: string,
) =>
  apiFetch<{ success: boolean }>(
    `api/churches/${churchId}/team-roster-members/${memberId}/unlink`,
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
    guest?: Omit<TeamScheduleGuest, "guestId"> & { guestId?: string };
    serviceDate?: string;
    sourceServiceId?: string;
    sourcePositionSlotKey?: string;
    shadowAction?: "add" | "remove";
    shadowKind?: TeamScheduleShadowKind;
    /** Explicit acknowledgement that the member's blockout overlaps this service. */
    allowBlockout?: boolean;
    /** Explicit acknowledgement that recurring availability excludes this service. */
    allowRecurringAvailability?: boolean;
    allowCrossTeamConflict?: boolean;
  },
) =>
  apiFetch<{ success: boolean; schedule: TeamSchedule }>(
    `api/churches/${churchId}/team-schedules/${scheduleId}/assignments`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );

export const updateTeamScheduleAssignmentMicrophones = async (
  churchId: string,
  scheduleId: string,
  body: {
    serviceId: string;
    positionSlotKey: string;
    microphoneIds: string[];
  },
) =>
  apiFetch<{ success: boolean; schedule: TeamSchedule }>(
    `api/churches/${churchId}/team-schedules/${scheduleId}/assignment-microphones`,
    { method: "POST", body: JSON.stringify(body) },
  );

export const addTeamSchedulePositionSlot = async (
  churchId: string,
  scheduleId: string,
  body: { serviceId: string; positionSlotKey: string },
) =>
  apiFetch<{ success: boolean; schedule: TeamSchedule }>(
    `api/churches/${churchId}/team-schedules/${scheduleId}/additional-position-slots`,
    { method: "POST", body: JSON.stringify(body) },
  );

export const removeTeamSchedulePositionSlot = async (
  churchId: string,
  scheduleId: string,
  body: { serviceId: string; positionSlotKey: string },
) =>
  apiFetch<{ success: boolean; schedule: TeamSchedule }>(
    `api/churches/${churchId}/team-schedules/${scheduleId}/additional-position-slots/remove`,
    { method: "POST", body: JSON.stringify(body) },
  );

export const updateTeamScheduleAssignmentSwap = async (
  churchId: string,
  scheduleId: string,
  body: {
    serviceId: string;
    targetPositionSlotKey: string;
    sourcePositionSlotKey: string;
    currentMemberId: string;
    candidateMemberId: string;
    serviceDate?: string;
    allowCrossTeamConflict?: boolean;
  },
) =>
  apiFetch<{ success: boolean; schedule: TeamSchedule }>(
    `api/churches/${churchId}/team-schedules/${scheduleId}/assignment-swaps`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );

export const listServicePlans = async (churchId: string) =>
  apiFetch<{ success: boolean; servicePlans: ServicePlanSummary[] }>(
    `api/churches/${churchId}/service-plans`,
    { method: "GET" },
  );

/** Share links come back for an already-published plan so reopening the editor
 * restores them without needing to publish again. */
export type ServicePlanPublicUrls = {
  team: string;
  general?: string;
  currentTeam?: string;
  currentGeneral?: string;
};

export const getServicePlan = async (churchId: string, planKey: string) =>
  apiFetch<{
    success: boolean;
    servicePlan: ServicePlan | null;
    publicUrls?: ServicePlanPublicUrls;
  }>(`api/churches/${churchId}/service-plans/${encodeURIComponent(planKey)}`, {
    method: "GET",
  });

export const saveServicePlan = async (
  churchId: string,
  planKey: string,
  body: ServicePlanPayload,
) =>
  apiFetch<{ success: boolean; servicePlan: ServicePlan }>(
    `api/churches/${churchId}/service-plans/${encodeURIComponent(planKey)}`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );

export const publishServicePlan = async (churchId: string, planKey: string) =>
  apiFetch<{
    success: boolean;
    servicePlan: ServicePlan;
    /** Legacy alias for the serving/team link. */
    publicUrl: string;
    teamPublicUrl?: string;
    generalPublicUrl?: string;
    currentTeamPublicUrl?: string;
    currentGeneralPublicUrl?: string;
  }>(
    `api/churches/${churchId}/service-plans/${encodeURIComponent(planKey)}/publish`,
    { method: "POST", body: JSON.stringify({}) },
  );

export const unpublishServicePlan = async (churchId: string, planKey: string) =>
  apiFetch<{ success: boolean; servicePlan: ServicePlan }>(
    `api/churches/${churchId}/service-plans/${encodeURIComponent(planKey)}/unpublish`,
    { method: "POST", body: JSON.stringify({}) },
  );

export const updateServicePlanPublicLive = async (
  churchId: string,
  planKey: string,
  body:
    | { mode: "schedule" }
    | { mode: "manual"; currentElementId: string }
    | { mode: "anchored"; currentElementId: string },
) =>
  apiFetch<{ success: boolean; servicePlan: ServicePlan }>(
    `api/churches/${churchId}/service-plans/${encodeURIComponent(planKey)}/live`,
    { method: "POST", body: JSON.stringify(body) },
  );

export const deleteServicePlan = async (churchId: string, planKey: string) =>
  apiFetch<{ success: boolean }>(
    `api/churches/${churchId}/service-plans/${encodeURIComponent(planKey)}/delete`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );

export const listServicePlanTemplates = async (churchId: string) =>
  apiFetch<{ success: boolean; templates: ServicePlanTemplate[] }>(
    `api/churches/${churchId}/service-plan-templates`,
    { method: "GET" },
  );

/**
 * Upsert: omit `templateId` to create, pass it to overwrite an existing one.
 * `baseRevision` opts into conflict detection — the server answers 409 (with
 * the latest template in the body) rather than overwriting another editor.
 */
export const saveServicePlanTemplate = async (
  churchId: string,
  body: ServicePlanTemplatePayload & {
    templateId?: string;
    baseRevision?: number;
  },
) =>
  apiFetch<{ success: boolean; template: ServicePlanTemplate }>(
    `api/churches/${churchId}/service-plan-templates`,
    { method: "POST", body: JSON.stringify(body) },
  );

export const deleteServicePlanTemplate = async (
  churchId: string,
  templateId: string,
) =>
  apiFetch<{ success: boolean }>(
    `api/churches/${churchId}/service-plan-templates/${encodeURIComponent(templateId)}/delete`,
    { method: "POST", body: JSON.stringify({}) },
  );

/** Free-text "Assigned to" values remembered per church, for suggestions —
 * same members+history pattern as Overlays/Credits (see HistorySuggestField). */
export const getServicePlanAssignmentHistory = async (churchId: string) =>
  apiFetch<{ success: boolean; values: string[] }>(
    `api/churches/${churchId}/service-plan-assignment-history`,
    { method: "GET" },
  );

export const saveServicePlanAssignmentHistory = async (
  churchId: string,
  values: string[],
) =>
  apiFetch<{ success: boolean; values: string[] }>(
    `api/churches/${churchId}/service-plan-assignment-history`,
    { method: "POST", body: JSON.stringify({ values }) },
  );

/** Church-wide microphone catalog used by every service plan. */
export const getServicePlanMicrophones = async (churchId: string) =>
  apiFetch<{
    success: boolean;
    microphones: ServicePlanMicrophone[];
    audiences?: ServicePlanMicrophoneAudience[];
  }>(`api/churches/${churchId}/service-plan-microphones`, { method: "GET" });

export const saveServicePlanMicrophones = async (
  churchId: string,
  microphones: ServicePlanMicrophone[],
  audiences: ServicePlanMicrophoneAudience[],
) =>
  apiFetch<{
    success: boolean;
    microphones: ServicePlanMicrophone[];
    audiences?: ServicePlanMicrophoneAudience[];
  }>(`api/churches/${churchId}/service-plan-microphones`, {
    method: "POST",
    body: JSON.stringify({ microphones, audiences }),
  });

export const createAdminInvite = async (churchId: string, body: JsonBody) =>
  apiFetch<{ success: boolean; invite: ChurchInviteRow }>(
    `api/churches/${churchId}/invites`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );

/**
 * Invites a roster member to create an account, binding the invite to their
 * member record so accepting it establishes the link.
 *
 * Access is deliberately minimal and set here rather than by the caller: the
 * generic invite endpoint defaults to `admin` / `full`, which would hand a band
 * member the whole console. A volunteer needs an identity, not permissions —
 * their own schedule becomes visible with the member self-service scope.
 *
 * Requires an admin session server-side, so a teams-editor who is not an admin
 * will be refused.
 */
export const inviteTeamRosterMember = async (
  churchId: string,
  { email, memberId }: { email: string; memberId: string },
) =>
  createAdminInvite(churchId, {
    email,
    memberId,
    role: "member",
    // The narrowest tier: their own schedule, no operator surfaces.
    appAccess: "member",
    permissions: { teams: "none", services: "none" },
  });

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

export const makeAdmin = async (churchId: string, userId: string) =>
  apiFetch<{ success: boolean }>(
    `api/churches/${churchId}/members/${userId}/make-admin`,
    {
      method: "POST",
      body: JSON.stringify({}),
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
  appAccess: "full" | "music" | "view" | "member",
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
