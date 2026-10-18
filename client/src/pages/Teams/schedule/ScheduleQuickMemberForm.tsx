import { useEffect, useRef, useState } from "react";
import Button from "../../../components/Button/Button";
import Input from "../../../components/Input/Input";
import {
  AuthApiError,
  getTeamsBootstrap,
  searchTeamRosterCandidates,
  type TeamRosterCandidate,
} from "../../../api/auth";
import type { TeamRosterMember } from "../../../api/authTypes";
import {
  formatUsPhoneInput,
  normalizeUsPhoneNumberForComparison,
} from "../../../utils/phoneNumber";
import { splitTypedMemberName } from "./scheduleMemberPickerUtils";

export type ScheduleQuickMemberDraft = {
  firstName: string;
  lastName: string;
  phoneNumber?: string;
  email?: string;
};
export type ScheduleQuickMemberResult = {
  member: TeamRosterMember;
  assignmentError?: string;
};
export type ScheduleQuickMemberSubmit = (
  draft: ScheduleQuickMemberDraft,
  existingMemberId?: string,
) => Promise<ScheduleQuickMemberResult>;

type Props = {
  churchId: string;
  teamId: string;
  teamName: string;
  positionName: string;
  initialName: string;
  members: TeamRosterMember[];
  onSubmit: ScheduleQuickMemberSubmit;
  onCancel: () => void;
  onSuccess: () => void;
};

const ScheduleQuickMemberForm = ({
  churchId,
  teamId,
  teamName,
  positionName,
  initialName,
  members,
  onSubmit,
  onCancel,
  onSuccess,
}: Props) => {
  const [draft, setDraft] = useState(() => ({
    ...splitTypedMemberName(initialName),
    phoneNumber: "",
    email: "",
  }));
  const [lookup, setLookup] = useState<{
    query: string;
    candidates: TeamRosterCandidate[];
    error?: string;
  } | null>(null);
  const [lookupAttempt, setLookupAttempt] = useState(0);
  const [creationUncertain, setCreationUncertain] = useState(false);
  const [checkedRoster, setCheckedRoster] = useState<TeamRosterCandidate[]>([]);
  const [distinctName, setDistinctName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [savedMember, setSavedMember] = useState<TeamRosterCandidate | null>(
    null,
  );
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const nameQuery = `${draft.firstName.trim()} ${draft.lastName.trim()}`
    .trim()
    .toLocaleLowerCase();
  useEffect(() => {
    if (savedMember || nameQuery.length < 2) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void searchTeamRosterCandidates(churchId, teamId, nameQuery).then(
        ({ candidates }) => {
          if (active) setLookup({ query: nameQuery, candidates });
        },
        () => {
          if (active)
            setLookup({
              query: nameQuery,
              candidates: [],
              error:
                "Could not check for existing members. Try again before adding a new person.",
            });
        },
      );
    }, 300);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [churchId, teamId, nameQuery, savedMember, lookupAttempt]);
  const localMatches = [...members, ...checkedRoster].filter(
    (member) =>
      (!("archivedAt" in member) || !member.archivedAt) &&
      `${member.firstName} ${member.lastName}`
        .toLocaleLowerCase()
        .includes(nameQuery),
  );
  const matches =
    nameQuery.length >= 2
      ? [
          ...new Map(
            [
              ...localMatches,
              ...(lookup?.query === nameQuery ? lookup.candidates : []),
            ].map((member) => [member.memberId, member]),
          ).values(),
        ]
      : [];
  const checking = nameQuery.length >= 2 && lookup?.query !== nameQuery;
  const lookupError = lookup?.query === nameQuery ? lookup.error : "";
  const emailError =
    draft.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())
      ? "Enter a valid email address."
      : "";
  const phoneError =
    draft.phoneNumber.trim() &&
    !normalizeUsPhoneNumberForComparison(draft.phoneNumber)
      ? "Enter a valid 10-digit U.S. mobile number."
      : "";
  const canCreate = Boolean(
    draft.firstName.trim() &&
    draft.lastName.trim() &&
    !creationUncertain &&
    !emailError &&
    !phoneError &&
    !checking &&
    !lookupError &&
    (!matches.length || distinctName === nameQuery),
  );

  const submit = async (existingMemberId?: string) => {
    if (lock.current || (!savedMember && !existingMemberId && !canCreate))
      return;
    if (existingMemberId) {
      const chosen = matches.find(
        (member) => member.memberId === existingMemberId,
      );
      if (chosen) setSavedMember(chosen);
    }
    lock.current = true;
    setPending(true);
    setError("");
    try {
      const result = await onSubmit(
        {
          firstName: draft.firstName.trim(),
          lastName: draft.lastName.trim(),
          ...(draft.phoneNumber.trim()
            ? { phoneNumber: draft.phoneNumber.trim() }
            : {}),
          ...(draft.email.trim()
            ? { email: draft.email.trim().toLowerCase() }
            : {}),
        },
        savedMember?.memberId || existingMemberId,
      );
      if (!mounted.current) return;
      setSavedMember(result.member);
      if (result.assignmentError !== undefined) {
        setError(
          `Member saved. Could not confirm the schedule assignment. ${result.assignmentError} Retry the assignment below.`,
        );
      } else {
        onSuccess();
      }
    } catch (failure) {
      if (
        mounted.current &&
        !savedMember &&
        !existingMemberId &&
        failure instanceof AuthApiError &&
        (failure.isReachabilityError || (failure.status || 0) >= 500)
      ) {
        setCreationUncertain(true);
        setDistinctName("");
      }
      if (mounted.current)
        setError(
          failure instanceof Error
            ? failure.message
            : "Could not add this member. Try again.",
        );
    } finally {
      lock.current = false;
      if (mounted.current) setPending(false);
    }
  };

  // A lost response can follow a committed create. Refresh the authorized roster
  // before allowing another create; candidate search excludes people on this team.
  const checkRoster = async () => {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    try {
      const response = await getTeamsBootstrap(churchId);
      if (!mounted.current) return;
      if (response.truncated)
        throw new Error(
          "The roster is incomplete. Review Members before adding this person again.",
        );
      setCheckedRoster(
        response.members
          .filter((member) => !member.archivedAt)
          .map(({ memberId, firstName, lastName }) => ({
            memberId,
            firstName,
            lastName,
          })),
      );
      setLookup(null);
      setLookupAttempt((attempt) => attempt + 1);
      setCreationUncertain(false);
      setError("");
    } catch (failure) {
      if (mounted.current)
        setError(
          failure instanceof Error
            ? failure.message
            : "Could not refresh the roster. Try again.",
        );
    } finally {
      lock.current = false;
      if (mounted.current) setPending(false);
    }
  };

  return (
    <form
      className="space-y-3 p-3 text-gray-100"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <p className="text-sm font-semibold">Add new member</p>
      <p className="text-xs text-gray-300">
        Team: {teamName}
        <br />
        Position: {positionName}
      </p>
      {savedMember ? (
        <p className="text-sm">
          {savedMember.firstName} {savedMember.lastName} is saved in the roster.
        </p>
      ) : (
        <>
          <Input
            autoFocus
            required
            label="First name"
            labelStyle="compactLight"
            autoComplete="given-name"
            value={draft.firstName}
            disabled={pending}
            onChange={(value) => {
              setDraft((previous) => ({
                ...previous,
                firstName: String(value),
              }));
              setDistinctName("");
            }}
          />
          <Input
            required
            label="Last name"
            labelStyle="compactLight"
            autoComplete="family-name"
            value={draft.lastName}
            disabled={pending}
            onChange={(value) => {
              setDraft((previous) => ({
                ...previous,
                lastName: String(value),
              }));
              setDistinctName("");
            }}
          />
          <Input
            label="Mobile phone (optional)"
            labelStyle="compactLight"
            type="tel"
            autoComplete="tel"
            value={draft.phoneNumber}
            errorText={phoneError}
            disabled={pending}
            onChange={(value) =>
              setDraft((previous) => ({
                ...previous,
                phoneNumber: formatUsPhoneInput(String(value)),
              }))
            }
          />
          <Input
            label="Email (optional)"
            labelStyle="compactLight"
            type="email"
            autoComplete="email"
            value={draft.email}
            errorText={emailError}
            disabled={pending}
            onChange={(value) =>
              setDraft((previous) => ({ ...previous, email: String(value) }))
            }
          />
          {checking ? (
            <p role="status" className="text-xs text-gray-300">
              Checking for existing members...
            </p>
          ) : null}
          {lookupError ? (
            <div role="alert" className="text-xs text-amber-200">
              {lookupError}{" "}
              <Button
                type="button"
                variant="tertiary"
                onClick={() => {
                  setLookup(null);
                  setLookupAttempt((attempt) => attempt + 1);
                }}
              >
                Try again
              </Button>
            </div>
          ) : null}
          {matches.length ? (
            <div className="space-y-2 border-t border-gray-700 pt-2">
              <p className="text-xs text-amber-200">
                Possible existing members
              </p>
              {matches.map((member) => (
                <Button
                  key={member.memberId}
                  type="button"
                  variant="secondary"
                  className="w-full justify-start whitespace-normal text-left"
                  disabled={pending}
                  onClick={() => void submit(member.memberId)}
                >
                  Use {member.firstName} {member.lastName}
                </Button>
              ))}
              <label className="flex items-start gap-2 text-xs text-gray-200">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={distinctName === nameQuery}
                  disabled={pending}
                  onChange={(event) =>
                    setDistinctName(event.target.checked ? nameQuery : "")
                  }
                />
                This is a different person. Create a new member.
              </label>
            </div>
          ) : null}
        </>
      )}
      {creationUncertain ? (
        <div className="space-y-1 text-xs text-amber-200">
          <p>
            Creation could not be confirmed. Check the roster before adding this
            person again.
          </p>
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            isLoading={pending}
            onClick={() => void checkRoster()}
          >
            Check roster
          </Button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-rose-200">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="tertiary"
          disabled={pending}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={pending || (!savedMember && !canCreate)}
          isLoading={pending}
        >
          {savedMember ? "Retry assignment" : "Add & assign"}
        </Button>
      </div>
    </form>
  );
};

export default ScheduleQuickMemberForm;
