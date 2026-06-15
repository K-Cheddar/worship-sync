/**
 * Tiny framework-agnostic bus so the central API layer can announce a 401
 * (session expired / not authenticated) without importing React. The toast
 * provider registers a handler that surfaces the "refresh to continue" toast,
 * guaranteeing every action that 401s prompts a refresh — regardless of whether
 * the call site handles the error itself.
 */

type AuthErrorHandler = () => void;

const handlers = new Set<AuthErrorHandler>();

/** Register a listener; returns an unsubscribe function. */
export const registerAuthErrorHandler = (handler: AuthErrorHandler) => {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
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
