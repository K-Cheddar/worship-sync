import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  listChurchInvites,
  listChurchMembers,
  getTeamsBootstrap,
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
} from "../../../api/auth";
import type { TeamRecord, TeamsPermission } from "../../../api/authTypes";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { useToast } from "../../../context/toastContext";
import { useApiErrorToast } from "../../../hooks/useApiErrorToast";
import { resolveChurchToolbarLogoUrl } from "../../../utils/churchBranding";
import type {
  AccessSheetTarget,
  AccountDestructiveConfirm,
  DisplayDevice,
  HumanDevice,
  InviteAccessDraft,
  InviteRecord,
  Member,
  MemberAccessOption,
  WorkstationDevice,
} from "../accountTypes";
import {
  formatAccountError,
  getDisplayRevokeMessage,
  getTrustedDeviceRevokeMessage,
  getTrustedDeviceOwnerLabel,
  getWorkstationRevokeMessage,
  formatTrustedDeviceTitle,
  toMemberAccessOption,
} from "../accountUtils";
import {
  buildTeamScopesPermissions,
  getEditableTeamScopeIds,
  teamsPageAccessOptions,
  toTeamsAccessOption,
} from "../accountTeamsAccess";
import {
  DEFAULT_INVITE_ACCESS_DRAFT,
  inviteAccessDraftFromInvite,
} from "../accountInviteAccess";

export {
  buildTeamScopesPermissions,
  getEditableTeamScopeIds,
  toTeamsAccessOption,
};

export const useAccountPageState = () => {
  const context = useContext(GlobalInfoContext);
  const { showToast } = useToast();
  const { showApiError } = useApiErrorToast();
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
  const [teams, setTeams] = useState<TeamRecord[]>([]);
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
  const [memberTeamsAccessDrafts, setMemberTeamsAccessDrafts] = useState<
    Record<string, TeamsPermission>
  >({});
  const [memberTeamScopeDrafts, setMemberTeamScopeDrafts] = useState<
    Record<string, string[]>
  >({});
  const [inviteAccessDraft, setInviteAccessDraft] = useState<InviteAccessDraft>(
    DEFAULT_INVITE_ACCESS_DRAFT,
  );
  const [invitePendingAccessDrafts, setInvitePendingAccessDrafts] = useState<
    Record<string, InviteAccessDraft>
  >({});
  const [accessSheetTarget, setAccessSheetTarget] =
    useState<AccessSheetTarget | null>(null);
  const [loading, setLoading] = useState(canManage);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [workstationPairingResetSignal, setWorkstationPairingResetSignal] =
    useState(0);
  const [displayPairingResetSignal, setDisplayPairingResetSignal] = useState(0);
  const [destructiveConfirm, setDestructiveConfirm] =
    useState<AccountDestructiveConfirm | null>(null);
  const [destructiveConfirmRunning, setDestructiveConfirmRunning] =
    useState(false);

  const toolbarLogoUrl = useMemo(
    () => resolveChurchToolbarLogoUrl(context?.churchBranding),
    [context?.churchBranding],
  );
  const churchName = context?.churchName?.trim() || "";
  const churchStatusRaw = context?.churchStatus || "active";

  const showStatus = useCallback(
    (message: string) => {
      showToast(message, "success");
    },
    [showToast],
  );

  const showError = useCallback(
    (error: unknown, message: string) => {
      setWorkstationPairingResetSignal((n) => n + 1);
      setDisplayPairingResetSignal((n) => n + 1);
      showApiError(error, message);
    },
    [showApiError],
  );

  const refresh = useCallback(async () => {
    if (!canManage) {
      setLoading(false);
      return;
    }
    setIsRefreshing(true);
    try {
      const [
        memberResponse,
        inviteResponse,
        deviceResponse,
        workstationResponse,
        displayResponse,
        teamsResponse,
      ] = await Promise.all([
        listChurchMembers(churchId),
        listChurchInvites(churchId),
        listTrustedDevices(),
        listWorkstations(churchId),
        listDisplayDevices(churchId),
        getTeamsBootstrap(churchId),
      ]);
      setMembers((memberResponse.members || []) as Member[]);
      setInvites(inviteResponse.invites || []);
      setTrustedDevices((deviceResponse.devices || []) as HumanDevice[]);
      setWorkstations(workstationResponse.workstations || []);
      setDisplayDevices(
        (displayResponse.displayDevices || []) as DisplayDevice[],
      );
      setTeams(teamsResponse.teams || []);
    } catch (error) {
      showError(
        error,
        formatAccountError(error, "Could not load account details. Try again."),
      );
    } finally {
      setLoading(false);
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
          error,
          formatAccountError(error, "Could not complete that. Try again."),
        );
      }
    },
    [showError],
  );

  const runMemberAction = useCallback(
    async (actionKey: string, action: () => Promise<void>) => {
      setMemberActionLoading((prev) => ({ ...prev, [actionKey]: true }));
      try {
        await action();
      } catch (error) {
        showError(
          error,
          formatAccountError(error, "Could not complete that. Try again."),
        );
      } finally {
        setMemberActionLoading((prev) => {
          const next = { ...prev };
          delete next[actionKey];
          return next;
        });
      }
    },
    [showError],
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
          message:
            "Are you sure you want to remove this person from your church",
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
          itemName: destructiveConfirm.device.label.trim() || "Unnamed display",
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
        error,
        formatAccountError(error, "Could not complete that. Try again."),
      );
    } finally {
      setDestructiveConfirmRunning(false);
    }
  }, [
    destructiveConfirm,
    churchId,
    refresh,
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
        a.user?.displayName?.trim() || a.user?.email?.trim() || a.userId;
      const bLabel =
        b.user?.displayName?.trim() || b.user?.email?.trim() || b.userId;
      return aLabel.localeCompare(bLabel);
    });
  }, [members, myUserId]);

  const sortedInvites = useMemo(
    () =>
      [...invites].sort(
        (a, b) =>
          new Date(b.createdAt || 0).getTime() -
          new Date(a.createdAt || 0).getTime(),
      ),
    [invites],
  );

  const visibleTrustedDevices = useMemo(
    () =>
      trustedDevices.filter(
        (device) => showRevokedDevices || !device.revokedAt,
      ),
    [showRevokedDevices, trustedDevices],
  );

  const visibleWorkstations = useMemo(
    () => workstations.filter((ws) => showRevokedWorkstations || !ws.revokedAt),
    [showRevokedWorkstations, workstations],
  );

  const visibleDisplayDevices = useMemo(
    () => displayDevices.filter((d) => showRevokedDisplays || !d.revokedAt),
    [displayDevices, showRevokedDisplays],
  );

  const getMemberAccessValue = useCallback(
    (member: Member): MemberAccessOption =>
      memberAccessDrafts[member.membershipId] ||
      toMemberAccessOption(member.appAccess),
    [memberAccessDrafts],
  );

  const getMemberTeamsAccessValue = useCallback(
    (member: Member) =>
      memberTeamsAccessDrafts[member.membershipId] ||
      toTeamsAccessOption(member.permissions, member.role),
    [memberTeamsAccessDrafts],
  );

  const getMemberTeamScopeValue = useCallback(
    (member: Member): string[] =>
      memberTeamScopeDrafts[member.membershipId] ||
      getEditableTeamScopeIds(member.permissions),
    [memberTeamScopeDrafts],
  );

  const getInvitePendingAccessValue = useCallback(
    (invite: InviteRecord): InviteAccessDraft =>
      invitePendingAccessDrafts[invite.inviteId] ||
      inviteAccessDraftFromInvite(invite),
    [invitePendingAccessDrafts],
  );

  const openMemberAccessSheet = useCallback((member: Member) => {
    setAccessSheetTarget({ kind: "member", member });
  }, []);

  const openInviteDraftAccessSheet = useCallback(() => {
    setAccessSheetTarget({ kind: "invite-draft" });
  }, []);

  const openInviteAccessSheet = useCallback((invite: InviteRecord) => {
    setAccessSheetTarget({ kind: "invite", invite });
  }, []);

  const closeAccessSheet = useCallback(() => {
    setAccessSheetTarget(null);
  }, []);

  const resetInviteAccessDraft = useCallback(() => {
    setInviteAccessDraft(DEFAULT_INVITE_ACCESS_DRAFT);
  }, []);

  return {
    context,
    churchId,
    canManage,
    canRequestRecovery,
    loading,
    isRefreshing,
    churchStatusRaw,
    toolbarLogoUrl,
    churchName,
    teams,
    teamsAccessOptions: teamsPageAccessOptions,
    sortedMembers,
    sortedInvites,
    visibleTrustedDevices,
    visibleWorkstations,
    visibleDisplayDevices,
    trustedDevices,
    workstations,
    displayDevices,
    memberActionLoading,
    destructiveConfirm,
    destructiveConfirmRunning,
    destructiveModalProps,
    accessSheetTarget,
    inviteAccessDraft,
    workstationPairingResetSignal,
    displayPairingResetSignal,
    showRevokedDevices,
    showRevokedWorkstations,
    showRevokedDisplays,
    setShowRevokedDevices,
    setShowRevokedWorkstations,
    setShowRevokedDisplays,
    setDestructiveConfirm,
    setWorkstationPairingResetSignal,
    setDisplayPairingResetSignal,
    setMemberAccessDrafts,
    setMemberTeamsAccessDrafts,
    setMemberTeamScopeDrafts,
    setInviteAccessDraft,
    setInvitePendingAccessDrafts,
    setAccessSheetTarget,
    openMemberAccessSheet,
    openInviteDraftAccessSheet,
    openInviteAccessSheet,
    closeAccessSheet,
    resetInviteAccessDraft,
    refresh,
    runAction,
    runMemberAction,
    showStatus,
    handleDestructiveConfirm,
    getMemberAccessValue,
    getMemberTeamsAccessValue,
    getMemberTeamScopeValue,
    getInvitePendingAccessValue,
    toTeamsAccessOption,
    buildTeamScopesPermissions,
    getEditableTeamScopeIds,
    requestAdminAccess,
  };
};

export type AccountPageState = ReturnType<typeof useAccountPageState>;
