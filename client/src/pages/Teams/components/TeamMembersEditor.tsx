import { useId, useState } from "react";
import { MoreHorizontal, Plus, Trash2, UserPlus } from "lucide-react";
import Button from "../../../components/Button/Button";
import Input from "../../../components/Input/Input";
import MemberAvatar from "../../../components/MemberAvatar/MemberAvatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../components/ui/DropdownMenu";
import type { TeamRosterMember } from "../../../api/authTypes";
import { memberName } from "../teamsUtils";
import {
  MemberNameWithIndicator,
  useCurrentMemberId,
} from "./CurrentUserMemberIndicator";

export type TeamMemberSuggestion = Pick<
  TeamRosterMember,
  "memberId" | "firstName" | "lastName"
> & Partial<Pick<TeamRosterMember, "title" | "profileImageUrl" | "archivedAt">>;

type TeamMembersEditorProps = {
  memberIds: string[];
  members: TeamRosterMember[];
  suggestions: TeamMemberSuggestion[];
  searchMode: "local" | "scoped";
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  canEditMembership: boolean;
  isSearching?: boolean;
  isAdding?: boolean;
  hasMoreSuggestions?: boolean;
  addingMemberId?: string | null;
  searchError?: string;
  onRetrySearch?: () => void;
  onAddMember: (memberId: string) => void;
  onRemoveMember: (memberId: string) => void;
  onManageMember?: (member: TeamRosterMember) => void;
  onCreateMember?: () => void;
};

const VISIBLE_MEMBER_LIMIT = 8;
const VISIBLE_SUGGESTION_LIMIT = 20;

const TeamMembersEditor = ({
  memberIds,
  members,
  suggestions,
  searchMode,
  searchQuery,
  onSearchQueryChange,
  canEditMembership,
  isSearching = false,
  isAdding = false,
  hasMoreSuggestions = false,
  addingMemberId = null,
  searchError = "",
  onRetrySearch,
  onAddMember,
  onRemoveMember,
  onManageMember,
  onCreateMember,
}: TeamMembersEditorProps) => {
  const selfMemberId = useCurrentMemberId();
  const headingId = useId();
  const suggestionsId = useId();
  const [showAllMembers, setShowAllMembers] = useState(false);
  const uniqueMemberIds = [...new Set(memberIds)];
  const assignedIds = new Set(uniqueMemberIds);
  const membersById = new Map(members.map((member) => [member.memberId, member]));

  const assignedMembers = uniqueMemberIds
    .map((memberId) => {
      const member = membersById.get(memberId);
      return {
        memberId,
        member,
        name: member ? memberName(member) : "Member details unavailable",
      };
    })
    .sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" }) ||
      left.memberId.localeCompare(right.memberId),
    );

  const localQuery = searchQuery.trim().toLocaleLowerCase();
  const localSuggestions = searchMode === "local" && localQuery
    ? members.filter((member) =>
      !member.archivedAt &&
      !assignedIds.has(member.memberId) &&
      memberName(member).toLocaleLowerCase().includes(localQuery),
    )
    : [];

  const visibleSuggestions = (searchMode === "local" ? localSuggestions : suggestions)
    .filter((member) => !member.archivedAt && !assignedIds.has(member.memberId))
    .filter((member, index, all) =>
      all.findIndex((candidate) => candidate.memberId === member.memberId) === index,
    )
    .sort((left, right) =>
      memberName(left).localeCompare(memberName(right), undefined, { sensitivity: "base" }) ||
      left.memberId.localeCompare(right.memberId),
    );
  const renderedSuggestions = visibleSuggestions.slice(0, VISIBLE_SUGGESTION_LIMIT);

  const queryLength = searchQuery.trim().length;
  const minimumQueryLength = searchMode === "scoped" ? 2 : 1;
  const visibleAssignedMembers = showAllMembers
    ? assignedMembers
    : assignedMembers.slice(0, VISIBLE_MEMBER_LIMIT);

  return (
    <section aria-labelledby={headingId} className="min-w-0 space-y-3">
      <h3 id={headingId} className="text-sm font-semibold text-gray-100">
        Members <span className="font-normal text-gray-400">· {uniqueMemberIds.length}</span>
      </h3>

      <div className="space-y-1.5">
        <h4 className="text-sm font-medium text-gray-200">On this team</h4>
        {assignedMembers.length === 0 ? (
          <p className="py-1 text-sm text-gray-400">No members on this team yet.</p>
        ) : (
          <ul aria-label="Members on this team" className="min-w-0 space-y-1">
            {visibleAssignedMembers.map(({ memberId, member, name }) => (
              <li key={memberId} className="flex min-w-0 items-center justify-between gap-2 py-1">
                <span className="flex min-w-0 items-center gap-2.5">
                  <MemberAvatar
                    profileImageUrl={member?.profileImageUrl}
                    memberName={member ? name : ""}
                    className="h-8 w-8"
                  />
                  <MemberNameWithIndicator
                    name={name}
                    memberId={member?.memberId}
                    className="flex-1"
                    nameClassName="text-sm text-gray-200"
                  />
                </span>
                {canEditMembership ? (
                  <span className="flex shrink-0 items-center gap-1">
                    {member && onManageMember ? (
                      <Button
                        type="button"
                        variant="secondary"
                        iconSize="sm"
                        className="min-h-9 max-md:min-h-11"
                        aria-label={`Manage ${name}${memberId === selfMemberId ? ", You" : ""}`}
                        onClick={() => onManageMember(member)}
                      >
                        Manage
                      </Button>
                    ) : null}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="tertiary"
                          svg={MoreHorizontal}
                          iconSize="sm"
                          padding="p-2"
                          className="min-h-9 min-w-9 max-md:min-h-11 max-md:min-w-11"
                          aria-label={`Actions for ${name}${memberId === selfMemberId ? ", You" : ""}`}
                        />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => onRemoveMember(memberId)}
                        >
                          <Trash2 aria-hidden />
                          Remove from team
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {assignedMembers.length > VISIBLE_MEMBER_LIMIT ? (
          <Button
            type="button"
            variant="textLink"
            className="min-h-9 max-md:min-h-11"
            aria-expanded={showAllMembers}
            onClick={() => setShowAllMembers((current) => !current)}
          >
            {showAllMembers ? "Show fewer" : `Show all ${assignedMembers.length} members`}
          </Button>
        ) : null}
      </div>

      {canEditMembership ? (
        <div className="min-w-0 space-y-2">
          <Input
            label="Add members"
            placeholder="Search members to add..."
            value={searchQuery}
            onChange={(value) => onSearchQueryChange(String(value))}
            aria-controls={suggestionsId}
            aria-autocomplete="list"
            className="scroll-mb-28"
            inputClassName="max-md:min-h-11"
          />
          {isAdding ? <p role="status" className="text-sm text-gray-300">Adding member...</p> : null}
          {searchMode === "scoped" && queryLength > 0 && queryLength < minimumQueryLength ? (
            <p className="text-sm text-gray-400">Enter at least 2 characters to search.</p>
          ) : null}
          {isSearching ? <p role="status" className="text-sm text-gray-300">Searching members...</p> : null}
          {searchError ? (
            <div className="flex flex-wrap items-center gap-2">
              <p role="alert" className="text-sm text-red-300">{searchError}</p>
              {onRetrySearch ? (
                <Button type="button" variant="tertiary" className="min-h-9 max-md:min-h-11" onClick={onRetrySearch}>
                  Try again
                </Button>
              ) : null}
            </div>
          ) : null}
          <ul
            id={suggestionsId}
            aria-label="Matching members to add"
            className="min-w-0 space-y-1"
          >
            {renderedSuggestions.map((candidate) => {
              const name = memberName(candidate);
              return (
                <li key={candidate.memberId} className="flex min-w-0 items-center justify-between gap-2 py-1">
                  <span className="flex min-w-0 items-center gap-2.5">
                    <MemberAvatar profileImageUrl={candidate.profileImageUrl} memberName={name} />
                    <MemberNameWithIndicator
                      name={name}
                      memberId={candidate.memberId}
                      className="flex-1"
                      nameClassName="text-sm text-gray-200"
                    />
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    svg={Plus}
                    iconSize="sm"
                    className="min-h-9 max-md:min-h-11"
                    aria-label={`Add ${name} to team${candidate.memberId === selfMemberId ? ", You" : ""}`}
                    disabled={isAdding}
                    isLoading={addingMemberId === candidate.memberId}
                    onClick={() => onAddMember(candidate.memberId)}
                  >
                    Add
                  </Button>
                </li>
              );
            })}
          </ul>
          {queryLength >= minimumQueryLength && !isSearching && !searchError && visibleSuggestions.length === 0 ? (
            <p role="status" className="text-sm text-gray-400">No matching members found.</p>
          ) : null}
          {hasMoreSuggestions || visibleSuggestions.length > VISIBLE_SUGGESTION_LIMIT ? (
            <p className="text-sm text-gray-400">Showing the first 20 matches. Refine your search to narrow the list.</p>
          ) : null}
          {onCreateMember ? (
            <Button type="button" variant="tertiary" svg={UserPlus} className="min-h-9 max-md:min-h-11" onClick={onCreateMember}>
              Create new member
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
};

export default TeamMembersEditor;
