import { Link } from "react-router-dom";
import Checkbox from "./Checkbox/Checkbox";

export const SMS_CONSENT_TEXT =
  "I agree to receive SMS messages from my church through WorshipSync about volunteer availability, scheduling, assignments, and related reminders. Message frequency varies. Message and data rates may apply. Reply STOP to unsubscribe or HELP for help. Consent is optional and is not required to use WorshipSync.";

type SmsConsentDisclosureProps = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  includeLegalLinks?: boolean;
};

const SmsConsentDisclosure = ({
  checked,
  onCheckedChange,
  disabled = false,
  id = "sms-consent",
  includeLegalLinks = true,
}: SmsConsentDisclosureProps) => (
  <Checkbox
    id={id}
    className="items-start"
    labelClassName="items-start"
    checked={checked}
    disabled={disabled}
    onCheckedChange={onCheckedChange}
    label={
      <span className="text-sm leading-relaxed text-gray-200">
        <span>{SMS_CONSENT_TEXT}</span>
        {includeLegalLinks ? (
          <>
            {" "}See our{" "}
            <Link
              to="/privacy"
              className="cursor-pointer underline underline-offset-2 hover:text-white"
              onClick={(event) => event.stopPropagation()}
            >
              Privacy Policy
            </Link>
            {" and "}
            <Link
              to="/terms"
              className="cursor-pointer underline underline-offset-2 hover:text-white"
              onClick={(event) => event.stopPropagation()}
            >
              Terms of Service
            </Link>
            .
          </>
        ) : null}
      </span>
    }
  />
);

export default SmsConsentDisclosure;
