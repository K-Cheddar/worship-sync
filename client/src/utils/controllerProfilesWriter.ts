import { type Database, ref, set, update } from "firebase/database";
import {
  ControllerProfile,
  serializeControllerProfiles,
} from "./controllerProfiles";
import { getChurchDataPath } from "./firebasePaths";

/**
 * Serializes every controller-registry write on this client, whoever makes it.
 *
 * Same reasoning as the display output writer: the overlay-target migration and
 * an operator editing the Controllers panel can fire in the same tick, and a
 * whole-node `set` from one would silently drop the other's edit.
 */
let writeQueue: Promise<unknown> = Promise.resolve();

/**
 * Persist the controller profile registry for a church.
 *
 * Given the list the caller started from, this writes per-profile keys and nulls
 * the ones that went away, so two operators editing different controllers do
 * not overwrite each other. Without `previous` it writes whole, because it
 * cannot tell a removal from an absence.
 *
 * Returns false instead of throwing so callers can surface a next step rather
 * than breaking the surface the operator is working on.
 */
export const writeControllerProfiles = (
  db: Database | null | undefined,
  churchId: string | null | undefined,
  profiles: ControllerProfile[],
  previous?: ControllerProfile[],
): Promise<boolean> => {
  const run = writeQueue
    .catch(() => undefined)
    .then(() => performWrite(db, churchId, profiles, previous));
  writeQueue = run.catch(() => undefined);
  return run;
};

const performWrite = async (
  db: Database | null | undefined,
  churchId: string | null | undefined,
  profiles: ControllerProfile[],
  previous?: ControllerProfile[],
): Promise<boolean> => {
  const path = getChurchDataPath(churchId, "controllerProfiles");
  if (!db || !path) return false;
  try {
    const serialized = serializeControllerProfiles(profiles);
    if (!previous) {
      await set(ref(db, path), serialized);
      return true;
    }

    const previousSerialized = serializeControllerProfiles(previous);
    const updates: Record<string, unknown> = {};
    for (const [id, value] of Object.entries(serialized)) {
      if (JSON.stringify(previousSerialized[id]) !== JSON.stringify(value)) {
        updates[id] = value;
      }
    }
    const kept = new Set(Object.keys(serialized));
    for (const profile of previous) {
      if (!kept.has(profile.id)) updates[profile.id] = null;
    }
    if (Object.keys(updates).length > 0) {
      await update(ref(db, path), updates);
    }
    return true;
  } catch {
    return false;
  }
};
