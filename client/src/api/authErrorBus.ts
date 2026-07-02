/**
 * Tiny framework-agnostic bus so the central API layer can announce a 401
 * (session expired / not authenticated) without importing React. The toast
 * provider registers a handler that surfaces the "refresh to continue" toast,
 * guaranteeing every action that 401s prompts a refresh — regardless of whether
 * the call site handles the error itself.
 */

type AuthErrorHandler = () => void;
type AuthRecoveryHandler = () => boolean | Promise<boolean>;

const handlers = new Set<AuthErrorHandler>();
const recoveryHandlers = new Set<AuthRecoveryHandler>();

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
