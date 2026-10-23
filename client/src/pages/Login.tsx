import Spinner from "@/components/Spinner/Spinner";
import {
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, CheckCircle, Eye, EyeOff } from "lucide-react";
import Input from "../components/Input/Input";
import Button from "../components/Button/Button";
import { GoogleMark, MicrosoftMark } from "../components/AuthProviderMarks";
import SetupScreenBackButton from "../components/SetupScreenBackButton";
import AuthScreenMain from "../components/AuthScreenMain";
import HostedDesktopBrowserLogin from "./HostedDesktopBrowserLogin";
import PasswordStrengthIndicator from "../components/PasswordStrengthIndicator/PasswordStrengthIndicator";
import VerificationCodeInput from "../components/VerificationCodeInput/VerificationCodeInput";
import {
  AuthApiError,
  completeDesktopAuth,
  getDesktopAuthStatus,
  getEmailCodeHint,
  startDesktopAuth,
} from "../api/auth";
import type { DesktopAuthProvider } from "../api/authTypes";
import { GlobalInfoContext } from "../context/globalInfo";
import {
  clearPublicShellAuthReturnPath,
  getAuthRedirectPathnameFromState,
  getHumanPostAuthPath,
  peekPublicShellAuthReturnPath,
} from "../utils/authRedirectPath";
import {
  INVALID_EMAIL_FORMAT_MESSAGE,
  isValidEmailFormat,
} from "../utils/emailFormat";
import {
  getOrCreateDeviceId,
  getLastSignInMethod,
  getPendingProviderRedirectState,
  getPendingDesktopAuthState,
  setPendingDesktopAuthState,
  setPendingDesktopEmailResendState,
  setPendingEmailCodeSignInMethod,
  type PendingDesktopAuthState,
} from "../utils/authStorage";
import { getTrustedDeviceLabel } from "../utils/deviceInfo";
import {
  AUTH_DESKTOP_SIGN_IN_TIMED_OUT_MESSAGE,
  AUTH_EMAIL_CODE_EXPIRED_MESSAGE,
  getSignInFlowErrorMessage,
} from "../utils/authUserMessages";
import {
  getDesktopSsoCompleteReplaceHref,
  isDesktopBrokerAuthCompleted,
  markDesktopBrokerAuthCompleted,
  setDesktopSsoCompleteFlash,
} from "../utils/desktopSsoBrowserSession";
import { isElectron } from "../utils/environment";
import { passwordMeetsPolicy } from "../utils/passwordRequirements";
import { isCreateChurchUiEnabled } from "../utils/devFeatures";

type Mode = "signIn" | "code" | "forgotPassword" | "createChurch";

type LoginFieldErrors = {
  email?: string;
  password?: string;
  code?: string;
  churchName?: string;
  adminName?: string;
};

type DesktopBrowserFlowStatus = "idle" | "loading";

const RESEND_COOLDOWN_SEC = 60;
const HOSTED_DESKTOP_SSO_SESSION_KEY = "ws-hosted-desktop-sso";

type HostedDesktopHandoff = {
  desktopAuthId: string;
  provider: DesktopAuthProvider;
};

type RestoredEmailCodeChallenge = {
  pendingAuthId: string;
  verificationEmail: string;
};

// Reads never consume a handoff: Firebase redirects reload the whole page.
const readHostedDesktopHandoff = (
  searchParams = new URLSearchParams(),
): HostedDesktopHandoff | null => {
  try {
    const fromUrl = searchParams.has("desktopAuthId");
    const candidate: { desktopAuthId?: unknown; provider?: unknown } | null = fromUrl
      ? Object.fromEntries(searchParams)
      : JSON.parse(sessionStorage.getItem(HOSTED_DESKTOP_SSO_SESSION_KEY) || "null");
    const desktopAuthId =
      typeof candidate?.desktopAuthId === "string" ? candidate.desktopAuthId.trim() : "";
    const provider =
      typeof candidate?.provider === "string" ? candidate.provider.trim().toLowerCase() : "";
    if (
      desktopAuthId &&
      (provider === "google" || provider === "microsoft") &&
      !isDesktopBrokerAuthCompleted(desktopAuthId)
    ) {
      return { desktopAuthId, provider };
    }
  } catch {
    // Ignore invalid or unavailable session storage.
  }
  return null;
};

const FORGOT_PASSWORD_EMAIL_HELPER =
  "If an account exists for that email, you will receive a reset link shortly.";

const renderVerificationCodeSubtext = (email: string): ReactNode => {
  if (!email) {
    return "We sent a six-digit code to your email. Enter it below to trust this device.";
  }
  return (
    <>
      We sent a six-digit code to{" "}
      <span className="font-medium text-gray-100">{email}</span>. Enter it below
      to trust this device.
    </>
  );
};

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

/** Shared only while requests are active, to dedupe overlapping submissions. */
const emailCodeVerificationInFlight = new Set<string>();
const desktopBrowserHandoffsInFlight = new Map<string, Promise<boolean>>();
const getEmailCodeAttemptKey = (pendingAuthId: string, digits: string) =>
  JSON.stringify([pendingAuthId, digits]);

const Login = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const context = useContext(GlobalInfoContext);
  const [mode, setMode] = useState<Mode>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [churchName, setChurchName] = useState("");
  const [adminName, setAdminName] = useState("");
  const [code, setCode] = useState("");
  const [pendingAuthId, setPendingAuthId] = useState("");
  const attemptedEmailCodeVerificationsRef = useRef(new Set<string>());
  // A URL challenge remains authoritative while bootstrap restores other auth state.
  const explicitEmailCodeLinkRef = useRef<{ pendingAuthId: string } | null>(
    null,
  );
  const restoredEmailCodeChallengeRef =
    useRef<RestoredEmailCodeChallenge | null>(null);
  const explicitEmailCodeLinkLocationKeyRef = useRef<string | null>(null);
  const emailCodeChallengeGenerationRef = useRef(0);
  const activeEmailCodeAttemptRef = useRef<string | null>(null);
  const currentEmailCodeInputRef = useRef({ pendingAuthId, code });
  currentEmailCodeInputRef.current = { pendingAuthId, code };
  const currentAuthErrorRef = useRef(context?.authError);
  currentAuthErrorRef.current = context?.authError;
  const [isVerifyingCode, setIsVerifyingCode] = useState(false);
  const [isCompletingCodeSignIn, setIsCompletingCodeSignIn] = useState(false);
  const [verificationEmail, setVerificationEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<LoginFieldErrors>({});
  const [infoBanner, setInfoBanner] = useState("");
  const [localAuthError, setLocalAuthError] = useState("");
  const [resendCooldownSec, setResendCooldownSec] = useState(0);
  const [isResending, setIsResending] = useState(false);
  const [isStartingDesktopAuth, setIsStartingDesktopAuth] = useState(false);
  const [activeProviderSignIn, setActiveProviderSignIn] = useState<
    "google" | "microsoft" | null
  >(null);
  const createChurchPasswordStrengthId = useId();
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
  const [pendingProviderRedirect] = useState(() =>
    getPendingProviderRedirectState(),
  );
  const isElectronRuntime = isElectron();
  const [hostedDesktopHandoff, setHostedDesktopHandoff] =
    useState<HostedDesktopHandoff | null>(() =>
      isElectronRuntime ? null : readHostedDesktopHandoff(searchParams),
    );
  const hostedDesktopHandoffRef = useRef(hostedDesktopHandoff);
  const desktopBrowserAuthId = hostedDesktopHandoff?.desktopAuthId || "";
  const desktopBrowserProvider = hostedDesktopHandoff?.provider || null;

  useEffect(() => {
    if (isElectronRuntime || mode !== "signIn") {
      return;
    }
    if (!searchParams.has("desktopAuthId") && !searchParams.has("provider")) {
      return;
    }
    const handoff = readHostedDesktopHandoff(searchParams);
    if (handoff) {
      try {
        sessionStorage.setItem(HOSTED_DESKTOP_SSO_SESSION_KEY, JSON.stringify(handoff));
      } catch {
        // Keep the in-memory handoff when storage is unavailable.
      }
    }
    if (
      hostedDesktopHandoffRef.current?.desktopAuthId !== handoff?.desktopAuthId ||
      hostedDesktopHandoffRef.current?.provider !== handoff?.provider
    ) {
      hostedDesktopHandoffRef.current = handoff;
      setHostedDesktopHandoff(handoff);
      setDesktopBrowserFlowStatus("idle");
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
  /** A bootstrap-confirmed human session is ready to leave `/login`. */
  const isFinishingSignIn =
    context?.loginState === "success" && context?.sessionKind === "human";
  /**
   * Hosted desktop handoff runs in a normal browser tab that may already have a WorshipSync
   * web session. In that case `loginState` is still "success" from bootstrap, but the page copy
   * must describe returning to the desktop app, not finishing a web-only sign-in.
   */
  const showWebSessionNavigatingChrome = Boolean(
    isFinishingSignIn &&
    !isHostedDesktopBrowserFlow &&
    // Email-code progress is tied to its own request, never global session success.
    mode !== "code",
  );
  const isVerificationCodeBusy =
    mode === "code" && (isVerifyingCode || isCompletingCodeSignIn);
  /** Workstation and display success states do not complete human email-code sign-in. */
  const isAwaitingDeviceCode = mode === "code" && !isVerificationCodeBusy;
  const isAuthActionDisabled =
    context?.bootstrapStatus !== "ready" ||
    context?.loginState === "loading" ||
    (isFinishingSignIn && !isAwaitingDeviceCode) ||
    !isAuthServerOnline;
  const isSignInFormFieldsLocked =
    context?.bootstrapStatus !== "ready" ||
    !isAuthServerOnline ||
    context?.loginState === "loading" ||
    (isFinishingSignIn && !isAwaitingDeviceCode);
  const verifyEmailCode = context?.verifyEmailCode;
  const clearAuthError = context?.clearAuthError;
  const pendingLinkState = context?.pendingLinkState;
  const humanSessionRedirectStartedRef = useRef(false);
  const hasExplicitAuthFlowRef = useRef(false);
  const isMountedRef = useRef(false);
  const desktopAuthPollInFlightRef = useRef(false);
  const desktopBrowserAutoStartRef = useRef("");
  const providerRedirectCompletionStartedRef = useRef(false);

  const openVerificationCodeStep = useCallback(
    ({
      pendingId,
      verificationEmail: nextVerificationEmail,
    }: {
      pendingId: string;
      verificationEmail?: string;
    }) => {
      hasExplicitAuthFlowRef.current = true;
      explicitEmailCodeLinkRef.current = null;
      restoredEmailCodeChallengeRef.current = null;
      explicitEmailCodeLinkLocationKeyRef.current = null;
      emailCodeChallengeGenerationRef.current += 1;
      attemptedEmailCodeVerificationsRef.current.clear();
      setCode("");
      setPendingAuthId(pendingId);
      setVerificationEmail(nextVerificationEmail?.trim() || "");
      setMode("code");
      setFieldErrors({});
      setInfoBanner("");
    },
    [],
  );

  useLayoutEffect(() => {
    if (mode !== "code") {
      setResendCooldownSec(0);
      return;
    }
    setResendCooldownSec(RESEND_COOLDOWN_SEC);
  }, [mode]);

  useEffect(() => {
    if (mode !== "code") {
      attemptedEmailCodeVerificationsRef.current.clear();
    }
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
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const finishingProviderSignInRef = useRef<"google" | "microsoft" | null>(
    null,
  );
  /** True once `login()` sets `loginState` to loading for the current provider attempt. */
  const providerSignInSeenLoadingRef = useRef(false);

  const clearProviderSignInAttempt = useCallback(() => {
    setActiveProviderSignIn(null);
    finishingProviderSignInRef.current = null;
    providerSignInSeenLoadingRef.current = false;
  }, []);

  useEffect(() => {
    if (pendingDesktopAuth) {
      return;
    }
    setPendingDesktopAuthState(null);
  }, [pendingDesktopAuth]);

  useEffect(() => {
    if (activeProviderSignIn && context?.loginState === "loading") {
      providerSignInSeenLoadingRef.current = true;
    }
  }, [activeProviderSignIn, context?.loginState]);

  useEffect(() => {
    if (isElectronRuntime) {
      if (
        activeProviderSignIn &&
        !isStartingDesktopAuth &&
        !pendingDesktopAuth
      ) {
        clearProviderSignInAttempt();
      }
      return;
    }

    if (!activeProviderSignIn) {
      return;
    }

    const loginState = context?.loginState;
    if (loginState === "loading") {
      return;
    }

    if (loginState === "success") {
      setActiveProviderSignIn(null);
      return;
    }

    if (
      providerSignInSeenLoadingRef.current ||
      Boolean(context?.authError)
    ) {
      clearProviderSignInAttempt();
    }
  }, [
    activeProviderSignIn,
    clearProviderSignInAttempt,
    context?.authError,
    context?.loginState,
    isElectronRuntime,
    isStartingDesktopAuth,
    pendingDesktopAuth,
  ]);

  useEffect(() => {
    if (
      isElectronRuntime ||
      mode !== "signIn" ||
      isHostedDesktopBrowserFlow ||
      !pendingProviderRedirect ||
      !isAuthServerOnline ||
      providerRedirectCompletionStartedRef.current
    ) {
      return;
    }

    providerRedirectCompletionStartedRef.current = true;
    hasExplicitAuthFlowRef.current = true;
    setActiveProviderSignIn(pendingProviderRedirect.method);
    finishingProviderSignInRef.current = pendingProviderRedirect.method;
    void context
      ?.login({
        method: pendingProviderRedirect.method,
        interaction: "redirect",
        redirectOnly: true,
      })
      .then((response) => {
        if (!response?.redirectStarted) {
          clearProviderSignInAttempt();
        }
      });
  }, [
    clearProviderSignInAttempt,
    context,
    isAuthServerOnline,
    isElectronRuntime,
    isHostedDesktopBrowserFlow,
    mode,
    pendingProviderRedirect,
  ]);

  useEffect(() => {
    const codeParam = searchParams.get("code");
    const pendingParam = searchParams.get("pendingAuthId");
    const createChurchParam = searchParams.get("createChurch");
    const digits = codeParam ? codeParam.replace(/\D/g, "") : "";
    const hasValidCode = digits.length === 6;
    const pendingTrimmed = pendingParam?.trim() ?? "";
    const wantsCreateChurch =
      isCreateChurchUiEnabled() &&
      (createChurchParam === "1" || createChurchParam === "true");

    if (!hasValidCode && !pendingTrimmed && !wantsCreateChurch) {
      return;
    }

    if (hasValidCode && pendingTrimmed) {
      if (explicitEmailCodeLinkLocationKeyRef.current !== location.key) {
        emailCodeChallengeGenerationRef.current += 1;
        explicitEmailCodeLinkLocationKeyRef.current = location.key;
      }
      explicitEmailCodeLinkRef.current = {
        pendingAuthId: pendingTrimmed,
      };
      restoredEmailCodeChallengeRef.current = null;
      attemptedEmailCodeVerificationsRef.current.clear();
      setCode(digits);
      setPendingAuthId(pendingTrimmed);
    } else {
      explicitEmailCodeLinkRef.current = null;
      restoredEmailCodeChallengeRef.current = null;
      emailCodeChallengeGenerationRef.current += 1;
      explicitEmailCodeLinkLocationKeyRef.current = null;
    }
    if (pendingTrimmed && !hasValidCode) {
      attemptedEmailCodeVerificationsRef.current.clear();
      setCode("");
      setPendingAuthId(pendingTrimmed);
    } else if (hasValidCode && !pendingTrimmed) {
      attemptedEmailCodeVerificationsRef.current.clear();
      setCode(digits);
      setPendingAuthId("");
    }
    if (hasValidCode || pendingTrimmed) {
      setMode("code");
    } else if (wantsCreateChurch) {
      setMode("createChurch");
    }

    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("code");
        next.delete("pendingAuthId");
        next.delete("createChurch");
        return next;
      },
      { replace: true, state: location.state }
    );
  }, [location.key, location.state, searchParams, setSearchParams]);

  useEffect(() => {
    const pendingId = context?.pendingEmailVerificationId;
    const clearPending = context?.clearPendingEmailVerification;
    if (!pendingId || !clearPending) {
      return;
    }

    const verificationEmail =
      context?.pendingEmailVerificationEmail?.trim() || "";
    const explicitLink = explicitEmailCodeLinkRef.current;
    if (explicitLink) {
      if (explicitLink.pendingAuthId === pendingId) {
        setVerificationEmail(verificationEmail);
      } else {
        restoredEmailCodeChallengeRef.current = {
          pendingAuthId: pendingId,
          verificationEmail,
        };
      }
      clearPending();
      return;
    }

    context?.clearAuthError();
    clearProviderSignInAttempt();
    openVerificationCodeStep({
      pendingId,
      verificationEmail: verificationEmail || undefined,
    });
    clearPending();
  }, [clearProviderSignInAttempt, context, openVerificationCodeStep]);

  useEffect(() => {
    const explicitLink = explicitEmailCodeLinkRef.current;
    const restoredChallenge = restoredEmailCodeChallengeRef.current;
    if (
      !explicitLink ||
      explicitLink.pendingAuthId !== pendingAuthId ||
      context?.authError !== AUTH_EMAIL_CODE_EXPIRED_MESSAGE
    ) {
      return;
    }

    explicitEmailCodeLinkRef.current = null;
    explicitEmailCodeLinkLocationKeyRef.current = null;
    restoredEmailCodeChallengeRef.current = null;
    emailCodeChallengeGenerationRef.current += 1;
    setCode("");
    setFieldErrors({});
    if (restoredChallenge) {
      setPendingAuthId(restoredChallenge.pendingAuthId);
      setVerificationEmail(restoredChallenge.verificationEmail);
      setInfoBanner(
        restoredChallenge.verificationEmail
          ? `This link expired. Enter the latest code sent to ${restoredChallenge.verificationEmail}.`
          : "This link expired. Enter the latest code from your email or request a new code.",
      );
      clearAuthError?.();
    }
  }, [clearAuthError, context?.authError, pendingAuthId]);

  useEffect(() => {
    const hasAlternateAuthFlow = Boolean(
      activeProviderSignIn ||
        context?.pendingEmailVerificationId ||
        pendingLinkState ||
        pendingProviderRedirect ||
        pendingDesktopAuth ||
        isHostedDesktopBrowserFlow ||
        isStartingDesktopAuth ||
        desktopBrowserFlowStatus === "loading" ||
        (isCreateChurchUiEnabled() &&
          ["1", "true"].includes(searchParams.get("createChurch") || "")) ||
        mode === "forgotPassword" ||
        mode === "createChurch"
    );
    if (
      context?.bootstrapStatus !== "ready" ||
      context?.sessionKind !== "human" ||
      context?.loginState === "loading" ||
      hasAlternateAuthFlow ||
      hasExplicitAuthFlowRef.current ||
      humanSessionRedirectStartedRef.current
    ) {
      return;
    }

    humanSessionRedirectStartedRef.current = true;
    navigate(getHumanPostAuthPath(location), { replace: true });
  }, [
    activeProviderSignIn,
    context?.bootstrapStatus,
    context?.loginState,
    context?.pendingEmailVerificationId,
    context?.sessionKind,
    desktopBrowserFlowStatus,
    isHostedDesktopBrowserFlow,
    isStartingDesktopAuth,
    location,
    mode,
    navigate,
    pendingDesktopAuth,
    pendingLinkState,
    pendingProviderRedirect,
    searchParams,
  ]);

  useEffect(() => {
    if (
      mode !== "code" ||
      !pendingAuthId ||
      verificationEmail ||
      !isAuthServerOnline
    ) {
      return;
    }

    let cancelled = false;
    void getEmailCodeHint({ pendingAuthId })
      .then((response) => {
        if (!cancelled && response.verificationEmail) {
          setVerificationEmail(response.verificationEmail);
        }
      })
      .catch(() => {
        // Keep generic copy when the hint is unavailable.
      });

    return () => {
      cancelled = true;
    };
  }, [mode, pendingAuthId, verificationEmail, isAuthServerOnline]);

  const shellReturnPath = peekPublicShellAuthReturnPath();
  const shellReturnPathname = shellReturnPath
    ? shellReturnPath.split("?")[0]
    : null;
  const guestDestination =
    getAuthRedirectPathnameFromState(location.state) ??
    shellReturnPathname ??
    "/home";

  const clearPendingDesktopAuth = useCallback(() => {
    setPendingDesktopAuth(null);
    setPendingDesktopAuthState(null);
    clearProviderSignInAttempt();
  }, [clearProviderSignInAttempt]);

  useEffect(() => {
    if (
      mode !== "code" ||
      context?.authError !== AUTH_DESKTOP_SIGN_IN_TIMED_OUT_MESSAGE
    ) {
      return;
    }
    setCode("");
    setPendingAuthId("");
    setVerificationEmail("");
    setFieldErrors({});
    setInfoBanner("");
    setPendingEmailCodeSignInMethod(null);
    setPendingDesktopEmailResendState(null);
    context.clearPendingEmailVerification();
    clearPendingDesktopAuth();
    setMode("signIn");
  }, [clearPendingDesktopAuth, context, mode]);

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
        openVerificationCodeStep({
          pendingId: response.pendingAuthId,
          verificationEmail: response.verificationEmail || undefined,
        });
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
  }, [clearPendingDesktopAuth, context, openVerificationCodeStep, pendingDesktopAuth]);

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
          requestedPath:
            getAuthRedirectPathnameFromState(location.state) ??
            shellReturnPathname ??
            "",
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
        setActiveProviderSignIn(null);
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
    [clearPendingDesktopAuth, context, location.state, openDesktopBrowserUrl, shellReturnPathname],
  );

  const handleHostedDesktopBrowserCompletion = useCallback(async () => {
    if (
      !context?.authenticateHumanWithFirebase ||
      !desktopBrowserProvider ||
      !desktopBrowserAuthId ||
      isDesktopBrokerAuthCompleted(desktopBrowserAuthId)
    ) {
      return;
    }
    const isCurrentHandoff = () =>
      isMountedRef.current &&
      hostedDesktopHandoffRef.current?.desktopAuthId === desktopBrowserAuthId;
    const clearStoredHandoff = () => {
      if (readHostedDesktopHandoff()?.desktopAuthId === desktopBrowserAuthId) {
        try {
          sessionStorage.removeItem(HOSTED_DESKTOP_SSO_SESSION_KEY);
        } catch {
          // Ignore unavailable session storage.
        }
      }
    };
    if (!isCurrentHandoff()) return;
    const showCompletion = () => {
      setDesktopSsoCompleteFlash(desktopBrowserProvider);
      window.location.replace(getDesktopSsoCompleteReplaceHref());
    };
    const existingAttempt = desktopBrowserHandoffsInFlight.get(desktopBrowserAuthId);
    if (existingAttempt) {
      setDesktopBrowserFlowStatus("loading");
      const terminalRequest = await existingAttempt;
      if (!isCurrentHandoff()) return;
      if (isDesktopBrokerAuthCompleted(desktopBrowserAuthId)) showCompletion();
      else {
        if (terminalRequest) {
          hostedDesktopHandoffRef.current = null;
          setHostedDesktopHandoff(null);
        }
        setDesktopBrowserFlowStatus("idle");
      }
      return;
    }
    let finishAttempt!: (terminalRequest: boolean) => void;
    desktopBrowserHandoffsInFlight.set(desktopBrowserAuthId,
      new Promise<boolean>((resolve) => { finishAttempt = resolve; }),
    );
    let completingHandoff = false;
    let terminalRequest = false;
    setDesktopBrowserFlowStatus("loading");
    setInfoBanner("");
    setLocalAuthError("");
    context?.clearAuthError();
    try {
      const authResult = await context.authenticateHumanWithFirebase({
        method: desktopBrowserProvider,
        interaction: "redirect",
      });
      if (!isCurrentHandoff()) return;
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
      if (!isCurrentHandoff()) return;
      completingHandoff = true;
      await completeDesktopAuth({
        desktopAuthId: desktopBrowserAuthId,
        idToken,
      });
      clearStoredHandoff();
      markDesktopBrokerAuthCompleted(desktopBrowserAuthId);
      if (!isCurrentHandoff()) return;
      showCompletion();
    } catch (error) {
      // The existing protocol identifies expiration by message, not an error code.
      const isTerminalRequest =
        completingHandoff && error instanceof AuthApiError && (
          (error.status === 404 && error.message ===
            "This desktop sign-in request was not found. Start again in WorshipSync.") ||
          (error.status === 409 && error.message ===
            "This desktop sign-in request is already in use. Start again in WorshipSync.") ||
          (error.status === 400 && error.message ===
            "This desktop sign-in request expired. Start again in WorshipSync.")
        );
      terminalRequest = isTerminalRequest;
      if (isTerminalRequest) clearStoredHandoff();
      if (!isCurrentHandoff()) return;
      if (isTerminalRequest) {
        hostedDesktopHandoffRef.current = null;
        setHostedDesktopHandoff(null);
      }
      setDesktopBrowserFlowStatus("idle");
      setInfoBanner("");
      setLocalAuthError(
        desktopBrowserProvider
          ? getSignInFlowErrorMessage(error, {
              method: desktopBrowserProvider,
            })
          : "Could not finish browser sign-in. Try again.",
      );
    } finally {
      desktopBrowserHandoffsInFlight.delete(desktopBrowserAuthId);
      finishAttempt(terminalRequest);
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
    if (
      !isHostedDesktopBrowserFlow ||
      desktopBrowserAutoStartRef.current === desktopBrowserAuthId
    ) {
      return;
    }
    desktopBrowserAutoStartRef.current = desktopBrowserAuthId;
    void handleHostedDesktopBrowserCompletion();
  }, [desktopBrowserAuthId, handleHostedDesktopBrowserCompletion, isHostedDesktopBrowserFlow]);

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
    hasExplicitAuthFlowRef.current = true;
    const response = await context?.login({
      method: "password",
      email: trimmedEmail,
      password,
    });
    if (response?.requiresEmailCode && response.pendingAuthId) {
      openVerificationCodeStep({
        pendingId: response.pendingAuthId,
        verificationEmail: response.verificationEmail || trimmedEmail,
      });
    }
  };

  const validateCreateChurchIdentityFields = () => {
    const nextErrors: LoginFieldErrors = {};
    if (!churchName.trim()) {
      nextErrors.churchName = "Enter the church name.";
    }
    if (!adminName.trim()) {
      nextErrors.adminName = "Enter the admin name.";
    }
    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const finishCreateChurchChallenge = (response: {
    requiresEmailCode?: boolean;
    pendingAuthId?: string;
    verificationEmail?: string;
  }, fallbackEmail?: string) => {
    if (response.requiresEmailCode && response.pendingAuthId) {
      clearProviderSignInAttempt();
      openVerificationCodeStep({
        pendingId: response.pendingAuthId,
        verificationEmail: response.verificationEmail || fallbackEmail,
      });
    }
  };

  const handleCreateChurchWithPassword = async () => {
    setInfoBanner("");
    setLocalAuthError("");
    if (!validateCreateChurchIdentityFields()) {
      return;
    }
    const trimmedEmail = email.trim();
    const nextErrors: LoginFieldErrors = {};
    if (!trimmedEmail) {
      nextErrors.email = "Enter the admin email.";
    } else if (!isValidEmailFormat(trimmedEmail)) {
      nextErrors.email = INVALID_EMAIL_FORMAT_MESSAGE;
    }
    if (!password) {
      nextErrors.password = "Enter a password.";
    } else if (!passwordMeetsPolicy(password)) {
      nextErrors.password = "Meet every password requirement below.";
    }
    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors((prev) => ({ ...prev, ...nextErrors }));
      return;
    }
    setFieldErrors({});
    hasExplicitAuthFlowRef.current = true;
    const response = await context?.createChurchAccount({
      method: "password",
      churchName: churchName.trim(),
      adminName: adminName.trim(),
      adminEmail: trimmedEmail,
      password,
    });
    if (response) {
      finishCreateChurchChallenge(response, trimmedEmail);
    }
  };

  const handleCreateChurchWithProvider = async (
    method: "google" | "microsoft",
  ) => {
    setInfoBanner("");
    setLocalAuthError("");
    if (!validateCreateChurchIdentityFields()) {
      return;
    }
    hasExplicitAuthFlowRef.current = true;
    setActiveProviderSignIn(method);
    finishingProviderSignInRef.current = method;
    setFieldErrors({});
    const response = await context?.createChurchAccount({
      method,
      churchName: churchName.trim(),
      adminName: adminName.trim(),
    });
    if (response) {
      finishCreateChurchChallenge(response);
    }
  };

  const isProviderSignInLoading = (method: "google" | "microsoft") =>
    activeProviderSignIn === method ||
    (showWebSessionNavigatingChrome &&
      finishingProviderSignInRef.current === method);

  const handleProviderSignIn = async (method: "google" | "microsoft") => {
    hasExplicitAuthFlowRef.current = true;
    setActiveProviderSignIn(method);
    finishingProviderSignInRef.current = method;
    setInfoBanner("");
    setLocalAuthError("");
    setFieldErrors({});
    if (isElectronRuntime) {
      await handleElectronProviderSignIn(method);
      return;
    }
    const response = await context?.login({ method });
    if (response?.requiresEmailCode && response.pendingAuthId) {
      clearProviderSignInAttempt();
      openVerificationCodeStep({
        pendingId: response.pendingAuthId,
        verificationEmail: response.verificationEmail,
      });
    }
  };

  const handleVerifyCode = useCallback(async (automatic = false) => {
    setInfoBanner("");
    setLocalAuthError("");
    const digits = code.replace(/\D/g, "");
    const normalizedPendingAuthId = pendingAuthId.trim();
    const ownsExplicitLink =
      explicitEmailCodeLinkRef.current?.pendingAuthId ===
      normalizedPendingAuthId;
    if (!normalizedPendingAuthId || digits.length !== 6) {
      setFieldErrors({ code: "Enter the six-digit code from your email." });
      return false;
    }
    if (
      !verifyEmailCode ||
      context?.bootstrapStatus !== "ready" ||
      !isAuthServerOnline ||
      context?.loginState === "loading" ||
      (context?.pendingEmailVerificationId && !ownsExplicitLink)
    ) {
      return false;
    }
    if (
      automatic &&
      (context?.sessionKind === "human" ||
        activeProviderSignIn !== null ||
        pendingLinkState ||
        (context?.pendingEmailVerificationId &&
          explicitEmailCodeLinkRef.current?.pendingAuthId !==
            normalizedPendingAuthId) ||
        pendingProviderRedirect ||
        pendingDesktopAuth ||
        isHostedDesktopBrowserFlow ||
        isStartingDesktopAuth ||
        desktopBrowserFlowStatus === "loading")
    ) {
      return false;
    }

    const attemptKey = getEmailCodeAttemptKey(normalizedPendingAuthId, digits);
    const attemptGeneration = emailCodeChallengeGenerationRef.current;
    const attemptOwnsCurrentChallenge = () => {
      const current = currentEmailCodeInputRef.current;
      return (
        emailCodeChallengeGenerationRef.current === attemptGeneration &&
        current.pendingAuthId.trim() === normalizedPendingAuthId &&
        current.code.replace(/\D/g, "") === digits
      );
    };
    if (
      automatic &&
      attemptedEmailCodeVerificationsRef.current.has(attemptKey)
    ) {
      return false;
    }
    if (emailCodeVerificationInFlight.has(attemptKey)) {
      return false;
    }

    emailCodeVerificationInFlight.add(attemptKey);
    activeEmailCodeAttemptRef.current = attemptKey;
    attemptedEmailCodeVerificationsRef.current.add(attemptKey);
    hasExplicitAuthFlowRef.current = true;
    setIsVerifyingCode(true);
    setIsCompletingCodeSignIn(false);
    setFieldErrors({});
    try {
      const success = await verifyEmailCode({
        pendingAuthId: normalizedPendingAuthId,
        code: digits,
      });
      const stillCurrent = attemptOwnsCurrentChallenge();
      if (success && stillCurrent) {
        explicitEmailCodeLinkRef.current = null;
        restoredEmailCodeChallengeRef.current = null;
        attemptedEmailCodeVerificationsRef.current.clear();
        if (isMountedRef.current) {
          setIsCompletingCodeSignIn(true);
          setCode("");
          setPendingAuthId("");
          setVerificationEmail("");
        }
      } else if (!success && !stillCurrent && isMountedRef.current) {
        if (currentAuthErrorRef.current !== AUTH_EMAIL_CODE_EXPIRED_MESSAGE) {
          clearAuthError?.();
        }
      }
      return success;
    } finally {
      emailCodeVerificationInFlight.delete(attemptKey);
      if (activeEmailCodeAttemptRef.current === attemptKey) {
        activeEmailCodeAttemptRef.current = null;
        if (isMountedRef.current) {
          setIsVerifyingCode(false);
        }
      }
    }
  }, [
    activeProviderSignIn,
    code,
    context?.bootstrapStatus,
    clearAuthError,
    context?.loginState,
    context?.pendingEmailVerificationId,
    context?.sessionKind,
    desktopBrowserFlowStatus,
    isAuthServerOnline,
    isHostedDesktopBrowserFlow,
    isStartingDesktopAuth,
    pendingAuthId,
    pendingDesktopAuth,
    pendingLinkState,
    pendingProviderRedirect,
    verifyEmailCode,
  ]);

  useEffect(() => {
    const digits = code.replace(/\D/g, "");
    const normalizedPendingAuthId = pendingAuthId.trim();
    if (
      mode !== "code" ||
      !normalizedPendingAuthId ||
      digits.length !== 6 ||
      context?.bootstrapStatus !== "ready" ||
      context?.loginState === "loading" ||
      !isAuthServerOnline ||
      !verifyEmailCode ||
      context?.sessionKind === "human" ||
      (context?.pendingEmailVerificationId &&
        explicitEmailCodeLinkRef.current?.pendingAuthId !==
          normalizedPendingAuthId) ||
      activeProviderSignIn !== null ||
      pendingLinkState ||
      pendingProviderRedirect ||
      pendingDesktopAuth ||
      isHostedDesktopBrowserFlow ||
      isStartingDesktopAuth ||
      desktopBrowserFlowStatus === "loading" ||
      attemptedEmailCodeVerificationsRef.current.has(
        getEmailCodeAttemptKey(normalizedPendingAuthId, digits),
      )
    ) {
      return;
    }
    void handleVerifyCode(true);
  }, [
    activeProviderSignIn,
    code,
    context?.bootstrapStatus,
    context?.loginState,
    context?.pendingEmailVerificationId,
    context?.sessionKind,
    desktopBrowserFlowStatus,
    handleVerifyCode,
    isAuthServerOnline,
    isHostedDesktopBrowserFlow,
    isStartingDesktopAuth,
    mode,
    pendingAuthId,
    pendingDesktopAuth,
    pendingLinkState,
    pendingProviderRedirect,
    verifyEmailCode,
  ]);

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
    const requestedPendingAuthId = pendingAuthId;
    const requestedGeneration = emailCodeChallengeGenerationRef.current;
    setIsResending(true);
    setInfoBanner("");
    setLocalAuthError("");
    try {
      const result = await context?.resendEmailCode({
        pendingAuthId: requestedPendingAuthId,
      });
      if (
        requestedGeneration !== emailCodeChallengeGenerationRef.current ||
        currentEmailCodeInputRef.current.pendingAuthId !== requestedPendingAuthId
      ) {
        return;
      }
      if (result?.pendingAuthId) {
        explicitEmailCodeLinkRef.current = null;
        restoredEmailCodeChallengeRef.current = null;
        explicitEmailCodeLinkLocationKeyRef.current = null;
        emailCodeChallengeGenerationRef.current += 1;
        attemptedEmailCodeVerificationsRef.current.clear();
        setPendingAuthId(result.pendingAuthId);
        if (result.verificationEmail) {
          setVerificationEmail(result.verificationEmail);
        }
        setCode("");
        setResendCooldownSec(RESEND_COOLDOWN_SEC);
        setFieldErrors({});
        setInfoBanner(
          result.verificationEmail
            ? `We sent a new code to ${result.verificationEmail}.`
            : "We sent a new code to your email.",
        );
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
    setVerificationEmail("");
    setChurchName("");
    setAdminName("");
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
    } else if (mode === "createChurch") {
      void handleCreateChurchWithPassword();
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
    // Not while a code is outstanding: nothing is opening until it is entered.
    if (isFinishingSignIn && mode !== "code") {
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

  const isExpiredEmailCodeError =
    mode === "code" && context?.authError === AUTH_EMAIL_CODE_EXPIRED_MESSAGE;

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
    if (mode === "code") {
      if (isVerifyingCode) return "Verifying your code";
      if (isCompletingCodeSignIn) return "You’re signed in";
      return isExpiredEmailCodeError ? "Get a new code" : "Check your email";
    }
    if (mode === "forgotPassword") {
      return forgotPasswordEmailSent ? "Check your email" : "Forgot password";
    }
    if (mode === "createChurch") {
      return "Create a church";
    }
    return "Sign in";
  })();

  const loginSubtext: ReactNode = (() => {
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
    if (mode === "code" && context?.bootstrapStatus !== "ready") {
      return "Checking your sign-in session…";
    }
    if (mode === "code" && isVerifyingCode) {
      return "Verifying the code you entered…";
    }
    if (mode === "code" && isCompletingCodeSignIn) {
      return "Opening WorshipSync…";
    }
    if (mode === "code" && isExpiredEmailCodeError) {
      return verificationEmail
        ? `We'll send a new six-digit code to ${verificationEmail}.`
        : "We'll send a new six-digit code to your email.";
    }
    if (mode === "code") {
      return renderVerificationCodeSubtext(verificationEmail);
    }
    if (mode === "forgotPassword") {
      if (forgotPasswordEmailSent) {
        return "If an account exists for that address, we sent a password reset link. It may take a minute to arrive.";
      }
      return "";
    }
    if (mode === "createChurch") {
      return "Creates the church and signs in the first admin. That account can only belong to one church at a time.";
    }
    return "Choose a sign-in method to continue.";
  })();

  return (
    <AuthScreenMain
      className="relative"
      aria-busy={
        showWebSessionNavigatingChrome ||
        isVerificationCodeBusy ||
        context?.loginState === "loading" ||
        isStartingDesktopAuth ||
        desktopBrowserFlowStatus === "loading"
      }
    >
      <div className="w-full max-w-md rounded-2xl border border-gray-500 bg-gray-800 p-6">
        {!isHostedDesktopBrowserFlow &&
          (mode === "code" ||
            mode === "forgotPassword" ||
            mode === "createChurch" ? (
            <div className="mb-3 flex justify-start">
              <Button
                type="button"
                variant="tertiary"
                svg={ArrowLeft}
                iconSize="sm"
                gap="gap-1.5"
                className="-ml-2 whitespace-nowrap px-2 py-1.5 text-sm"
                disabled={showWebSessionNavigatingChrome || isVerificationCodeBusy}
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
                <Spinner size="sm" className="shrink-0" />
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
                        isLoading={isProviderSignInLoading("google")}
                        disabled={
                          isAuthActionDisabled || activeProviderSignIn !== null
                        }
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
                        isLoading={isProviderSignInLoading("microsoft")}
                        disabled={
                          isAuthActionDisabled || activeProviderSignIn !== null
                        }
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

            {mode === "createChurch" ? (
              <>
                <Input
                  className="mt-4"
                  id="create-church-name"
                  label="Church name"
                  value={churchName}
                  errorText={fieldErrors.churchName}
                  onChange={(value) => {
                    setChurchName(String(value));
                    setInfoBanner("");
                    if (fieldErrors.churchName) {
                      setFieldErrors((prev) => ({
                        ...prev,
                        churchName: undefined,
                      }));
                    }
                  }}
                  autoComplete="organization"
                  disabled={isSignInFormFieldsLocked}
                  autoFocus
                />
                <Input
                  className="mt-3"
                  id="create-church-admin-name"
                  label="Admin name"
                  value={adminName}
                  errorText={fieldErrors.adminName}
                  onChange={(value) => {
                    setAdminName(String(value));
                    setInfoBanner("");
                    if (fieldErrors.adminName) {
                      setFieldErrors((prev) => ({
                        ...prev,
                        adminName: undefined,
                      }));
                    }
                  }}
                  autoComplete="name"
                  disabled={isSignInFormFieldsLocked}
                />
                <div className="mt-4 grid grid-cols-1 gap-2">
                  <Button
                    type="button"
                    variant="primary"
                    svg={GoogleMark}
                    iconSize="sm"
                    gap="gap-2"
                    className="w-full justify-center"
                    isLoading={isProviderSignInLoading("google")}
                    disabled={
                      isAuthActionDisabled || activeProviderSignIn !== null
                    }
                    onClick={() => void handleCreateChurchWithProvider("google")}
                  >
                    Create with Google
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    svg={MicrosoftMark}
                    iconSize="sm"
                    gap="gap-2"
                    className="w-full justify-center"
                    isLoading={isProviderSignInLoading("microsoft")}
                    disabled={
                      isAuthActionDisabled || activeProviderSignIn !== null
                    }
                    onClick={() =>
                      void handleCreateChurchWithProvider("microsoft")
                    }
                  >
                    Create with Microsoft
                  </Button>
                </div>
                <p className="mt-3 text-center text-sm text-gray-400">
                  Or create with email and password
                </p>
                <Input
                  className="mt-4"
                  id="create-church-email"
                  label="Admin email"
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
                  id="create-church-password"
                  label="Password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  errorText={fieldErrors.password}
                  onChange={(value) => {
                    setPassword(String(value));
                    setInfoBanner("");
                    if (fieldErrors.password) {
                      setFieldErrors((prev) => ({
                        ...prev,
                        password: undefined,
                      }));
                    }
                  }}
                  svg={showPassword ? EyeOff : Eye}
                  svgAction={() => setShowPassword((current) => !current)}
                  svgActionAriaLabel={
                    showPassword ? "Hide password" : "Show password"
                  }
                  autoComplete="new-password"
                  disabled={isSignInFormFieldsLocked}
                  aria-describedby={createChurchPasswordStrengthId}
                />
                <PasswordStrengthIndicator
                  id={createChurchPasswordStrengthId}
                  password={password}
                  className="mt-2"
                />
              </>
            ) : null}

            {isVerificationCodeBusy ? (
              <div
                className="mt-4 flex flex-col items-center gap-3 rounded-xl border border-gray-600 bg-white/5 px-4 py-6 text-center"
                role="status"
                aria-live="polite"
              >
                <Spinner size="lg" width="40px" className="shrink-0 text-cyan-400" />
                <p className="text-sm text-gray-200">
                  {isVerifyingCode ? "Verifying your code…" : "Opening WorshipSync…"}
                </p>
              </div>
            ) : mode === "code" && !isExpiredEmailCodeError ? (
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
                disabled={isSignInFormFieldsLocked || isVerificationCodeBusy}
                autoFocus
                errorText={fieldErrors.code}
              />
            ) : null}

            {mode === "code" &&
              !isVerificationCodeBusy &&
              !isExpiredEmailCodeError && (
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
              {mode === "code" && !isVerificationCodeBusy ? (
                <Button
                  type={isExpiredEmailCodeError ? "button" : "submit"}
                  variant="cta"
                  className="w-full justify-center"
                  isLoading={isVerifyingCode}
                  disabled={
                    isVerificationCodeBusy ||
                    (isExpiredEmailCodeError
                      ? !canResendCode
                      : isAuthActionDisabled)
                  }
                  onClick={
                    isExpiredEmailCodeError
                      ? () => void handleResendCode()
                      : undefined
                  }
                >
                  {isExpiredEmailCodeError ? "Get new code" : "Verify device"}
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
              ) : mode === "createChurch" ? (
                <Button
                  type="submit"
                  variant="cta"
                  className="w-full justify-center"
                  isLoading={context?.loginState === "loading"}
                  disabled={isAuthActionDisabled}
                >
                  Create church
                </Button>
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
                <>
                  <Button
                    type="button"
                    variant="tertiary"
                    className="w-full justify-center"
                    disabled={isAuthActionDisabled}
                    onClick={() => {
                      clearPublicShellAuthReturnPath();
                      context?.enterGuestMode(guestDestination);
                    }}
                  >
                    Test as guest
                  </Button>
                  {isCreateChurchUiEnabled() ? (
                    <Button
                      type="button"
                      variant="textLink"
                      className="w-full justify-center"
                      disabled={isAuthActionDisabled}
                      onClick={() => {
                        setFieldErrors({});
                        setInfoBanner("");
                        setLocalAuthError("");
                        context?.clearAuthError();
                        setMode("createChurch");
                      }}
                    >
                      Create church
                    </Button>
                  ) : null}
                </>
              ) : null}
            </div>
          </form>
        )}
      </div>
      <footer className="mt-6 flex w-full flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm text-gray-300">
        <Button
          component="link"
          to="/support"
          variant="none"
          className="h-auto cursor-pointer p-0 font-normal text-gray-300 underline underline-offset-2 hover:text-white"
        >
          Support
        </Button>
        <span aria-hidden className="text-gray-600">
          ·
        </span>
        <Button
          component="link"
          to="/privacy"
          variant="none"
          className="h-auto cursor-pointer p-0 font-normal text-gray-300 underline underline-offset-2 hover:text-white"
        >
          Privacy Policy
        </Button>
        <span aria-hidden className="text-gray-600">
          ·
        </span>
        <Button
          component="link"
          to="/terms"
          variant="none"
          className="h-auto cursor-pointer p-0 font-normal text-gray-300 underline underline-offset-2 hover:text-white"
        >
          Terms of Service
        </Button>
      </footer>
    </AuthScreenMain>
  );
};

export default Login;
