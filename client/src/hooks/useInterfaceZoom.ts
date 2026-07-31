import { useEffect, useSyncExternalStore } from "react";
import {
  applyInterfaceZoomToDocument,
  getInterfaceZoomSnapshot,
  INTERFACE_ZOOM_MAX,
  INTERFACE_ZOOM_MIN,
  INTERFACE_ZOOM_STEP,
  resetInterfaceZoom,
  setInterfaceZoom,
  subscribeInterfaceZoom,
} from "../utils/interfaceZoom";

/**
 * Shared interface zoom for operator chrome (Controller, Teams, Account, etc.).
 * Scales the document root font-size so rem-based UI grows/shrinks together.
 */
export const useInterfaceZoom = () => {
  const zoomLevel = useSyncExternalStore(
    subscribeInterfaceZoom,
    getInterfaceZoomSnapshot,
    () => 100,
  );

  useEffect(() => {
    applyInterfaceZoomToDocument(zoomLevel);
  }, [zoomLevel]);

  return {
    zoomLevel,
    zoomMin: INTERFACE_ZOOM_MIN,
    zoomMax: INTERFACE_ZOOM_MAX,
    zoomStep: INTERFACE_ZOOM_STEP,
    setZoomWithinBounds: setInterfaceZoom,
    resetZoom: resetInterfaceZoom,
  };
};

export default useInterfaceZoom;
