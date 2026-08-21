import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { useGlobalBroadcast } from "../../hooks/useGlobalBroadcast";
import { formatItemList } from "../../utils/formatItemList";
import type {
  DBItemListDetails,
  ItemLists,
  ServiceItem as ServiceItemType,
} from "../../types";

/**
 * Read-only mirror of the device's active live outline (the PouchDB-backed
 * item list the Controller page drives). Controller only mounts the outline's
 * sync lifecycle while it itself is on screen, so surfaces like the current
 * service workspace need their own lightweight subscription to see it.
 */
export const useLiveOutlinePreview = (): {
  items: ServiceItemType[];
  isLoading: boolean;
} => {
  const { db, cloud, updater } = useContext(ControllerInfoContext) || {};
  const [items, setItems] = useState<ServiceItemType[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const activeListIdRef = useRef<string | undefined>(undefined);

  const loadOutlineItems = useCallback(
    async (listId: string | undefined) => {
      if (!db || !cloud || !listId) {
        setItems([]);
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      try {
        const response: DBItemListDetails | undefined = await db.get(listId);
        setItems(formatItemList(response?.items || [], cloud));
      } catch {
        setItems([]);
      } finally {
        setIsLoading(false);
      }
    },
    [db, cloud],
  );

  const loadActiveList = useCallback(async () => {
    if (!db || !cloud) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const response: ItemLists | undefined = await db.get("ItemLists");
      const activeId = response?.activeList?._id;
      activeListIdRef.current = activeId;
      await loadOutlineItems(activeId);
    } catch {
      activeListIdRef.current = undefined;
      setItems([]);
      setIsLoading(false);
    }
  }, [cloud, db, loadOutlineItems]);

  useEffect(() => {
    void loadActiveList();
  }, [loadActiveList]);

  const handleExternalUpdate = useCallback(
    (event: CustomEventInit) => {
      const updates = event.detail;
      if (!Array.isArray(updates)) return;
      for (const update of updates) {
        if (update._id === "ItemLists") {
          void loadActiveList();
        } else if (update._id === activeListIdRef.current) {
          void loadOutlineItems(activeListIdRef.current);
        }
      }
    },
    [loadActiveList, loadOutlineItems],
  );

  useEffect(() => {
    if (!updater) return;
    updater.addEventListener("update", handleExternalUpdate);
    return () => updater.removeEventListener("update", handleExternalUpdate);
  }, [updater, handleExternalUpdate]);

  useGlobalBroadcast(handleExternalUpdate);

  return { items, isLoading };
};
