import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { AuthApiError, submitSmsConsent } from "../api/auth";
import WorshipSyncImage from "../assets/WorshipSyncImage.png";
import AuthScreenMain from "../components/AuthScreenMain";
import Button from "../components/Button/Button";
import Checkbox from "../components/Checkbox/Checkbox";
import Input from "../components/Input/Input";

export const SMS_CONSENT_TEXT =
  "I agree to receive SMS messages from my church through WorshipSync about volunteer availability, scheduling, assignments, and related reminders. Message frequency varies. Message and data rates may apply. Reply STOP to unsubscribe or HELP for help. Consent is optional and is not required to use WorshipSync.";

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
  const [phoneNumber, setPhoneNumber] = useState("");
  const [consent, setConsent] = useState(false);
  const [phoneError, setPhoneError] = useState("");
  const [consentError, setConsentError] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [didOptIn, setDidOptIn] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting || didOptIn) return;

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
      await submitSmsConsent({ phoneNumber, consent: true });
      setDidOptIn(true);
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
              SMS Messaging
            </h1>
            <p className="text-sm leading-relaxed text-gray-300">
              Opt in to transactional text messages from your church through
              WorshipSync about volunteer availability, scheduling, assignments,
              and related reminders.
            </p>
          </div>

          {didOptIn ? (
            <div className="mt-6 space-y-3 rounded-xl border border-green-500/50 bg-green-950/30 px-4 py-5 text-left" role="status">
              <p className="text-base font-medium text-white">You&apos;re opted in.</p>
              <p className="text-sm leading-relaxed text-gray-300">
                You can reply STOP to any WorshipSync SMS message at any time
                to unsubscribe.
              </p>
            </div>
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
                  setPhoneNumber(String(value));
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
                <p className="pl-7 text-sm text-gray-300">
                  <Link
                    to="/privacy"
                    className="cursor-pointer font-medium text-orange-300 underline underline-offset-2 hover:text-orange-200"
                  >
                    Privacy Policy
                  </Link>
                  <span aria-hidden className="px-2 text-gray-500">
                    ·
                  </span>
                  <Link
                    to="/terms"
                    className="cursor-pointer font-medium text-orange-300 underline underline-offset-2 hover:text-orange-200"
                  >
                    Terms of Service
                  </Link>
                </p>
              </div>

              {errorMessage ? (
                <p className="text-sm text-red-300" role="alert">
                  {errorMessage}
                </p>
              ) : null}

              <Button
                type="submit"
                variant="primary"
                className="w-full cursor-pointer justify-center"
                isLoading={isSubmitting}
                disabled={isSubmitting || !phoneNumber.trim() || !consent}
              >
                Agree &amp; continue
              </Button>
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
