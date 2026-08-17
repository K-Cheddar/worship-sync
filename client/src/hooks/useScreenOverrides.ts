import { useEffect, useState } from "react";
import { DisplaySettings } from "../utils/displaySettings";
import {
  resolveScreenOverrides,
  subscribeToScreenSettings,
} from "../utils/screenSettingsStore";

const sameValue = (
  a: DisplaySettings | undefined,
  b: DisplaySettings | undefined,
) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Per-screen overrides for one display on this screen, kept current.
 *
 * Reading the store once at render meant a setting changed on the controller
 * never reached an open display window. Subscribing keeps both documents in
 * step without a reload, which matters because these are edited mid-service.
 *
 * Both the dependency and the update compare by value rather than identity.
 * Resolving allocates a fresh object every read, so an identity comparison
 * would re-render a live display on every tick of anything above it.
 */
export const useScreenOverrides = (
  outputId: string,
  pairedDeviceSettings?: Record<string, unknown> | null,
): DisplaySettings | undefined => {
  const pairedKey = JSON.stringify(pairedDeviceSettings ?? null);
  const [overrides, setOverrides] = useState(() =>
    resolveScreenOverrides(outputId, pairedDeviceSettings),
  );

  useEffect(() => {
    const read = () => {
      const next = resolveScreenOverrides(
        outputId,
        JSON.parse(pairedKey) as Record<string, unknown> | null,
      );
      setOverrides((prev) => (sameValue(prev, next) ? prev : next));
    };
    read();
    return subscribeToScreenSettings(read);
  }, [outputId, pairedKey]);

  return overrides;
};
