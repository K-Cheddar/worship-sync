type OperationClaim = {
  kind: "upload" | "delete";
  token: symbol;
  cancel?: () => void | Promise<void>;
  settled: Promise<void>;
  settle: () => void;
  cleanupError?: Error;
  retryCleanup?: () => Promise<void>;
};

const claims = new Map<string, OperationClaim>();

export type MediaUploadClaim = {
  isCurrent: () => boolean;
  setCancel: (cancel: () => void | Promise<void>) => void;
  failCleanup: (error: Error, retry: () => Promise<void>) => void;
  release: () => void;
};

export const claimMediaUpload = (mediaId: string): MediaUploadClaim | null => {
  if (claims.has(mediaId)) return null;
  let settle!: () => void;
  const claim: OperationClaim = {
    kind: "upload",
    token: Symbol(mediaId),
    settled: new Promise<void>((resolve) => { settle = resolve; }),
    settle: () => settle(),
  };
  claims.set(mediaId, claim);
  return {
    isCurrent: () => claims.get(mediaId)?.token === claim.token,
    setCancel: (cancel) => { claim.cancel = cancel; },
    failCleanup: (error, retry) => {
      claim.cleanupError = error;
      claim.retryCleanup = retry;
    },
    release: () => {
      if (claims.get(mediaId)?.token === claim.token) claims.delete(mediaId);
      claim.settle();
    },
  };
};

export class MediaOperationCleanupError extends Error {
  retryCleanup?: () => Promise<void>;

  constructor(message: string, retryCleanup?: () => Promise<void>) {
    super(message);
    this.name = "MediaOperationCleanupError";
    this.retryCleanup = retryCleanup;
  }
}

export const isMediaUploadClaimed = (mediaId: string) => claims.has(mediaId);

export const claimMediaDeletion = (mediaIds: string[]) => {
  const token = Symbol("media-deletion");
  const previous = new Map<string, OperationClaim>();
  const owned = new Map<string, OperationClaim>();
  for (const mediaId of mediaIds) {
    const existing = claims.get(mediaId);
    if (existing) previous.set(mediaId, existing);
    let settle!: () => void;
    const claim: OperationClaim = {
      kind: "delete",
      token,
      settled: new Promise<void>((resolve) => { settle = resolve; }),
      settle: () => settle(),
    };
    owned.set(mediaId, claim);
    claims.set(mediaId, claim);
  }

  return {
    waitForUploads: async () => {
      const failures: MediaOperationCleanupError[] = [];
      await Promise.all([...previous.values()].map(async (claim) => {
        if (claim.kind === "upload") {
          try {
            await claim.cancel?.();
          } catch (error) {
            const message = error instanceof Error ? error.message : "Upload cleanup failed.";
            failures.push(new MediaOperationCleanupError(message, claim.retryCleanup));
          }
        }
        await claim.settled;
        if (claim.kind === "upload" && claim.cleanupError) {
          failures.push(new MediaOperationCleanupError(
            claim.cleanupError.message,
            claim.retryCleanup,
          ));
        }
      }));
      if (failures.length) throw failures[0];
    },
    release: () => {
      for (const mediaId of mediaIds) {
        const current = claims.get(mediaId);
        if (current?.kind === "delete" && current.token === token) claims.delete(mediaId);
        owned.get(mediaId)?.settle();
      }
    },
  };
};
