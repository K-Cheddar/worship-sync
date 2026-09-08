import { type Database, ref, set, update } from "firebase/database";
import { DisplayOutput, serializeDisplayOutputs } from "./displayOutputs";
import { getChurchDataPath } from "./firebasePaths";

/**
 * Persist the display output registry for a church.
 *
 * Given the list the caller started from, this writes per-output keys and nulls
 * the ones that went away. A whole-node `set` made every edit last-writer-wins,
 * so two operators on the Displays tab would silently undo each other; keyed
 * writes narrow that to the same display being edited twice at once.
 *
 * Without `previous` it still writes whole, because it cannot tell a removal
 * from an absence and a partial write would strand a deleted display.
 *
 * Returns false instead of throwing so callers can surface a next step to the
 * operator rather than breaking the surface they are working on.
 */
/**
 * Serializes every registry write on this client, whoever makes it.
 *
 * The Displays panel had its own queue, so a write from elsewhere — the legacy
 * settings migration, for one — could interleave with an operator's edit and
 * land out of order. Keeping the queue here means a new caller is ordered by
 * construction rather than by remembering to opt in.
 */
let writeQueue: Promise<unknown> = Promise.resolve();

export const writeDisplayOutputs = (
  db: Database | null | undefined,
  churchId: string | null | undefined,
  outputs: DisplayOutput[],
  previous?: DisplayOutput[],
): Promise<boolean> => {
  const run = writeQueue
    .catch(() => undefined)
    .then(() => performWrite(db, churchId, outputs, previous));
  writeQueue = run.catch(() => undefined);
  return run;
};

const performWrite = async (
  db: Database | null | undefined,
  churchId: string | null | undefined,
  outputs: DisplayOutput[],
  previous?: DisplayOutput[],
): Promise<boolean> => {
  const path = getChurchDataPath(churchId, "displayOutputs");
  if (!db || !path) return false;
  try {
    const serialized = serializeDisplayOutputs(outputs);
    if (!previous) {
      await set(ref(db, path), serialized);
      return true;
    }

    const previousSerialized = serializeDisplayOutputs(previous);
    const updates: Record<string, unknown> = {};
    for (const [id, value] of Object.entries(serialized)) {
      if (JSON.stringify(previousSerialized[id]) !== JSON.stringify(value)) {
        updates[id] = value;
      }
    }
    const kept = new Set(Object.keys(serialized));
    for (const output of previous) {
      if (!kept.has(output.id)) updates[output.id] = null;
    }
    if (Object.keys(updates).length > 0) {
      await update(ref(db, path), updates);
    }
    return true;
  } catch {
    return false;
  }
};
