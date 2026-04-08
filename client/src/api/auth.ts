import { getApiBasePath } from "../utils/environment";
import { getCsrfToken } from "../utils/authStorage";
import type {
  AuthBootstrap,
  ChurchInviteRow,
  ChurchMemberRow,
  DisplayDeviceClient,
  PairingClient,
  RedeemDisplayPairingResponse,
  RedeemWorkstationPairingResponse,
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

const apiFetch = async <T>(
  path: string,
  options: RequestInit = {},
  extraHeaders?: Record<string, string>,
) => {
  let response: Response;
  try {
    response = await fetch(`${getApiBasePath()}${path}`, {
      credentials: "include",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
        ...(extraHeaders || {}),
        ...((options.method || "GET").toUpperCase() !== "GET" && getCsrfToken()
          ? { "x-csrf-token": getCsrfToken() }
          : {}),
      },
    });
  } catch {
    throw new AuthApiError("Could not reach the server.", {
      isReachabilityError: true,
    });
  }

  let data: (T & { errorMessage?: string }) | null = null;
  try {
    data = (await response.json()) as T & { errorMessage?: string };
  } catch {
    throw new AuthApiError("Received an invalid server response.", {
      status: response.status,
      isReachabilityError: true,
    });
  }

  if (!response.ok) {
    throw new AuthApiError(data?.errorMessage || "Request failed", {
      status: response.status,
    });
  }

  return data;
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

export const createHumanSession = async (body: JsonBody) =>
  apiFetch<{
    success: boolean;
    bootstrap?: AuthBootstrap;
    requiresEmailCode?: boolean;
    pendingAuthId?: string;
  }>("api/auth/session", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const resendEmailCode = async (body: JsonBody) =>
  apiFetch<{
    success: boolean;
    bootstrap?: AuthBootstrap;
    requiresEmailCode?: boolean;
    pendingAuthId?: string;
  }>("api/auth/resend-email-code", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const verifyEmailCode = async (body: JsonBody) =>
  apiFetch<{
    success: boolean;
    bootstrap: AuthBootstrap;
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

export const createAdminInvite = async (churchId: string, body: JsonBody) =>
  apiFetch<{ success: boolean; invite: ChurchInviteRow }>(
    `api/churches/${churchId}/invites`,
    {
      method: "POST",
      body: JSON.stringify(body),
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
) =>
  apiFetch<{ success: boolean }>(
    `api/churches/${churchId}/members/${userId}/access`,
    {
      method: "POST",
      body: JSON.stringify({ appAccess }),
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
