import {
  Ban,
  MoreHorizontal,
  Send,
  ShieldPlus,
  UserRoundCog,
} from "lucide-react";
import Button from "../../../components/Button/Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../components/ui/DropdownMenu";
import { InvitePeopleForm } from "../../Controller/AccountFormSections";
import { useAccountPage } from "../AccountPageContext";
import { AccountPeoplePageSkeleton } from "../accountPageSkeletons";
import { cn } from "@/utils/cnHelper";
import { alternatingAdminListRowBg } from "../../../utils/listRowStripes";
import MemberAccessSheet from "../components/MemberAccessSheet";
import { formatMemberAccessLabel } from "../accountUtils";

const formatInviteUnit = (value: number, unit: string) =>
  `${value} ${unit}${value === 1 ? "" : "s"}`;

const formatInviteUntil = (expiresAt?: string) => {
  const remainingMs = new Date(expiresAt || 0).getTime() - Date.now();
  if (remainingMs <= 0) return "today";
  if (remainingMs < 86400000) {
    const remainingHours = Math.max(1, Math.ceil(remainingMs / 3600000));
    return `in ${formatInviteUnit(remainingHours, "hour")}`;
  }
  const today = new Date();
  const expiryDate = new Date(expiresAt || 0);
  const calendarDays = Math.max(
    1,
    Math.round(
      (new Date(
        expiryDate.getFullYear(),
        expiryDate.getMonth(),
        expiryDate.getDate(),
      ).getTime() -
        new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) /
        86400000,
    ),
  );
  if (calendarDays === 1) return "tomorrow";
  return `in ${formatInviteUnit(calendarDays, "day")}`;
};

const formatInviteAge = (expiresAt?: string) => {
  const elapsedDays = Math.max(
    1,
    Math.floor((Date.now() - new Date(expiresAt || 0).getTime()) / 86400000),
  );
  if (elapsedDays === 1) return "yesterday";
  return `${formatInviteUnit(elapsedDays, "day")} ago`;
};

const peopleTableHeaderBaseClassName =
  "hidden items-center gap-x-3 px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 md:grid";

const invitationTableHeaderClassName = cn(
  peopleTableHeaderBaseClassName,
  "md:grid-cols-[minmax(0,1fr)_minmax(8rem,12rem)_4.5rem] lg:grid-cols-[minmax(0,1fr)_minmax(8rem,12rem)_minmax(11rem,1fr)_4.5rem]",
);

const invitationTableRowClassName =
  "grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 md:grid-cols-[minmax(0,1fr)_minmax(8rem,12rem)_4.5rem] lg:grid-cols-[minmax(0,1fr)_minmax(8rem,12rem)_minmax(11rem,1fr)_4.5rem]";

const memberTableHeaderClassName = cn(
  peopleTableHeaderBaseClassName,
  "md:grid-cols-[minmax(0,1fr)_minmax(8rem,12rem)_4.5rem]",
);

const memberTableRowClassName =
  "grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 md:grid-cols-[minmax(0,1fr)_minmax(8rem,12rem)_4.5rem]";

const peopleOverflowButtonClassName =
  "h-10 w-10 shrink-0 items-center justify-center p-2";

const AccountPeoplePage = () => {
  const accountPage = useAccountPage();
  const {
    churchId,
    context,
    loading,
    refresh,
    sortedInvites,
    sortedMembers,
    destructiveConfirm,
    destructiveConfirmRunning,
    setDestructiveConfirm,
    openMemberAccessSheet,
    openInviteAccessSheet,
    resendInvite,
    resendingInviteId,
  } = accountPage;

  if (loading) {
    return <AccountPeoplePageSkeleton />;
  }

  return (
    <>
      <InvitePeopleForm churchId={churchId} onInvited={refresh} />

      <section className="rounded-xl border border-gray-700 bg-gray-950/50 p-4">
        <h3 className="text-lg font-semibold">Invitations</h3>
        <p className="mt-1 text-sm text-gray-400">
          Active invitations can be accepted until they expire. Resend an
          expired invitation to send a fresh working link.
        </p>
        <div className="mt-4 space-y-0">
          {sortedInvites.length > 0 && (
            <div className={invitationTableHeaderClassName}>
              <span className="justify-self-start">Invite</span>
              <span className="w-full text-left">Access</span>
              <span className="hidden justify-self-start lg:block">Status</span>
              <span className="w-full text-right">Actions</span>
            </div>
          )}
          {sortedInvites.length === 0 && (
            <p className="text-sm text-gray-300">No invitations yet.</p>
          )}
          {sortedInvites.map((invite, inviteIndex) => {
            const accessLabel =
              invite.role === "admin"
                ? "Admin"
                : formatMemberAccessLabel(invite.appAccess);
            const isExpired =
              invite.status === "expired" ||
              (invite.status === "pending" &&
                Boolean(invite.expiresAt) &&
                new Date(invite.expiresAt || 0).getTime() <= Date.now());
            const lifecycleLabel = isExpired
              ? `Expired ${formatInviteAge(invite.expiresAt)}`
              : `Pending · Expires ${formatInviteUntil(invite.expiresAt)}`;
            const isResending = resendingInviteId === invite.inviteId;
            const isRevokeInviteConfirming =
              destructiveConfirmRunning &&
              destructiveConfirm?.kind === "revokeInvite" &&
              destructiveConfirm.invite.inviteId === invite.inviteId;

            return (
              <div
                key={invite.inviteId}
                className={cn(
                  "px-2 py-1.5",
                  alternatingAdminListRowBg(inviteIndex),
                )}
              >
                <div className={invitationTableRowClassName}>
                  <div className="min-w-0">
                    <p className="min-w-0 truncate text-sm font-semibold">
                      {invite.email}
                    </p>
                    <p
                      className={cn(
                        "min-w-0 truncate text-xs lg:hidden",
                        isExpired ? "text-amber-300" : "text-gray-400",
                      )}
                    >
                      {lifecycleLabel}
                    </p>
                  </div>
                  <div className="hidden min-w-0 w-full pr-1 text-left md:block">
                    <p className="min-w-0 truncate text-sm text-gray-300">
                      {accessLabel}
                    </p>
                  </div>
                  <div className="hidden min-w-0 justify-self-start lg:block">
                    <span
                      className={cn(
                        "truncate text-xs",
                        isExpired ? "text-amber-300" : "text-gray-400",
                      )}
                    >
                      {lifecycleLabel}
                    </span>
                  </div>
                  <div className="flex w-full justify-end">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="tertiary"
                          svg={MoreHorizontal}
                          iconSize="sm"
                          aria-label={`Actions for invite to ${invite.email}`}
                          title="Invite actions"
                          className={peopleOverflowButtonClassName}
                          disabled={destructiveConfirmRunning || isResending}
                        />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => openInviteAccessSheet(invite)}
                        >
                          <UserRoundCog />
                          Edit access
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={isResending}
                          onSelect={() => void resendInvite(invite)}
                        >
                          <Send />
                          Resend invitation
                        </DropdownMenuItem>
                        {!isExpired ? (
                          <DropdownMenuItem
                            variant="destructive"
                            disabled={
                              destructiveConfirmRunning ||
                              isRevokeInviteConfirming
                            }
                            onSelect={() =>
                              setDestructiveConfirm({
                                kind: "revokeInvite",
                                invite,
                              })
                            }
                          >
                            <Ban />
                            Revoke invitation
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            variant="destructive"
                            disabled={destructiveConfirmRunning}
                            onSelect={() =>
                              setDestructiveConfirm({
                                kind: "removeExpiredInvite",
                                invite,
                              })
                            }
                          >
                            <Ban />
                            Remove expired invitation
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
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
        <div className="mt-4 space-y-0">
          {sortedMembers.length > 0 && (
            <div className={memberTableHeaderClassName}>
              <span className="justify-self-start">Member</span>
              <span className="w-full text-left">Access</span>
              <span className="w-full text-right">Actions</span>
            </div>
          )}
          {sortedMembers.length === 0 && (
            <p className="text-sm text-gray-300">No members yet.</p>
          )}
          {sortedMembers.map((member, memberIndex) => {
            const memberUser = member.user;
            const memberLabel =
              memberUser?.displayName ||
              memberUser?.primaryEmail ||
              memberUser?.email ||
              "Unknown user";
            const isSelf = memberUser?.uid === context?.userId;
            const isAdminMember = member.role === "admin";
            const targetUserId = memberUser?.uid || member.userId;
            return (
              <div
                key={member.membershipId}
                className={cn(
                  "px-2 py-1.5",
                  isSelf
                    ? "border border-cyan-500/35 bg-linear-to-r from-cyan-950/40 to-gray-950/55 shadow-[inset_3px_0_0_0] shadow-cyan-400/70"
                    : alternatingAdminListRowBg(memberIndex),
                )}
              >
                <div className={memberTableRowClassName}>
                  <div className="min-w-0">
                    <p className="flex min-w-0 items-center gap-2 truncate text-sm font-semibold">
                      <span className="min-w-0 truncate">{memberLabel}</span>
                      {isSelf && (
                        <span className="shrink-0 rounded-full border border-cyan-400/40 bg-cyan-500/15 px-2 py-0.5 text-xs font-medium text-cyan-200">
                          You
                        </span>
                      )}
                    </p>
                    <p
                      className={cn(
                        "min-w-0 truncate text-xs md:hidden",
                        isSelf ? "text-cyan-100/90" : "text-gray-400",
                      )}
                    >
                      {isAdminMember ? "Admin" : "Member"} ·{" "}
                      {formatMemberAccessLabel(member.appAccess)}
                    </p>
                    {memberUser?.primaryEmail || memberUser?.email ? (
                      <p className="min-w-0 truncate text-xs text-gray-400">
                        {memberUser.primaryEmail || memberUser.email}
                      </p>
                    ) : null}
                  </div>
                  <div className="hidden min-w-0 w-full pr-1 text-left md:block">
                    <p
                      className={cn(
                        "min-w-0 truncate text-sm",
                        isSelf ? "text-cyan-100/90" : "text-gray-300",
                      )}
                    >
                      {isAdminMember ? "Admin" : "Member"} |{" "}
                      {formatMemberAccessLabel(member.appAccess)}
                    </p>
                  </div>
                  <div className="flex w-full justify-end">
                    {!isSelf && targetUserId ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="tertiary"
                            svg={MoreHorizontal}
                            iconSize="sm"
                            aria-label={`Actions for ${memberLabel}`}
                            title="Member actions"
                            className={peopleOverflowButtonClassName}
                            disabled={destructiveConfirmRunning}
                          />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {!isAdminMember ? (
                            <>
                              <DropdownMenuItem
                                onSelect={() => openMemberAccessSheet(member)}
                              >
                                <UserRoundCog />
                                Edit access
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                disabled={destructiveConfirmRunning}
                                onSelect={() =>
                                  setDestructiveConfirm({
                                    kind: "makeAdmin",
                                    membershipId: member.membershipId,
                                    memberLabel,
                                    targetUserId,
                                  })
                                }
                              >
                                <ShieldPlus />
                                Make admin
                              </DropdownMenuItem>
                            </>
                          ) : (
                            <DropdownMenuItem
                              variant="destructive"
                              disabled={destructiveConfirmRunning}
                              onSelect={() =>
                                setDestructiveConfirm({
                                  kind: "removeAdmin",
                                  membershipId: member.membershipId,
                                  memberLabel,
                                  targetUserId,
                                })
                              }
                            >
                              <Ban />
                              Remove admin
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            variant="destructive"
                            disabled={destructiveConfirmRunning}
                            onSelect={() =>
                              setDestructiveConfirm({
                                kind: "removeMember",
                                membershipId: member.membershipId,
                                memberLabel,
                                targetUserId,
                              })
                            }
                          >
                            <Ban />
                            Remove member
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <MemberAccessSheet />
    </>
  );
};

export default AccountPeoplePage;
