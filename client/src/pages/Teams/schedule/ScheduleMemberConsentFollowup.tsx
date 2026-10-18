import { useEffect, useState } from "react";
import { getTeamsBootstrap } from "../../../api/auth";
import type { TeamRosterMember } from "../../../api/authTypes";
import Button from "../../../components/Button/Button";
import RecordSmsConsentModal from "../managers/RecordSmsConsentModal";
import { normalizeUsPhoneNumberForComparison } from "../../../utils/phoneNumber";

type Props = {
  churchId: string;
  member: TeamRosterMember;
  onClose: () => void;
};

const ScheduleMemberConsentFollowup = ({
  churchId,
  member,
  onClose,
}: Props) => {
  const [status, setStatus] = useState("checking");
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let active = true;
    void getTeamsBootstrap(churchId).then(
      (response) => {
        if (!active) return;
        const eligibility =
          response.smsEligibilityByMemberId?.[member.memberId];
        const phone = normalizeUsPhoneNumberForComparison(member.phoneNumber);
        if (
          !eligibility ||
          !phone ||
          normalizeUsPhoneNumberForComparison(eligibility.phoneNumber) !== phone
        ) {
          setStatus("unavailable");
          return;
        }
        setStatus(eligibility.status);
      },
      () => {
        if (active) setStatus("error");
      },
    );
    return () => {
      active = false;
    };
  }, [churchId, member.memberId, member.phoneNumber, attempt]);
  return (
    <div className="flex flex-wrap items-center gap-2 px-2 py-1 text-xs text-gray-200">
      <span>
        {member.firstName} {member.lastName} was added.
      </span>
      {status === "checking" ? (
        <span role="status">Checking text message status...</span>
      ) : null}
      {status === "consent_needed" ? (
        <Button variant="tertiary" onClick={() => setOpen(true)}>
          Record text message consent
        </Button>
      ) : null}
      {status === "error" ? (
        <>
          <span>Could not check text message status.</span>
          <Button
            variant="tertiary"
            onClick={() => {
              setStatus("checking");
              setAttempt((value) => value + 1);
            }}
          >
            Try again
          </Button>
        </>
      ) : null}
      <Button variant="tertiary" onClick={onClose}>
        Dismiss
      </Button>
      {open ? (
        <RecordSmsConsentModal
          churchId={churchId}
          member={member}
          onClose={() => {
            setOpen(false);
            onClose();
          }}
          onSaved={onClose}
        />
      ) : null}
    </div>
  );
};

export default ScheduleMemberConsentFollowup;
