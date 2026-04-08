/**
 * User-facing copy for sign-in and related flows (sign-in page, global auth).
 * Maps Firebase and API errors to calm, actionable messages.
 */

const DEFAULT_SIGN_IN =
  "Could not sign in. Check your email and password, then try again.";

/** Server returned success without session or verification step */
export const SIGN_IN_UNEXPECTED_RESPONSE =
  "Could not finish signing in. Try again in a moment.";

const DEFAULT_FINISH_SIGN_IN = SIGN_IN_UNEXPECTED_RESPONSE;

const DEFAULT_VERIFY_CODE = "Could not verify that code. Try again.";

const DEFAULT_FORGOT_PASSWORD =
  "Could not send the reset email. Try again in a moment.";

const FIREBASE_AUTH_MESSAGES: Record<string, string> = {
  "auth/invalid-email":
    "That email address does not look valid. Check it and try again.",
  "auth/invalid-credential": DEFAULT_SIGN_IN,
  "auth/wrong-password": DEFAULT_SIGN_IN,
  "auth/user-not-found": DEFAULT_SIGN_IN,
  "auth/invalid-login-credentials": DEFAULT_SIGN_IN,
  "auth/user-disabled":
    "This account is not available to sign in. Contact your church administrator.",
  "auth/too-many-requests":
    "Too many sign-in attempts. Wait a few minutes, then try again.",
  "auth/network-request-failed":
    "Could not reach the sign-in service. Check your connection and try again.",
  "auth/internal-error":
    "Sign-in is temporarily unavailable. Try again in a moment.",
  "auth/operation-not-allowed":
    "Email sign-in is not enabled for this project. Contact support.",
};

const VERIFY_CODE_API_MESSAGES: Record<string, string> = {
  "That code is not valid.":
    "That code does not match. Check the number from your email and try again.",
};

const SESSION_API_MESSAGES: Record<string, string> = {
  "Identity token is required.": DEFAULT_FINISH_SIGN_IN,
};

export const isFirebaseAuthError = (
  error: unknown
): error is { code: string } =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  typeof (error as { code: unknown }).code === "string" &&
  (error as { code: string }).code.startsWith("auth/");

export const getFirebaseSignInMessage = (error: unknown): string => {
  if (isFirebaseAuthError(error)) {
    return FIREBASE_AUTH_MESSAGES[error.code] ?? DEFAULT_SIGN_IN;
  }
  const msg = error instanceof Error ? error.message : String(error);
  if (msg.includes("Firebase:") || /auth\/[\w-]+/.test(msg)) {
    return DEFAULT_SIGN_IN;
  }
  return DEFAULT_SIGN_IN;
};

const normalizeApiMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message.trim();
  }
  return String(error).trim();
};

export const getSessionApiErrorMessage = (error: unknown): string => {
  const raw = normalizeApiMessage(error);
  if (!raw || raw === "Request failed") {
    return DEFAULT_FINISH_SIGN_IN;
  }
  if (SESSION_API_MESSAGES[raw]) {
    return SESSION_API_MESSAGES[raw];
  }
  if (raw.length < 160 && !raw.includes("at ") && !raw.toLowerCase().includes("stack")) {
    return raw;
  }
  return DEFAULT_FINISH_SIGN_IN;
};

export const getVerifyEmailCodeErrorMessage = (error: unknown): string => {
  const raw = normalizeApiMessage(error);
  if (!raw || raw === "Request failed") {
    return DEFAULT_VERIFY_CODE;
  }
  if (VERIFY_CODE_API_MESSAGES[raw]) {
    return VERIFY_CODE_API_MESSAGES[raw];
  }
  if (raw.length < 160 && !raw.includes("at ") && !raw.toLowerCase().includes("stack")) {
    return raw;
  }
  return DEFAULT_VERIFY_CODE;
};

export const getForgotPasswordErrorMessage = (error: unknown): string => {
  const raw = normalizeApiMessage(error);
  if (!raw || raw === "Request failed") {
    return DEFAULT_FORGOT_PASSWORD;
  }
  if (raw === "Email is required.") {
    return "Enter your email address first.";
  }
  if (raw.length < 160 && !raw.includes("at ") && !raw.toLowerCase().includes("stack")) {
    return raw;
  }
  return DEFAULT_FORGOT_PASSWORD;
};

/** Used in sign-in catch when Firebase vs API failure must be distinguished */
export const getSignInFlowErrorMessage = (error: unknown): string =>
  isFirebaseAuthError(error)
    ? getFirebaseSignInMessage(error)
    : getSessionApiErrorMessage(error);

/** Matches auth bootstrap `authServerStatus` from GlobalInfo */
export type AuthServerConnectionStatus = "checking" | "online" | "offline";

/**
 * User-facing line while bootstrap or sign-in is still loading.
 * Prefer server status when available so operators see connection vs validation.
 */
export const getAuthBootstrapLoadingDescription = (
  authServerStatus: AuthServerConnectionStatus,
  options?: { retryCount?: number }
): string => {
  if (authServerStatus === "offline") {
    const n = options?.retryCount ?? 0;
    if (n > 0) {
      return `Can't reach WorshipSync right now. Trying again (attempt ${n})…`;
    }
    return "Can't reach WorshipSync right now. Check your connection; we'll keep trying.";
  }
  if (authServerStatus === "checking") {
    return "Connecting to WorshipSync…";
  }
  return "Finishing up with WorshipSync…";
};
