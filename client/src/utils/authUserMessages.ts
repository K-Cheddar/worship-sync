/**
 * User-facing copy for sign-in and related flows (sign-in page, global auth).
 * Maps Firebase and API errors to calm, actionable messages.
 */

import { INVALID_EMAIL_FORMAT_MESSAGE } from "./emailFormat";

/** Shown when the session is gone or verification cannot continue — sign in fresh. */
export const AUTH_SIGN_IN_AGAIN_MESSAGE = "Please sign in again.";

/** Pending email verification during session restore. */
export const AUTH_VERIFY_DEVICE_MESSAGE =
  "Enter the code from your email to continue.";

/** Desktop browser ↔ app handoff expired or failed. */
export const AUTH_DESKTOP_SIGN_IN_TIMED_OUT_MESSAGE =
  "Sign-in timed out. Try again.";

export const PAIRING_CODE_INVALID_MESSAGE =
  "That code isn't valid. Generate a new one.";

export const PAIRING_CODE_EXPIRED_MESSAGE =
  "That code expired. Generate a new one.";

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
  "auth/invalid-email": INVALID_EMAIL_FORMAT_MESSAGE,
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
  "This sign-in code has expired. Try signing in again.":
    AUTH_SIGN_IN_AGAIN_MESSAGE,
  "This sign-in code has been locked after too many attempts. Sign in again to get a new code.":
    AUTH_SIGN_IN_AGAIN_MESSAGE,
};

const SESSION_API_MESSAGES: Record<string, string> = {
  "Identity token is required.": AUTH_SIGN_IN_AGAIN_MESSAGE,
  "This trusted device is no longer available. Sign in again to continue.":
    AUTH_SIGN_IN_AGAIN_MESSAGE,
  "Please sign in again.": AUTH_SIGN_IN_AGAIN_MESSAGE,
};

const DESKTOP_SIGN_IN_API_MESSAGES: Record<string, string> = {
  "This desktop sign-in request is not ready for confirmation.":
    AUTH_DESKTOP_SIGN_IN_TIMED_OUT_MESSAGE,
  "This desktop sign-in request was not found. Start again in WorshipSync.":
    AUTH_DESKTOP_SIGN_IN_TIMED_OUT_MESSAGE,
  "This desktop sign-in request is not valid.":
    AUTH_DESKTOP_SIGN_IN_TIMED_OUT_MESSAGE,
  "This desktop sign-in request expired. Start again in WorshipSync.":
    AUTH_DESKTOP_SIGN_IN_TIMED_OUT_MESSAGE,
  "This desktop sign-in request is already in use. Start again in WorshipSync.":
    AUTH_DESKTOP_SIGN_IN_TIMED_OUT_MESSAGE,
  "This desktop sign-in request is not ready to finish. Return to your browser and try again.":
    AUTH_DESKTOP_SIGN_IN_TIMED_OUT_MESSAGE,
  "This desktop sign-in confirmation expired. Return to your browser and try again.":
    AUTH_DESKTOP_SIGN_IN_TIMED_OUT_MESSAGE,
  "This desktop sign-in request is not waiting for a verification code.":
    AUTH_DESKTOP_SIGN_IN_TIMED_OUT_MESSAGE,
  "That verification request does not match this desktop sign-in.":
    AUTH_DESKTOP_SIGN_IN_TIMED_OUT_MESSAGE,
  "This resend request is not valid for this device.":
    AUTH_SIGN_IN_AGAIN_MESSAGE,
  "A valid desktop sign-in provider is required.":
    AUTH_DESKTOP_SIGN_IN_TIMED_OUT_MESSAGE,
  "Could not start desktop sign-in": AUTH_DESKTOP_SIGN_IN_TIMED_OUT_MESSAGE,
  "Could not complete desktop sign-in": AUTH_DESKTOP_SIGN_IN_TIMED_OUT_MESSAGE,
  "Could not complete desktop sign-in.": AUTH_DESKTOP_SIGN_IN_TIMED_OUT_MESSAGE,
  "Could not load desktop sign-in status":
    AUTH_DESKTOP_SIGN_IN_TIMED_OUT_MESSAGE,
  "Could not finish desktop sign-in": AUTH_DESKTOP_SIGN_IN_TIMED_OUT_MESSAGE,
  "Sign-in timed out. Try again.": AUTH_DESKTOP_SIGN_IN_TIMED_OUT_MESSAGE,
};

const PAIRING_CODE_API_MESSAGES: Record<string, string> = {
  "This workstation pairing code is not active.": PAIRING_CODE_INVALID_MESSAGE,
  "This workstation pairing code has expired.": PAIRING_CODE_EXPIRED_MESSAGE,
  "This display pairing code is not active.": PAIRING_CODE_INVALID_MESSAGE,
  "This display pairing code has expired.": PAIRING_CODE_EXPIRED_MESSAGE,
  "That pairing code was not found for this church.":
    PAIRING_CODE_INVALID_MESSAGE,
  "This pairing code is no longer active.": PAIRING_CODE_INVALID_MESSAGE,
  "This pairing code has expired.": PAIRING_CODE_EXPIRED_MESSAGE,
  "That code isn't valid. Generate a new one.": PAIRING_CODE_INVALID_MESSAGE,
  "That code expired. Generate a new one.": PAIRING_CODE_EXPIRED_MESSAGE,
};

const mapKnownAuthApiMessage = (raw: string): string | undefined =>
  VERIFY_CODE_API_MESSAGES[raw] ??
  SESSION_API_MESSAGES[raw] ??
  DESKTOP_SIGN_IN_API_MESSAGES[raw] ??
  PAIRING_CODE_API_MESSAGES[raw];

export const isFirebaseAuthError = (
  error: unknown,
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

const getMappedAuthApiErrorMessage = (
  error: unknown,
  defaultMessage: string,
): string => {
  const raw = normalizeApiMessage(error);
  if (!raw || raw === "Request failed") {
    return defaultMessage;
  }
  const mapped = mapKnownAuthApiMessage(raw);
  if (mapped) {
    return mapped;
  }
  if (
    raw.length < 160 &&
    !raw.includes("at ") &&
    !raw.toLowerCase().includes("stack")
  ) {
    return raw;
  }
  return defaultMessage;
};

export const getSessionApiErrorMessage = (error: unknown): string =>
  getMappedAuthApiErrorMessage(error, DEFAULT_FINISH_SIGN_IN);

export const getVerifyEmailCodeErrorMessage = (error: unknown): string =>
  getMappedAuthApiErrorMessage(error, DEFAULT_VERIFY_CODE);

export const getResendEmailCodeErrorMessage = (error: unknown): string =>
  getMappedAuthApiErrorMessage(error, "Could not resend the code. Try again.");

export const getDesktopSignInErrorMessage = (error: unknown): string =>
  getMappedAuthApiErrorMessage(error, AUTH_DESKTOP_SIGN_IN_TIMED_OUT_MESSAGE);

export const getPairingCodeErrorMessage = (error: unknown): string =>
  getMappedAuthApiErrorMessage(error, "Could not link this device.");

export const getForgotPasswordErrorMessage = (error: unknown): string => {
  const raw = normalizeApiMessage(error);
  if (!raw || raw === "Request failed") {
    return DEFAULT_FORGOT_PASSWORD;
  }
  if (raw === "Email is required.") {
    return "Enter your email address first.";
  }
  if (
    raw.length < 160 &&
    !raw.includes("at ") &&
    !raw.toLowerCase().includes("stack")
  ) {
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
  options?: { retryCount?: number },
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
