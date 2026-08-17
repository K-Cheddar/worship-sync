import { useMemo } from "react";
import { useSelector } from "./reduxHooks";
import { selectDisplayOutputs } from "../store/displayOutputsSlice";
import {
  ResolvedDisplaySettings,
  resolveDisplaySettings,
  resolveOutputDefaults,
} from "../utils/displaySettings";
import { useScreenOverrides } from "./useScreenOverrides";
import { GlobalInfoContext } from "../context/globalInfo";
import { useContext } from "react";

/**
 * Settings in force for a display on this screen: registry defaults merged with
 * this device's overrides.
 *
 * For page-level decisions (whether a projector window is headless, for
 * example). `DisplayWindow` resolves the same way inline, because its tests mock
 * the hooks barrel rather than `reduxHooks`.
 */
export const useResolvedDisplaySettings = (
  outputId: string,
): ResolvedDisplaySettings => {
  const outputs = useSelector(selectDisplayOutputs);
  const pairedDeviceSettings = useContext(GlobalInfoContext)?.device?.settings;
  const legacyMonitorSettings = useSelector((state) =>
    outputId === "monitor"
      ? state.undoable?.present?.preferences?.monitorSettings
      : undefined,
  );

  // Subscribed, not read once: an operator flipping Headless mid-service has to
  // reach this page without a reload, the same way DisplayWindow does.
  const screenOverrides = useScreenOverrides(outputId, pairedDeviceSettings);

  return useMemo(
    () =>
      resolveDisplaySettings(
        resolveOutputDefaults(
          outputs.find((output) => output.id === outputId)?.settings,
          legacyMonitorSettings,
        ),
        screenOverrides,
        outputs.find((output) => output.id === outputId)?.type,
      ),
    [legacyMonitorSettings, outputId, outputs, screenOverrides],
  );
};
