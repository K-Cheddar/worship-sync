import {
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import {
  createUserWithEmailAndPassword,
  signOut,
  updateProfile,
} from "firebase/auth";
import AuthScreenMain from "../components/AuthScreenMain";
import Button from "../components/Button/Button";
import { GoogleMark, MicrosoftMark } from "../components/AuthProviderMarks";
import {
  acceptInvite,
  cancelInviteSmsConsent,
  createHumanSession,
  fetchInviteSmsContext,
  fetchInvitePreview,
  getAuthBootstrap,
  logoutSession,
  submitInviteSmsConsent,
  verifyInviteSmsConsent,
} from "../api/auth";
import { getHumanAuth } from "../firebase/apps";
import { GlobalInfoContext } from "../context/globalInfo";
import Input from "../components/Input/Input";
import SmsConsentDisclosure from "../components/SmsConsentDisclosure";
import PasswordStrengthIndicator from "../components/PasswordStrengthIndicator/PasswordStrengthIndicator";
import {
  getFirebaseSignInMessage,
  isFirebaseAuthError,
} from "../utils/authUserMessages";
import {
  getOrCreateDeviceId,
  inferLastSignInMethodFromProviderIds,
  setHumanApiToken,
  setPendingEmailCodeSignInMethod,
} from "../utils/authStorage";
import { isPackagedElectronRenderer } from "../utils/environment";
import {
  getAuthRedirectToFromState,
  setPublicShellAuthReturnPath,
} from "../utils/authRedirectPath";
import {
  assignOperatorAppLocation,
  isPublicPathShell,
} from "../utils/operatorAppNavigation";
import { getTrustedDeviceLabel } from "../utils/deviceInfo";
import {
  INVALID_EMAIL_FORMAT_MESSAGE,
  isValidEmailFormat,
} from "../utils/emailFormat";
import {
  PASSWORD_CHARACTER_TYPES_MIN,
  PASSWORD_POLICY_MIN_LENGTH,
  passwordMeetsPolicy,
} from "../utils/passwordRequirements";
import { createSmsConsentCapabilities } from "../utils/smsConsentCapabilities";
import { formatUsPhoneInput } from "../utils/phoneNumber";
import Checkbox from "../components/Checkbox/Checkbox";

const INVITE_TOKEN_STORAGE_KEY = "worshipsync_pending_invite_token";
const INVITE_RECOVERY_STORAGE_KEY = "worshipsync_invite_recovery";
const INVITE_RECOVERY_TTL_MS = 24 * 60 * 60 * 1000;

const getValidatedRecoveredInviteToken = () => {
  if (typeof window === "undefined") return "";
  try {
    const raw = window.sessionStorage.getItem(INVITE_RECOVERY_STORAGE_KEY);
    if (!raw) return "";
    const recovery = JSON.parse(raw) as Partial<InviteRecoveryState>;
    const acceptedAt = Number(recovery.acceptedAt);
    const age = Date.now() - acceptedAt;
    if (
      recovery.accepted === true &&
      typeof recovery.token === "string" &&
      recovery.token.trim() &&
      Number.isFinite(acceptedAt) &&
      age >= 0 &&
      age <= INVITE_RECOVERY_TTL_MS
    ) return recovery.token;
  } catch {
    // A malformed recovery record cannot supply an invite credential.
  }
  return "";
};

type InviteRecoveryState = {
  accepted: true;
  token: string;
  acceptedAt: number;
  smsConsentChecked?: boolean;
  smsPhoneConfirmed?: string;
  smsDeliveryState?: "sending" | "sent" | "failed" | "uncertain" | "expired";
  smsVerification?: {
    phoneNumber: string;
    expectedRosterPhoneNumber: string;
    challengeId: string;
    cancellationToken: string;
  };
  smsCancellationPending?: boolean;
};
type InviteFieldErrors = {
  email?: string;
  password?: string;
  displayName?: string;
};

const getCreateAccountErrorMessage = (error: unknown) => {
  if (isFirebaseAuthError(error)) {
    if (error.code === "auth/email-already-in-use") {
      return "That email already has a WorshipSync account. You can’t use it for this invite yet. Try another email or ask your admin to resend the invite to a different address.";
    }
    if (error.code === "auth/weak-password") {
      return `Use at least ${PASSWORD_POLICY_MIN_LENGTH} characters and any ${PASSWORD_CHARACTER_TYPES_MIN} of: uppercase letter, lowercase letter, number, symbol.`;
    }
    if (error.code === "auth/invalid-email") {
      return INVALID_EMAIL_FORMAT_MESSAGE;
    }
    if (error.code === "auth/network-request-failed") {
      return "Could not reach the sign-in service. Check your connection and try again.";
    }
    return "Could not create your account. Check the details and try again.";
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Could not create your account and accept this invite.";
};

const getInviteFlowErrorMessage = (
  error: unknown,
  options?: { provider?: "google" | "microsoft" },
) => {
  if (isFirebaseAuthError(error)) {
    if (options?.provider) {
      return getFirebaseSignInMessage(error, { method: options.provider });
    }
    return "Could not complete sign-in for this invite. Try again.";
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return "Could not accept this invite.";
};

const InviteAccept = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const context = useContext(GlobalInfoContext);
  const goToOperator = (
    pathWithOptionalSearch: string,
    options?: { replace?: boolean; state?: unknown },
  ) => {
    if (isPublicPathShell()) {
      // Full-page assign drops React Router state; persist return path for Login.
      const returnTo = getAuthRedirectToFromState(options?.state);
      if (returnTo) {
        setPublicShellAuthReturnPath(returnTo);
      }
      assignOperatorAppLocation(pathWithOptionalSearch);
      return;
    }
    navigate(pathWithOptionalSearch, options);
  };
  const [signedInEmail, setSignedInEmail] = useState(
    () => getHumanAuth().currentUser?.email || ""
  );
  const token = useMemo(() => {
    const fromUrl = searchParams.get("token") || "";
    if (fromUrl) {
      return fromUrl;
    }
    if (typeof window === "undefined") {
      return "";
    }
    return window.sessionStorage.getItem(INVITE_TOKEN_STORAGE_KEY) || getValidatedRecoveredInviteToken();
  }, [searchParams]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [fieldErrors, setFieldErrors] = useState<InviteFieldErrors>({});
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [inviteAccepted, setInviteAccepted] = useState(false);
  const [needsSessionRetry, setNeedsSessionRetry] = useState(false);
  /** `undefined` while loading preview for a token; `null` if load failed or missing name. */
  const [inviteChurchName, setInviteChurchName] = useState<string | null | undefined>(
    undefined
  );
  const [smsInviteConsentEnabled, setSmsInviteConsentEnabled] = useState(false);
  const [rosterPhoneNumber, setRosterPhoneNumber] = useState("");
  const [smsConsentStatus, setSmsConsentStatus] = useState<
    "none" | "pending" | "opted_in" | "opted_out"
  >("none");
  const rosterPhoneNumberRef = useRef("");
  const smsConsentStatusRef = useRef<"none" | "pending" | "opted_in" | "opted_out">("none");
  const [smsConsentChecked, setSmsConsentChecked] = useState(() =>
    typeof window !== "undefined" && Boolean(token) &&
    window.sessionStorage.getItem(`worshipsync_invite_sms_consent:${token}`) === "true",
  );
  const [smsPhoneNumber, setSmsPhoneNumber] = useState("");
  const [smsPhoneConfirmed, setSmsPhoneConfirmed] = useState("");
  const [smsDeliveryState, setSmsDeliveryState] = useState<InviteRecoveryState["smsDeliveryState"]>();
  const [smsVerification, setSmsVerification] = useState<
    InviteRecoveryState["smsVerification"] | null
  >(null);
  const [smsVerificationCode, setSmsVerificationCode] = useState("");
  const [smsErrorMessage, setSmsErrorMessage] = useState("");
  const [isSmsWorking, setIsSmsWorking] = useState(false);
  const smsOperationInFlightRef = useRef(false);
  const beginSmsOperation = () => {
    if (smsOperationInFlightRef.current) return false;
    smsOperationInFlightRef.current = true;
    setIsSmsWorking(true);
    return true;
  };
  const endSmsOperation = () => {
    smsOperationInFlightRef.current = false;
    setIsSmsWorking(false);
  };
  const smsIntentTokenRef = useRef(token);
  const passwordStrengthDescId = useId();

  const persistInviteRecovery = (
    acceptedToken: string,
    extra: Pick<InviteRecoveryState, "smsConsentChecked" | "smsVerification" | "smsCancellationPending" | "smsPhoneConfirmed" | "smsDeliveryState"> = {},
  ) => {
    if (typeof window === "undefined") {
      return;
    }
    const payload: InviteRecoveryState = {
      accepted: true,
      token: acceptedToken,
      acceptedAt: Date.now(),
      ...extra,
    };
    window.sessionStorage.setItem(INVITE_RECOVERY_STORAGE_KEY, JSON.stringify(payload));
  };

  const clearInviteRecovery = () => {
    if (typeof window === "undefined") {
      return;
    }
    window.sessionStorage.removeItem(INVITE_RECOVERY_STORAGE_KEY);
    if (token) {
      window.sessionStorage.removeItem(`worshipsync_invite_sms_consent:${token}`);
      window.sessionStorage.removeItem(`worshipsync_invite_sms_phone:${token}`);
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (smsIntentTokenRef.current !== token) {
      smsIntentTokenRef.current = token;
      setSmsConsentChecked(
        Boolean(token) &&
          window.sessionStorage.getItem(`worshipsync_invite_sms_consent:${token}`) === "true",
      );
      setSmsPhoneNumber("");
      setSmsPhoneConfirmed("");
      setSmsDeliveryState(undefined);
      setSmsVerification(null);
      return;
    }
    if (token) {
      window.sessionStorage.setItem(
        `worshipsync_invite_sms_consent:${token}`,
        String(smsConsentChecked),
      );
      window.sessionStorage.removeItem(`worshipsync_invite_sms_phone:${token}`);
    }
  }, [smsConsentChecked, token]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (token) {
      window.sessionStorage.setItem(INVITE_TOKEN_STORAGE_KEY, token);
    } else {
      window.sessionStorage.removeItem(INVITE_TOKEN_STORAGE_KEY);
    }
  }, [token]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const raw = window.sessionStorage.getItem(INVITE_RECOVERY_STORAGE_KEY);
    if (!raw) {
      const pendingCancellation = token
        ? window.sessionStorage.getItem(`worshipsync_invite_sms_cancel:${token}`)
        : null;
      if (pendingCancellation) {
        try {
          const intent = JSON.parse(pendingCancellation) as InviteRecoveryState["smsVerification"];
          if (intent?.challengeId && intent.cancellationToken && intent.phoneNumber) {
            setInviteAccepted(true);
            setSmsConsentChecked(false);
            setSmsVerification(intent);
            setNeedsSessionRetry(true);
            setSmsErrorMessage("SMS signup cancellation still needs confirmation. Retry it or continue without SMS.");
          }
        } catch {
          window.sessionStorage.removeItem(`worshipsync_invite_sms_cancel:${token}`);
        }
      }
      return;
    }
    try {
      const parsed = JSON.parse(raw) as Partial<InviteRecoveryState>;
      if (
        parsed.accepted === true &&
        typeof parsed.token === "string" &&
        parsed.token.length > 0 &&
        (!token || parsed.token === token)
      ) {
        setInviteAccepted(true);
        const recoveredSmsVerification = parsed.smsVerification || null;
        setSmsConsentChecked(parsed.smsConsentChecked === true);
        setSmsPhoneConfirmed(parsed.smsPhoneConfirmed || "");
        setSmsDeliveryState(parsed.smsDeliveryState);
        setSmsVerification(recoveredSmsVerification);
        setNeedsSessionRetry(true);
        return;
      }
    } catch {
      // Ignore malformed recovery payload and clear it below.
    }
    window.sessionStorage.removeItem(INVITE_RECOVERY_STORAGE_KEY);
    if (token) {
      window.sessionStorage.removeItem(`worshipsync_invite_sms_consent:${token}`);
      window.sessionStorage.removeItem(`worshipsync_invite_sms_phone:${token}`);
    }
    setInviteAccepted(false);
    setNeedsSessionRetry(false);
  }, [token]);

  useEffect(() => {
    const auth = getHumanAuth();
    return auth.onAuthStateChanged((user) => {
      setSignedInEmail(user?.email || "");
    });
  }, []);

  useEffect(() => {
    if (!token) {
      setInviteChurchName(undefined);
      return;
    }
    let cancelled = false;
    setInviteChurchName(undefined);
    setSmsInviteConsentEnabled(false);
    setRosterPhoneNumber("");
    rosterPhoneNumberRef.current = "";
    setSmsConsentStatus("none");
    smsConsentStatusRef.current = "none";
    setSmsPhoneNumber("");
    setSmsPhoneConfirmed("");
    setSmsDeliveryState(undefined);
    void fetchInvitePreview(token)
      .then((data) => {
        if (cancelled) {
          return;
        }
        if (!data.success) {
          setInviteChurchName(null);
          setSmsInviteConsentEnabled(false);
          return;
        }
        setInviteChurchName(data.churchName?.trim() || null);
        setSmsInviteConsentEnabled(data.smsInviteConsentEnabled === true);
      })
      .catch(() => {
        if (!cancelled) {
          setInviteChurchName(null);
          setSmsInviteConsentEnabled(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const joinHeadline =
    inviteChurchName != null && inviteChurchName.length > 0
      ? `Join ${inviteChurchName}`
      : "Join this church";

  const clearMessages = () => {
    setErrorMessage("");
    setStatusMessage("");
  };
  const clearCredentials = () => {
    setPassword("");
    setEmail("");
    setDisplayName("");
  };

  const clearFieldError = (key: keyof InviteFieldErrors) => {
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const clearCurrentAccount = async () => {
    if (getHumanAuth().currentUser) {
      try {
        await logoutSession();
      } catch {
        // If there is no active app session, continue clearing the local auth user.
      }
      await signOut(getHumanAuth()).catch(() => undefined);
      await context?.refreshAuthBootstrap().catch(() => undefined);
    }
  };

  /**
   * Drops the current session so the sign-in options return, for someone who
   * opened an invite while signed in as a different account. The pending token
   * is kept, so they land back here after signing in as the invited address.
   */
  const handleUseDifferentAccount = async () => {
    setErrorMessage("");
    setStatusMessage("");
    await clearCurrentAccount();
    setSignedInEmail("");
  };

  const acceptInviteMembershipWithSignedInUser = async () => {
    const currentUser = getHumanAuth().currentUser;
    if (!currentUser) {
      setErrorMessage("Sign in with the invited email address before accepting this invite.");
      throw new Error("No signed-in user was found.");
    }

    const idToken = await currentUser.getIdToken(true);
    if (!inviteAccepted) {
      await acceptInvite({
        token,
        idToken,
      });
      setInviteAccepted(true);
      persistInviteRecovery(token, { smsConsentChecked });
      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(INVITE_TOKEN_STORAGE_KEY);
      }
    }
    if (smsInviteConsentEnabled) {
      try {
        const details = await fetchInviteSmsContext({ inviteToken: token, idToken });
        const nextPhoneNumber = details.rosterPhoneNumber || "";
        const nextConsentStatus = details.smsConsentStatus || "none";
        rosterPhoneNumberRef.current = nextPhoneNumber;
        smsConsentStatusRef.current = nextConsentStatus;
        setRosterPhoneNumber(nextPhoneNumber);
        if (details.rosterPhoneNumber) setSmsPhoneNumber(details.rosterPhoneNumber);
        setSmsPhoneConfirmed("");
        setSmsConsentStatus(nextConsentStatus);
      } catch {
        setSmsErrorMessage("Could not load the saved mobile number. You can continue without SMS or try again.");
      }
    }
    return idToken;
  };

  const startSessionAfterInvite = async (idToken: string) => {
    setStatusMessage("Invite accepted. Sending your verification code...");
    const session = await createHumanSession({
      idToken,
      deviceId: getOrCreateDeviceId(),
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      deviceLabel: getTrustedDeviceLabel(),
      requestNewCode: true,
    });

    clearCredentials();
    if (session.bootstrap) {
      if (isPackagedElectronRenderer() && session.humanApiToken) {
        setHumanApiToken(session.humanApiToken);
      }
      await context?.refreshAuthBootstrap();
      const confirmed = await getAuthBootstrap({
        workstationToken: undefined,
        displayToken: undefined,
      });
      if (!confirmed.authenticated || confirmed.sessionKind !== "human") {
        throw new Error("Invite accepted, but we could not finish sign-in. Select Continue sign-in.");
      }
      clearInviteRecovery();
      setInviteAccepted(false);
      setNeedsSessionRetry(false);
      goToOperator("/home", { replace: true });
      return;
    }
    if (session.requiresEmailCode && session.pendingAuthId) {
      const authUser = getHumanAuth().currentUser;
      if (authUser) {
        setPendingEmailCodeSignInMethod(
          inferLastSignInMethodFromProviderIds(
            (authUser.providerData ?? []).map((p) => p.providerId),
          ),
        );
      }
      clearInviteRecovery();
      setInviteAccepted(false);
      setNeedsSessionRetry(false);
      const params = new URLSearchParams({ pendingAuthId: session.pendingAuthId });
      goToOperator(`/login?${params.toString()}`, {
        replace: true,
        state: { from: { pathname: "/invite" } },
      });
      return;
    }
    throw new Error("Could not start sign-in verification. Try again.");
  };

  const isValidInviteSmsPhone = (value: string) => {
    if (!/^\+?[\d\s().-]+$/.test(value.trim())) return false;
    const digits = value.replace(/\D/g, "");
    const nationalNumber = digits.length === 11 && digits.startsWith("1")
      ? digits.slice(1)
      : digits;
    return /^[2-9]\d{2}[2-9]\d{6}$/.test(nationalNumber);
  };

  const refreshInviteSmsPhone = async (idToken: string) => {
    if (!token) return;
    try {
      const preview = await fetchInviteSmsContext({ inviteToken: token, idToken });
      const nextRosterPhoneNumber = preview.rosterPhoneNumber || "";
      setRosterPhoneNumber(nextRosterPhoneNumber);
      rosterPhoneNumberRef.current = nextRosterPhoneNumber;
      if (nextRosterPhoneNumber) setSmsPhoneNumber(nextRosterPhoneNumber);
      setSmsPhoneConfirmed("");
      setSmsConsentStatus(preview.smsConsentStatus || "none");
      smsConsentStatusRef.current = preview.smsConsentStatus || "none";
    } catch {
      // Keep the current display and let the person continue without SMS.
    }
    setSmsVerification(null);
    setSmsVerificationCode("");
    persistInviteRecovery(token, { smsConsentChecked: true });
    setNeedsSessionRetry(true);
    setSmsErrorMessage("This mobile number changed. Review the updated number before trying SMS signup again.");
  };

  const startInviteSmsVerification = async (
    idToken: string,
    options: { forceNewChallenge?: boolean; operationAlreadyStarted?: boolean } = {},
  ) => {
    if (!token) throw new Error("This invite link is missing its token.");
    if (!options.operationAlreadyStarted && !beginSmsOperation()) return false;
    const currentRosterPhoneNumber = rosterPhoneNumberRef.current || rosterPhoneNumber;
    const phoneNumber = (!options.forceNewChallenge ? smsVerification?.phoneNumber : "") || currentRosterPhoneNumber || smsPhoneNumber.trim();
    if (!isValidInviteSmsPhone(phoneNumber)) {
      setSmsErrorMessage("Enter a valid 10-digit U.S. mobile number, or continue without SMS.");
      setNeedsSessionRetry(true);
      if (!options.operationAlreadyStarted) endSmsOperation();
      return false;
    }
    if (!smsVerification && smsPhoneConfirmed !== phoneNumber) {
      setSmsErrorMessage("Review and confirm this exact mobile number before requesting a verification code.");
      setNeedsSessionRetry(true);
      if (!options.operationAlreadyStarted) endSmsOperation();
      return false;
    }
    const capability = !options.forceNewChallenge && smsVerification
      ? smsVerification
      : createSmsConsentCapabilities();
    const intent = {
      phoneNumber,
      expectedRosterPhoneNumber:
        smsVerification?.expectedRosterPhoneNumber ?? currentRosterPhoneNumber,
      ...capability,
    };
    setSmsVerification(intent);
    setSmsDeliveryState("sending");
    persistInviteRecovery(token, {
      smsConsentChecked: true,
      smsVerification: intent,
      smsPhoneConfirmed,
      smsDeliveryState: "sending",
    });
    setIsSmsWorking(true);
    setSmsErrorMessage("");
    setStatusMessage("Starting SMS verification...");
    try {
      const result = await submitInviteSmsConsent({
        inviteToken: token,
        idToken,
        phoneNumber,
        expectedRosterPhoneNumber: intent.expectedRosterPhoneNumber,
        consent: true,
        challengeId: capability.challengeId,
        cancellationToken: capability.cancellationToken,
      });
      if (result.outcome === "delivery_uncertain") {
        const uncertainIntent = {
          ...intent,
          challengeId: result.challengeId || capability.challengeId,
          cancellationToken: result.cancellationToken || capability.cancellationToken,
        };
        setSmsVerification(uncertainIntent);
        setSmsDeliveryState("uncertain");
        setSmsErrorMessage("The SMS delivery result is uncertain. Check your messages before trying again, or continue without SMS.");
        persistInviteRecovery(token, {
          smsConsentChecked: true,
          smsVerification: uncertainIntent,
          smsPhoneConfirmed,
          smsDeliveryState: "uncertain",
        });
        setNeedsSessionRetry(false);
        return false;
      }
      if (result.outcome === "verification_required") {
        const confirmedIntent = {
          ...intent,
          challengeId: result.challengeId || capability.challengeId,
          cancellationToken: result.cancellationToken || capability.cancellationToken,
        };
        setSmsVerification(confirmedIntent);
        const deliveryState = result.deliveryStatus === "sent" ? "sent" : "uncertain";
        setSmsDeliveryState(deliveryState);
        if (deliveryState === "uncertain") {
          setSmsErrorMessage("The SMS delivery result is uncertain. Check your messages before trying again, or continue without SMS.");
        }
        persistInviteRecovery(token, {
          smsConsentChecked: true,
          smsVerification: confirmedIntent,
          smsPhoneConfirmed,
          smsDeliveryState: deliveryState,
        });
        setNeedsSessionRetry(false);
        setStatusMessage("");
        return false;
      }
      setSmsVerification(null);
      setSmsDeliveryState(undefined);
      persistInviteRecovery(token, { smsConsentChecked: true });
      setSmsConsentStatus(
        result.outcome === "already_opted_in"
          ? "opted_in"
          : result.outcome === "opted_out"
            ? "opted_out"
            : "pending",
      );
      setStatusMessage(
        result.outcome === "already_opted_in"
          ? "This number is already signed up for volunteer texts."
          : result.outcome === "opted_out"
            ? "This number has opted out of volunteer texts. Reply START to a WorshipSync text to opt in again."
            : "SMS verification is already in progress for this number.",
      );
      return true;
    } catch (error) {
      if (error instanceof Error && /mobile number changed/i.test(error.message)) {
        await refreshInviteSmsPhone(idToken);
        setStatusMessage("");
        return false;
      }
      const outcome = typeof error === "object" && error !== null && "details" in error
        ? (error as { details?: { outcome?: string } }).details?.outcome
        : undefined;
      if (outcome === "rejected_before_send") {
        setSmsVerification(null);
        setSmsDeliveryState(undefined);
        persistInviteRecovery(token, { smsConsentChecked: true, smsPhoneConfirmed });
        setSmsErrorMessage(error instanceof Error ? error.message : "SMS verification could not start. Review the number and try again.");
      } else {
        const details = typeof error === "object" && error !== null && "details" in error
          ? (error as { details?: { challengeId?: string; cancellationToken?: string } }).details
          : undefined;
        const deliveryState = outcome === "delivery_failed" ? "failed" : "uncertain";
        const retainedIntent = {
          ...intent,
          ...(details?.challengeId ? { challengeId: details.challengeId } : {}),
          ...(details?.cancellationToken ? { cancellationToken: details.cancellationToken } : {}),
        };
        setSmsVerification(retainedIntent);
        setSmsDeliveryState(deliveryState);
        persistInviteRecovery(token, {
          smsConsentChecked: true,
          smsVerification: retainedIntent,
          smsPhoneConfirmed,
          smsDeliveryState: deliveryState,
        });
        setSmsErrorMessage(
          deliveryState === "failed" && error instanceof Error
            ? error.message
            : "The SMS delivery result is uncertain. Check your messages before trying again, or continue without SMS.",
        );
      }
      setNeedsSessionRetry(true);
      setStatusMessage("");
      return false;
    } finally {
      if (!options.operationAlreadyStarted) endSmsOperation();
    }
  };

  const finishInviteOnboarding = async (idToken: string) => {
    if (smsConsentChecked && smsInviteConsentEnabled) {
      const currentConsentStatus = smsConsentStatusRef.current;
      if (currentConsentStatus === "opted_in" || currentConsentStatus === "opted_out") {
        setStatusMessage(
          currentConsentStatus === "opted_in"
            ? "This number is already signed up for volunteer texts."
            : "This number has opted out of volunteer texts. Reply START to a WorshipSync text to opt in again.",
        );
      } else {
        const shouldContinue = await startInviteSmsVerification(idToken);
        if (!shouldContinue) return;
      }
    }
    try {
      await startSessionAfterInvite(idToken);
    } catch (error) {
      handleSessionStartFailure(error);
    }
  };

  const retryInviteSmsVerification = async (forceNewChallenge = false) => {
    if (!beginSmsOperation()) return;
    try {
      const currentUser = getHumanAuth().currentUser;
      if (!currentUser) {
        setSmsErrorMessage("Sign in again to continue SMS signup.");
        return;
      }
      const idToken = await currentUser.getIdToken(true);
      const shouldContinue = await startInviteSmsVerification(idToken, {
        forceNewChallenge,
        operationAlreadyStarted: true,
      });
      if (shouldContinue) {
        try {
          await startSessionAfterInvite(idToken);
        } catch (error) {
          handleSessionStartFailure(error);
        }
      }
    } catch (error) {
      setSmsErrorMessage(error instanceof Error ? error.message : "Could not retry SMS verification.");
    } finally {
      endSmsOperation();
    }
  };

  const handleVerifyInviteSmsConsent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (smsOperationInFlightRef.current || !smsVerification) return;
    if (!token) {
      setSmsErrorMessage("This invite recovery is missing its token. Reopen the original invitation link to continue.");
      return;
    }
    if (!/^\d{6}$/.test(smsVerificationCode)) {
      setSmsErrorMessage("Enter the 6-digit verification code we sent you.");
      return;
    }
    const currentUser = getHumanAuth().currentUser;
    if (!currentUser) {
      setSmsErrorMessage("Sign in again to finish verifying your phone.");
      return;
    }
    if (!beginSmsOperation()) return;
    setSmsErrorMessage("");
    let idToken = "";
    try {
      idToken = await currentUser.getIdToken(true);
      await verifyInviteSmsConsent({
        inviteToken: token,
        idToken,
        phoneNumber: smsVerification.phoneNumber,
        expectedRosterPhoneNumber: smsVerification.expectedRosterPhoneNumber,
        challengeId: smsVerification.challengeId,
        code: smsVerificationCode,
      });
      setSmsVerification(null);
      setSmsVerificationCode("");
      setSmsConsentStatus("opted_in");
      persistInviteRecovery(token, { smsConsentChecked: true });
      try {
        await startSessionAfterInvite(idToken);
      } catch (error) {
        handleSessionStartFailure(error);
      }
    } catch (error) {
      if (error instanceof Error && /mobile number changed/i.test(error.message)) {
        await refreshInviteSmsPhone(idToken);
        return;
      }
      const code = typeof error === "object" && error !== null && "details" in error
        ? (error as { details?: { code?: string } }).details?.code
        : undefined;
      if (code === "sms_challenge_expired" || code === "sms_challenge_unavailable") {
        setSmsDeliveryState("expired");
        persistInviteRecovery(token, {
          smsConsentChecked: true,
          smsVerification,
          smsPhoneConfirmed,
          smsDeliveryState: "expired",
        });
      }
      setSmsErrorMessage(
        error instanceof Error
          ? error.message
          : "Could not verify your SMS consent. You can continue without SMS or try again.",
      );
    } finally {
      endSmsOperation();
    }
  };

  const handleContinueWithoutSms = async () => {
    if (!beginSmsOperation()) return;
    try {
      const pendingChallenge = smsVerification;
      let cancellationUncertain = false;
      let cancellationUnconfirmed = false;
      if (pendingChallenge && !token) {
        setSmsErrorMessage("This invite recovery is missing its token, so SMS signup cannot be cancelled. Reopen the original invitation link to continue safely.");
        return;
      }
      if (pendingChallenge && token) {
        try {
          const currentUser = getHumanAuth().currentUser;
          if (!currentUser) throw new Error("Sign in again to cancel SMS verification.");
          const idToken = await currentUser.getIdToken(true);
          const cancellation = await cancelInviteSmsConsent({
            inviteToken: token,
            idToken,
            phoneNumber: pendingChallenge.phoneNumber,
            expectedRosterPhoneNumber: pendingChallenge.expectedRosterPhoneNumber,
            challengeId: pendingChallenge.challengeId,
            cancellationToken: pendingChallenge.cancellationToken,
          });
          if (!cancellation.cancelled) {
            setSmsErrorMessage("This verification is no longer active, or SMS signup was already completed. You can continue without SMS.");
          }
          window.sessionStorage.removeItem(`worshipsync_invite_sms_cancel:${token}`);
          window.sessionStorage.removeItem(INVITE_TOKEN_STORAGE_KEY);
        } catch (error) {
          const explicitlyNotCancelled = typeof error === "object" && error !== null && "details" in error &&
            (error as { details?: { cancelled?: boolean } }).details?.cancelled === false;
          if (explicitlyNotCancelled) {
            cancellationUnconfirmed = true;
            window.sessionStorage.removeItem(`worshipsync_invite_sms_cancel:${token}`);
            window.sessionStorage.removeItem(INVITE_TOKEN_STORAGE_KEY);
            setSmsErrorMessage("This verification is no longer active, or SMS signup was already completed. You can continue without SMS.");
          } else {
            cancellationUncertain = true;
            // Keep the exact capability for an idempotent retry if the response was lost.
            window.sessionStorage.setItem(INVITE_TOKEN_STORAGE_KEY, token);
            window.sessionStorage.setItem(
              `worshipsync_invite_sms_cancel:${token}`,
              JSON.stringify(pendingChallenge),
            );
            setSmsErrorMessage("Could not confirm SMS signup cancellation. You can continue without SMS; the code may remain usable until it expires.");
          }
        }
      }
      setSmsConsentChecked(false);
      if (!cancellationUncertain) setSmsVerification(null);
      setSmsVerificationCode("");
      if (!pendingChallenge && !cancellationUnconfirmed) setSmsErrorMessage("");
      if (token) persistInviteRecovery(token, {
        smsConsentChecked: false,
        ...(cancellationUncertain && pendingChallenge
          ? { smsVerification: pendingChallenge, smsCancellationPending: true }
          : {}),
      });
      await handleContinueSignIn();
    } finally {
      endSmsOperation();
    }
  };

  const handleSessionStartFailure = (error: unknown) => {
    setNeedsSessionRetry(true);
    setErrorMessage(
      error instanceof Error && error.message
        ? error.message
        : "Invite accepted, but we could not finish sign-in. Select Continue sign-in."
    );
  };

  const validateCommonFields = () => {
    const nextErrors: InviteFieldErrors = {};
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      nextErrors.email = "Enter the invited email address.";
    } else if (!isValidEmailFormat(trimmedEmail)) {
      nextErrors.email = INVALID_EMAIL_FORMAT_MESSAGE;
    }
    if (!password) {
      nextErrors.password = "Enter your password.";
    } else if (!passwordMeetsPolicy(password)) {
      nextErrors.password = "Meet every password requirement below.";
    }
    if (!displayName.trim()) {
      nextErrors.displayName = "Enter your name.";
    }
    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleUseCurrentAccount = async () => {
    if (!token && !inviteAccepted) {
      setErrorMessage("This invite link is missing its token.");
      return;
    }
    if (!getHumanAuth().currentUser) {
      setErrorMessage("Sign in with the invited email address before accepting this invite.");
      return;
    }

    setIsSaving(true);
    clearMessages();
    setFieldErrors({});
    setNeedsSessionRetry(false);

    let idToken: string;
    try {
      idToken = await acceptInviteMembershipWithSignedInUser();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Could not accept this invite"
      );
      setIsSaving(false);
      return;
    }

    try {
      await finishInviteOnboarding(idToken);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateAccountAndAccept = async () => {
    if (!token) {
      setErrorMessage("This invite link is missing its token.");
      return;
    }
    clearMessages();
    if (!validateCommonFields()) {
      return;
    }

    setIsSaving(true);
    setNeedsSessionRetry(false);
    await clearCurrentAccount();
    setInviteAccepted(false);
    let createdUserCredential:
      | Awaited<ReturnType<typeof createUserWithEmailAndPassword>>
      | null = null;
    let idToken: string | null = null;
    try {
      const auth = getHumanAuth();
      const credential = await createUserWithEmailAndPassword(
        auth,
        email.trim(),
        password
      );
      createdUserCredential = credential;
      if (displayName.trim()) {
        await updateProfile(credential.user, { displayName: displayName.trim() });
      }
      idToken = await acceptInviteMembershipWithSignedInUser();
    } catch (error) {
      if (createdUserCredential) {
        await createdUserCredential.user.delete().catch(() => undefined);
        await signOut(getHumanAuth()).catch(() => undefined);
      }
      setErrorMessage(
        createdUserCredential
          ? getInviteFlowErrorMessage(error)
          : getCreateAccountErrorMessage(error)
      );
      setIsSaving(false);
      return;
    }

    try {
      // Invite was already accepted; later SMS or session errors must not remove the account.
      await finishInviteOnboarding(idToken);
    } finally {
      setIsSaving(false);
    }
  };

  const handleContinueSignIn = async () => {
    const currentUser = getHumanAuth().currentUser;
    if (!inviteAccepted || !currentUser) {
      setErrorMessage("Sign in with the invited email address before continuing.");
      return;
    }
    setIsSaving(true);
    clearMessages();
    try {
      const idToken = await currentUser.getIdToken(true);
      await startSessionAfterInvite(idToken);
      setNeedsSessionRetry(false);
    } catch (error) {
      handleSessionStartFailure(error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleProviderSignInAndAccept = async (method: "google" | "microsoft") => {
    if (!token) {
      setErrorMessage("This invite link is missing its token.");
      return;
    }
    setIsSaving(true);
    clearMessages();
    setNeedsSessionRetry(false);
    try {
      await clearCurrentAccount();
      const authResult = await context?.authenticateHumanWithFirebase({
        method,
      });
      if (!authResult) {
        goToOperator("/login", {
          replace: true,
          state: { from: { pathname: "/invite" } },
        });
        return;
      }
      if (authResult.status === "redirect-started") {
        setIsSaving(false);
        return;
      }
      if (authResult.status === "requires-existing-method") {
        goToOperator("/login", {
          replace: true,
          state: { from: { pathname: "/invite" } },
        });
        return;
      }
      const idToken = await acceptInviteMembershipWithSignedInUser();
      await finishInviteOnboarding(idToken);
    } catch (error) {
      setErrorMessage(getInviteFlowErrorMessage(error, { provider: method }));
    } finally {
      setIsSaving(false);
    }
  };

  const handleFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSaving) {
      return;
    }
    void handleCreateAccountAndAccept();
  };

  const showSmsConsentPanel = smsInviteConsentEnabled &&
    (!inviteAccepted || (smsConsentChecked && smsConsentStatus === "none" && !smsVerification));

  return (
    <AuthScreenMain>
      <div className="w-full max-w-md rounded-2xl border border-gray-500 bg-gray-800 p-6">
        <h1 className="text-2xl font-semibold">{joinHeadline}</h1>
        <p className="mt-2 text-sm text-gray-200">
          Create your account with the invited email address to accept this invite.
        </p>
        {signedInEmail ? (
          <p className="mt-4 rounded-lg border border-gray-600/80 bg-gray-900/50 px-3 py-2 text-sm text-gray-200">
            {`Signed in as ${signedInEmail}`}
          </p>
        ) : null}

        {statusMessage && (
          <p className="mt-3 text-sm text-cyan-300">{statusMessage}</p>
        )}
        {errorMessage && (
          <p className="mt-3 text-sm text-red-400">{errorMessage}</p>
        )}
        {smsErrorMessage && !smsVerification && !showSmsConsentPanel ? (
          <p className="mt-3 text-sm text-amber-100" role="alert">
            {smsErrorMessage}
          </p>
        ) : null}
        {showSmsConsentPanel ? (
          <div className="mt-4 space-y-3 rounded-lg border border-gray-600/80 bg-gray-900/40 p-3">
            <p className="text-sm font-medium text-gray-100">
              Volunteer text updates (optional)
            </p>
            {rosterPhoneNumber ? (
              <p className="text-sm text-gray-300">
                Review the mobile number saved for this invitation: <span className="font-medium text-white">{rosterPhoneNumber}</span>.
              </p>
            ) : smsConsentChecked ? (
              <Input
                id="invite-sms-phone-number"
                label="Mobile phone number"
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                value={smsPhoneNumber}
                onChange={(value) => setSmsPhoneNumber(formatUsPhoneInput(String(value)))}
                helperText="U.S. phone numbers only."
                errorText={smsErrorMessage || undefined}
                disabled={isSaving || isSmsWorking}
              />
            ) : null}
            {smsConsentStatus === "opted_in" ? (
              <p className="text-sm text-gray-300" role="status">
                This number is already signed up for volunteer texts.
              </p>
            ) : smsConsentStatus === "opted_out" ? (
              <p className="text-sm text-gray-300" role="status">
                This number has opted out. Reply START to a WorshipSync text to opt in again.
              </p>
            ) : smsConsentStatus === "pending" ? (
              <p className="text-sm text-gray-300" role="status">
                SMS verification is already in progress for this number. Check your messages.
              </p>
            ) : (
              <>
                <SmsConsentDisclosure
                  checked={smsConsentChecked}
                  disabled={isSaving || isSmsWorking}
                  onCheckedChange={(checked) => {
                    setSmsConsentChecked(checked);
                    setSmsErrorMessage("");
                  }}
                  id="invite-sms-consent"
                />
                {inviteAccepted && smsConsentChecked ? (
                  <Checkbox
                    id="invite-sms-phone-confirmation"
                    checked={smsPhoneConfirmed === (rosterPhoneNumber || smsPhoneNumber.trim())}
                    disabled={isSaving || isSmsWorking}
                    onCheckedChange={(checked) => {
                      const phone = rosterPhoneNumber || smsPhoneNumber.trim();
                      setSmsPhoneConfirmed(checked ? phone : "");
                      setSmsErrorMessage("");
                    }}
                    label={<span className="text-sm leading-relaxed text-gray-200">I reviewed and confirm this exact mobile number for SMS signup.</span>}
                  />
                ) : null}
              </>
            )}
            {smsErrorMessage && !smsVerification ? (
              <p className="text-sm text-amber-100" role="alert">{smsErrorMessage}</p>
            ) : null}
          </div>
        ) : null}

        {inviteAccepted && smsVerification ? (
          <form
            className="mt-4 flex flex-col gap-3"
            onSubmit={(event) => void handleVerifyInviteSmsConsent(event)}
            noValidate
          >
            <p className="text-sm text-gray-200" role="status">
              {smsDeliveryState === "uncertain"
                ? `The SMS provider did not confirm delivery. If a code arrives at ${smsVerification.phoneNumber}, enter it here. Do not request another code yet.`
                : smsDeliveryState === "failed"
                  ? `The provider rejected the previous send. Retry to request a new code for ${smsVerification.phoneNumber}, or continue without SMS.`
                  : smsDeliveryState === "expired"
                    ? `This verification code expired or is no longer available. Request a new code for ${smsVerification.phoneNumber}, or continue without SMS.`
                  : `Enter the verification code sent to ${smsVerification.phoneNumber} to finish opting in.`}
            </p>
            {smsErrorMessage ? (
              <p className="text-sm text-amber-100" role="alert">{smsErrorMessage}</p>
            ) : null}
            <Input
              id="invite-sms-verification-code"
              label="Verification code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={smsVerificationCode}
              onChange={(value) => {
                setSmsVerificationCode(String(value).replace(/\D/g, "").slice(0, 6));
                setSmsErrorMessage("");
              }}
              required
            />
            {smsDeliveryState === "failed" || smsDeliveryState === "expired" ? (
              <Button
                type="button"
                variant="tertiary"
                className="w-full justify-center"
                isLoading={isSmsWorking}
                disabled={isSmsWorking || isSaving}
                onClick={() => void retryInviteSmsVerification(smsDeliveryState === "expired")}
              >
                {smsDeliveryState === "expired" ? "Request a new code" : "Retry SMS verification"}
              </Button>
            ) : null}
            <Button
              type="submit"
              variant="cta"
              className="w-full justify-center"
              isLoading={isSmsWorking}
              disabled={isSmsWorking || smsVerificationCode.length !== 6}
            >
              Verify phone
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="w-full justify-center whitespace-normal text-center"
              isLoading={isSmsWorking}
              disabled={isSmsWorking || isSaving}
              onClick={() => void handleContinueWithoutSms()}
            >
              Continue without SMS
            </Button>
          </form>
        ) : signedInEmail ? (
          <div className="mt-4 flex flex-col gap-2">
            {needsSessionRetry && smsConsentChecked && !smsVerification && smsConsentStatus === "none" ? (
              <Button
                variant="secondary"
                className="w-full justify-center"
                isLoading={isSmsWorking}
                disabled={isSaving || isSmsWorking}
                onClick={() => {
                  const currentUser = getHumanAuth().currentUser;
                  if (!currentUser) {
                    setSmsErrorMessage("Sign in again to continue SMS signup.");
                    return;
                  }
                  void retryInviteSmsVerification();
                }}
              >
                {smsPhoneConfirmed === (rosterPhoneNumber || smsPhoneNumber.trim()) ? "Send verification code" : "Review mobile number"}
              </Button>
            ) : null}
            {inviteAccepted && !smsVerification ? (
              <Button
                variant="secondary"
                className="w-full justify-center"
                onClick={() => void handleContinueWithoutSms()}
                isLoading={isSaving || isSmsWorking}
                disabled={isSaving || isSmsWorking}
              >
                Continue without SMS
              </Button>
            ) : null}
            {smsVerification && needsSessionRetry ? (
              <Button
                variant="secondary"
                className="w-full justify-center"
                onClick={() => void retryInviteSmsVerification()}
                isLoading={isSmsWorking}
                disabled={isSaving || isSmsWorking}
              >
                Retry SMS verification
              </Button>
            ) : null}
            {needsSessionRetry && (
              <Button
                variant="cta"
                className="w-full justify-center"
                onClick={() => void handleContinueSignIn()}
                isLoading={isSaving}
                disabled={isSaving}
              >
                Continue sign-in
              </Button>
            )}
            <Button
              variant="cta"
              className="w-full justify-center"
              onClick={() => void handleUseCurrentAccount()}
              isLoading={isSaving}
              disabled={isSaving}
            >
              Accept invite with this account
            </Button>
            {/* An invite only works for the address it was sent to (the server
                rejects any other), so someone signed in as the wrong account
                would otherwise be stuck clicking into a 403 with no way out.
                The invited address is deliberately not shown: anyone holding a
                forwarded token would learn who to target. */}
            <Button
              variant="textLink"
              className="w-full justify-center"
              disabled={isSaving}
              onClick={() => void handleUseDifferentAccount()}
            >
              Use a different account
            </Button>
          </div>
        ) : (
          <form onSubmit={handleFormSubmit} noValidate>
            <div className="mt-4 grid grid-cols-1 gap-2">
              <Button
                type="button"
                variant="primary"
                svg={GoogleMark}
                iconSize="sm"
                gap="gap-2"
                className="w-full justify-center"
                disabled={isSaving}
                onClick={() => void handleProviderSignInAndAccept("google")}
              >
                Continue with Google
              </Button>
              <Button
                type="button"
                variant="primary"
                svg={MicrosoftMark}
                iconSize="sm"
                gap="gap-2"
                className="w-full justify-center"
                disabled={isSaving}
                onClick={() => void handleProviderSignInAndAccept("microsoft")}
              >
                Continue with Microsoft
              </Button>
            </div>
            <p className="mt-3 text-center text-xs text-gray-400">
              Or create an email/password account
            </p>
            <div className="mt-4 flex flex-col gap-3">
              <Input
                id="invite-email"
                label="Email"
                type="email"
                value={email}
                errorText={fieldErrors.email}
                onChange={(value) => {
                  setEmail(String(value));
                  clearFieldError("email");
                  clearMessages();
                }}
                autoComplete="email"
                disabled={isSaving}
              />
              <Input
                id="invite-display-name"
                label="Name"
                value={displayName}
                errorText={fieldErrors.displayName}
                onChange={(value) => {
                  setDisplayName(String(value));
                  clearFieldError("displayName");
                  clearMessages();
                }}
                autoComplete="name"
                disabled={isSaving}
              />
              <Input
                id="invite-password"
                label="Password"
                type={showPassword ? "text" : "password"}
                value={password}
                errorText={fieldErrors.password}
                onChange={(value) => {
                  setPassword(String(value));
                  clearFieldError("password");
                  clearMessages();
                }}
                svg={showPassword ? EyeOff : Eye}
                svgAction={() => setShowPassword((current) => !current)}
                svgActionAriaLabel={showPassword ? "Hide password" : "Show password"}
                autoComplete="new-password"
                disabled={isSaving}
                aria-describedby={passwordStrengthDescId}
              />
              <PasswordStrengthIndicator
                id={passwordStrengthDescId}
                password={password}
                className="-mt-1"
              />
            </div>

            <div className="mt-4 flex flex-col gap-2">
              <Button
                type="submit"
                variant="cta"
                className="w-full justify-center"
                isLoading={isSaving}
                disabled={isSaving}
              >
                Accept invite
              </Button>
            </div>
          </form>
        )}
      </div>
    </AuthScreenMain>
  );
};

export default InviteAccept;
