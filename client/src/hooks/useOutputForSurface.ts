import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useSelector } from "./reduxHooks";
import { selectDisplayOutputs } from "../store/displayOutputsSlice";
import {
  DisplayOutput,
  PushOutputType,
  resolveOutputForScreen,
} from "../utils/displayOutputs";

/**
 * Which output this screen renders.
 *
 * A screen names its output with `?output=<id>`, so a second projector is just
 * `/projector-full?output=out_lobby` on that machine. Without the parameter the
 * screen falls back to the first enabled output of its surface type, which is
 * the built-in — so existing paired displays keep working untouched.
 *
 * `resolveOutputForScreen` also covers the mid-service case where the named
 * output was retired or deleted: the screen falls back rather than going blank.
 */
/**
 * Electron window key for this screen.
 *
 * The main process keys windows by the `?output=` value (built-ins included),
 * so closing must use that, not the resolved display — a window keyed
 * `projector` that resolved elsewhere would otherwise fail to close.
 */
export const useWindowKeyForSurface = (surfaceType: PushOutputType) => {
  const [searchParams] = useSearchParams();
  return searchParams.get("output") || surfaceType;
};

export const useOutputForSurface = (
  surfaceType: PushOutputType,
): DisplayOutput => {
  const [searchParams] = useSearchParams();
  const requestedOutputId = searchParams.get("output");
  const outputs = useSelector(selectDisplayOutputs);

  return useMemo(
    () => resolveOutputForScreen(outputs, requestedOutputId, surfaceType),
    [outputs, requestedOutputId, surfaceType],
  );
};
