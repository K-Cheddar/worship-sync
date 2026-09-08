import { useCallback, useState } from "react";
import Toggle from "../../components/Toggle/Toggle";
import Input from "../../components/Input/Input";
import { updateDisplayDeviceSettings } from "../../api/auth";
import type { DisplayDeviceClient } from "../../api/authTypes";
import {
  DisplayOutput,
  DISPLAY_OUTPUT_TYPE_LABELS,
} from "../../utils/displayOutputs";
import {
  DisplaySettings,
  LegacyMonitorSettings,
  getApplicableSettingKeys,
  resolveDisplaySettings,
  resolveOutputDefaults,
  supportsHeadless,
} from "../../utils/displaySettings";
import { writeScreenSettings } from "../../utils/screenSettingsStore";
import { useScreenOverrides } from "../../hooks/useScreenOverrides";

/**
 * Overrides that belong to a single screen rather than to the display.
 *
 * `isHeadless` is here and nowhere else: it describes the window, so it can only
 * be set per screen. The rest are shown as overrides on top of the display's
 * defaults, which is what lets two screens mirror one display while only one
 * carries the clock.
 */
const SCREEN_TOGGLES = [
  { key: "isHeadless" as const, label: "Headless" },
  { key: "showClock" as const, label: "Clock" },
  { key: "showTimer" as const, label: "Timer" },
  { key: "localVideoAudioEnabled" as const, label: "Video sound" },
];

type DisplayScreensSectionProps = {
  output: DisplayOutput;
  screens: DisplayDeviceClient[];
  churchId?: string | null;
  onError: (message: string, variant: "error") => void;
  onChanged: () => void | Promise<void>;
  /**
   * A window this machine has open for the display. Local windows are never
   * paired — they inherit the operator's session — so they have no device
   * record and their overrides are stored on this device instead.
   */
  localScreen?: { isOpen: boolean; screenLabel?: string } | null;
  /**
   * The church-wide settings this display still falls back to, if any. Without
   * it these controls resolve against shipped defaults while the room renders
   * something else, so an operator "fixes" a value that was never wrong.
   */
  legacyMonitorSettings?: LegacyMonitorSettings | null;
};

const DisplayScreensSection = ({
  output,
  screens,
  churchId,
  onError,
  onChanged,
  localScreen,
  legacyMonitorSettings,
}: DisplayScreensSectionProps) => {
  const [savingDeviceId, setSavingDeviceId] = useState("");
  const localOverrides = useScreenOverrides(output.id);

  const handleToggle = useCallback(
    async (screen: DisplayDeviceClient, patch: DisplaySettings) => {
      if (!churchId) return;
      setSavingDeviceId(screen.deviceId);
      try {
        const next = {
          ...((screen.settings as DisplaySettings) ?? {}),
          ...patch,
        };
        const response = await updateDisplayDeviceSettings(
          churchId,
          screen.deviceId,
          next,
        );
        if (!response.success) throw new Error("save failed");
        await onChanged();
      } catch {
        onError(
          `Couldn't update ${screen.label}. Check your connection and try again.`,
          "error",
        );
      } finally {
        setSavingDeviceId("");
      }
    },
    [churchId, onChanged, onError],
  );

  if (screens.length === 0 && !localScreen) return null;

  const applicable = getApplicableSettingKeys(output.type);
  // `isHeadless` is a screen override rather than an output default, so it is
  // not in `applicable` and needs its own check. Without it every display
  // showed a Headless toggle, including the ones no page reads it on.
  const screenToggles = SCREEN_TOGGLES.filter((setting) =>
    setting.key === "isHeadless"
      ? supportsHeadless(output.type)
      : applicable.includes(setting.key),
  );
  const hasLocalVideoVolume = applicable.includes("localVideoVolume");
  // Resolved once: the same values were being recomputed per control, and each
  // call is a place the legacy underlay could be forgotten.
  const outputDefaults = resolveOutputDefaults(
    output.settings,
    legacyMonitorSettings,
  );
  const localResolved = resolveDisplaySettings(
    outputDefaults,
    localOverrides,
    output.type,
  );

  return (
    <div className="mt-2 border-t border-white/10 pt-2">
      <p className="text-xs font-semibold text-gray-200">Screens</p>
      <p className="text-[11px] text-gray-400">
        Paired devices showing this display. Settings here apply to that screen
        only.
      </p>
      <ul className="mt-1 flex flex-col gap-2">
        {localScreen && (
          <li className="rounded border border-white/10 bg-black/20 px-2 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-xs text-white">This device</span>
              <span className="shrink-0 text-[10px] text-gray-400">
                {localScreen.isOpen
                  ? (localScreen.screenLabel ?? "Open")
                  : "Not open"}
              </span>
            </div>
            {screenToggles.length === 0 ? (
              <p className="mt-1 text-[11px] text-gray-400">
                This display has no per-screen settings.
              </p>
            ) : (
              <div className="mt-1 flex flex-wrap items-end gap-x-4 gap-y-1">
                {screenToggles.map((setting) => (
                  <Toggle
                    key={setting.key}
                    label={setting.label}
                    labelClassName="text-[11px]"
                    value={localResolved[setting.key]}
                    onChange={(value) => {
                      const saved = writeScreenSettings(
                        output.id,
                        { [setting.key]: value },
                        output.type,
                      );
                      if (!saved) {
                        onError(
                          "Couldn't save that setting on this device.",
                          "error",
                        );
                      }
                    }}
                  />
                ))}
                {hasLocalVideoVolume &&
                  localResolved.localVideoAudioEnabled && (
                    <Input
                      className="w-24"
                      type="number"
                      min={0}
                      max={100}
                      label="Video volume"
                      aria-label={`Video volume for this device`}
                      value={localResolved.localVideoVolume}
                      onChange={(value) => {
                        const saved = writeScreenSettings(
                          output.id,
                          { localVideoVolume: Number(value) },
                          output.type,
                        );
                        if (!saved) {
                          onError(
                            "Couldn't save that setting on this device.",
                            "error",
                          );
                        }
                      }}
                    />
                  )}
              </div>
            )}
          </li>
        )}
        {screens.map((screen) => {
          const screenSettings = (screen.settings as DisplaySettings) ?? {};
          const resolved = resolveDisplaySettings(
            outputDefaults,
            screenSettings,
            output.type,
          );
          return (
            <li
              key={screen.deviceId}
              className="rounded border border-white/10 bg-black/20 px-2 py-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs text-white">
                  {screen.label}
                </span>
                <span className="shrink-0 text-[10px] text-gray-400">
                  {DISPLAY_OUTPUT_TYPE_LABELS[output.type]}
                </span>
              </div>
              {screenToggles.length === 0 && (
                <p className="mt-1 text-[11px] text-gray-400">
                  This display has no per-screen settings.
                </p>
              )}
              <div className="mt-1 flex flex-wrap items-end gap-x-4 gap-y-1">
                {screenToggles.map((setting) => (
                  <Toggle
                    key={setting.key}
                    label={setting.label}
                    labelClassName="text-[11px]"
                    disabled={savingDeviceId === screen.deviceId}
                    value={resolved[setting.key]}
                    onChange={(value) =>
                      void handleToggle(screen, { [setting.key]: value })
                    }
                  />
                ))}
                {hasLocalVideoVolume && resolved.localVideoAudioEnabled && (
                  <Input
                    className="w-24"
                    type="number"
                    min={0}
                    max={100}
                    label="Video volume"
                    aria-label={`Video volume for ${screen.label}`}
                    disabled={savingDeviceId === screen.deviceId}
                    value={resolved.localVideoVolume}
                    onChange={(value) =>
                      void handleToggle(screen, {
                        localVideoVolume: Number(value),
                      })
                    }
                  />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default DisplayScreensSection;
