/**
 * Tracks the newest credit revision this window has applied to on-screen state, keyed by
 * Pouch doc id.
 *
 * Credit edits reach a window from several directions: live replication (`updater`), the
 * cross-window broadcast channel, and full pulls after a reconnect. None of those paths
 * carry ordering guarantees, so an older revision can arrive after a newer one and quietly
 * revert an operator's edit. Comparing the PouchDB revision generation against the last
 * revision we applied lets the apply paths drop those late stragglers.
 *
 * PouchDB revisions have a monotonic generation within a document's lineage,
 * unlike `updatedAt`, which comes from each operator's wall clock. Comparing
 * generations prevents an old replication echo from reverting a newer saved
 * revision without rejecting a genuine later edit from a device with a
 * different clock.
 */
const appliedCreditVersions = new Map<string, number>();

const parseRevisionGeneration = (revision?: string): number | null => {
  const revisionText = String(revision || "").trim();
  if (!revisionText) return null;
  const [generationText, hash] = revisionText.split("-", 2);
  if (!hash) return null;
  const generation = Number(generationText);
  return Number.isSafeInteger(generation) && generation > 0
    ? generation
    : null;
};

/**
 * True when a PouchDB revision predates the revision already applied for this
 * doc, meaning the incoming copy is a straggler and applying it would revert
 * newer text.
 *
 * Unknown docs and docs without a parseable `_rev` are never treated as stale,
 * so legacy payloads keep syncing as before.
 */
export const isStaleCreditDoc = (
  docId: string | undefined,
  revision: string | undefined,
): boolean => {
  if (!docId) return false;
  const applied = appliedCreditVersions.get(docId);
  if (applied === undefined) return false;
  const incoming = parseRevisionGeneration(revision);
  if (incoming === null) return false;
  return incoming < applied;
};

/** Record a revision as applied. Keeps the newest generation seen so out-of-order calls are safe. */
export const recordAppliedCreditVersion = (
  docId: string | undefined,
  revision: string | undefined,
): void => {
  if (!docId) return;
  const incoming = parseRevisionGeneration(revision);
  if (incoming === null) return;
  const applied = appliedCreditVersions.get(docId);
  if (applied !== undefined && incoming <= applied) return;
  appliedCreditVersions.set(docId, incoming);
};

/** Drop all tracked revisions (outline switch / editor teardown). */
export const resetAppliedCreditVersions = (): void => {
  appliedCreditVersions.clear();
};
