import {
  Action,
  combineReducers,
  configureStore,
  createAction,
  createListenerMiddleware,
  isAnyOf,
  Reducer,
  Middleware,
} from "@reduxjs/toolkit";
import undoable, { ActionCreators, newHistory } from "redux-undo";
import {
  presentationSlice,
  setStreamItemContentBlockedFromRemote,
  setMonitorBoardAliasIdFromRemote,
  setProjectorBoardAliasIdFromRemote,
  toLegacyPresentationShape,
  omitOverlayLanes,
  STREAM_OVERLAY_LANES,
  updateBibleDisplayInfoFromRemote,
  updateMonitor,
  updateMonitorFromRemote,
  updateParticipantOverlayInfoFromRemote,
  applyRemoteVideoPlayback,
  updateProjectorFromRemote,
  updateQrCodeOverlayInfoFromRemote,
  updateImageOverlayInfoFromRemote,
  updateStbOverlayInfoFromRemote,
  updateStreamFromRemote,
  updateFormattedTextDisplayInfoFromRemote,
  updateBoardPostStreamInfoFromRemote,
  updateOutputsFromRemote,
  type RemoteOutputState,
} from "./presentationSlice";
import {
  getItemPersistenceChanges,
  getItemPersistenceConflicts,
  itemDocMatchesEditorState,
  itemSlice,
} from "./itemSlice";
import {
  getActiveItemSlides,
  normalizeItemSlides,
} from "../utils/activeItemSlides";
import {
  loadItemWithSongHydration,
  loadSongV2Snapshot,
  loadSongV2LibraryProjection,
  getSongV2RootDocId,
  saveSong,
  serializeSongToV2Documents,
  songToLibraryProjection,
} from "../utils/songPersistence";
import { overlaysSlice } from "./overlaysSlice";
import { bibleSlice } from "./bibleSlice";
import { isMonitorShowingTimerCountdownSlide } from "../utils/monitorTimerPresentation";
import { itemListSlice } from "./itemListSlice";
import { itemLibraryUiSlice } from "./itemLibraryUiSlice";
import { createItemSlice } from "./createItemSlice";
import { preferencesSlice } from "./preferencesSlice";
import { itemListsSlice } from "./itemListsSlice";
import { activateOutlineContent, getOutlineContentLifecycleLease, getOutlineDatabaseKey, getOutlineOwnerKey, hasPendingOutlineDraftsForDatabase, isOutlineContentLifecycleLeaseCurrent, setOutlineContentDatabase } from "./outlineContent";
import { isMediaLoadSettled, mediaItemsSlice } from "./mediaSlice";
import mediaCacheMapReducer, { setMediaCacheMap } from "./mediaCacheMapSlice";
import { overlaySlice } from "./overlaySlice";
import {
  globalDb as db,
  globalBroadcastRef,
} from "../context/controllerInfo";
import { globalFireDbInfo, globalHostId } from "../context/globalInfo";
import { ref, set, get, runTransaction, update } from "firebase/database";
import {
  BibleDisplayInfo,
  BoardPostStreamInfo,
  DBCredit,
  DBCredits,
  DBItem,
  DBItemLists,
  DBOverlay,
  DBOverlayTemplates,
  DBPreferences,
  DBQuickLinksDoc,
  DBMonitorSettingsDoc,
  MONITOR_SETTINGS_POUCH_ID,
  PREFERENCES_POUCH_ID,
  QUICK_LINKS_POUCH_ID,
  DBServices,
  FormattedTextDisplayInfo,
  ItemState,
  getCreditsDocId,
  getControllerMediaRouteFoldersDocId,
  OverlayInfo,
  Presentation,
  ServiceTime,
  TimerInfo,
} from "../types";
import { allDocsSlice } from "./allDocsSlice";
import { selectSongLibrary } from "./songLibrarySelectors";
import { creditsSlice } from "./creditsSlice";
import {
  timersSlice,
  reconcileTimersFromDocs,
  syncTimers,
  updateTimerFromRemote,
} from "./timersSlice";
import { overlayTemplatesSlice } from "./overlayTemplatesSlice";
import {
  autosaveIndicatorSlice,
  AUTOSAVE_DEBOUNCE_KEYS,
} from "./autosaveIndicatorSlice";
import serviceTimesSliceReducer, {
  serviceTimesSlice,
  syncServicesFromRemote,
} from "./serviceTimesSlice";
import {
  servicePlanningImportSlice,
  refreshPreviewSongMatches,
} from "./servicePlanningImportSlice";
import { generatedCreditsSlice } from "./generatedCreditsSlice";
import { displayOutputsSlice } from "./displayOutputsSlice";
import { controllerProfilesSlice } from "./controllerProfilesSlice";
import { mergeTimers } from "../utils/timerUtils";
import { extractMediaUrlsFromBackgrounds } from "../utils/mediaCacheUtils";
import { persistMediaStateChanges } from "../utils/mediaDocUtils";
import { normalizeOverlayForSync } from "../utils/overlayUtils";
import { persistExistingOverlayDoc } from "../utils/persistOverlayDoc";
import {
  cancelBibleItemCleanupRetry,
  deleteUnusedBibleItems,
  scheduleBibleItemCleanupRetry,
} from "../utils/bibleItemCleanup";
import {
  getContentDatabaseSessionToken,
  hasSuccessfulInitialContentReplication,
  isBibleDocumentActivityIdle,
  isContentReplicationIdle,
  subscribeToContentActivity,
} from "../utils/contentReplicationActivity";
import {
  deleteSongV2AutosaveRecovery,
  createSongV2AutosaveRecoveryId,
  listSongV2AutosaveRecoveries,
  markSongV2AutosaveRecoveryDiscarded,
  markSongV2AutosaveRecoveryNeedsReview,
  putSongV2AutosaveRecovery,
  withSongV2AutosaveLock,
} from "../utils/songV2AutosaveRecovery";
import {
  getControllerPresenceScope,
  isOnlyActiveController,
  subscribeToActiveControllerPresence,
} from "../utils/activeControllerPresence";
import {
  persistServiceListItems,
  persistServiceListOverlays,
  resolveServiceListRevisionConflict,
  ServiceListConflictError,
} from "../utils/persistServiceListField";
import { ItemListsRegistryQueue } from "../utils/itemListsRegistryQueue";
import _ from "lodash";
import { getChurchDataPath } from "../utils/firebasePaths";
import {
  isBuiltInOutputId,
  supportsBoardTakeover,
} from "../utils/displayOutputs";
import { nestSlashPathOutputs } from "../utils/nestSlashPathOutputs";
import {
  ensureCreditsIndexDoc,
  getCreditsByIds,
  migrateLegacyCreditsToActiveOutlineIfNeeded,
} from "../utils/dbUtils";
import { applyPouchAudit } from "@/utils/pouchAudit";
import {
  loadReconciledSongV2Snapshot, pruneResolvedSongV2Conflicts, SongV2ReplicationConflictError,
} from "../utils/songV2ReplicationConflicts";
import {
  sameSongV2AuthoredContent,
  SongV2MutationNotAuthorizedError,
} from "../utils/songV2Writer";
import {
  isFirebasePermissionDenied,
  logFirebaseOperationFailure,
} from "../utils/firebaseListeners";
import { notifyPresentationSyncError } from "../utils/presentationSyncErrorBus";
import { serverDate } from "../utils/serverTime";
import { sortServicesByScheduleOrder } from "../utils/serviceTimes";
import type { ItemContentOwner } from "../types";
import {
  flushPendingItemMutations,
  getActiveContentDatabaseOwner,
  getContentDatabaseForOwner,
  getItemMutationOwner,
  registerContentDatabaseActivationHandler,
  registerContentDatabaseFlushHandler,
  sameItemMutationOwner,
} from "./deferredItemMutations";
import { patchControllerMediaRouteFolder } from "../utils/controllerMediaRouteFolders";

/**
 * Store wipes that drop presentation/session slices.
 *
 * - `RESET` — full clear (logout, sign-in, guest exit).
 * - `RESET_CONTROLLER_SESSION` — leave a controller page; keeps church
 *   registries (`controllerProfiles`, `displayOutputs`) so Home and sync
 *   surfaces do not flash built-in names while Firebase re-hydrates.
 */
export const isStoreResetAction = (action: { type: string }) =>
  action.type === "RESET" || action.type === "RESET_CONTROLLER_SESSION";

// Helper function to safely post messages to the broadcast channel
const safePostMessage = (message: any) => {
  if (globalBroadcastRef) {
    globalBroadcastRef.postMessage(message);
  }
};

const createSongV2MutationGuard = (
  database: PouchDB.Database,
  contentOwner: ItemContentOwner | null | undefined,
  churchId: string | undefined,
  sessionToken: symbol | null,
  operationIsCurrent: () => boolean,
  operationIsNotExplicitlyDiscarded: () => boolean = () => true,
) => {
  let hasCommittedWrite = false;
  return Object.assign(
    () => {
      if (
        globalFireDbInfo.canWriteSongContent !== true ||
        globalFireDbInfo.churchId !== churchId ||
        getContentDatabaseSessionToken(database.name) !== sessionToken
      ) return false;

      const currentOwner = getActiveContentDatabaseOwner();
      const ownerIsCurrent = !contentOwner || contentOwner.scopeId === "unscoped"
        ? !currentOwner
        : currentOwner?.scopeId === contentOwner.scopeId &&
          currentOwner.databaseKey === contentOwner.databaseKey &&
          currentOwner.churchId === contentOwner.churchId &&
          getContentDatabaseForOwner(contentOwner) === database;
      // Supersession can stop a stale operation before it mutates. Once a
      // physical write commits, finish the captured write plan while retaining
      // authorization and database ownership checks at every boundary.
      return ownerIsCurrent && (hasCommittedWrite || (
        operationIsCurrent() && operationIsNotExplicitlyDiscarded()
      ));
    },
    { onWriteCommitted: () => { hasCommittedWrite = true; } },
  );
};

const isSongV2MutationNotAuthorizedError = (
  error: unknown,
): error is SongV2MutationNotAuthorizedError =>
  error instanceof SongV2MutationNotAuthorizedError ||
  (typeof error === "object" && error !== null &&
    "name" in error && error.name === "SongV2MutationNotAuthorizedError");

/** Broadcast credit doc(s) to other tabs. Components that persist credits directly call this after db.put. */
export function broadcastCreditsUpdate(docs: (DBCredits | DBCredit)[]) {
  safePostMessage({ type: "update", data: { docs, hostId: globalHostId } });
}

export function broadcastItemUpdate(doc: DBItem) {
  const payload = doc.docType === "song-v2-root" ? songToLibraryProjection(doc) : doc;
  safePostMessage({
    type: "update",
    data: { docs: payload, hostId: globalHostId },
  });
}


const cleanObject = (obj: Object) =>
  JSON.parse(JSON.stringify(obj, (_, val) => (val === undefined ? null : val)));

const writePendingTimersToStorageAndFirebase = async (
  state: RootState,
  scope: { db: typeof globalFireDbInfo.db; churchId: string | undefined; canWriteTimers: boolean },
): Promise<boolean> => {
  const { timers, shouldUpdateTimers } = state.timers;
  if (!shouldUpdateTimers) return false;

  const ownTimers = timers.filter((timer) => timer.hostId === globalHostId);

  if (ownTimers.length > 0) {
    localStorage.setItem("timerInfo", JSON.stringify(ownTimers));
  } else {
    localStorage.removeItem("timerInfo");
  }

  if (!scope.db || !scope.churchId) {
    return false;
  }

  if (!scope.canWriteTimers) {
    return true;
  }

  const timersRef = ref(
    scope.db,
    getChurchDataPath(scope.churchId, "timers"),
  );

  try {
    const snapshot = await get(timersRef);
    const currentTimers = Array.isArray(snapshot.val()) ? snapshot.val() : [];
    const mergedTimers = mergeTimers(currentTimers, ownTimers, globalHostId);

    await Promise.resolve(set(timersRef, cleanObject(mergedTimers)));
  } catch (error) {
    logFirebaseOperationFailure("timer_sync", timersRef.toString(), error, {
      churchId: scope.churchId,
      permissionDenied: isFirebasePermissionDenied(error),
    });
    throw error;
  }
  return true;
};

const isListenerCancelledTaskError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { code?: string }).code === "listener-cancelled";

const sanitizeTransientItemState = (
  item: RootState["undoable"]["present"]["item"],
) => {
  const {
    selectedSlide: _selectedSlide,
    selectedBox: _selectedBox,
    backgroundTargetSlideIds: _backgroundTargetSlideIds,
    backgroundTargetRangeAnchorId: _backgroundTargetRangeAnchorId,
    mobileBackgroundTargetSelectMode: _mobileBackgroundTargetSelectMode,
    ...rest
  } = item;

  return {
    ...rest,
    isLoading: false,
    isSectionLoading: false,
    isItemFormatting: false,
    hasPendingUpdate: false,
    restoreFocusToBox: null,
  };
};

const sameItemMutationScope = (
  expected: Pick<ItemState, "_id" | "type" | "contentOwner">,
  current: Pick<ItemState, "_id" | "type" | "contentOwner">,
) => {
  if (!expected._id || expected._id !== current._id || expected.type !== current.type) return false;
  const expectedOwner = getItemMutationOwner(expected);
  const currentOwner = getItemMutationOwner(current);
  return expectedOwner
    ? sameItemMutationOwner(expectedOwner, currentOwner)
    : !currentOwner;
};

const normalizeOverlayForPersistenceCompare = (overlay: OverlayInfo) => {
  const normalized = normalizeOverlayForSync(overlay);
  const {
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    createdBy: _createdBy,
    updatedBy: _updatedBy,
    ...persistableFields
  } = normalized;
  return persistableFields;
};

const getChangedOverlayDocsForUndoRedo = (
  currentList: OverlayInfo[],
  previousList: OverlayInfo[],
  selectedOverlayId?: string,
): OverlayInfo[] => {
  const previousById = new Map(
    previousList.map((overlay) => [overlay.id, overlay]),
  );

  return currentList.filter((overlay) => {
    if (!overlay.id || overlay.id === selectedOverlayId) {
      return false;
    }

    const previousOverlay = previousById.get(overlay.id);
    if (!previousOverlay) {
      return false;
    }

    return !_.isEqual(
      normalizeOverlayForPersistenceCompare(overlay),
      normalizeOverlayForPersistenceCompare(previousOverlay),
    );
  });
};

const hasBibleDisplayData = (info?: BibleDisplayInfo) =>
  Boolean(info?.title?.trim() || info?.text?.trim());

const hasParticipantOverlayData = (info?: OverlayInfo) =>
  Boolean(info?.name || info?.title || info?.event);

const hasStbOverlayData = (info?: OverlayInfo) =>
  Boolean(info?.heading || info?.subHeading);

const hasQrOverlayData = (info?: OverlayInfo) =>
  Boolean(info?.url || info?.description);

const hasImageOverlayData = (info?: OverlayInfo) => Boolean(info?.imageUrl);

const hasBoardPostData = (info?: { text?: string }) =>
  Boolean(info?.text?.trim());

const isIncomingOverlayTransitionNewer = (
  current:
    | Pick<OverlayInfo, "time" | "transitionSequence">
    | Pick<BoardPostStreamInfo, "time" | "transitionSequence">
    | undefined,
  incoming:
    | Pick<OverlayInfo, "time" | "transitionSequence">
    | Pick<BoardPostStreamInfo, "time" | "transitionSequence">,
) => {
  if (
    incoming.transitionSequence != null &&
    current?.transitionSequence != null &&
    incoming.transitionSequence !== current.transitionSequence
  ) {
    return incoming.transitionSequence > current.transitionSequence;
  }

  if (
    incoming.transitionSequence != null &&
    current?.transitionSequence == null
  ) {
    return true;
  }

  return !!(
    (incoming.time && current?.time && incoming.time > current.time) ||
    (incoming.time && !current?.time)
  );
};

const shouldApplyIncomingOverlayPayload = <
  T extends { time?: number; transitionSequence?: number },
>(
  current: T | undefined,
  incoming: T,
  hasIncomingData: boolean,
  hasCurrentData: boolean,
) => {
  const currentHasOrderingMarkers =
    current?.transitionSequence != null || current?.time != null;

  return (
    (hasIncomingData && !hasCurrentData && !currentHasOrderingMarkers) ||
    isIncomingOverlayTransitionNewer(current, incoming)
  );
};

/** Editor selection kept across undo/redo (not part of undo snapshots). */
const getItemSelectionForUndoRedo = (
  item: RootState["undoable"]["present"]["item"],
) => ({
  selectedSlide: item.selectedSlide,
  selectedBox: item.selectedBox,
});

const reconcileItemSelectionAfterUndoRedo = (
  listenerApi: {
    dispatch: (action: Action) => unknown;
    getState: () => RootState | unknown;
  },
  preserved: ReturnType<typeof getItemSelectionForUndoRedo>,
) => {
  const item = (listenerApi.getState() as RootState).undoable.present.item;

  if (item.selectedSlide !== preserved.selectedSlide) {
    listenerApi.dispatch(
      itemSlice.actions.setSelectedSlide(preserved.selectedSlide),
    );
  }
  if (item.selectedBox !== preserved.selectedBox) {
    listenerApi.dispatch(
      itemSlice.actions.setSelectedBox(preserved.selectedBox),
    );
  }
};

const getChangedOverlayIds = (
  currentList: OverlayInfo[],
  previousList: OverlayInfo[],
) => {
  const currentMap = new Map(
    currentList.map((overlay) => [overlay.id, overlay]),
  );
  const previousMap = new Map(
    previousList.map((overlay) => [overlay.id, overlay]),
  );
  const ids = new Set([...currentMap.keys(), ...previousMap.keys()]);

  return Array.from(ids).filter((id) => {
    return !_.isEqual(currentMap.get(id), previousMap.get(id));
  });
};

const getOverlaySelectionForUndoRedo = (
  currentState: RootState,
  previousState: RootState,
): OverlayInfo | null | undefined => {
  const currentList = currentState.undoable.present.overlays.list;
  const previousList = previousState.undoable.present.overlays.list;
  const changedIds = getChangedOverlayIds(currentList, previousList);

  if (changedIds.length === 0) return undefined;

  const currentSelectedId =
    currentState.undoable.present.overlay.selectedOverlay?.id;
  const previousSelectedId =
    previousState.undoable.present.overlay.selectedOverlay?.id;

  let targetId: string | undefined;

  if (changedIds.length === 1) {
    targetId = changedIds[0];
  } else if (currentSelectedId && changedIds.includes(currentSelectedId)) {
    targetId = currentSelectedId;
  } else if (previousSelectedId && changedIds.includes(previousSelectedId)) {
    targetId = previousSelectedId;
  } else {
    targetId =
      changedIds.find((id) =>
        currentList.some((overlay) => overlay.id === id),
      ) || changedIds[0];
  }

  const targetOverlay = currentList.find((overlay) => overlay.id === targetId);
  return targetOverlay || null;
};

/**
 * Serialize outputs created after the registry for `presentation/outputs`.
 *
 * Built-ins are excluded: their state still travels in the flat legacy keys so
 * clients on older builds stay live, and writing both would double-apply on
 * receipt.
 */
const buildRemoteOutputs = (state: RootState) => {
  const knownOutputIds = new Set(
    (state.displayOutputs?.list ?? []).map((output) => output.id),
  );
  const outputs: Record<string, unknown> = {};
  for (const slot of Object.values(state.presentation.outputs)) {
    if (isBuiltInOutputId(slot.id)) continue;
    if (!knownOutputIds.has(slot.id)) continue;
    outputs[`${slot.id}/type`] = slot.type;
    outputs[`${slot.id}/info`] = omitOverlayLanes(slot.info);
    if (slot.type === "stream") {
      for (const lane of STREAM_OVERLAY_LANES) {
        const value = slot.info[lane];
        if (value !== undefined) outputs[`${slot.id}/${lane}`] = value;
      }
      outputs[`${slot.id}/itemContentBlocked`] = slot.itemContentBlocked;
      outputs[`${slot.id}/itemContentBlockedTime`] =
        slot.itemContentBlockedTime ?? 0;
    }
    if (supportsBoardTakeover(slot.type)) {
      outputs[`${slot.id}/boardAliasId`] = slot.boardAliasId;
    }
    outputs[`${slot.id}/followingOutputId`] = slot.followingOutputId ?? "";
  }
  return outputs;
};

/**
 * Last value this client published, per top-level key, keyed by scope.
 *
 * Reset when the church changes: a different church's node has never been
 * written by this client, so everything must go out again.
 */
const lastPublished = new Map<string, Map<string, string>>();
let lastPublishedChurchId: string | null = null;

/** The subset of `payload` whose serialized value differs from our last write. */
const onlyChangedSincePublish = (
  scope: string,
  payload: Record<string, unknown>,
): Record<string, unknown> => {
  if (lastPublishedChurchId !== globalFireDbInfo.churchId) {
    lastPublished.clear();
    lastPublishedChurchId = globalFireDbInfo.churchId ?? null;
  }
  const seen = lastPublished.get(scope) ?? new Map<string, string>();
  lastPublished.set(scope, seen);

  const changed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    const serialized = JSON.stringify(value ?? null);
    if (seen.get(key) === serialized) continue;
    seen.set(key, serialized);
    changed[key] = value;
  }
  return changed;
};

/** Forget what we published, so the next write republishes in full. */
export const resetPublishedPresentationCache = () => {
  lastPublished.clear();
  lastPublishedChurchId = null;
};

const createPresentationUpdate = (state: RootState) => {
  const {
    projectorInfo,
    monitorInfo,
    streamInfo,
    streamItemContentBlocked,
    streamItemContentBlockedTime,
    monitorBoardAliasId,
    projectorBoardAliasId,
  } = toLegacyPresentationShape(state.presentation);
  return {
    projectorInfo,
    monitorInfo,
    monitorBoardAliasId,
    projectorBoardAliasId,
    streamInfo: {
      displayType: streamInfo.displayType,
      time: streamInfo.time,
      slide: streamInfo.slide,
      timerId: streamInfo.timerId,
      name: streamInfo.name,
      type: streamInfo.type,
      slideIndex: streamInfo.slideIndex,
      slideCount: streamInfo.slideCount,
      localVideoInput: streamInfo.localVideoInput,
      videoPlayback: streamInfo.videoPlayback,
    },
    stream_itemContentBlocked: streamItemContentBlocked,
    stream_itemContentBlockedTime: streamItemContentBlockedTime,
    stream_bibleInfo: streamInfo.bibleDisplayInfo,
    stream_participantOverlayInfo: streamInfo.participantOverlayInfo,
    stream_stbOverlayInfo: streamInfo.stbOverlayInfo,
    stream_qrCodeOverlayInfo: streamInfo.qrCodeOverlayInfo,
    stream_imageOverlayInfo: streamInfo.imageOverlayInfo,
    stream_formattedTextDisplayInfo: streamInfo.formattedTextDisplayInfo,
    stream_boardPostStreamInfo: streamInfo.boardPostStreamInfo,
    outputs: buildRemoteOutputs(state),
  };
};

type PresentationUpdate = ReturnType<typeof createPresentationUpdate>;
const persistPresentationUpdateLocally = (
  state: RootState,
  presentationUpdate: PresentationUpdate,
) => {
  const { streamInfo } = toLegacyPresentationShape(state.presentation);

  localStorage.setItem(
    "projectorInfo",
    JSON.stringify(presentationUpdate.projectorInfo),
  );
  localStorage.setItem(
    "monitorInfo",
    JSON.stringify(presentationUpdate.monitorInfo),
  );
  localStorage.setItem(
    "monitorBoardAliasId",
    JSON.stringify(presentationUpdate.monitorBoardAliasId),
  );
  localStorage.setItem(
    "projectorBoardAliasId",
    JSON.stringify(presentationUpdate.projectorBoardAliasId),
  );
  localStorage.setItem("streamInfo", JSON.stringify(streamInfo));
  localStorage.setItem(
    "stream_bibleInfo",
    JSON.stringify(streamInfo.bibleDisplayInfo),
  );
  localStorage.setItem(
    "stream_participantOverlayInfo",
    JSON.stringify(streamInfo.participantOverlayInfo),
  );
  localStorage.setItem(
    "stream_stbOverlayInfo",
    JSON.stringify(streamInfo.stbOverlayInfo),
  );
  localStorage.setItem(
    "stream_qrCodeOverlayInfo",
    JSON.stringify(streamInfo.qrCodeOverlayInfo),
  );
  localStorage.setItem(
    "stream_imageOverlayInfo",
    JSON.stringify(streamInfo.imageOverlayInfo),
  );
  localStorage.setItem(
    "stream_formattedTextDisplayInfo",
    JSON.stringify(streamInfo.formattedTextDisplayInfo),
  );
  localStorage.setItem(
    "stream_boardPostStreamInfo",
    JSON.stringify(streamInfo.boardPostStreamInfo),
  );
  localStorage.setItem(
    "stream_itemContentBlocked",
    JSON.stringify(presentationUpdate.stream_itemContentBlocked),
  );
  // Nest slash-path keys so same-machine display windows can apply named
  // outputs from the storage event without waiting on Firebase.
  localStorage.setItem(
    "outputs",
    JSON.stringify(nestSlashPathOutputs(presentationUpdate.outputs)),
  );
};

type PresentationWrite = {
  churchId: string;
  presentationUpdate: PresentationUpdate;
  triggerAction?: string;
  streamTransmitting: boolean;
  activeOverlayLanes: string[];
};

const getActiveOverlayLanes = (state: RootState) => {
  const { streamInfo } = toLegacyPresentationShape(state.presentation);
  return [
    hasParticipantOverlayData(streamInfo.participantOverlayInfo)
      ? "participant"
      : null,
    hasStbOverlayData(streamInfo.stbOverlayInfo) ? "stb" : null,
    hasQrOverlayData(streamInfo.qrCodeOverlayInfo) ? "qr" : null,
    hasImageOverlayData(streamInfo.imageOverlayInfo) ? "image" : null,
    hasBoardPostData(streamInfo.boardPostStreamInfo) ? "boardPost" : null,
  ].filter((lane): lane is string => lane !== null);
};

const commitPresentationUpdate = async (write: PresentationWrite) => {
  const firebaseDb = globalFireDbInfo.db;
  if (!firebaseDb || !globalFireDbInfo.churchId) return false;
  if (globalFireDbInfo.churchId !== write.churchId) return false;

  const presentationPath = getChurchDataPath(write.churchId, "presentation");
  const { outputs: remoteOutputs, ...legacyUpdate } = write.presentationUpdate;
  try {
    const changedLegacy = onlyChangedSincePublish(
      "legacy",
      cleanObject(legacyUpdate) as Record<string, unknown>,
    );
    if (Object.keys(changedLegacy).length > 0) {
      await Promise.resolve(
        update(ref(firebaseDb, presentationPath), changedLegacy),
      );
    }

    const changedOutputs = onlyChangedSincePublish(
      "outputs",
      cleanObject(remoteOutputs) as Record<string, unknown>,
    );
    if (Object.keys(changedOutputs).length > 0) {
      await Promise.resolve(
        update(
          ref(
            firebaseDb,
            getChurchDataPath(write.churchId, "presentation", "outputs"),
          ),
          changedOutputs,
        ),
      );
    }
  } catch (error) {
    const permissionDenied = isFirebasePermissionDenied(error);
    logFirebaseOperationFailure("presentation_sync", presentationPath, error, {
      churchId: write.churchId,
      permissionDenied,
      includesOverlayLanes: true,
      triggerAction: write.triggerAction || null,
      streamTransmitting: write.streamTransmitting,
      activeOverlayLanes: write.activeOverlayLanes,
    });
    throw error;
  }
  return true;
};

/** Clear a removed output's synced presentation state. */
export const clearRemoteOutputState = async (outputId: string) => {
  if (!globalFireDbInfo.writeCapabilities.presentation) return;
  if (!globalFireDbInfo.db || !globalFireDbInfo.churchId || !outputId) return;
  await set(
    ref(
      globalFireDbInfo.db,
      getChurchDataPath(
        globalFireDbInfo.churchId,
        "presentation",
        "outputs",
        outputId,
      ),
    ),
    null,
  );
};

/** Push current presentation (projector/monitor/stream) to Firebase + localStorage. */
export const writePresentationSnapshotToFirebase = async (
  state: RootState,
  triggerAction?: string,
) => {
  const presentationUpdate = createPresentationUpdate(state);
  persistPresentationUpdateLocally(state, presentationUpdate);
  const activeOverlayLanes = getActiveOverlayLanes(state);
  const { isStreamTransmitting } = toLegacyPresentationShape(
    state.presentation,
  );
  const churchId = globalFireDbInfo.churchId;
  if (!globalFireDbInfo.writeCapabilities.presentation) return true;
  if (
    !globalFireDbInfo.db ||
    globalFireDbInfo.isConnected === false ||
    !churchId
  ) {
    if (
      triggerAction &&
      STREAM_ACTIONS_REQUIRING_IMMEDIATE_DELIVERY.has(triggerAction)
    ) {
      console.error(
        "[firebase diagnostic]",
        JSON.stringify({
          event: "presentation_sync_write_unavailable",
          churchId: churchId || null,
          realtimeConnected: globalFireDbInfo.isConnected === true,
          triggerAction,
          streamTransmitting: isStreamTransmitting,
          activeOverlayLanes,
        }),
      );
    }
    return false;
  }
  return commitPresentationUpdate({
    churchId,
    presentationUpdate,
    triggerAction,
    streamTransmitting: isStreamTransmitting,
    activeOverlayLanes,
  });
};

const STREAM_ACTIONS_REQUIRING_IMMEDIATE_DELIVERY = new Set([
  presentationSlice.actions.toggleStreamTransmitting.toString(),
  presentationSlice.actions.setTransmitToAll.toString(),
  presentationSlice.actions.updateStream.toString(),
  presentationSlice.actions.clearStream.toString(),
  presentationSlice.actions.clearStreamOverlaysOnly.toString(),
  presentationSlice.actions.updateBibleDisplayInfo.toString(),
  presentationSlice.actions.updateParticipantOverlayInfo.toString(),
  presentationSlice.actions.updateStbOverlayInfo.toString(),
  presentationSlice.actions.updateQrCodeOverlayInfo.toString(),
  presentationSlice.actions.updateImageOverlayInfo.toString(),
  presentationSlice.actions.updateFormattedTextDisplayInfo.toString(),
  presentationSlice.actions.updateBoardPostStreamInfo.toString(),
]);

const OVERLAY_ACTIONS_REQUIRING_IMMEDIATE_DELIVERY = new Set([
  presentationSlice.actions.updateParticipantOverlayInfo.toString(),
  presentationSlice.actions.updateStbOverlayInfo.toString(),
  presentationSlice.actions.updateQrCodeOverlayInfo.toString(),
  presentationSlice.actions.updateImageOverlayInfo.toString(),
  presentationSlice.actions.updateFormattedTextDisplayInfo.toString(),
  presentationSlice.actions.updateBoardPostStreamInfo.toString(),
  presentationSlice.actions.clearStreamOverlaysOnly.toString(),
]);

const reportPresentationDeliveryFailure = (triggerAction: string) => {
  if (!OVERLAY_ACTIONS_REQUIRING_IMMEDIATE_DELIVERY.has(triggerAction)) return;
  notifyPresentationSyncError(
    "Overlay update was not sent. Check your connection and try again.",
  );
};

const syncPresentationSnapshot = async (
  state: RootState,
  triggerAction: string,
) => {
  try {
    const delivered = await writePresentationSnapshotToFirebase(
      state,
      triggerAction,
    );
    if (!delivered) reportPresentationDeliveryFailure(triggerAction);
  } catch {
    // The write already emitted a structured diagnostic. Do not replay a
    // time-sensitive presentation action after the operator has moved on.
    reportPresentationDeliveryFailure(triggerAction);
  }
};

let lastActionTime = 0;
let currentGroupId = 0;

const excludedActions: string[] = [
  itemSlice.actions.setItemIsLoading.toString(),
  itemSlice.actions.setSectionLoading.toString(),
  itemSlice.actions.setItemFormatting.toString(),
  itemSlice.actions.setSelectedSlide.toString(),
  itemSlice.actions.setIsLyricsEditorOpen.toString(),
  itemSlice.actions.setHasPendingUpdate.toString(),
  itemSlice.actions.setRemoteUpdateReason.toString(),
  itemSlice.actions.forceUpdate.toString(),
  itemSlice.actions.markItemPersisted.toString(),
  itemSlice.actions.rebaseItemPersistence.toString(),
  itemSlice.actions.bufferRemoteItemUpdate.toString(),
  itemSlice.actions.bufferSongV2RevisionConflict.toString(),
  itemSlice.actions.discardPendingRemoteItem.toString(),
  itemSlice.actions.applyPendingRemoteItem.toString(),
  itemSlice.actions.applyPersistedSongAudio.toString(),
  itemSlice.actions.setSelectedBox.toString(),
  itemSlice.actions.setActiveItem.toString(),
  itemSlice.actions.setActiveItemOccurrence.toString(),
  itemSlice.actions.clearTransientState.toString(),
  itemSlice.actions.toggleBackgroundTargetSlideId.toString(),
  itemSlice.actions.setBackgroundTargetSlideIds.toString(),
  itemSlice.actions.setBackgroundTargetRangeAnchorId.toString(),
  itemSlice.actions.setMobileBackgroundTargetSelectMode.toString(),
  itemSlice.actions.clearBackgroundTargetSelection.toString(),
  itemSlice.actions.clearBackgroundTargetSlideIdsOnly.toString(),
  itemSlice.actions.setRestoreFocusToBox.toString(),
  overlaysSlice.actions.initiateOverlayList.toString(),
  overlaysSlice.actions.updateOverlayListFromRemote.toString(),
  overlaysSlice.actions.updateOverlaysByIdFromRemote.toString(),
  overlaysSlice.actions.setHasPendingUpdate.toString(),
  overlaysSlice.actions.forceUpdate.toString(),
  overlaysSlice.actions.updateInitialList.toString(),
  // Post-animation bookkeeping (marks rows as "seen" so they don't re-animate).
  // It must not create undo entries, or undo steps stop mapping to user actions.
  overlaysSlice.actions.addToInitialList.toString(),
  overlaysSlice.actions.mergeOverlayHistoryFromDb.toString(),
  overlaysSlice.actions.deleteOverlayHistoryEntry.toString(),
  overlaysSlice.actions.mergeOverlayIntoHistory.toString(),
  creditsSlice.actions.initiateCreditsList.toString(),
  creditsSlice.actions.initiateTransitionScene.toString(),
  creditsSlice.actions.initiateCreditsScene.toString(),
  creditsSlice.actions.initiateLiveCredits.toString(),
  creditsSlice.actions.updateCreditsListFromRemote.toString(),
  creditsSlice.actions.updateLiveCreditsFromRemote.toString(),
  creditsSlice.actions.updateInitialList.toString(),
  creditsSlice.actions.setIsLoading.toString(),
  creditsSlice.actions.selectCredit.toString(),
  creditsSlice.actions.forceUpdate.toString(),
  creditsSlice.actions.initiateCreditsHistory.toString(),
  creditsSlice.actions.deleteCreditsHistoryEntry.toString(),
  itemListSlice.actions.initiateItemList.toString(),
  itemListSlice.actions.updateItemListFromRemote.toString(),
  itemListSlice.actions.setItemListIsLoading.toString(),
  itemListSlice.actions.setHasPendingUpdate.toString(),
  itemListSlice.actions.acknowledgeOutlineSave.toString(),
  overlaysSlice.actions.acknowledgeOutlineSave.toString(),
  setOutlineContentDatabase.toString(),
  itemListSlice.actions.forceUpdate.toString(),
  itemListSlice.actions.setActiveItemInList.toString(),
  itemListSlice.actions.setItemListLoadError.toString(),
  itemListSlice.actions.retryItemListLoad.toString(),
  itemListSlice.actions.setItemListIsRetrying.toString(),
  itemListSlice.actions.recordOutlineConflict.toString(),
  itemListSlice.actions.markItemListPersisted.toString(),
  itemListSlice.actions.failOutlineResolution.toString(),
  itemListsSlice.actions.initiateItemLists.toString(),
  itemListsSlice.actions.restorePendingRegistryChanges.toString(),
  itemListsSlice.actions.updateItemListsFromRemote.toString(),
  itemListsSlice.actions.setInitialItemList.toString(),
  itemListsSlice.actions.selectItemList.toString(),
  itemListsSlice.actions.setOutlineScope.toString(),
  itemListsSlice.actions.setRegistrySaveState.toString(),
  itemListsSlice.actions.retryRegistrySave.toString(),
  itemListsSlice.actions.keepRegistryChanges.toString(),
  preferencesSlice.actions.initiatePreferences.toString(),
  preferencesSlice.actions.setIsLoading.toString(),
  preferencesSlice.actions.setSelectedPreference.toString(),
  preferencesSlice.actions.setShouldShowItemEditor.toString(),
  preferencesSlice.actions.setOverlayControllerPanel.toString(),
  preferencesSlice.actions.setIsMediaExpanded.toString(),
  preferencesSlice.actions.increaseSlides.toString(),
  preferencesSlice.actions.decreaseSlides.toString(),
  preferencesSlice.actions.setSlides.toString(),
  preferencesSlice.actions.increaseSlidesMobile.toString(),
  preferencesSlice.actions.decreaseSlidesMobile.toString(),
  preferencesSlice.actions.setSlidesMobile.toString(),
  preferencesSlice.actions.increaseFormattedLyrics.toString(),
  preferencesSlice.actions.decreaseFormattedLyrics.toString(),
  preferencesSlice.actions.setFormattedLyrics.toString(),
  preferencesSlice.actions.increaseMediaItems.toString(),
  preferencesSlice.actions.decreaseMediaItems.toString(),
  preferencesSlice.actions.setMediaItems.toString(),
  preferencesSlice.actions.updatePreferencesFromRemote.toString(),
  preferencesSlice.actions.initiateQuickLinks.toString(),
  preferencesSlice.actions.forceUpdate.toString(),
  overlaySlice.actions.setIsOverlayLoading.toString(),
  overlaySlice.actions.setHasPendingUpdate.toString(),
  overlaySlice.actions.markOverlayDraftPending.toString(),
  overlaySlice.actions.clearOverlayDraftPending.toString(),
  overlaySlice.actions.forceUpdate.toString(),
  overlaySlice.actions.selectOverlay.toString(),
  overlaySlice.actions.markOverlayPersisted.toString(),
  overlaySlice.actions.bufferRemoteOverlayUpdate.toString(),
  overlaySlice.actions.discardPendingRemoteOverlay.toString(),
  overlaySlice.actions.applyPendingRemoteOverlay.toString(),
  timersSlice.actions.setShouldUpdateTimers.toString(),
  overlayTemplatesSlice.actions.initiateTemplates.toString(),
  overlayTemplatesSlice.actions.updateTemplatesFromRemote.toString(),
  overlayTemplatesSlice.actions.setIsLoading.toString(),
  overlayTemplatesSlice.actions.setHasPendingUpdate.toString(),
  overlayTemplatesSlice.actions.forceUpdate.toString(),
];

const excludedPrefixes = [
  "debouncedUpdate",
  "timers/",
  "allDocs/",
  "itemLibraryUi/",
  "presentation/",
];

const undoableReducers = undoable(
  combineReducers({
    item: itemSlice.reducer,
    overlay: overlaySlice.reducer,
    overlays: overlaysSlice.reducer,
    credits: creditsSlice.reducer,
    itemList: itemListSlice.reducer,
    itemLists: itemListsSlice.reducer,
    preferences: preferencesSlice.reducer,
    overlayTemplates: overlayTemplatesSlice.reducer,
    serviceTimes: serviceTimesSliceReducer,
  }),
  {
    groupBy: (action) => {
      const now = Date.now();
      const timeSinceLastUpdate = now - lastActionTime;

      if (timeSinceLastUpdate < 500) {
        return currentGroupId;
      } else {
        currentGroupId = now;
        lastActionTime = now;
        return currentGroupId;
      }
    },
    filter: (action: Action) => {
      const isExcluded =
        excludedActions.includes(action.type) ||
        excludedPrefixes.some((prefix) => action.type.startsWith(prefix)) ||
        action.type === "SEED_UNDO_STATE" ||
        !hasFinishedInitialization;

      return !isExcluded;
    },
    syncFilter: true,
    limit: 100,
  },
);

const listenerMiddleware = createListenerMiddleware();

type ItemAutosaveDebounce = {
  timer: ReturnType<typeof setTimeout>;
  promise: Promise<void>;
  resolve: () => void;
  flush: () => void;
};

type PendingItemAutosave = {
  desired: ItemState;
  baseline: DBItem;
  database: NonNullable<typeof db>;
  owner: ReturnType<typeof getItemMutationOwner>;
  mutationVersion: number;
  resolveReplicationConflicts?: ItemState["pendingSongV2Conflicts"];
  recoveryRecordId?: string;
  recoveryState?: "interrupted" | "checkpoint-failed" | "needs-review" | "discard-failed" | "discarded";
  recoveryCheckpointRetryCount?: number;
};
const itemAutosaveDebounces = new Map<string, ItemAutosaveDebounce>();
const itemAutosaveWriteQueues = new Map<string, Promise<void>>();
const pendingItemAutosaves = new Map<string, PendingItemAutosave>();
// A partially committed V2 autosave must finish before a coalesced newer
// autosave can use its original baseline. Keep that predecessor by owner/key.
const pendingSongV2WriteRecoveries = new Map<string, PendingItemAutosave>();
const queuedItemAutosaveRetries = new Set<string>();
let itemAutosaveMutationVersion = 0;
const explicitRemoteDecisionByItem = new Map<string, { version: number; discarding: boolean }>();
const songRecoveryCheckpointRetryTimers = new Map<string, {
  timer: ReturnType<typeof setTimeout>;
  mutationVersion: number;
  sessionToken: symbol;
}>();
const SONG_RECOVERY_CHECKPOINT_RETRY_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000] as const;

const clearSongRecoveryCheckpointRetry = (saveKey: string) => {
  const scheduled = songRecoveryCheckpointRetryTimers.get(saveKey);
  if (!scheduled) return;
  clearTimeout(scheduled.timer);
  songRecoveryCheckpointRetryTimers.delete(saveKey);
};

const retainInterruptedSongV2Autosave = (
  saveKey: string,
  pending: PendingItemAutosave,
  error: SongV2MutationNotAuthorizedError,
) => {
  if (error.recovery || pending.recoveryRecordId) {
    pendingSongV2WriteRecoveries.set(saveKey, pending);
  }
  const latestPending = pendingItemAutosaves.get(saveKey);
  if (latestPending?.mutationVersion === pending.mutationVersion) {
    pendingItemAutosaves.set(saveKey, {
      ...latestPending,
      recoveryState: "interrupted",
    });
  }
};
const retainSongV2AutosaveForReview = async (
  saveKey: string,
  pending: PendingItemAutosave,
) => {
  const wasRecovery = Boolean(
    pending.recoveryRecordId ||
    pendingSongV2WriteRecoveries.get(saveKey)?.mutationVersion === pending.mutationVersion,
  );
  if (!wasRecovery) return;
  const reviewed = { ...pending, recoveryState: "needs-review" as const };
  pendingSongV2WriteRecoveries.set(saveKey, reviewed);
  if (reviewed.recoveryRecordId && reviewed.owner) {
    await markSongV2AutosaveRecoveryNeedsReview(
      reviewed.recoveryRecordId,
      reviewed.owner,
    ).catch(error => console.error("Could not retain the song recovery for review", error));
  }
};
const pauseAuthorizationAutosaveRetry = (saveKey: string) => {
  const pending = pendingItemAutosaves.get(saveKey);
  if (pending?.recoveryState === "interrupted") {
    pendingItemAutosaves.set(saveKey, { ...pending, recoveryState: undefined });
  }
};

const retryPendingItemAutosave = createAction<{
  saveKey: string;
  mutationVersion: number;
  recovery: boolean;
}>("store/retryPendingItemAutosave");

const itemAutosaveKey = (item: ItemState) =>
  JSON.stringify([
    item.contentOwner?.scopeId ?? "legacy",
    item.contentOwner?.databaseKey ?? "",
    item.contentOwner?.churchId ?? "",
    item._id,
    item.type,
  ]);

const scheduleItemAutosaveDebounce = (key: string) => {
  const previous = itemAutosaveDebounces.get(key);
  if (previous) {
    clearTimeout(previous.timer);
    previous.resolve();
  }

  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  const timer = setTimeout(resolve, 1500);
  const debounce: ItemAutosaveDebounce = {
    timer,
    promise,
    resolve,
    flush: () => {
      clearTimeout(timer);
      resolve();
    },
  };
  itemAutosaveDebounces.set(key, debounce);
  return debounce;
};

const cancelItemAutosaveDebounce = (key: string) => {
  const pending = itemAutosaveDebounces.get(key);
  if (!pending) return;
  clearTimeout(pending.timer);
  itemAutosaveDebounces.delete(key);
  pending.resolve();
};

const enqueueItemAutosaveWrite = <T,>(key: string, write: () => Promise<T>) => {
  const previous = itemAutosaveWriteQueues.get(key) ?? Promise.resolve();
  const queued = previous.catch(() => undefined).then(write);
  const settled = queued.then(() => undefined, () => undefined);
  itemAutosaveWriteQueues.set(key, settled);
  void settled.then(() => {
    if (itemAutosaveWriteQueues.get(key) === settled) {
      itemAutosaveWriteQueues.delete(key);
    }
  });
  return queued;
};

const autosaveBelongsToContentDatabase = (key: string, scopeId: string) => {
  try {
    return JSON.parse(key)[0] === scopeId;
  } catch {
    return false;
  }
};

const flushItemAutosavesForContentDatabase = async (scopeId: string) => {
  for (let attempts = 0; attempts < 100; attempts += 1) {
    for (const [key, debounce] of itemAutosaveDebounces) {
      if (autosaveBelongsToContentDatabase(key, scopeId)) debounce.flush();
    }

    // Let listener effects leave their debounce waits and enqueue Pouch writes.
    await Promise.resolve();
    const writes = [...itemAutosaveWriteQueues.entries()]
      .filter(([key]) => autosaveBelongsToContentDatabase(key, scopeId))
      .map(([, write]) => write);
    await Promise.all(writes);
    await Promise.resolve();

    const hasDebounces = [...itemAutosaveDebounces.keys()].some((key) =>
      autosaveBelongsToContentDatabase(key, scopeId),
    );
    const hasWrites = [...itemAutosaveWriteQueues.keys()].some((key) =>
      autosaveBelongsToContentDatabase(key, scopeId),
    );
    if (!hasDebounces && !hasWrites) return;
  }
};

// handle item updates
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    if (retryPendingItemAutosave.match(action)) return true;
    // Audio is already persisted. Reconcile pending content intent without
    // scheduling another audio write or accepting a stale owner's result.
    if (itemSlice.actions.applyPersistedSongAudio.match(action)) {
      return (currentState as RootState).undoable.present.item !==
        (previousState as RootState).undoable.present.item;
    }
    if (itemSlice.actions.applyPendingRemoteItem.match(action)) {
      const previousItem = (previousState as RootState).undoable.present.item;
      return previousItem.pendingRemoteItem?._id === previousItem._id &&
        (currentState as RootState).undoable.present.item !== previousItem;
    }

    const excluded = isAnyOf(
      itemSlice.actions.setSelectedSlide,
      itemSlice.actions.setActiveItemOccurrence,
      itemSlice.actions.setSelectedBox,
      itemSlice.actions.setIsLyricsEditorOpen,
      itemSlice.actions.setItemIsLoading,
      itemSlice.actions.setSectionLoading,
      itemSlice.actions.setHasPendingUpdate,
      itemSlice.actions.setRemoteUpdateReason,
      itemSlice.actions.setItemFormatting,
      itemSlice.actions.clearTransientState,
      itemSlice.actions.markItemPersisted,
      itemSlice.actions.bufferRemoteItemUpdate,
      itemSlice.actions.bufferSongV2RevisionConflict,
      itemSlice.actions.discardPendingRemoteItem,
      itemSlice.actions.applyPendingRemoteItem,
    );
    const currentItem = (currentState as RootState).undoable.present.item;
    const previousItem = (previousState as RootState).undoable.present.item;
    const isExplicitPendingRetry =
      itemSlice.actions._updateSlides.match(action) &&
      !!currentItem.hasPendingUpdate;
    return (
      (currentItem !== previousItem || isExplicitPendingRetry) &&
      !excluded(action) &&
      !!currentItem.hasPendingUpdate &&
      !isStoreResetAction(action)
    );
  },

  effect: async (_action, listenerApi) => {
    const retryRequest = retryPendingItemAutosave.match(_action) ? _action.payload : undefined;
    const retryPending = retryRequest
      ? retryRequest.recovery
        ? pendingSongV2WriteRecoveries.get(retryRequest.saveKey)
        : pendingItemAutosaves.get(retryRequest.saveKey)
      : undefined;
    const retryId = retryRequest
      ? `${retryRequest.saveKey}:${retryRequest.mutationVersion}:${retryRequest.recovery ? "recovery" : "pending"}`
      : undefined;
    if (retryRequest && (!retryPending || retryPending.mutationVersion !== retryRequest.mutationVersion)) {
      if (retryId) queuedItemAutosaveRetries.delete(retryId);
      return;
    }
    let state = listenerApi.getState() as RootState;
    const previousItem = (listenerApi.getOriginalState() as RootState).undoable.present.item;
    let ownedSnapshot: ItemState | undefined;
    if (itemSlice.actions.setActiveItem.match(_action)) {
      state = listenerApi.getOriginalState() as RootState;
    }
    if (itemSlice.actions.applyOwnedContentUpdate.match(_action)) {
      ownedSnapshot = _action.payload.snapshot;
    }

    const isPersistedAudioUpdate =
      itemSlice.actions.applyPersistedSongAudio.match(_action);
    const item = retryPending?.desired ?? (isPersistedAudioUpdate
      ? (listenerApi.getState() as RootState).undoable.present.item
      : ownedSnapshot ?? state.undoable.present.item);
    const contentOwner = item.contentOwner;
    const owner = retryPending?.owner ?? getItemMutationOwner(item);
    const dbAtStart = retryPending?.database ?? (contentOwner
      ? getContentDatabaseForOwner(contentOwner) ??
        (contentOwner.scopeId === "unscoped" ? db : undefined)
      : db);
    const saveKey = retryRequest?.saveKey ?? itemAutosaveKey(item);
    const explicitRemoteDecisionVersionAtStart =
      explicitRemoteDecisionByItem.get(saveKey)?.version ?? 0;
    let priorPending = pendingItemAutosaves.get(saveKey);
    const churchIdAtStart = globalFireDbInfo.churchId;
    const sessionTokenAtStart = dbAtStart
      ? getContentDatabaseSessionToken(dbAtStart.name)
      : null;
    const mutationGuard = dbAtStart
      ? createSongV2MutationGuard(
        dbAtStart,
        contentOwner,
        churchIdAtStart,
        sessionTokenAtStart,
        () => sameItemMutationScope(
          item,
          (listenerApi.getState() as RootState).undoable.present.item,
        ),
      )
      : () => false;
    if (itemSlice.actions.applyPendingRemoteItem.match(_action)) {
      if (dbAtStart && item.docType === "song-v2-root" && previousItem.pendingSongV2Conflicts?.length) {
        // The operator explicitly adopted the displayed revision. Retire only
        // conflict leaves belonging to that still-current persisted content.
        const resolved = await pruneResolvedSongV2Conflicts(dbAtStart, item, previousItem.pendingSongV2Conflicts, mutationGuard)
          .catch(error => { console.error("Could not finish song conflict resolution", error); return undefined; });
        const active = (listenerApi.getState() as RootState).undoable.present.item;
        if (resolved && db === dbAtStart && !pendingItemAutosaves.has(saveKey) && sameItemMutationOwner(owner, getItemMutationOwner(active))) {
          listenerApi.dispatch(itemSlice.actions.markItemPersisted(resolved, item));
          const projection = songToLibraryProjection(resolved);
          listenerApi.dispatch(allDocsSlice.actions.applyItemDocumentChange({ id: projection._id, doc: projection }));
        }
      }
      return;
    }

    if (itemSlice.actions.keepLocalItemChanges.match(_action)) {
      // The operator explicitly chose the retained local draft after review.
      // Its next authorized save replaces the durable recovery with the new
      // remote baseline and the chosen local content.
      const reviewedRecovery = pendingSongV2WriteRecoveries.get(saveKey);
      if (reviewedRecovery?.recoveryState === "needs-review" ||
        reviewedRecovery?.recoveryState === "discard-failed" ||
        reviewedRecovery?.recoveryState === "discarded") {
        priorPending ??= reviewedRecovery;
        pendingSongV2WriteRecoveries.delete(saveKey);
      }
    }

    if (isPersistedAudioUpdate) {
      cancelItemAutosaveDebounce(saveKey);
      if (!priorPending) return;
    }

    const baseline = retryPending?.baseline ?? (itemSlice.actions.keepLocalItemChanges.match(_action)
      ? item.baseItem
      : isPersistedAudioUpdate
        ? item.baseItem ?? priorPending?.baseline
      : priorPending?.baseline ?? item.baseItem);
    const database = retryPending?.database ?? dbAtStart ?? priorPending?.database;
    if (!database || !baseline) return;

    const mutationVersion = retryPending?.mutationVersion ?? ++itemAutosaveMutationVersion;
    const nextPending: PendingItemAutosave = retryPending ?? {
      desired: item,
      baseline,
      database,
      owner,
      mutationVersion,
      resolveReplicationConflicts: itemSlice.actions.keepLocalItemChanges.match(_action)
        ? previousItem.pendingSongV2Conflicts : priorPending?.resolveReplicationConflicts,
      recoveryState: priorPending?.recoveryState === "interrupted"
        ? "interrupted" : undefined,
      recoveryRecordId: priorPending?.recoveryRecordId,
      recoveryCheckpointRetryCount: 0,
    };
    if (
      isPersistedAudioUpdate &&
      getItemPersistenceChanges(item, baseline).length === 0
    ) {
      pendingItemAutosaves.delete(saveKey);
      listenerApi.dispatch(
        itemSlice.actions.setHasPendingUpdate(false),
      );
      return;
    }
    if (!retryRequest) {
      clearSongRecoveryCheckpointRetry(saveKey);
      pendingItemAutosaves.set(saveKey, nextPending);
    }

    if (retryRequest) {
      cancelItemAutosaveDebounce(saveKey);
    } else if (itemSlice.actions.setActiveItem.match(_action)) {
      cancelItemAutosaveDebounce(saveKey);
    } else {
      const debounce = scheduleItemAutosaveDebounce(saveKey);
      await debounce.promise;
      if (itemAutosaveDebounces.get(saveKey) !== debounce) return;
      itemAutosaveDebounces.delete(saveKey);
    }

    await enqueueItemAutosaveWrite(saveKey, async () => {
      const pendingForLock = retryPending ?? pendingItemAutosaves.get(saveKey);
      const performWrite = async () => {
        let currentPending = retryPending ?? pendingItemAutosaves.get(saveKey);
        if (currentPending?.mutationVersion !== mutationVersion) return;
        if (!retryRequest && pendingSongV2WriteRecoveries.has(saveKey)) return;
        if (retryRequest && !retryRequest.recovery &&
          pendingItemAutosaves.get(saveKey)?.mutationVersion !== mutationVersion) return;
        if (retryRequest?.recovery &&
          pendingSongV2WriteRecoveries.get(saveKey)?.mutationVersion !== mutationVersion) return;
        if (
          (retryRequest?.recovery || currentPending.recoveryState === "interrupted") &&
          (!currentPending.owner || !songRecoveryIsReadyForOwner(currentPending.owner, currentPending.database))
        ) return;
        const operationIsRetained = () => retryRequest?.recovery
          ? pendingSongV2WriteRecoveries.get(saveKey)?.mutationVersion === mutationVersion
          : pendingItemAutosaves.get(saveKey)?.mutationVersion === mutationVersion;
        const desired = currentPending.desired;
        const writeBaseline = currentPending.baseline;
        const writeDatabase = currentPending.database;
        const writeChurchId = globalFireDbInfo.churchId;
        const writeSessionToken = getContentDatabaseSessionToken(writeDatabase.name);
        const writeContentOwner = desired.contentOwner;
        const operationIsNotExplicitlyDiscarded = () => {
          const decision = explicitRemoteDecisionByItem.get(saveKey);
          return decision?.discarding !== true &&
            (decision?.version ?? 0) === explicitRemoteDecisionVersionAtStart;
        };
        const writeMutationGuard = createSongV2MutationGuard(
          writeDatabase,
          writeContentOwner,
          writeChurchId,
          writeSessionToken,
          operationIsRetained,
          operationIsNotExplicitlyDiscarded,
        );
        let snapshot = writeBaseline.docType === "song-v2-root"
          ? await loadSongV2Snapshot(writeDatabase, desired._id, true) : undefined;
        if (snapshot?.conflicts?.length) {
          const bufferRevisionConflict = (conflictSnapshot: Awaited<ReturnType<typeof loadSongV2Snapshot>>) => {
            pauseAuthorizationAutosaveRetry(saveKey);
            const activeItem = (listenerApi.getState() as RootState).undoable.present.item;
            if (
              operationIsRetained() &&
              sameItemMutationScope(desired, activeItem)
            ) {
              listenerApi.dispatch(itemSlice.actions.bufferSongV2RevisionConflict({
                item: conflictSnapshot.hydrated,
                conflicts: conflictSnapshot.conflicts ?? [],
              }));
            }
          };
          if (!globalFireDbInfo.canWriteSongContent) {
            bufferRevisionConflict(snapshot);
            return;
          }
          try {
            snapshot = await loadReconciledSongV2Snapshot(
              writeDatabase,
              desired._id,
              snapshot,
              writeMutationGuard,
            );
          } catch (error) {
            if (error instanceof SongV2ReplicationConflictError) {
              await retainSongV2AutosaveForReview(saveKey, currentPending);
              pauseAuthorizationAutosaveRetry(saveKey);
              bufferRevisionConflict(error.snapshot);
              return;
            }
            if (isSongV2MutationNotAuthorizedError(error)) {
              retainInterruptedSongV2Autosave(saveKey, currentPending, error);
              const latest = await loadSongV2Snapshot(writeDatabase, desired._id, true).catch(() => null);
              if (latest?.conflicts?.length) bufferRevisionConflict(latest);
              return;
            }
            throw error;
          }
        }
        let db_item: DBItem = snapshot?.hydrated ?? await loadItemWithSongHydration(writeDatabase, desired._id);
        if (!operationIsRetained()) return;
        const changedFields = getItemPersistenceChanges(desired, writeBaseline);
        const conflicts = getItemPersistenceConflicts(
          desired,
          writeBaseline,
          db_item,
        );
        if (conflicts.length > 0) {
          await retainSongV2AutosaveForReview(saveKey, currentPending);
          pauseAuthorizationAutosaveRetry(saveKey);
          const latestState = listenerApi.getState() as RootState;
          const activeItem = latestState.undoable.present.item;
          if (
            sameItemMutationOwner(
              getItemMutationOwner(activeItem),
              getItemMutationOwner(desired),
            )
          ) {
            listenerApi.dispatch(itemSlice.actions.bufferRemoteItemUpdate(db_item));
            if (writeBaseline.docType === "song-v2-root") {
              listenerApi.dispatch(itemSlice.actions.setRemoteUpdateReason("song-content-conflict"));
            }
          }
          return;
        }

        if (changedFields.length === 0) {
          let conflictResolutionComplete = !currentPending.resolveReplicationConflicts?.length;
          if (currentPending.resolveReplicationConflicts?.length) {
            const resolved = await pruneResolvedSongV2Conflicts(
              writeDatabase,
              db_item,
              currentPending.resolveReplicationConflicts,
              writeMutationGuard,
            );
            if (resolved) {
              db_item = resolved;
              conflictResolutionComplete = true;
            }
            if (!operationIsRetained()) return;
          }
          const latestState = listenerApi.getState() as RootState;
          const activeItem = latestState.undoable.present.item;
          if (
            sameItemMutationOwner(
              getItemMutationOwner(activeItem),
              getItemMutationOwner(desired),
            )
          ) {
            listenerApi.dispatch(itemSlice.actions.markItemPersisted(db_item, desired));
          }
          if (pendingItemAutosaves.get(saveKey)?.mutationVersion === mutationVersion) {
            pendingItemAutosaves.delete(saveKey);
            clearSongRecoveryCheckpointRetry(saveKey);
          }
          const newerPending = pendingItemAutosaves.get(saveKey);
          if (!newerPending || newerPending.mutationVersion <= mutationVersion) {
            if (conflictResolutionComplete && currentPending.recoveryRecordId && currentPending.owner) {
              await deleteSongV2AutosaveRecovery(
                currentPending.recoveryRecordId,
                currentPending.owner,
              ).catch(error => console.error("Could not clear the completed song recovery", error));
              if (
                pendingSongV2WriteRecoveries.get(saveKey)?.recoveryRecordId === currentPending.recoveryRecordId
              ) pendingSongV2WriteRecoveries.delete(saveKey);
            }
          }
          return;
        }

        const updatedAt = new Date().toISOString();
        const nextItem: DBItem = {
          ...db_item,
          ...(Object.fromEntries(
            changedFields.map((field) => [field, desired[field]]),
          ) as Partial<DBItem>),
          updatedAt,
        };
        const isSongV2Write = nextItem.type === "song" && (
          writeBaseline.docType === "song-v2-root" ||
          db_item.docType === "song-v2-root"
        );
        const durableOwner = currentPending.owner;
        if (
          isSongV2Write &&
          durableOwner &&
          durableOwner.scopeId !== "unscoped" &&
          durableOwner.accountId
        ) {
          const recoveryRecordId = currentPending.recoveryRecordId ??
            createSongV2AutosaveRecoveryId(durableOwner, desired._id);
          try {
            // Durable intent is captured before the writer can commit its first
            // slide, arrangement, or root document. The guard is checked at the
            // local checkpoint boundary and again before the physical writer.
            if (!writeMutationGuard()) {
              if (!operationIsRetained()) return;
              throw new SongV2MutationNotAuthorizedError();
            }
            const checkpointStored = await putSongV2AutosaveRecovery({
              id: recoveryRecordId,
              owner: durableOwner,
              itemId: desired._id,
              desired: currentPending.desired,
              baseline: writeBaseline,
              mutationVersion,
              resolveReplicationConflicts: currentPending.resolveReplicationConflicts,
              status: "pending",
            });
            if (!checkpointStored) {
              const discarded = {
                ...currentPending,
                recoveryRecordId: undefined,
                recoveryState: "discarded" as const,
              };
              if (
                pendingSongV2WriteRecoveries.get(saveKey)?.recoveryRecordId === recoveryRecordId
              ) pendingSongV2WriteRecoveries.delete(saveKey);
              if (pendingItemAutosaves.get(saveKey)?.mutationVersion === mutationVersion) {
                pendingItemAutosaves.set(saveKey, discarded);
              }
              return;
            }
            currentPending = {
              ...currentPending,
              recoveryRecordId,
              recoveryState: undefined,
              recoveryCheckpointRetryCount: 0,
            };
            if (retryRequest?.recovery) {
              pendingSongV2WriteRecoveries.set(saveKey, currentPending);
            } else if (pendingItemAutosaves.get(saveKey)?.mutationVersion === mutationVersion) {
              pendingItemAutosaves.set(saveKey, currentPending);
            }
            if (!writeMutationGuard()) {
              if (!operationIsRetained()) return;
              throw new SongV2MutationNotAuthorizedError();
            }
          } catch (error) {
            if (isSongV2MutationNotAuthorizedError(error)) {
              if (operationIsNotExplicitlyDiscarded()) {
                retainInterruptedSongV2Autosave(saveKey, currentPending, error);
              }
              return;
            }
            // Do not start a multi-document save if its restart recovery record
            // could not be committed. The editor keeps the pending draft visible.
            console.error("Could not persist Song V2 autosave recovery", error);
            let failedPending: PendingItemAutosave | undefined;
            const latestPending = pendingItemAutosaves.get(saveKey);
            if (latestPending?.mutationVersion === mutationVersion) {
              failedPending = { ...latestPending, recoveryState: "checkpoint-failed" };
              pendingItemAutosaves.set(saveKey, failedPending);
            }
            const latestRecovery = pendingSongV2WriteRecoveries.get(saveKey);
            if (latestRecovery?.mutationVersion === mutationVersion) {
              failedPending = { ...latestRecovery, recoveryState: "checkpoint-failed" };
              pendingSongV2WriteRecoveries.set(saveKey, failedPending);
            }
            if (failedPending) scheduleSongRecoveryCheckpointRetry(saveKey, failedPending);
            return;
          }
        }
        let result: { rev: string };
        try {
          if (nextItem.type === "song") {
            const authoredBaseline = writeBaseline;
            const usesV2Baseline = authoredBaseline?.docType === "song-v2-root";
            const saveArgs = [
              writeDatabase,
              nextItem,
              usesV2Baseline
                ? authoredBaseline
                : db_item.docType === "song-v2-root" ? undefined : db_item,
            ] as const;
            db_item = snapshot
              ? await saveSong(...saveArgs, undefined, snapshot, writeMutationGuard)
              : await saveSong(...saveArgs, undefined, undefined, writeMutationGuard);
            result = { rev: db_item._rev! };
          } else {
            db_item = applyPouchAudit(db_item, nextItem, {
              // Doc came from db.get — always an update (legacy rows may lack createdAt).
              isNew: false,
            });
            result = await writeDatabase.put(db_item);
            db_item = { ...db_item, _rev: result.rev };
          }
        } catch (error) {
          const errorName = error instanceof Error ? error.name : "";
          const isSongV2ContentConflict = errorName === "SongV2ConcurrentEditError" ||
            ((error as { status?: number })?.status === 409 && writeBaseline.docType === "song-v2-root");
          const isSongV2VersionTransition = errorName === "SongV2VersionTransitionError";
          const isSongV2Conflict = error instanceof Error && (
            isSongV2ContentConflict || isSongV2VersionTransition
          );
          if ((error as { status?: number })?.status === 409 || isSongV2Conflict) {
            if (currentPending.recoveryRecordId) {
              await retainSongV2AutosaveForReview(saveKey, currentPending);
            }
            pauseAuthorizationAutosaveRetry(saveKey);
            const latest = (await loadItemWithSongHydration(
              writeDatabase,
              desired._id,
            )
              .catch(() => null)) as DBItem | null;
            const latestState = listenerApi.getState() as RootState;
            const activeItem = latestState.undoable.present.item;
            if (
              latest &&
              sameItemMutationOwner(
                getItemMutationOwner(activeItem),
                getItemMutationOwner(desired),
              )
            ) {
              listenerApi.dispatch(itemSlice.actions.bufferRemoteItemUpdate(latest));
              if (isSongV2VersionTransition) {
                listenerApi.dispatch(itemSlice.actions.setRemoteUpdateReason("song-version-transition"));
              } else if (isSongV2ContentConflict) {
                listenerApi.dispatch(itemSlice.actions.setRemoteUpdateReason("song-content-conflict"));
              }
            }
            if (isSongV2Conflict || isSongV2ContentConflict) {
              console.error("Could not save active song draft", error);
              return;
            }
          }
          if (isSongV2MutationNotAuthorizedError(error)) {
            if (operationIsNotExplicitlyDiscarded()) {
              retainInterruptedSongV2Autosave(saveKey, currentPending, error);
            }
            return;
          }
          throw error;
        }
        db_item = { ...db_item, _rev: result.rev };
        let conflictResolutionComplete = !currentPending.resolveReplicationConflicts?.length;
        if (currentPending.resolveReplicationConflicts && db_item.docType === "song-v2-root") {
          const resolved = await pruneResolvedSongV2Conflicts(
            writeDatabase,
            db_item,
            currentPending.resolveReplicationConflicts,
            writeMutationGuard,
          )
            .catch(error => console.error("Could not finish song conflict resolution", error));
          if (resolved) {
            db_item = resolved;
            conflictResolutionComplete = true;
          }
        }

        // Accepted input can still be in the component formatting debounce.
        // Materialize it before deciding whether this acknowledgment is current.
        flushPendingItemMutations(currentPending.owner);
        const pendingAfterWrite = pendingItemAutosaves.get(saveKey);
        if (pendingAfterWrite?.mutationVersion === mutationVersion) {
          pendingItemAutosaves.delete(saveKey);
          clearSongRecoveryCheckpointRetry(saveKey);
        } else if (
          pendingAfterWrite &&
          pendingAfterWrite.mutationVersion > mutationVersion
        ) {
          pendingItemAutosaves.set(saveKey, {
            ...pendingAfterWrite,
            // Acknowledge only what this write changed. A newer edit may still
            // compare unrelated fields against an older remote document.
            baseline: {
              ...pendingAfterWrite.baseline,
              ...Object.fromEntries(changedFields.map((field) => [field,
                db_item.docType === "song-v2-root" ? desired[field] : db_item[field]])),
            },
          });
          if (retryRequest?.recovery) {
            requestPendingItemAutosaveRetry(saveKey, pendingItemAutosaves.get(saveKey)!, false);
          }
        }

        if (
          conflictResolutionComplete &&
          pendingAfterWrite?.mutationVersion === mutationVersion &&
          currentPending.recoveryRecordId &&
          currentPending.owner
        ) {
          await deleteSongV2AutosaveRecovery(
            currentPending.recoveryRecordId,
            currentPending.owner,
          ).catch(error => console.error("Could not clear the completed song recovery", error));
          if (
            pendingSongV2WriteRecoveries.get(saveKey)?.recoveryRecordId === currentPending.recoveryRecordId
          ) pendingSongV2WriteRecoveries.delete(saveKey);
        }

        // A newer intent/remote decision owns publication too. Do not broadcast
        // the older document after its acknowledgment has been superseded.
        if (pendingAfterWrite?.mutationVersion !== mutationVersion) return;
        const latestState = listenerApi.getState() as RootState;
        const activeItem = latestState.undoable.present.item;
        const isSameActiveOwner = sameItemMutationOwner(
            getItemMutationOwner(activeItem),
            getItemMutationOwner(desired),
          );
        if (isSameActiveOwner) {
          listenerApi.dispatch(itemSlice.actions.markItemPersisted(db_item, desired));
        }

        const activeDatabaseOwner = getActiveContentDatabaseOwner();
        const stillInOriginalDatabase = !contentOwner ||
          contentOwner.scopeId === "unscoped"
          ? db === writeDatabase
          : activeDatabaseOwner?.scopeId === contentOwner.scopeId &&
            activeDatabaseOwner.databaseKey === contentOwner.databaseKey &&
            activeDatabaseOwner.churchId === contentOwner.churchId;
        if (!stillInOriginalDatabase) return;

        const cacheDoc = db_item.type === "song" ? songToLibraryProjection(db_item) : db_item;
        listenerApi.dispatch(allDocsSlice.actions.applyItemDocumentChange({ id: cacheDoc._id, doc: cacheDoc }));
        if (!isSameActiveOwner) return;
        safePostMessage({
          type: "update",
          data: {
            docs: db_item.type === "song" ? songToLibraryProjection(db_item) : db_item,
            hostId: globalHostId,
          },
        });
      };
      if (pendingForLock?.owner && pendingForLock.desired.docType === "song-v2-root") {
        let acquiredLock = false;
        try {
          await withSongV2AutosaveLock(
            pendingForLock.desired._id,
            pendingForLock.database.name,
            () => {
              acquiredLock = true;
              return performWrite();
            },
          );
        } catch (error) {
          if (acquiredLock) throw error;
          console.error("Could not acquire the Song V2 write lock", error);
          const latestPending = pendingItemAutosaves.get(saveKey);
          const latestRecovery = pendingSongV2WriteRecoveries.get(saveKey);
          const failed = latestRecovery?.mutationVersion === mutationVersion
            ? { ...latestRecovery, recoveryState: "checkpoint-failed" as const }
            : latestPending?.mutationVersion === mutationVersion
              ? { ...latestPending, recoveryState: "checkpoint-failed" as const }
              : undefined;
          if (failed) {
            if (latestRecovery?.mutationVersion === mutationVersion) {
              pendingSongV2WriteRecoveries.set(saveKey, failed);
            }
            if (latestPending?.mutationVersion === mutationVersion) {
              pendingItemAutosaves.set(saveKey, failed);
            }
            scheduleSongRecoveryCheckpointRetry(saveKey, failed);
          }
        }
      } else {
        await performWrite();
      }
    }).finally(() => {
      if (retryId) queuedItemAutosaveRetries.delete(retryId);
      listenerApi.dispatch(bibleCleanupOpportunity({}));
    });
  },
});

export type SongV2DocumentChange = {
  songId: string;
  libraryChanged: boolean;
  /** Captured at the replication boundary so a delayed event cannot target a new DB. */
  database?: PouchDB.Database;
  owner?: ItemContentOwner | null;
  sessionToken?: symbol | null;
};
export const songV2DocumentsChanged = createAction<SongV2DocumentChange[]>("songV2/documentsChanged");
type SongRefreshRequest = SongV2DocumentChange & { database: PouchDB.Database; owner: ItemContentOwner | null };
const songRefreshes = new Map<string, SongRefreshRequest>();
listenerMiddleware.startListening({
  actionCreator: songV2DocumentsChanged,
  effect: async (action, api) => {
    await Promise.all(action.payload.map(async (change) => {
      const database = change.database ?? db;
      if (!database || db !== database) return;
      const ownerWasCaptured = change.owner !== undefined;
      const sessionWasCaptured = change.sessionToken !== undefined;
      const databaseOwner = ownerWasCaptured ? change.owner ?? null : getActiveContentDatabaseOwner();
      if (databaseOwner && getContentDatabaseForOwner(databaseOwner) !== database) return;
      const sessionToken = change.sessionToken !== undefined
        ? change.sessionToken ?? null
        : getContentDatabaseSessionToken(database.name);
      const key = JSON.stringify([databaseOwner?.scopeId ?? "unscoped", change.songId]);
      const request: SongRefreshRequest = {
        ...change,
        libraryChanged: change.libraryChanged || !!songRefreshes.get(key)?.libraryChanged,
        database,
        owner: databaseOwner,
        ...(sessionWasCaptured ? { sessionToken } : {}),
      };
      songRefreshes.set(key, request);
      await api.delay(50);
      const ownerIsCurrent = () => {
        if (db !== database) return false;
        const currentOwner = getActiveContentDatabaseOwner();
        if (databaseOwner) {
          if (!currentOwner || currentOwner.scopeId !== databaseOwner.scopeId ||
            currentOwner.databaseKey !== databaseOwner.databaseKey ||
            currentOwner.churchId !== databaseOwner.churchId ||
            getContentDatabaseForOwner(currentOwner) !== database ||
            (databaseOwner.churchId && globalFireDbInfo?.churchId !== databaseOwner.churchId)) return false;
        } else if (currentOwner) return false;
        return getContentDatabaseSessionToken(database.name) === sessionToken;
      };
      const stillCurrent = () => ownerIsCurrent() && songRefreshes.get(key) === request;
      if (!stillCurrent()) return;
      const itemAtStart = (api.getState() as RootState).undoable.present.item;
      const itemOwner = getItemMutationOwner(itemAtStart);
      const churchIdAtStart = globalFireDbInfo.churchId;
      const mutationGuard = createSongV2MutationGuard(
        database,
        itemAtStart.contentOwner ?? databaseOwner,
        churchIdAtStart,
        sessionToken,
        () => {
          const current = (api.getState() as RootState).undoable.present.item;
          return stillCurrent() && current._id === change.songId &&
            sameItemMutationScope(itemAtStart, current) &&
            current.baseItem === itemAtStart.baseItem;
        },
      );
      try {
        const active = itemAtStart._id === change.songId && itemAtStart.type === "song";
        let snapshot: Awaited<ReturnType<typeof loadSongV2Snapshot>> | undefined;
        if (active) {
          snapshot = await loadSongV2Snapshot(database, change.songId, true);
          if (snapshot.conflicts?.length) {
            if (globalFireDbInfo.canWriteSongContent) {
              snapshot = await loadReconciledSongV2Snapshot(
                database,
                change.songId,
                snapshot,
                mutationGuard,
              );
            }
          }
        }
        if (!stillCurrent()) return;
        if (active) {
          const current = (api.getState() as RootState).undoable.present.item;
          if (current.baseItem !== itemAtStart.baseItem) {
            api.dispatch(songV2DocumentsChanged([{ ...change, libraryChanged: request.libraryChanged }]));
            return;
          }
          if (current._id !== change.songId || !sameItemMutationOwner(itemOwner, getItemMutationOwner(current))) {
            api.dispatch(allDocsSlice.actions.invalidateSongContent(change.songId));
            return;
          }
        }
        if (request.libraryChanged) {
          const projection = snapshot ? songToLibraryProjection(snapshot.hydrated)
            : await loadSongV2LibraryProjection(database, await database.get(getSongV2RootDocId(change.songId)));
          if (!stillCurrent()) return;
          api.dispatch(allDocsSlice.actions.applyItemDocumentChange({ id: projection._id, doc: projection }));
        }
        if (!request.libraryChanged) api.dispatch(allDocsSlice.actions.invalidateSongContent(change.songId));
        if (!active) return;
        if (!snapshot || !stillCurrent()) return;
        const current = (api.getState() as RootState).undoable.present.item;
        if (!sameItemMutationOwner(itemOwner, getItemMutationOwner(current)) ||
          current.baseItem !== itemAtStart.baseItem) return;
        if (snapshot.conflicts?.length) {
          api.dispatch(itemSlice.actions.bufferSongV2RevisionConflict({
            item: snapshot.hydrated,
            conflicts: snapshot.conflicts,
          }));
          return;
        }
        if (itemDocMatchesEditorState(snapshot.hydrated, current) ||
          (current.baseItem && itemDocMatchesEditorState(current.baseItem, snapshot.hydrated as ItemState))) return;
        // The reducer/middleware protects pending component input as well as
        // Redux drafts. Clean editors adopt through their existing UI handler.
        api.dispatch(itemSlice.actions.bufferRemoteItemUpdate(snapshot.hydrated));
      } catch (error) {
        if (error instanceof SongV2ReplicationConflictError && stillCurrent()) {
          const current = (api.getState() as RootState).undoable.present.item;
          if (sameItemMutationOwner(itemOwner, getItemMutationOwner(current)) && current.baseItem === itemAtStart.baseItem) {
            api.dispatch(itemSlice.actions.bufferSongV2RevisionConflict({
              item: error.snapshot.hydrated, conflicts: error.snapshot.conflicts ?? [],
            }));
          } else if (ownerIsCurrent()) {
            api.dispatch(allDocsSlice.actions.invalidateSongContent(change.songId));
          }
          return;
        }
        if (error instanceof SongV2MutationNotAuthorizedError && stillCurrent()) {
          const latest = await loadSongV2Snapshot(database, change.songId, true).catch(() => null);
          if (!stillCurrent()) return;
          const current = (api.getState() as RootState).undoable.present.item;
          if (latest?.conflicts?.length &&
            sameItemMutationOwner(itemOwner, getItemMutationOwner(current)) &&
            current.baseItem === itemAtStart.baseItem) {
            api.dispatch(itemSlice.actions.bufferSongV2RevisionConflict({
              item: latest.hydrated,
              conflicts: latest.conflicts,
            }));
          }
          return;
        }
        if (ownerIsCurrent() && (api.getState() as RootState).undoable.present.item._id !== change.songId) {
          api.dispatch(allDocsSlice.actions.invalidateSongContent(change.songId));
        }
        console.error("Could not refresh changed v2 song", change.songId, error);
      } finally {
        if (songRefreshes.get(key) === request) songRefreshes.delete(key);
      }
    }));
  },
});

// Durable cache events update the editor through the existing draft/conflict checks.
listenerMiddleware.startListening({
  predicate: isAnyOf(
    allDocsSlice.actions.updateAllSongDocs,
    allDocsSlice.actions.hydrateItemCache,
    allDocsSlice.actions.applyItemDocumentChange,
  ),
  effect: async (action, listenerApi) => {
    const state = listenerApi.getState() as RootState;
    const previousState = listenerApi.getOriginalState() as RootState;
    let currentItem = state.undoable.present.item;
    const { _id: activeId, listId } = currentItem;
    if (!activeId) return;

    const { allSongDocs, allFreeFormDocs, allTimerDocs, allBibleDocs, allServiceTimeDocs } =
      state.allDocs;
    const {
      allSongDocs: previousSongDocs,
      allFreeFormDocs: previousFreeFormDocs,
      allTimerDocs: previousTimerDocs,
      allBibleDocs: previousBibleDocs,
      allServiceTimeDocs: previousServiceTimeDocs,
    } = previousState.allDocs;
    let doc =
      allSongDocs.find((d) => d._id === activeId) ??
      allFreeFormDocs.find((d) => d._id === activeId) ??
      allTimerDocs.find((d) => d._id === activeId) ??
      allBibleDocs.find((d) => d._id === activeId) ??
      allServiceTimeDocs.find((d) => d._id === activeId);
    const previousDoc =
      previousSongDocs.find((d) => d._id === activeId) ??
      previousFreeFormDocs.find((d) => d._id === activeId) ??
      previousTimerDocs.find((d) => d._id === activeId) ??
      previousBibleDocs.find((d) => d._id === activeId) ??
      previousServiceTimeDocs.find((d) => d._id === activeId);
    let songV2Conflicts: Awaited<ReturnType<typeof loadSongV2Snapshot>>["conflicts"];

    if (doc) {
      if (doc.docType !== "song-v2-root" && _.isEqual(doc, previousDoc)) {
        return;
      }

      if (doc.docType === "song-v2-root") {
        if (!db) return;
        try {
          const projection = doc;
          const database = db;
          const snapshot = await loadSongV2Snapshot(database, activeId, true);
          doc = snapshot.hydrated;
          songV2Conflicts = snapshot.conflicts;
          const latest = listenerApi.getState() as RootState;
          const latestItem = latest.undoable.present.item;
          if (db !== database || latestItem._id !== activeId || latestItem.listId !== listId ||
            latestItem.baseItem !== currentItem.baseItem ||
            latest.allDocs.allSongDocs.find((song) => song._id === activeId) !== projection) return;
          currentItem = latestItem;
        } catch (error) {
          console.error("Could not refresh active v2 song", error);
          return;
        }
      }

      const refreshOwner = getItemMutationOwner(currentItem);
      flushPendingItemMutations(refreshOwner);
      currentItem = (listenerApi.getState() as RootState).undoable.present.item;
      if (!sameItemMutationOwner(refreshOwner, getItemMutationOwner(currentItem))) return;

      if (songV2Conflicts?.length) {
        // Replication owns authorized reconciliation. A read-only session must
        // retain the leaves and surface them without adopting a partial winner.
        if (!globalFireDbInfo.canWriteSongContent) {
          listenerApi.dispatch(itemSlice.actions.bufferSongV2RevisionConflict({
            item: doc,
            conflicts: songV2Conflicts,
          }));
        }
        return;
      }

      const docMatchesBase =
        !!currentItem.baseItem && _.isEqual(doc, currentItem.baseItem);
      const docMatchesCurrent = itemDocMatchesEditorState(doc, currentItem);
      const shouldBufferRemote =
        !!(currentItem.hasPendingUpdate || currentItem.isLyricsEditorOpen) &&
        !docMatchesBase;

      if (shouldBufferRemote) {
        if (docMatchesCurrent) {
          return;
        }
        if (!_.isEqual(doc, currentItem.pendingRemoteItem)) {
          listenerApi.dispatch(itemSlice.actions.bufferRemoteItemUpdate(doc));
        }
        return;
      }

      if (docMatchesBase && !currentItem.hasRemoteUpdate) {
        return;
      }

      if (docMatchesCurrent) {
        return;
      }

      // Preserve UI state when syncing active item from remote (DB docs don't carry slide/box selection).
      const arrIndex = Math.min(
        currentItem.selectedArrangement ?? doc.selectedArrangement ?? 0,
        Math.max(0, (doc.arrangements?.length ?? 1) - 1),
      );
      const slideCount =
        doc.type === "song" && doc.arrangements?.length
          ? (doc.arrangements[arrIndex]?.slides?.length ??
            doc.slides?.length ??
            0)
          : (doc.slides?.length ?? 0);
      listenerApi.dispatch(
        itemSlice.actions.setActiveItem({
          ...doc,
          listId,
          selectedSlide: Math.min(
            currentItem.selectedSlide ?? 0,
            Math.max(0, slideCount - 1),
          ),
          selectedBox: currentItem.selectedBox ?? 1,
          selectedArrangement: arrIndex,
        }),
      );
    }
  },
});

listenerMiddleware.startListening({
  predicate: (_, current, previous) =>
    (current as RootState).allDocs.allTimerDocs !== (previous as RootState).allDocs.allTimerDocs,
  effect: (_, listenerApi) => {
    const documents = (listenerApi.getState() as RootState).allDocs.allTimerDocs;
    const previousState = listenerApi.getOriginalState() as RootState;
    const timersFromDocs = documents
      .map((doc) => {
        if (!doc.timerInfo) return undefined;
        return {
          ...doc.timerInfo,
          id: doc.timerInfo.id || doc._id,
          name: doc.timerInfo.name || doc.name,
        };
      })
      .filter((timer): timer is TimerInfo => timer !== undefined);
    const knownDocIds = Array.from(
      new Set([
        ...previousState.allDocs.allTimerDocs.map((doc) => doc._id),
        ...documents.map((doc) => doc._id),
      ]),
    );

    listenerApi.dispatch(
      reconcileTimersFromDocs({ timers: timersFromDocs, knownDocIds }),
    );
  },
});

// When opening a timer item, ensure its timer is in the timers slice (for Demo and when timer was created elsewhere)
listenerMiddleware.startListening({
  actionCreator: itemSlice.actions.setActiveItem,
  effect: (action, listenerApi) => {
    const state = listenerApi.getState() as RootState;
    const item = state.undoable.present.item;
    if (item.type !== "timer" || !item.timerInfo) return;
    listenerApi.dispatch(
      syncTimers([
        {
          ...item.timerInfo,
          id: item.timerInfo.id || item._id,
          name: item.timerInfo.name || item.name,
        },
      ]),
    );
  },
});

listenerMiddleware.startListening({
  predicate: isAnyOf(
    timersSlice.actions.updateTimer,
    timersSlice.actions.updateTimerColor,
  ),
  effect: (action, listenerApi) => {
    const state = listenerApi.getState() as RootState;
    const item = state.undoable.present.item;
    if (item.type !== "timer" || !item.timerInfo) return;

    const activeTimerId = item.timerInfo.id || item._id;
    const updatedTimerId = (action.payload as { id?: string })?.id;
    if (!updatedTimerId || updatedTimerId !== activeTimerId) return;

    const timer = state.timers.timers.find((t) => t.id === activeTimerId);
    if (!timer) return;

    listenerApi.dispatch(itemSlice.actions._updateTimerInfo(timer));
  },
});

listenerMiddleware.startListening({
  predicate: isAnyOf(
    timersSlice.actions.addTimer,
    timersSlice.actions.syncTimers,
    timersSlice.actions.updateTimerFromRemote,
    timersSlice.actions.tickTimers,
  ),
  effect: (_action, listenerApi) => {
    const state = listenerApi.getState() as RootState;
    const item = state.undoable.present.item;
    if (item.type !== "timer" || !item.timerInfo) return;

    const activeTimerId = item.timerInfo.id || item._id;
    const timer = state.timers.timers.find((t) => t.id === activeTimerId);
    if (!timer) return;

    listenerApi.dispatch(itemSlice.actions.syncLiveTimerInfo(timer));
  },
});

const pendingBibleCleanupByDatabase = new WeakMap<object, Set<string>>();
const inFlightOutlinePersistenceByDatabase = new WeakMap<object, number>();
const bibleCleanupOpportunity = createAction<{ immediate?: boolean }>(
  "bibleCleanup/opportunity",
);
const INITIAL_BIBLE_RECONCILIATION_DELAY_MS = 1500;
type BibleCleanupSessionState = {
  status: "pending" | "complete";
  notBefore: number;
};
const bibleCleanupSessions = new WeakMap<object, Map<symbol, BibleCleanupSessionState>>();
const dueBibleCleanupRetries = new WeakMap<object, Set<symbol>>();

const noteRemovedBibleOutlineItem = (
  database: object | undefined,
  outlineId: string | undefined,
  previousItems: Array<{ _id: string; type?: string }>,
  nextItems: Array<{ _id: string; type?: string }>,
) => {
  if (!database || !outlineId) return;
  const nextBibleIds = new Set(
    nextItems.filter((item) => item.type === "bible").map((item) => item._id),
  );
  const removedBible = previousItems.some(
    (item) => item.type === "bible" && !nextBibleIds.has(item._id),
  );
  if (!removedBible) return;
  const pending = pendingBibleCleanupByDatabase.get(database) ?? new Set<string>();
  pending.add(outlineId);
  pendingBibleCleanupByDatabase.set(database, pending);
};

const hasPendingBibleCleanup = (database: object, outlineId: string) =>
  pendingBibleCleanupByDatabase.get(database)?.has(outlineId) ?? false;

const beginOutlinePersistence = (database: object) => {
  inFlightOutlinePersistenceByDatabase.set(
    database,
    (inFlightOutlinePersistenceByDatabase.get(database) ?? 0) + 1,
  );
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const count = inFlightOutlinePersistenceByDatabase.get(database) ?? 0;
    if (count <= 1) inFlightOutlinePersistenceByDatabase.delete(database);
    else inFlightOutlinePersistenceByDatabase.set(database, count - 1);
  };
};

const isOutlinePersistenceIdle = (database: object) =>
  (inFlightOutlinePersistenceByDatabase.get(database) ?? 0) === 0;

const getBibleCleanupSessionStates = (database: object) => {
  const sessions = bibleCleanupSessions.get(database) ?? new Map();
  bibleCleanupSessions.set(database, sessions);
  return sessions;
};

const getDueBibleCleanupRetries = (database: object) => {
  const due = dueBibleCleanupRetries.get(database) ?? new Set<symbol>();
  dueBibleCleanupRetries.set(database, due);
  return due;
};

const scheduleBibleCleanupAttempt = (
  database: PouchDB.Database,
  sessionToken: symbol,
  cacheSession: number,
  delayMs: number,
) => {
  scheduleBibleItemCleanupRetry(database, sessionToken, delayMs, () => {
    const currentState = store.getState() as RootState;
    if (
      db !== database ||
      getContentDatabaseSessionToken(database.name) !== sessionToken ||
      currentState.allDocs.session !== cacheSession
    ) {
      return;
    }
    getDueBibleCleanupRetries(database).add(sessionToken);
    store.dispatch(bibleCleanupOpportunity({ immediate: true }));
  });
};

listenerMiddleware.startListening({
  actionCreator: bibleCleanupOpportunity,
  effect: async (action, listenerApi) => {
    const database = db;
    if (!database) return;

    const sessionStates = getBibleCleanupSessionStates(database);
    const dueRetries = getDueBibleCleanupRetries(database);
    const sessionToken = getContentDatabaseSessionToken(database.name);
    for (const staleToken of sessionStates.keys()) {
      if (staleToken === sessionToken) continue;
      cancelBibleItemCleanupRetry(database, staleToken);
      sessionStates.delete(staleToken);
      dueRetries.delete(staleToken);
    }
    if (
      !sessionToken ||
      !hasSuccessfulInitialContentReplication(database.name, sessionToken)
    ) {
      return;
    }

    const stateAtStart = listenerApi.getState() as RootState;
    if (
      !stateAtStart.allDocs.isInitialized ||
      stateAtStart.allDocs.error !== null
    ) {
      if (sessionToken) {
        cancelBibleItemCleanupRetry(database, sessionToken);
        sessionStates.delete(sessionToken);
        dueRetries.delete(sessionToken);
      }
      return;
    }

    let sessionState = sessionStates.get(sessionToken);
    if (!sessionState) {
      sessionState = {
        status: "pending",
        notBefore: Date.now() + INITIAL_BIBLE_RECONCILIATION_DELAY_MS,
      };
      sessionStates.set(sessionToken, sessionState);
      scheduleBibleCleanupAttempt(
        database,
        sessionToken,
        stateAtStart.allDocs.session,
        INITIAL_BIBLE_RECONCILIATION_DELAY_MS,
      );
    }

    const pendingOutlineCleanup =
      (pendingBibleCleanupByDatabase.get(database)?.size ?? 0) > 0;
    const retryIsDue = dueRetries.has(sessionToken);
    if (
      sessionState.status === "complete" &&
      !pendingOutlineCleanup &&
      !retryIsDue
    ) {
      return;
    }
    if (
      !retryIsDue &&
      !action.payload.immediate &&
      Date.now() < sessionState.notBefore
    ) {
      return;
    }

    const cacheSession = stateAtStart.allDocs.session;
    const cacheChangeVersion = stateAtStart.allDocs.changeVersion;
    let cleanupWasBlockedByOutlinePersistence = false;
    const cleanupResult = await deleteUnusedBibleItems({
      db: database,
      bibleItems: stateAtStart.allDocs.allBibleDocs,
      canRun: () => {
        const currentState = listenerApi.getState() as RootState;
        const currentPresent = currentState.undoable.present;
        const syncStatus = currentState.servicePlanningImport.sync.status;
        const hasPendingWrites =
          currentPresent.item.hasPendingUpdate ||
          currentPresent.itemList.hasPendingUpdate ||
          hasPendingOutlineDraftsForDatabase(currentPresent.itemList.pendingByOutline, database) ||
          Object.values(currentState.autosaveIndicator.debouncedSaveDepth).some(
            (depth) => depth > 0,
          ) ||
          itemAutosaveDebounces.size > 0 ||
          itemAutosaveWriteQueues.size > 0 ||
          pendingItemAutosaves.size > 0;
        const presenceScope = getControllerPresenceScope(
          globalFireDbInfo.churchId,
          globalFireDbInfo.database,
        );
        const outlinePersistenceIdle = isOutlinePersistenceIdle(database);
        if (!outlinePersistenceIdle) {
          cleanupWasBlockedByOutlinePersistence = true;
        }
        return (
          db === database &&
          getContentDatabaseSessionToken(database.name) === sessionToken &&
          hasSuccessfulInitialContentReplication(database.name, sessionToken) &&
          currentState.allDocs.isInitialized &&
          currentState.allDocs.error === null &&
          currentState.allDocs.session === cacheSession &&
          currentState.allDocs.changeVersion === cacheChangeVersion &&
          currentPresent.itemList.isInitialized &&
          currentPresent.itemLists.isInitialized &&
          !hasPendingWrites &&
          outlinePersistenceIdle &&
          syncStatus !== "running" &&
          syncStatus !== "cancelling" &&
          isContentReplicationIdle(database.name) &&
          isBibleDocumentActivityIdle(database.name) &&
          globalFireDbInfo.isConnected === true &&
          isOnlyActiveController(presenceScope, globalHostId) &&
          !listenerApi.signal.aborted
        );
      },
    });

    if (db !== database || getContentDatabaseSessionToken(database.name) !== sessionToken) {
      return;
    }
    if (cleanupResult === null) {
      // A persistence completion can dispatch while an earlier cleanup attempt
      // is still unwinding. Recheck after that attempt releases its per-db guard.
      if (
        cleanupWasBlockedByOutlinePersistence &&
        isOutlinePersistenceIdle(database) &&
        !listenerApi.signal.aborted
      ) {
        listenerApi.dispatch(bibleCleanupOpportunity({ immediate: true }));
      }
      return;
    }

    sessionState.status = "complete";
    pendingBibleCleanupByDatabase.delete(database);
    dueRetries.delete(sessionToken);
    if (cleanupResult.retryAfterMs !== null) {
      scheduleBibleCleanupAttempt(
        database,
        sessionToken,
        cacheSession,
        cleanupResult.retryAfterMs,
      );
    } else {
      cancelBibleItemCleanupRetry(database, sessionToken);
    }
  },
});

listenerMiddleware.startListening({
  matcher: isAnyOf(
    allDocsSlice.actions.hydrateItemCache,
    allDocsSlice.actions.applyItemDocumentChange,
    allDocsSlice.actions.resetItemCache,
    allDocsSlice.actions.setItemCacheError,
    itemSlice.actions.setHasPendingUpdate,
    itemSlice.actions.markItemPersisted,
    itemListSlice.actions.initiateItemList,
    itemListSlice.actions.setIsInitialized,
    itemListSlice.actions.setHasPendingUpdate,
    itemListsSlice.actions.initiateItemLists,
    itemListsSlice.actions.setIsInitialized,
    autosaveIndicatorSlice.actions.endKeyedDebouncedSave,
    servicePlanningImportSlice.actions.completeServicePlanningSync,
    servicePlanningImportSlice.actions.failServicePlanningSync,
    servicePlanningImportSlice.actions.finishServicePlanningSyncCancellation,
    servicePlanningImportSlice.actions.clearServicePlanningSyncState,
  ),
  effect: (_action, listenerApi) => {
    listenerApi.dispatch(bibleCleanupOpportunity({}));
  },
});

// handle ItemList updates
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    const state = (currentState as RootState).undoable.present.itemList;
    const previous = (previousState as RootState).undoable.present.itemList;
    const outlineOwnerChanged = state.outlineOwnerKey !== previous.outlineOwnerKey;
    const savingOutgoingOutline = !isStoreResetAction(action) &&
      (outlineOwnerChanged || itemListsSlice.actions.selectItemList.match(action)) &&
      previous.isInitialized && previous.hasPendingUpdate;
    // Don't save until initialization is complete
    if (!state.isInitialized && !savingOutgoingOutline) return false;

    const excluded = isAnyOf(
      itemListSlice.actions.initiateItemList,
      itemListSlice.actions.setItemListIsLoading,
      itemListSlice.actions.setActiveItemInList,
      itemListSlice.actions.setHasPendingUpdate,
      itemListSlice.actions.acknowledgeOutlineSave,
      itemListSlice.actions.addToInitialItems,
      itemListSlice.actions.setIsInitialized,
      itemListSlice.actions.markItemListPersisted,
      itemListSlice.actions.recordOutlineConflict,
      itemListSlice.actions.retryItemListLoad,
      itemListSlice.actions.setItemListLoadError,
      itemListSlice.actions.setItemListIsRetrying,
    );
    const itemListChanged =
      (currentState as RootState).undoable.present.itemList !==
      (previousState as RootState).undoable.present.itemList;
    const selectedId = (currentState as RootState).undoable.present.itemLists.selectedList?._id;
    const hasOutlineConflict = Boolean(
      selectedId && state.remoteConflicts?.[selectedId] &&
      !state.remoteConflicts[selectedId].resolutionChoice,
    );
    const restoringResolution = itemListSlice.actions.initiateItemList.match(action) &&
      Boolean(selectedId && state.remoteConflicts?.[selectedId]?.resolutionChoice);
    const restoringDraft = itemListSlice.actions.initiateItemList.match(action) && state.hasPendingUpdate;
    const outgoingHasConflict = Boolean(
      (previousState as RootState).undoable.present.itemLists.selectedList?._id &&
      (previousState as RootState).undoable.present.itemList.remoteConflicts?.[
        (previousState as RootState).undoable.present.itemLists.selectedList!._id
      ] && !(previousState as RootState).undoable.present.itemList.remoteConflicts[
        (previousState as RootState).undoable.present.itemLists.selectedList!._id
      ].resolutionChoice,
    );
    if (
      itemListChanged &&
      !outlineOwnerChanged &&
      !excluded(action) &&
      !isStoreResetAction(action)
    ) {
      const currentPresent = (currentState as RootState).undoable.present;
      const previousPresent = (previousState as RootState).undoable.present;
      noteRemovedBibleOutlineItem(
        db,
        currentPresent.itemLists.selectedList?._id ??
          previousPresent.itemLists.selectedList?._id,
        previousPresent.itemList.list,
        currentPresent.itemList.list,
      );
    }
    return (
      ((itemListChanged || itemListSlice.actions.forceUpdate.match(action)) &&
      (!excluded(action) || restoringResolution || restoringDraft) &&
      !!(currentState as RootState).undoable.present.itemList
        .hasPendingUpdate &&
      !hasOutlineConflict &&
      !isStoreResetAction(action)) ||
      (savingOutgoingOutline && !outgoingHasConflict)
    );
  },

  effect: async (action, listenerApi) => {
    const originalPresent = (listenerApi.getOriginalState() as RootState).undoable.present;
    const isSavingOutgoingOutline = originalPresent.itemList.outlineOwnerKey !==
      (listenerApi.getState() as RootState).undoable.present.itemList.outlineOwnerKey &&
      originalPresent.itemList.hasPendingUpdate && originalPresent.itemList.isInitialized;
    const dbAtStart = isSavingOutgoingOutline
      ? (action as OutlineDatabaseAction).meta?.outgoingOutlineDatabase ?? db
      : db;
    const churchAtStart = globalFireDbInfo?.churchId;
    const sessionAtStart = outlineAccountSession;
    const sessionIsCurrent = () => sessionAtStart === outlineAccountSession;

    listenerApi.cancelActiveListeners();
    if (!isSavingOutgoingOutline) {
      await listenerApi.delay(1500);
    }

    // Always read post-debounce state so we never persist a closed-over
    // pre-delay snapshot after remote hydrate or a newer local edit.
    const present = (isSavingOutgoingOutline
      ? originalPresent
      : (listenerApi.getState() as RootState).undoable.present);
    const { list, hasPendingUpdate, isInitialized } = present.itemList;
    const ownerKey = present.itemList.outlineOwnerKey;
    const lifecycleLease = ownerKey ? getOutlineContentLifecycleLease(ownerKey) : undefined;
    const lifecycleAllowsPublish = () => lifecycleLease === undefined ||
      isOutlineContentLifecycleLeaseCurrent(ownerKey!, lifecycleLease);
    const { selectedList } = present.itemLists;
    const baseline = present.itemList.syncBaseline ?? [];
    const loadedOutlineId = present.itemList.loadedOutlineId;
    const outgoingConflict = Boolean(
      selectedList && present.itemList.remoteConflicts?.[selectedList._id] &&
      !present.itemList.remoteConflicts[selectedList._id].resolutionChoice,
    );
    const submittedConflict = selectedList && present.itemList.remoteConflicts?.[selectedList._id];
    const conflictReviewIsCurrent = () => {
      const current = (listenerApi.getState() as RootState).undoable.present.itemList.remoteConflicts?.[selectedList!._id];
      return !current || (_.isEqual(current.revisionConflict, submittedConflict?.revisionConflict) &&
        _.isEqual(current.remoteItems, submittedConflict?.remoteItems) && current.resolutionChoice === submittedConflict?.resolutionChoice);
    };

    if (
      !dbAtStart ||
      !sessionIsCurrent() ||
      (!isSavingOutgoingOutline && (db !== dbAtStart || globalFireDbInfo?.churchId !== churchAtStart)) ||
      !isInitialized ||
      !hasPendingUpdate ||
      !selectedList ||
      (loadedOutlineId && loadedOutlineId !== selectedList._id) ||
      outgoingConflict
    ) {
      return;
    }

    const revisionResolution = present.itemList.pendingRevisionResolutions?.[selectedList._id];
    const submittedItems = revisionResolution?.items ?? list;
    const submittedMoveIntents = present.itemList.pendingMoveIntents ?? [];
    const releaseOutlinePersistence = beginOutlinePersistence(dbAtStart);
    let persistenceSucceeded = false;
    try {
      const persisted = revisionResolution?.conflict
        ? await resolveServiceListRevisionConflict(
            dbAtStart,
            selectedList._id,
            [...submittedItems],
            revisionResolution.conflict,
            revisionResolution.selection,
            sessionIsCurrent,
          )
        : await persistServiceListItems(
            dbAtStart,
            selectedList._id,
            [...submittedItems],
            [...baseline],
            sessionIsCurrent,
            [...submittedMoveIntents],
          );

      persistenceSucceeded = true;
      if (ownerKey) listenerApi.dispatch(itemListSlice.actions.acknowledgeOutlineSave({ ownerKey, list }));
      if (!sessionIsCurrent() || (!isSavingOutgoingOutline && (db !== dbAtStart || globalFireDbInfo?.churchId !== churchAtStart))) return;
      const afterPutState = (listenerApi.getState() as RootState).undoable.present;
      const afterPut = afterPutState.itemList;
      if (conflictReviewIsCurrent() && (!afterPut.loadedOutlineId || afterPut.loadedOutlineId === selectedList._id || afterPut.remoteConflicts?.[selectedList._id]?.resolutionChoice)) {
        listenerApi.dispatch(itemListSlice.actions.markItemListPersisted({
          outlineId: selectedList._id,
          ownerKey,
          items: [...persisted.items],
          submittedItems: [...(revisionResolution?.draftItems ?? submittedItems)],
          submittedMoveIntents: [...submittedMoveIntents],
        }));
        const latest = (listenerApi.getState() as RootState).undoable.present;
        if (revisionResolution && latest.itemList.loadedOutlineId === selectedList._id &&
          latest.itemLists.selectedList?._id === selectedList._id && latest.itemList.hasPendingUpdate &&
          !latest.itemList.remoteConflicts[selectedList._id]) {
          // Save edits made after the preview as an ordinary mutation, once
          // the reviewed choices have been acknowledged and retired safely.
          listenerApi.dispatch(itemListSlice.actions.forceUpdate());
        }
      }
      listenerApi.throwIfCancelled();
      if (!lifecycleAllowsPublish()) return;
      // Returning to a retained draft can require a retry as well as the
      // outgoing save. Start both through the existing field save lane.
      if (isSavingOutgoingOutline && (listenerApi.getState() as RootState).undoable.present.itemList.hasPendingUpdate) {
        listenerApi.dispatch(itemListSlice.actions.forceUpdate());
      }

      safePostMessage({
        type: "update",
        data: {
          docs: persisted,
          hostId: globalHostId,
        },
      });

    } catch (error) {
      if (!sessionIsCurrent()) return;
      if (isListenerCancelledTaskError(error)) return;
      if (!conflictReviewIsCurrent()) return;
      if (error instanceof ServiceListConflictError) {
        if (db === dbAtStart && selectedList) {
          listenerApi.dispatch(itemListSlice.actions.recordOutlineConflict({
            outlineId: selectedList._id,
            baselineItems: [...baseline],
            localItems: [...list],
            remoteItems: error.remoteItems,
            ...(error.revisionConflict
              ? { revisionConflict: error.revisionConflict }
              : {}),
            ...(submittedMoveIntents.length ? { moveIntents: [...submittedMoveIntents] } : {}),
          }));
        }
      } else if (db === dbAtStart) {
        listenerApi.dispatch(itemListSlice.actions.failOutlineResolution(selectedList._id));
      }
      console.error("Failed to persist item list outline:", error);
    } finally {
      releaseOutlinePersistence();
      const pendingBibleCleanup = hasPendingBibleCleanup(
        dbAtStart,
        selectedList._id,
      );
      if (
        db === dbAtStart &&
        globalFireDbInfo?.churchId === churchAtStart &&
        (persistenceSucceeded || !pendingBibleCleanup)
      ) {
        listenerApi.dispatch(
          bibleCleanupOpportunity({
            immediate: persistenceSucceeded && pendingBibleCleanup,
          }),
        );
      }
    }
  },
});

// Registry runtimes outlive controller mounts. Failed intents remain bound to
// their account/church/database owner and can be rebound to a fresh Pouch
// handle for that same account after teardown.
type RegistryQueueBinding = {
  database: object;
  sessionToken: symbol | null;
  accountId?: string;
  queue: ItemListsRegistryQueue;
};
const pendingRegistryQueuesByOwner = new Map<string, RegistryQueueBinding>();
let pendingRegistryQueuesByDb = new WeakMap<object, ItemListsRegistryQueue>();
const pendingRegistryQueues = new Set<ItemListsRegistryQueue>();
const releaseIdleRegistryQueue = (
  ownerKey: string | undefined,
  database: object,
  queue: ItemListsRegistryQueue,
) => {
  if (queue.hasPendingChanges) return;
  if (ownerKey) {
    if (pendingRegistryQueuesByOwner.get(ownerKey)?.queue === queue) {
      pendingRegistryQueuesByOwner.delete(ownerKey);
    }
  } else {
    pendingRegistryQueuesByDb.delete(database);
  }
  pendingRegistryQueues.delete(queue);
};

const retirePendingRegistryQueuesForOtherAccounts = (accountId: string) => {
  for (const [ownerKey, binding] of pendingRegistryQueuesByOwner) {
    if (binding.accountId === accountId) continue;
    binding.queue.retire();
    pendingRegistryQueues.delete(binding.queue);
    pendingRegistryQueuesByOwner.delete(ownerKey);
  }
};

const retireAllPendingRegistryQueues = () => {
  pendingRegistryQueues.forEach((queue) => queue.retire());
  pendingRegistryQueues.clear();
  pendingRegistryQueuesByOwner.clear();
  pendingRegistryQueuesByDb = new WeakMap<object, ItemListsRegistryQueue>();
};

listenerMiddleware.startListening({
  predicate: (action) => action.type === "RESET",
  effect: () => retireAllPendingRegistryQueues(),
});

const snapshotItemListsRegistry = (
  state: RootState["undoable"]["present"]["itemLists"],
) => ({
  currentLists: state.currentLists.map((item) => ({ ...item })),
  activeList: state.activeList ? { ...state.activeList } : undefined,
});

listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    if (isAnyOf(itemListsSlice.actions.retryRegistrySave, itemListsSlice.actions.keepRegistryChanges)(action)) return true;
    if (itemListsSlice.actions.initiateItemLists.match(action)) {
      return Boolean(db);
    }
    const state = (currentState as RootState).undoable.present.itemLists;
    if (!state.isInitialized || isStoreResetAction(action)) return false;
    const previous = (previousState as RootState).undoable.present.itemLists;
    if (state === previous) return false;
    const excluded = isAnyOf(
      itemListsSlice.actions.setInitialItemList, itemListsSlice.actions.initiateItemLists,
      itemListsSlice.actions.restorePendingRegistryChanges,
      itemListsSlice.actions.updateItemListsFromRemote,
      itemListsSlice.actions.setIsInitialized, itemListsSlice.actions.setOutlineScope,
      itemListsSlice.actions.setRegistrySaveState,
    );
    return !excluded(action) && !_.isEqual(snapshotItemListsRegistry(previous), snapshotItemListsRegistry(state));
  },
  effect: async (action, listenerApi) => {
    const dbAtStart = db;
    if (!dbAtStart) return;
    const ownerAtStart = getActiveContentDatabaseOwner();
    if (ownerAtStart && getContentDatabaseForOwner(ownerAtStart) !== dbAtStart) return;
    const sessionTokenAtStart = getContentDatabaseSessionToken(dbAtStart.name);
    const ownerKey = ownerAtStart?.scopeId;
    if (ownerAtStart?.accountId) {
      retirePendingRegistryQueuesForOtherAccounts(ownerAtStart.accountId);
    }
    const isOwnerCurrent = () => {
      if (db !== dbAtStart) return false;
      if (ownerAtStart) {
        const currentOwner = getActiveContentDatabaseOwner();
        if (!currentOwner || currentOwner.scopeId !== ownerAtStart.scopeId ||
          currentOwner.databaseKey !== ownerAtStart.databaseKey ||
          currentOwner.churchId !== ownerAtStart.churchId ||
          getContentDatabaseForOwner(currentOwner) !== dbAtStart ||
          (ownerAtStart.churchId && globalFireDbInfo?.churchId !== ownerAtStart.churchId)) return false;
      } else if (getActiveContentDatabaseOwner()) {
        return false;
      }
      return !sessionTokenAtStart ||
        getContentDatabaseSessionToken(dbAtStart.name) === sessionTokenAtStart;
    };
    const saved = (document: DBItemLists) => {
      if (!isOwnerCurrent()) return;
      listenerApi.dispatch(itemListsSlice.actions.updateItemListsFromRemote({
        itemLists: document.itemLists ?? [],
        activeListId: document.activeList?._id,
      }));
      safePostMessage({ type: "update", data: { docs: document, hostId: globalHostId } });
    };
    const publishStatus = (status: Parameters<typeof itemListsSlice.actions.setRegistrySaveState>[0]) => {
      if (isOwnerCurrent()) listenerApi.dispatch(itemListsSlice.actions.setRegistrySaveState(status));
    };
    const binding = ownerKey ? pendingRegistryQueuesByOwner.get(ownerKey) : undefined;
    let queue = ownerKey ? binding?.queue : pendingRegistryQueuesByDb.get(dbAtStart);
    if (!queue) {
      queue = new ItemListsRegistryQueue(dbAtStart, saved, publishStatus);
      pendingRegistryQueues.add(queue);
    } else if (ownerKey && binding &&
      (binding.database !== dbAtStart || binding.sessionToken !== sessionTokenAtStart)) {
      queue.rebind(dbAtStart, saved, publishStatus);
    }
    if (ownerKey) {
      pendingRegistryQueuesByOwner.set(ownerKey, {
        database: dbAtStart,
        sessionToken: sessionTokenAtStart,
        accountId: ownerAtStart?.accountId,
        queue,
      });
    } else {
      pendingRegistryQueuesByDb.set(dbAtStart, queue);
    }
    if (itemListsSlice.actions.initiateItemLists.match(action)) {
      const pending = queue.pendingIntents;
      if (pending.length) {
        listenerApi.dispatch(itemListsSlice.actions.restorePendingRegistryChanges(pending));
      }
      if (db === dbAtStart) listenerApi.dispatch(itemListsSlice.actions.setRegistrySaveState(queue.state));
      if (pending.length && queue.state.status !== "error") {
        void queue.flush().finally(() => releaseIdleRegistryQueue(ownerKey, dbAtStart, queue));
      } else if (!pending.length) {
        releaseIdleRegistryQueue(ownerKey, dbAtStart, queue);
      }
      return;
    }
    if (itemListsSlice.actions.retryRegistrySave.match(action)) {
      await queue.flush(true);
      releaseIdleRegistryQueue(ownerKey, dbAtStart, queue);
      return;
    }
    if (itemListsSlice.actions.keepRegistryChanges.match(action)) {
      await queue.flush(true, true);
      releaseIdleRegistryQueue(ownerKey, dbAtStart, queue);
      return;
    }
    const rootBefore = listenerApi.getOriginalState() as RootState;
    const rootAfter = listenerApi.getState() as RootState;
    const debounceGeneration = queue.enqueue({
      before: snapshotItemListsRegistry(rootBefore.undoable.present.itemLists),
      after: snapshotItemListsRegistry(rootAfter.undoable.present.itemLists),
    });
    listenerApi.dispatch(autosaveIndicatorSlice.actions.beginKeyedDebouncedSave(AUTOSAVE_DEBOUNCE_KEYS.itemLists));
    try {
      // Cancellation owns only this debounce; a started database queue runs to
      // completion independently and never submits the same entry twice.
      listenerApi.cancelActiveListeners();
      await listenerApi.delay(1500);
      if (queue.currentGeneration === debounceGeneration) await queue.flush();
    } catch (error) {
      if (!isListenerCancelledTaskError(error)) console.error("Outline list save failed:", error);
    } finally {
      listenerApi.dispatch(autosaveIndicatorSlice.actions.endKeyedDebouncedSave(AUTOSAVE_DEBOUNCE_KEYS.itemLists));
      releaseIdleRegistryQueue(ownerKey, dbAtStart, queue);
    }
  },
});

// handle updating overlay
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    const excluded = isAnyOf(
      overlaySlice.actions.setHasPendingUpdate,
      overlaySlice.actions.setIsOverlayLoading,
      overlaySlice.actions.markOverlayPersisted,
      overlaySlice.actions.bufferRemoteOverlayUpdate,
      overlaySlice.actions.markOverlayDraftPending,
      overlaySlice.actions.clearOverlayDraftPending,
    );
    return (
      (currentState as RootState).undoable.present.overlay !==
        (previousState as RootState).undoable.present.overlay &&
      !excluded(action) &&
      !isStoreResetAction(action) &&
      !!(currentState as RootState).undoable.present.overlay.hasPendingUpdate
    );
  },

  effect: async (action, listenerApi) => {
    const dbAtStart = db;
    if (!dbAtStart) return;
    const persistOutgoingSelection =
      overlaySlice.actions.selectOverlay.match(action);

    listenerApi.cancelActiveListeners();
    if (!persistOutgoingSelection) {
      await listenerApi.delay(1500);
    }

    if (db !== dbAtStart) return;

    if (
      !(listenerApi.getState() as RootState).undoable.present.overlay
        .hasPendingUpdate
    ) {
      return;
    }

    const readOverlayToPersist = (): OverlayInfo | undefined => {
      if (persistOutgoingSelection) {
        return (listenerApi.getOriginalState() as RootState).undoable.present
          .overlay.selectedOverlay;
      }
      return (listenerApi.getState() as RootState).undoable.present.overlay
        .selectedOverlay;
    };

    let overlayToPersist = readOverlayToPersist();

    if (!overlayToPersist?.id) {
      listenerApi.throwIfCancelled();
      listenerApi.dispatch(overlaySlice.actions.setHasPendingUpdate(false));
      return;
    }
    listenerApi.throwIfCancelled();
    overlayToPersist = readOverlayToPersist();
    if (!overlayToPersist?.id) {
      listenerApi.dispatch(overlaySlice.actions.setHasPendingUpdate(false));
      return;
    }

    let persisted: DBOverlay | undefined;
    try {
      persisted = await listenerApi.pause(
        persistExistingOverlayDoc(dbAtStart, overlayToPersist),
      );
    } catch (e) {
      if (isListenerCancelledTaskError(e)) {
        return;
      }
      console.error("overlay persist failed", e);
      throw e;
    }

    if (!persisted) {
      listenerApi.dispatch(overlaySlice.actions.setHasPendingUpdate(false));
      return;
    }

    listenerApi.throwIfCancelled();
    if (db !== dbAtStart) return;
    listenerApi.dispatch(overlaySlice.actions.setHasPendingUpdate(false));
    listenerApi.dispatch(
      overlaySlice.actions.markOverlayPersisted(
        normalizeOverlayForSync(persisted),
      ),
    );
  },
});

// handle updating overlays
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    const excluded = isAnyOf(
      overlaysSlice.actions.initiateOverlayList,
      overlaysSlice.actions.updateOverlayListFromRemote,
      overlaysSlice.actions.updateOverlaysByIdFromRemote,
      overlaysSlice.actions.setHasPendingUpdate,
      overlaysSlice.actions.acknowledgeOutlineSave,
      overlaysSlice.actions.updateInitialList,
      overlaysSlice.actions.addToInitialList,
      overlaysSlice.actions.mergeOverlayHistoryFromDb,
      overlaysSlice.actions.deleteOverlayHistoryEntry,
      overlaysSlice.actions.updateOverlayHistoryEntry,
      overlaysSlice.actions.mergeOverlayIntoHistory,
    );
    const overlaysChanged =
      (currentState as RootState).undoable.present.overlays !==
      (previousState as RootState).undoable.present.overlays;
    const savingOutgoingOutline =
      !isStoreResetAction(action) &&
      (currentState as RootState).undoable.present.overlays.outlineOwnerKey !==
        (previousState as RootState).undoable.present.overlays.outlineOwnerKey &&
      !!(previousState as RootState).undoable.present.overlays.hasPendingUpdate;
    return (
      (((overlaysChanged || overlaysSlice.actions.forceUpdate.match(action)) &&
      !excluded(action) &&
      !!(currentState as RootState).undoable.present.overlays
        .hasPendingUpdate &&
      !isStoreResetAction(action)) || savingOutgoingOutline)
    );
  },

  effect: async (action, listenerApi) => {
    const originalState = listenerApi.getOriginalState() as RootState;
    const isSavingOutgoingOutline = originalState.undoable.present.overlays.outlineOwnerKey !==
      (listenerApi.getState() as RootState).undoable.present.overlays.outlineOwnerKey &&
      originalState.undoable.present.overlays.hasPendingUpdate;
    const dbAtStart = isSavingOutgoingOutline
      ? (action as OutlineDatabaseAction).meta?.outgoingOutlineDatabase ?? db
      : db;
    if (!dbAtStart) return;
    const sessionAtStart = outlineAccountSession;
    const sessionIsCurrent = () => sessionAtStart === outlineAccountSession;
    const churchAtStart = globalFireDbInfo?.churchId;
    listenerApi.cancelActiveListeners();
    if (!isSavingOutgoingOutline) {
      await listenerApi.delay(1500);
    }

    if (!sessionIsCurrent() || (!isSavingOutgoingOutline && (db !== dbAtStart || globalFireDbInfo?.churchId !== churchAtStart))) return;
    const state = isSavingOutgoingOutline
      ? originalState
      : (listenerApi.getState() as RootState);
    if (
      !isSavingOutgoingOutline &&
      !state.undoable.present.overlays.hasPendingUpdate
    ) {
      return;
    }
    const { list } = state.undoable.present.overlays;
    const ownerKey = state.undoable.present.overlays.outlineOwnerKey;
    const lifecycleLease = ownerKey ? getOutlineContentLifecycleLease(ownerKey) : undefined;
    const lifecycleAllowsPublish = () => lifecycleLease === undefined ||
      isOutlineContentLifecycleLeaseCurrent(ownerKey!, lifecycleLease);
    const { selectedList } = state.undoable.present.itemLists;

    if (!selectedList) return;
    const listId = selectedList._id;
    const releaseOutlinePersistence = beginOutlinePersistence(dbAtStart);
    try {
      const saving = persistServiceListOverlays(
        dbAtStart,
        listId,
        list.map((overlay) => overlay.id),
        sessionIsCurrent,
      );
      if (isSavingOutgoingOutline && (listenerApi.getState() as RootState).undoable.present.overlays.hasPendingUpdate) {
        listenerApi.dispatch(overlaysSlice.actions.forceUpdate());
      }
      const persisted = await saving;
      if (!persisted) return;

      if (ownerKey) listenerApi.dispatch(overlaysSlice.actions.acknowledgeOutlineSave({ ownerKey, list }));
      if (!sessionIsCurrent() || (!isSavingOutgoingOutline && (db !== dbAtStart || globalFireDbInfo?.churchId !== churchAtStart))) return;
      const latest = (listenerApi.getState() as RootState).undoable.present;
      if (latest.overlays.outlineOwnerKey !== ownerKey || latest.overlays.list !== list) return;
      listenerApi.throwIfCancelled();
      if (!lifecycleAllowsPublish()) return;
      safePostMessage({
        type: "update",
        data: { docs: persisted, hostId: globalHostId },
      });
    } catch (error) {
      if (!sessionIsCurrent()) return;
      if (isListenerCancelledTaskError(error)) return;
      console.error("Failed to persist overlay order:", error);
      const message = error instanceof ServiceListConflictError
        ? "Another saved outline version has a different overlay order. Your current order is still here and has not been saved."
        : "Could not save the overlay order. Your current order is still here. Check the connection and try again.";
      notifyPresentationSyncError(message);
    } finally {
      releaseOutlinePersistence();
      if (db === dbAtStart && globalFireDbInfo?.churchId === churchAtStart) {
        listenerApi.dispatch(bibleCleanupOpportunity({}));
      }
    }
  },
});

// handle updating timers
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    const excluded = isAnyOf(
      timersSlice.actions.updateTimerFromRemote,
      timersSlice.actions.setShouldUpdateTimers,
      timersSlice.actions.tickTimers,
    );
    return (
      timersSlice.actions.flushPendingTimerWrites.match(action) ||
      ((currentState as RootState).timers !==
        (previousState as RootState).timers &&
        !excluded(action) &&
        !isStoreResetAction(action))
    );
  },

  effect: async (action, listenerApi) => {
    const churchScope = {
      db: globalFireDbInfo.db,
      churchId: globalFireDbInfo.churchId,
      canWriteTimers: globalFireDbInfo.writeCapabilities?.timers === true,
    };
    listenerApi.cancelActiveListeners();
    await listenerApi.delay(10);

    if (globalFireDbInfo.churchId !== churchScope.churchId) return;

    const didWriteRemote = await writePendingTimersToStorageAndFirebase(
      listenerApi.getState() as RootState,
      churchScope,
    );

    if (didWriteRemote && globalFireDbInfo.churchId === churchScope.churchId) {
      listenerApi.dispatch(timersSlice.actions.setShouldUpdateTimers(false));
    }
  },
});

// When a timer expires and the monitor is showing that timer, switch to the item's wrap-up slide (slides[1])
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    if (!timersSlice.actions.tickTimers.match(action)) return false;
    const curr = currentState as RootState;
    const prev = previousState as RootState;
    const { monitorInfo } = toLegacyPresentationShape(curr.presentation);
    if (!isMonitorShowingTimerCountdownSlide(monitorInfo)) return false;
    const itemId = monitorInfo.itemId ?? monitorInfo.timerId;
    if (!itemId) return false;
    const currTimer = curr.timers.timers.find(
      (t) => t.id === monitorInfo.timerId,
    );
    const prevTimer = prev.timers.timers.find(
      (t) => t.id === monitorInfo.timerId,
    );
    if (
      !currTimer ||
      currTimer.remainingTime !== 0 ||
      currTimer.status !== "stopped"
    )
      return false;
    const justExpired =
      !prevTimer ||
      prevTimer.remainingTime > 0 ||
      prevTimer.status === "running";
    return justExpired;
  },
  effect: async (action, listenerApi) => {
    const state = listenerApi.getState() as RootState;
    const { monitorInfo } = toLegacyPresentationShape(state.presentation);
    const itemId = monitorInfo.itemId ?? monitorInfo.timerId;
    if (!itemId) return;
    const dbAtStart = db;
    const fireDbAtStart = globalFireDbInfo.db;
    const churchIdAtStart = globalFireDbInfo.churchId;
    const currentItem = state.undoable.present.item;
    let item: DBItem | null = null;
    if (currentItem._id === itemId && getActiveItemSlides(currentItem).length > 1) {
      item = currentItem as unknown as DBItem;
    } else if (dbAtStart) {
      try {
        item = await loadItemWithSongHydration(dbAtStart, itemId);
      } catch {
        return;
      }
    }
    if (
      db !== dbAtStart ||
      globalFireDbInfo.db !== fireDbAtStart ||
      globalFireDbInfo.churchId !== churchIdAtStart
    ) return;
    if (!item) return;
    if (item.type !== "song") item = normalizeItemSlides(item);
    const slides = getActiveItemSlides(item);
    if (slides.length < 2) return;
    const wrapUpSlide = slides[1];
    const presentationType = item.type === "timer" ? "timer" : monitorInfo.type;
    listenerApi.dispatch(
      updateMonitor({
        slide: wrapUpSlide,
        name: monitorInfo.name,
        type: presentationType,
        timerId: monitorInfo.timerId,
        itemId: monitorInfo.itemId,
        listId: monitorInfo.listId,
      }),
    );
  },
});

// handle updating credits
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    const state = (currentState as RootState).undoable.present.credits;
    // Don't save until initialization is complete
    if (!state.isInitialized) return false;

    const excluded = isAnyOf(
      creditsSlice.actions.initiateCreditsList,
      creditsSlice.actions.initiateCreditsHistory,
      creditsSlice.actions.initiateLiveCredits,
      creditsSlice.actions.updateCreditsListFromRemote,
      creditsSlice.actions.updateInitialList,
      creditsSlice.actions.setIsLoading,
      creditsSlice.actions.initiateTransitionScene,
      creditsSlice.actions.initiateCreditsScene,
      creditsSlice.actions.selectCredit,
      creditsSlice.actions.setIsInitialized,
      creditsSlice.actions.deleteCreditsHistoryEntry,
      creditsSlice.actions.updateCreditsHistoryEntry,
      creditsSlice.actions.removeCreditsHistoryLineEverywhere,
      creditsSlice.actions.syncVisibleCreditsMirrorAndHistory,
    );
    return (
      (currentState as RootState).undoable.present.credits !==
        (previousState as RootState).undoable.present.credits &&
      !excluded(action) &&
      !isStoreResetAction(action)
    );
  },

  effect: async (_action, listenerApi) => {
    const preDelay = listenerApi.getState() as RootState;
    const snapshotCredits = preDelay.undoable.present.credits;
    const dbAtStart = db;
    if (!snapshotCredits.isInitialized) return;
    if (!dbAtStart) return;
    const fireDbAtStart = globalFireDbInfo.db;
    const fireChurchIdAtStart = globalFireDbInfo.churchId;

    const snapshotOutlineId =
      preDelay.undoable.present.itemLists.selectedList?._id ??
      preDelay.undoable.present.itemLists.activeList?._id;
    if (!snapshotOutlineId) return;

    listenerApi.dispatch(
      autosaveIndicatorSlice.actions.beginKeyedDebouncedSave(
        AUTOSAVE_DEBOUNCE_KEYS.credits,
      ),
    );
    try {
      listenerApi.cancelActiveListeners();
      await listenerApi.delay(1500);
      listenerApi.throwIfCancelled();
      if (db !== dbAtStart || globalFireDbInfo.churchId !== fireChurchIdAtStart) return;

      const afterDelay = listenerApi.getState() as RootState;
      const currentOutlineId =
        afterDelay.undoable.present.itemLists.selectedList?._id ??
        afterDelay.undoable.present.itemLists.activeList?._id;

      const afterDelayCredits = afterDelay.undoable.present.credits;
      /** Same outline: use latest Redux (e.g. after updateCreditsListFromRemote). Switched outline: only snapshot still matches this Pouch doc. */
      const creditsForPersist =
        currentOutlineId === snapshotOutlineId &&
        afterDelayCredits.isInitialized
          ? afterDelayCredits
          : snapshotCredits;

      const { list } = creditsForPersist;

      const fireDb = fireDbAtStart;
      const fireChurchId = fireChurchIdAtStart;
      const shouldSyncGlobalRtdbCredits =
        Boolean(fireDb) &&
        Boolean(fireChurchId) &&
        currentOutlineId === snapshotOutlineId &&
        creditsForPersist.isInitialized;

      if (shouldSyncGlobalRtdbCredits && fireDb && fireChurchId) {
        const {
          list: rtdbList,
          transitionScene,
          creditsScene,
          scheduleName,
        } = creditsForPersist;
        const activeOutlineId =
          afterDelay.undoable.present.itemLists.activeList?._id;
        const isEditingLiveOutline =
          activeOutlineId != null && currentOutlineId === activeOutlineId;
        const liveCreditsForRtdb = rtdbList
          .filter((c) => !c.hidden)
          .map((credit) => ({ ...credit }));

        if (isEditingLiveOutline) {
          set(
            ref(
              fireDb,
              getChurchDataPath(fireChurchId, "credits", "publishedList"),
            ),
            cleanObject(liveCreditsForRtdb),
          );
        }
        set(
          ref(
            fireDb,
            getChurchDataPath(fireChurchId, "credits", "transitionScene"),
          ),
          transitionScene,
        );
        set(
          ref(
            fireDb,
            getChurchDataPath(fireChurchId, "credits", "creditsScene"),
          ),
          creditsScene,
        );
        set(
          ref(
            fireDb,
            getChurchDataPath(fireChurchId, "credits", "scheduleName"),
          ),
          scheduleName,
        );
      }

      const now = new Date().toISOString();
      const creditIds = list.map((c) => c.id);
      const docsToBroadcast: DBCredits[] = [];

      try {
        await ensureCreditsIndexDoc(dbAtStart, snapshotOutlineId);
        const db_credits: DBCredits = await dbAtStart.get(
          getCreditsDocId(snapshotOutlineId),
        );
        db_credits.creditIds = creditIds;
        db_credits.updatedAt = now;
        await dbAtStart.put(db_credits);
        docsToBroadcast.push(db_credits);
      } catch (e) {
        console.error("credits index save failed", e);
      }

      if (db !== dbAtStart || globalFireDbInfo.churchId !== fireChurchIdAtStart) return;
      safePostMessage({
        type: "update",
        data: {
          docs: docsToBroadcast,
          hostId: globalHostId,
        },
      });
    } finally {
      listenerApi.dispatch(
        autosaveIndicatorSlice.actions.endKeyedDebouncedSave(
          AUTOSAVE_DEBOUNCE_KEYS.credits,
        ),
      );
    }
  },
});

/** When the active outline changes, push that outline's credits from Pouch to RTDB live display. */
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    // Full RESET or controller-session soft reset clear itemLists to initial
    // state; activeList becomes undefined transiently. Do not treat that as
    // "no active outline" for audience RTDB — avoids wiping `publishedList`
    // while displays stay open.
    if (isStoreResetAction(action)) return false;
    const prevId = (previousState as RootState).undoable.present.itemLists
      .activeList?._id;
    const nextId = (currentState as RootState).undoable.present.itemLists
      .activeList?._id;
    return prevId !== nextId;
  },
  effect: async (_action, listenerApi) => {
    const stateBefore = listenerApi.getState() as RootState;
    const outlineId = stateBefore.undoable.present.itemLists.activeList?._id;
    const dbAtStart = db;
    const fireDbAtStart = globalFireDbInfo.db;
    const churchIdAtStart = globalFireDbInfo.churchId;

    if (!fireDbAtStart || !churchIdAtStart) return;

    const publishedRef = ref(
      fireDbAtStart,
      getChurchDataPath(churchIdAtStart, "credits", "publishedList"),
    );

    if (!outlineId) {
      set(publishedRef, []);
      return;
    }

    if (!dbAtStart) return;
    const isCurrentScope = () =>
      db === dbAtStart &&
      globalFireDbInfo.db === fireDbAtStart &&
      globalFireDbInfo.churchId === churchIdAtStart;

    try {
      await migrateLegacyCreditsToActiveOutlineIfNeeded(dbAtStart, outlineId);
      if (!isCurrentScope()) return;
      await ensureCreditsIndexDoc(dbAtStart, outlineId);
      if (!isCurrentScope()) return;
      const creditsDoc = (await dbAtStart.get(
        getCreditsDocId(outlineId),
      )) as DBCredits;
      if (!isCurrentScope()) return;
      const creditIds = creditsDoc.creditIds ?? [];
      const credits = await getCreditsByIds(dbAtStart, outlineId, creditIds);
      if (!isCurrentScope()) return;
      const visible = credits.filter((c) => !c.hidden).map((c) => ({ ...c }));

      const stillActive = (listenerApi.getState() as RootState).undoable.present
        .itemLists.activeList?._id;
      if (!isCurrentScope() || stillActive !== outlineId) return;

      set(publishedRef, cleanObject(visible as unknown as object));
    } catch (e) {
      console.error(
        "Failed to sync published credits to RTDB after active outline change",
        e,
      );
    }
  },
});

// handle updating media
type PendingMediaPersistenceState = Pick<RootState["media"], "list" | "folders">;
const mediaSaveQueues = new WeakMap<PouchDB.Database, Promise<void>>();
let pendingMediaPersistence: {
  db: PouchDB.Database;
  state: PendingMediaPersistenceState;
  inFlightRemoteChanges?: Set<{
    itemIds: Set<string>;
    folderIds: Set<string>;
  }>;
} | null = null;

listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    const state = (currentState as RootState).media;
    // Don't save until initialization is complete
    if (!state.isInitialized) return false;

    const excluded = isAnyOf(
      mediaItemsSlice.actions.initiateMediaList,
      mediaItemsSlice.actions.initiateMediaFromDoc,
      mediaItemsSlice.actions.syncMediaFromRemote,
      mediaItemsSlice.actions.updateMediaListFromRemote,
      mediaItemsSlice.actions.upsertMediaItemFromRemote,
      mediaItemsSlice.actions.removeMediaItemFromRemote,
      mediaItemsSlice.actions.updateMediaFoldersFromRemote,
      mediaItemsSlice.actions.setIsInitialized,
      mediaItemsSlice.actions.setLoadStatus,
    );
    return (
      (currentState as RootState).media !==
        (previousState as RootState).media &&
      !excluded(action) &&
      !isStoreResetAction(action)
    );
  },

  effect: async (action, listenerApi) => {
    const dbAtStart = db;
    const beforeAction = (listenerApi.getOriginalState() as RootState).media;
    if (!dbAtStart) return;
    if (!pendingMediaPersistence || pendingMediaPersistence.db !== dbAtStart) {
      pendingMediaPersistence = {
        db: dbAtStart,
        state: { list: beforeAction.list, folders: beforeAction.folders },
      };
    }
    const baseline = pendingMediaPersistence;

    listenerApi.dispatch(
      autosaveIndicatorSlice.actions.beginKeyedDebouncedSave(
        AUTOSAVE_DEBOUNCE_KEYS.media,
      ),
    );
    try {
      listenerApi.cancelActiveListeners();
      await listenerApi.delay(1500);

      // A reset, remote update, reinitialization, or database switch makes this
      // delayed save stale. Never let it replace a newer document snapshot.
      const mediaSaveIsCurrent = () => {
        const currentMedia = (listenerApi.getState() as RootState).media;
        return Boolean(dbAtStart && db === dbAtStart && pendingMediaPersistence === baseline && currentMedia.isInitialized);
      };
      if (!mediaSaveIsCurrent()) return;

      const previousSave = mediaSaveQueues.get(dbAtStart) ?? Promise.resolve();
      const queuedSave = previousSave.catch(() => undefined).then(async () => {
        if (!mediaSaveIsCurrent()) return;
        const latestMedia = (listenerApi.getState() as RootState).media;
        const remoteChanges = { itemIds: new Set<string>(), folderIds: new Set<string>() };
        baseline.inFlightRemoteChanges ??= new Set();
        baseline.inFlightRemoteChanges.add(remoteChanges);
        try {
          const changedDocs = await persistMediaStateChanges(
            dbAtStart,
            baseline.state,
            { list: latestMedia.list, folders: latestMedia.folders },
            mediaSaveIsCurrent,
            {
              canCommitItem: (id) => !remoteChanges.itemIds.has(id),
              canCommitFolders: () => remoteChanges.folderIds.size === 0,
            },
          );
          // Redux changes after Pouch commits do not invalidate the commit. They
          // do affect which rows are still authoritative for broadcast/cache.
          if (!mediaSaveIsCurrent()) return;
          const currentMedia = (listenerApi.getState() as RootState).media;
          const committedItems = new Map<string, Record<string, unknown>>();
          const committedItemDeletes = new Set<string>();
          let committedFolders: typeof baseline.state.folders | undefined;
          changedDocs.forEach((value) => {
            if (!value || typeof value !== "object") return;
            const doc = value as Record<string, unknown>;
            if (doc._id === "media-folders" && Array.isArray(doc.folders)) {
              committedFolders = doc.folders as typeof baseline.state.folders;
              return;
            }
            if (typeof doc._id !== "string" || !doc._id.startsWith("media-item:")) return;
            const id = doc._id.slice("media-item:".length);
            if (doc._deleted === true) {
              committedItemDeletes.add(id);
              return;
            }
            const row = { ...doc };
            delete row._id;
            delete row._rev;
            delete row.docType;
            committedItems.set(id, row);
          });
          const rebaseCommittedRows = <T extends { id: string }>(
            acknowledgedRows: T[],
            persistedRows: Map<string, Record<string, unknown>>,
            deletedIds: Set<string>,
            authoritativeRows: T[],
            remoteChangedIds: Set<string>,
          ) => {
            const rows = new Map(acknowledgedRows.map((row) => [row.id, row]));
            const authoritativeById = new Map(authoritativeRows.map((row) => [row.id, row]));
            persistedRows.forEach((row, id) => {
              if (!remoteChangedIds.has(id)) rows.set(id, row as T);
            });
            deletedIds.forEach((id) => {
              if (!remoteChangedIds.has(id)) rows.delete(id);
            });
            remoteChangedIds.forEach((id) => {
              const row = authoritativeById.get(id);
              if (row) rows.set(id, row);
              else rows.delete(id);
            });
            return [...rows.values()];
          };
          // Advance only rows Pouch actually committed. Newer local edits stay
          // dirty against the acknowledged value and are saved by the next queue entry.
          baseline.state = {
            list: rebaseCommittedRows(
              baseline.state.list,
              committedItems,
              committedItemDeletes,
              currentMedia.list,
              remoteChanges.itemIds,
            ),
            folders: rebaseCommittedRows(
              committedFolders ?? baseline.state.folders,
              new Map(),
              new Set(),
              currentMedia.folders,
              remoteChanges.folderIds,
            ),
          };
          if (
            JSON.stringify(baseline.state.list) === JSON.stringify(currentMedia.list) &&
            JSON.stringify(baseline.state.folders) === JSON.stringify(currentMedia.folders)
          ) {
            if (pendingMediaPersistence === baseline) pendingMediaPersistence = null;
          }

          const broadcastDocs = changedDocs.filter((value) => {
            if (!value || typeof value !== "object") return true;
            const doc = value as { _id?: unknown };
            if (typeof doc._id !== "string") return true;
            if (doc._id.startsWith("media-item:")) {
              return !remoteChanges.itemIds.has(doc._id.slice("media-item:".length));
            }
            if (doc._id === "media-folders") return remoteChanges.folderIds.size === 0;
            return true;
          });

          // Pouch has committed the docs. Publish each still-authoritative local
          // commit even when a newer local snapshot is waiting for its own save.
          if (broadcastDocs.length > 0) {
            safePostMessage({
              type: "update",
              data: { docs: broadcastDocs, hostId: globalHostId },
            });
          }

          // Cache the currently authoritative Redux list, including remote row
          // wins and any newer local edit that is still pending persistence.
          if (window.electronAPI) {
            try {
              const urlArray = extractMediaUrlsFromBackgrounds(currentMedia.list);
              const electronAPI = window.electronAPI as unknown as {
                syncMediaCache: (
                  urls: string[],
                ) => Promise<{ downloaded: number; cleaned: number }>;
                getMediaCacheMap: () => Promise<Record<string, string>>;
              };
              await electronAPI.syncMediaCache(urlArray);
              const map = await electronAPI.getMediaCacheMap();
              listenerApi.dispatch(setMediaCacheMap(map));
            } catch (error) {
              console.error(
                "Error syncing media cache after media list save:",
                error,
              );
            }
          }
        } finally {
          baseline.inFlightRemoteChanges?.delete(remoteChanges);
          if (baseline.inFlightRemoteChanges?.size === 0) {
            delete baseline.inFlightRemoteChanges;
          }
        }
      });
      mediaSaveQueues.set(dbAtStart, queuedSave.then(() => undefined, () => undefined));
      try {
        await queuedSave;
      } catch (error) {
        console.error(
          "Failed to persist media library to PouchDB (debounced listener):",
          error,
        );
      }
    } finally {
      listenerApi.dispatch(
        autosaveIndicatorSlice.actions.endKeyedDebouncedSave(
          AUTOSAVE_DEBOUNCE_KEYS.media,
        ),
      );
    }
  },
});

// Initialization and session resets replace the local media baseline. Remote
// media actions leave a pending local save alive; it reads the latest Redux
// state when its debounce expires so unrelated replicated changes are retained.
listenerMiddleware.startListening({
  predicate: (action) =>
    mediaItemsSlice.actions.initiateMediaList.match(action) ||
    mediaItemsSlice.actions.initiateMediaFromDoc.match(action) ||
    mediaItemsSlice.actions.syncMediaFromRemote.match(action) ||
    mediaItemsSlice.actions.updateMediaListFromRemote.match(action) ||
    mediaItemsSlice.actions.upsertMediaItemFromRemote.match(action) ||
    mediaItemsSlice.actions.removeMediaItemFromRemote.match(action) ||
    mediaItemsSlice.actions.updateMediaFoldersFromRemote.match(action) ||
    isStoreResetAction(action),
  effect: (action, listenerApi) => {
    const baseline = pendingMediaPersistence;
    if (!baseline) return;
    if (
      mediaItemsSlice.actions.initiateMediaList.match(action) ||
      mediaItemsSlice.actions.initiateMediaFromDoc.match(action) ||
      isStoreResetAction(action)
    ) {
      pendingMediaPersistence = null;
      return;
    }

    const before = (listenerApi.getOriginalState() as RootState).media;
    const after = (listenerApi.getState() as RootState).media;
    const changedIds = <T extends { id: string }>(left: T[], right: T[]) => {
      const leftById = new Map(left.map((item) => [item.id, item]));
      const rightById = new Map(right.map((item) => [item.id, item]));
      return new Set(
        [...new Set([...leftById.keys(), ...rightById.keys()])].filter(
          (id) => JSON.stringify(leftById.get(id)) !== JSON.stringify(rightById.get(id)),
        ),
      );
    };
    const remoteChangedIds = changedIds(before.list, after.list);
    baseline.inFlightRemoteChanges?.forEach((changes) => {
      remoteChangedIds.forEach((id) => changes.itemIds.add(id));
    });
    // Remote writes remain authoritative for the rows they change. Rebase only
    // those rows so other local edits stay pending and can still be persisted.
    const rebaseChangedRows = <T extends { id: string }>(
      baselineRows: T[],
      remoteRows: T[],
      changedIdsSet: Set<string>,
    ) => {
      const rows = new Map(baselineRows.map((row) => [row.id, row]));
      const remoteById = new Map(remoteRows.map((row) => [row.id, row]));
      changedIdsSet.forEach((id) => {
        const remoteRow = remoteById.get(id);
        if (remoteRow) rows.set(id, remoteRow);
        else rows.delete(id);
      });
      return [...rows.values()];
    };
    if (remoteChangedIds.size > 0) {
      baseline.state = {
        ...baseline.state,
        list: rebaseChangedRows(baseline.state.list, after.list, remoteChangedIds),
      };
    }

    const remoteChangedFolderIds = changedIds(
      before.folders,
      after.folders,
    );
    baseline.inFlightRemoteChanges?.forEach((changes) => {
      remoteChangedFolderIds.forEach((id) => changes.folderIds.add(id));
    });
    if (remoteChangedFolderIds.size > 0) {
      baseline.state = {
        ...baseline.state,
        folders: rebaseChangedRows(
          baseline.state.folders,
          after.folders,
          remoteChangedFolderIds,
        ),
      };
    }
    if (
      !baseline.inFlightRemoteChanges?.size &&
      JSON.stringify(baseline.state.list) === JSON.stringify(after.list) &&
      JSON.stringify(baseline.state.folders) === JSON.stringify(after.folders)
    ) {
      pendingMediaPersistence = null;
    }
  },
});

// Sync media cache when v2 media items are updated from remote.
listenerMiddleware.startListening({
  predicate: (action) =>
    mediaItemsSlice.actions.syncMediaFromRemote.match(action) ||
    mediaItemsSlice.actions.updateMediaListFromRemote.match(action) ||
    mediaItemsSlice.actions.upsertMediaItemFromRemote.match(action) ||
    mediaItemsSlice.actions.removeMediaItemFromRemote.match(action),
  effect: async (action, listenerApi) => {
    if (!window.electronAPI) return;

    listenerApi.cancelActiveListeners();
    await listenerApi.delay(2000);

    try {
      const list = (listenerApi.getState() as RootState).media.list;
      const urlArray = extractMediaUrlsFromBackgrounds(list);
      const electronAPI = window.electronAPI as unknown as {
        syncMediaCache: (
          urls: string[],
        ) => Promise<{ downloaded: number; cleaned: number }>;
        getMediaCacheMap: () => Promise<Record<string, string>>;
      };
      if (urlArray.length > 0) {
        await electronAPI.syncMediaCache(urlArray);
      } else {
        await electronAPI.syncMediaCache([]);
      }
      const map = await electronAPI.getMediaCacheMap();
      listenerApi.dispatch(setMediaCacheMap(map));
    } catch (error) {
      console.error(
        "Error syncing media cache after remote media list update:",
        error,
      );
    }
  },
});

// handle updating preferences
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    const state = (currentState as RootState).undoable.present.preferences;
    // Don't save until initialization is complete
    if (!state.isInitialized) return false;

    const excluded = isAnyOf(
      preferencesSlice.actions.initiatePreferences,
      preferencesSlice.actions.initiateMonitorSettings,
      preferencesSlice.actions.initiateQuickLinks,
      preferencesSlice.actions.increaseSlides,
      preferencesSlice.actions.increaseSlidesMobile,
      preferencesSlice.actions.decreaseSlides,
      preferencesSlice.actions.decreaseSlidesMobile,
      preferencesSlice.actions.setSlides,
      preferencesSlice.actions.setSlidesMobile,
      preferencesSlice.actions.increaseFormattedLyrics,
      preferencesSlice.actions.decreaseFormattedLyrics,
      preferencesSlice.actions.setFormattedLyrics,
      preferencesSlice.actions.setMediaItems,
      preferencesSlice.actions.setShouldShowItemEditor,
      preferencesSlice.actions.setIsMediaExpanded,
      preferencesSlice.actions.setToolbarSection,
      preferencesSlice.actions.setLastControllerConfigurationRoute,
      preferencesSlice.actions.setOverlayControllerPanel,
      preferencesSlice.actions.setIsLoading,
      preferencesSlice.actions.setSelectedPreference,
      preferencesSlice.actions.setSelectedQuickLink,
      preferencesSlice.actions.setTab,
      preferencesSlice.actions.setScrollbarWidth,
      preferencesSlice.actions.updatePreferencesFromRemote,
      preferencesSlice.actions.setMediaRouteFolder,
      preferencesSlice.actions.initiateMediaRouteFolders,
      preferencesSlice.actions.updateControllerMediaRouteFoldersFromRemote,
      preferencesSlice.actions.markMediaRouteFolderPersisted,
      preferencesSlice.actions.repairActiveMediaRouteFolders,
      preferencesSlice.actions.replaceMediaReferencesInPreferences,
      preferencesSlice.actions.setIsInitialized,
    );
    return (
      (currentState as RootState).undoable.present.preferences !==
        (previousState as RootState).undoable.present.preferences &&
      !excluded(action) &&
      !isStoreResetAction(action)
    );
  },

  effect: async (action, listenerApi) => {
    const dbAtStart = db;
    const fireDbAtStart = globalFireDbInfo.db;
    const fireChurchIdAtStart = globalFireDbInfo.churchId;
    if (!dbAtStart) return;
    listenerApi.dispatch(
      autosaveIndicatorSlice.actions.beginKeyedDebouncedSave(
        AUTOSAVE_DEBOUNCE_KEYS.preferences,
      ),
    );
    try {
      listenerApi.cancelActiveListeners();
      await listenerApi.delay(1500);

      if (db !== dbAtStart) return;

      const { preferences, monitorSettings, quickLinks } = (
        listenerApi.getState() as RootState
      ).undoable.present.preferences;

      if (fireDbAtStart && fireChurchIdAtStart && globalFireDbInfo.churchId === fireChurchIdAtStart) {
        set(
          ref(
            fireDbAtStart,
            getChurchDataPath(fireChurchIdAtStart, "monitorSettings"),
          ),
          cleanObject({
            ...monitorSettings,
          }),
        );
      }

      const pouchDb = dbAtStart;
      const now = new Date().toISOString();

      const getDoc = async (id: string) => {
        try {
          return await pouchDb.get(id);
        } catch (e) {
          if ((e as { status?: number }).status === 404) return null;
          throw e;
        }
      };

      try {
        const p0 = (await getDoc(PREFERENCES_POUCH_ID)) as DBPreferences | null;
        const prefsToPut = (
          p0
            ? {
                ...p0,
                preferences,
                updatedAt: now,
                docType: "preferences" as const,
              }
            : {
                _id: PREFERENCES_POUCH_ID,
                preferences,
                createdAt: now,
                updatedAt: now,
                docType: "preferences" as const,
              }
        ) as DBPreferences;
        const prefsRes = await pouchDb.put(prefsToPut);
        const prefsOut = {
          ...prefsToPut,
          _rev: (prefsRes as { rev: string }).rev,
        } as DBPreferences;

        const ql0 = (await getDoc(
          QUICK_LINKS_POUCH_ID,
        )) as DBQuickLinksDoc | null;
        const qlToPut = (
          ql0
            ? {
                ...ql0,
                quickLinks,
                updatedAt: now,
                docType: "quickLinks" as const,
              }
            : {
                _id: QUICK_LINKS_POUCH_ID,
                quickLinks,
                createdAt: now,
                updatedAt: now,
                docType: "quickLinks" as const,
              }
        ) as DBQuickLinksDoc;
        const qlRes = await pouchDb.put(qlToPut);
        const qlOut = {
          ...qlToPut,
          _rev: (qlRes as { rev: string }).rev,
        } as DBQuickLinksDoc;

        const m0 = (await getDoc(
          MONITOR_SETTINGS_POUCH_ID,
        )) as DBMonitorSettingsDoc | null;
        const monToPut = (
          m0
            ? {
                ...m0,
                monitorSettings,
                updatedAt: now,
                docType: "monitorSettings" as const,
              }
            : {
                _id: MONITOR_SETTINGS_POUCH_ID,
                monitorSettings,
                createdAt: now,
                updatedAt: now,
                docType: "monitorSettings" as const,
              }
        ) as DBMonitorSettingsDoc;
        const monRes = await pouchDb.put(monToPut);
        const monOut = {
          ...monToPut,
          _rev: (monRes as { rev: string }).rev,
        } as DBMonitorSettingsDoc;

        if (db !== dbAtStart) return;
        safePostMessage({
          type: "update",
          data: {
            docs: [prefsOut, qlOut, monOut],
            hostId: globalHostId,
          },
        });
      } catch (error) {
        console.error(error);
      }
    } finally {
      listenerApi.dispatch(
        autosaveIndicatorSlice.actions.endKeyedDebouncedSave(
          AUTOSAVE_DEBOUNCE_KEYS.preferences,
        ),
      );
    }
  },
});

// Media route navigation owns one small scoped document and does not autosave
// the unrelated preferences cluster. Each action captures its profile ID.
const mediaFolderSaveQueues = new WeakMap<PouchDB.Database, Map<string, Promise<void>>>();
listenerMiddleware.startListening({
  actionCreator: preferencesSlice.actions.setMediaRouteFolder,
  effect: async (action, listenerApi) => {
    if (!db) return;
    const { controllerProfileId, key, folderId } = action.payload;
    if ((listenerApi.getState() as RootState).undoable.present.preferences.mediaRouteFoldersControllerProfileId !== controllerProfileId) return;
    const id = getControllerMediaRouteFoldersDocId(controllerProfileId);
    const database = db;
    if (!database) return;
    let databaseQueues = mediaFolderSaveQueues.get(database);
    if (!databaseQueues) {
      databaseQueues = new Map();
      mediaFolderSaveQueues.set(database, databaseQueues);
    }
    const previous = databaseQueues.get(id) ?? Promise.resolve();
    const save = previous.catch(() => undefined).then(async () => {
      const saved = await patchControllerMediaRouteFolder(database, controllerProfileId, key, folderId);
      const currentState = (listenerApi.getState() as RootState).undoable.present.preferences;
      if (db !== database || currentState.mediaRouteFoldersControllerProfileId !== controllerProfileId) return;
      listenerApi.dispatch(preferencesSlice.actions.markMediaRouteFolderPersisted({ controllerProfileId, key, folderId }));
      safePostMessage({ type: "update", data: { docs: [saved], hostId: globalHostId } });
    });
    databaseQueues.set(id, save);
    try {
      await save;
    } catch (error) {
      console.error("Could not save controller media folder selection", error);
    } finally {
      if (databaseQueues.get(id) === save) databaseQueues.delete(id);
    }
  },
});

// handle updating overlay templates
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    const state = (currentState as RootState).undoable.present.overlayTemplates;
    // Don't save until initialization is complete
    if (!state.isInitialized) return false;

    const excluded = isAnyOf(
      overlayTemplatesSlice.actions.initiateTemplates,
      overlayTemplatesSlice.actions.updateTemplatesFromRemote,
      overlayTemplatesSlice.actions.setIsLoading,
      overlayTemplatesSlice.actions.setHasPendingUpdate,
      overlayTemplatesSlice.actions.forceUpdate,
      overlayTemplatesSlice.actions.setIsInitialized,
    );
    return (
      (currentState as RootState).undoable.present.overlayTemplates !==
        (previousState as RootState).undoable.present.overlayTemplates &&
      !excluded(action) &&
      !!(currentState as RootState).undoable.present.overlayTemplates
        ?.hasPendingUpdate &&
      !isStoreResetAction(action)
    );
  },

  effect: async (action, listenerApi) => {
    const dbAtStart = db;
    if (!dbAtStart) return;
    listenerApi.cancelActiveListeners();
    await listenerApi.delay(1500);

    if (db !== dbAtStart) return;

    listenerApi.dispatch(
      overlayTemplatesSlice.actions.setHasPendingUpdate(false),
    );

    // update overlay templates
    const { templatesByType, defaultTemplateIdsByType } = (
      listenerApi.getState() as RootState
    ).undoable.present.overlayTemplates;

    try {
      const db_templates: DBOverlayTemplates =
        await dbAtStart.get("overlay-templates");
      db_templates.templatesByType = templatesByType;
      db_templates.defaultTemplateIdsByType = defaultTemplateIdsByType;
      db_templates.updatedAt = new Date().toISOString();
      await dbAtStart.put(db_templates);
      // Local machine updates
      if (db !== dbAtStart) return;
      safePostMessage({
        type: "update",
        data: {
          docs: db_templates,
          hostId: globalHostId,
        },
      });
    } catch (error) {
      // if the templates are not found, create a new one
      console.error(error);
      const db_templates = {
        _id: "overlay-templates",
        templatesByType: templatesByType,
        defaultTemplateIdsByType,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await dbAtStart.put(db_templates);
    }
  },
});

const readFirebaseServices = (value: unknown): ServiceTime[] => {
  if (Array.isArray(value)) return value.filter(Boolean) as ServiceTime[];
  if (!value || typeof value !== "object") return [];

  const record = value as Record<string, unknown>;
  if (Array.isArray(record.list)) {
    return record.list.filter(Boolean) as ServiceTime[];
  }
  return Object.values(record).filter(
    (entry): entry is ServiceTime =>
      Boolean(entry) && typeof (entry as ServiceTime).id === "string",
  );
};

const applyServiceTimesAction = (
  services: ServiceTime[],
  action: Action,
  localServices: ServiceTime[],
): ServiceTime[] | undefined => {
  const timestamp = serverDate().toISOString();
  if (serviceTimesSlice.actions.applyServiceGroupMutation.match(action)) {
    const { primary, partnerUpdates, requiredPartnerIds = [] } = action.payload;
    if (primary.mode === "delete") {
      const deleted = services.find((service) => service.id === primary.id);
      if (!deleted) return services;
      let next = services.filter((service) => service.id !== primary.id);
      if (deleted.serviceGroupId) {
        const remaining = next.filter((service) => service.serviceGroupId === deleted.serviceGroupId);
        if (remaining.length < 2) {
          const remainingIds = new Set(remaining.map((service) => service.id));
          next = next.map((service) => remainingIds.has(service.id)
            ? { ...service, serviceGroupId: undefined, updatedAt: timestamp }
            : service,
          );
        }
      }
      return sortServicesByScheduleOrder(next);
    }
    if (primary.mode === "add") {
      if (services.some((service) => service.id === primary.service.id)) return services;
    } else if (!services.some((service) => service.id === primary.service.id)) {
      return services;
    }
    const existingIds = new Set(services.map((service) => service.id));
    if (requiredPartnerIds.some((id) => !existingIds.has(id)) ||
      (primary.service.serviceGroupId && requiredPartnerIds.length === 0)) {
      // Returning undefined aborts this RTDB transaction. A stale editor may
      // never commit a group whose selected partner disappeared concurrently.
      return undefined;
    }
    const next = primary.mode === "add"
      ? [...services, { ...primary.service, updatedAt: timestamp }]
      : services.map((service) => service.id === primary.service.id
        ? { ...service, ...primary.service, updatedAt: timestamp }
        : service,
      );
    const affectedGroupIds = new Set<string>();
    const addAffectedGroupId = (groupId: string | null | undefined) => {
      if (groupId) affectedGroupIds.add(groupId);
    };
    const originalPrimary = services.find((service) => service.id === primary.service.id);
    addAffectedGroupId(originalPrimary?.serviceGroupId);
    addAffectedGroupId(primary.service.serviceGroupId);
    const originalServicesById = new Map(services.map((service) => [service.id, service]));
    partnerUpdates.forEach((update) => {
      addAffectedGroupId(originalServicesById.get(update.id)?.serviceGroupId);
      addAffectedGroupId(update.serviceGroupId);
    });
    const updatesById = new Map(partnerUpdates.map((update) => [update.id, update.serviceGroupId]));
    const updated = next.map((service) =>
      updatesById.has(service.id)
        ? { ...service, serviceGroupId: updatesById.get(service.id), updatedAt: timestamp }
        : service,
    );
    const memberCounts = new Map<string, number>();
    updated.forEach((service) => {
      if (service.serviceGroupId) {
        memberCounts.set(service.serviceGroupId, (memberCounts.get(service.serviceGroupId) || 0) + 1);
      }
    });
    return sortServicesByScheduleOrder(updated.map((service) =>
      service.serviceGroupId &&
      affectedGroupIds.has(service.serviceGroupId) &&
      memberCounts.get(service.serviceGroupId) === 1
        ? { ...service, serviceGroupId: undefined, updatedAt: timestamp }
        : service,
    ));
  }
  if (serviceTimesSlice.actions.addService.match(action)) {
    if (services.some((service) => service.id === action.payload.id)) {
      return services;
    }
    return sortServicesByScheduleOrder([
      ...services,
      { ...action.payload, updatedAt: timestamp },
    ]);
  }
  if (serviceTimesSlice.actions.updateService.match(action)) {
    return sortServicesByScheduleOrder(
      services.map((service) => {
        if (service.id !== action.payload.id) return service;
        return {
          ...service,
          ...action.payload.changes,
          updatedAt: timestamp,
        };
      }),
    );
  }
  if (serviceTimesSlice.actions.removeService.match(action)) {
    return services.filter((service) => service.id !== action.payload);
  }

  // Preserve existing undo/redo behavior for the uncommon non-slice action.
  return sortServicesByScheduleOrder(localServices);
};

const isLocalServiceTimesChange = (
  action: Action,
  currentState: unknown,
  previousState: unknown,
) => {
  const excluded = isAnyOf(
    serviceTimesSlice.actions.initiateServices,
    serviceTimesSlice.actions.syncServicesFromRemote,
    serviceTimesSlice.actions.updateServicesFromRemote,
    serviceTimesSlice.actions.setIsInitialized,
  );
  return (
    (currentState as RootState).undoable.present.serviceTimes !==
      (previousState as RootState).undoable.present.serviceTimes &&
    !excluded(action) &&
    !isStoreResetAction(action)
  );
};

// Firebase is the authority for shared service times. Each local change is
// merged atomically and Redux is reconciled from Firebase's committed result.
listenerMiddleware.startListening({
  predicate: isLocalServiceTimesChange,
  effect: async (action, listenerApi) => {
    // getOriginalState is only available before the first await. Keep the
    // last confirmed UI state so a failed shared write can be rolled back.
    const previousServices = (listenerApi.getOriginalState() as RootState)
      .undoable.present.serviceTimes.list;
    const localServices = (listenerApi.getState() as RootState).undoable.present
      .serviceTimes.list;
    const { db: firebaseDb, churchId, writeCapabilities } = globalFireDbInfo;
    // The legacy RTDB services collection stores both service definitions and
    // Controller-owned timer/runtime state, so either authority may write it.
    if (!writeCapabilities.serviceRuntime && !writeCapabilities.serviceManagement) return;
    if (!firebaseDb || !churchId) {
      listenerApi.dispatch(syncServicesFromRemote(previousServices));
      notifyPresentationSyncError(
        "Live sync is not ready. Your change was not saved. Wait for it to finish connecting, then try again.",
      );
      return;
    }

    listenerApi.dispatch(
      autosaveIndicatorSlice.actions.beginKeyedDebouncedSave(
        AUTOSAVE_DEBOUNCE_KEYS.serviceTimes,
      ),
    );
    try {
      const result = await runTransaction(
        ref(firebaseDb, getChurchDataPath(churchId, "services")),
        (remote) =>
          (() => {
            const next = applyServiceTimesAction(
              readFirebaseServices(remote),
              action,
              localServices,
            );
            return next === undefined ? undefined : cleanObject(next);
          })(),
        { applyLocally: false },
      );
      if (globalFireDbInfo.churchId !== churchId) return;
      const committedServices = readFirebaseServices(result.snapshot.val());
      listenerApi.dispatch(
        syncServicesFromRemote(committedServices),
      );
      if (result.committed === false &&
        serviceTimesSlice.actions.applyServiceGroupMutation.match(action) &&
        action.payload.primary.mode !== "delete") {
        notifyPresentationSyncError(
          "A selected combined-service partner changed before the edit could be saved. Refresh the service list and try again.",
        );
      }
    } catch (error) {
      if (globalFireDbInfo.churchId !== churchId) return;
      listenerApi.dispatch(syncServicesFromRemote(previousServices));
      logFirebaseOperationFailure(
        "service_times_sync",
        getChurchDataPath(churchId, "services"),
        error,
        {
          churchId,
          permissionDenied: isFirebasePermissionDenied(error),
        },
      );
      notifyPresentationSyncError(
        "Service time was not synced. Your change was not saved. Check your connection, then try again.",
      );
    } finally {
      listenerApi.dispatch(
        autosaveIndicatorSlice.actions.endKeyedDebouncedSave(
          AUTOSAVE_DEBOUNCE_KEYS.serviceTimes,
        ),
      );
    }
  },
});

// handle updating service times in local caches
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    const excluded = isAnyOf(
      serviceTimesSlice.actions.initiateServices,
      serviceTimesSlice.actions.syncServicesFromRemote,
      serviceTimesSlice.actions.updateServicesFromRemote,
      serviceTimesSlice.actions.setIsInitialized,
    );
    return (
      (currentState as RootState).undoable.present.serviceTimes !==
        (previousState as RootState).undoable.present.serviceTimes &&
      !excluded(action) &&
      !isStoreResetAction(action)
    );
  },

  effect: async (action, listenerApi) => {
    const dbAtStart = db;
    const churchIdAtStart = globalFireDbInfo.churchId;
    listenerApi.dispatch(
      autosaveIndicatorSlice.actions.beginKeyedDebouncedSave(
        AUTOSAVE_DEBOUNCE_KEYS.serviceTimes,
      ),
    );
    try {
      listenerApi.cancelActiveListeners();
      await listenerApi.delay(1500);

      if (db !== dbAtStart || globalFireDbInfo.churchId !== churchIdAtStart) return;

      // update service times
      const { list, isInitialized } = (listenerApi.getState() as RootState)
        .undoable.present.serviceTimes;

      localStorage.setItem("serviceTimes", JSON.stringify(list));

      // Keep initial boot protection only before services are initialized.
      if (!isInitialized && list.length === 0) {
        return;
      }

      if (dbAtStart) {
        try {
          const db_services: DBServices = await dbAtStart.get("services");
          db_services.list = list;
          db_services.updatedAt = new Date().toISOString();
          await dbAtStart.put(db_services);
          // Local machine updates
          if (db !== dbAtStart) return;
          safePostMessage({
            type: "update",
            data: {
              docs: db_services,
              hostId: globalHostId,
            },
          });
        } catch {
          // if the services are not found, create a new one
          const db_services = {
            _id: "services",
            list,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          await dbAtStart.put(db_services);
          if (db !== dbAtStart) return;
          safePostMessage({
            type: "update",
            data: {
              docs: db_services,
              hostId: globalHostId,
            },
          });
        }
      }
    } finally {
      listenerApi.dispatch(
        autosaveIndicatorSlice.actions.endKeyedDebouncedSave(
          AUTOSAVE_DEBOUNCE_KEYS.serviceTimes,
        ),
      );
    }
  },
});

// handle updating presentation
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    const excluded = isAnyOf(
      presentationSlice.actions.toggleProjectorTransmitting,
      presentationSlice.actions.toggleMonitorTransmitting,
      presentationSlice.actions.toggleStreamTransmitting,
      presentationSlice.actions.setTransmitToAll,
      presentationSlice.actions.updateProjectorFromRemote,
      presentationSlice.actions.updateMonitorFromRemote,
      presentationSlice.actions.updateStreamFromRemote,
      presentationSlice.actions.updateParticipantOverlayInfoFromRemote,
      presentationSlice.actions.updateStbOverlayInfoFromRemote,
      presentationSlice.actions.updateBibleDisplayInfoFromRemote,
      presentationSlice.actions.updateQrCodeOverlayInfoFromRemote,
      presentationSlice.actions.updateImageOverlayInfoFromRemote,
      presentationSlice.actions.updateFormattedTextDisplayInfoFromRemote,
      presentationSlice.actions.updateBoardPostStreamInfoFromRemote,
      presentationSlice.actions.setStreamItemContentBlockedFromRemote,
      presentationSlice.actions.setMonitorBoardAliasIdFromRemote,
      presentationSlice.actions.setProjectorBoardAliasIdFromRemote,
      // Registry bookkeeping, not a send: reconciling slots against the display
      // output list must not republish the whole presentation snapshot.
      presentationSlice.actions.syncOutputSlots,
      presentationSlice.actions.updateOutputsFromRemote,
      // Transport-only remote apply — the originating controller already wrote.
      presentationSlice.actions.applyRemoteVideoPlayback,
    );
    return (
      (currentState as RootState).presentation !==
        (previousState as RootState).presentation &&
      !excluded(action) &&
      !isStoreResetAction(action)
    );
  },

  effect: async (action, listenerApi) => {
    const churchIdAtStart = globalFireDbInfo.churchId;
    listenerApi.cancelActiveListeners();
    await listenerApi.delay(10);

    if (globalFireDbInfo.churchId !== churchIdAtStart) return;
    await syncPresentationSnapshot(listenerApi.getState() as RootState, action.type);
  },
});

// Stream transmit toggle is excluded from the predicate above, so remotes never see
// stream-on until the next slide/overlay change. Push full snapshot when stream goes live.
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    if (!presentationSlice.actions.toggleStreamTransmitting.match(action))
      return false;
    const curr = toLegacyPresentationShape(
      (currentState as RootState).presentation,
    );
    const prev = toLegacyPresentationShape(
      (previousState as RootState).presentation,
    );
    return curr.isStreamTransmitting && !prev.isStreamTransmitting;
  },
  effect: async (action, listenerApi) => {
    const churchIdAtStart = globalFireDbInfo.churchId;
    await listenerApi.delay(15);
    if (globalFireDbInfo.churchId !== churchIdAtStart) return;
    await syncPresentationSnapshot(
      listenerApi.getState() as RootState,
      action.type,
    );
  },
});

listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    if (!presentationSlice.actions.setTransmitToAll.match(action)) return false;
    const curr = toLegacyPresentationShape(
      (currentState as RootState).presentation,
    );
    const prev = toLegacyPresentationShape(
      (previousState as RootState).presentation,
    );
    return curr.isStreamTransmitting && !prev.isStreamTransmitting;
  },
  effect: async (action, listenerApi) => {
    const churchIdAtStart = globalFireDbInfo.churchId;
    await listenerApi.delay(15);
    if (globalFireDbInfo.churchId !== churchIdAtStart) return;
    await syncPresentationSnapshot(
      listenerApi.getState() as RootState,
      action.type,
    );
  },
});

// handle updating from remote projector
const isNewerPresentationTime = (
  incomingTime: number | undefined,
  currentTime: number | undefined,
) =>
  !!(
    (incomingTime && currentTime && incomingTime > currentTime) ||
    (incomingTime && !currentTime)
  );

/** Pause/seek/play bumps generation without advancing slide `time`. */
const isNewerVideoPlaybackCue = (
  incoming: Presentation | undefined,
  current: Presentation | undefined,
) =>
  (incoming?.videoPlayback?.generation ?? 0) >
  (current?.videoPlayback?.generation ?? 0);

listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    if (action.type !== "debouncedUpdateProjector") return false;
    const state = toLegacyPresentationShape(
      (previousState as RootState).presentation,
    );
    const info = action.payload as Presentation;
    return (
      isNewerPresentationTime(info.time, state.projectorInfo.time) ||
      isNewerVideoPlaybackCue(info, state.projectorInfo)
    );
  },

  effect: async (action, listenerApi) => {
    const churchIdAtStart = globalFireDbInfo.churchId;
    listenerApi.cancelActiveListeners();
    await listenerApi.delay(10);
    if (globalFireDbInfo.churchId !== churchIdAtStart) return;

    const info = action.payload as Presentation;
    const current = toLegacyPresentationShape(
      (listenerApi.getState() as RootState).presentation,
    ).projectorInfo;
    if (isNewerPresentationTime(info.time, current.time)) {
      listenerApi.dispatch(updateProjectorFromRemote(info));
      return;
    }
    if (isNewerVideoPlaybackCue(info, current)) {
      listenerApi.dispatch(
        applyRemoteVideoPlayback({
          outputType: "projector",
          videoPlayback: info.videoPlayback,
        }),
      );
    }
  },
});

// handle updating from remote monitor
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    if (action.type !== "debouncedUpdateMonitor") return false;
    const state = toLegacyPresentationShape(
      (previousState as RootState).presentation,
    );
    const info = action.payload as Presentation;
    return (
      isNewerPresentationTime(info.time, state.monitorInfo.time) ||
      isNewerVideoPlaybackCue(info, state.monitorInfo)
    );
  },

  effect: async (action, listenerApi) => {
    const churchIdAtStart = globalFireDbInfo.churchId;
    listenerApi.cancelActiveListeners();
    await listenerApi.delay(10);
    if (globalFireDbInfo.churchId !== churchIdAtStart) return;

    const info = action.payload as Presentation;
    const current = toLegacyPresentationShape(
      (listenerApi.getState() as RootState).presentation,
    ).monitorInfo;
    if (isNewerPresentationTime(info.time, current.time)) {
      listenerApi.dispatch(updateMonitorFromRemote(info));
      return;
    }
    if (isNewerVideoPlaybackCue(info, current)) {
      listenerApi.dispatch(
        applyRemoteVideoPlayback({
          outputType: "monitor",
          videoPlayback: info.videoPlayback,
        }),
      );
    }
  },
});

// handle updating from remote stream (strict > so we skip our own Firebase echo and avoid prev/current both having current slide)
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    if (action.type !== "debouncedUpdateStream") return false;
    const state = toLegacyPresentationShape(
      (previousState as RootState).presentation,
    );
    const info = action.payload as Presentation;
    return (
      isNewerPresentationTime(info.time, state.streamInfo.time) ||
      isNewerVideoPlaybackCue(info, state.streamInfo)
    );
  },

  effect: async (action, listenerApi) => {
    const churchIdAtStart = globalFireDbInfo.churchId;
    listenerApi.cancelActiveListeners();
    await listenerApi.delay(10);
    if (globalFireDbInfo.churchId !== churchIdAtStart) return;

    const info = action.payload as Presentation;
    const current = toLegacyPresentationShape(
      (listenerApi.getState() as RootState).presentation,
    ).streamInfo;
    if (isNewerPresentationTime(info.time, current.time)) {
      listenerApi.dispatch(updateStreamFromRemote(info));
      return;
    }
    if (isNewerVideoPlaybackCue(info, current)) {
      listenerApi.dispatch(
        applyRemoteVideoPlayback({
          outputType: "stream",
          videoPlayback: info.videoPlayback,
        }),
      );
    }
  },
});

// handle updating outputs created after the display registry. Freshness is
// checked per output inside the reducer, since one payload carries many.
listenerMiddleware.startListening({
  predicate: (action) => action.type === "debouncedUpdateOutputs",
  effect: async (action, listenerApi) => {
    const churchIdAtStart = globalFireDbInfo.churchId;
    listenerApi.cancelActiveListeners();
    await listenerApi.delay(10);
    if (globalFireDbInfo.churchId !== churchIdAtStart) return;
    listenerApi.dispatch(
      updateOutputsFromRemote(
        action.payload as Record<string, RemoteOutputState> | null,
      ),
    );
  },
});

// handle updating from remote bible info
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    if (action.type !== "debouncedUpdateBibleDisplayInfo") return false;
    const state = toLegacyPresentationShape(
      (previousState as RootState).presentation,
    );
    const info = action.payload as BibleDisplayInfo;
    const currentBible = state.streamInfo.bibleDisplayInfo;
    return !!(
      (info.time &&
        hasBibleDisplayData(info) &&
        !hasBibleDisplayData(currentBible)) ||
      (info.time && currentBible?.time && info.time > currentBible.time) ||
      (info.time && !currentBible?.time)
    );
  },

  effect: async (action, listenerApi) => {
    const churchIdAtStart = globalFireDbInfo.churchId;
    listenerApi.cancelActiveListeners();
    await listenerApi.delay(10);
    if (globalFireDbInfo.churchId !== churchIdAtStart) return;

    listenerApi.dispatch(
      updateBibleDisplayInfoFromRemote(action.payload as BibleDisplayInfo),
    );
  },
});

// handle updating from remote participant overlay info
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    if (action.type !== "debouncedUpdateParticipantOverlayInfo") return false;
    const state = toLegacyPresentationShape(
      (previousState as RootState).presentation,
    );
    const info = action.payload as OverlayInfo;
    const currentParticipant = state.streamInfo.participantOverlayInfo;
    return shouldApplyIncomingOverlayPayload(
      currentParticipant,
      info,
      hasParticipantOverlayData(info),
      hasParticipantOverlayData(currentParticipant),
    );
  },

  effect: async (action, listenerApi) => {
    const churchIdAtStart = globalFireDbInfo.churchId;
    listenerApi.cancelActiveListeners();
    await listenerApi.delay(10);
    if (globalFireDbInfo.churchId !== churchIdAtStart) return;

    listenerApi.dispatch(
      updateParticipantOverlayInfoFromRemote(action.payload as OverlayInfo),
    );
  },
});

// handle updating from remote stb overlay info
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    const state = toLegacyPresentationShape(
      (previousState as RootState).presentation,
    );
    const info = action.payload as OverlayInfo;
    return (
      action.type === "debouncedUpdateStbOverlayInfo" &&
      shouldApplyIncomingOverlayPayload(
        state.streamInfo.stbOverlayInfo,
        info,
        hasStbOverlayData(info),
        hasStbOverlayData(state.streamInfo.stbOverlayInfo),
      )
    );
  },

  effect: async (action, listenerApi) => {
    const churchIdAtStart = globalFireDbInfo.churchId;
    listenerApi.cancelActiveListeners();
    await listenerApi.delay(10);
    if (globalFireDbInfo.churchId !== churchIdAtStart) return;

    listenerApi.dispatch(
      updateStbOverlayInfoFromRemote(action.payload as OverlayInfo),
    );
  },
});

// handle updating from remote qr code overlay info
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    const state = toLegacyPresentationShape(
      (previousState as RootState).presentation,
    );
    const info = action.payload as OverlayInfo;
    return (
      action.type === "debouncedUpdateQrCodeOverlayInfo" &&
      shouldApplyIncomingOverlayPayload(
        state.streamInfo.qrCodeOverlayInfo,
        info,
        hasQrOverlayData(info),
        hasQrOverlayData(state.streamInfo.qrCodeOverlayInfo),
      )
    );
  },

  effect: async (action, listenerApi) => {
    const churchIdAtStart = globalFireDbInfo.churchId;
    listenerApi.cancelActiveListeners();
    await listenerApi.delay(10);
    if (globalFireDbInfo.churchId !== churchIdAtStart) return;

    listenerApi.dispatch(
      updateQrCodeOverlayInfoFromRemote(action.payload as OverlayInfo),
    );
  },
});

// handle updating from remote image overlay info
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    const state = toLegacyPresentationShape(
      (previousState as RootState).presentation,
    );
    const info = action.payload as OverlayInfo;
    return (
      action.type === "debouncedUpdateImageOverlayInfo" &&
      shouldApplyIncomingOverlayPayload(
        state.streamInfo.imageOverlayInfo,
        info,
        hasImageOverlayData(info),
        hasImageOverlayData(state.streamInfo.imageOverlayInfo),
      )
    );
  },

  effect: async (action, listenerApi) => {
    const churchIdAtStart = globalFireDbInfo.churchId;
    listenerApi.cancelActiveListeners();
    await listenerApi.delay(10);
    if (globalFireDbInfo.churchId !== churchIdAtStart) return;

    listenerApi.dispatch(
      updateImageOverlayInfoFromRemote(action.payload as OverlayInfo),
    );
  },
});

// handle updating from remote formatted text display info
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    const state = toLegacyPresentationShape(
      (previousState as RootState).presentation,
    );
    const info = action.payload as FormattedTextDisplayInfo;
    return (
      action.type === "debouncedUpdateFormattedTextDisplayInfo" &&
      !!(
        (info.time &&
          state.streamInfo.formattedTextDisplayInfo?.time &&
          info.time > state.streamInfo.formattedTextDisplayInfo.time) ||
        (info.time && !state.streamInfo.formattedTextDisplayInfo?.time)
      )
    );
  },

  effect: async (action, listenerApi) => {
    const churchIdAtStart = globalFireDbInfo.churchId;
    listenerApi.cancelActiveListeners();
    await listenerApi.delay(10);
    if (globalFireDbInfo.churchId !== churchIdAtStart) return;

    listenerApi.dispatch(
      updateFormattedTextDisplayInfoFromRemote(
        action.payload as FormattedTextDisplayInfo,
      ),
    );
  },
});

// handle updating board post stream info from remote
listenerMiddleware.startListening({
  predicate: (action, currentState) => {
    if (action.type !== "debouncedUpdateBoardPostStreamInfo") return false;
    const state = toLegacyPresentationShape(
      (currentState as RootState).presentation,
    );
    const info = action.payload as BoardPostStreamInfo;
    if (!info.time && info.transitionSequence == null) return false;
    const current = state.streamInfo.boardPostStreamInfo;
    // Always apply when incoming has content but local is empty (stream page opened after post was sent)
    return shouldApplyIncomingOverlayPayload(
      current,
      info,
      hasBoardPostData(info),
      hasBoardPostData(current),
    );
  },

  effect: async (action, listenerApi) => {
    const churchIdAtStart = globalFireDbInfo.churchId;
    listenerApi.cancelActiveListeners();
    await listenerApi.delay(10);
    if (globalFireDbInfo.churchId !== churchIdAtStart) return;
    listenerApi.dispatch(
      updateBoardPostStreamInfoFromRemote(
        action.payload as Parameters<
          typeof updateBoardPostStreamInfoFromRemote
        >[0],
      ),
    );
  },
});

// handle updating from remote stream item content blocked
listenerMiddleware.startListening({
  predicate: (action) =>
    action.type === "debouncedUpdateStreamItemContentBlocked",
  effect: async (action, listenerApi) => {
    const churchIdAtStart = globalFireDbInfo.churchId;
    listenerApi.cancelActiveListeners();
    await listenerApi.delay(10);
    if (globalFireDbInfo.churchId !== churchIdAtStart) return;
    listenerApi.dispatch(
      setStreamItemContentBlockedFromRemote(action.payload as boolean),
    );
  },
});

// handle updating monitor board mode from remote (controller swapping the stage
// monitor between presentation content and a discussion board)
listenerMiddleware.startListening({
  predicate: (action) => action.type === "debouncedUpdateMonitorBoardAliasId",
  effect: async (action, listenerApi) => {
    const churchIdAtStart = globalFireDbInfo.churchId;
    listenerApi.cancelActiveListeners();
    await listenerApi.delay(10);
    if (globalFireDbInfo.churchId !== churchIdAtStart) return;
    listenerApi.dispatch(
      setMonitorBoardAliasIdFromRemote(action.payload as string),
    );
  },
});

// handle updating projector board mode from remote (same swap as the monitor,
// for churches putting the board on a projector)
listenerMiddleware.startListening({
  predicate: (action) => action.type === "debouncedUpdateProjectorBoardAliasId",
  effect: async (action, listenerApi) => {
    const churchIdAtStart = globalFireDbInfo.churchId;
    listenerApi.cancelActiveListeners();
    await listenerApi.delay(10);
    if (globalFireDbInfo.churchId !== churchIdAtStart) return;
    listenerApi.dispatch(
      setProjectorBoardAliasIdFromRemote(action.payload as string),
    );
  },
});

// handle updating service times from remote display/controller listeners
listenerMiddleware.startListening({
  predicate: (action, currentState) => {
    if (action.type !== "debouncedUpdateServiceTimes") return false;
    const list = action.payload as ServiceTime[] | undefined;
    if (!Array.isArray(list)) return false;
    const currentList = (currentState as RootState).undoable.present
      .serviceTimes.list;
    return !_.isEqual(list, currentList);
  },

  effect: async (action, listenerApi) => {
    const churchIdAtStart = globalFireDbInfo.churchId;
    listenerApi.cancelActiveListeners();
    await listenerApi.delay(10);
    if (globalFireDbInfo.churchId !== churchIdAtStart) return;
    const services = action.payload as ServiceTime[];

    // Mirror shared-data updates into localStorage so guest monitor/projector/stream
    // windows on this machine receive the same service-time refresh via the storage listener.
    // Guard on shared-data auth state so guest windows do not bounce storage events back and forth.
    if (globalFireDbInfo.db && globalFireDbInfo.churchId) {
      localStorage.setItem("serviceTimes", JSON.stringify(services));
    }

    listenerApi.dispatch(syncServicesFromRemote(services));
  },
});

// handle updating from remote timer info
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    const { timers } = (previousState as RootState).timers;
    const info = action.payload as TimerInfo;
    const timer = timers.find((timer) => timer.id === info?.id);
    const isHost = globalHostId === info?.hostId;
    return (
      action.type === "debouncedUpdateTimerInfo" &&
      !isHost &&
      !!(
        (info.time && timer?.time && info.time > timer.time) ||
        (info.time && !timer?.time)
      )
    );
  },

  effect: async (action, listenerApi) => {
    const churchIdAtStart = globalFireDbInfo.churchId;
    listenerApi.cancelActiveListeners();
    await listenerApi.delay(10);
    if (globalFireDbInfo.churchId !== churchIdAtStart) return;

    listenerApi.dispatch(updateTimerFromRemote(action.payload as TimerInfo));
  },
});

// Handle undo/redo operations to force update affected slices
listenerMiddleware.startListening({
  predicate: (action) => {
    return (
      action.type === "@@redux-undo/UNDO" || action.type === "@@redux-undo/REDO"
    );
  },
  effect: async (action, listenerApi) => {
    const dbAtStart = db;
    const currentState = listenerApi.getState() as RootState;
    const previousState = listenerApi.getOriginalState() as RootState;
    const currentSelectedOverlayId =
      currentState.undoable.present.overlay.selectedOverlay?.id;
    const reconciledOverlaySelection = getOverlaySelectionForUndoRedo(
      currentState,
      previousState,
    );
    const changedOverlayDocs = getChangedOverlayDocsForUndoRedo(
      currentState.undoable.present.overlays.list,
      previousState.undoable.present.overlays.list,
      currentSelectedOverlayId,
    );

    listenerApi.dispatch(itemSlice.actions.clearTransientState());

    const preservedItemSelection = getItemSelectionForUndoRedo(
      previousState.undoable.present.item,
    );

    listenerApi.dispatch(itemSlice.actions.clearBackgroundTargetSelection());

    if (reconciledOverlaySelection !== undefined) {
      const currentSelectedOverlay =
        currentState.undoable.present.overlay.selectedOverlay;

      if (reconciledOverlaySelection === null) {
        if (currentSelectedOverlay) {
          listenerApi.dispatch(overlaySlice.actions.selectOverlay(undefined));
        }
      } else if (
        !_.isEqual(currentSelectedOverlay, reconciledOverlaySelection)
      ) {
        listenerApi.dispatch(
          overlaySlice.actions.selectOverlay(reconciledOverlaySelection),
        );
      }
    }

    reconcileItemSelectionAfterUndoRedo(listenerApi, preservedItemSelection);

    const itemBeforePendingFlush =
      (listenerApi.getState() as RootState).undoable.present.item;
    flushPendingItemMutations(getItemMutationOwner(itemBeforePendingFlush));
    const itemAfterUndoRedo =
      (listenerApi.getState() as RootState).undoable.present.item;
    const itemPersistenceChanged = !_.isEqual(
      sanitizeTransientItemState(itemAfterUndoRedo),
      sanitizeTransientItemState(previousState.undoable.present.item),
    );
    if (itemPersistenceChanged && itemAfterUndoRedo._id) {
      const owner = getItemMutationOwner(itemAfterUndoRedo);
      const contentOwner = itemAfterUndoRedo.contentOwner;
      const itemDatabase = contentOwner
        ? getContentDatabaseForOwner(contentOwner) ??
          (contentOwner.scopeId === "unscoped" ? dbAtStart : undefined)
        : dbAtStart;
      if (itemDatabase) {
        const targetId = itemAfterUndoRedo._id;
        const expectedState = sanitizeTransientItemState(itemAfterUndoRedo);
        const churchIdAtReadStart = globalFireDbInfo.churchId;
        const sessionTokenAtReadStart = getContentDatabaseSessionToken(itemDatabase.name);
        const latestPersistedItem = await loadItemWithSongHydration(itemDatabase, targetId)
          .catch(() => null);
        // A component may still have accepted text queued outside Redux while
        // the authoritative read was pending. Materialize it before deciding
        // whether this response still owns the baseline rebase.
        flushPendingItemMutations(owner);
        const activeItem =
          (listenerApi.getState() as RootState).undoable.present.item;
        const activeContentOwner = getActiveContentDatabaseOwner();
        const databaseIsStillOwned = contentOwner && contentOwner.scopeId !== "unscoped"
          ? activeContentOwner?.scopeId === contentOwner.scopeId &&
            activeContentOwner.databaseKey === contentOwner.databaseKey &&
            activeContentOwner.churchId === contentOwner.churchId &&
            getContentDatabaseForOwner(contentOwner) === itemDatabase
          : db === itemDatabase && !activeContentOwner;
        const noNewerAutosave = !pendingItemAutosaves.has(itemAutosaveKey(itemAfterUndoRedo)) &&
          !itemAutosaveDebounces.has(itemAutosaveKey(itemAfterUndoRedo)) &&
          !itemAutosaveWriteQueues.has(itemAutosaveKey(itemAfterUndoRedo));
        if (
          latestPersistedItem &&
          latestPersistedItem._id === targetId &&
          sameItemMutationScope(itemAfterUndoRedo, activeItem) &&
          databaseIsStillOwned &&
          globalFireDbInfo.churchId === churchIdAtReadStart &&
          getContentDatabaseSessionToken(itemDatabase.name) === sessionTokenAtReadStart &&
          _.isEqual(sanitizeTransientItemState(activeItem), expectedState) &&
          noNewerAutosave
        ) {
          listenerApi.dispatch(
            itemSlice.actions.rebaseItemPersistence(latestPersistedItem),
          );
        }
      }
    }

    // Only force update for slices that actually changed during undo/redo
    if (itemPersistenceChanged) {
      listenerApi.dispatch(itemSlice.actions.forceUpdate());
    }

    if (
      !_.isEqual(
        currentState.undoable.present.overlay,
        previousState.undoable.present.overlay,
      )
    ) {
      listenerApi.dispatch(overlaySlice.actions.forceUpdate());
    }

    if (
      !_.isEqual(
        currentState.undoable.present.overlays,
        previousState.undoable.present.overlays,
      )
    ) {
      listenerApi.dispatch(overlaysSlice.actions.forceUpdate());
    }

    if (
      !_.isEqual(
        currentState.undoable.present.itemList,
        previousState.undoable.present.itemList,
      )
    ) {
      listenerApi.dispatch(itemListSlice.actions.forceUpdate());
    }

    if (
      !_.isEqual(
        currentState.undoable.present.itemLists,
        previousState.undoable.present.itemLists,
      )
    ) {
      listenerApi.dispatch(itemListsSlice.actions.forceUpdate());
    }

    if (
      !_.isEqual(
        currentState.undoable.present.preferences,
        previousState.undoable.present.preferences,
      )
    ) {
      listenerApi.dispatch(preferencesSlice.actions.forceUpdate());
    }

    if (
      !_.isEqual(
        currentState.undoable.present.credits,
        previousState.undoable.present.credits,
      )
    ) {
      listenerApi.dispatch(creditsSlice.actions.forceUpdate());
    }

    if (
      !_.isEqual(
        currentState.undoable.present.overlayTemplates,
        previousState.undoable.present.overlayTemplates,
      )
    ) {
      listenerApi.dispatch(overlayTemplatesSlice.actions.forceUpdate());
    }

    if (dbAtStart && changedOverlayDocs.length > 0) {
      for (const overlay of changedOverlayDocs) {
        try {
          await listenerApi.pause(persistExistingOverlayDoc(dbAtStart, overlay));
        } catch (e) {
          if (isListenerCancelledTaskError(e)) {
            return;
          }
          console.error("undo/redo overlay persist failed", overlay.id, e);
        }
      }
    }
  },
});

// Track when all slices are actually initialized and clear undo history
export let hasFinishedInitialization = false;

const safeRequestIdleCallback =
  window.requestIdleCallback ||
  function (cb) {
    return setTimeout(cb, 1);
  };

// Page-ready actions: each page dispatches when its required slices are initialized.
// Credits editor only needs credits; Controller needs all controller slices (by access).
export const CREDITS_EDITOR_PAGE_READY = "CREDITS_EDITOR_PAGE_READY";
export const CONTROLLER_PAGE_READY = "CONTROLLER_PAGE_READY";
const isCreditsPageReady = (state: RootState) => {
  return state.undoable.present.credits.isInitialized;
};

export const areControllerSlicesReady = (
  state: RootState,
  options: { includeOverlayState?: boolean } = {},
) => {
  const sharedSlicesReady =
    state.allDocs.isInitialized &&
    state.undoable.present.preferences.isInitialized &&
    state.undoable.present.itemList.isInitialized &&
    state.undoable.present.itemLists.isInitialized &&
    isMediaLoadSettled(state.media);

  if (!sharedSlicesReady || options.includeOverlayState === false) {
    return sharedSlicesReady;
  }

  return (
    state.undoable.present.overlays.isInitialized &&
    (state.undoable.present.overlayTemplates as { isInitialized: boolean })
      .isInitialized
  );
};

let initializationGeneration = 0;

listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    if (action.type === "RESET_INITIALIZATION") {
      hasFinishedInitialization = false;
      initializationGeneration += 1;
    }

    const explicitPageReady =
      action.type === CREDITS_EDITOR_PAGE_READY ||
      action.type === CONTROLLER_PAGE_READY;
    if (explicitPageReady) return true;

    // Fallback for hot reload / full reload: no page-ready was dispatched yet
    // but state already has a page's slices initialized. Any state change can trigger this.
    if (hasFinishedInitialization) return false;
    if (currentState === previousState) return false;

    const state = currentState as RootState;
    const ready = isCreditsPageReady(state) || areControllerSlicesReady(state);
    return ready;
  },

  effect: async (_, listenerApi) => {
    if (!hasFinishedInitialization) {
      hasFinishedInitialization = true;
      const generation = initializationGeneration;
      safeRequestIdleCallback(
        () => {
          if (!hasFinishedInitialization || generation !== initializationGeneration) {
            return;
          }
          listenerApi.dispatch(ActionCreators.clearHistory());
        },
        { timeout: 10000 },
      );
    }
  },
});

// listenerMiddleware.startListening({
//   predicate: (action, currentState, previousState) => {
//     return currentState !== previousState;
//   },
//   effect: async (action, listenerApi) => {
//     console.log(action);
//   },
// });

const combinedReducers = combineReducers({
  undoable: undoableReducers,
  presentation: presentationSlice.reducer,
  bible: bibleSlice.reducer,
  itemLibraryUi: itemLibraryUiSlice.reducer,
  createItem: createItemSlice.reducer,
  allDocs: allDocsSlice.reducer,
  timers: timersSlice.reducer,
  media: mediaItemsSlice.reducer,
  mediaCacheMap: mediaCacheMapReducer,
  overlayTemplates: overlayTemplatesSlice.reducer,
  autosaveIndicator: autosaveIndicatorSlice.reducer,
  servicePlanningImport: servicePlanningImportSlice.reducer,
  generatedCredits: generatedCreditsSlice.reducer,
  displayOutputs: displayOutputsSlice.reducer,
  controllerProfiles: controllerProfilesSlice.reducer,
});

type RetainedOutlineState = Pick<RootState["undoable"]["present"]["itemList"], "remoteConflicts" | "pendingRevisionResolutions">;
const outlineDraftsByDb = new Map<object | string, RetainedOutlineState>();
const outlineDraftDatabaseKey = (database: NonNullable<typeof db>) => database.name || database;
let outlineStateDatabase = db;
let outlineAccountSession = 0;

type OutlineDatabaseAction = Action & {
  meta?: { outlineDatabaseKey?: string; outgoingOutlineDatabase?: typeof db; outlineOwnerKey?: string };
};

const rootReducer: Reducer = (state: RootState, action: OutlineDatabaseAction) => {
  const historyOutline = action.type === "@@redux-undo/UNDO" || action.type === "@@redux-undo/REDO"
    ? state?.undoable.present.itemList : undefined;
  const databaseChanged = outlineStateDatabase !== db;
  if (action.type === "RESET") {
    // Clear before caching/reducing: logout must never save or rehydrate the
    // previous account's unsaved drafts, even with the same database handle.
    outlineDraftsByDb.clear();
    outlineAccountSession += 1;
  } else if (outlineStateDatabase && state?.undoable?.present.itemList) {
    const { remoteConflicts, pendingRevisionResolutions } = state.undoable.present.itemList;
    const key = outlineDraftDatabaseKey(outlineStateDatabase);
    if (Object.keys(remoteConflicts).length) outlineDraftsByDb.set(key, { remoteConflicts, pendingRevisionResolutions });
    else outlineDraftsByDb.delete(key);
  }
  outlineStateDatabase = db;
  if (action.type === "RESET") {
    state = {} as RootState;
  } else if (action.type === "RESET_CONTROLLER_SESSION") {
    // Church registries are app-root synced and must survive leaving a
    // controller; wiping them flashes default names on Home until Firebase
    // re-attaches. Logout / church switch still use full RESET.
    state = {
      controllerProfiles: state?.controllerProfiles,
      displayOutputs: state?.displayOutputs,
      allDocs: state?.allDocs,
      itemLibraryUi: state?.itemLibraryUi,
    } as RootState;
  }
  const reduced = combinedReducers(state, action);
  const retained = action.type === "RESET" ? undefined : historyOutline ? {
    remoteConflicts: historyOutline.remoteConflicts,
    pendingRevisionResolutions: historyOutline.pendingRevisionResolutions,
  } : db && (isStoreResetAction(action) || databaseChanged)
    ? outlineDraftsByDb.get(outlineDraftDatabaseKey(db)) ?? (databaseChanged ? { remoteConflicts: {}, pendingRevisionResolutions: {} } : undefined)
    : undefined;
  let next = reduced;
  if (retained) {
    const itemList = { ...reduced.undoable.present.itemList, ...retained };
    const outlineId = itemList.loadedOutlineId;
    if (historyOutline && outlineId && retained.remoteConflicts[outlineId]) {
      const conflict = retained.remoteConflicts[outlineId];
      itemList.remoteConflicts = { ...retained.remoteConflicts, [outlineId]: { ...conflict, localItems: itemList.list } };
      itemList.syncBaseline = conflict.remoteItems;
      itemList.hasPendingUpdate = true;
    }
    next = {
      ...reduced,
      undoable: {
        ...reduced.undoable,
        present: { ...reduced.undoable.present, itemList },
      },
    };
  }
  const present = next.undoable.present;
  const databaseKey = action.meta?.outlineDatabaseKey ?? present.itemLists.contentDatabaseKey ?? "";
  const ownerKey = getOutlineOwnerKey(databaseKey, present.itemLists.selectedList?._id);
  if (present.itemList.outlineOwnerKey === ownerKey && present.itemLists.contentDatabaseKey === databaseKey) return next;

  // Selection and content retirement must be one observable Redux transition,
  // including scope changes and registry-driven fallback selection.
  const activate = activateOutlineContent({ ownerKey, hasSelection: !!present.itemLists.selectedList });
  const adoptingUnselectedDatabase = !state?.undoable?.present.itemLists.selectedList &&
    !present.itemLists.selectedList && !state?.undoable?.present.itemLists.contentDatabaseKey;
  const activatedPresent = {
    ...present,
    itemLists: { ...present.itemLists, contentDatabaseKey: databaseKey },
    itemList: adoptingUnselectedDatabase ? { ...present.itemList, outlineOwnerKey: ownerKey } : itemListSlice.reducer(present.itemList, activate),
    overlays: adoptingUnselectedDatabase ? { ...present.overlays, outlineOwnerKey: ownerKey } : overlaysSlice.reducer(present.overlays, activate),
    overlay: overlaySlice.reducer(present.overlay, activate),
  };
  return {
    ...next,
    undoable: newHistory([], activatedPresent, []),
    servicePlanningImport: servicePlanningImportSlice.reducer(next.servicePlanningImport,
      servicePlanningImportSlice.actions.setServicePlanningOutlinePlanBinding(null)),
  };
};

// Carry concrete database ownership into the pure reducer and outgoing-save
// listeners. A DB change can retire the same outline ID in another session.
let lastOutlineDatabase: typeof db;
const outlineDatabaseMiddleware: Middleware = (api) => (next) => (input: unknown) => {
  if (typeof input !== "object" || input === null || !("type" in input)) return next(input);
  let action = input as OutlineDatabaseAction;
  if (overlaySlice.actions.selectOverlay.type === action.type) {
    action = { ...action, meta: { ...action.meta, outlineOwnerKey: (api.getState() as RootState).undoable.present.itemList.outlineOwnerKey } };
  }
  const isDatabaseAction = setOutlineContentDatabase.type === action.type;
  if (db === lastOutlineDatabase && !isDatabaseAction) return next(action);
  const outgoingOutlineDatabase = lastOutlineDatabase;
  lastOutlineDatabase = db;
  const outlineDatabaseKey = isDatabaseAction
    ? (action as ReturnType<typeof setOutlineContentDatabase>).payload
    : db ? getOutlineDatabaseKey(db) : "";
  return next({ ...action, meta: { ...action.meta, outlineDatabaseKey, outgoingOutlineDatabase } });
};

const itemOwnerTransitionMiddleware: Middleware = (api) => (next) => (action: any) => {
  const currentItem = (api.getState() as RootState).undoable.present.item;
  const currentOwner = getItemMutationOwner(currentItem);

  const activeDatabaseOwner = getActiveContentDatabaseOwner();
  const itemBelongsToActiveDatabase = activeDatabaseOwner
    ? currentItem.contentOwner?.scopeId === activeDatabaseOwner.scopeId &&
      currentItem.contentOwner.databaseKey === activeDatabaseOwner.databaseKey &&
      currentItem.contentOwner.churchId === activeDatabaseOwner.churchId
    : !currentItem.contentOwner ||
      currentItem.contentOwner.scopeId === "unscoped";

  if (
    (itemSlice.actions.bufferRemoteItemUpdate.match(action) || itemSlice.actions.bufferSongV2RevisionConflict.match(action)) &&
    !itemBelongsToActiveDatabase
  ) {
    return action;
  }

  if (itemSlice.actions.bufferRemoteItemUpdate.match(action) || itemSlice.actions.bufferSongV2RevisionConflict.match(action) ||
    itemSlice.actions.markItemPersisted.match(action)) {
    flushPendingItemMutations(currentOwner);
  }
  if (itemSlice.actions.bufferSongV2RevisionConflict.match(action)) {
    const pending = pendingItemAutosaves.get(itemAutosaveKey(currentItem));
    if (pending) pendingItemAutosaves.set(itemAutosaveKey(currentItem), {
      ...pending, mutationVersion: ++itemAutosaveMutationVersion,
    });
  }

  if (itemSlice.actions.applyPendingRemoteItem.match(action)) {
    if (
      !itemBelongsToActiveDatabase ||
      currentItem.pendingRemoteItem?._id !== currentItem._id
    ) {
      api.dispatch(itemSlice.actions.discardPendingRemoteItem());
      return action;
    }
    flushPendingItemMutations(currentOwner);
    const latestItem = (api.getState() as RootState).undoable.present.item;
    if (action.payload && (latestItem.hasPendingUpdate || (latestItem.isLyricsEditorOpen && !action.meta?.allowLyricsEditorOpen))) return action;

    const saveKey = itemAutosaveKey(latestItem);
    const recovery = pendingSongV2WriteRecoveries.get(saveKey) ?? pendingItemAutosaves.get(saveKey);
    const recoveryRecordId = recovery?.recoveryRecordId;
    const recoveryOwner = recovery?.owner;
    const requestedRecoveryMutationVersion = recovery?.mutationVersion;
    const requestedRemoteItem = latestItem.pendingRemoteItem;
    const requestedRemoteRevision = requestedRemoteItem?._rev;
    const songV2ConflictFingerprint = (
      conflicts: ItemState["pendingSongV2Conflicts"],
    ) => JSON.stringify(
      (conflicts ?? [])
        .map(conflict => ({
          documentId: conflict.documentId,
          winningRevision: conflict.winningRevision,
          revisions: [...conflict.revisions].sort(),
        }))
        .sort((left, right) => left.documentId.localeCompare(right.documentId)),
    );
    const requestedConflicts = songV2ConflictFingerprint(latestItem.pendingSongV2Conflicts);
    const requestedMutationVersion = pendingItemAutosaves.get(saveKey)?.mutationVersion ??
      recovery?.mutationVersion;
    const beginExplicitRemoteDecision = (discarding: boolean) => {
      const previous = explicitRemoteDecisionByItem.get(saveKey);
      const nextDecision = { version: (previous?.version ?? 0) + 1, discarding };
      explicitRemoteDecisionByItem.set(saveKey, nextDecision);
      return nextDecision.version;
    };

    if (!recoveryRecordId || !recoveryOwner) {
      beginExplicitRemoteDecision(false);
      clearSongRecoveryCheckpointRetry(saveKey);
      cancelItemAutosaveDebounce(saveKey);
      pendingItemAutosaves.delete(saveKey);
      pendingSongV2WriteRecoveries.delete(saveKey);
      return next(action);
    }

    // Stop any in-flight writer before yielding to IndexedDB. If the durable
    // discard fails, its checkpoint remains and the operator can retry or keep
    // the draft; the stale writer does not continue in the meantime.
    const decisionVersion = beginExplicitRemoteDecision(true);
    const finishExplicitRemoteDecision = () => {
      const decision = explicitRemoteDecisionByItem.get(saveKey);
      if (decision?.version === decisionVersion) {
        explicitRemoteDecisionByItem.set(saveKey, { ...decision, discarding: false });
      }
    };
    const decisionSessionToken = getContentDatabaseSessionToken(recovery.database.name);
    const decisionOwnerIsCurrent = () => {
      const active = (api.getState() as RootState).undoable.present.item;
      return db === recovery.database &&
        getContentDatabaseSessionToken(recovery.database.name) === decisionSessionToken &&
        active._id === latestItem._id &&
        sameItemMutationOwner(getItemMutationOwner(active), currentOwner) &&
        sameItemMutationOwner(getItemMutationOwner(active), recoveryOwner) &&
        getContentDatabaseForOwner(recoveryOwner) === recovery.database &&
        globalFireDbInfo.churchId === recoveryOwner.churchId &&
        explicitRemoteDecisionByItem.get(saveKey)?.version === decisionVersion;
    };
    const sameRequestedRemoteDecision = () => {
      const active = (api.getState() as RootState).undoable.present.item;
      const currentPending = pendingItemAutosaves.get(saveKey);
      return decisionOwnerIsCurrent() &&
        active.pendingRemoteItem?._id === requestedRemoteItem?._id &&
        active.pendingRemoteItem?._rev === requestedRemoteRevision &&
        songV2ConflictFingerprint(active.pendingSongV2Conflicts) === requestedConflicts &&
        (!currentPending || currentPending.mutationVersion === requestedMutationVersion);
    };
    let acquiredLock = false;
    return withSongV2AutosaveLock(
      latestItem._id,
      recovery.database.name,
      async () => {
        acquiredLock = true;
        if (!decisionOwnerIsCurrent()) {
          finishExplicitRemoteDecision();
          return action;
        }
        if (latestItem.docType === "song-v2-root" && requestedRemoteItem) {
          let currentSnapshot: Awaited<ReturnType<typeof loadSongV2Snapshot>>;
          try {
            currentSnapshot = await loadSongV2Snapshot(
              recovery.database,
              latestItem._id,
              true,
            );
          } catch (error) {
            console.error("Could not verify the current song before applying the remote snapshot", error);
            finishExplicitRemoteDecision();
            if (!decisionOwnerIsCurrent()) return action;
            api.dispatch(itemSlice.actions.setRemoteUpdateReason("song-recovery-discard-failed"));
            return action;
          }
          if (!decisionOwnerIsCurrent()) {
            finishExplicitRemoteDecision();
            return action;
          }
          const remoteSnapshotIsCurrent =
            requestedRemoteItem._rev === currentSnapshot.root._rev &&
            sameSongV2AuthoredContent(
              serializeSongToV2Documents(requestedRemoteItem),
              currentSnapshot,
            ) &&
            requestedConflicts === songV2ConflictFingerprint(currentSnapshot.conflicts);
          if (!remoteSnapshotIsCurrent) {
            // A successful save may have advanced this song after the UI
            // offered its choice. Refresh the offer and let the editor apply
            // the current snapshot after the usual clean-state checks.
            if (currentSnapshot.conflicts?.length) {
              api.dispatch(itemSlice.actions.bufferSongV2RevisionConflict({
                item: currentSnapshot.hydrated,
                conflicts: currentSnapshot.conflicts,
              }));
            } else {
              api.dispatch(itemSlice.actions.bufferRemoteItemUpdate(currentSnapshot.hydrated));
              api.dispatch(itemSlice.actions.setRemoteUpdateReason("song-content-conflict"));
            }
            finishExplicitRemoteDecision();
            return action;
          }
        }
        if (!sameRequestedRemoteDecision()) {
          finishExplicitRemoteDecision();
          return action;
        }
        try {
          await markSongV2AutosaveRecoveryDiscarded(
            recoveryRecordId,
            recoveryOwner,
            latestItem._id,
          );
        } catch (error) {
          console.error("Could not durably discard the saved song recovery", error);
          const currentRecovery = pendingSongV2WriteRecoveries.get(saveKey);
          if (currentRecovery?.recoveryRecordId === recoveryRecordId) {
            pendingSongV2WriteRecoveries.set(saveKey, {
              ...currentRecovery,
              recoveryState: "discard-failed",
            });
          }
          const currentPending = pendingItemAutosaves.get(saveKey);
          if (currentPending?.recoveryRecordId === recoveryRecordId) {
            pendingItemAutosaves.set(saveKey, {
              ...currentPending,
              recoveryState: "discard-failed",
            });
          }
          finishExplicitRemoteDecision();
          api.dispatch(itemSlice.actions.setRemoteUpdateReason("song-recovery-discard-failed"));
          return action;
        }

        const currentRecovery = pendingSongV2WriteRecoveries.get(saveKey);
        const currentPending = pendingItemAutosaves.get(saveKey);
        const recoveryVersionMatches = requestedRecoveryMutationVersion === undefined ||
          !currentRecovery || currentRecovery.mutationVersion === requestedRecoveryMutationVersion;
        const pendingVersionMatches = !currentPending ||
          currentPending.mutationVersion === requestedMutationVersion;
        const recoveryStillCurrent =
          (!currentRecovery || currentRecovery.recoveryRecordId === recoveryRecordId) &&
          (!currentPending || currentPending.recoveryRecordId === recoveryRecordId) &&
          recoveryVersionMatches && pendingVersionMatches;
        if (currentRecovery?.recoveryRecordId === recoveryRecordId) {
          pendingSongV2WriteRecoveries.delete(saveKey);
        }
        if (currentPending?.recoveryRecordId === recoveryRecordId && pendingVersionMatches) {
          pendingItemAutosaves.delete(saveKey);
        } else if (currentPending?.recoveryRecordId === recoveryRecordId) {
          pendingItemAutosaves.set(saveKey, {
            ...currentPending,
            recoveryRecordId: undefined,
            recoveryState: undefined,
          });
        }
        if (recoveryVersionMatches && pendingVersionMatches) {
          clearSongRecoveryCheckpointRetry(saveKey);
          cancelItemAutosaveDebounce(saveKey);
        }
        // Keep a small durable tombstone so a stale operation in another window
        // cannot recreate the rejected checkpoint after this lock is released.
        finishExplicitRemoteDecision();

        const sameRemoteDecision = sameRequestedRemoteDecision() && pendingVersionMatches;
        if (!recoveryStillCurrent || !sameRemoteDecision) return action;
        return next(action);
      },
    ).catch(error => {
      if (acquiredLock) throw error;
      console.error("Could not acquire the Song V2 recovery lock", error);
      const currentRecovery = pendingSongV2WriteRecoveries.get(saveKey);
      if (currentRecovery?.recoveryRecordId === recoveryRecordId) {
        pendingSongV2WriteRecoveries.set(saveKey, {
          ...currentRecovery,
          recoveryState: "discard-failed",
        });
      }
      const currentPending = pendingItemAutosaves.get(saveKey);
      if (currentPending?.recoveryRecordId === recoveryRecordId) {
        pendingItemAutosaves.set(saveKey, {
          ...currentPending,
          recoveryState: "discard-failed",
        });
      }
      finishExplicitRemoteDecision();
      api.dispatch(itemSlice.actions.setRemoteUpdateReason("song-recovery-discard-failed"));
      return action;
    });
  }

  if (
    itemSlice.actions.setSelectedSlide.match(action) ||
    itemSlice.actions._setSelectedArrangement.match(action) ||
    action.type === "@@redux-undo/UNDO" ||
    action.type === "@@redux-undo/REDO" ||
    action.type === "RESET" ||
    action.type === "RESET_CONTROLLER_SESSION"
  ) {
    flushPendingItemMutations(currentOwner);
    return next(action);
  }

  if (!itemSlice.actions.setActiveItem.match(action)) return next(action);

  const contentOwner =
    activeDatabaseOwner ??
    { scopeId: "unscoped", databaseKey: "", churchId: "" };
  const nextOwner = getItemMutationOwner({
    ...action.payload,
    contentOwner,
    _id: action.payload._id ?? currentItem._id,
    type: action.payload.type ?? currentItem.type,
  } as typeof currentItem);

  if (!sameItemMutationOwner(currentOwner, nextOwner)) {
    flushPendingItemMutations(currentOwner);
  }

  const result = next({
    ...action,
    payload: { ...action.payload, contentOwner },
  });
  const activatedItem = (api.getState() as RootState).undoable.present.item;
  const saveKey = itemAutosaveKey(activatedItem);
  const pending = pendingItemAutosaves.get(saveKey);
  const recovery = pendingSongV2WriteRecoveries.get(saveKey);
  if (pending) restoreSongV2RecoveryDraftInEditor(pending);
  if (recovery) restoreSongV2RecoveryDraftInEditor(recovery);
  return result;
};

const store = configureStore({
  reducer: rootReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: false,
    }).prepend(
      outlineDatabaseMiddleware,
      itemOwnerTransitionMiddleware,
      listenerMiddleware.middleware,
    ),
});

const requestPendingItemAutosaveRetry = (
  saveKey: string,
  pending: PendingItemAutosave,
  recovery: boolean,
) => {
  const retryId = `${saveKey}:${pending.mutationVersion}:${recovery ? "recovery" : "pending"}`;
  if (queuedItemAutosaveRetries.has(retryId)) return;
  queuedItemAutosaveRetries.add(retryId);
  store.dispatch(retryPendingItemAutosave({
    saveKey,
    mutationVersion: pending.mutationVersion,
    recovery,
  }));
};

const queuedSongV2RecoveryReviewLoads = new Set<string>();
const restoreSongV2RecoveryDraftInEditor = (pending: PendingItemAutosave) => {
  if (pending.recoveryState === "discarded" || pending.recoveryState === "discard-failed") return;
  const activeItem = store.getState().undoable.present.item;
  const owner = pending.owner;
  if (!owner || !sameItemMutationOwner(owner, getItemMutationOwner(activeItem))) return;
  const saveKey = itemAutosaveKey(pending.desired);
  const currentPending = pendingItemAutosaves.get(saveKey);
  if (!currentPending || currentPending.mutationVersion <= pending.mutationVersion) {
    store.dispatch(itemSlice.actions.restorePendingItemEdits({
      owner,
      desired: pending.desired,
      baseline: pending.baseline,
    }));
  }
  if (pending.recoveryState !== "needs-review" || !songRecoveryIsReadyForOwner(owner, pending.database)) return;
  const loadKey = `${saveKey}:${pending.recoveryRecordId ?? pending.mutationVersion}`;
  if (queuedSongV2RecoveryReviewLoads.has(loadKey)) return;
  queuedSongV2RecoveryReviewLoads.add(loadKey);
  void loadSongV2Snapshot(pending.database, pending.desired._id, true)
    .then(snapshot => {
      const latestItem = store.getState().undoable.present.item;
      const currentRecovery = pendingSongV2WriteRecoveries.get(saveKey);
      if (
        currentRecovery?.recoveryState !== "needs-review" ||
        currentRecovery.recoveryRecordId !== pending.recoveryRecordId ||
        !songRecoveryIsReadyForOwner(owner, pending.database) ||
        !sameItemMutationOwner(getItemMutationOwner(latestItem), owner)
      ) return;
      if (snapshot.conflicts?.length) {
        store.dispatch(itemSlice.actions.bufferSongV2RevisionConflict({
          item: snapshot.hydrated,
          conflicts: snapshot.conflicts,
        }));
      } else {
        store.dispatch(itemSlice.actions.bufferRemoteItemUpdate(snapshot.hydrated));
        store.dispatch(itemSlice.actions.setRemoteUpdateReason("song-content-conflict"));
      }
    })
    .catch(error => console.error("Could not restore the interrupted song conflict", error))
    .finally(() => queuedSongV2RecoveryReviewLoads.delete(loadKey));
};

const pendingAutosaveMatchesContentOwner = (
  pending: PendingItemAutosave,
  owner: ItemContentOwner,
  database: PouchDB.Database,
) => Boolean(
  pending.owner &&
  pending.owner.scopeId === owner.scopeId &&
  pending.owner.databaseKey === owner.databaseKey &&
  pending.owner.churchId === owner.churchId &&
  pending.owner.accountId === owner.accountId &&
  pending.database.name === database.name,
);

const songRecoveryIsReadyForOwner = (
  owner: ItemContentOwner,
  database: PouchDB.Database,
) => {
  const sessionToken = getContentDatabaseSessionToken(database.name);
  return Boolean(
    sessionToken &&
    hasSuccessfulInitialContentReplication(database.name, sessionToken) &&
    getActiveContentDatabaseOwner()?.scopeId === owner.scopeId &&
    getActiveContentDatabaseOwner()?.accountId === owner.accountId &&
    getActiveContentDatabaseOwner()?.churchId === owner.churchId &&
    getContentDatabaseForOwner(owner) === database,
  );
};

const scheduleSongRecoveryCheckpointRetry = (
  saveKey: string,
  failed: PendingItemAutosave,
) => {
  const owner = failed.owner;
  const database = failed.database;
  if (
    failed.recoveryState !== "checkpoint-failed" ||
    !owner ||
    !songRecoveryIsReadyForOwner(owner, database) ||
    globalFireDbInfo.canWriteSongContent !== true ||
    globalFireDbInfo.churchId !== owner.churchId
  ) return;

  clearSongRecoveryCheckpointRetry(saveKey);
  const retryCount = failed.recoveryCheckpointRetryCount ?? 0;
  const delayMs = SONG_RECOVERY_CHECKPOINT_RETRY_DELAYS_MS[retryCount];
  if (delayMs === undefined) return;
  const sessionToken = getContentDatabaseSessionToken(database.name);
  if (!sessionToken) return;

  const retryVersion = retryCount + 1;
  const withRetryCount = { ...failed, recoveryCheckpointRetryCount: retryVersion };
  if (pendingItemAutosaves.get(saveKey)?.mutationVersion === failed.mutationVersion) {
    pendingItemAutosaves.set(saveKey, withRetryCount);
  }
  if (pendingSongV2WriteRecoveries.get(saveKey)?.mutationVersion === failed.mutationVersion) {
    pendingSongV2WriteRecoveries.set(saveKey, withRetryCount);
  }

  const timer = setTimeout(() => {
    const scheduled = songRecoveryCheckpointRetryTimers.get(saveKey);
    if (scheduled?.timer === timer) songRecoveryCheckpointRetryTimers.delete(saveKey);
    const pendingRecovery = pendingSongV2WriteRecoveries.get(saveKey);
    const pendingAutosave = pendingItemAutosaves.get(saveKey);
    const current = pendingRecovery?.mutationVersion === failed.mutationVersion
      ? pendingRecovery : pendingAutosave;
    if (
      !current ||
      current.mutationVersion !== failed.mutationVersion ||
      current.recoveryState !== "checkpoint-failed" ||
      getContentDatabaseSessionToken(database.name) !== sessionToken ||
      !pendingAutosaveMatchesContentOwner(current, owner, database)
    ) return;
    retryInterruptedAutosaveForOwner(saveKey, owner, database);
  }, delayMs);
  songRecoveryCheckpointRetryTimers.set(saveKey, {
    timer,
    mutationVersion: failed.mutationVersion,
    sessionToken,
  });
};

const retryInterruptedAutosaveForOwner = (
  saveKey: string,
  owner: ItemContentOwner,
  database: PouchDB.Database,
) => {
  if (globalFireDbInfo.canWriteSongContent !== true ||
    globalFireDbInfo.churchId !== owner.churchId ||
    !autosaveBelongsToContentDatabase(saveKey, owner.scopeId) ||
    !songRecoveryIsReadyForOwner(owner, database)) return;
  const recovery = pendingSongV2WriteRecoveries.get(saveKey);
  if (recovery) {
    if (recovery.recoveryState === "needs-review" || recovery.recoveryState === "discard-failed" ||
      recovery.recoveryState === "discarded" ||
      !pendingAutosaveMatchesContentOwner(recovery, owner, database)) return;
    clearSongRecoveryCheckpointRetry(saveKey);
    const rebound = { ...recovery, database };
    pendingSongV2WriteRecoveries.set(saveKey, rebound);
    requestPendingItemAutosaveRetry(saveKey, rebound, true);
    return;
  }
  const pending = pendingItemAutosaves.get(saveKey);
  if (
    (pending?.recoveryState !== "interrupted" && pending?.recoveryState !== "checkpoint-failed") ||
    !pendingAutosaveMatchesContentOwner(pending, owner, database)
  ) return;
  clearSongRecoveryCheckpointRetry(saveKey);
  const rebound = {
    ...pending,
    database,
    recoveryState: undefined,
  };
  pendingItemAutosaves.set(saveKey, rebound);
  requestPendingItemAutosaveRetry(saveKey, rebound, false);
};

const recoveryLoadsInProgress = new Set<string>();
const loadPersistedSongV2RecoveriesForOwner = async (
  owner: ItemContentOwner,
  database: PouchDB.Database,
) => {
  if (
    globalFireDbInfo.canWriteSongContent !== true ||
    globalFireDbInfo.churchId !== owner.churchId ||
    !songRecoveryIsReadyForOwner(owner, database)
  ) return;
  const sessionToken = getContentDatabaseSessionToken(database.name);
  const loadingKey = JSON.stringify([owner.scopeId, owner.accountId, database.name]);
  if (recoveryLoadsInProgress.has(loadingKey)) return;
  recoveryLoadsInProgress.add(loadingKey);
  try {
    const records = await listSongV2AutosaveRecoveries(owner);
    if (
      !sessionToken ||
      getContentDatabaseSessionToken(database.name) !== sessionToken ||
      !songRecoveryIsReadyForOwner(owner, database) ||
      globalFireDbInfo.canWriteSongContent !== true ||
      globalFireDbInfo.churchId !== owner.churchId
    ) return;

    for (const record of records) {
      if (
        getContentDatabaseSessionToken(database.name) !== sessionToken ||
        !songRecoveryIsReadyForOwner(owner, database) ||
        globalFireDbInfo.canWriteSongContent !== true ||
        globalFireDbInfo.churchId !== owner.churchId
      ) break;
      if (record.status === "discarded") {
        continue;
      }
      if (record.itemId !== record.desired._id || record.desired.type !== "song") continue;
      const desired = { ...record.desired, contentOwner: owner };
      const saveKey = itemAutosaveKey(desired);
      const ownerWithItem = getItemMutationOwner(desired);
      if (!ownerWithItem) continue;
      const existingRecovery = pendingSongV2WriteRecoveries.get(saveKey);
      if (existingRecovery) {
        retryInterruptedAutosaveForOwner(saveKey, owner, database);
        continue;
      }
      const recovered: PendingItemAutosave = {
        desired,
        baseline: record.baseline,
        database,
        owner: ownerWithItem,
        // Mutation versions are process-local. Zero makes any new edit in this
        // renderer newer while keeping this persisted predecessor first.
        mutationVersion: 0,
        resolveReplicationConflicts: record.resolveReplicationConflicts,
        recoveryRecordId: record.id,
        recoveryState: record.status === "needs-review" ? "needs-review" : undefined,
      };
      pendingSongV2WriteRecoveries.set(saveKey, recovered);
      if (!pendingItemAutosaves.has(saveKey)) {
        pendingItemAutosaves.set(saveKey, recovered);
      }

      const activeItem = store.getState().undoable.present.item;
      if (sameItemMutationOwner(getItemMutationOwner(activeItem), ownerWithItem)) {
        restoreSongV2RecoveryDraftInEditor(recovered);
      }
      retryInterruptedAutosaveForOwner(saveKey, owner, database);
    }
  } catch (error) {
    // Leave the durable record untouched. A later replication activity or
    // database activation will retry the owner-scoped scan.
    console.error("Could not load interrupted Song V2 autosaves", error);
  } finally {
    recoveryLoadsInProgress.delete(loadingKey);
  }
};

registerContentDatabaseActivationHandler((owner, database) => {
  if (globalFireDbInfo.canWriteSongContent !== true || globalFireDbInfo.churchId !== owner.churchId) return;
  const saveKeys = new Set([
    ...pendingSongV2WriteRecoveries.keys(),
    ...[...pendingItemAutosaves.entries()]
      .filter(([, pending]) => pending.recoveryState === "interrupted" || pending.recoveryState === "checkpoint-failed")
      .map(([saveKey]) => saveKey),
  ]);
  saveKeys.forEach(saveKey => retryInterruptedAutosaveForOwner(saveKey, owner, database));
  void loadPersistedSongV2RecoveriesForOwner(owner, database);
});

subscribeToContentActivity(() => {
  store.dispatch(bibleCleanupOpportunity({}));
  const owner = getActiveContentDatabaseOwner();
  const activeDatabase = owner && getContentDatabaseForOwner(owner);
  if (owner && activeDatabase) {
    const saveKeys = new Set([
      ...pendingSongV2WriteRecoveries.keys(),
      ...[...pendingItemAutosaves.entries()]
        .filter(([, pending]) => pending.recoveryState === "interrupted" || pending.recoveryState === "checkpoint-failed")
        .map(([saveKey]) => saveKey),
    ]);
    saveKeys.forEach(saveKey => retryInterruptedAutosaveForOwner(saveKey, owner, activeDatabase));
    void loadPersistedSongV2RecoveriesForOwner(owner, activeDatabase);
  }
});
subscribeToActiveControllerPresence(() => {
  store.dispatch(bibleCleanupOpportunity({}));
});

registerContentDatabaseFlushHandler((owner) =>
  flushItemAutosavesForContentDatabase(owner.scopeId),
);
registerContentDatabaseFlushHandler(async (owner, database) => {
  const binding = pendingRegistryQueuesByOwner.get(owner.scopeId);
  if (!binding || binding.database !== database) return;
  // flush() waits for an existing write or drains the current debounce queue.
  // Failed/conflicting entries remain in the owner-bound queue and publish the
  // existing Retry save / Keep my changes state instead of blocking teardown.
  await binding.queue.flush();
  releaseIdleRegistryQueue(owner.scopeId, database, binding.queue);
});

const refreshServicePlanningPreviewSongMatches = (listenerApi: {
  getState: () => unknown;
  dispatch: (action: ReturnType<typeof refreshPreviewSongMatches>) => void;
}) => {
  const state = listenerApi.getState() as RootState;
  if (!state.servicePlanningImport.preview) return;
  listenerApi.dispatch(refreshPreviewSongMatches(selectSongLibrary(state).songs));
};

// Keep previews aligned only when durable song documents change.
listenerMiddleware.startListening({
  predicate: (_, current, previous) =>
    (current as RootState).allDocs.allSongDocs !== (previous as RootState).allDocs.allSongDocs,
  effect: (_, listenerApi) => {
    refreshServicePlanningPreviewSongMatches(listenerApi);
  },
});

export default store;

// Infer the `RootState` and `AppDispatch` types from the store itself
export type RootState = ReturnType<typeof combinedReducers>;
// Inferred type: {posts: PostsState, comments: CommentsState, users: UsersState}
export type AppDispatch = typeof store.dispatch;
