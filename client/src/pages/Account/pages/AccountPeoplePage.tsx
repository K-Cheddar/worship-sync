import {
  Ban,
  Info,
  MoreHorizontal,
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../../components/ui/Popover";
import { InvitePeopleForm } from "../../Controller/AccountFormSections";
import { useAccountPage } from "../AccountPageContext";
import { AccountPeoplePageSkeleton } from "../accountPageSkeletons";
import { cn } from "@/utils/cnHelper";
import { alternatingAdminListRowBg } from "../../../utils/listRowStripes";
import MemberAccessSheet from "../components/MemberAccessSheet";
import { formatMemberTeamsAccessSummary } from "../accountTeamsAccess";
import { formatMemberServicesAccessSummary } from "../accountServicesAccess";
import { formatMemberAccessLabel } from "../accountUtils";

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
    openMemberAccessSheet,
    openInviteAccessSheet,
  } = accountPage;

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
          edit access or revoke an invite if the link should stop working.
        </p>
        <div className="mt-4 space-y-0">
          {sortedInvites.length > 0 && (
            <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] items-center gap-x-2 px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 sm:grid sm:grid-cols-[minmax(12rem,14rem)_minmax(10rem,12rem)_auto_1fr] sm:gap-x-3">
              <span className="justify-self-start">Invite</span>
              <span className="justify-self-start">Access</span>
              <span className="justify-self-start">Info</span>
              <span className="justify-self-end text-right">Actions</span>
            </div>
          )}
          {sortedInvites.length === 0 && (
            <p className="text-sm text-gray-300">No pending invites yet.</p>
          )}
          {sortedInvites.map((invite, inviteIndex) => {
            const accessLabel =
              invite.role === "admin"
                ? "Admin"
                : formatMemberAccessLabel(invite.appAccess);
            const teamsAccessSummary = formatMemberTeamsAccessSummary(
              toTeamsAccessOption(invite.permissions, invite.role),
              getEditableTeamScopeIds(invite.permissions),
              teams,
            );
            const servicesAccessSummary = formatMemberServicesAccessSummary(
              invite.permissions,
              invite.role,
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
                  "grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] items-center gap-x-2 px-2 py-1 sm:grid-cols-[minmax(12rem,14rem)_minmax(10rem,12rem)_auto_1fr] sm:gap-x-3",
                  alternatingAdminListRowBg(inviteIndex),
                )}
              >
                <p className="min-w-0 justify-self-start truncate text-sm font-semibold">
                  {invite.email}
                </p>
                <div className="min-w-0 pr-1 max-md:max-w-[8rem] justify-self-start text-left">
                  <p className="min-w-0 truncate text-sm text-gray-300">
                    {accessLabel}
                  </p>
                </div>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="tertiary"
                      svg={Info}
                      iconSize="sm"
                      aria-label={`Show details for invite to ${invite.email}`}
                      title="Show invite details"
                      className="min-h-0 min-w-0 shrink-0 p-1 max-md:min-h-0"
                    />
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    className="w-[min(24rem,calc(100vw-2rem))] border-gray-700 bg-gray-900 text-sm text-gray-200"
                  >
                    <p className="font-semibold text-white">Invite details</p>
                    <dl className="mt-2 space-y-1">
                      <div>
                        <dt className="inline text-gray-400">Access: </dt>
                        <dd className="inline">{accessLabel}</dd>
                      </div>
                      <div>
                        <dt className="inline text-gray-400">Teams: </dt>
                        <dd className="inline">{teamsAccessSummary}</dd>
                      </div>
                      <div>
                        <dt className="inline text-gray-400">Services: </dt>
                        <dd className="inline">{servicesAccessSummary}</dd>
                      </div>
                      <div>
                        <dt className="inline text-gray-400">Sent: </dt>
                        <dd className="inline">{createdLabel}</dd>
                      </div>
                      <div>
                        <dt className="inline text-gray-400">Expires: </dt>
                        <dd className="inline">{expiresLabel}</dd>
                      </div>
                    </dl>
                  </PopoverContent>
                </Popover>
                <div className="flex justify-self-end">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="tertiary"
                        svg={MoreHorizontal}
                        iconSize="sm"
                        aria-label={`Actions for invite to ${invite.email}`}
                        title="Invite actions"
                        className="min-h-0 min-w-0 shrink-0 p-1 max-md:min-h-0"
                        disabled={destructiveConfirmRunning}
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
                        variant="destructive"
                        disabled={
                          destructiveConfirmRunning || isRevokeInviteConfirming
                        }
                        onSelect={() =>
                          setDestructiveConfirm({
                            kind: "revokeInvite",
                            invite,
                          })
                        }
                      >
                        <Ban />
                        Revoke invite
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
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
            <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] items-center gap-x-2 px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 sm:grid sm:grid-cols-[minmax(12rem,14rem)_minmax(10rem,12rem)_auto_1fr] sm:gap-x-3">
              <span className="justify-self-start">Member</span>
              <span className="justify-self-start">Access</span>
              <span className="justify-self-start">Info</span>
              <span className="justify-self-end text-right">Actions</span>
            </div>
          )}
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
            const currentTeamsAccess = toTeamsAccessOption(
              member.permissions,
              member.role,
            );
            const currentTeamScopeIds = getEditableTeamScopeIds(
              member.permissions,
            );
            const teamsAccessSummary = formatMemberTeamsAccessSummary(
              currentTeamsAccess,
              currentTeamScopeIds,
              teams,
            );
            const servicesAccessSummary = formatMemberServicesAccessSummary(
              member.permissions,
              member.role,
            );

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
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] items-center gap-x-2 sm:grid-cols-[minmax(12rem,14rem)_minmax(10rem,12rem)_auto_1fr] sm:gap-x-3">
                  <p className="flex min-w-0 items-center gap-2 justify-self-start truncate text-sm font-semibold">
                    <span className="truncate">{memberLabel}</span>
                    {isSelf && (
                      <span className="shrink-0 rounded-full border border-cyan-400/40 bg-cyan-500/15 px-2 py-0.5 text-xs font-medium text-cyan-200">
                        You
                      </span>
                    )}
                  </p>
                  <div className="min-w-0 pr-1 max-md:max-w-[8rem] justify-self-start text-left">
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
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="tertiary"
                        svg={Info}
                        iconSize="sm"
                        aria-label={`Show details for ${memberLabel}`}
                        title="Show member details"
                        className="min-h-0 min-w-0 shrink-0 p-1 max-md:min-h-0"
                      />
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      className="w-[min(24rem,calc(100vw-2rem))] border-gray-700 bg-gray-900 text-sm text-gray-200"
                    >
                      <p className="font-semibold text-white">Member details</p>
                      <dl className="mt-2 space-y-1">
                        <div>
                          <dt className="inline text-gray-400">Access: </dt>
                          <dd className="inline">
                            {isAdminMember ? "Admin" : "Member"} |{" "}
                            {formatMemberAccessLabel(member.appAccess)}
                          </dd>
                        </div>
                        <div>
                          <dt className="inline text-gray-400">Teams: </dt>
                          <dd className="inline">{teamsAccessSummary}</dd>
                        </div>
                        <div>
                          <dt className="inline text-gray-400">Services: </dt>
                          <dd className="inline">{servicesAccessSummary}</dd>
                        </div>
                        {memberEmail ? (
                          <div>
                            <dt className="inline text-gray-400">Email: </dt>
                            <dd className="inline break-all">{memberEmail}</dd>
                          </div>
                        ) : null}
                        {Array.isArray(memberUser?.linkedMethods) &&
                        memberUser.linkedMethods.length > 0 ? (
                          <div>
                            <dt className="inline text-gray-400">
                              Sign-in methods:{" "}
                            </dt>
                            <dd className="inline">
                              {memberUser.linkedMethods.join(", ")}
                            </dd>
                          </div>
                        ) : null}
                      </dl>
                      {isAdminMember && !isSelf ? (
                        <p className="mt-2 text-xs text-gray-400">
                          Admins keep full access while they are admins.
                        </p>
                      ) : null}
                      {isSelf ? (
                        <p className="mt-2 text-xs text-cyan-200/75">
                          You can’t edit or remove your own membership here.
                        </p>
                      ) : null}
                    </PopoverContent>
                  </Popover>
                  <div className="flex justify-self-end">
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
                            className="min-h-0 min-w-0 shrink-0 p-1 max-md:min-h-0"
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
