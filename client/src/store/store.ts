import {
  Action,
  combineReducers,
  configureStore,
  createListenerMiddleware,
  isAnyOf,
  Reducer,
} from "@reduxjs/toolkit";
import undoable, { ActionCreators } from "redux-undo";
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
import { itemDocMatchesEditorState, itemSlice } from "./itemSlice";
import { overlaysSlice } from "./overlaysSlice";
import { bibleSlice } from "./bibleSlice";
import { isMonitorShowingTimerCountdownSlide } from "../utils/monitorTimerPresentation";
import { itemListSlice } from "./itemListSlice";
import { allItemsSlice } from "./allItemsSlice";
import { createItemSlice } from "./createItemSlice";
import { preferencesSlice } from "./preferencesSlice";
import { itemListsSlice } from "./itemListsSlice";
import { isMediaLoadSettled, mediaItemsSlice } from "./mediaSlice";
import mediaCacheMapReducer, { setMediaCacheMap } from "./mediaCacheMapSlice";
import { overlaySlice } from "./overlaySlice";
import { globalDb as db, globalBroadcastRef } from "../context/controllerInfo";
import { globalFireDbInfo, globalHostId } from "../context/globalInfo";
import { ref, set, get, runTransaction, update } from "firebase/database";
import {
  BibleDisplayInfo,
  BoardPostStreamInfo,
  DBAllItems,
  DBCredit,
  DBCredits,
  DBItem,
  DBItemListDetails,
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
  getCreditsDocId,
  getControllerMediaRouteFoldersDocId,
  OverlayInfo,
  Presentation,
  ServiceTime,
  TimerInfo,
} from "../types";
import { allDocsSlice, upsertItemInAllDocs } from "./allDocsSlice";
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
import { createSongLibraryIndexRepairMiddleware } from "./songLibraryIndexRepair";
import { freeFormDocToServiceItem } from "../utils/freeFormLibrary";
import { extractMediaUrlsFromBackgrounds } from "../utils/mediaCacheUtils";
import { persistMediaStateChanges } from "../utils/mediaDocUtils";
import { normalizeOverlayForSync } from "../utils/overlayUtils";
import { persistExistingOverlayDoc } from "../utils/persistOverlayDoc";
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
  isFirebasePermissionDenied,
  logFirebaseOperationFailure,
} from "../utils/firebaseListeners";
import { notifyPresentationSyncError } from "../utils/presentationSyncErrorBus";
import { serverDate } from "../utils/serverTime";
import { sortServicesByScheduleOrder } from "../utils/serviceTimes";
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

/** Broadcast credit doc(s) to other tabs. Components that persist credits directly call this after db.put. */
export function broadcastCreditsUpdate(docs: (DBCredits | DBCredit)[]) {
  safePostMessage({ type: "update", data: { docs, hostId: globalHostId } });
}

export function broadcastItemUpdate(doc: DBItem) {
  safePostMessage({
    type: "update",
    data: { docs: doc, hostId: globalHostId },
  });
}


const cleanObject = (obj: Object) =>
  JSON.parse(JSON.stringify(obj, (_, val) => (val === undefined ? null : val)));

const writePendingTimersToStorageAndFirebase = async (
  state: RootState,
  scope: { db: typeof globalFireDbInfo.db; churchId: string | undefined; canWriteSharedData: boolean },
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

  if (!scope.canWriteSharedData) {
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
  if (!globalFireDbInfo.canWriteSharedData) return true;
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
  itemSlice.actions.forceUpdate.toString(),
  itemSlice.actions.markItemPersisted.toString(),
  itemSlice.actions.bufferRemoteItemUpdate.toString(),
  itemSlice.actions.discardPendingRemoteItem.toString(),
  itemSlice.actions.applyPendingRemoteItem.toString(),
  itemSlice.actions.applyPersistedSongAudio.toString(),
  itemSlice.actions.setSelectedBox.toString(),
  itemSlice.actions.setActiveItem.toString(),
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
  itemListSlice.actions.forceUpdate.toString(),
  itemListSlice.actions.setActiveItemInList.toString(),
  itemListsSlice.actions.initiateItemLists.toString(),
  itemListsSlice.actions.updateItemListsFromRemote.toString(),
  itemListsSlice.actions.setInitialItemList.toString(),
  itemListsSlice.actions.selectItemList.toString(),
  itemListsSlice.actions.setOutlineScope.toString(),
  preferencesSlice.actions.initiatePreferences.toString(),
  preferencesSlice.actions.setIsLoading.toString(),
  preferencesSlice.actions.setSelectedPreference.toString(),
  preferencesSlice.actions.setShouldShowItemEditor.toString(),
  preferencesSlice.actions.setShouldShowStreamFormat.toString(),
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
  overlaySlice.actions.forceUpdate.toString(),
  overlaySlice.actions.selectOverlay.toString(),
  overlaySlice.actions.markOverlayPersisted.toString(),
  overlaySlice.actions.bufferRemoteOverlayUpdate.toString(),
  overlaySlice.actions.discardPendingRemoteOverlay.toString(),
  overlaySlice.actions.applyPendingRemoteOverlay.toString(),
  timersSlice.actions.setShouldUpdateTimers.toString(),
  allDocsSlice.actions.updateAllBibleDocs.toString(),
  allDocsSlice.actions.updateAllFreeFormDocs.toString(),
  allDocsSlice.actions.updateAllSongDocs.toString(),
  allDocsSlice.actions.updateAllTimerDocs.toString(),
  allDocsSlice.actions.upsertItemInAllDocs.toString(),
  allDocsSlice.actions.upsertItemsInAllDocs.toString(),
  allItemsSlice.actions.initiateAllItemsList.toString(),
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
  "allItems/",
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
const songLibraryIndexRepairMiddleware =
  createSongLibraryIndexRepairMiddleware();

// handle item updates
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    // Audio is persisted independently after the R2 operation succeeds. Let the
    // reconciliation action enter this listener so it can cancel an older editor
    // autosave, but do not schedule another save for it.
    if (itemSlice.actions.applyPersistedSongAudio.match(action)) {
      return (
        (currentState as RootState).undoable.present.item._id ===
        action.payload.persistedDoc._id
      );
    }

    const excluded = isAnyOf(
      itemSlice.actions.setSelectedSlide,
      itemSlice.actions.setSelectedBox,
      itemSlice.actions.setIsLyricsEditorOpen,
      itemSlice.actions.setItemIsLoading,
      itemSlice.actions.setSectionLoading,
      itemSlice.actions.setHasPendingUpdate,
      itemSlice.actions.setItemFormatting,
      itemSlice.actions.clearTransientState,
      itemSlice.actions.markItemPersisted,
      itemSlice.actions.bufferRemoteItemUpdate,
      itemSlice.actions.discardPendingRemoteItem,
      itemSlice.actions.applyPendingRemoteItem,
    );
    return (
      (currentState as RootState).undoable.present.item !==
        (previousState as RootState).undoable.present.item &&
      !excluded(action) &&
      !!(currentState as RootState).undoable.present.item.hasPendingUpdate &&
      !isStoreResetAction(action)
    );
  },

  effect: async (_action, listenerApi) => {
    const dbAtStart = db;
    if (itemSlice.actions.applyPersistedSongAudio.match(_action)) {
      listenerApi.cancelActiveListeners();
      return;
    }
    if (!dbAtStart) return;

    let state = listenerApi.getState() as RootState;
    if (itemSlice.actions.setActiveItem.match(_action)) {
      state = listenerApi.getOriginalState() as RootState;
    } else {
      listenerApi.cancelActiveListeners();
      await listenerApi.delay(1500);
    }

    // update Item
    const item = state.undoable.present.item;
    let db_item: DBItem = await dbAtStart.get(item._id);
    listenerApi.throwIfCancelled();

    const updatedAt = new Date().toISOString();
    const nextItem: DBItem = {
      ...db_item,
      name: item.name,
      background: item.background,
      slides: item.slides,
      arrangements: item.arrangements,
      selectedArrangement: item.selectedArrangement,
      bibleInfo: item.bibleInfo,
      timerInfo: item.timerInfo,
      songMetadata: item.songMetadata,
      songLinks: item.songLinks,
      // R2 attachment flows persist this field out-of-band. Ordinary editor
      // autosaves must retain the latest durable value instead of their older
      // Redux snapshot. Keep setSongAudio working for any explicit caller.
      songAudio: itemSlice.actions.setSongAudio.match(_action)
        ? item.songAudio
        : db_item.songAudio,
      shouldSendTo: item.shouldSendTo,
      formattedSections: item.formattedSections,
      updatedAt,
    };
    db_item = applyPouchAudit(db_item, nextItem, {
      // Doc came from db.get — always an update (legacy rows may lack createdAt).
      isNew: false,
    });
    listenerApi.throwIfCancelled();
    const result = await dbAtStart.put(db_item);
    listenerApi.throwIfCancelled();
    db_item = {
      ...db_item,
      _rev: result.rev,
    };
    const activeState = (listenerApi.getState() as RootState).undoable.present.item;
    if (db !== dbAtStart || activeState._id !== db_item._id) return;
    listenerApi.dispatch(itemSlice.actions.setHasPendingUpdate(false));
    listenerApi.dispatch(itemSlice.actions.markItemPersisted(db_item));

    listenerApi.dispatch(upsertItemInAllDocs(db_item));
    if (db_item.type === "free") {
      const indexedItem = (listenerApi.getState() as RootState).allItems.list.find(
        (candidate) => candidate._id === db_item._id,
      );
      listenerApi.dispatch(
        allItemsSlice.actions.upsertItemInAllItemsList(
          {
            ...freeFormDocToServiceItem(db_item),
            listId: indexedItem?.listId ?? db_item._id,
          },
        ),
      );
    }

    // Local machine updates
    if (db !== dbAtStart) return;
    safePostMessage({
      type: "update",
      data: {
        docs: db_item,
        hostId: globalHostId,
      },
    });
  },
});

// When allDocs is fully refreshed (e.g. after remote sync), sync the active item so the UI shows the latest.
// We only run on full-refresh actions, NOT on upsertItemInAllDocs: the latter comes from our own thunks and
// the active item is already that doc, so setActiveItem would be redundant and could contribute to loops.
listenerMiddleware.startListening({
  predicate: isAnyOf(
    allDocsSlice.actions.updateAllSongDocs,
    allDocsSlice.actions.updateAllFreeFormDocs,
    allDocsSlice.actions.updateAllTimerDocs,
    allDocsSlice.actions.updateAllBibleDocs,
  ),
  effect: (action, listenerApi) => {
    const state = listenerApi.getState() as RootState;
    const previousState = listenerApi.getOriginalState() as RootState;
    const currentItem = state.undoable.present.item;
    const { _id: activeId, listId } = currentItem;
    if (!activeId) return;

    const { allSongDocs, allFreeFormDocs, allTimerDocs, allBibleDocs } =
      state.allDocs;
    const {
      allSongDocs: previousSongDocs,
      allFreeFormDocs: previousFreeFormDocs,
      allTimerDocs: previousTimerDocs,
      allBibleDocs: previousBibleDocs,
    } = previousState.allDocs;
    const doc =
      allSongDocs.find((d) => d._id === activeId) ??
      allFreeFormDocs.find((d) => d._id === activeId) ??
      allTimerDocs.find((d) => d._id === activeId) ??
      allBibleDocs.find((d) => d._id === activeId);
    const previousDoc =
      previousSongDocs.find((d) => d._id === activeId) ??
      previousFreeFormDocs.find((d) => d._id === activeId) ??
      previousTimerDocs.find((d) => d._id === activeId) ??
      previousBibleDocs.find((d) => d._id === activeId);

    if (doc) {
      if (_.isEqual(doc, previousDoc)) {
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
  actionCreator: allDocsSlice.actions.updateAllTimerDocs,
  effect: (action, listenerApi) => {
    const previousState = listenerApi.getOriginalState() as RootState;
    const timersFromDocs = action.payload
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
        ...action.payload.map((doc) => doc._id),
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

// handle ItemList updates
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    const state = (currentState as RootState).undoable.present.itemList;
    // Don't save until initialization is complete
    if (!state.isInitialized) return false;

    const excluded = isAnyOf(
      itemListSlice.actions.initiateItemList,
      itemListSlice.actions.setItemListIsLoading,
      itemListSlice.actions.setActiveItemInList,
      itemListSlice.actions.updateItemListFromRemote,
      itemListSlice.actions.setHasPendingUpdate,
      itemListSlice.actions.addToInitialItems,
      itemListSlice.actions.setIsInitialized,
    );
    return (
      (currentState as RootState).undoable.present.itemList !==
        (previousState as RootState).undoable.present.itemList &&
      !excluded(action) &&
      !!(currentState as RootState).undoable.present.itemList
        .hasPendingUpdate &&
      !isStoreResetAction(action)
    );
  },

  effect: async (action, listenerApi) => {
    const dbAtStart = db;

    if (!itemListsSlice.actions.selectItemList.match(action)) {
      listenerApi.cancelActiveListeners();
      await listenerApi.delay(1500);
    }

    // Always read post-debounce state so we never persist a closed-over
    // pre-delay snapshot after remote hydrate or a newer local edit.
    const present = (listenerApi.getState() as RootState).undoable.present;
    const { list, hasPendingUpdate, isInitialized } = present.itemList;
    const { selectedList } = present.itemLists;

    if (
      !dbAtStart ||
      db !== dbAtStart ||
      !isInitialized ||
      !hasPendingUpdate ||
      !selectedList
    ) {
      return;
    }

    try {
      const db_itemList: DBItemListDetails = await dbAtStart.get(
        selectedList._id,
      );

      // A newer local edit or remote hydrate may have landed while awaiting get.
      const latest = (listenerApi.getState() as RootState).undoable.present
        .itemList;
      if (db !== dbAtStart || !latest.hasPendingUpdate || latest.list !== list) {
        return;
      }

      db_itemList.items = [...list];
      db_itemList.updatedAt = new Date().toISOString();
      const result = await dbAtStart.put(db_itemList);

      // Only clear dirty after a successful write so failed puts can retry.
      if (db !== dbAtStart) return;
      const afterPutState = (listenerApi.getState() as RootState).undoable.present;
      if (afterPutState.itemLists.selectedList?._id !== selectedList._id) return;
      const afterPut = afterPutState.itemList;
      if (afterPut.list === list && afterPut.hasPendingUpdate) {
        listenerApi.dispatch(itemListSlice.actions.setHasPendingUpdate(false));
      }

      safePostMessage({
        type: "update",
        data: {
          docs: { ...db_itemList, _rev: result.rev },
          hostId: globalHostId,
        },
      });
    } catch (error) {
      console.error("Failed to persist item list outline:", error);
    }
  },
});

// handle itemLists updates
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    const state = (currentState as RootState).undoable.present.itemLists;
    // Don't save until initialization is complete
    if (!state.isInitialized) return false;

    const excluded = isAnyOf(
      itemListsSlice.actions.setInitialItemList,
      itemListsSlice.actions.initiateItemLists,
      itemListsSlice.actions.updateItemListsFromRemote,
      itemListsSlice.actions.setIsInitialized,
      itemListsSlice.actions.setOutlineScope,
    );
    return (
      (currentState as RootState).undoable.present.itemLists !==
        (previousState as RootState).undoable.present.itemLists &&
      !excluded(action) &&
      !isStoreResetAction(action)
    );
  },

  effect: async (action, listenerApi) => {
    // Snapshot before debounce: leaving a controller page resets itemLists to
    // initial state, which would otherwise make the delayed write bail out and
    // drop active outline / selection persistence.
    const snapshot = (listenerApi.getState() as RootState).undoable.present
      .itemLists;
    const { currentLists, activeList, selectedIdByScope } = snapshot;
    const dbAtStart = db;
    if (!dbAtStart) return;
    // Selection can still be worth persisting when activeList is momentarily
    // empty; skip only when there is nothing at all to write.
    if (!activeList && currentLists.length === 0) return;

    listenerApi.dispatch(
      autosaveIndicatorSlice.actions.beginKeyedDebouncedSave(
        AUTOSAVE_DEBOUNCE_KEYS.itemLists,
      ),
    );
    try {
      listenerApi.cancelActiveListeners();
      await listenerApi.delay(1500);

      const db_itemLists: DBItemLists = await dbAtStart.get("ItemLists");
      db_itemLists.itemLists = [...currentLists];
      if (activeList) {
        db_itemLists.activeList = activeList;
      }
      db_itemLists.selectedIdByScope = { ...selectedIdByScope };
      db_itemLists.updatedAt = new Date().toISOString();
      await dbAtStart.put(db_itemLists);

      // Local machine updates
      if (db !== dbAtStart) return;
      safePostMessage({
        type: "update",
        data: {
          docs: db_itemLists,
          hostId: globalHostId,
        },
      });
    } finally {
      listenerApi.dispatch(
        autosaveIndicatorSlice.actions.endKeyedDebouncedSave(
          AUTOSAVE_DEBOUNCE_KEYS.itemLists,
        ),
      );
    }
  },
});

// handle allItems updates
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    const state = (currentState as RootState).allItems;
    // Don't save until initialization is complete
    if (!state.isInitialized) return false;

    const excluded = isAnyOf(
      allItemsSlice.actions.initiateAllItemsList,
      allItemsSlice.actions.updateAllItemsListFromRemote,
      allItemsSlice.actions.setSongSearchValue,
      allItemsSlice.actions.setFreeFormSearchValue,
      allItemsSlice.actions.setTimerSearchValue,
      allItemsSlice.actions.setIsInitialized,
    );
    return (
      (currentState as RootState).allItems !==
        (previousState as RootState).allItems &&
      !excluded(action) &&
      !isStoreResetAction(action)
    );
  },

  effect: async (action, listenerApi) => {
    const dbAtStart = db;
    if (!dbAtStart) return;
    listenerApi.dispatch(
      autosaveIndicatorSlice.actions.beginKeyedDebouncedSave(
        AUTOSAVE_DEBOUNCE_KEYS.allItems,
      ),
    );
    try {
      listenerApi.cancelActiveListeners();
      await listenerApi.delay(1500);

      if (db !== dbAtStart) return;

      // update ItemList
      const { list } = (listenerApi.getState() as RootState).allItems;

      const db_allItems: DBAllItems = await dbAtStart.get("allItems");
      db_allItems.items = [...list];
      db_allItems.updatedAt = new Date().toISOString();
      await dbAtStart.put(db_allItems);

      // Local machine updates
      if (db !== dbAtStart) return;
      safePostMessage({
        type: "update",
        data: {
          docs: db_allItems,
          hostId: globalHostId,
        },
      });
    } finally {
      listenerApi.dispatch(
        autosaveIndicatorSlice.actions.endKeyedDebouncedSave(
          AUTOSAVE_DEBOUNCE_KEYS.allItems,
        ),
      );
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
      overlaysSlice.actions.setHasPendingUpdate,
      overlaysSlice.actions.updateInitialList,
      overlaysSlice.actions.addToInitialList,
      overlaysSlice.actions.mergeOverlayHistoryFromDb,
      overlaysSlice.actions.deleteOverlayHistoryEntry,
      overlaysSlice.actions.updateOverlayHistoryEntry,
      overlaysSlice.actions.mergeOverlayIntoHistory,
    );
    return (
      (currentState as RootState).undoable.present.overlays !==
        (previousState as RootState).undoable.present.overlays &&
      !excluded(action) &&
      !!(currentState as RootState).undoable.present.overlays
        .hasPendingUpdate &&
      !isStoreResetAction(action)
    );
  },

  effect: async (action, listenerApi) => {
    const dbAtStart = db;
    if (!dbAtStart) return;
    let state = listenerApi.getState() as RootState;
    if (itemListsSlice.actions.selectItemList.match(action)) {
      state = listenerApi.getOriginalState() as RootState;
    } else {
      listenerApi.cancelActiveListeners();
      await listenerApi.delay(1500);
      if (db !== dbAtStart) return;
    }

    if (db !== dbAtStart) return;
    listenerApi.dispatch(overlaysSlice.actions.setHasPendingUpdate(false));

    // update ItemList
    const { list } = state.undoable.present.overlays;
    const { selectedList } = state.undoable.present.itemLists;

    if (!selectedList) return;
    const db_itemList: DBItemListDetails = await dbAtStart.get(selectedList._id);

    db_itemList.overlays = list.map((overlay) => overlay.id);
    db_itemList.updatedAt = new Date().toISOString();
    await dbAtStart.put(db_itemList);

    // Local machine updates
    if (db !== dbAtStart) return;
    safePostMessage({
      type: "update",
      data: {
        docs: db_itemList,
        hostId: globalHostId,
      },
    });
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
      canWriteSharedData: globalFireDbInfo.canWriteSharedData,
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
    if (currentItem._id === itemId && currentItem.slides?.length > 1) {
      item = currentItem as unknown as DBItem;
    } else if (dbAtStart) {
      try {
        item = (await dbAtStart.get(itemId)) as DBItem;
      } catch {
        return;
      }
    }
    if (
      db !== dbAtStart ||
      globalFireDbInfo.db !== fireDbAtStart ||
      globalFireDbInfo.churchId !== churchIdAtStart
    ) return;
    if (!item?.slides?.length || item.slides.length < 2) return;
    const wrapUpSlide = item.slides[1];
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
      preferencesSlice.actions.setShouldShowStreamFormat,
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
): ServiceTime[] => {
  const timestamp = serverDate().toISOString();
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
    const { db: firebaseDb, churchId, canWriteSharedData } = globalFireDbInfo;
    if (!canWriteSharedData) return;
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
          cleanObject(
            applyServiceTimesAction(
              readFirebaseServices(remote),
              action,
              localServices,
            ),
          ),
        { applyLocally: false },
      );
      if (globalFireDbInfo.churchId !== churchId) return;
      listenerApi.dispatch(
        syncServicesFromRemote(readFirebaseServices(result.snapshot.val())),
      );
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

    // Only force update for slices that actually changed during undo/redo
    if (
      !_.isEqual(
        sanitizeTransientItemState(currentState.undoable.present.item),
        sanitizeTransientItemState(previousState.undoable.present.item),
      )
    ) {
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
    state.allItems.isInitialized &&
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
  allItems: allItemsSlice.reducer,
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

const rootReducer: Reducer = (state: RootState, action: Action) => {
  if (action.type === "RESET") {
    state = {} as RootState;
  } else if (action.type === "RESET_CONTROLLER_SESSION") {
    // Church registries are app-root synced and must survive leaving a
    // controller; wiping them flashes default names on Home until Firebase
    // re-attaches. Logout / church switch still use full RESET.
    state = {
      controllerProfiles: state?.controllerProfiles,
      displayOutputs: state?.displayOutputs,
    } as RootState;
  }
  return combinedReducers(state, action);
};

const store = configureStore({
  reducer: rootReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: false,
    }).prepend(
      songLibraryIndexRepairMiddleware.middleware,
      listenerMiddleware.middleware,
    ),
});

const refreshServicePlanningPreviewSongMatches = (listenerApi: {
  getState: () => unknown;
  dispatch: (action: ReturnType<typeof refreshPreviewSongMatches>) => void;
}) => {
  const state = listenerApi.getState() as RootState;
  if (!state.servicePlanningImport.preview) return;
  listenerApi.dispatch(refreshPreviewSongMatches(selectSongLibrary(state).songs));
};

// Keep an existing preview aligned with the canonical song library as either
// the lightweight index or durable song documents become available.
listenerMiddleware.startListening({
  actionCreator: allItemsSlice.actions.addItemToAllItemsList,
  effect: (action, listenerApi) => {
    if (action.payload.type !== "song") return;
    refreshServicePlanningPreviewSongMatches(listenerApi);
  },
});

listenerMiddleware.startListening({
  matcher: isAnyOf(
    allDocsSlice.actions.updateAllSongDocs,
    allDocsSlice.actions.upsertItemInAllDocs,
    allDocsSlice.actions.upsertItemsInAllDocs,
  ),
  effect: (_, listenerApi) => {
    refreshServicePlanningPreviewSongMatches(listenerApi);
  },
});

export default store;

// Infer the `RootState` and `AppDispatch` types from the store itself
export type RootState = ReturnType<typeof combinedReducers>;
// Inferred type: {posts: PostsState, comments: CommentsState, users: UsersState}
export type AppDispatch = typeof store.dispatch;
