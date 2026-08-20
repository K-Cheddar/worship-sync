/**
 * Tracks the newest credit revision this window has applied to on-screen state, keyed by
 * Pouch doc id.
 *
 * Credit edits reach a window from several directions: live replication (`updater`), the
 * cross-window broadcast channel, and full pulls after a reconnect. None of those paths
 * carry ordering guarantees, so an older revision can arrive after a newer one and quietly
 * revert an operator's edit. Comparing `updatedAt` against the last revision we applied
 * lets the apply paths drop those late stragglers.
 *
 * `updatedAt` is written by whichever client saved the credit, so cross-device clock skew
 * can shift comparisons. Only strictly older revisions are rejected, which keeps skew from
 * blocking a genuine edit made by another operator.
 */
const appliedCreditVersions = new Map<string, number>();

const parseUpdatedAt = (updatedAt?: string): number | null => {
  if (!updatedAt) return null;
  const parsed = Date.parse(updatedAt);
  return Number.isNaN(parsed) ? null : parsed;
};

/**
 * True when `updatedAt` predates the revision already applied for this doc, meaning the
 * incoming copy is a straggler and applying it would revert newer text.
 *
 * Unknown docs and docs without a parseable `updatedAt` are never treated as stale, so
 * legacy credit docs saved before stamping keep syncing as before.
 */
export const isStaleCreditDoc = (
  docId: string | undefined,
  updatedAt: string | undefined,
): boolean => {
  if (!docId) return false;
  const applied = appliedCreditVersions.get(docId);
  if (applied === undefined) return false;
  const incoming = parseUpdatedAt(updatedAt);
  if (incoming === null) return false;
  return incoming < applied;
};

/** Record a revision as applied. Keeps the newest stamp seen so out-of-order calls are safe. */
export const recordAppliedCreditVersion = (
  docId: string | undefined,
  updatedAt: string | undefined,
): void => {
  if (!docId) return;
  const incoming = parseUpdatedAt(updatedAt);
  if (incoming === null) return;
  const applied = appliedCreditVersions.get(docId);
  if (applied !== undefined && incoming <= applied) return;
  appliedCreditVersions.set(docId, incoming);
};

/** Drop all tracked revisions (outline switch / editor teardown). */
export const resetAppliedCreditVersions = (): void => {
  appliedCreditVersions.clear();
};
