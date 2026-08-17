import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import {
  DisplaySettings,
  normalizeDisplaySettings,
} from "../utils/displaySettings";
import {
  DisplayOutput,
  DisplayOutputSource,
  DisplayOutputType,
  createDisplayOutputId,
  getDefaultDisplayOutputs,
  getUniqueDisplayOutputName,
  isBuiltInOutputId,
  normalizeDisplayOutputSource,
  normalizeDisplayOutputs,
  sanitizeDisplayOutputName,
} from "../utils/displayOutputs";

type DisplayOutputsState = {
  list: DisplayOutput[];
  /** False until the church registry has been read once (local edits stay local). */
  isLoaded: boolean;
};

const initialState: DisplayOutputsState = {
  list: getDefaultDisplayOutputs(),
  isLoaded: false,
};

const reindex = (list: DisplayOutput[]) =>
  list.map((output, index) =>
    output.order === index ? output : { ...output, order: index },
  );

const namesExcept = (list: DisplayOutput[], exceptId?: string) =>
  list.filter((output) => output.id !== exceptId).map((output) => output.name);

export const displayOutputsSlice = createSlice({
  name: "displayOutputs",
  initialState,
  reducers: {
    /**
     * Replace the registry from Firebase. `normalizeDisplayOutputs` guarantees
     * the built-ins survive a malformed payload, so a bad write upstream can
     * never strip a controller's route to the projector mid-service.
     */
    setDisplayOutputsFromRemote: (state, action: PayloadAction<unknown>) => {
      state.list = normalizeDisplayOutputs(action.payload);
      state.isLoaded = true;
    },
    addDisplayOutput: {
      reducer: (
        state,
        action: PayloadAction<{
          id: string;
          type: DisplayOutputType;
          name: string;
        }>,
      ) => {
        const { id, type } = action.payload;
        if (state.list.some((output) => output.id === id)) return;
        const name = getUniqueDisplayOutputName(
          sanitizeDisplayOutputName(action.payload.name, type),
          namesExcept(state.list),
        );
        state.list = reindex([
          ...state.list,
          { id, type, name, order: state.list.length, enabled: true },
        ]);
      },
      prepare: (payload: { type: DisplayOutputType; name?: string }) => ({
        payload: {
          id: createDisplayOutputId(),
          type: payload.type,
          name: payload.name ?? "",
        },
      }),
    },
    renameDisplayOutput: (
      state,
      action: PayloadAction<{ id: string; name: string }>,
    ) => {
      const output = state.list.find((o) => o.id === action.payload.id);
      if (!output) return;
      const name = getUniqueDisplayOutputName(
        sanitizeDisplayOutputName(action.payload.name, output.type),
        namesExcept(state.list, output.id),
      );
      if (name === output.name) return;
      output.name = name;
    },
    setDisplayOutputEnabled: (
      state,
      action: PayloadAction<{ id: string; enabled: boolean }>,
    ) => {
      const output = state.list.find((o) => o.id === action.payload.id);
      if (!output) return;
      output.enabled = action.payload.enabled;
    },
    /**
     * Bind a pull output to its content, e.g. which discussion board a board
     * screen shows. Ignored for push outputs, which are driven by presentation
     * state instead. Pass `null` to unbind.
     *
     * This is durable config, not the live board-on-monitor override — that
     * stays in `presentationSlice` so it syncs at live-gesture speed.
     */
    setDisplayOutputSource: (
      state,
      action: PayloadAction<{ id: string; source: DisplayOutputSource | null }>,
    ) => {
      const output = state.list.find((o) => o.id === action.payload.id);
      if (!output) return;
      const source = normalizeDisplayOutputSource(
        action.payload.source,
        output.type,
      );
      if (source) {
        output.source = source;
      } else {
        delete output.source;
      }
    },
    /**
     * Default settings for every screen showing this display. Fields the render
     * profile does not understand are dropped, so a stale value cannot leak
     * onto a surface that should ignore it.
     */
    setDisplayOutputSettings: (
      state,
      action: PayloadAction<{ id: string; settings: DisplaySettings | null }>,
    ) => {
      const output = state.list.find((o) => o.id === action.payload.id);
      if (!output) return;
      const merged = action.payload.settings
        ? { ...(output.settings ?? {}), ...action.payload.settings }
        : null;
      const settings = normalizeDisplaySettings(merged, output.type);
      if (settings) {
        output.settings = settings;
      } else {
        delete output.settings;
      }
    },
    /**
     * Seed a display's settings from the church-wide monitorSettings that
     * predate the registry.
     *
     * Backfills gaps rather than refusing outright. Configuring one field leaves
     * a partial settings object, and treating that as "already migrated" left
     * the rest of the church's settings unmigrated forever. Existing values
     * always win, so a display an operator has configured is never overwritten.
     */
    seedDisplayOutputSettings: (
      state,
      action: PayloadAction<{ id: string; settings: DisplaySettings }>,
    ) => {
      const output = state.list.find((o) => o.id === action.payload.id);
      if (!output) return;
      const settings = normalizeDisplaySettings(
        { ...action.payload.settings, ...(output.settings ?? {}) },
        output.type,
      );
      if (!settings) return;
      if (
        JSON.stringify(settings) === JSON.stringify(output.settings ?? null)
      ) {
        return;
      }
      output.settings = settings;
    },
    /**
     * Built-ins are retired with `setDisplayOutputEnabled`, not removed: each is
     * a product surface that already exists, and the push three additionally
     * have presentation state under legacy Firebase keys that older clients
     * still read directly.
     */
    removeDisplayOutput: (state, action: PayloadAction<string>) => {
      if (isBuiltInOutputId(action.payload)) return;
      const next = state.list.filter((output) => output.id !== action.payload);
      if (next.length === state.list.length) return;
      state.list = reindex(next);
    },
    /** Reorder by explicit id sequence; unlisted ids keep their relative order at the end. */
    reorderDisplayOutputs: (state, action: PayloadAction<string[]>) => {
      const rank = new Map(action.payload.map((id, index) => [id, index]));
      const sorted = [...state.list].sort((a, b) => {
        const rankA = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
        const rankB = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
        return rankA - rankB || a.order - b.order;
      });
      state.list = reindex(sorted);
    },
  },
});

/**
 * The registry, falling back to the built-ins when the slice is absent.
 *
 * A controller that renders before the registry slice is mounted (or in a test
 * store built from a subset of reducers) still shows the standard surfaces
 * rather than an empty output list.
 */
/** Stable fallback: a fresh array per call would re-render every subscriber. */
const FALLBACK_OUTPUTS: DisplayOutput[] = Object.freeze(
  getDefaultDisplayOutputs(),
) as DisplayOutput[];

export const selectDisplayOutputs = (state: {
  displayOutputs?: DisplayOutputsState;
}): DisplayOutput[] => state?.displayOutputs?.list ?? FALLBACK_OUTPUTS;

export const {
  setDisplayOutputsFromRemote,
  addDisplayOutput,
  renameDisplayOutput,
  setDisplayOutputEnabled,
  setDisplayOutputSource,
  setDisplayOutputSettings,
  seedDisplayOutputSettings,
  removeDisplayOutput,
  reorderDisplayOutputs,
} = displayOutputsSlice.actions;

export default displayOutputsSlice.reducer;
