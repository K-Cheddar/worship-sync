type PresenceInventory = {
  token: symbol;
  controllerHostIds: string[] | null;
  observedAt: number;
};

const inventories = new Map<string, PresenceInventory>();
const presenceListeners = new Set<() => void>();
const MAX_ACTIVE_INSTANCE_AGE_MS = 60 * 60 * 1000;
const MAX_PRESENCE_SNAPSHOT_AGE_MS = 40 * 60 * 1000;

const notifyPresenceChanged = () => {
  presenceListeners.forEach((listener) => listener());
};

/** Wake presence subscribers when RTDB connectivity changes outside activeInstances. */
export const notifyActiveControllerPresenceChanged = () => {
  notifyPresenceChanged();
};

export const subscribeToActiveControllerPresence = (listener: () => void) => {
  presenceListeners.add(listener);
  return () => presenceListeners.delete(listener);
};

export const getControllerPresenceScope = (churchId: string, database: string) =>
  JSON.stringify([churchId, database.toLowerCase()]);

/**
 * Begin tracking the RTDB activeInstances snapshot for one shared content DB.
 * Until a complete snapshot arrives, cleanup must treat controller presence as
 * unknown. The returned handle prevents stale effects from replacing a newer
 * scope's inventory.
 */
export const beginActiveControllerPresence = (scope: string) => {
  const token = Symbol(scope);
  inventories.set(scope, { token, controllerHostIds: null, observedAt: 0 });
  notifyPresenceChanged();

  return {
    publish: (controllerHostIds: string[] | null) => {
      if (inventories.get(scope)?.token !== token) return;
      inventories.set(scope, {
        token,
        controllerHostIds,
        observedAt: Date.now(),
      });
      notifyPresenceChanged();
    },
    release: () => {
      if (inventories.get(scope)?.token === token) {
        inventories.delete(scope);
        notifyPresenceChanged();
      }
    },
  };
};

/** True only when a complete presence snapshot proves this is the sole Controller. */
export const isOnlyActiveController = (
  scope: string,
  hostId: string,
  now = Date.now(),
): boolean => {
  const inventory = inventories.get(scope);
  const hostIds = inventory?.controllerHostIds;
  if (
    !inventory ||
    !hostIds ||
    now < inventory.observedAt ||
    now - inventory.observedAt > MAX_PRESENCE_SNAPSHOT_AGE_MS ||
    hostIds.length !== 1 ||
    hostIds[0] !== hostId
  ) {
    return false;
  }
  return true;
};

export const isFreshActiveControllerRecord = (
  lastActive: string,
  now = Date.now(),
) => {
  const activeAt = Date.parse(lastActive);
  return Number.isFinite(activeAt) && now - activeAt <= MAX_ACTIVE_INSTANCE_AGE_MS;
};
