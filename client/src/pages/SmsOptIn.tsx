import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { AuthApiError, submitSmsConsent, verifySmsConsent } from "../api/auth";
import WorshipSyncImage from "../assets/WorshipSyncImage.png";
import AuthScreenMain from "../components/AuthScreenMain";
import Button from "../components/Button/Button";
import Checkbox from "../components/Checkbox/Checkbox";
import Input from "../components/Input/Input";
import { formatUsPhoneInput } from "../utils/phoneNumber";

export const SMS_CONSENT_TEXT =
  "I agree to receive SMS messages from my church through WorshipSync about volunteer availability, scheduling, assignments, and related reminders. Message frequency varies. Message and data rates may apply. Reply STOP to unsubscribe or HELP for help. Consent is optional and is not required to use WorshipSync.";

const SMS_OPTIONAL_DESCRIPTION =
  "Your church may use WorshipSync to send volunteer availability requests, scheduling information, assignment updates, and related reminders by text. SMS is optional. You can use WorshipSync and participate in church scheduling without receiving text messages.";

const isValidUsPhone = (value: string) => {
  const input = value.trim();
  if (!input || !/^\+?[\d\s().-]+$/.test(input)) return false;

  const digits = input.replace(/\D/g, "");
  const nationalNumber =
    digits.length === 11 && digits.startsWith("1")
      ? digits.slice(1)
      : digits;
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(nationalNumber);
};

const SmsOptIn = () => {
  const { churchId = "" } = useParams<{ churchId: string }>();
  const [phoneNumber, setPhoneNumber] = useState("");
  const [consent, setConsent] = useState(false);
  const [phoneError, setPhoneError] = useState("");
  const [consentError, setConsentError] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationCode, setVerificationCode] = useState("");
  const [verificationError, setVerificationError] = useState("");
  const [verificationPending, setVerificationPending] = useState(false);
  const [didOptIn, setDidOptIn] = useState(false);
  const [didDecline, setDidDecline] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting || didOptIn || didDecline) return;

    const nextPhoneError = isValidUsPhone(phoneNumber)
      ? ""
      : "Enter a valid 10-digit U.S. phone number.";
    const nextConsentError = consent
      ? ""
      : "Check the box to agree to receive SMS messages.";
    setPhoneError(nextPhoneError);
    setConsentError(nextConsentError);
    setErrorMessage("");
    if (nextPhoneError || nextConsentError) return;

    setIsSubmitting(true);
    try {
      if (!churchId) {
        setErrorMessage("Open the SMS opt-in link provided by your church.");
        return;
      }
      await submitSmsConsent(churchId, { phoneNumber, consent: true });
      setVerificationPending(true);
    } catch (error) {
      setErrorMessage(
        error instanceof AuthApiError
          ? error.message
          : "Could not save your SMS consent. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerify = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isVerifying || didOptIn || didDecline) return;
    setVerificationError("");
    if (!/^\d{6}$/.test(verificationCode.trim())) {
      setVerificationError("Enter the 6-digit verification code we sent you.");
      return;
    }
    setIsVerifying(true);
    try {
      if (!churchId) {
        setVerificationError("Open the SMS opt-in link provided by your church.");
        return;
      }
      await verifySmsConsent(churchId, {
        phoneNumber,
        code: verificationCode.trim(),
      });
      setDidOptIn(true);
      setVerificationPending(false);
    } catch (error) {
      setVerificationError(
        error instanceof AuthApiError
          ? error.message
          : "Could not verify your SMS consent. Please try again.",
      );
    } finally {
      setIsVerifying(false);
    }
  };

  const handleDecline = () => {
    if (isSubmitting || verificationPending || didOptIn) return;
    setDidDecline(true);
  };

  return (
    <AuthScreenMain>
      <div className="flex w-full max-w-md flex-col items-center gap-6">
        <div className="w-full rounded-2xl border border-gray-500 bg-gray-800 p-6 sm:p-8">
          <img
            src={WorshipSyncImage}
            alt="WorshipSync"
            className="mx-auto mb-5 w-[58%] max-w-[13.5rem]"
            width={216}
            height={198}
            loading="eager"
          />

          <div className="space-y-2 text-center">
            <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              Optional SMS updates
            </h1>
            {churchId ? (
              <p className="text-sm leading-relaxed text-gray-300">
                {SMS_OPTIONAL_DESCRIPTION}
              </p>
            ) : null}
            {!churchId ? (
              <p className="text-sm text-gray-300">
                Open the SMS opt-in link provided by your church to continue.
              </p>
            ) : null}
          </div>

          {didOptIn ? (
            <div className="mt-6 space-y-3 rounded-xl border border-green-500/50 bg-green-950/30 px-4 py-5 text-left" role="status">
              <p className="text-base font-medium text-white">You&apos;re opted in.</p>
              <p className="text-sm leading-relaxed text-gray-300">
                You can reply STOP to any WorshipSync SMS message at any time
                to unsubscribe.
              </p>
            </div>
          ) : didDecline ? (
            <div className="mt-6 space-y-4 rounded-xl border border-gray-600 bg-gray-900/60 px-4 py-5 text-left" role="status">
              <div className="space-y-2">
                <p className="text-base font-medium text-white">SMS not enabled</p>
                <p className="text-sm leading-relaxed text-gray-300">
                  You have not been subscribed to text messages. SMS is optional
                  and is not required to use WorshipSync or participate in your
                  church&apos;s volunteer scheduling. You may opt in later.
                </p>
              </div>
              <Button
                component="link"
                to="/"
                variant="secondary"
                className="w-full cursor-pointer justify-center"
              >
                Continue to WorshipSync
              </Button>
            </div>
          ) : verificationPending ? (
            <form className="mt-6 flex w-full flex-col gap-4" onSubmit={handleVerify} noValidate>
              <p className="text-sm leading-relaxed text-gray-300" role="status">
                We sent a 6-digit verification code to your phone. Enter it to finish opting in.
              </p>
              <Input
                id="sms-verification-code"
                label="Verification code"
                name="verificationCode"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={verificationCode}
                onChange={(value) => {
                  setVerificationCode(String(value).replace(/\D/g, "").slice(0, 6));
                  setVerificationError("");
                }}
                errorText={verificationError}
                required
              />
              <Button
                type="submit"
                variant="primary"
                className="w-full cursor-pointer justify-center"
                isLoading={isVerifying}
                disabled={isVerifying || verificationCode.length !== 6}
              >
                Verify phone
              </Button>
            </form>
          ) : (
            <form
              className="mt-6 flex w-full flex-col gap-4"
              onSubmit={handleSubmit}
              noValidate
            >
              <Input
                id="sms-phone-number"
                label="Mobile phone number"
                name="phoneNumber"
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                value={phoneNumber}
                onChange={(value) => {
                  setPhoneNumber(formatUsPhoneInput(String(value)));
                  setPhoneError("");
                  setErrorMessage("");
                }}
                errorText={phoneError}
                helperText="U.S. phone numbers only."
                required
              />

              <div className="space-y-2">
                <Checkbox
                  id="sms-consent"
                  className="items-start"
                  labelClassName="items-start"
                  checked={consent}
                  onCheckedChange={(checked) => {
                    setConsent(checked);
                    setConsentError("");
                    setErrorMessage("");
                  }}
                  label={
                    <span className="text-sm leading-relaxed text-gray-200">
                      {SMS_CONSENT_TEXT}
                    </span>
                  }
                />
                {consentError ? (
                  <p className="text-sm text-red-300" role="alert">
                    {consentError}
                  </p>
                ) : null}
              </div>

              {errorMessage ? (
                <p className="text-sm text-red-300" role="alert">
                  {errorMessage}
                </p>
              ) : null}

              <div className="flex flex-col gap-3 border-t border-gray-700 pt-4">
                <Button
                  type="submit"
                  variant="primary"
                  className="w-full cursor-pointer justify-center"
                  isLoading={isSubmitting}
                  disabled={isSubmitting || !isValidUsPhone(phoneNumber) || !consent}
                >
                  Opt in to SMS
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full cursor-pointer justify-center whitespace-normal text-center"
                  disabled={isSubmitting}
                  onClick={handleDecline}
                >
                  No thanks — continue without SMS
                </Button>
              </div>
            </form>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm text-gray-300">
          <Link
            to="/privacy"
            className="cursor-pointer underline underline-offset-2 hover:text-white"
          >
            Privacy Policy
          </Link>
          <span aria-hidden className="text-gray-600">
            ·
          </span>
          <Link
            to="/terms"
            className="cursor-pointer underline underline-offset-2 hover:text-white"
          >
            Terms of Service
          </Link>
        </footer>
      </div>
    </AuthScreenMain>
  );
};

export default SmsOptIn;
