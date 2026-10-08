import { useState } from "react";
import Button from "../../../components/Button/Button";
import Input from "../../../components/Input/Input";
import Modal from "../../../components/Modal/Modal";
import RadioButton, { RadioGroup } from "../../../components/RadioButton/RadioButton";
import { useToast } from "../../../context/toastContext";
import { recordMemberSmsConsent } from "../../../api/auth";
import type { TeamRosterMember } from "../../../api/authTypes";
import { formatUsPhoneNumber } from "../../../utils/phoneNumber";
import { memberName } from "../teamsUtils";

type Props = {
  churchId: string;
  member: TeamRosterMember;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
};

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const RecordSmsConsentModal = ({ churchId, member, onClose, onSaved }: Props) => {
  const { showToast } = useToast();
  const [source, setSource] = useState<"admin_verbal" | "admin_signed_form">("admin_verbal");
  const [consentedAt, setConsentedAt] = useState(today);
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (saving || !confirmed || !consentedAt) return;
    setSaving(true);
    try {
      await recordMemberSmsConsent(churchId, {
        memberId: member.memberId,
        source,
        consentedAt,
        confirmed: true,
      });
      showToast("SMS consent recorded.");
      try {
        await onSaved();
      } catch {
        showToast("Consent was recorded, but SMS status could not be refreshed. Reload Teams to update it.", "error");
      }
      onClose();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not record SMS consent. Try again.", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Record SMS consent"
      description="Record consent already obtained from this roster member."
      size="sm"
      busy={saving}
    >
      <div className="space-y-4">
        <div className="rounded-md border border-gray-700 bg-gray-950/40 px-3 py-2 text-sm">
          <p className="font-semibold">{memberName(member)}</p>
          <p className="text-gray-300">{formatUsPhoneNumber(member.phoneNumber)}</p>
        </div>
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-semibold">Consent source</legend>
          <RadioGroup value={source} onValueChange={(value) => setSource(value as typeof source)} aria-label="Consent source" className="flex flex-col gap-2">
            <RadioButton optionValue="admin_verbal" label="Verbal consent" hideLabelColon />
            <RadioButton optionValue="admin_signed_form" label="Signed volunteer/ministry form" hideLabelColon />
          </RadioGroup>
        </fieldset>
        <Input
          label="Date consent was obtained"
          type="date"
          value={consentedAt}
          max={today()}
          onChange={(value) => setConsentedAt(String(value))}
        />
        <label className="flex items-start gap-2 text-sm leading-5 text-gray-200">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            className="mt-1 size-4 accent-cyan-500"
          />
          <span>I confirm this person agreed to receive WorshipSync texts about volunteer availability, scheduling, assignments, and related reminders.</span>
        </label>
        <div className="flex gap-3 pt-1">
          <Button variant="secondary" className="flex-1 justify-center" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" className="flex-1 justify-center" onClick={() => void save()} disabled={saving || !confirmed || !consentedAt} isLoading={saving}>Save consent</Button>
        </div>
      </div>
    </Modal>
  );
};

export default RecordSmsConsentModal;
