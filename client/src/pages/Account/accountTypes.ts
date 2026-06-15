import type { MemberPermissions } from "../../api/authTypes";

export type Member = {
  membershipId: string;
  userId: string;
  role: string;
  appAccess: string;
  permissions?: MemberPermissions;
  user?: {
    uid: string;
    email: string;
    primaryEmail?: string;
    displayName?: string;
    linkedMethods?: string[];
  } | null;
};

export type HumanDevice = {
  deviceId: string;
  label: string;
  platformType?: string | null;
  revokedAt?: string | null;
  lastSeenAt?: string | null;
  user?: {
    uid: string;
    email: string;
    displayName?: string;
  } | null;
};

export type WorkstationDevice = {
  deviceId: string;
  label: string;
  appAccess: string;
  lastOperatorName?: string | null;
  revokedAt?: string | null;
};

export type DisplayDevice = {
  deviceId: string;
  label: string;
  surfaceType: string;
  revokedAt?: string | null;
};

export type MemberAccessOption = "full" | "music" | "view";

export type InviteRecord = {
  inviteId: string;
  email: string;
  role: string;
  appAccess: string;
  permissions?: MemberPermissions;
  status: string;
  createdAt?: string;
  expiresAt?: string;
};

export type AccountDestructiveConfirm =
  | {
      kind: "removeAdmin";
      membershipId: string;
      memberLabel: string;
      targetUserId: string;
    }
  | {
      kind: "removeMember";
      membershipId: string;
      memberLabel: string;
      targetUserId: string;
    }
  | {
      kind: "revokeWorkstation";
      device: WorkstationDevice;
    }
  | {
      kind: "revokeDisplay";
      device: DisplayDevice;
    }
  | {
      kind: "revokeTrusted";
      device: HumanDevice;
    }
  | {
      kind: "revokeInvite";
      invite: InviteRecord;
    };
