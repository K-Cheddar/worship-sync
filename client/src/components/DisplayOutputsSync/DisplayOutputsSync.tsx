import { useContext } from "react";
import { GlobalInfoContext } from "../../context/globalInfo";
import { useSyncDisplayOutputs } from "../../hooks/useSyncDisplayOutputs";

/**
 * Keeps the display output registry in sync on every surface.
 *
 * Mounted once at the app root rather than per page: controllers need it to
 * render previews and send targets, and display surfaces need it to resolve
 * `?output=` and to have a presentation slot for their display. Without it a
 * custom display exists only on the machine that created it.
 */
const DisplayOutputsSync = () => {
  const { firebaseDb, churchId, sharedDataReady } =
    useContext(GlobalInfoContext) || {};

  useSyncDisplayOutputs(firebaseDb, churchId, !!sharedDataReady);

  return null;
};

export default DisplayOutputsSync;
