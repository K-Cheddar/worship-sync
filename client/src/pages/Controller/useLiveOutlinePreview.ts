import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { useGlobalBroadcast } from "../../hooks/useGlobalBroadcast";
import { formatItemList } from "../../utils/formatItemList";
import {
  DEFAULT_OUTLINE_SCOPE,
  resolveOutlineForScope,
} from "../../utils/outlineScope";
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
export const useLiveOutlinePreview = (outlineScope = DEFAULT_OUTLINE_SCOPE): {
  items: ServiceItemType[];
  isLoading: boolean;
} => {
  const { db, cloud, updater } = useContext(ControllerInfoContext) || {};
  const [items, setItems] = useState<ServiceItemType[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const activeListIdRef = useRef<string | undefined>(undefined);
  const activeListScopeRef = useRef<string | undefined>(undefined);
  const requestIdRef = useRef(0);
  const scopeRef = useRef(outlineScope);
  scopeRef.current = outlineScope;

  const loadOutlineItems = useCallback(
    async (
      listId: string | undefined,
      requestId: number,
      requestScope: string,
    ) => {
      if (!db || !cloud || !listId) {
        if (
          requestIdRef.current === requestId &&
          scopeRef.current === requestScope
        ) {
          setItems([]);
          setIsLoading(false);
        }
        return;
      }
      try {
        const response: DBItemListDetails | undefined = await db.get(listId);
        if (
          requestIdRef.current !== requestId ||
          scopeRef.current !== requestScope
        ) {
          return;
        }
        setItems(formatItemList(response?.items || [], cloud));
      } catch {
        if (
          requestIdRef.current === requestId &&
          scopeRef.current === requestScope
        ) {
          setItems([]);
        }
      } finally {
        if (requestIdRef.current === requestId && scopeRef.current === requestScope) {
          setIsLoading(false);
        }
      }
    },
    [db, cloud],
  );

  const loadActiveList = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    const requestScope = outlineScope;
    if (!db || !cloud) {
      setItems([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const response: ItemLists | undefined = await db.get("ItemLists");
      if (
        requestIdRef.current !== requestId ||
        scopeRef.current !== requestScope
      ) {
        return;
      }
      const activeId = resolveOutlineForScope(
        response?.itemLists ?? [],
        requestScope,
        response?.selectedIdByScope?.[requestScope] ??
          (requestScope === DEFAULT_OUTLINE_SCOPE
            ? response?.activeList?._id
            : undefined),
      )?._id;
      if (activeListIdRef.current !== activeId) setItems([]);
      activeListIdRef.current = activeId;
      activeListScopeRef.current = requestScope;
      await loadOutlineItems(activeId, requestId, requestScope);
    } catch {
      if (
        requestIdRef.current === requestId &&
        scopeRef.current === requestScope
      ) {
        activeListIdRef.current = undefined;
        activeListScopeRef.current = undefined;
        setItems([]);
        setIsLoading(false);
      }
    }
  }, [cloud, db, loadOutlineItems, outlineScope]);

  useEffect(() => {
    void loadActiveList();
    return () => {
      requestIdRef.current += 1;
    };
  }, [loadActiveList]);

  const handleExternalUpdate = useCallback(
    (event: CustomEventInit) => {
      const updates = event.detail;
      if (!Array.isArray(updates)) return;
      // When an active-list change and a detail update arrive in one PouchDB
      // batch, the new ItemLists selection owns this refresh. Fetching the old
      // detail in the same batch must not invalidate the newer selection read.
      if (updates.some((update) => update._id === "ItemLists")) {
        void loadActiveList();
        return;
      }
      if (
        activeListScopeRef.current === scopeRef.current &&
        updates.some((update) => update._id === activeListIdRef.current)
      ) {
        const requestId = ++requestIdRef.current;
        void loadOutlineItems(
          activeListIdRef.current,
          requestId,
          scopeRef.current,
        );
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
