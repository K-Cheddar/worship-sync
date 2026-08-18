import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import {
  ControllerProfile,
  createControllerProfileId,
  getDefaultControllerProfiles,
  getUniqueControllerProfileName,
  isBuiltInControllerId,
  normalizeControllerProfiles,
  sanitizeControllerProfileName,
} from "../utils/controllerProfiles";

type ControllerProfilesState = {
  list: ControllerProfile[];
  /** False until the church registry has been read once (local edits stay local). */
  isLoaded: boolean;
};

const initialState: ControllerProfilesState = {
  list: getDefaultControllerProfiles(),
  isLoaded: false,
};

const reindex = (list: ControllerProfile[]) =>
  list.map((profile, index) =>
    profile.order === index ? profile : { ...profile, order: index },
  );

const namesExcept = (list: ControllerProfile[], exceptId?: string) =>
  list.filter((p) => p.id !== exceptId).map((p) => p.name);

export const controllerProfilesSlice = createSlice({
  name: "controllerProfiles",
  initialState,
  reducers: {
    /**
     * Replace the registry from Firebase. `normalizeControllerProfiles`
     * guarantees the built-ins survive a malformed payload, so a bad write
     * upstream can never strip the presentation controller's displays.
     */
    setControllerProfilesFromRemote: (state, action: PayloadAction<unknown>) => {
      state.list = normalizeControllerProfiles(action.payload);
      state.isLoaded = true;
    },
    addControllerProfile: {
      reducer: (
        state,
        action: PayloadAction<{
          id: string;
          name: string;
          outputIds: string[];
        }>,
      ) => {
        const { id, outputIds } = action.payload;
        if (state.list.some((profile) => profile.id === id)) return;
        const name = getUniqueControllerProfileName(
          sanitizeControllerProfileName(action.payload.name),
          namesExcept(state.list),
        );
        state.list = reindex([
          ...state.list,
          {
            id,
            type: "aux-presentation",
            name,
            order: state.list.length,
            enabled: true,
            outputIds,
            // A brand-new controller drives nothing until an operator picks its
            // screens. Inheriting "every display" would put it on air the moment
            // it is created.
            outputsConfigured: true,
            defaultSendOutputIds: [],
            // Its own scope, so its outlines never appear in another
            // controller's picker.
            outlineScope: id,
          },
        ]);
      },
      prepare: (payload: { name?: string; outputIds?: string[] }) => ({
        payload: {
          id: createControllerProfileId(),
          name: payload.name ?? "",
          outputIds: payload.outputIds ?? [],
        },
      }),
    },
    renameControllerProfile: (
      state,
      action: PayloadAction<{ id: string; name: string }>,
    ) => {
      const profile = state.list.find((p) => p.id === action.payload.id);
      if (!profile) return;
      const name = getUniqueControllerProfileName(
        sanitizeControllerProfileName(action.payload.name),
        namesExcept(state.list, profile.id),
      );
      if (name === profile.name) return;
      profile.name = name;
    },
    setControllerProfileEnabled: (
      state,
      action: PayloadAction<{ id: string; enabled: boolean }>,
    ) => {
      const profile = state.list.find((p) => p.id === action.payload.id);
      if (!profile) return;
      profile.enabled = action.payload.enabled;
    },
    /**
     * Replace the displays this controller may drive.
     *
     * Also drops any default that is no longer owned: a default pointing at a
     * display the controller cannot reach would silently send new items
     * nowhere, which reads to an operator as a broken item rather than stale
     * configuration.
     */
    setControllerProfileOutputs: (
      state,
      action: PayloadAction<{ id: string; outputIds: string[] }>,
    ) => {
      const profile = state.list.find((p) => p.id === action.payload.id);
      if (!profile) return;
      const outputIds = Array.from(new Set(action.payload.outputIds));
      profile.outputIds = outputIds;
      // Any deliberate edit settles the ambiguity in an empty list: from here on
      // it means "drives nothing", not "never configured".
      profile.outputsConfigured = true;
      profile.defaultSendOutputIds = profile.defaultSendOutputIds.filter((id) =>
        outputIds.includes(id),
      );
    },
    /** Displays new items on this controller target by default. */
    setControllerProfileDefaultSends: (
      state,
      action: PayloadAction<{ id: string; outputIds: string[] }>,
    ) => {
      const profile = state.list.find((p) => p.id === action.payload.id);
      if (!profile) return;
      // Only displays this controller actually owns; anything else could never
      // receive the send and would misrepresent what the toggle does.
      profile.defaultSendOutputIds = Array.from(
        new Set(action.payload.outputIds),
      ).filter((id) => profile.outputIds.includes(id));
    },
    /**
     * Built-ins are retired with `setControllerProfileEnabled`, not removed:
     * each is a route that already exists, and the presentation profile is the
     * fallback every unscoped outline resolves against.
     */
    removeControllerProfile: (state, action: PayloadAction<string>) => {
      if (isBuiltInControllerId(action.payload)) return;
      const next = state.list.filter(
        (profile) => profile.id !== action.payload,
      );
      if (next.length === state.list.length) return;
      state.list = reindex(next);
    },
    reorderControllerProfiles: (state, action: PayloadAction<string[]>) => {
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

/** Stable fallback: a fresh array per call would re-render every subscriber. */
const FALLBACK_PROFILES: ControllerProfile[] = Object.freeze(
  getDefaultControllerProfiles(),
) as ControllerProfile[];

/**
 * The registry, falling back to the built-ins when the slice is absent — a
 * surface that renders before the slice is mounted (or a test store built from
 * a subset of reducers) still resolves targeting the way it always did.
 */
export const selectControllerProfiles = (state: {
  controllerProfiles?: ControllerProfilesState;
}): ControllerProfile[] => state?.controllerProfiles?.list ?? FALLBACK_PROFILES;

export const selectControllerProfilesLoaded = (state: {
  controllerProfiles?: ControllerProfilesState;
}): boolean => state?.controllerProfiles?.isLoaded ?? false;

export const {
  setControllerProfilesFromRemote,
  addControllerProfile,
  renameControllerProfile,
  setControllerProfileEnabled,
  setControllerProfileOutputs,
  setControllerProfileDefaultSends,
  removeControllerProfile,
  reorderControllerProfiles,
} = controllerProfilesSlice.actions;

export default controllerProfilesSlice.reducer;
