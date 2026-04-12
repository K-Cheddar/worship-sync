import _ from "lodash";
import type { AnyAction, Dispatch } from "redux";
import { DBOverlay, OverlayInfo } from "../types";
import { overlaySlice, OverlayState } from "../store/overlaySlice";
import { normalizeOverlayForSync } from "./overlayUtils";

/** Minimal root slice shape for overlay remote sync (avoids importing `store` → circular deps). */
export type OverlaySyncRootSlice = {
  undoable: { present: { overlay: OverlayState } };
};

/**
 * When we buffer remote (local has pending edits), the sidebar list must not show the remote row
 * while the editor shows local — keep the last local list row for this id.
 * Aligns with `syncSelectedOverlayFromRemote`: once `hasRemoteUpdate` + `pendingRemoteOverlay`
 * is set, keep the list row as Redux `selectedOverlay` until the user resolves the conflict,
 * including when a duplicate replication event re-sends the same remote doc as `pendingRemoteOverlay`.
 */
export function shouldKeepLocalListRowForRemoteOverlay(
  getState: () => OverlaySyncRootSlice,
  remoteNormalized: OverlayInfo,
): boolean {
  const {
    selectedOverlay,
    hasPendingUpdate,
    baseOverlay,
    pendingRemoteOverlay,
    hasRemoteUpdate,
  } = getState().undoable.present.overlay;

  if (!selectedOverlay?.id || selectedOverlay.id !== remoteNormalized.id) {
    return false;
  }
  if (hasRemoteUpdate && pendingRemoteOverlay) {
    return true;
  }
  const docMatchesCurrent = _.isEqual(
    remoteNormalized,
    normalizeOverlayForSync(selectedOverlay),
  );
  if (hasPendingUpdate && docMatchesCurrent) {
    return false;
  }
  const docMatchesBase =
    !!baseOverlay && _.isEqual(remoteNormalized, baseOverlay);
  return !!hasPendingUpdate && !docMatchesBase;
}

/** After refetching all overlay docs, keep the selected row as local Redux overlay when buffering. */
export function mergeRemoteOverlayListWithLocalBuffer(
  remoteList: OverlayInfo[],
  getState: () => OverlaySyncRootSlice,
): OverlayInfo[] {
  const { selectedOverlay } = getState().undoable.present.overlay;
  if (!selectedOverlay?.id) return remoteList;

  const match = remoteList.find((o) => o.id === selectedOverlay.id);
  if (!match) return remoteList;

  const normalized = normalizeOverlayForSync(match);
  if (!shouldKeepLocalListRowForRemoteOverlay(getState, normalized)) {
    return remoteList;
  }

  return remoteList.map((o) =>
    o.id === selectedOverlay.id ? selectedOverlay : o,
  );
}

/**
 * When the overlays list was updated from remote, keep `selectedOverlay` in sync
 * (mirrors items + allDocs listener: buffer while local edits pending, else apply).
 */
export function syncSelectedOverlayFromRemote(
  dispatch: Dispatch<AnyAction>,
  getState: () => OverlaySyncRootSlice,
  remoteOverlay: DBOverlay | OverlayInfo,
): void {
  const normalized = normalizeOverlayForSync(remoteOverlay);
  const {
    selectedOverlay,
    hasPendingUpdate,
    baseOverlay,
    pendingRemoteOverlay,
    hasRemoteUpdate,
  } = getState().undoable.present.overlay;

  if (!selectedOverlay?.id || selectedOverlay.id !== normalized.id) {
    return;
  }

  if (_.isEqual(normalized, pendingRemoteOverlay)) {
    return;
  }

  const docMatchesCurrent = !!(
    selectedOverlay &&
    _.isEqual(normalized, normalizeOverlayForSync(selectedOverlay))
  );

  const docMatchesBase = !!baseOverlay && _.isEqual(normalized, baseOverlay);
  const shouldBufferRemote = !!hasPendingUpdate && !docMatchesBase;

  if (shouldBufferRemote) {
    if (docMatchesCurrent) {
      return;
    }
    if (!_.isEqual(normalized, pendingRemoteOverlay)) {
      dispatch(overlaySlice.actions.bufferRemoteOverlayUpdate(normalized));
    }
    return;
  }

  if (docMatchesBase && !hasRemoteUpdate) {
    return;
  }

  if (docMatchesCurrent) {
    return;
  }

  dispatch(overlaySlice.actions.selectOverlay(normalized));
}
