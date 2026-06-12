import {
  ref,
  onValue,
  type Database,
  type DataSnapshot,
} from "firebase/database";

/**
 * Firebase RTDB cancels a listen *permanently* when a read is rejected by the
 * security rules (permission_denied) — common when a listener attaches before
 * the renderer's auth token has propagated to the realtime socket. Detecting it
 * lets us re-attach instead of being stuck on stale data until the window is
 * reopened.
 */
export const isFirebasePermissionDenied = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const maybe = error as { code?: string; message?: string };
  const code = maybe.code?.toLowerCase();
  if (code === "permission_denied") return true;
  const msg = String(maybe.message || "").toLowerCase();
  return (
    msg.includes("permission_denied") || msg.includes("permission to access")
  );
};

/** Warn (and slow down) after this many consecutive denials (~20s of fast retries). */
const PERMISSION_RETRY_WARN_AT = 12;
/** Steady-state interval once denials look persistent — likely a real rules issue (ms). */
const PERSISTENT_DENIAL_RETRY_MS = 60_000;

/**
 * Backoff for re-attaching a cancelled listener. Fast exponential backoff (to
 * 2.5s) covers the brief startup auth race; if denials persist past the warn
 * threshold it's likely a real rules problem, so fall back to a slow poll. That
 * still recovers if the rules are later fixed, without scheduling tight-loop
 * timers forever on a window left open for hours.
 */
const retryDelayMs = (zeroBasedAttempt: number) => {
  if (zeroBasedAttempt >= PERMISSION_RETRY_WARN_AT) {
    return PERSISTENT_DENIAL_RETRY_MS;
  }
  return Math.min(2500, 100 * 2 ** Math.min(zeroBasedAttempt, 6));
};

export type SubscribeWithRetryOptions = {
  /** Human-readable label used in logs. */
  label?: string;
  /** Called for non-permission errors (permission_denied is retried instead). */
  onError?: (error: Error) => void;
};

/**
 * Subscribe to a Firebase RTDB path, automatically re-attaching after a
 * permission_denied cancellation (capped exponential backoff, indefinitely).
 * Returns an unsubscribe function.
 *
 * Giving up would leave the window showing stale data until it is reopened, so
 * we keep retrying — the denial is virtually always transient (auth still
 * settling). A single warning is logged after repeated failures so a genuine
 * rules misconfiguration is still surfaced.
 */
export const subscribeWithPermissionRetry = (
  db: Database,
  path: string,
  onData: (snapshot: DataSnapshot) => void,
  options: SubscribeWithRetryOptions = {}
): (() => void) => {
  const { label, onError } = options;
  let cancelled = false;
  let unsubscribe: (() => void) | null = null;
  let retryTimeout: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;
  let warned = false;

  const attach = () => {
    if (cancelled) return;
    // Firebase already cancels the listener on permission_denied, but tear down
    // the previous one defensively before re-attaching in case SDK behavior
    // ever differs (avoids duplicate deliveries).
    unsubscribe?.();
    const valueRef = ref(db, path);
    unsubscribe = onValue(
      valueRef,
      (snapshot) => {
        attempt = 0;
        onData(snapshot);
      },
      (error) => {
        if (cancelled) return;
        if (isFirebasePermissionDenied(error)) {
          if (attempt >= PERMISSION_RETRY_WARN_AT && !warned) {
            warned = true;
            console.warn(
              `${label ?? path}: repeated permission_denied — retrying slowly. ` +
                `If this persists, reload the window or check the database access rules.`
            );
          }
          const thisAttempt = attempt;
          attempt += 1;
          retryTimeout = setTimeout(attach, retryDelayMs(thisAttempt));
          return;
        }
        console.error(`Could not subscribe to ${label ?? path}:`, error);
        onError?.(error as Error);
      }
    );
  };

  attach();

  return () => {
    cancelled = true;
    if (retryTimeout) clearTimeout(retryTimeout);
    unsubscribe?.();
  };
};
