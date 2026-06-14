import Button from "../components/Button/Button";
import { AuthApiError } from "../api/auth";
import type { ToastData } from "../components/Toast/ToastContainer";
import type { ToastVariant } from "../components/Toast/Toast";

export const getApiErrorMessage = (error: unknown, fallback: string) => {
  const message = error instanceof Error ? error.message.trim() : "";
  return message || fallback;
};

export const isAuthApiError = (error: unknown): error is AuthApiError =>
  error instanceof AuthApiError &&
  (error.status === 401 || error.status === 403);

const AUTH_ERROR_TOAST_MESSAGE =
  "Authentication required — refresh the page to continue.";

let authErrorToastVisible = false;

export const resetAuthErrorToastStateForTests = () => {
  authErrorToastVisible = false;
};

export const isAuthFailureMessage = (message: string) => {
  const normalized = message.trim().toLowerCase();
  return (
    normalized.includes("authentication required") ||
    message.trim() === AUTH_ERROR_TOAST_MESSAGE
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
    <div className="mt-2">
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
