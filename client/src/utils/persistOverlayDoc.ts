import type { DBOverlay, OverlayInfo } from "../types";
import { applyPouchAudit } from "./pouchAudit";

const POUCH_CONFLICT_STATUS = 409;
const OVERLAY_PUT_MAX_ATTEMPTS = 4;

export type OverlayDocDb = {
  get: (id: string) => Promise<unknown>;
  put: (doc: unknown) => Promise<{ rev?: string } | unknown>;
};

export const isPouchConflict = (e: unknown): boolean =>
  typeof e === "object" &&
  e !== null &&
  "status" in e &&
  (e as { status?: number }).status === POUCH_CONFLICT_STATUS;

export const persistExistingOverlayDoc = async (
  db: OverlayDocDb,
  overlay: OverlayInfo,
): Promise<DBOverlay> => {
  let lastError: unknown;

  for (let attempt = 0; attempt < OVERLAY_PUT_MAX_ATTEMPTS; attempt++) {
    const dbOverlay = (await db.get(`overlay-${overlay.id}`)) as DBOverlay;
    const merged = applyPouchAudit(
      dbOverlay,
      {
        ...dbOverlay,
        ...overlay,
        updatedAt: new Date().toISOString(),
      },
      { isNew: false },
    ) as DBOverlay;

    try {
      const result = await db.put(merged);
      const rev =
        typeof result === "object" && result !== null && "rev" in result
          ? (result as { rev?: string }).rev
          : undefined;
      return rev ? { ...merged, _rev: rev } : merged;
    } catch (e) {
      lastError = e;
      if (isPouchConflict(e) && attempt < OVERLAY_PUT_MAX_ATTEMPTS - 1) {
        continue;
      }
      throw e;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Overlay save failed");
};
