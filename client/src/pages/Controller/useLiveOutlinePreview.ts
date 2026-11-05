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
  DBItemLists,
  DBItemListDetails,
  ItemList,
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
  const { db, cloud, updater, bootstrapReady } =
    useContext(ControllerInfoContext) || {};
  const reduxOutlines = useSelector(
    (state) => state.undoable.present.itemLists.currentLists,
  );
  const registryInitialized = useSelector(
    (state) => state.undoable.present.itemLists.isInitialized,
  );
  const reduxSelectedId = useSelector(
    (state) => state.undoable.present.itemLists.selectedIdByScope[outlineScope],
  );
  const reduxLiveOutlineId = useSelector(
    (state) => state.undoable.present.itemLists.activeList?._id,
  );
  const [fallbackRegistry, setFallbackRegistry] = useState<{
    database: typeof db;
    document?: DBItemLists;
  }>();
  const [items, setItems] = useState<ServiceItemType[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [registryVersion, setRegistryVersion] = useState(0);
  const registryReadRef = useRef<{
    database: typeof db;
    version: number;
    promise: Promise<DBItemLists>;
  } | undefined>(undefined);
  const activeListIdRef = useRef<string | undefined>(undefined);
  const activeListScopeRef = useRef<string | undefined>(undefined);
  const requestIdRef = useRef(0);
  const scopeRef = useRef(outlineScope);
  const bootstrapWasReadyRef = useRef(Boolean(bootstrapReady));
  scopeRef.current = outlineScope;

  const fallbackDocument = fallbackRegistry?.database === db
    ? fallbackRegistry.document
    : undefined;

  const outlines = registryInitialized
    ? reduxOutlines
    : fallbackDocument?.itemLists ?? [];
  const selectedId = registryInitialized
    ? reduxSelectedId
    : fallbackDocument?.selectedIdByScope?.[outlineScope];
  const liveOutlineId = registryInitialized
    ? reduxLiveOutlineId
    : fallbackDocument?.activeList?._id;
  const outlineId = resolveLiveOutlineId(
    outlines,
    outlineScope,
    selectedId,
    liveOutlineId,
  );
  const isLoadingRegistry = Boolean(
    db && !registryInitialized && fallbackRegistry?.database !== db,
  );

  useEffect(() => {
    if (registryInitialized || !db) return;
    let cancelled = false;
    let request = registryReadRef.current;
    if (request?.database !== db || request.version !== registryVersion) {
      request = {
        database: db,
        version: registryVersion,
        promise: Promise.resolve().then(
          () => db.get("ItemLists") as Promise<DBItemLists>,
        ),
      };
      registryReadRef.current = request;
    }
    request.promise.then(
      (document) => {
        if (cancelled) return;
        const fallbackOutlineId = resolveLiveOutlineId(
          document.itemLists ?? [],
          outlineScope,
          document.selectedIdByScope?.[outlineScope],
          document.activeList?._id,
        );
        if (
          activeListScopeRef.current !== outlineScope ||
          activeListIdRef.current !== fallbackOutlineId
        ) {
          setIsLoading(Boolean(fallbackOutlineId));
        }
        setFallbackRegistry({ database: db, document });
      },
      () => {
        if (cancelled) return;
        setIsLoading(false);
        setFallbackRegistry((current) =>
          current?.database === db ? current : { database: db },
        );
      },
    );
    return () => {
      cancelled = true;
    };
  }, [db, outlineScope, registryInitialized, registryVersion]);

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
          scopeRef.current === requestScope &&
          showLoading
        ) {
          setItems([]);
        }
      } finally {
        if (
          requestIdRef.current === requestId &&
          scopeRef.current === requestScope
        ) {
          setIsLoading(false);
        }
      }
    },
    [db, cloud],
  );

  const loadActiveList = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    const requestScope = outlineScope;
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

  useEffect(() => {
    const becameReady = Boolean(bootstrapReady) && !bootstrapWasReadyRef.current;
    bootstrapWasReadyRef.current = Boolean(bootstrapReady);
    if (!becameReady) return;
    const listId = activeListIdRef.current;
    if (!listId || activeListScopeRef.current !== outlineScope) return;
    const requestId = ++requestIdRef.current;
    void loadOutlineItems(listId, requestId, outlineScope, false);
  }, [bootstrapReady, loadOutlineItems, outlineScope]);

  const handleExternalUpdate = useCallback(
    (event: CustomEventInit) => {
      const updates = event.detail;
      if (!Array.isArray(updates)) return;
      if (
        !registryInitialized &&
        updates.some((update) => update._id === "ItemLists")
      ) {
        setRegistryVersion((version) => version + 1);
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
          false,
        );
      }
    },
    [loadOutlineItems, registryInitialized],
  );

  useEffect(() => {
    if (!updater) return;
    updater.addEventListener("update", handleExternalUpdate);
    return () => updater.removeEventListener("update", handleExternalUpdate);
  }, [updater, handleExternalUpdate]);

  useGlobalBroadcast(handleExternalUpdate);

  return { items, isLoading: isLoading || isLoadingRegistry };
};

const resolveLiveOutlineId = (
  outlines: ItemList[],
  outlineScope: string,
  selectedId?: string,
  liveOutlineId?: string,
): string | undefined => {
  const activePresentationOutline = outlineScope === DEFAULT_OUTLINE_SCOPE
    ? resolveOutlineForScope(outlines, outlineScope, liveOutlineId)
    : undefined;
  const preferredId = activePresentationOutline?._id === liveOutlineId
    ? liveOutlineId
    : selectedId;
  return resolveOutlineForScope(outlines, outlineScope, preferredId)?._id;
};
