import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import type { Draft } from "immer";
import isEqual from "lodash/isEqual";
import type { DBHeading, DBItem } from "../types";
import type { SongLibraryDiagnostic } from "../utils/songLibraryDiscovery";
import {
  attachCloudCopyToLocalImageItem,
  updateLocalImageReferenceInItem,
  type LocalImageReferencePatch,
} from "../utils/localImageAssets";
import { normalizeSongForLibrary } from "../utils/activeItemSlides";

const normalizeLibrarySong = (song: DBItem): DBItem => normalizeSongForLibrary(
  song.docType === "song-v2-root"
    ? { ...song, slides: [], arrangements: (song.arrangements ?? []).map((arrangement) => ({ ...arrangement, slides: [] })) }
    : song,
);

/** Legacy items may lack docType; explicit non-item discriminators win. */
export const isItemDocument = (value: unknown): value is DBItem | DBHeading => {
  if (!value || typeof value !== "object") return false;
  const doc = value as Record<string, unknown>;
  const isLibraryProjection = doc.docType === "song-v2-root" && doc.type === "song";
  return typeof doc._id === "string" && typeof doc.name === "string" && !doc._id.startsWith("_") && !doc._deleted &&
    (doc.docType === undefined || doc.docType === "item" || doc.docType === "heading" || isLibraryProjection) &&
    ["song", "free", "timer", "bible", "heading", "service-time"].includes(String(doc.type));
};

function getDocsKey(type: string): "allSongDocs" | "allFreeFormDocs" | "allTimerDocs" | "allBibleDocs" | "allServiceTimeDocs" | null {
  if (type === "service-time") return "allServiceTimeDocs";
  if (type === "song") return "allSongDocs";
  if (type === "free") return "allFreeFormDocs";
  if (type === "timer") return "allTimerDocs";
  if (type === "bible") return "allBibleDocs";
  return null;
}

let nextCacheSession = 0;

type AllDocsState = {
  session: number;
  changeVersion: number;
  /** Targeted v2 child-content invalidation, separate from library projection changes. */
  songContentVersions: Record<string, number>;
  /** Logical songs whose V2 root has activated authoritative V2 storage. */
  activatedSongIds: Record<string, true>;
  songLibraryDiagnostics: SongLibraryDiagnostic[];
  allSongDocs: DBItem[];
  allFreeFormDocs: DBItem[];
  allTimerDocs: DBItem[];
  allBibleDocs: DBItem[];
  allServiceTimeDocs: DBItem[];
  allHeadingDocs: DBHeading[];
  isInitialized: boolean;
  error: string | null;
};

type ItemCacheHydration = Array<DBItem | DBHeading> | {
  documents: Array<DBItem | DBHeading>;
  activatedSongIds: string[];
  songLibraryDiagnostics: SongLibraryDiagnostic[];
};

type ItemDocumentChange = {
  id: string;
  doc?: DBItem | DBHeading;
  deleted?: boolean;
};

type ItemCacheKey = (typeof itemKeys)[number] | "allHeadingDocs";

const getDocumentCacheKey = (doc: DBItem | DBHeading): ItemCacheKey | null =>
  doc.type === "heading" ? "allHeadingDocs" : getDocsKey(doc.type);

const applyItemDocumentChangesToState = (
  state: Draft<AllDocsState>,
  changes: readonly ItemDocumentChange[],
) => {
  const documentsById = new Map<string, { key: ItemCacheKey; doc: DBItem | DBHeading }>();
  for (const key of itemKeys) {
    for (const doc of state[key]) documentsById.set(doc._id, { key, doc });
  }
  for (const doc of state.allHeadingDocs) {
    documentsById.set(doc._id, { key: "allHeadingDocs", doc });
  }

  const changedKeys = new Set<ItemCacheKey>();
  const changedDocumentIds = new Set<string>();
  let appliedDocumentChanges = 0;
  const clearAllDiagnosticsFor = new Set<string>();
  const clearReadFailureFor = new Set<string>();
  const incompleteSongIds = new Set(state.songLibraryDiagnostics
    .filter((diagnostic) => diagnostic.code === "incomplete-v2")
    .map((diagnostic) => diagnostic.songId));

  for (const { id, doc: inputDoc, deleted } of changes) {
    const existing = documentsById.get(id);
    if (deleted) {
      if (!existing) continue;
      documentsById.delete(id);
      changedKeys.add(existing.key);
      changedDocumentIds.add(id);
      appliedDocumentChanges += 1;
      continue;
    }
    if (!isItemDocument(inputDoc)) continue;

    const document = inputDoc;
    const nextKey = getDocumentCacheKey(document);
    if (!nextKey) continue;
    if (document.type === "song" && document.docType !== "song-v2-root" &&
      (state.activatedSongIds[id] || existing?.doc.docType === "song-v2-root" || incompleteSongIds.has(id))) {
      continue;
    }

    if (document.type === "song" && document.docType !== "song-v2-root") {
      clearReadFailureFor.add(id);
    }
    if (document.type === "song" && document.docType === "song-v2-root") {
      clearAllDiagnosticsFor.add(id);
      incompleteSongIds.delete(id);
    }

    if (existing && existing.key === nextKey && document._rev && existing.doc._rev === document._rev) {
      continue;
    }
    const normalized = document.type === "song" ? normalizeLibrarySong(document as DBItem) : document;
    if (existing && existing.key === nextKey && (
      (document._rev && existing.doc._rev === document._rev) || isEqual(existing.doc, normalized)
    )) continue;

    if (existing && existing.key !== nextKey) {
      documentsById.delete(id);
      changedKeys.add(existing.key);
    }
    documentsById.set(id, { key: nextKey, doc: normalized });
    changedKeys.add(nextKey);
    changedDocumentIds.add(id);
    appliedDocumentChanges += 1;
  }

  let diagnosticsChanged = false;
  if (clearAllDiagnosticsFor.size || clearReadFailureFor.size) {
    const removedDiagnosticSongIds = new Set(state.songLibraryDiagnostics
      .filter((diagnostic) =>
        clearAllDiagnosticsFor.has(diagnostic.songId) ||
        (clearReadFailureFor.has(diagnostic.songId) && diagnostic.code === "read-failed"),
      )
      .map((diagnostic) => diagnostic.songId));
    const nextDiagnostics = state.songLibraryDiagnostics.filter((diagnostic) =>
      !clearAllDiagnosticsFor.has(diagnostic.songId) &&
      !(clearReadFailureFor.has(diagnostic.songId) && diagnostic.code === "read-failed"),
    );
    diagnosticsChanged = nextDiagnostics.length !== state.songLibraryDiagnostics.length;
    for (const songId of removedDiagnosticSongIds) {
      if (!changedDocumentIds.has(songId)) appliedDocumentChanges += 1;
    }
    if (diagnosticsChanged) state.songLibraryDiagnostics = nextDiagnostics;
  }

  const nextDocumentsByKey = new Map<ItemCacheKey, Array<DBItem | DBHeading>>();
  for (const key of changedKeys) nextDocumentsByKey.set(key, []);
  for (const entry of documentsById.values()) {
    nextDocumentsByKey.get(entry.key)?.push(entry.doc);
  }
  for (const [key, documents] of nextDocumentsByKey) {
    state[key] = documents as never;
  }
  if (appliedDocumentChanges > 0) state.changeVersion += appliedDocumentChanges;
};

const activateSongV2RootsInState = (state: Draft<AllDocsState>, songIds: readonly string[]) => {
  if (songIds.length === 0) return;
  const ids = new Set(songIds);
  let changed = false;
  for (const songId of ids) {
    const previous = state.allSongDocs.find((item) => item._id === songId);
    if (!state.activatedSongIds[songId] || (previous && previous.docType !== "song-v2-root")) changed = true;
    state.activatedSongIds[songId] = true;
  }
  const nextSongs = state.allSongDocs.filter((item) => !ids.has(item._id) || item.docType === "song-v2-root");
  if (nextSongs.length !== state.allSongDocs.length) {
    state.allSongDocs = nextSongs;
    changed = true;
  }
  const nextDiagnostics = state.songLibraryDiagnostics.filter((diagnostic) => !ids.has(diagnostic.songId));
  if (nextDiagnostics.length !== state.songLibraryDiagnostics.length) {
    state.songLibraryDiagnostics = nextDiagnostics;
    changed = true;
  }
  if (changed) state.changeVersion += 1;
};

const invalidateSongContentsInState = (state: Draft<AllDocsState>, songIds: readonly string[]) => {
  for (const songId of songIds) {
    state.songContentVersions[songId] = (state.songContentVersions[songId] ?? 0) + 1;
  }
};

const initialState: AllDocsState = {
  session: 0,
  changeVersion: 0,
  songContentVersions: {},
  activatedSongIds: {},
  songLibraryDiagnostics: [],
  allSongDocs: [],
  allFreeFormDocs: [],
  allTimerDocs: [],
  allBibleDocs: [],
  allServiceTimeDocs: [],
  allHeadingDocs: [],
  isInitialized: false,
  error: null,
};

const itemKeys = ["allSongDocs", "allFreeFormDocs", "allTimerDocs", "allBibleDocs", "allServiceTimeDocs"] as const;
const localImageKeys = ["allSongDocs", "allFreeFormDocs", "allTimerDocs", "allBibleDocs"] as const;
const hasIncompleteSongV2 = (state: AllDocsState, songId: string) =>
  state.songLibraryDiagnostics.some(diagnostic => diagnostic.songId === songId && diagnostic.code === "incomplete-v2");

export const allDocsSlice = createSlice({
  name: "allDocs",
  initialState: () => ({ ...initialState, session: ++nextCacheSession }),
  reducers: {
    activateSongV2Root: (state, action: PayloadAction<string>) => {
      activateSongV2RootsInState(state, [action.payload]);
    },
    activateSongV2Roots: (state, action: PayloadAction<string[]>) => {
      activateSongV2RootsInState(state, action.payload);
    },
    applySongLibraryRefresh: (state, action: PayloadAction<{
      songId: string;
      authority?: "legacy" | "v2" | "unknown";
      projection?: DBItem;
      diagnostic?: SongLibraryDiagnostic;
      preserveProjection?: boolean;
    }>) => {
      const { songId, projection, diagnostic, preserveProjection } = action.payload;
      const authority = action.payload.authority ?? "v2";
      const wasActivated = Boolean(state.activatedSongIds[songId]);
      if (authority === "v2") state.activatedSongIds[songId] = true;
      else if (authority === "legacy") delete state.activatedSongIds[songId];
      const previous = state.allSongDocs.find(item => item._id === songId);
      const next = projection
        ? normalizeLibrarySong(projection)
        : (preserveProjection || authority === "unknown") &&
            (authority === "unknown" || previous?.docType === "song-v2-root")
          ? previous
          : undefined;
      const nextDiagnostics = state.songLibraryDiagnostics.filter(item => item.songId !== songId);
      if (diagnostic) nextDiagnostics.push(diagnostic);
      const diagnosticsChanged = !isEqual(state.songLibraryDiagnostics, nextDiagnostics);
      const projectionChanged = !isEqual(previous, next);
      const activationChanged = authority !== "unknown" && wasActivated !== (authority === "v2");
      if (!projectionChanged && !diagnosticsChanged && !activationChanged) return;
      state.allSongDocs = state.allSongDocs.filter(item => item._id !== songId);
      if (next) state.allSongDocs.push(next);
      state.songLibraryDiagnostics = nextDiagnostics;
      state.changeVersion += 1;
    },
    replaceSongLibrarySnapshot: (state, action: PayloadAction<{
      songs: DBItem[];
      activatedSongIds: string[];
      diagnostics: SongLibraryDiagnostic[];
    }>) => {
      const { songs, activatedSongIds, diagnostics } = action.payload;
      const nextActivated = Object.fromEntries(activatedSongIds.map(songId => [songId, true])) as Record<string, true>;
      const nextSongs = songs.map(normalizeLibrarySong);
      const changed = !isEqual(state.allSongDocs, nextSongs) ||
        !isEqual(state.activatedSongIds, nextActivated) ||
        !isEqual(state.songLibraryDiagnostics, diagnostics);
      state.allSongDocs = nextSongs;
      state.activatedSongIds = nextActivated;
      state.songLibraryDiagnostics = diagnostics;
      if (changed) state.changeVersion += 1;
    },
    invalidateSongContent: (state, action: PayloadAction<string>) => {
      invalidateSongContentsInState(state, [action.payload]);
    },
    invalidateSongContents: (state, action: PayloadAction<string[]>) => {
      invalidateSongContentsInState(state, action.payload);
    },
    updateAllSongDocs: (state, action: PayloadAction<DBItem[]>) => {
      state.allSongDocs = action.payload
        .filter(song => song.docType === "song-v2-root" || !state.activatedSongIds[song._id])
        .map(normalizeLibrarySong);
    },
    updateAllFreeFormDocs: (state, action: PayloadAction<DBItem[]>) => {
      state.allFreeFormDocs = action.payload;
    },
    updateAllTimerDocs: (state, action: PayloadAction<DBItem[]>) => {
      state.allTimerDocs = action.payload;
    },
    updateAllBibleDocs: (state, action: PayloadAction<DBItem[]>) => {
      state.allBibleDocs = action.payload;
    },
    upsertItemInAllDocs: (state, action: PayloadAction<DBItem>) => {
      const doc = action.payload.type === "song" ? normalizeLibrarySong(action.payload) : action.payload;
      const key = getDocsKey(doc.type);
      if (!key) return;
      const arr = state[key];
      const idx = arr.findIndex((candidate) => candidate._id === doc._id);
      if (doc.type === "song" && doc.docType !== "song-v2-root" &&
        (state.activatedSongIds[doc._id] || arr[idx]?.docType === "song-v2-root" || hasIncompleteSongV2(state, doc._id))) return;
      if (doc.type === "song" && doc.docType !== "song-v2-root") {
        state.songLibraryDiagnostics = state.songLibraryDiagnostics.filter(item => item.songId !== doc._id || item.code !== "read-failed");
      }
      if (idx >= 0) arr[idx] = doc;
      else arr.push(doc);
    },
    upsertItemsInAllDocs: (state, action: PayloadAction<DBItem[]>) => {
      for (const inputDoc of action.payload) {
        const doc = inputDoc.type === "song" ? normalizeLibrarySong(inputDoc) : inputDoc;
        const key = getDocsKey(doc.type);
        if (!key) continue;
        const arr = state[key];
        const idx = arr.findIndex((candidate) => candidate._id === doc._id);
        if (doc.type === "song" && doc.docType !== "song-v2-root" &&
          (state.activatedSongIds[doc._id] || arr[idx]?.docType === "song-v2-root" || hasIncompleteSongV2(state, doc._id))) continue;
        if (doc.type === "song" && doc.docType !== "song-v2-root") {
          state.songLibraryDiagnostics = state.songLibraryDiagnostics.filter(item => item.songId !== doc._id || item.code !== "read-failed");
        }
        if (idx >= 0) arr[idx] = doc;
        else arr.push(doc);
      }
    },
    removeItemFromAllDocs: (state, action: PayloadAction<{ _id: string; type: string }>) => {
      const key = getDocsKey(action.payload.type);
      if (!key) return;
      state[key] = state[key].filter((doc) => doc._id !== action.payload._id);
      delete state.songContentVersions[action.payload._id];
    },
    attachCloudCopyToLocalImageInAllDocs: (state, action: PayloadAction<{
      itemId: string;
      assetId: string;
      mediaId: string;
      url: string;
    }>) => {
      for (const key of localImageKeys) {
        const index = state[key].findIndex((item) => item._id === action.payload.itemId);
        if (index < 0) continue;
        state[key][index] = attachCloudCopyToLocalImageItem(
          state[key][index], action.payload.assetId,
          { mediaId: action.payload.mediaId, url: action.payload.url },
        );
        return;
      }
    },
    updateLocalImageReferenceInAllDocs: (state, action: PayloadAction<{
      itemId: string;
      assetId: string;
      patch: LocalImageReferencePatch;
    }>) => {
      for (const key of localImageKeys) {
        const index = state[key].findIndex((item) => item._id === action.payload.itemId);
        if (index < 0) continue;
        state[key][index] = updateLocalImageReferenceInItem(
          state[key][index], action.payload.assetId, action.payload.patch,
        );
        return;
      }
    },
    resetItemCache: (state) => ({ ...initialState, session: state.session }),
    hydrateItemCache: (state, action: PayloadAction<ItemCacheHydration>) => {
      const documents = Array.isArray(action.payload) ? action.payload : action.payload.documents;
      state.allSongDocs = [];
      state.allFreeFormDocs = [];
      state.allTimerDocs = [];
      state.allBibleDocs = [];
      state.allServiceTimeDocs = [];
      state.allHeadingDocs = [];
      for (const inputDoc of documents) {
        if (inputDoc.type === "heading") state.allHeadingDocs.push(inputDoc as DBHeading);
        else {
          const doc = inputDoc.type === "song" ? normalizeLibrarySong(inputDoc as DBItem) : inputDoc as DBItem;
          const key = getDocsKey(doc.type);
          if (key) state[key].push(doc);
        }
      }
      if (!Array.isArray(action.payload)) {
        state.activatedSongIds = Object.fromEntries(action.payload.activatedSongIds.map(songId => [songId, true])) as Record<string, true>;
        state.songLibraryDiagnostics = action.payload.songLibraryDiagnostics;
      }
      state.isInitialized = true;
      state.error = null;
    },
    applyItemDocumentChange: (state, action: PayloadAction<{
      id: string;
      doc?: DBItem | DBHeading;
      deleted?: boolean;
    }>) => applyItemDocumentChangesToState(state, [action.payload]),
    applyItemDocumentChanges: (state, action: PayloadAction<ItemDocumentChange[]>) => {
      applyItemDocumentChangesToState(state, action.payload);
    },
    setItemCacheError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
    },
  },
});

export const {
  activateSongV2Root,
  activateSongV2Roots,
  applySongLibraryRefresh,
  replaceSongLibrarySnapshot,
  invalidateSongContent,
  invalidateSongContents,
  updateAllSongDocs,
  updateAllFreeFormDocs,
  updateAllTimerDocs,
  updateAllBibleDocs,
  upsertItemInAllDocs,
  upsertItemsInAllDocs,
  removeItemFromAllDocs,
  attachCloudCopyToLocalImageInAllDocs,
  updateLocalImageReferenceInAllDocs,
  resetItemCache,
  hydrateItemCache,
  applyItemDocumentChange,
  applyItemDocumentChanges,
  setItemCacheError,
} = allDocsSlice.actions;

export default allDocsSlice.reducer;
