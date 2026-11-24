/**
 * Tracks meaningful replication progress for one replication instance.
 * Pending counts only support a percentage after a positive baseline is known;
 * 100% is reserved for the caller's successful completion milestone.
 */
export const createReplicationProgressTracker = () => {
  let maxPending: number | null = null;

  return (pending: unknown): number | null => {
    if (
      typeof pending !== "number" ||
      !Number.isSafeInteger(pending) ||
      pending < 0
    ) {
      return null;
    }

    maxPending = maxPending === null ? pending : Math.max(maxPending, pending);
    if (maxPending === 0) return null;

    return Math.min(99, Math.max(0, Math.floor((1 - pending / maxPending) * 100)));
  };
};
