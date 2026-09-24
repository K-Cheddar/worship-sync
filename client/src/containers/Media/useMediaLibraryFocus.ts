import { useCallback, useEffect, useRef } from "react";
import type { MediaRouteKey, MediaType } from "../../types";
import { setFocusMediaId, setMediaRouteFolder } from "../../store/preferencesSlice";
import type { AppDispatch } from "../../store/store";
import { isLocalMediaVisibleByDefault } from "./mediaLibraryLocalAvailability";
import { resolveShowInMediaFolderId } from "./resolveShowInMediaTarget";
import type { VirtualMediaGridHandle } from "./VirtualMediaGrid";

type UseMediaLibraryFocusArgs = {
  dispatch: AppDispatch;
  focusMediaId: string | null;
  list: MediaType[];
  filteredList: MediaType[];
  isMediaLoading: boolean;
  isMediaExpanded: boolean;
  selectedLibraryFilter: string | null;
  pendingDeletionIds: Set<string>;
  deviceId: string;
  routeKey: MediaRouteKey;
  mediaGridRef: React.RefObject<VirtualMediaGridHandle | null>;
  setSearchTerm: (value: string) => void;
  setOriginFilter: (value: "all") => void;
  setTypeFilter: (value: "all") => void;
  setShowOtherDeviceLocalMedia: (value: boolean) => void;
  setSelectedMedia: (media: MediaType) => void;
  setSelectedMediaIds: (
    ids: Set<string> | ((previous: Set<string>) => Set<string>),
  ) => void;
  setPreviewMedia: (media: MediaType | null) => void;
};

export function useMediaLibraryFocus({
  dispatch,
  focusMediaId,
  list,
  filteredList,
  isMediaLoading,
  isMediaExpanded,
  selectedLibraryFilter,
  pendingDeletionIds,
  deviceId,
  routeKey,
  mediaGridRef,
  setSearchTerm,
  setOriginFilter,
  setTypeFilter,
  setShowOtherDeviceLocalMedia,
  setSelectedMedia,
  setSelectedMediaIds,
  setPreviewMedia,
}: UseMediaLibraryFocusArgs) {
  const focusPendingIdRef = useRef<string | null>(null);
  const focusRequestVersionRef = useRef(0);
  const focusAttemptRef = useRef<{
    id: string;
    version: number;
    controller: AbortController;
  } | null>(null);
  const focusRetryFrameRef = useRef<number | null>(null);
  const focusAttemptRunnerRef = useRef<() => void>(() => undefined);

  const cancelFocusWork = useCallback(() => {
    focusAttemptRef.current?.controller.abort();
    focusAttemptRef.current = null;
    if (focusRetryFrameRef.current !== null) {
      cancelAnimationFrame(focusRetryFrameRef.current);
      focusRetryFrameRef.current = null;
    }
  }, []);

  const scheduleFocusRetry = useCallback(() => {
    if (focusRetryFrameRef.current !== null) return;
    focusRetryFrameRef.current = requestAnimationFrame(() => {
      focusRetryFrameRef.current = null;
      focusAttemptRunnerRef.current();
    });
  }, []);

  useEffect(() => {
    if (!focusMediaId) return;

    // A new request owns the focus lifecycle, even when the previous request
    // is still waiting for the panel or virtualizer to become measurable.
    cancelFocusWork();
    focusRequestVersionRef.current += 1;

    const mediaItem = list.find((media) => media.id === focusMediaId);
    if (!mediaItem) {
      // Keep the request while the library is still loading so a late list can
      // still resolve the item. Discard only when the library is settled.
      if (!isMediaLoading) {
        focusPendingIdRef.current = null;
        dispatch(setFocusMediaId(null));
      }
      return;
    }

    dispatch(setFocusMediaId(null));
    focusPendingIdRef.current = focusMediaId;

    setSearchTerm("");
    setOriginFilter("all");
    setTypeFilter("all");
    if (!isLocalMediaVisibleByDefault(mediaItem, deviceId)) {
      setShowOtherDeviceLocalMedia(true);
    }

    const targetFolder = resolveShowInMediaFolderId(mediaItem);
    dispatch(setMediaRouteFolder({ key: routeKey, folderId: targetFolder }));
    setSelectedMedia(mediaItem);
    setSelectedMediaIds(new Set([mediaItem.id]));
    setPreviewMedia(mediaItem);
    // The focus request is intentionally stored in a ref so these lifecycle
    // transitions do not add a render-only state update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cancelFocusWork, focusMediaId, list, isMediaLoading]);

  const tryFocusPendingMedia = useCallback(() => {
    const pendingId = focusPendingIdRef.current;
    if (!pendingId || !isMediaExpanded) return;

    const mediaItem = list.find((media) => media.id === pendingId);
    if (!mediaItem) {
      if (!isMediaLoading) {
        focusPendingIdRef.current = null;
        cancelFocusWork();
      }
      return;
    }

    const expectedFolder = resolveShowInMediaFolderId(mediaItem);
    if (selectedLibraryFilter !== expectedFolder) return;

    const idx = filteredList.findIndex((media) => media.id === pendingId);
    if (idx < 0) {
      if (pendingDeletionIds.has(pendingId)) {
        focusPendingIdRef.current = null;
        cancelFocusWork();
      }
      return;
    }

    if (focusAttemptRef.current) return;

    const scrollToMediaId = mediaGridRef.current?.scrollToMediaId;
    if (!scrollToMediaId) {
      scheduleFocusRetry();
      return;
    }

    const attempt = {
      id: pendingId,
      version: focusRequestVersionRef.current,
      controller: new AbortController(),
    };
    focusAttemptRef.current = attempt;

    void scrollToMediaId(pendingId, { signal: attempt.controller.signal }).then(
      (result) => {
        if (
          focusAttemptRef.current !== attempt ||
          attempt.version !== focusRequestVersionRef.current
        ) {
          return;
        }
        focusAttemptRef.current = null;

        if (result.status === "success" || result.status === "not-found") {
          focusPendingIdRef.current = null;
          return;
        }
        if (result.status === "not-ready") {
          scheduleFocusRetry();
        }
      },
    );
  }, [
    cancelFocusWork,
    filteredList,
    isMediaExpanded,
    isMediaLoading,
    list,
    mediaGridRef,
    pendingDeletionIds,
    scheduleFocusRetry,
    selectedLibraryFilter,
  ]);

  focusAttemptRunnerRef.current = tryFocusPendingMedia;

  useEffect(() => {
    tryFocusPendingMedia();
  }, [tryFocusPendingMedia]);

  useEffect(
    () => () => {
      focusPendingIdRef.current = null;
      cancelFocusWork();
    },
    [cancelFocusWork],
  );
}
