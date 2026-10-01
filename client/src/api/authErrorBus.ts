/**
 * Tiny framework-agnostic bus so the central API layer can announce a 401
 * (session expired / not authenticated) without importing React. The toast
 * provider registers a handler that surfaces the "refresh to continue" toast,
 * guaranteeing every action that 401s prompts a refresh — regardless of whether
 * the call site handles the error itself.
 */

type AuthErrorHandler = () => void;
type AuthRecoveryHandler = () => boolean | Promise<boolean>;
export type UserAuthRecoveryResult =
  | "recovered"
  | "unauthenticated"
  | "unknown";
type UserAuthRecoveryHandler = (
  onConfirmedUnauthenticated: () => void,
) => UserAuthRecoveryResult | Promise<UserAuthRecoveryResult>;

const handlers = new Set<AuthErrorHandler>();
const recoveryHandlers = new Set<AuthRecoveryHandler>();
const userRecoveryHandlers = new Set<UserAuthRecoveryHandler>();
let authenticatedSessionExpected = false;

/**
 * Tracks whether the current UI bootstrap represents an authenticated app
 * session. Public and signed-out requests must never turn an arbitrary 401
 * into a global "sign in again" prompt.
 */
export const setAuthenticatedSessionExpected = (expected: boolean) => {
  authenticatedSessionExpected = expected;
};

export const isAuthenticatedSessionExpected = () =>
  authenticatedSessionExpected;

/** Register a listener; returns an unsubscribe function. */
export const registerAuthErrorHandler = (handler: AuthErrorHandler) => {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
};

/** Register a silent session recovery hook; returns an unsubscribe function. */
export const registerAuthRecoveryHandler = (handler: AuthRecoveryHandler) => {
  recoveryHandlers.add(handler);
  return () => {
    recoveryHandlers.delete(handler);
  };
};

/** Called by the API layer before surfacing a 401. */
export const requestAuthRecovery = async () => {
  for (const handler of recoveryHandlers) {
    try {
      if (await handler()) return true;
    } catch {
      // Recovery is best-effort; a failed handler should not mask the API error.
    }
  }
  return false;
};

/** Register the user-initiated recovery flow, including confirmed session loss. */
export const registerUserAuthRecoveryHandler = (
  handler: UserAuthRecoveryHandler,
) => {
  userRecoveryHandlers.add(handler);
  return () => {
    userRecoveryHandlers.delete(handler);
  };
};

/** Retry recovery explicitly and distinguish a gone session from uncertainty. */
export const requestUserAuthRecovery = async (
  onConfirmedUnauthenticated: () => void,
): Promise<UserAuthRecoveryResult> => {
  for (const handler of userRecoveryHandlers) {
    try {
      const result = await handler(onConfirmedUnauthenticated);
      if (result !== "unknown") return result;
    } catch {
      // Preserve the toast when recovery status cannot be confirmed.
    }
  }
  return "unknown";
};

/** Called by the API layer when a request fails with 401 Unauthorized. */
export const notifyAuthError = () => {
  handlers.forEach((handler) => {
    try {
      handler();
    } catch {
      // A misbehaving handler must not break the API call's error path.
    }
  });
};
