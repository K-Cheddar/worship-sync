import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { ArrowLeft, CheckCircle, Eye, EyeOff, LoaderCircle } from "lucide-react";
import Input from "../components/Input/Input";
import Button from "../components/Button/Button";
import { GoogleMark, MicrosoftMark } from "../components/AuthProviderMarks";
import SetupScreenBackButton from "../components/SetupScreenBackButton";
import AuthScreenMain from "../components/AuthScreenMain";
import HostedDesktopBrowserLogin from "./HostedDesktopBrowserLogin";
import VerificationCodeInput from "../components/VerificationCodeInput/VerificationCodeInput";
import {
  completeDesktopAuth,
  getDesktopAuthStatus,
  startDesktopAuth,
} from "../api/auth";
import type { DesktopAuthProvider } from "../api/authTypes";
import { GlobalInfoContext } from "../context/globalInfo";
import {
  getAuthRedirectPathnameFromState,
} from "../utils/authRedirectPath";
import {
  INVALID_EMAIL_FORMAT_MESSAGE,
  isValidEmailFormat,
} from "../utils/emailFormat";
import {
  getOrCreateDeviceId,
  getLastSignInMethod,
  getPendingDesktopAuthState,
  setPendingDesktopAuthState,
  setPendingDesktopEmailResendState,
  setPendingEmailCodeSignInMethod,
  type PendingDesktopAuthState,
} from "../utils/authStorage";
import { getTrustedDeviceLabel } from "../utils/deviceInfo";
import {
  getDesktopSsoCompleteReplaceHref,
  isDesktopBrokerAuthCompleted,
  markDesktopBrokerAuthCompleted,
  setDesktopSsoCompleteFlash,
} from "../utils/desktopSsoBrowserSession";
import { isElectron } from "../utils/environment";

type Mode = "signIn" | "code" | "forgotPassword";

type LoginFieldErrors = {
  email?: string;
  password?: string;
  code?: string;
};

type DesktopBrowserFlowStatus = "idle" | "loading";

const RESEND_COOLDOWN_SEC = 60;
const HOSTED_DESKTOP_SSO_SESSION_KEY = "ws-hosted-desktop-sso";

const FORGOT_PASSWORD_EMAIL_HELPER =
  "If an account exists for that email, you will receive a reset link shortly.";

const LastUsedBadge = ({ show }: { show: boolean }) => {
  if (!show) return null;
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full border border-emerald-400/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold leading-none tracking-wide text-emerald-200/95"
      aria-label="Last sign-in method used on this device"
    >
      Last used
    </span>
  );
};

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
  const [localAuthError, setLocalAuthError] = useState("");
  const [resendCooldownSec, setResendCooldownSec] = useState(0);
  const [isResending, setIsResending] = useState(false);
  const [isStartingDesktopAuth, setIsStartingDesktopAuth] = useState(false);
  const [pendingDesktopAuth, setPendingDesktopAuth] =
    useState<PendingDesktopAuthState | null>(() => {
      const stored = getPendingDesktopAuthState();
      if (!stored) return null;
      const expiresAt = Date.parse(stored.expiresAt);
      return Number.isFinite(expiresAt) && expiresAt > Date.now()
        ? stored
        : null;
    });
  const [desktopBrowserFlowStatus, setDesktopBrowserFlowStatus] =
    useState<DesktopBrowserFlowStatus>("idle");
  /** Forgot-password view hides sign-in `authError` until the user submits this form. */
  const [forgotPasswordHasSubmit, setForgotPasswordHasSubmit] = useState(false);
  const [isForgotSending, setIsForgotSending] = useState(false);
  const [forgotPasswordEmailSent, setForgotPasswordEmailSent] = useState(false);
  /** Blocks submit briefly after "Change email" so a layout-shift ghost click cannot fire validation on an empty field. */
  const [forgotPasswordSubmitBlocked, setForgotPasswordSubmitBlocked] =
    useState(false);
  const forgotPasswordSubmitBlockTimeoutRef = useRef(0);
  const [lastSignInMethod] = useState(() => getLastSignInMethod());
  const isElectronRuntime = isElectron();
  const { desktopAuthId: desktopBrowserAuthId, provider: desktopBrowserProvider } =
    useMemo(() => {
      const idFromUrl = String(searchParams.get("desktopAuthId") || "").trim();
      if (idFromUrl && isDesktopBrokerAuthCompleted(idFromUrl)) {
        return {
          desktopAuthId: "",
          provider: null as DesktopAuthProvider | null,
        };
      }
      const rawProv = String(searchParams.get("provider") || "")
        .trim()
        .toLowerCase();
      const provFromUrl =
        rawProv === "google" || rawProv === "microsoft"
          ? (rawProv as DesktopAuthProvider)
          : null;
      if (idFromUrl && provFromUrl) {
        try {
          sessionStorage.setItem(
            HOSTED_DESKTOP_SSO_SESSION_KEY,
            JSON.stringify({
              desktopAuthId: idFromUrl,
              provider: provFromUrl,
            }),
          );
        } catch {
          // ignore storage failures (private mode, quota)
        }
        return { desktopAuthId: idFromUrl, provider: provFromUrl };
      }
      try {
        const raw = sessionStorage.getItem(HOSTED_DESKTOP_SSO_SESSION_KEY);
        if (raw) {
          // One-time recovery after redirect; do not allow stale handoff to persist.
          sessionStorage.removeItem(HOSTED_DESKTOP_SSO_SESSION_KEY);
          const parsed = JSON.parse(raw) as {
            desktopAuthId?: unknown;
            provider?: unknown;
          };
          const storedId =
            typeof parsed.desktopAuthId === "string"
              ? parsed.desktopAuthId.trim()
              : "";
          const storedProvRaw =
            typeof parsed.provider === "string"
              ? parsed.provider.trim().toLowerCase()
              : "";
          const storedProv =
            storedProvRaw === "google" || storedProvRaw === "microsoft"
              ? (storedProvRaw as DesktopAuthProvider)
              : null;
          if (storedId && storedProv && !isDesktopBrokerAuthCompleted(storedId)) {
            return { desktopAuthId: storedId, provider: storedProv };
          }
        }
      } catch {
        // ignore invalid persisted payload
      }
      return {
        desktopAuthId: "",
        provider: null as DesktopAuthProvider | null,
      };
    }, [searchParams]);

  useLayoutEffect(() => {
    if (isElectronRuntime || mode !== "signIn") {
      return;
    }
    if (!searchParams.has("desktopAuthId") && !searchParams.has("provider")) {
      return;
    }
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("desktopAuthId");
        next.delete("provider");
        return next;
      },
      { replace: true },
    );
  }, [isElectronRuntime, mode, searchParams, setSearchParams]);

  const isHostedDesktopBrowserFlow =
    !isElectronRuntime &&
    mode === "signIn" &&
    Boolean(desktopBrowserAuthId && desktopBrowserProvider);
  const hasPendingDesktopAuth = Boolean(
    isElectronRuntime && mode === "signIn" && pendingDesktopAuth,
  );
  const authServerStatus = context?.authServerStatus ?? "checking";
  const authServerRetryCount = context?.authServerRetryCount ?? 0;
  const isAuthServerOnline = authServerStatus === "online";
  const isAuthServerChecking = authServerStatus === "checking";
  /** Session is ready but router has not left `/login` yet (avoids a dead-air gap after the submit spinner stops). */
  const isFinishingSignIn = context?.loginState === "success";
  /**
   * Hosted desktop handoff runs in a normal browser tab that may already have a WorshipSync
   * web session. In that case `loginState` is still "success" from bootstrap, but the page copy
   * must describe returning to the desktop app, not finishing a web-only sign-in.
   */
  const showWebSessionNavigatingChrome = Boolean(
    isFinishingSignIn && !isHostedDesktopBrowserFlow,
  );
  const isAuthActionDisabled =
    context?.loginState === "loading" ||
    isFinishingSignIn ||
    !isAuthServerOnline;
  const isSignInFormFieldsLocked =
    !isAuthServerOnline ||
    context?.loginState === "loading" ||
    isFinishingSignIn;
  const verifyEmailCode = context?.verifyEmailCode;
  const pendingLinkState = context?.pendingLinkState;
  const prevVerificationDigitsLenRef = useRef(0);
  const desktopAuthPollInFlightRef = useRef(false);
  const desktopBrowserAutoStartRef = useRef(false);

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
    if (pendingDesktopAuth) {
      return;
    }
    setPendingDesktopAuthState(null);
  }, [pendingDesktopAuth]);

  useEffect(() => {
    const pendingId = context?.pendingEmailVerificationId;
    const clearPending = context?.clearPendingEmailVerification;
    if (!pendingId || !clearPending) {
      return;
    }
    context?.clearAuthError();
    setPendingAuthId(pendingId);
    setMode("code");
    setFieldErrors({});
    setInfoBanner("");
    clearPending();
  }, [context]);

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

  const clearPendingDesktopAuth = useCallback(() => {
    setPendingDesktopAuth(null);
    setPendingDesktopAuthState(null);
  }, []);

  const openDesktopBrowserUrl = useCallback(async (url: string) => {
    if (isElectronRuntime && window.electronAPI?.openExternalUrl) {
      await window.electronAPI.openExternalUrl(url);
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }, [isElectronRuntime]);

  const pollDesktopAuthStatus = useCallback(async () => {
    if (
      !pendingDesktopAuth ||
      !context?.completeDesktopExchange ||
      desktopAuthPollInFlightRef.current
    ) {
      return;
    }
    desktopAuthPollInFlightRef.current = true;
    try {
      const response = await getDesktopAuthStatus({
        desktopAuthId: pendingDesktopAuth.desktopAuthId,
        desktopAuthSecret: pendingDesktopAuth.desktopAuthSecret,
      });

      if (response.status === "pending" || response.status === "completed") {
        return;
      }

      if (
        response.status === "requires_email_code" &&
        response.pendingAuthId
      ) {
        context?.clearAuthError();
        setPendingEmailCodeSignInMethod(pendingDesktopAuth.provider);
        setPendingAuthId(response.pendingAuthId);
        setMode("code");
        setInfoBanner("");
        setLocalAuthError("");
        setPendingDesktopEmailResendState({
          desktopAuthId: pendingDesktopAuth.desktopAuthId,
          desktopAuthSecret: pendingDesktopAuth.desktopAuthSecret,
        });
        clearPendingDesktopAuth();
        return;
      }

      if (response.status === "awaiting_exchange" && response.exchangeCode) {
        const finished = await context.completeDesktopExchange({
          desktopAuthId: pendingDesktopAuth.desktopAuthId,
          desktopAuthSecret: pendingDesktopAuth.desktopAuthSecret,
          exchangeCode: response.exchangeCode,
          method: pendingDesktopAuth.provider,
        });
        if (finished) {
          clearPendingDesktopAuth();
        }
        return;
      }

      clearPendingDesktopAuth();
      setInfoBanner("");
      setLocalAuthError(
        response.status === "expired"
          ? "This browser sign-in expired. Start again to continue."
          : "Could not finish sign-in. Start again to continue.",
      );
    } catch (error) {
      if (pendingDesktopAuth) {
        setLocalAuthError(
          error instanceof Error
            ? error.message
            : "Could not finish sign-in. Try again.",
        );
      }
    } finally {
      desktopAuthPollInFlightRef.current = false;
    }
  }, [clearPendingDesktopAuth, context, pendingDesktopAuth]);

  const handleElectronProviderSignIn = useCallback(
    async (method: DesktopAuthProvider) => {
      setInfoBanner("");
      setLocalAuthError("");
      context?.clearAuthError();
      setFieldErrors({});
      setIsStartingDesktopAuth(true);
      try {
        setPendingDesktopEmailResendState(null);
        const response = await startDesktopAuth({
          provider: method,
          deviceId: getOrCreateDeviceId(),
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          deviceLabel: getTrustedDeviceLabel(),
          requestedPath: getAuthRedirectPathnameFromState(location.state) ?? "",
        });
        const nextPendingAuth: PendingDesktopAuthState = {
          desktopAuthId: response.desktopAuthId,
          desktopAuthSecret: response.desktopAuthSecret,
          provider: method,
          browserUrl: response.browserUrl,
          expiresAt: response.expiresAt,
          pollIntervalMs: response.pollIntervalMs,
        };
        setPendingDesktopAuth(nextPendingAuth);
        setPendingDesktopAuthState(nextPendingAuth);
        await openDesktopBrowserUrl(response.browserUrl);
        setInfoBanner("");
      } catch (error) {
        clearPendingDesktopAuth();
        setInfoBanner("");
        setLocalAuthError(
          error instanceof Error
            ? error.message
            : "Could not start browser sign-in. Try again.",
        );
      } finally {
        setIsStartingDesktopAuth(false);
      }
    },
    [clearPendingDesktopAuth, context, location.state, openDesktopBrowserUrl],
  );

  const handleHostedDesktopBrowserCompletion = useCallback(async () => {
    if (
      !context?.authenticateHumanWithFirebase ||
      !desktopBrowserProvider ||
      !desktopBrowserAuthId
    ) {
      return;
    }
    setDesktopBrowserFlowStatus("loading");
    setInfoBanner("");
    setLocalAuthError("");
    context?.clearAuthError();
    try {
      const authResult = await context.authenticateHumanWithFirebase({
        method: desktopBrowserProvider,
        interaction: "redirect",
      });
      if (authResult.status === "redirect-started") {
        setInfoBanner("Taking you to your account to finish sign-in…");
        return;
      }
      if (authResult.status === "requires-existing-method") {
        setDesktopBrowserFlowStatus("idle");
        setInfoBanner("");
        return;
      }
      if (authResult.status !== "success") {
        setDesktopBrowserFlowStatus("idle");
        return;
      }
      const idToken = await authResult.user.getIdToken(true);
      await completeDesktopAuth({
        desktopAuthId: desktopBrowserAuthId,
        idToken,
      });
      markDesktopBrokerAuthCompleted(desktopBrowserAuthId);
      try {
        sessionStorage.removeItem("ws-hosted-desktop-sso");
      } catch {
        // ignore
      }
      setDesktopSsoCompleteFlash(desktopBrowserProvider);
      window.location.replace(getDesktopSsoCompleteReplaceHref());
    } catch (error) {
      const errorCode =
        typeof error === "object" &&
          error &&
          "code" in error &&
          typeof (error as { code?: unknown }).code === "string"
          ? String((error as { code: string }).code)
          : "";
      setDesktopBrowserFlowStatus("idle");
      setInfoBanner("");
      setLocalAuthError(
        errorCode === "auth/popup-blocked" ||
          errorCode === "auth/popup-closed-by-user"
          ? "Provider sign-in did not complete. Use the button below to try again."
          : error instanceof Error
            ? error.message
            : "Could not finish browser sign-in. Try again.",
      );
    }
  }, [context, desktopBrowserAuthId, desktopBrowserProvider]);

  useEffect(() => {
    if (!isElectronRuntime || !pendingDesktopAuth) {
      return;
    }
    const expiresAt = Date.parse(pendingDesktopAuth.expiresAt);
    if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
      clearPendingDesktopAuth();
      setLocalAuthError("This browser sign-in expired. Start again to continue.");
    }
  }, [clearPendingDesktopAuth, isElectronRuntime, pendingDesktopAuth]);

  useEffect(() => {
    if (!isElectronRuntime || !pendingDesktopAuth || !window.electronAPI) {
      return;
    }
    return window.electronAPI.onDesktopAuthCallback((payload) => {
      if (payload.desktopAuthId !== pendingDesktopAuth.desktopAuthId) {
        return;
      }
      void pollDesktopAuthStatus();
    });
  }, [isElectronRuntime, pendingDesktopAuth, pollDesktopAuthStatus]);

  useEffect(() => {
    if (!isElectronRuntime || !pendingDesktopAuth || mode !== "signIn") {
      return;
    }
    void pollDesktopAuthStatus();
    const timerId = window.setInterval(() => {
      void pollDesktopAuthStatus();
    }, Math.max(1000, pendingDesktopAuth.pollIntervalMs || 1500));
    return () => window.clearInterval(timerId);
  }, [isElectronRuntime, mode, pendingDesktopAuth, pollDesktopAuthStatus]);

  useEffect(() => {
    if (!isHostedDesktopBrowserFlow || desktopBrowserAutoStartRef.current) {
      return;
    }
    desktopBrowserAutoStartRef.current = true;
    void handleHostedDesktopBrowserCompletion();
  }, [handleHostedDesktopBrowserCompletion, isHostedDesktopBrowserFlow]);

  const handleSignIn = async () => {
    setInfoBanner("");
    setLocalAuthError("");
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
      method: "password",
      email: trimmedEmail,
      password,
    });
    if (response?.requiresEmailCode && response.pendingAuthId) {
      setPendingAuthId(response.pendingAuthId);
      setMode("code");
      setInfoBanner("");
    }
  };

  const handleProviderSignIn = async (method: "google" | "microsoft") => {
    setInfoBanner("");
    setLocalAuthError("");
    setFieldErrors({});
    if (isElectronRuntime) {
      await handleElectronProviderSignIn(method);
      return;
    }
    const response = await context?.login({ method });
    if (response?.requiresEmailCode && response.pendingAuthId) {
      setPendingAuthId(response.pendingAuthId);
      setMode("code");
      setInfoBanner("");
    }
  };

  const handleVerifyCode = useCallback(async () => {
    setInfoBanner("");
    setLocalAuthError("");
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
    setLocalAuthError("");
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
    setLocalAuthError("");
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
    setLocalAuthError("");
    context?.clearAuthError();
    setForgotPasswordHasSubmit(false);
    setForgotPasswordEmailSent(false);
    setCode("");
    setPendingEmailCodeSignInMethod(null);
    setPendingDesktopEmailResendState(null);
    clearPendingDesktopAuth();
    setMode("signIn");
  };

  const handleFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (localAuthError) {
      return localAuthError;
    }
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
    } else if (isHostedDesktopBrowserFlow) {
      void handleHostedDesktopBrowserCompletion();
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
    if (isHostedDesktopBrowserFlow) {
      if (localAuthError) {
        return localAuthError;
      }
      return context?.authError || infoBanner;
    }
    if (context?.loginState === "success") {
      return "Opening WorshipSync…";
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
    context?.loginState !== "loading" &&
    context?.loginState !== "success";

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
    if (showWebSessionNavigatingChrome) {
      return "text-emerald-200";
    }
    if (localAuthError) {
      return "text-red-400";
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
    if (isHostedDesktopBrowserFlow) {
      if (desktopBrowserFlowStatus === "loading") {
        return "Connecting to your account…";
      }
      return desktopBrowserProvider === "google"
        ? "Continue with Google"
        : "Continue with Microsoft";
    }
    if (showWebSessionNavigatingChrome) return "Signed in";
    if (hasPendingDesktopAuth) return "Continue in browser";
    if (mode === "code") return "Verify this device";
    if (mode === "forgotPassword") {
      return forgotPasswordEmailSent ? "Check your email" : "Forgot password";
    }
    return "Sign in";
  })();

  const loginSubtext = (() => {
    if (showWebSessionNavigatingChrome) {
      return "Hang tight—this screen will switch in a moment.";
    }
    if (isHostedDesktopBrowserFlow) {
      if (desktopBrowserFlowStatus === "loading") {
        return "";
      }
      return "Use the same Google or Microsoft account you use for WorshipSync. If something went wrong, use the button below to try again.";
    }
    if (hasPendingDesktopAuth) {
      return "";
    }
    if (mode === "code") {
      return "We sent a six-digit code to your email. Enter it below to trust this device.";
    }
    if (mode === "forgotPassword") {
      if (forgotPasswordEmailSent) {
        return "If an account exists for that address, we sent a password reset link. It may take a minute to arrive.";
      }
      return "";
    }
    return "Choose a sign-in method to continue.";
  })();

  return (
    <AuthScreenMain
      className="relative"
      aria-busy={
        showWebSessionNavigatingChrome ||
        context?.loginState === "loading" ||
        isStartingDesktopAuth ||
        desktopBrowserFlowStatus === "loading"
      }
    >
      <div className="w-full max-w-md rounded-2xl border border-gray-500 bg-gray-800 p-6">
        {!isHostedDesktopBrowserFlow &&
          (mode === "code" || mode === "forgotPassword" ? (
            <div className="mb-3 flex justify-start">
              <Button
                type="button"
                variant="tertiary"
                svg={ArrowLeft}
                iconSize="sm"
                gap="gap-1.5"
                className="-ml-2 whitespace-nowrap px-2 py-1.5 text-sm"
                disabled={showWebSessionNavigatingChrome}
                onClick={handleBackToSignIn}
              >
                Back to sign in
              </Button>
            </div>
          ) : (
            <SetupScreenBackButton disabled={showWebSessionNavigatingChrome} />
          ))}
        <h1 className="text-balance text-2xl font-semibold tracking-tight text-white">
          {loginHeadline}
        </h1>
        {hasPendingDesktopAuth ? (
          <div className="mt-3 space-y-1.5">
            <p className="text-base font-medium leading-snug text-gray-100">
              Finish{" "}
              {pendingDesktopAuth?.provider === "google" ? "Google" : "Microsoft"} sign-in
              in your browser.
            </p>
            <p className="text-sm leading-relaxed text-gray-400">
              This window updates when sign-in completes.
            </p>
          </div>
        ) : loginSubtext ? (
          <p className="mt-2 text-sm leading-relaxed text-gray-300">{loginSubtext}</p>
        ) : null}

        {globalBannerMessage && (
          <div
            className={`mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm ${globalBannerTone}`}
            role="status"
            aria-live="polite"
          >
            {(isAuthServerChecking ||
              showWebSessionNavigatingChrome ||
              (isHostedDesktopBrowserFlow &&
                desktopBrowserFlowStatus === "loading")) && (
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

        {isHostedDesktopBrowserFlow && desktopBrowserProvider ? (
          <HostedDesktopBrowserLogin
            provider={desktopBrowserProvider}
            flowStatus={desktopBrowserFlowStatus}
            isAuthServerOnline={isAuthServerOnline}
            onContinueWithProvider={() => void handleHostedDesktopBrowserCompletion()}
          />
        ) : (
          <form className="flex flex-col" onSubmit={handleFormSubmit} noValidate>
            {mode === "signIn" && (
              <>
                {hasPendingDesktopAuth ? (
                  <div className="mt-5 rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200/90">
                      Having trouble?
                    </p>
                    <p className="mt-2 text-sm leading-relaxed text-gray-300">
                      Closed the sign-in tab? Use Reopen browser. To go back to other sign-in
                      options, use Cancel.
                    </p>
                    <div className="mt-4 flex flex-col gap-2">
                      <Button
                        type="button"
                        variant="primary"
                        className="w-full justify-center"
                        isLoading={isStartingDesktopAuth}
                        disabled={isStartingDesktopAuth || !pendingDesktopAuth}
                        onClick={() =>
                          pendingDesktopAuth
                            ? void openDesktopBrowserUrl(pendingDesktopAuth.browserUrl)
                            : undefined
                        }
                      >
                        Reopen browser
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        className="w-full justify-center"
                        disabled={isStartingDesktopAuth}
                        onClick={clearPendingDesktopAuth}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : null}

                {!hasPendingDesktopAuth ? (
                  <div className="mt-4 grid grid-cols-1 gap-2">
                    <div className="relative w-full">
                      <Button
                        type="button"
                        variant="primary"
                        svg={GoogleMark}
                        iconSize="sm"
                        gap="gap-2"
                        className="w-full justify-center"
                        disabled={isAuthActionDisabled}
                        onClick={() => void handleProviderSignIn("google")}
                      >
                        Continue with Google
                      </Button>
                      <div
                        className="pointer-events-none absolute inset-y-0 right-2 flex items-center"
                        aria-hidden={lastSignInMethod !== "google"}
                      >
                        <LastUsedBadge show={lastSignInMethod === "google"} />
                      </div>
                    </div>
                    <div className="relative w-full">
                      <Button
                        type="button"
                        variant="primary"
                        svg={MicrosoftMark}
                        iconSize="sm"
                        gap="gap-2"
                        className="w-full justify-center"
                        disabled={isAuthActionDisabled}
                        onClick={() => void handleProviderSignIn("microsoft")}
                      >
                        Continue with Microsoft
                      </Button>
                      <div
                        className="pointer-events-none absolute inset-y-0 right-2 flex items-center"
                        aria-hidden={lastSignInMethod !== "microsoft"}
                      >
                        <LastUsedBadge show={lastSignInMethod === "microsoft"} />
                      </div>
                    </div>
                  </div>
                ) : null}
                {!hasPendingDesktopAuth ? (
                  <>
                    <div className="relative mt-3 min-h-6 text-center text-sm leading-6 text-gray-400">
                      <span>Or use email and password</span>
                      <div
                        className="pointer-events-none absolute inset-y-0 right-0 flex items-center"
                        aria-hidden={lastSignInMethod !== "password"}
                      >
                        <LastUsedBadge show={lastSignInMethod === "password"} />
                      </div>
                    </div>
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
                      disabled={isSignInFormFieldsLocked}
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
                      disabled={isSignInFormFieldsLocked}
                    />
                    <div className="mt-2 flex justify-end">
                      <Button
                        type="button"
                        variant="textLink"
                        disabled={isSignInFormFieldsLocked}
                        aria-disabled={isSignInFormFieldsLocked}
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
                    {pendingLinkState ? (
                      <p className="mt-2 text-sm text-amber-200">
                        This email already exists. Sign in with the existing method to link{" "}
                        {pendingLinkState.providerId === "google.com" ? "Google" : "Microsoft"}.
                      </p>
                    ) : null}
                  </>
                ) : null}
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
                disabled={isSignInFormFieldsLocked}
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
                disabled={isSignInFormFieldsLocked}
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
                  isLoading={
                    context?.loginState === "loading" ||
                    context?.loginState === "success"
                  }
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
              ) : !(mode === "signIn" && hasPendingDesktopAuth) ? (
                <Button
                  type="submit"
                  variant="cta"
                  className="w-full justify-center"
                  isLoading={
                    context?.loginState === "loading" ||
                    showWebSessionNavigatingChrome
                  }
                  disabled={isAuthActionDisabled}
                >
                  Sign in
                </Button>
              ) : null}

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

              {mode === "signIn" && !hasPendingDesktopAuth ? (
                <Button
                  type="button"
                  variant="tertiary"
                  className="w-full justify-center"
                  disabled={isAuthActionDisabled}
                  onClick={() => context?.enterGuestMode(guestDestination)}
                >
                  Test as guest
                </Button>
              ) : null}
            </div>
          </form>
        )}
      </div>
    </AuthScreenMain>
  );
};

export default Login;
