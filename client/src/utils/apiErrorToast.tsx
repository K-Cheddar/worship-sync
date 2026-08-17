import Button from "../components/Button/Button";
import { AuthApiError } from "../api/auth";
import { AUTH_SIGN_IN_AGAIN_MESSAGE } from "./authUserMessages";
import type { ToastData } from "../components/Toast/ToastContainer";
import type { ToastVariant } from "../components/Toast/Toast";

export const getApiErrorMessage = (error: unknown, fallback: string) => {
  const message = error instanceof Error ? error.message.trim() : "";
  return message || fallback;
};

/**
 * HTTP status off a thrown API error, without `instanceof`. Call sites live in
 * components whose tests mock the whole auth module, where the real
 * `AuthApiError` class is not available to compare against.
 */
export const getApiErrorStatus = (error: unknown): number | undefined => {
  if (!error || typeof error !== "object") return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
};

export const isAuthApiError = (error: unknown): error is AuthApiError =>
  error instanceof AuthApiError &&
  (error.status === 401 || error.status === 403);

const AUTH_ERROR_TOAST_MESSAGE = AUTH_SIGN_IN_AGAIN_MESSAGE;

let authErrorToastVisible = false;

export const resetAuthErrorToastStateForTests = () => {
  authErrorToastVisible = false;
};

export const isAuthFailureMessage = (message: string) => {
  const normalized = message.trim().toLowerCase();
  return (
    normalized.includes("authentication required") ||
    message.trim() === AUTH_SIGN_IN_AGAIN_MESSAGE
  );
};

export const getPersistedFailureMessage = (error: unknown, fallback: string) => {
  if (isAuthApiError(error)) return "";
  return getApiErrorMessage(error, fallback);
};

export const sanitizePersistedFailureMessages = <T extends Record<string, string>>(
  failures: T,
) => {
  const next = { ...failures };
  Object.keys(next).forEach((key) => {
    if (isAuthFailureMessage(next[key])) {
      delete next[key];
    }
  });
  return next;
};

export const authErrorToastContent = (): Omit<ToastData, "id"> => ({
  message: AUTH_ERROR_TOAST_MESSAGE,
  variant: "error",
  persist: true,
  children: () => (
    <div className="mt-2 flex justify-center">
      <Button
        variant="cta"
        className="text-sm"
        onClick={() => window.location.reload()}
      >
        Refresh page
      </Button>
    </div>
  ),
});

type ShowToastFn = (
  messageOrData: string | Omit<ToastData, "id">,
  variant?: ToastVariant,
) => string;

/**
 * Show the "authentication required — refresh" toast, de-duplicated so repeated
 * 401s don't stack it. Used both by call-site error handling and the global
 * 401 listener.
 */
export const showAuthErrorToast = (showToast: ShowToastFn) => {
  if (authErrorToastVisible) return;
  authErrorToastVisible = true;
  showToast(authErrorToastContent());
};

export const showApiErrorToast = (
  showToast: ShowToastFn,
  error: unknown,
  fallbackMessage: string,
) => {
  if (isAuthApiError(error)) {
    showAuthErrorToast(showToast);
    return;
  }

  showToast(getApiErrorMessage(error, fallbackMessage), "error");
};
