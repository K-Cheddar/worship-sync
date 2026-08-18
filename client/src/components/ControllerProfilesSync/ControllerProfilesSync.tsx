import { useContext } from "react";
import { GlobalInfoContext } from "../../context/globalInfo";
import { useSyncControllerProfiles } from "../../hooks/useSyncControllerProfiles";

/**
 * Keeps the controller profile registry in sync on every surface.
 *
 * Mounted once at the app root beside {@link ../DisplayOutputsSync}: send
 * targeting resolves against a profile wherever it happens, so a surface
 * without this would silently fall back to the unscoped built-ins and reach
 * displays another controller owns.
 */
const ControllerProfilesSync = () => {
  const { firebaseDb, churchId, sharedDataReady } =
    useContext(GlobalInfoContext) || {};

  useSyncControllerProfiles(firebaseDb, churchId, !!sharedDataReady);

  return null;
};

export default ControllerProfilesSync;
