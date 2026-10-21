import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import Button from "../../../components/Button/Button";
import Input from "../../../components/Input/Input";
import Select from "../../../components/Select/Select";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../../../components/ui/DropdownMenu";
import type { TeamIntakeRecipient, TeamRecord } from "../../../api/authTypes";
import type { AvailabilityProgressRow } from "../availabilityFormProgress";
import { memberName } from "../teamsUtils";
import { MemberNameWithIndicator } from "./CurrentUserMemberIndicator";

type Props = {
  rows: AvailabilityProgressRow[];
  teams: TeamRecord[];
  canEdit: boolean;
  busy: boolean;
  historyLoaded: boolean;
  onCreateLink: (memberId: string) => void;
  onCopyLink: (recipient: TeamIntakeRecipient) => void;
  onOpenLink: (recipient: TeamIntakeRecipient) => void;
  onRevoke: (recipient: TeamIntakeRecipient) => void;
  onHistory: (memberId: string) => void;
};

const AvailabilityRecipientsTab = ({
  rows,
  teams,
  canEdit,
  busy,
  historyLoaded,
  onCreateLink,
  onCopyLink,
  onOpenLink,
  onRevoke,
  onHistory,
}: Props) => {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [teamId, setTeamId] = useState("");
  const visible = rows.filter(
    (row) =>
      memberName(row.member)
        .toLowerCase()
        .includes(search.trim().toLowerCase()) &&
      (!status || row.status === status) &&
      (!teamId || row.memberTeamIds.has(teamId)),
  );
  const responded = rows.filter((row) => row.status === "Responded").length;
  return (
    <section
      className="space-y-4"
      aria-label="Recipient progress"
      aria-busy={!historyLoaded}
    >
      <p className="text-sm text-gray-300" aria-live="polite">
        Responded: {responded} of {rows.length}
        {historyLoaded
          ? ` · Awaiting responses: ${rows.filter((row) => row.status === "Awaiting response").length} · Not yet invited: ${rows.filter((row) => ["Not requested", "Revoked"].includes(row.status)).length}`
          : " · Checking request history…"}
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Input
          label="Search members"
          value={search}
          onChange={(value) => setSearch(String(value))}
          placeholder="Search by name"
        />
        <Select
          label="Request status"
          value={status}
          onChange={setStatus}
          options={[
            { value: "", label: "All statuses" },
            ...[
              "Responded",
              "Awaiting response",
              "Not requested",
              "Revoked",
            ].map((value) => ({ value, label: value })),
          ]}
        />
        <Select
          label="Team"
          value={teamId}
          onChange={setTeamId}
          options={[
            { value: "", label: "All teams" },
            ...teams
              .filter((team) => !team.archivedAt)
              .map((team) => ({ value: team.teamId, label: team.name })),
          ]}
        />
      </div>
      <div className="divide-y divide-gray-800">
        <div
          className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_3rem] gap-3 py-2 text-xs text-gray-400 sm:grid"
          aria-hidden
        >
          <span>Member</span>
          <span>Request status</span>
          <span>Delivery</span>
          <span>Actions</span>
        </div>
        {visible.map(
          ({ member, recipient, status: requestStatus, delivery }) => (
            <div
              key={member.memberId}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_3rem]"
            >
              <MemberNameWithIndicator
                name={memberName(member)}
                memberId={member.memberId}
                className="font-medium text-white"
              />
              <span className="col-start-1 text-gray-300 sm:col-auto">
                {historyLoaded ||
                ["Responded", "Revoked"].includes(requestStatus)
                  ? requestStatus
                  : "Checking history…"}
              </span>
              <span className="col-start-1 text-xs text-gray-400 sm:col-auto sm:text-sm">
                {historyLoaded ? delivery : "Checking delivery…"}
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="tertiary"
                    svg={MoreHorizontal}
                    aria-label={`Actions for ${memberName(member)}`}
                    disabled={busy}
                    className="col-start-2 row-start-1 row-span-3 sm:col-auto sm:row-auto sm:row-span-1"
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {canEdit && recipient && !recipient.revokedAt ? (
                    <>
                      <DropdownMenuItem onSelect={() => onCopyLink(recipient)}>
                        Copy personal availability link
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => onOpenLink(recipient)}>
                        Open personal form
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => onRevoke(recipient)}
                      >
                        Revoke request
                      </DropdownMenuItem>
                    </>
                  ) : null}
                  {canEdit && (!recipient || recipient.revokedAt) ? (
                    <DropdownMenuItem
                      onSelect={() => onCreateLink(member.memberId)}
                    >
                      {recipient?.revokedAt
                        ? "Create new personal link"
                        : "Create personal link"}
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem onSelect={() => onHistory(member.memberId)}>
                    View request and delivery history
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ),
        )}
        {!visible.length ? (
          <p className="py-6 text-sm text-gray-400">
            No volunteers match these filters.
          </p>
        ) : null}
      </div>
      {busy ? (
        <p role="status" className="text-sm text-gray-300">
          Updating personal link…
        </p>
      ) : null}
    </section>
  );
};

export default AvailabilityRecipientsTab;
