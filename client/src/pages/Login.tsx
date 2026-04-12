import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { ArrowLeft, CheckCircle, Eye, EyeOff, LoaderCircle } from "lucide-react";
import Input from "../components/Input/Input";
import Button from "../components/Button/Button";
import SetupScreenBackButton from "../components/SetupScreenBackButton";
import VerificationCodeInput from "../components/VerificationCodeInput/VerificationCodeInput";
import { GlobalInfoContext } from "../context/globalInfo";
import {
  getAuthRedirectPathnameFromState,
} from "../utils/authRedirectPath";
import {
  INVALID_EMAIL_FORMAT_MESSAGE,
  isValidEmailFormat,
} from "../utils/emailFormat";

type Mode = "signIn" | "code" | "forgotPassword";

type LoginFieldErrors = {
  email?: string;
  password?: string;
  code?: string;
};

const RESEND_COOLDOWN_SEC = 60;

const FORGOT_PASSWORD_EMAIL_HELPER =
  "If an account exists for that email, you will receive a reset link shortly.";

/**
 * Dedupes concurrent `verifyEmailCode` calls for the same pending auth + digits.
 * Ref-based guards reset on remount; this survives React Strict Mode remounts and
 * blocks overlapping async work from the auto-submit effect and manual submit.
 */
let emailCodeVerificationInFlight: string | null = null;

const Login = () => {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const context = useContext(GlobalInfoContext);
  const [mode, setMode] = useState<Mode>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [pendingAuthId, setPendingAuthId] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<LoginFieldErrors>({});
  const [infoBanner, setInfoBanner] = useState("");
  const [resendCooldownSec, setResendCooldownSec] = useState(0);
  const [isResending, setIsResending] = useState(false);
  /** Forgot-password view hides sign-in `authError` until the user submits this form. */
  const [forgotPasswordHasSubmit, setForgotPasswordHasSubmit] = useState(false);
  const [isForgotSending, setIsForgotSending] = useState(false);
  const [forgotPasswordEmailSent, setForgotPasswordEmailSent] = useState(false);
  /** Blocks submit briefly after "Change email" so a layout-shift ghost click cannot fire validation on an empty field. */
  const [forgotPasswordSubmitBlocked, setForgotPasswordSubmitBlocked] =
    useState(false);
  const forgotPasswordSubmitBlockTimeoutRef = useRef(0);
  const authServerStatus = context?.authServerStatus ?? "checking";
  const authServerRetryCount = context?.authServerRetryCount ?? 0;
  const isAuthServerOnline = authServerStatus === "online";
  const isAuthServerChecking = authServerStatus === "checking";
  const isAuthActionDisabled =
    context?.loginState === "loading" || !isAuthServerOnline;
  const verifyEmailCode = context?.verifyEmailCode;
  const prevVerificationDigitsLenRef = useRef(0);

  useLayoutEffect(() => {
    if (mode !== "code") {
      setResendCooldownSec(0);
      return;
    }
    setResendCooldownSec(RESEND_COOLDOWN_SEC);
  }, [mode]);

  useEffect(() => {
    if (resendCooldownSec <= 0) {
      return;
    }
    const timerId = window.setTimeout(() => {
      setResendCooldownSec((s) => s - 1);
    }, 1000);
    return () => window.clearTimeout(timerId);
  }, [resendCooldownSec]);

  useEffect(
    () => () => {
      window.clearTimeout(forgotPasswordSubmitBlockTimeoutRef.current);
    },
    []
  );

  useEffect(() => {
    const pendingId = context?.pendingEmailVerificationId;
    const clearPending = context?.clearPendingEmailVerification;
    if (!pendingId || !clearPending) {
      return;
    }
    setPendingAuthId(pendingId);
    setMode("code");
    setFieldErrors({});
    setInfoBanner("");
    clearPending();
  }, [context?.pendingEmailVerificationId, context?.clearPendingEmailVerification]);

  useEffect(() => {
    const codeParam = searchParams.get("code");
    const pendingParam = searchParams.get("pendingAuthId");
    const digits = codeParam ? codeParam.replace(/\D/g, "") : "";
    const hasValidCode = digits.length === 6;
    const pendingTrimmed = pendingParam?.trim() ?? "";

    if (!hasValidCode && !pendingTrimmed) {
      return;
    }

    if (hasValidCode) {
      setCode(digits);
    }
    if (pendingTrimmed) {
      setPendingAuthId(pendingTrimmed);
    }
    if (hasValidCode || pendingTrimmed) {
      setMode("code");
    }

    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("code");
        next.delete("pendingAuthId");
        return next;
      },
      { replace: true }
    );
  }, [searchParams, setSearchParams]);

  const guestDestination =
    getAuthRedirectPathnameFromState(location.state) ?? "/controller";

  const handleSignIn = async () => {
    setInfoBanner("");
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setFieldErrors({ email: "Enter your email to continue." });
      return;
    }
    if (!isValidEmailFormat(trimmedEmail)) {
      setFieldErrors({ email: INVALID_EMAIL_FORMAT_MESSAGE });
      return;
    }
    if (!password) {
      setFieldErrors({ password: "Enter your password to continue." });
      return;
    }
    setFieldErrors({});
    const response = await context?.login({
      email: trimmedEmail,
      password,
    });
    if (response?.requiresEmailCode && response.pendingAuthId) {
      setPendingAuthId(response.pendingAuthId);
      setMode("code");
      setInfoBanner("");
    }
  };

  const handleVerifyCode = useCallback(async () => {
    setInfoBanner("");
    const digits = code.replace(/\D/g, "");
    if (!pendingAuthId || digits.length !== 6) {
      setFieldErrors({ code: "Enter the six-digit code from your email." });
      return;
    }
    const dedupeKey = `${pendingAuthId}:${digits}`;
    if (emailCodeVerificationInFlight === dedupeKey) {
      return;
    }
    emailCodeVerificationInFlight = dedupeKey;
    setFieldErrors({});
    try {
      const success = await verifyEmailCode?.({
        pendingAuthId,
        code: digits,
      });
      if (!success) {
        return;
      }
      setCode("");
      setPendingAuthId("");
    } finally {
      if (emailCodeVerificationInFlight === dedupeKey) {
        emailCodeVerificationInFlight = null;
      }
    }
  }, [code, pendingAuthId, verifyEmailCode]);

  useEffect(() => {
    if (mode !== "code") {
      prevVerificationDigitsLenRef.current = 0;
      return;
    }
    const digits = code.replace(/\D/g, "");
    const len = digits.length;
    const prevLen = prevVerificationDigitsLenRef.current;
    prevVerificationDigitsLenRef.current = len;
    if (len !== 6 || !pendingAuthId || isAuthActionDisabled) {
      return;
    }
    if (prevLen === 6) {
      return;
    }
    void handleVerifyCode();
  }, [code, mode, pendingAuthId, isAuthActionDisabled, handleVerifyCode]);

  const handleResendCode = async () => {
    if (
      !pendingAuthId ||
      resendCooldownSec > 0 ||
      isResending ||
      !isAuthServerOnline ||
      context?.loginState === "loading"
    ) {
      return;
    }
    setIsResending(true);
    setInfoBanner("");
    try {
      const result = await context?.resendEmailCode({ pendingAuthId });
      if (result?.pendingAuthId) {
        setPendingAuthId(result.pendingAuthId);
        setCode("");
        setResendCooldownSec(RESEND_COOLDOWN_SEC);
        setFieldErrors({});
        setInfoBanner("We sent a new code to your email.");
      }
    } finally {
      setIsResending(false);
    }
  };

  const handleForgotPasswordSubmit = async () => {
    setInfoBanner("");
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setFieldErrors({ email: "Enter your email to continue." });
      return;
    }
    if (!isValidEmailFormat(trimmedEmail)) {
      setFieldErrors({ email: INVALID_EMAIL_FORMAT_MESSAGE });
      return;
    }
    setFieldErrors({});
    setForgotPasswordHasSubmit(true);
    setIsForgotSending(true);
    try {
      await context?.forgotPassword(trimmedEmail);
      setForgotPasswordEmailSent(true);
    } catch {
      // Message shown via sign-in context (authError)
    } finally {
      setIsForgotSending(false);
    }
  };

  const handleBackToSignIn = () => {
    window.clearTimeout(forgotPasswordSubmitBlockTimeoutRef.current);
    setForgotPasswordSubmitBlocked(false);
    setFieldErrors({});
    setInfoBanner("");
    setForgotPasswordHasSubmit(false);
    setForgotPasswordEmailSent(false);
    setCode("");
    setMode("signIn");
  };

  const handleFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mode === "forgotPassword") {
      if (forgotPasswordSubmitBlocked) {
        return;
      }
      if (forgotPasswordEmailSent || !isAuthServerOnline || isForgotSending) {
        return;
      }
      void handleForgotPasswordSubmit();
      return;
    }
    if (isAuthActionDisabled) {
      return;
    }
    if (mode === "code") {
      void handleVerifyCode();
    } else {
      void handleSignIn();
    }
  };

  const globalBannerMessage = (() => {
    if (isAuthServerChecking) {
      return "Connecting to WorshipSync...";
    }
    if (authServerStatus === "offline") {
      return authServerRetryCount > 0
        ? "Could not reach the server after several attempts. Check the connection and try again."
        : "Could not reach the server. Check the connection and try again.";
    }
    if (mode === "forgotPassword") {
      if (forgotPasswordEmailSent) {
        return infoBanner;
      }
      if (forgotPasswordHasSubmit) {
        return context?.authError || infoBanner;
      }
      return infoBanner;
    }
    return context?.authError || infoBanner;
  })();

  const canResendCode =
    Boolean(pendingAuthId) &&
    resendCooldownSec === 0 &&
    !isResending &&
    isAuthServerOnline &&
    context?.loginState !== "loading";

  let resendButtonLabel = "Resend code";
  if (resendCooldownSec > 0) {
    resendButtonLabel = `Resend code in ${resendCooldownSec}s`;
  } else if (isResending) {
    resendButtonLabel = "Sending…";
  }

  const globalBannerTone = (() => {
    if (authServerStatus === "offline") {
      return "text-amber-300";
    }
    if (context?.authError && !(mode === "forgotPassword" && forgotPasswordEmailSent)) {
      return "text-red-400";
    }
    if (infoBanner) {
      return "text-gray-300";
    }
    return "text-gray-300";
  })();

  const loginHeadline = (() => {
    if (mode === "code") return "Verify this device";
    if (mode === "forgotPassword") {
      return forgotPasswordEmailSent ? "Check your email" : "Forgot password";
    }
    return "Sign in";
  })();

  const loginSubtext = (() => {
    if (mode === "code") {
      return "We sent a six-digit code to your email. Enter it below to trust this device.";
    }
    if (mode === "forgotPassword") {
      if (forgotPasswordEmailSent) {
        return "If an account exists for that address, we sent a password reset link. It may take a minute to arrive.";
      }
      return "";
    }
    return "Use your WorshipSync email and password to continue.";
  })();

  return (
    <main className="relative flex min-h-dvh items-center justify-center bg-homepage-canvas px-4 text-white">
      <div className="w-full max-w-md rounded-2xl border border-gray-500 bg-gray-800 p-6">
        {mode === "code" || mode === "forgotPassword" ? (
          <div className="mb-3 flex justify-start">
            <Button
              type="button"
              variant="tertiary"
              svg={ArrowLeft}
              iconSize="sm"
              gap="gap-1.5"
              className="-ml-2 whitespace-nowrap px-2 py-1.5 text-sm"
              onClick={handleBackToSignIn}
            >
              Back to sign in
            </Button>
          </div>
        ) : (
          <SetupScreenBackButton />
        )}
        <h1 className="text-2xl font-semibold">{loginHeadline}</h1>
        {loginSubtext ? (
          <p className="mt-2 text-sm text-gray-200">{loginSubtext}</p>
        ) : null}

        {globalBannerMessage && (
          <div
            className={`mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm ${globalBannerTone}`}
            role="status"
            aria-live="polite"
          >
            {isAuthServerChecking && (
              <LoaderCircle className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
            )}
            <span className="min-w-0">{globalBannerMessage}</span>
            {authServerStatus === "offline" && authServerRetryCount > 0 && (
              <Button
                type="button"
                variant="textLink"
                className="shrink-0"
                onClick={() => void context?.refreshAuthBootstrap()}
              >
                Try again
              </Button>
            )}
          </div>
        )}

        <form className="flex flex-col" onSubmit={handleFormSubmit} noValidate>
          {mode === "signIn" && (
            <>
              <Input
                className="mt-4"
                id="email"
                label="Email"
                type="email"
                value={email}
                errorText={fieldErrors.email}
                onChange={(value) => {
                  setEmail(String(value));
                  setInfoBanner("");
                  if (fieldErrors.email) {
                    setFieldErrors((prev) => ({ ...prev, email: undefined }));
                  }
                }}
                autoComplete="email"
                disabled={!isAuthServerOnline}
              />
              <Input
                className="mt-3"
                id="password"
                label="Password"
                type={showPassword ? "text" : "password"}
                value={password}
                errorText={fieldErrors.password}
                onChange={(value) => {
                  setPassword(String(value));
                  setInfoBanner("");
                  if (fieldErrors.password) {
                    setFieldErrors((prev) => ({ ...prev, password: undefined }));
                  }
                }}
                svg={showPassword ? EyeOff : Eye}
                svgAction={() => setShowPassword((current) => !current)}
                svgActionAriaLabel={showPassword ? "Hide password" : "Show password"}
                autoComplete="current-password"
                disabled={!isAuthServerOnline}
              />
              <div className="mt-2 flex justify-end">
                <Button
                  type="button"
                  variant="textLink"
                  disabled={!isAuthServerOnline}
                  aria-disabled={!isAuthServerOnline}
                  onClick={() => {
                    window.clearTimeout(forgotPasswordSubmitBlockTimeoutRef.current);
                    setForgotPasswordSubmitBlocked(false);
                    setFieldErrors({});
                    setInfoBanner("");
                    setForgotPasswordHasSubmit(false);
                    setForgotPasswordEmailSent(false);
                    setMode("forgotPassword");
                  }}
                >
                  Forgot password
                </Button>
              </div>
            </>
          )}

          {mode === "forgotPassword" && !forgotPasswordEmailSent && (
            <Input
              className="mt-4"
              id="email-forgot"
              label="Email"
              type="email"
              value={email}
              helperText={FORGOT_PASSWORD_EMAIL_HELPER}
              errorText={fieldErrors.email}
              onChange={(value) => {
                setEmail(String(value));
                setInfoBanner("");
                if (fieldErrors.email) {
                  setFieldErrors((prev) => ({ ...prev, email: undefined }));
                }
              }}
              autoComplete="email"
              disabled={!isAuthServerOnline}
              autoFocus
            />
          )}

          {mode === "forgotPassword" && forgotPasswordEmailSent && (
            <div
              className="mt-4 flex flex-col items-center gap-3 rounded-xl border border-gray-600 bg-white/5 px-4 py-6 text-center"
              role="status"
              aria-live="polite"
            >
              <CheckCircle
                className="h-12 w-12 shrink-0 text-emerald-400"
                aria-hidden="true"
              />
              <p className="text-sm text-gray-200">
                Request received for <span className="font-medium text-white">{email.trim()}</span>.
              </p>
            </div>
          )}

          {mode === "code" && (
            <VerificationCodeInput
              id="verification-code"
              value={code}
              onChange={(next) => {
                setCode(next);
                setInfoBanner("");
                if (fieldErrors.code) {
                  setFieldErrors((prev) => ({ ...prev, code: undefined }));
                }
              }}
              disabled={!isAuthServerOnline}
              autoFocus
              errorText={fieldErrors.code}
            />
          )}

          {mode === "code" && (
            <div className="mt-3 flex flex-col items-center gap-1">
              <span className="text-sm text-gray-300">
                Didn&apos;t receive a code?
              </span>
              <Button
                type="button"
                variant="textLink"
                disabled={!canResendCode}
                aria-disabled={!canResendCode}
                onClick={() => void handleResendCode()}
              >
                {resendButtonLabel}
              </Button>
            </div>
          )}

          <div className="mt-4 flex flex-col gap-2">
            {mode === "code" ? (
              <Button
                type="submit"
                variant="cta"
                className="w-full justify-center"
                isLoading={context?.loginState === "loading"}
                disabled={isAuthActionDisabled}
              >
                Verify device
              </Button>
            ) : mode === "forgotPassword" ? (
              forgotPasswordEmailSent ? (
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full justify-center"
                  disabled={!isAuthServerOnline}
                  onClick={() => {
                    setForgotPasswordEmailSent(false);
                    setForgotPasswordHasSubmit(false);
                    setInfoBanner("");
                    setEmail("");
                    setFieldErrors({});
                    window.clearTimeout(forgotPasswordSubmitBlockTimeoutRef.current);
                    setForgotPasswordSubmitBlocked(true);
                    forgotPasswordSubmitBlockTimeoutRef.current = window.setTimeout(
                      () => {
                        setForgotPasswordSubmitBlocked(false);
                      },
                      300
                    );
                  }}
                >
                  Change email
                </Button>
              ) : (
                <Button
                  type="submit"
                  variant="cta"
                  className="w-full justify-center"
                  isLoading={isForgotSending}
                  disabled={
                    !isAuthServerOnline || isForgotSending || forgotPasswordSubmitBlocked
                  }
                >
                  Send reset link
                </Button>
              )
            ) : (
              <Button
                type="submit"
                variant="cta"
                className="w-full justify-center"
                isLoading={context?.loginState === "loading"}
                disabled={isAuthActionDisabled}
              >
                Sign in
              </Button>
            )}

            {authServerStatus === "offline" && authServerRetryCount === 0 && (
              <Button
                type="button"
                variant="secondary"
                className="w-full justify-center"
                onClick={() => void context?.refreshAuthBootstrap()}
              >
                Retry connection
              </Button>
            )}

            {mode !== "forgotPassword" ? (
              <Button
                type="button"
                variant="tertiary"
                className="w-full justify-center"
                onClick={() => context?.enterGuestMode(guestDestination)}
              >
                Test as guest
              </Button>
            ) : null}
          </div>
        </form>
      </div>
    </main>
  );
};

export default Login;
