import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { useSelector } from "../../hooks";
import { useGlobalBroadcast } from "../../hooks/useGlobalBroadcast";
import { formatItemList } from "../../utils/formatItemList";
import {
  DEFAULT_OUTLINE_SCOPE,
  resolveOutlineForScope,
} from "../../utils/outlineScope";
import type {
  DBItemListDetails,
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
  const outlines = useSelector((state) => state.undoable.present.itemLists.currentLists);
  const selectedId = useSelector((state) =>
    state.undoable.present.itemLists.selectedIdByScope[outlineScope],
  );
  const liveOutlineId = useSelector((state) =>
    state.undoable.present.itemLists.activeList?._id,
  );
  const outlineId = resolveOutlineForScope(
    outlines,
    outlineScope,
    selectedId ?? (outlineScope === DEFAULT_OUTLINE_SCOPE ? liveOutlineId : undefined),
  )?._id;
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
      showLoading: boolean,
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
      if (showLoading) setIsLoading(true);
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
          if (showLoading) setItems([]);
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
    if (
      activeListIdRef.current !== undefined &&
      activeListScopeRef.current !== requestScope
    ) {
      setIsLoading(true);
    }
    const selectionChanged =
      activeListScopeRef.current !== requestScope ||
      activeListIdRef.current !== outlineId;
    if (selectionChanged) setIsLoading(true);
    activeListIdRef.current = outlineId;
    activeListScopeRef.current = requestScope;
    await loadOutlineItems(outlineId, requestId, requestScope, selectionChanged);
  }, [loadOutlineItems, outlineId, outlineScope]);

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
      if (
        activeListScopeRef.current === scopeRef.current &&
        updates.some((update) => update._id === activeListIdRef.current)
      ) {
        const requestId = ++requestIdRef.current;
        void loadOutlineItems(
          activeListIdRef.current,
          requestId,
          scopeRef.current,
          false,
        );
      }
    },
    [loadOutlineItems],
  );

  useEffect(() => {
    if (!updater) return;
    updater.addEventListener("update", handleExternalUpdate);
    return () => updater.removeEventListener("update", handleExternalUpdate);
  }, [updater, handleExternalUpdate]);

  useGlobalBroadcast(handleExternalUpdate);

  return { items, isLoading };
};
