import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useStore } from "react-redux";
import { Link2, MonitorPlay, MonitorX, Trash2 } from "lucide-react";
import Menu from "../../components/Menu/Menu";
import { useElectronWindows } from "../../hooks/useElectronWindows";
import { isElectronDisplayWindowOpen } from "../../utils/isElectronDisplayWindowOpen";
import { getDisplayLabel } from "../../utils/displayUtils";
import { buildShareableHashRouterUrl } from "../../utils/environment";
import { DndContext, DragEndEvent } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { useSensors } from "../../utils/dndUtils";
import SortableDisplayOutputRow from "./SortableDisplayOutputRow";
import Button from "../../components/Button/Button";
import Input from "../../components/Input/Input";
import Select from "../../components/Select/Select";
import Toggle from "../../components/Toggle/Toggle";
import { useDispatch, useSelector } from "../../hooks";
import { GlobalInfoContext } from "../../context/globalInfo";
import { useToast } from "../../context/toastContext";
import {
  addDisplayOutput,
  removeDisplayOutput,
  renameDisplayOutput,
  reorderDisplayOutputs,
  selectDisplayOutputs,
  setDisplayOutputEnabled,
  setDisplayOutputSettings,
} from "../../store/displayOutputsSlice";
import { syncOutputSlots } from "../../store/presentationSlice";
import { clearRemoteOutputState, RootState } from "../../store/store";
import {
  DISPLAY_OUTPUT_TYPE_LABELS,
  DisplayOutput,
  DisplayOutputType,
  PUSH_OUTPUT_TYPES,
  PushOutputType,
  isBuiltInOutputId,
  isPushOutputType,
  reorderVisibleOutputIds,
} from "../../utils/displayOutputs";
import { writeDisplayOutputs } from "../../utils/displayOutputsWriter";
import { listDisplayDevices } from "../../api/auth";
import type { DisplayDeviceClient } from "../../api/authTypes";
import DisplayScreensSection from "./DisplayScreensSection";
import DisplayNameField from "./DisplayNameField";
import {
  getApplicableSettingKeys,
  resolveDisplaySettings,
  resolveOutputDefaults,
} from "../../utils/displaySettings";

/** Route a screen opens to render a given output. */
const getScreenPath = (output: DisplayOutput) => {
  const base =
    output.type === "projector"
      ? "/projector-full"
      : output.type === "monitor"
        ? "/monitor"
        : "/stream";
  return `${base}?output=${output.id}`;
};


const SETTING_SAVE_ERROR =
  "Couldn't save that setting. Check your connection and try again.";

/** Boolean settings an operator flips per display. */
const SETTING_TOGGLES = [
  { key: "showClock" as const, label: "Clock" },
  { key: "showTimer" as const, label: "Timer" },
  { key: "showNextSlide" as const, label: "Next slide" },
  { key: "showBackground" as const, label: "Background" },
  { key: "localVideoAudioEnabled" as const, label: "Video sound" },
];

const TYPE_OPTIONS = PUSH_OUTPUT_TYPES.map((type) => ({
  value: type,
  label: DISPLAY_OUTPUT_TYPE_LABELS[type],
}));

/**
 * Configurations tab: name, order, per-display settings, and screen links for
 * every output that can receive presentation content.
 */
const DisplayOutputsPanel = () => {
  const dispatch = useDispatch();
  const store = useStore<RootState>();
  const { showToast } = useToast();
  const { firebaseDb, churchId } = useContext(GlobalInfoContext) || {};

  const outputs = useSelector(selectDisplayOutputs);
  // Before the first remote read, `outputs` is the shipped built-in list rather
  // than this church's registry. Persisting from that state overwrites real
  // names, order, and enabled flags — live routing — so nothing may write yet.
  const isRegistryLoaded = useSelector(
    (state) => state.displayOutputs?.isLoaded ?? false,
  );
  // The church-wide settings a monitor still falls back to until it is
  // configured, so the controls here match what the room renders.
  const legacyMonitorSettings = useSelector(
    (state) => state.undoable?.present?.preferences?.monitorSettings,
  );
  // Retired displays stay listed here: this is where the switch lives, so
  // hiding the row would make disabling a display a one-way trip.
  const pushOutputs = useMemo(
    () => outputs.filter((output) => isPushOutputType(output.type)),
    [outputs],
  );

  const pushOutputIds = useMemo(
    () => pushOutputs.map((output) => output.id),
    [pushOutputs],
  );
  const sensors = useSensors();

  const {
    isElectron,
    displays,
    windowStates,
    openWindow,
    closeWindow,
    focusWindow,
    moveWindowToDisplay,
    setDisplayPreference,
  } = useElectronWindows();

  // Paired screens, so an operator can override settings for one screen from
  // here rather than walking to the machine.
  const [screens, setScreens] = useState<DisplayDeviceClient[]>([]);
  const refreshScreens = useCallback(async () => {
    if (!churchId) return;
    try {
      const response = await listDisplayDevices(churchId);
      setScreens(
        (response.displayDevices ?? []).filter(
          (device) => device.status !== "revoked",
        ),
      );
    } catch {
      // A screen list we cannot load must not block display setup.
      setScreens([]);
    }
  }, [churchId]);
  useEffect(() => {
    void refreshScreens();
  }, [refreshScreens]);
  const screensByOutputId = useMemo(() => {
    const map: Record<string, DisplayDeviceClient[]> = {};
    for (const screen of screens) {
      const key = screen.outputId || screen.surfaceType || "";
      if (!key) continue;
      (map[key] ??= []).push(screen);
    }
    return map;
  }, [screens]);

  const [newType, setNewType] = useState<DisplayOutputType>("projector");
  const [newName, setNewName] = useState("");
  const pendingWrite = useRef<{
    timer: ReturnType<typeof setTimeout>;
    failureMessage: string;
    previous: DisplayOutput[];
    /** Snapshot taken when the operator typed, not read back at flush time. */
    next: DisplayOutput[];
  } | null>(null);
  const persistenceQueue = useRef<Promise<void>>(Promise.resolve());

  const queueRegistryWrite = useCallback(
    (
      next: DisplayOutput[],
      previous: DisplayOutput[],
      failureMessage: string,
    ) => {
      const result = persistenceQueue.current
        .catch(() => undefined)
        .then(() => writeDisplayOutputs(firebaseDb, churchId, next, previous));
      persistenceQueue.current = result.then(
        () => undefined,
        () => undefined,
      );
      return result.then((saved) => {
        if (!saved) showToast(failureMessage, "error");
        return saved;
      });
    },
    [churchId, firebaseDb, showToast],
  );

  /**
   * Apply locally, then persist the resulting registry.
   *
   * Reading the list back from the store after dispatch keeps the reducer as the
   * single source of naming and ordering rules, rather than recomputing them
   * here and risking the two drifting apart.
   */
  const applyAndPersist = useCallback(
    async (action: Parameters<typeof dispatch>[0], failureMessage: string) => {
      // Belt and braces with the disabled fieldset: a write from unhydrated
      // state would overwrite the church's registry with shipped defaults.
      if (!isRegistryLoaded) return false;
      // Fold any not-yet-written numeric edit into this authoritative action.
      // Already-started writes remain ahead of it in the queue, so a later
      // removal always wins and cannot be resurrected by stale settings.
      const pendingPrevious = pendingWrite.current?.previous;
      if (pendingWrite.current) {
        clearTimeout(pendingWrite.current.timer);
        pendingWrite.current = null;
      }
      // Captured before the dispatch so the writer can tell a removal from an
      // absence and write per-output keys instead of the whole registry.
      const previous = pendingPrevious ?? store.getState().displayOutputs.list;
      dispatch(action);
      const next = store.getState().displayOutputs.list;
      // Presentation slots follow the registry so a new output can take content
      // immediately, without waiting for the Firebase round trip.
      dispatch(
        syncOutputSlots(
          next
            .filter((output) => isPushOutputType(output.type))
            .map((output) => ({
              id: output.id,
              type: output.type as PushOutputType,
            })),
        ),
      );
      return queueRegistryWrite(next, previous, failureMessage);
    },
    [dispatch, isRegistryLoaded, queueRegistryWrite, store],
  );

  /**
   * Apply now, persist shortly after.
   *
   * Number inputs fire per keystroke and each persist rewrote the registry, so
   * typing "120" produced three round trips. The dispatch still lands
   * immediately, which is what displays render from.
   */
  const flushPendingWrite = useCallback(() => {
    const pending = pendingWrite.current;
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingWrite.current = null;
    // The snapshot taken when the operator typed, not whatever Redux holds now.
    // A remote echo inside the debounce window replaces the store, and writing
    // that back silently discarded the edit being debounced.
    void queueRegistryWrite(
      pending.next,
      pending.previous,
      pending.failureMessage,
    );
  }, [queueRegistryWrite]);

  const applyAndPersistDebounced = useCallback(
    (action: Parameters<typeof dispatch>[0], failureMessage: string) => {
      if (!isRegistryLoaded) return;
      const previous =
        pendingWrite.current?.previous ?? store.getState().displayOutputs.list;
      dispatch(action);
      if (pendingWrite.current) clearTimeout(pendingWrite.current.timer);
      pendingWrite.current = {
        failureMessage,
        previous,
        next: store.getState().displayOutputs.list,
        timer: setTimeout(flushPendingWrite, 500),
      };
    },
    [dispatch, flushPendingWrite, isRegistryLoaded, store],
  );

  // A half-typed size must still reach Firebase if the operator closes the tab.
  useEffect(() => flushPendingWrite, [flushPendingWrite]);

  const handleAdd = useCallback(() => {
    void applyAndPersist(
      addDisplayOutput({ type: newType, name: newName }),
      "Couldn't add that display. Check your connection and try again.",
    );
    setNewName("");
  }, [applyAndPersist, newName, newType]);

  const handleRemove = useCallback(
    async (outputId: string) => {
      const saved = await applyAndPersist(
        removeDisplayOutput(outputId),
        "Couldn't remove that display. Check your connection and try again.",
      );
      // Only once the registry actually dropped it. Clearing presentation for a
      // display Firebase still lists would blank a screen that is still real.
      if (!saved) return;
      // Presentation writes are keyed per output, so a removed display's node
      // has to be cleared explicitly or updateOutputsFromRemote would recreate
      // the slot on other machines.
      await clearRemoteOutputState(outputId);
    },
    [applyAndPersist],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over) return;
      const reordered = reorderVisibleOutputIds(
        pushOutputIds,
        outputs.map((output) => output.id),
        String(active.id),
        String(over.id),
      );
      if (!reordered) return;
      void applyAndPersist(
        reorderDisplayOutputs(reordered),
        "Couldn't reorder displays. Check your connection and try again.",
      );
    },
    [applyAndPersist, outputs, pushOutputIds],
  );

  /**
   * Desktop only: open a real window for this display, optionally on a chosen
   * screen. The main process builds the route from the key and surface, so the
   * renderer never supplies a URL.
   */
  const handleOpenWindow = useCallback(
    async (output: DisplayOutput, displayId?: number) => {
      if (!window.electronAPI) return;
      if (displayId !== undefined) {
        // Move an already-open window rather than opening a second one.
        const moved = await moveWindowToDisplay(output.id, displayId);
        if (moved) {
          await focusWindow(output.id);
          return;
        }
        await setDisplayPreference(output.id, displayId);
      }
      const opened = await openWindow(output.id, output.type);
      if (!opened) {
        showToast(
          `Couldn't open a window for ${output.name}. Try again from the display menu.`,
          "error",
        );
      }
    },
    [
      focusWindow,
      moveWindowToDisplay,
      openWindow,
      setDisplayPreference,
      showToast,
    ],
  );

  /**
   * The window this machine has open for a display, if any.
   *
   * Local windows inherit the operator's session, so they are never paired and
   * have no device record. Listing them anyway is what makes a booth machine's
   * own second screen configurable from the controller.
   */
  const getLocalScreen = useCallback(
    (output: DisplayOutput) => {
      if (!isElectron) return null;
      const state = windowStates?.displays?.[output.id];
      if (!state) return { isOpen: false };
      const index = displays.findIndex(
        (display) => display.id === state.displayId,
      );
      return {
        isOpen: state.isOpen,
        screenLabel:
          index >= 0 ? getDisplayLabel(displays[index], index) : undefined,
      };
    },
    [displays, isElectron, windowStates],
  );

  /**
   * Open/close entries for one display, mirroring the toolbar display menu so
   * the two controls cannot disagree about what a screen is doing.
   */
  const buildWindowMenuItems = useCallback(
    (output: DisplayOutput) => {
      if (isElectronDisplayWindowOpen(isElectron, windowStates, output.id)) {
        return [
          {
            text: `Close ${output.name}`,
            onClick: () => void closeWindow(output.id),
          },
        ];
      }
      return [
        {
          text: "Last Used Display",
          onClick: () => void handleOpenWindow(output),
        },
        ...displays.map((display, index) => ({
          text: getDisplayLabel(display, index),
          onClick: () => void handleOpenWindow(output, display.id),
        })),
      ];
    },
    [closeWindow, displays, handleOpenWindow, isElectron, windowStates],
  );

  const handleCopyLink = useCallback(
    async (output: DisplayOutput) => {
      // The app is hash-routed, so a link without the `#` lands on the default
      // route and the `?output=` never reaches the router — the screen then
      // resolves whatever surface it happened to open with.
      const url = buildShareableHashRouterUrl(getScreenPath(output));
      try {
        await navigator.clipboard.writeText(url);
        showToast(`Link copied for ${output.name}.`, "success");
      } catch {
        showToast(
          "Couldn't copy the link. Select the address and copy it manually.",
          "error",
        );
      }
    },
    [showToast],
  );

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-3">
      <p className="text-sm text-gray-300">
        Add a display for each screen that needs its own content. Choose which
        displays an item sends to from &quot;Sends to&quot; on the controller. A
        disabled display is hidden from the controller and receives nothing.
      </p>

      {!isRegistryLoaded && (
        <p className="text-xs text-gray-400" role="status">
          Loading this church&apos;s displays...
        </p>
      )}

      {/* Until the first remote read lands, the rows below are the shipped
          built-ins, not this church's registry. Editing them would write those
          defaults over real names, order, and enabled state. `disabled` on a
          fieldset reaches every control inside, including ones added later. */}
      <fieldset
        className="contents"
        disabled={!isRegistryLoaded}
        aria-busy={!isRegistryLoaded}
      >
        <DndContext onDragEnd={handleDragEnd} sensors={sensors}>
          <SortableContext items={pushOutputIds}>
            <ul className="flex flex-col gap-2">
              {pushOutputs.map((output) => (
                <SortableDisplayOutputRow
                  key={output.id}
                  id={output.id}
                  name={output.name}
                >
                  <div className="flex items-center gap-2">
                    <DisplayNameField
                      name={output.name}
                      onCommit={(name) =>
                        void applyAndPersist(
                          renameDisplayOutput({ id: output.id, name }),
                          "Couldn't rename that display. Check your connection and try again.",
                        )
                      }
                    />
                    <span className="shrink-0 rounded bg-white/10 px-2 py-1 text-xs text-gray-200">
                      {DISPLAY_OUTPUT_TYPE_LABELS[output.type]}
                    </span>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <Toggle
                      // Not "Show on controller": this also gates send routing, so
                      // a disabled display receives nothing. The old label read as
                      // visibility only and hid that from the operator.
                      label="Enabled"
                      labelClassName="text-xs"
                      value={output.enabled}
                      onChange={(value) =>
                        void applyAndPersist(
                          setDisplayOutputEnabled({
                            id: output.id,
                            enabled: value,
                          }),
                          "Couldn't update that display. Check your connection and try again.",
                        )
                      }
                    />
                    <div className="flex items-center gap-1">
                      {isElectron && (
                        <Menu
                          menuItems={buildWindowMenuItems(output)}
                          TriggeringButton={
                            <Button
                              variant="tertiary"
                              padding="p-1"
                              svg={
                                isElectronDisplayWindowOpen(
                                  isElectron,
                                  windowStates,
                                  output.id,
                                )
                                  ? MonitorX
                                  : MonitorPlay
                              }
                              aria-label={`Window options for ${output.name}`}
                            />
                          }
                        />
                      )}
                      <Button
                        variant="tertiary"
                        padding="p-1"
                        svg={Link2}
                        aria-label={`Copy screen link for ${output.name}`}
                        onClick={() => void handleCopyLink(output)}
                      />
                      {!isBuiltInOutputId(output.id) && (
                        <Button
                          variant="tertiary"
                          padding="p-1"
                          svg={Trash2}
                          aria-label={`Remove ${output.name}`}
                          onClick={() => void handleRemove(output.id)}
                        />
                      )}
                    </div>
                  </div>

                  {getApplicableSettingKeys(output.type).length > 0 &&
                    (() => {
                      const applicable = getApplicableSettingKeys(output.type);
                      // Legacy underneath, so these controls show what the room
                      // is actually rendering. Resolving without it displayed
                      // shipped defaults while the screen still used the
                      // church-wide settings.
                      const resolved = resolveDisplaySettings(
                        resolveOutputDefaults(
                          output.settings,
                          output.id === "monitor"
                            ? legacyMonitorSettings
                            : undefined,
                        ),
                        undefined,
                        output.type,
                      );
                      return (
                        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/10 pt-2">
                          {SETTING_TOGGLES.filter((setting) =>
                            getApplicableSettingKeys(output.type).includes(
                              setting.key,
                            ),
                          ).map((setting) => (
                            <Toggle
                              key={setting.key}
                              label={setting.label}
                              labelClassName="text-xs"
                              value={resolved[setting.key]}
                              onChange={(value) =>
                                void applyAndPersist(
                                  setDisplayOutputSettings({
                                    id: output.id,
                                    settings: { [setting.key]: value },
                                  }),
                                  SETTING_SAVE_ERROR,
                                )
                              }
                            />
                          ))}
                          {applicable.includes("clockFontSize") &&
                            resolved.showClock && (
                              <>
                                <Input
                                  className="w-24"
                                  type="number"
                                  label="Clock size"
                                  aria-label={`Clock size for ${output.name}`}
                                  value={resolved.clockFontSize}
                                  onChange={(value) =>
                                    applyAndPersistDebounced(
                                      setDisplayOutputSettings({
                                        id: output.id,
                                        settings: {
                                          clockFontSize: Number(value),
                                        },
                                      }),
                                      SETTING_SAVE_ERROR,
                                    )
                                  }
                                />
                              </>
                            )}
                          {applicable.includes("timerFontSize") &&
                            resolved.showTimer && (
                              <>
                                <Input
                                  className="w-24"
                                  type="number"
                                  label="Timer size"
                                  aria-label={`Timer size for ${output.name}`}
                                  value={resolved.timerFontSize}
                                  onChange={(value) =>
                                    applyAndPersistDebounced(
                                      setDisplayOutputSettings({
                                        id: output.id,
                                        settings: {
                                          timerFontSize: Number(value),
                                        },
                                      }),
                                      SETTING_SAVE_ERROR,
                                    )
                                  }
                                />
                              </>
                            )}
                          {applicable.includes("localVideoVolume") &&
                            resolved.localVideoAudioEnabled && (
                              <Input
                                className="w-24"
                                type="number"
                                min={0}
                                max={100}
                                label="Video volume"
                                aria-label={`Video volume for ${output.name}`}
                                value={resolved.localVideoVolume}
                                onChange={(value) =>
                                  applyAndPersistDebounced(
                                    setDisplayOutputSettings({
                                      id: output.id,
                                      settings: {
                                        localVideoVolume: Number(value),
                                      },
                                    }),
                                    SETTING_SAVE_ERROR,
                                  )
                                }
                              />
                            )}
                        </div>
                      );
                    })()}

                  <DisplayScreensSection
                    output={output}
                    screens={screensByOutputId[output.id] ?? []}
                    localScreen={getLocalScreen(output)}
                    // Only the built-in monitor has a pre-registry fallback.
                    legacyMonitorSettings={
                      output.id === "monitor" ? legacyMonitorSettings : undefined
                    }
                    churchId={churchId}
                    onError={showToast}
                    onChanged={refreshScreens}
                  />

                  <p className="mt-2 truncate text-xs text-gray-400">
                    {getScreenPath(output)}
                  </p>
                </SortableDisplayOutputRow>
              ))}
            </ul>
          </SortableContext>
        </DndContext>

        <div className="rounded-md border border-white/12 bg-black/20 p-3">
          <p className="text-sm font-semibold text-white">Add a display</p>
          <p className="mt-1 text-xs text-gray-300">
            Open the screen link on that machine to point it at the new display.
          </p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <Select
              className="w-40"
              label="Type"
              value={newType}
              options={TYPE_OPTIONS}
              onChange={(value) => setNewType(value as DisplayOutputType)}
            />
            <Input
              className="min-w-0 flex-1"
              label="Name"
              aria-label="New display name"
              value={newName}
              placeholder="Lobby"
              onChange={(value) => setNewName(String(value))}
            />
            <Button onClick={handleAdd}>Add</Button>
          </div>
        </div>
      </fieldset>
    </div>
  );
};

export default DisplayOutputsPanel;
