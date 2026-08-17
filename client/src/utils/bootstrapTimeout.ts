/** How long a single auth bootstrap attempt may hang before it is abandoned. */
export const BOOTSTRAP_ATTEMPT_TIMEOUT_MS = 15_000;

export class BootstrapTimeoutError extends Error {
  constructor() {
    super("Timed out reaching the server.");
    this.name = "BootstrapTimeoutError";
  }
}

/**
 * Reject a bootstrap attempt that never settles.
 *
 * A request that fails is handled — it retries, then falls back to an offline
 * session. A request that *hangs* is what strands a screen: the surrounding
 * promise never settles, so the loading state is never cleared and a display
 * sits on its blank placeholder with no way back short of a reload.
 *
 * Rejecting turns that case back into the failure path, which the caller
 * already knows how to retry and recover from.
 */
export const withBootstrapTimeout = <T>(
  work: Promise<T>,
  timeoutMs: number = BOOTSTRAP_ATTEMPT_TIMEOUT_MS,
): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout>;
  return Promise.race([
    work,
    new Promise<never>((_resolve, reject) => {
      timeoutId = setTimeout(() => reject(new BootstrapTimeoutError()), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timeoutId)) as Promise<T>;
};
