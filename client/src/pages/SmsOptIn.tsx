import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AuthApiError,
  cancelSmsConsent,
  submitSmsConsent,
  verifySmsConsent,
} from "../api/auth";
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

type SignupOutcome = "skipped" | "cancelled" | null;

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

const createSmsConsentCancellationCapability = () => {
  const challengeBytes = window.crypto.getRandomValues(new Uint8Array(16));
  const tokenBytes = window.crypto.getRandomValues(new Uint8Array(32));
  const challengeId = Array.from(challengeBytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const cancellationToken = window
    .btoa(String.fromCharCode(...tokenBytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return { challengeId, cancellationToken };
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
  const [isCancelling, setIsCancelling] = useState(false);
  const [verificationCode, setVerificationCode] = useState("");
  const [verificationChallengeId, setVerificationChallengeId] =
    useState<string | null>(null);
  const [cancellationToken, setCancellationToken] = useState<string | null>(null);
  const [verificationError, setVerificationError] = useState("");
  const [cancellationError, setCancellationError] = useState("");
  const [verificationPending, setVerificationPending] = useState(false);
  const [verificationRequestUncertain, setVerificationRequestUncertain] =
    useState(false);
  const [didOptIn, setDidOptIn] = useState(false);
  const [signupOutcome, setSignupOutcome] = useState<SignupOutcome>(null);
  const [cancellationUnconfirmed, setCancellationUnconfirmed] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting || didOptIn || signupOutcome) return;

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
    let submissionStarted = false;
    try {
      if (!churchId) {
        setErrorMessage("Open the SMS opt-in link provided by your church.");
        return;
      }
      const capability = createSmsConsentCancellationCapability();
      setVerificationChallengeId(capability.challengeId);
      setCancellationToken(capability.cancellationToken);
      submissionStarted = true;
      await submitSmsConsent(churchId, {
        phoneNumber,
        consent: true,
        ...capability,
      });
      setVerificationRequestUncertain(false);
      setVerificationPending(true);
    } catch (error) {
      const requestOutcomeIsUncertain = submissionStarted && (
        !(error instanceof AuthApiError) ||
        !error.status ||
        error.status >= 500
      );
      setErrorMessage(
        requestOutcomeIsUncertain
          ? "We couldn't confirm whether a verification code was sent. If you received one, you can enter it or cancel this signup."
          : error instanceof AuthApiError
            ? error.message
            : "Could not save your SMS consent. Please try again.",
      );
      if (requestOutcomeIsUncertain) {
        setVerificationRequestUncertain(true);
        setVerificationPending(true);
      } else {
        setVerificationRequestUncertain(false);
        setVerificationChallengeId(null);
        setCancellationToken(null);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerify = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isVerifying || isCancelling || didOptIn || signupOutcome) return;
    setVerificationError("");
    setErrorMessage("");
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
        challengeId: verificationChallengeId || "",
      });
      setDidOptIn(true);
      setVerificationPending(false);
      setVerificationRequestUncertain(false);
      setVerificationChallengeId(null);
      setCancellationToken(null);
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

  const handleSkipSignup = () => {
    if (isSubmitting || isVerifying || isCancelling || didOptIn) return;
    setSignupOutcome("skipped");
  };

  const handleCancelSignup = async () => {
    if (isSubmitting || isVerifying || isCancelling || didOptIn) return;
    setIsCancelling(true);
    setCancellationError("");
    try {
      if (!churchId || !verificationChallengeId || !cancellationToken) {
        throw new Error("Cancellation details are unavailable.");
      }
      const result = await cancelSmsConsent(churchId, {
        phoneNumber,
        challengeId: verificationChallengeId,
        cancellationToken,
      });
      if (!result.success || !result.cancelled) {
        throw new Error("The server did not confirm cancellation.");
      }
      setVerificationPending(false);
      setVerificationRequestUncertain(false);
      setVerificationCode("");
      setVerificationError("");
      setVerificationChallengeId(null);
      setCancellationToken(null);
      setCancellationUnconfirmed(false);
      setCancellationError("");
      setSignupOutcome("cancelled");
    } catch (error) {
      setVerificationPending(false);
      setCancellationUnconfirmed(true);
      setCancellationError(
        error instanceof AuthApiError
          ? error.message
          : "Retry to check this signup. If a verification challenge remains active, it expires after 10 minutes.",
      );
    } finally {
      setIsCancelling(false);
    }
  };

  const handleReturnToOptions = () => {
    setSignupOutcome(null);
    setCancellationUnconfirmed(false);
    setVerificationPending(false);
    setVerificationRequestUncertain(false);
    setConsent(false);
    setPhoneError("");
    setConsentError("");
    setVerificationCode("");
    setVerificationChallengeId(null);
    setCancellationToken(null);
    setVerificationError("");
    setCancellationError("");
    setErrorMessage("");
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
          ) : cancellationUnconfirmed ? (
            <div className="mt-6 space-y-4 rounded-xl border border-amber-500/50 bg-amber-950/30 px-4 py-5 text-left" role="alert">
              <div className="space-y-2">
                <p className="text-base font-medium text-white">Cancellation not confirmed</p>
                <p className="text-sm leading-relaxed text-gray-300">
                  We couldn&apos;t confirm whether this signup was cancelled or
                  completed. If a verification code remains active, it will
                  expire after 10 minutes. This cancellation request does not
                  unsubscribe an existing subscriber. If you receive texts
                  and want them to stop, reply STOP to a WorshipSync text.
                </p>
                {cancellationError ? (
                  <p className="text-sm text-amber-100" role="status">
                    {cancellationError}
                  </p>
                ) : null}
              </div>
              <Button
                type="button"
                variant="secondary"
                className="w-full cursor-pointer justify-center"
                isLoading={isCancelling}
                disabled={isCancelling}
                onClick={() => void handleCancelSignup()}
              >
                Retry cancellation
              </Button>
              <Button
                component="link"
                to="/"
                variant="tertiary"
                className="w-full cursor-pointer justify-center"
              >
                Continue to WorshipSync
              </Button>
            </div>
          ) : signupOutcome ? (
            <div className="mt-6 space-y-4 rounded-xl border border-gray-600 bg-gray-900/60 px-4 py-5 text-left" role="status">
              <div className="space-y-2">
                <p className="text-base font-medium text-white">
                  {signupOutcome === "cancelled"
                    ? "SMS signup cancelled"
                    : "SMS signup skipped"}
                </p>
                <p className="text-sm leading-relaxed text-gray-300">
                  {signupOutcome === "cancelled"
                    ? "The pending verification challenge was cancelled. Any previously verified subscription remains unchanged."
                    : "No SMS signup was started from this page. Your existing subscription status has not been checked or changed."} You can continue using WorshipSync and participating in church scheduling without opting in. If you previously subscribed and want to stop receiving messages, reply STOP to a WorshipSync text.
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
              <Button
                type="button"
                variant="tertiary"
                className="w-full cursor-pointer justify-center"
                onClick={handleReturnToOptions}
              >
                Return to SMS options
              </Button>
            </div>
          ) : verificationPending ? (
            <form className="mt-6 flex w-full flex-col gap-4" onSubmit={handleVerify} noValidate>
              <p className="text-sm leading-relaxed text-gray-300" role="status">
                {verificationRequestUncertain
                  ? "If you received a 6-digit verification code, enter it to finish opting in."
                  : "We sent a 6-digit verification code to your phone. Enter it to finish opting in."}
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
                  setErrorMessage("");
                }}
                errorText={verificationError}
                required
              />
              {errorMessage ? (
                <p className="text-sm text-amber-100" role="alert">
                  {errorMessage}
                </p>
              ) : null}
              <Button
                type="submit"
                variant="primary"
                className="w-full cursor-pointer justify-center"
                isLoading={isVerifying}
                disabled={isVerifying || isCancelling || verificationCode.length !== 6}
              >
                Verify phone
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="w-full cursor-pointer justify-center whitespace-normal text-center"
                disabled={isVerifying || isCancelling}
                isLoading={isCancelling}
                onClick={() => void handleCancelSignup()}
              >
                Cancel SMS signup — continue without SMS
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
                  onClick={handleSkipSignup}
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
