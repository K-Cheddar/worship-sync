type PresenceInventory = {
  token: symbol;
  controllerHostIds: string[] | null;
};

const inventories = new Map<string, PresenceInventory>();

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
  inventories.set(scope, { token, controllerHostIds: null });

  return {
    publish: (controllerHostIds: string[] | null) => {
      if (inventories.get(scope)?.token !== token) return;
      inventories.set(scope, { token, controllerHostIds });
    },
    release: () => {
      if (inventories.get(scope)?.token === token) inventories.delete(scope);
    },
  };
};

/** True only when a complete presence snapshot proves this is the sole Controller. */
export const isOnlyActiveController = (
  scope: string,
  hostId: string,
): boolean => {
  const hostIds = inventories.get(scope)?.controllerHostIds;
  return hostIds?.length === 1 && hostIds[0] === hostId;
};
