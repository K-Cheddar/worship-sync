/**
 * Shared auth API types (client). Server: authService.js.
 * Hash fields are never returned; lists are sanitized server-side.
 *
 * appAccess matches GlobalInfoContext AccessType ("full" | "music" | "view")
 * without importing context (avoids circular module graphs).
 */

export type SessionKind = "human" | "workstation" | "display" | null;
export type ChurchStatus = "active" | "needs-admin";

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
  role?: string | null;
  user?: {
    uid: string;
    email: string;
    displayName: string;
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
  user: AuthUserSummary | null;
};

export type ChurchInviteRow = {
  inviteId: string;
  churchId: string;
  email: string;
  role: string;
  appAccess: string;
  status: string;
  expiresAt: string;
  createdAt: string;
  inviteLink?: string;
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
