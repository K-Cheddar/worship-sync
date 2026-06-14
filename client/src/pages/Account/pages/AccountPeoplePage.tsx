import { useState } from "react";
import { Ban, UserRoundCog } from "lucide-react";
import Button from "../../../components/Button/Button";
import { InvitePeopleForm } from "../../Controller/AccountFormSections";
import { useAccountPage } from "../AccountPageContext";
import { AccountPeoplePageSkeleton } from "../accountPageSkeletons";
import type { Member } from "../accountTypes";
import { cn } from "@/utils/cnHelper";
import { alternatingAdminListRowBg } from "../../../utils/listRowStripes";
import MemberAccessSheet from "../components/MemberAccessSheet";
import { formatMemberTeamsAccessSummary } from "../accountTeamsAccess";

const AccountPeoplePage = () => {
  const accountPage = useAccountPage();
  const {
    churchId,
    context,
    loading,
    refresh,
    sortedInvites,
    sortedMembers,
    teams,
    destructiveConfirm,
    destructiveConfirmRunning,
    setDestructiveConfirm,
    toTeamsAccessOption,
    getEditableTeamScopeIds,
  } = accountPage;
  const [accessSheetMember, setAccessSheetMember] = useState<Member | null>(null);

  if (loading) {
    return <AccountPeoplePageSkeleton />;
  }

  return (
    <>
      <InvitePeopleForm churchId={churchId} onInvited={refresh} />

      <section className="rounded-xl border border-gray-700 bg-gray-950/50 p-4">
        <h3 className="text-lg font-semibold">Pending invites</h3>
        <p className="mt-1 text-sm text-gray-400">
          Waiting to be accepted. Unused invites expire on their own. You can
          revoke an invite if the link should stop working.
        </p>
        <div className="mt-4 space-y-2">
          {sortedInvites.length === 0 && (
            <p className="text-sm text-gray-300">No pending invites yet.</p>
          )}
          {sortedInvites.map((invite, inviteIndex) => {
            const accessLabel =
              invite.role === "admin" ? "Admin" : invite.appAccess;
            const teamsAccessSummary = formatMemberTeamsAccessSummary(
              toTeamsAccessOption(invite.permissions, invite.role),
              getEditableTeamScopeIds(invite.permissions),
              teams,
            );
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
                  alternatingAdminListRowBg(inviteIndex),
                )}
              >
                <div className="min-w-0">
                  <p className="font-semibold">{invite.email}</p>
                  <p className="text-sm text-gray-300">
                    {accessLabel} | Teams: {teamsAccessSummary} | Sent {createdLabel}
                  </p>
                  <p className="text-sm text-gray-400">Expires {expiresLabel}</p>
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

      <section className="rounded-xl border border-gray-700 bg-gray-950/50 p-4">
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
            const memberEmail = memberUser?.primaryEmail || memberUser?.email || "";
            const memberLabel = memberUser?.displayName || memberEmail || "Unknown user";
            const isSelf = memberUser?.uid === context?.userId;
            const isAdminMember = member.role === "admin";
            const targetUserId = memberUser?.uid || member.userId;
            const currentTeamsAccess = toTeamsAccessOption(
              member.permissions,
              member.role,
            );
            const currentTeamScopeIds = getEditableTeamScopeIds(member.permissions);
            const teamsAccessSummary = formatMemberTeamsAccessSummary(
              currentTeamsAccess,
              currentTeamScopeIds,
              teams,
            );

            return (
              <div
                key={member.membershipId}
                className={cn(
                  "rounded-lg px-3 py-2.5 sm:py-3",
                  isSelf
                    ? "border border-cyan-500/35 bg-linear-to-r from-cyan-950/40 to-gray-950/55 shadow-[inset_3px_0_0_0] shadow-cyan-400/70"
                    : alternatingAdminListRowBg(memberIndex),
                )}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
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
                        isSelf ? "text-cyan-100/90" : "text-gray-300",
                      )}
                    >
                      {isAdminMember ? "Admin" : "Member"} | {member.appAccess}
                    </p>
                    <p
                      className={cn(
                        "text-sm",
                        isSelf ? "text-cyan-100/80" : "text-gray-400",
                      )}
                    >
                      Teams: {teamsAccessSummary}
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
                      {!isAdminMember && targetUserId ? (
                        <Button
                          type="button"
                          variant="tertiary"
                          svg={UserRoundCog}
                          iconSize="sm"
                          aria-label={`Edit access for ${memberLabel}`}
                          onClick={() => setAccessSheetMember(member)}
                        >
                          Edit access
                        </Button>
                      ) : null}
                      {isAdminMember && targetUserId ? (
                        <Button
                          variant="destructive"
                          svg={Ban}
                          iconSize="sm"
                          isLoading={
                            destructiveConfirmRunning &&
                            destructiveConfirm?.kind === "removeAdmin" &&
                            destructiveConfirm.membershipId === member.membershipId
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
                      ) : null}
                      {targetUserId ? (
                        <Button
                          variant="destructive"
                          svg={Ban}
                          iconSize="sm"
                          isLoading={
                            destructiveConfirmRunning &&
                            destructiveConfirm?.kind === "removeMember" &&
                            destructiveConfirm.membershipId === member.membershipId
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
                      ) : null}
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

      <MemberAccessSheet
        member={accessSheetMember}
        isOpen={accessSheetMember !== null}
        onClose={() => setAccessSheetMember(null)}
      />
    </>
  );
};

export default AccountPeoplePage;
