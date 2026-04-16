import {
  useContext,
  useEffect,
  useId,
  useMemo,
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
import Button from "../components/Button/Button";
import { GoogleMark, MicrosoftMark } from "../components/AuthProviderMarks";
import {
  acceptInvite,
  createHumanSession,
  fetchInvitePreview,
  getAuthBootstrap,
  logoutSession,
} from "../api/auth";
import { getHumanAuth } from "../firebase/apps";
import { GlobalInfoContext } from "../context/globalInfo";
import Input from "../components/Input/Input";
import PasswordStrengthIndicator from "../components/PasswordStrengthIndicator/PasswordStrengthIndicator";
import { isFirebaseAuthError } from "../utils/authUserMessages";
import {
  getOrCreateDeviceId,
  inferLastSignInMethodFromProviderIds,
  setHumanApiToken,
  setPendingEmailCodeSignInMethod,
} from "../utils/authStorage";
import { isPackagedElectronRenderer } from "../utils/environment";
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

const INVITE_TOKEN_STORAGE_KEY = "worshipsync_pending_invite_token";
const INVITE_RECOVERY_STORAGE_KEY = "worshipsync_invite_recovery";

type InviteRecoveryState = {
  accepted: true;
  token: string;
  acceptedAt: number;
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
    if (
      error.code === "auth/popup-blocked" ||
      error.code === "auth/popup-closed-by-user"
    ) {
      return "Provider sign-in did not complete. Try again, or use email and password.";
    }
    if (error.code === "auth/network-request-failed") {
      return "Could not reach the sign-in service. Check your connection and try again.";
    }
    if (options?.provider) {
      const providerLabel =
        options.provider === "google" ? "Google" : "Microsoft";
      return `${providerLabel} sign-in is not available right now. Try again, or use email and password.`;
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
    return window.sessionStorage.getItem(INVITE_TOKEN_STORAGE_KEY) || "";
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
  const passwordStrengthDescId = useId();

  const persistInviteRecovery = (acceptedToken: string) => {
    if (typeof window === "undefined") {
      return;
    }
    const payload: InviteRecoveryState = {
      accepted: true,
      token: acceptedToken,
      acceptedAt: Date.now(),
    };
    window.sessionStorage.setItem(INVITE_RECOVERY_STORAGE_KEY, JSON.stringify(payload));
  };

  const clearInviteRecovery = () => {
    if (typeof window === "undefined") {
      return;
    }
    window.sessionStorage.removeItem(INVITE_RECOVERY_STORAGE_KEY);
  };

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
        setNeedsSessionRetry(true);
        return;
      }
    } catch {
      // Ignore malformed recovery payload and clear it below.
    }
    clearInviteRecovery();
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
    void fetchInvitePreview(token)
      .then((data) => {
        if (cancelled) {
          return;
        }
        if (!data.success) {
          setInviteChurchName(null);
          return;
        }
        setInviteChurchName(data.churchName?.trim() || null);
      })
      .catch(() => {
        if (!cancelled) {
          setInviteChurchName(null);
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
      persistInviteRecovery(token);
      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(INVITE_TOKEN_STORAGE_KEY);
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
      navigate("/home", { replace: true });
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
      navigate(`/login?${params.toString()}`, {
        replace: true,
        state: { from: { pathname: "/invite" } },
      });
      return;
    }
    throw new Error("Could not start sign-in verification. Try again.");
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
      await startSessionAfterInvite(idToken);
    } catch (error) {
      handleSessionStartFailure(error);
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
      await startSessionAfterInvite(idToken);
    } catch (error) {
      // Invite was already accepted; do not delete the created auth user on session/bootstrap errors.
      handleSessionStartFailure(error);
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
        navigate("/login", {
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
        navigate("/login", {
          replace: true,
          state: { from: { pathname: "/invite" } },
        });
        return;
      }
      const idToken = await acceptInviteMembershipWithSignedInUser();
      await startSessionAfterInvite(idToken);
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

  return (
    <main className="flex min-h-dvh items-center justify-center bg-homepage-canvas px-4 text-white">
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

        {signedInEmail ? (
          <div className="mt-4 flex flex-col gap-2">
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
    </main>
  );
};

export default InviteAccept;
