import { useEffect, useRef, useState } from "react";
import Button from "../../../components/Button/Button";
import Select from "../../../components/Select/Select";
import type { TeamRosterMember } from "../../../api/authTypes";
import { scheduleMemberName } from "../teamsUtils";
import { MemberNameWithIndicator } from "../components/CurrentUserMemberIndicator";

export type ScheduleReplacementVacancy = {
  occurrenceId: string;
  cellKey: string;
  label: string;
  memberIds: string[];
};

const ScheduleReplacementInvitationForm = ({ vacancies, members, duplicateFirstNames, onPrepare }: {
  vacancies: ScheduleReplacementVacancy[];
  members: TeamRosterMember[];
  duplicateFirstNames: Set<string>;
  onPrepare: (vacancy: ScheduleReplacementVacancy, memberId: string) => Promise<void>;
}) => {
  const [vacancyKey, setVacancyKey] = useState("");
  const [memberId, setMemberId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const active = useRef(true);
  const preparing = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const keyFor = (item: ScheduleReplacementVacancy) => JSON.stringify([item.occurrenceId, item.cellKey]);
  const vacancy = vacancies.find((item) => keyFor(item) === vacancyKey);
  const candidates = members.filter((member) => vacancy?.memberIds.includes(member.memberId));
  const prepare = async () => {
    if (!vacancy || !candidates.some((member) => member.memberId === memberId) || preparing.current) return;
    preparing.current = true;
    setPending(true);
    setError("");
    try { await onPrepare(vacancy, memberId); }
    catch (caught) { if (active.current) setError(caught instanceof Error ? caught.message : "Could not prepare this invitation."); }
    finally { preparing.current = false; if (active.current) setPending(false); }
  };
  if (vacancies.length === 0) return null;
  return (
    <details className="mb-4 border-b border-gray-700 pb-4">
      <summary className="cursor-pointer text-sm text-gray-100">Invite a replacement by text message</summary>
      <div className="mt-3 space-y-3">
        <p className="text-xs text-gray-400">Review one invitation before sending. Assign the volunteer separately after they reply.</p>
        <Select label="Vacant or declined assignment" value={vacancyKey} disabled={pending}
          options={[{ value: "", label: "Choose an assignment" }, ...vacancies.map((item) => ({ value: keyFor(item), label: item.label }))]}
          onChange={(value) => { setVacancyKey(value); setMemberId(""); setError(""); }} />
        <Select label="Replacement volunteer" value={memberId} disabled={!vacancy || pending}
          options={[{ value: "", label: "Choose a volunteer" }, ...candidates.map((member) => {
            const name = scheduleMemberName(member, duplicateFirstNames);
            return {
              value: member.memberId,
              label: <MemberNameWithIndicator name={name} memberId={member.memberId} />,
              textValue: name,
            };
          })]}
          onChange={setMemberId} />
        {error ? <p role="alert" className="text-sm text-red-200">{error}</p> : null}
        <Button variant="secondary" disabled={pending || !candidates.some((member) => member.memberId === memberId)} isLoading={pending} onClick={() => void prepare()}>Review replacement text message</Button>
      </div>
    </details>
  );
};

export default ScheduleReplacementInvitationForm;
