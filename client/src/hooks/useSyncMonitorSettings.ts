import { useCallback, useEffect, useState } from "react";
import { type Database } from "firebase/database";
import { useDispatch, useSelector } from "./reduxHooks";
import { useFirebaseValueWithRetry } from "./useFirebaseValueWithRetry";
import {
  setMonitorClockFontSize,
  setMonitorShowClock,
  setMonitorShowNextSlide,
  setMonitorShowTimer,
  setMonitorTimerFontSize,
  setMonitorTimerId,
} from "../store/preferencesSlice";
import { seedDisplayOutputSettings } from "../store/displayOutputsSlice";
import {
  fromLegacyMonitorSettings,
  normalizeDisplaySettings,
} from "../utils/displaySettings";
import { getChurchDataPath } from "../utils/firebasePaths";
import { writeDisplayOutputs } from "../utils/displayOutputsWriter";
import type { RootState } from "../store/store";

/**
 * Sync church monitorSettings from Firebase into Redux so monitor previews
 * (clock/timer band) know which timer to show. Used by /monitor and by
 * controller-like pages that render TransmitHandler without loading local prefs.
 */
type LegacyMonitorSettings = {
  showClock: boolean;
  showTimer: boolean;
  showNextSlide?: boolean;
  clockFontSize: number;
  timerFontSize: number;
  timerId?: string | null;
};

export const useSyncMonitorSettings = (
  firebaseDb: Database | null | undefined,
  churchId: string | null | undefined,
  sharedDataReady: boolean,
) => {
  const dispatch = useDispatch();
  const displayOutputs = useSelector(
    (state: RootState) => state.displayOutputs?.list,
  );
  const displayOutputsLoaded = useSelector(
    (state: RootState) => state.displayOutputs?.isLoaded ?? false,
  );
  const [legacySettings, setLegacySettings] =
    useState<LegacyMonitorSettings | null>(null);

  const handleMonitorSettings = useCallback(
    (data: unknown) => {
      if (!data) return;
      const settings = data as LegacyMonitorSettings;
      dispatch(setMonitorShowClock(settings.showClock));
      dispatch(setMonitorShowTimer(settings.showTimer));
      if (settings.showNextSlide !== undefined) {
        dispatch(setMonitorShowNextSlide(settings.showNextSlide));
      }
      dispatch(setMonitorClockFontSize(settings.clockFontSize));
      dispatch(setMonitorTimerFontSize(settings.timerFontSize));
      dispatch(setMonitorTimerId(settings.timerId || null));
      // Hand the payload to the seeding effect rather than migrating here.
      // Firebase fires once; if it won that race against the registry loading,
      // seeding inline would be skipped and never retried.
      setLegacySettings(settings);
    },
    [dispatch],
  );

  /**
   * One-way migration: churches configured these before displays existed.
   *
   * Runs from an effect so it can wait for the registry. Seeding writes the
   * whole registry, so it must never run against the built-in defaults —
   * monitorSettings and the registry both start on `sharedDataReady`, and
   * losing that race would replace a church's custom displays with defaults.
   * It only fills a display with no settings yet, so a display the church has
   * already configured is never overwritten.
   */
  useEffect(() => {
    if (!legacySettings || !displayOutputsLoaded) return;
    const seeded = fromLegacyMonitorSettings(legacySettings, "monitor");
    if (!seeded) return;
    const outputs = displayOutputs ?? [];
    const existing = outputs.find(
      (output) => output.id === "monitor",
    )?.settings;
    // Backfill rather than bail. Flipping one toggle leaves a partial settings
    // object, and treating that as "already migrated" stranded the rest of the
    // church's settings permanently. Existing values win; only gaps are filled.
    const nextSettings = normalizeDisplaySettings(
      { ...seeded, ...(existing ?? {}) },
      "monitor",
    );
    if (!nextSettings) return;
    // Compare after normalize. Spreading seeded onto existing changes key
    // order, so a stringify of the raw merge never matched a display that
    // already had extra fields (background, local video). The seed dispatched
    // every time, Redux updated, and /monitor hit maximum update depth.
    const currentSettings = existing
      ? normalizeDisplaySettings(existing, "monitor")
      : undefined;
    if (
      JSON.stringify(nextSettings) === JSON.stringify(currentSettings ?? null)
    ) {
      return;
    }

    dispatch(
      seedDisplayOutputSettings({ id: "monitor", settings: nextSettings }),
    );
    // Persist it: the seed is local-only, and the next registry sync carries
    // no settings for a display nobody has configured, which would wipe it
    // straight back out.
    // Passing the pre-seed list keeps this on the keyed write path, so a
    // migration running at the same time as someone editing Displays touches
    // only the monitor key instead of replacing the whole registry.
    void writeDisplayOutputs(
      firebaseDb,
      churchId,
      outputs.map((output) =>
        output.id === "monitor"
          ? { ...output, settings: nextSettings }
          : output,
      ),
      outputs,
    );
  }, [
    churchId,
    dispatch,
    displayOutputs,
    displayOutputsLoaded,
    firebaseDb,
    legacySettings,
  ]);

  useFirebaseValueWithRetry({
    db: firebaseDb,
    path: churchId ? getChurchDataPath(churchId, "monitorSettings") : null,
    enabled: !!firebaseDb && !!churchId && !!sharedDataReady,
    onData: handleMonitorSettings,
    label: "monitor settings",
  });
};
