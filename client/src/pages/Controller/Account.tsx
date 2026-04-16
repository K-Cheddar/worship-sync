import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Ban, Eye, EyeOff, Save, ShieldPlus } from "lucide-react";
import Button from "../../components/Button/Button";
import Select from "../../components/Select/Select";
import Spinner from "../../components/Spinner/Spinner";
import { SectionTabs } from "../../components/SectionTabs/SectionTabs";
import DeleteModal from "../../components/Modal/DeleteModal";
import { GlobalInfoContext } from "../../context/globalInfo";
import { useToast } from "../../context/toastContext";
import { cn } from "@/utils/cnHelper";
import { alternatingAdminListRowBg } from "../../utils/listRowStripes";
import { getPlatformDisplayLabel } from "../../utils/deviceInfo";
import {
  listChurchInvites,
  listChurchMembers,
  listDisplayDevices,
  listTrustedDevices,
  listWorkstations,
  removeChurchMember,
  removeAdmin,
  requestAdminAccess,
  revokeChurchInvite,
  revokeDisplayDevice,
  revokeTrustedDevice,
  revokeWorkstation,
  updateChurchMemberAccess,
} from "../../api/auth";
import {
  ACCOUNT_CONTROL_SELECT_CLASSNAME,
  BrandingForm,
  DisplayPairingForm,
  InvitePeopleForm,
  RecoveryEmailForm,
  WorkstationPairingForm,
} from "./AccountFormSections";

type Member = {
  membershipId: string;
  userId: string;
  role: string;
  appAccess: string;
  user?: {
    uid: string;
    email: string;
    primaryEmail?: string;
    displayName?: string;
    linkedMethods?: string[];
  } | null;
};

type HumanDevice = {
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

type WorkstationDevice = {
  deviceId: string;
  label: string;
  appAccess: string;
  lastOperatorName?: string | null;
  revokedAt?: string | null;
};

type DisplayDevice = {
  deviceId: string;
  label: string;
  surfaceType: string;
  revokedAt?: string | null;
};

type MemberAccessOption = "full" | "music" | "view";

type InviteRecord = {
  inviteId: string;
  email: string;
  role: string;
  appAccess: string;
  status: string;
  createdAt?: string;
  expiresAt?: string;
};

type AccountDestructiveConfirm =
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

const memberAccessOptions: {
  value: MemberAccessOption;
  label: string;
}[] = [
    { value: "full", label: "Full access" },
    { value: "music", label: "Music access" },
    { value: "view", label: "View access" },
  ];

type AccountTabId = "people" | "setup" | "branding";

const ACCOUNT_TABS: {
  id: AccountTabId;
  label: string;
  description: string;
}[] = [
    {
      id: "people",
      label: "People",
      description: "Invite teammates and see who has access.",
    },
    {
      id: "setup",
      label: "Devices & security",
      description:
        "Create link codes, manage trusted devices, and update recovery email from one place.",
    },
    {
      id: "branding",
      label: "Branding",
      description: "Mission, vision, logos, and brand colors for controllers.",
    },
  ];

const formatLastSeenLabel = (value?: string | null) => {
  if (!value) return "Last seen unknown";
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return "Last seen unknown";
  return `Last seen ${new Date(value).toLocaleString()}`;
};

const formatTrustedDeviceTitle = (device: HumanDevice) => {
  const label = String(device.label || "").trim();
  const platformLabel = getPlatformDisplayLabel(device.platformType);
  if (!label) {
    return `${platformLabel} device`;
  }
  if (
    /^win/i.test(label) ||
    /^mac/i.test(label) ||
    /^linux/i.test(label) ||
    /^iphone|^ipad|^android/i.test(label) ||
    label === platformLabel
  ) {
    return `${platformLabel} device`;
  }
  if (label === "Trusted device") {
    return `${platformLabel} device`;
  }
  return label;
};

const formatSurfaceTypeLabel = (surfaceType?: string | null) => {
  const normalized = String(surfaceType || "").trim().toLowerCase();
  if (!normalized) return "Display";
  if (normalized === "stream-info") return "Stream info";
  if (normalized === "projector-display") return "Projector (display output)";
  if (normalized === "projector") return "Projector (full frame)";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const getTrustedDeviceOwnerLabel = (device: HumanDevice) =>
  device.user?.displayName?.trim() ||
  device.user?.email?.trim() ||
  "Unknown user";

const getWorkstationRevokeMessage = (ws: WorkstationDevice) => {
  const label = ws.label.trim() || "Unnamed workstation";
  const lastOp = ws.lastOperatorName?.trim();
  if (lastOp) {
    return `Revoked shared workstation “${label}” (last used by ${lastOp}).`;
  }
  return `Revoked shared workstation “${label}”.`;
};

const getDisplayRevokeMessage = (display: DisplayDevice) => {
  const label = display.label.trim() || "Unnamed display";
  const surface = formatSurfaceTypeLabel(display.surfaceType);
  return `Revoked ${surface} screen “${label}”.`;
};

const getTrustedDeviceRevokeMessage = (device: HumanDevice) => {
  const owner = getTrustedDeviceOwnerLabel(device);
  const title = formatTrustedDeviceTitle(device);
  return `Revoked trusted sign-in for ${owner} on ${title}.`;
};

const formatChurchStatusLabel = (status: string): string => {
  if (status === "active") return "Active";
  if (status === "needs-admin") return "Needs an admin";
  return status
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

const formatAccountError = (error: unknown, fallback: string): string => {
  const raw = error instanceof Error ? error.message.trim() : String(error).trim();
  if (!raw) return fallback;
  if (raw === "Request failed") {
    return "Could not reach the server. Check your connection and try again.";
  }
  if (
    raw.length < 160 &&
    !raw.includes("at ") &&
    !raw.toLowerCase().includes("stack")
  ) {
    return raw;
  }
  return fallback;
};

const toMemberAccessOption = (value?: string): MemberAccessOption => {
  if (value === "full" || value === "music" || value === "view") {
    return value;
  }
  return "view";
};

const AccountPage = () => {
  const context = useContext(GlobalInfoContext);
  const { showToast } = useToast();
  const churchId = context?.churchId || "";
  const isAdmin = context?.role === "admin";
  const canManage = isAdmin && Boolean(churchId);
  const canRequestRecovery =
    !isAdmin &&
    context?.sessionKind === "human" &&
    Boolean(churchId) &&
    context?.churchStatus === "needs-admin";

  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<InviteRecord[]>([]);
  const [trustedDevices, setTrustedDevices] = useState<HumanDevice[]>([]);
  const [showRevokedDevices, setShowRevokedDevices] = useState(false);
  const [showRevokedWorkstations, setShowRevokedWorkstations] = useState(false);
  const [showRevokedDisplays, setShowRevokedDisplays] = useState(false);
  const [workstations, setWorkstations] = useState<WorkstationDevice[]>([]);
  const [displayDevices, setDisplayDevices] = useState<DisplayDevice[]>([]);
  const [memberActionLoading, setMemberActionLoading] = useState<
    Record<string, boolean>
  >({});
  const [memberAccessDrafts, setMemberAccessDrafts] = useState<
    Record<string, MemberAccessOption>
  >({});
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [workstationPairingResetSignal, setWorkstationPairingResetSignal] =
    useState(0);
  const [displayPairingResetSignal, setDisplayPairingResetSignal] =
    useState(0);
  const [destructiveConfirm, setDestructiveConfirm] =
    useState<AccountDestructiveConfirm | null>(null);
  const [destructiveConfirmRunning, setDestructiveConfirmRunning] =
    useState(false);

  const showStatus = useCallback(
    (message: string) => {
      showToast(message, "success");
    },
    [showToast]
  );

  const showError = useCallback(
    (message: string) => {
      setWorkstationPairingResetSignal((n) => n + 1);
      setDisplayPairingResetSignal((n) => n + 1);
      showToast(message, "error");
    },
    [showToast]
  );

  const refresh = useCallback(async () => {
    if (!canManage) return;
    setIsRefreshing(true);
    try {
      const [
        memberResponse,
        inviteResponse,
        deviceResponse,
        workstationResponse,
        displayResponse,
      ] =
        await Promise.all([
          listChurchMembers(churchId),
          listChurchInvites(churchId),
          listTrustedDevices(),
          listWorkstations(churchId),
          listDisplayDevices(churchId),
        ]);
      setMembers((memberResponse.members || []) as Member[]);
      setInvites(inviteResponse.invites || []);
      setTrustedDevices((deviceResponse.devices || []) as HumanDevice[]);
      setWorkstations(workstationResponse.workstations || []);
      setDisplayDevices((displayResponse.displayDevices || []) as DisplayDevice[]);
    } catch (error) {
      showError(
        formatAccountError(
          error,
          "Could not load account details. Try again."
        )
      );
    } finally {
      setIsRefreshing(false);
    }
  }, [canManage, churchId, showError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runAction = useCallback(
    async (action: () => Promise<void>) => {
      try {
        await action();
      } catch (error) {
        showError(
          formatAccountError(error, "Could not complete that. Try again.")
        );
      }
    },
    [showError]
  );

  const runMemberAction = useCallback(
    async (actionKey: string, action: () => Promise<void>) => {
      setMemberActionLoading((prev) => ({ ...prev, [actionKey]: true }));
      try {
        await action();
      } catch (error) {
        showError(
          formatAccountError(error, "Could not complete that. Try again.")
        );
      } finally {
        setMemberActionLoading((prev) => {
          const next = { ...prev };
          delete next[actionKey];
          return next;
        });
      }
    },
    [showError]
  );

  const destructiveModalProps = useMemo(() => {
    if (!destructiveConfirm) {
      return null;
    }
    switch (destructiveConfirm.kind) {
      case "removeAdmin":
        return {
          title: "Remove admin access",
          message: "Are you sure you want to remove admin access from",
          itemName: destructiveConfirm.memberLabel,
          warningMessage:
            "They'll lose admin controls but remain a member unless you remove them.",
          confirmText: "Remove admin",
        };
      case "removeMember":
        return {
          title: "Remove member",
          message: "Are you sure you want to remove this person from your church",
          itemName: destructiveConfirm.memberLabel,
          warningMessage: "They'll lose access to this church immediately.",
          confirmText: "Remove",
        };
      case "revokeWorkstation":
        return {
          title: "Revoke shared workstation",
          message:
            "Are you sure you want to revoke access for the shared workstation labeled",
          itemName:
            destructiveConfirm.device.label.trim() || "Unnamed workstation",
          warningMessage:
            "That computer can't control this church until someone links it again from this account page.",
          confirmText: "Revoke access",
        };
      case "revokeDisplay":
        return {
          title: "Revoke display screen",
          message:
            "Are you sure you want to revoke access for the display screen labeled",
          itemName:
            destructiveConfirm.device.label.trim() || "Unnamed display",
          warningMessage:
            "That screen can't receive output until someone links it again from this account page.",
          confirmText: "Revoke access",
        };
      case "revokeTrusted": {
        const owner = getTrustedDeviceOwnerLabel(destructiveConfirm.device);
        const deviceTitle = formatTrustedDeviceTitle(destructiveConfirm.device);
        return {
          title: "Revoke trusted sign-in",
          message: `Are you sure you want to revoke trusted sign-in for ${owner} on ${deviceTitle}`,
          warningMessage:
            "They'll need to verify this device again the next time they sign in.",
          confirmText: "Revoke access",
        };
      }
      case "revokeInvite":
        return {
          title: "Revoke invite",
          message: "Stop this pending invite for",
          itemName: destructiveConfirm.invite.email,
          warningMessage:
            "The invite link will stop working. You can send a new invite later if you need to.",
          confirmText: "Revoke invite",
        };
    }
  }, [destructiveConfirm]);

  const handleDestructiveConfirm = useCallback(async () => {
    if (!destructiveConfirm) {
      return;
    }
    setDestructiveConfirmRunning(true);
    const c = destructiveConfirm;
    try {
      switch (c.kind) {
        case "removeAdmin":
          await removeAdmin(churchId, c.targetUserId);
          showStatus(`Removed admin access for ${c.memberLabel}.`);
          await refresh();
          break;
        case "removeMember":
          await removeChurchMember(churchId, c.targetUserId);
          showStatus(`Removed ${c.memberLabel} from this church.`);
          await refresh();
          break;
        case "revokeWorkstation":
          await revokeWorkstation(churchId, c.device.deviceId);
          await refresh();
          if (!showRevokedWorkstations) {
            showStatus(getWorkstationRevokeMessage(c.device));
          }
          break;
        case "revokeDisplay":
          await revokeDisplayDevice(churchId, c.device.deviceId);
          await refresh();
          if (!showRevokedDisplays) {
            showStatus(getDisplayRevokeMessage(c.device));
          }
          break;
        case "revokeTrusted":
          await revokeTrustedDevice(c.device.deviceId);
          showStatus(getTrustedDeviceRevokeMessage(c.device));
          await refresh();
          break;
        case "revokeInvite":
          await revokeChurchInvite(churchId, c.invite.inviteId);
          showStatus("Invite revoked.");
          await refresh();
          break;
      }
      setDestructiveConfirm(null);
    } catch (error) {
      showError(
        formatAccountError(error, "Could not complete that. Try again.")
      );
    } finally {
      setDestructiveConfirmRunning(false);
    }
  }, [
    destructiveConfirm,
    churchId,
    refresh,
    revokeChurchInvite,
    showError,
    showStatus,
    showRevokedWorkstations,
    showRevokedDisplays,
  ]);

  const myUserId = context?.userId ?? "";

  const sortedMembers = useMemo(() => {
    const isMe = (m: Member) =>
      Boolean(myUserId && (m.user?.uid === myUserId || m.userId === myUserId));

    return [...members].sort((a, b) => {
      const aSelf = isMe(a);
      const bSelf = isMe(b);
      if (aSelf && !bSelf) return -1;
      if (!aSelf && bSelf) return 1;

      const aLabel =
        a.user?.displayName?.trim() ||
        a.user?.email?.trim() ||
        a.userId;
      const bLabel =
        b.user?.displayName?.trim() ||
        b.user?.email?.trim() ||
        b.userId;
      return aLabel.localeCompare(bLabel);
    });
  }, [members, myUserId]);

  const sortedInvites = useMemo(
    () =>
      [...invites].sort(
        (a, b) =>
          new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
      ),
    [invites]
  );

  const visibleTrustedDevices = useMemo(
    () =>
      trustedDevices.filter(
        (device) => showRevokedDevices || !device.revokedAt
      ),
    [showRevokedDevices, trustedDevices]
  );

  const visibleWorkstations = useMemo(
    () =>
      workstations.filter(
        (ws) => showRevokedWorkstations || !ws.revokedAt
      ),
    [showRevokedWorkstations, workstations]
  );

  const visibleDisplayDevices = useMemo(
    () =>
      displayDevices.filter(
        (d) => showRevokedDisplays || !d.revokedAt
      ),
    [displayDevices, showRevokedDisplays]
  );

  const getMemberAccessValue = useCallback(
    (member: Member): MemberAccessOption =>
      memberAccessDrafts[member.membershipId] ||
      toMemberAccessOption(member.appAccess),
    [memberAccessDrafts]
  );

  if (!canManage) {
    return (
      <div className="px-2 py-1 text-white sm:px-4">
        <div className="mx-auto max-w-lg rounded-xl border border-gray-700 bg-gray-950/50 p-6 text-center">
          <h2 className="text-2xl font-semibold">Account</h2>
          <p className="mt-3 text-sm leading-relaxed text-gray-200">
            {canRequestRecovery
              ? "Add an admin before you can manage settings here."
              : "You need admin access to manage this church."}
          </p>
          {canRequestRecovery && (
            <div className="mt-6">
              <Button
                variant="cta"
                svg={ShieldPlus}
                onClick={() =>
                  void runAction(async () => {
                    await requestAdminAccess(churchId);
                    showStatus("Admin recovery request sent.");
                  })
                }
              >
                Request admin access
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  const churchStatusRaw = context?.churchStatus || "active";

  return (
    <div className="px-2 py-1 text-white sm:px-4">
      <div className="mb-6 flex flex-col gap-3 border-b border-gray-700/70 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Overview</h2>
          <p className="mt-1 max-w-xl text-sm text-gray-300">
            Invite people, link shared devices, manage recovery, and save church branding in one place.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 sm:flex-nowrap">
          {isRefreshing && (
            <div
              className="flex shrink-0 items-center gap-2 text-xs font-medium text-gray-200"
              role="status"
              aria-live="polite"
            >
              <Spinner
                width="16px"
                borderWidth="2px"
                className="shrink-0 border-cyan-400/90 border-b-transparent"
              />
              <span>Refreshing…</span>
            </div>
          )}
          <span className="rounded-full border border-gray-600 bg-gray-950/45 px-3 py-1 text-xs font-medium text-gray-200">
            Status: {formatChurchStatusLabel(churchStatusRaw)}
          </span>
        </div>
      </div>

      <SectionTabs
        defaultValue="people"
        className="pb-2"
        items={[
          {
            value: "people",
            label: ACCOUNT_TABS[0].label,
            description: ACCOUNT_TABS[0].description,
            content: (
              <>
                <InvitePeopleForm
                  churchId={churchId}
                  onInvited={refresh}
                />

                <section
                  className="rounded-xl border border-gray-700 bg-gray-950/50 p-4"
                >
                  <h3 className="text-lg font-semibold">Pending invites</h3>
                  <p className="mt-1 text-sm text-gray-400">
                    Waiting to be accepted. Unused invites expire on their own.
                    You can revoke an invite if the link should stop working.
                  </p>
                  <div className="mt-4 space-y-2">
                    {sortedInvites.length === 0 && (
                      <p className="text-sm text-gray-300">No pending invites yet.</p>
                    )}
                    {sortedInvites.map((invite, inviteIndex) => {
                      const accessLabel =
                        invite.role === "admin" ? "Admin" : invite.appAccess;
                      const expiresLabel = invite.expiresAt
                        ? new Date(invite.expiresAt).toLocaleString()
                        : "Unknown";
                      const createdLabel = invite.createdAt
                        ? new Date(invite.createdAt).toLocaleString()
                        : "Unknown";
                      const isRevokeInviteConfirming =
                        destructiveConfirmRunning &&
                        destructiveConfirm?.kind === "revokeInvite" &&
                        destructiveConfirm.invite.inviteId === invite.inviteId;

                      return (
                        <div
                          key={invite.inviteId}
                          className={cn(
                            "flex flex-col gap-2 rounded-lg px-3 py-3 sm:flex-row sm:items-center sm:justify-between",
                            alternatingAdminListRowBg(inviteIndex)
                          )}
                        >
                          <div className="min-w-0">
                            <p className="font-semibold">{invite.email}</p>
                            <p className="text-sm text-gray-300">
                              {accessLabel} | Sent {createdLabel}
                            </p>
                            <p className="text-sm text-gray-400">
                              Expires {expiresLabel}
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="destructive"
                            className="shrink-0 self-start sm:self-center"
                            aria-label={`Revoke invite for ${invite.email}`}
                            isLoading={isRevokeInviteConfirming}
                            disabled={destructiveConfirmRunning}
                            onClick={() =>
                              setDestructiveConfirm({
                                kind: "revokeInvite",
                                invite,
                              })
                            }
                          >
                            Revoke
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </section>

                <section
                  className="rounded-xl border border-gray-700 bg-gray-950/50 p-4"
                >
                  <h3 className="text-lg font-semibold">Church members</h3>
                  <p className="mt-1 text-sm text-gray-400">
                    Everyone with access here. Admins can edit member access, remove
                    members, or remove admin access.
                  </p>
                  <div className="mt-4 space-y-2">
                    {sortedMembers.length === 0 && (
                      <p className="text-sm text-gray-300">No members yet.</p>
                    )}
                    {sortedMembers.map((member, memberIndex) => {
                      const memberUser = member.user;
                      const memberEmail =
                        memberUser?.primaryEmail || memberUser?.email || "";
                      const memberLabel =
                        memberUser?.displayName || memberEmail || "Unknown user";
                      const isSelf = memberUser?.uid === context?.userId;
                      const isAdminMember = member.role === "admin";
                      const targetUserId = memberUser?.uid || member.userId;
                      const currentAccess = toMemberAccessOption(member.appAccess);
                      const selectedAccess = getMemberAccessValue(member);
                      const accessChanged = selectedAccess !== currentAccess;
                      const saveAccessKey = `save-access:${member.membershipId}`;

                      return (
                        <div
                          key={member.membershipId}
                          className={cn(
                            "rounded-lg px-3 py-2.5 sm:py-3",
                            isSelf
                              ? "border border-cyan-500/35 bg-linear-to-r from-cyan-950/40 to-gray-950/55 shadow-[inset_3px_0_0_0] shadow-cyan-400/70"
                              : alternatingAdminListRowBg(memberIndex)
                          )}
                        >
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
                            <div className="min-w-0 flex-1">
                              <p className="flex flex-wrap items-center gap-2 font-semibold">
                                <span>{memberLabel}</span>
                                {isSelf && (
                                  <span className="rounded-full border border-cyan-400/40 bg-cyan-500/15 px-2 py-0.5 text-xs font-medium text-cyan-200">
                                    You
                                  </span>
                                )}
                              </p>
                              <p
                                className={cn(
                                  "text-sm",
                                  isSelf ? "text-cyan-100/90" : "text-gray-300"
                                )}
                              >
                                {isAdminMember ? "Admin" : "Member"} | {member.appAccess}
                              </p>
                              {memberEmail ? (
                                <p className="text-xs text-gray-400">{memberEmail}</p>
                              ) : null}
                              {Array.isArray(memberUser?.linkedMethods) &&
                                memberUser?.linkedMethods.length > 0 ? (
                                <p className="text-xs text-gray-400">
                                  Sign-in methods: {memberUser.linkedMethods.join(", ")}
                                </p>
                              ) : null}
                            </div>
                            {!isSelf && (
                              <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">
                                {!isAdminMember && targetUserId && (
                                  <>
                                    <Select
                                      className="min-w-44 sm:min-w-48"
                                      id={`member-access-${member.membershipId}`}
                                      label="Access"
                                      hideLabel
                                      value={selectedAccess}
                                      options={memberAccessOptions}
                                      selectClassName={ACCOUNT_CONTROL_SELECT_CLASSNAME}
                                      onChange={(value) =>
                                        setMemberAccessDrafts((prev) => ({
                                          ...prev,
                                          [member.membershipId]: value as MemberAccessOption,
                                        }))
                                      }
                                    />
                                    <Button
                                      variant="cta"
                                      svg={Save}
                                      iconSize="sm"
                                      isLoading={Boolean(memberActionLoading[saveAccessKey])}
                                      disabled={
                                        Boolean(memberActionLoading[saveAccessKey]) ||
                                        !accessChanged
                                      }
                                      onClick={() =>
                                        void runMemberAction(saveAccessKey, async () => {
                                          await updateChurchMemberAccess(
                                            churchId,
                                            targetUserId,
                                            selectedAccess
                                          );
                                          setMemberAccessDrafts((prev) => {
                                            const next = { ...prev };
                                            delete next[member.membershipId];
                                            return next;
                                          });
                                          showStatus(`Updated access for ${memberLabel}.`);
                                          await refresh();
                                        })
                                      }
                                    >
                                      Save
                                    </Button>
                                  </>
                                )}
                                {isAdminMember && targetUserId && (
                                  <Button
                                    variant="destructive"
                                    svg={Ban}
                                    iconSize="sm"
                                    isLoading={
                                      destructiveConfirmRunning &&
                                      destructiveConfirm?.kind === "removeAdmin" &&
                                      destructiveConfirm.membershipId ===
                                      member.membershipId
                                    }
                                    disabled={destructiveConfirmRunning}
                                    onClick={() =>
                                      setDestructiveConfirm({
                                        kind: "removeAdmin",
                                        membershipId: member.membershipId,
                                        memberLabel,
                                        targetUserId,
                                      })
                                    }
                                  >
                                    Remove admin
                                  </Button>
                                )}
                                {targetUserId && (
                                  <Button
                                    variant="destructive"
                                    svg={Ban}
                                    iconSize="sm"
                                    isLoading={
                                      destructiveConfirmRunning &&
                                      destructiveConfirm?.kind === "removeMember" &&
                                      destructiveConfirm.membershipId ===
                                      member.membershipId
                                    }
                                    disabled={destructiveConfirmRunning}
                                    onClick={() =>
                                      setDestructiveConfirm({
                                        kind: "removeMember",
                                        membershipId: member.membershipId,
                                        memberLabel,
                                        targetUserId,
                                      })
                                    }
                                  >
                                    Remove
                                  </Button>
                                )}
                              </div>
                            )}
                          </div>
                          {isAdminMember && !isSelf && (
                            <p className="mt-2 text-xs text-gray-400">
                              Admins keep full access while they are admins.
                            </p>
                          )}
                          {isSelf && (
                            <p className="mt-2 text-xs text-cyan-200/75">
                              You can’t edit or remove your own membership here.
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              </>
            ),
          },
          {
            value: "setup",
            label: ACCOUNT_TABS[1].label,
            description: ACCOUNT_TABS[1].description,
            content: (
              <>
                <section
                  className="rounded-xl border border-gray-700 bg-gray-950/50 p-4"
                >
                  <h3 className="text-lg font-semibold">Shared workstations</h3>
                  <p className="mt-1 text-sm text-gray-400">
                    For shared computers when no one is signed in personally.
                  </p>
                  <WorkstationPairingForm
                    churchId={churchId}
                    formsResetSignal={workstationPairingResetSignal}
                    onGenerated={async () => {
                      setDisplayPairingResetSignal((n) => n + 1);
                      await refresh();
                    }}
                  />
                  <div className="mt-6 space-y-2 border-t border-gray-700/60 pt-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                        Connected workstations
                      </p>
                      <Button
                        variant="tertiary"
                        svg={showRevokedWorkstations ? EyeOff : Eye}
                        iconSize="sm"
                        className="shrink-0 self-start sm:self-auto"
                        onClick={() =>
                          setShowRevokedWorkstations((current) => !current)
                        }
                      >
                        {showRevokedWorkstations
                          ? "Hide revoked workstations"
                          : "Show revoked workstations"}
                      </Button>
                    </div>
                    {workstations.length === 0 && (
                      <p className="text-sm text-gray-300">No shared workstations yet.</p>
                    )}
                    {workstations.length > 0 && visibleWorkstations.length === 0 && (
                      <p className="text-sm text-gray-300">
                        No workstations match this filter.
                      </p>
                    )}
                    {visibleWorkstations.map((workstation, workstationIndex) => {
                      const isThisRevokeLoading =
                        destructiveConfirmRunning &&
                        destructiveConfirm?.kind === "revokeWorkstation" &&
                        destructiveConfirm.device.deviceId === workstation.deviceId;
                      return (
                        <div
                          key={workstation.deviceId}
                          className={cn(
                            "flex items-start justify-between gap-3 rounded-lg px-3 py-3 sm:items-center",
                            alternatingAdminListRowBg(workstationIndex)
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold">{workstation.label}</p>
                            <p className="text-sm text-gray-300">
                              {workstation.appAccess}
                              {workstation.lastOperatorName
                                ? ` | ${workstation.lastOperatorName}`
                                : ""}
                              {workstation.revokedAt ? " | revoked" : ""}
                            </p>
                          </div>
                          {!workstation.revokedAt && (
                            <Button
                              variant="destructive"
                              svg={Ban}
                              iconSize="sm"
                              className="shrink-0 self-start sm:self-auto"
                              isLoading={isThisRevokeLoading}
                              disabled={destructiveConfirmRunning}
                              onClick={() =>
                                setDestructiveConfirm({
                                  kind: "revokeWorkstation",
                                  device: workstation,
                                })
                              }
                            >
                              Revoke
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>

                <section
                  className="rounded-xl border border-gray-700 bg-gray-950/50 p-4"
                >
                  <h3 className="text-lg font-semibold">Display screens</h3>
                  <p className="mt-1 text-sm text-gray-400">
                    Projector and other outputs you link without a personal sign-in.
                  </p>
                  <DisplayPairingForm
                    churchId={churchId}
                    formsResetSignal={displayPairingResetSignal}
                    onGenerated={async () => {
                      setWorkstationPairingResetSignal((n) => n + 1);
                      await refresh();
                    }}
                  />
                  <div className="mt-6 space-y-2 border-t border-gray-700/60 pt-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                        Connected displays
                      </p>
                      <Button
                        variant="tertiary"
                        svg={showRevokedDisplays ? EyeOff : Eye}
                        iconSize="sm"
                        className="shrink-0 self-start sm:self-auto"
                        onClick={() => setShowRevokedDisplays((current) => !current)}
                      >
                        {showRevokedDisplays
                          ? "Hide revoked displays"
                          : "Show revoked displays"}
                      </Button>
                    </div>
                    {displayDevices.length === 0 && (
                      <p className="text-sm text-gray-300">No display screens yet.</p>
                    )}
                    {displayDevices.length > 0 && visibleDisplayDevices.length === 0 && (
                      <p className="text-sm text-gray-300">
                        No displays match this filter.
                      </p>
                    )}
                    {visibleDisplayDevices.map((display, displayIndex) => {
                      const isThisRevokeLoading =
                        destructiveConfirmRunning &&
                        destructiveConfirm?.kind === "revokeDisplay" &&
                        destructiveConfirm.device.deviceId === display.deviceId;
                      return (
                        <div
                          key={display.deviceId}
                          className={cn(
                            "flex items-start justify-between gap-3 rounded-lg px-3 py-3 sm:items-center",
                            alternatingAdminListRowBg(displayIndex)
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold">{display.label}</p>
                            <p className="text-sm text-gray-300">
                              {formatSurfaceTypeLabel(display.surfaceType)}
                              {display.revokedAt ? " | revoked" : ""}
                            </p>
                          </div>
                          {!display.revokedAt && (
                            <Button
                              variant="destructive"
                              svg={Ban}
                              iconSize="sm"
                              className="shrink-0 self-start sm:self-auto"
                              isLoading={isThisRevokeLoading}
                              disabled={destructiveConfirmRunning}
                              onClick={() =>
                                setDestructiveConfirm({
                                  kind: "revokeDisplay",
                                  device: display,
                                })
                              }
                            >
                              Revoke
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>

                <section
                  className="rounded-xl border border-gray-700 bg-gray-950/50 p-4"
                >
                  <h3 className="text-lg font-semibold">Trusted devices</h3>
                  <p className="mt-1 text-sm text-gray-400">
                    Trusted sign-in devices across this church. Admins can revoke access when needed.
                  </p>
                  <div className="mt-4 flex justify-end">
                    <Button
                      variant="tertiary"
                      svg={showRevokedDevices ? EyeOff : Eye}
                      iconSize="sm"
                      onClick={() => setShowRevokedDevices((current) => !current)}
                    >
                      {showRevokedDevices ? "Hide revoked devices" : "Show revoked devices"}
                    </Button>
                  </div>
                  <div className="mt-4 space-y-2">
                    {visibleTrustedDevices.length === 0 && (
                      <p className="text-sm text-gray-300">
                        {trustedDevices.length === 0
                          ? "No trusted devices yet."
                          : "No devices match this filter."}
                      </p>
                    )}
                    {visibleTrustedDevices.map((device, trustedIndex) => {
                      const isThisRevokeLoading =
                        destructiveConfirmRunning &&
                        destructiveConfirm?.kind === "revokeTrusted" &&
                        destructiveConfirm.device.deviceId === device.deviceId;
                      return (
                        <div
                          key={device.deviceId}
                          className={cn(
                            "flex items-start justify-between gap-3 rounded-lg px-3 py-3 sm:items-center",
                            alternatingAdminListRowBg(trustedIndex)
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold">
                              {formatTrustedDeviceTitle(device)}
                            </p>
                            <p className="text-sm text-gray-300">
                              {getTrustedDeviceOwnerLabel(device)} |{" "}
                              {getPlatformDisplayLabel(device.platformType)}
                              {device.revokedAt ? " | revoked" : ""}
                            </p>
                            <p className="text-sm text-gray-400">
                              {formatLastSeenLabel(device.lastSeenAt)}
                            </p>
                          </div>
                          {!device.revokedAt && (
                            <Button
                              variant="destructive"
                              svg={Ban}
                              iconSize="sm"
                              className="shrink-0 self-start sm:self-auto"
                              isLoading={isThisRevokeLoading}
                              disabled={destructiveConfirmRunning}
                              onClick={() =>
                                setDestructiveConfirm({
                                  kind: "revokeTrusted",
                                  device,
                                })
                              }
                            >
                              Revoke
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>

                <section
                  className="rounded-xl border border-gray-700 bg-gray-950/50 p-4"
                >
                  <h3 className="text-lg font-semibold">Recovery email</h3>
                  <p className="mt-1 text-sm text-gray-400">
                    We send admin recovery requests here.
                  </p>
                  <RecoveryEmailForm
                    churchId={churchId}
                    recoveryEmailFromContext={context?.recoveryEmail}
                  />
                </section>
              </>
            ),
          },
          {
            value: "branding",
            label: ACCOUNT_TABS[2].label,
            description: ACCOUNT_TABS[2].description,
            content: (
              <BrandingForm
                churchId={churchId}
                branding={context?.churchBranding || {
                  mission: "",
                  vision: "",
                  logos: { square: null, wide: null },
                  colors: [],
                }}
                brandingStatus={context?.churchBrandingStatus || "loading"}
              />
            ),
          },
        ]}
      />
      <DeleteModal
        isOpen={destructiveConfirm !== null}
        onClose={() => setDestructiveConfirm(null)}
        onConfirm={() => void handleDestructiveConfirm()}
        isConfirming={destructiveConfirmRunning}
        confirmingLabel="Applying..."
        cancelText="Cancel"
        {...(destructiveModalProps ?? {
          title: "",
          message: "",
        })}
      />
    </div>
  );
};

export default AccountPage;
