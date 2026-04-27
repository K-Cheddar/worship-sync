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
  updateBibleDisplayInfoFromRemote,
  updateMonitor,
  updateMonitorFromRemote,
  updateParticipantOverlayInfoFromRemote,
  updateProjectorFromRemote,
  updateQrCodeOverlayInfoFromRemote,
  updateImageOverlayInfoFromRemote,
  updateStbOverlayInfoFromRemote,
  updateStreamFromRemote,
  updateFormattedTextDisplayInfoFromRemote,
  updateBoardPostStreamInfoFromRemote,
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
import { mediaItemsSlice } from "./mediaSlice";
import mediaCacheMapReducer, { setMediaCacheMap } from "./mediaCacheMapSlice";
import { overlaySlice } from "./overlaySlice";
import { globalDb as db, globalBroadcastRef } from "../context/controllerInfo";
import { globalFireDbInfo, globalHostId } from "../context/globalInfo";
import { ref, set, get } from "firebase/database";
import {
  BibleDisplayInfo,
  DBAllItems,
  DBCredit,
  DBCredits,
  DBItem,
  DBItemListDetails,
  DBItemLists,
  DBMedia,
  DBOverlay,
  DBOverlayTemplates,
  DBPreferences,
  DBQuickLinksDoc,
  DBMonitorSettingsDoc,
  DBMediaRouteFoldersDoc,
  MEDIA_ROUTE_FOLDERS_POUCH_ID,
  MONITOR_SETTINGS_POUCH_ID,
  PREFERENCES_POUCH_ID,
  QUICK_LINKS_POUCH_ID,
  DBServices,
  FormattedTextDisplayInfo,
  getCreditsDocId,
  OverlayInfo,
  Presentation,
  TimerInfo,
} from "../types";
import { allDocsSlice, upsertItemInAllDocs } from "./allDocsSlice";
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
} from "./serviceTimesSlice";
import { servicePlanningImportSlice } from "./servicePlanningImportSlice";
import { mergeTimers } from "../utils/timerUtils";
import { extractMediaUrlsFromBackgrounds } from "../utils/mediaCacheUtils";
import { normalizeOverlayForSync } from "../utils/overlayUtils";
import { persistExistingOverlayDoc } from "../utils/persistOverlayDoc";
import _ from "lodash";
import { getChurchDataPath } from "../utils/firebasePaths";
import {
  ensureCreditsIndexDoc,
  getCreditsByIds,
  migrateLegacyCreditsToActiveOutlineIfNeeded,
} from "../utils/dbUtils";
import { applyPouchAudit } from "@/utils/pouchAudit";

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

const cleanObject = (obj: Object) =>
  JSON.parse(JSON.stringify(obj, (_, val) => (val === undefined ? null : val)));

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

/** Push current presentation (projector/monitor/stream) to Firebase + localStorage. */
export const writePresentationSnapshotToFirebase = (state: RootState) => {
  if (!globalFireDbInfo.db || !globalFireDbInfo.churchId) return;
  const { projectorInfo, monitorInfo, streamInfo, streamItemContentBlocked } =
    state.presentation;
  const presentationUpdate = {
    projectorInfo,
    monitorInfo,
    streamInfo: {
      displayType: streamInfo.displayType,
      time: streamInfo.time,
      slide: streamInfo.slide,
      timerId: streamInfo.timerId,
      name: streamInfo.name,
      type: streamInfo.type,
    },
    stream_itemContentBlocked: streamItemContentBlocked,
    stream_bibleInfo: streamInfo.bibleDisplayInfo,
    stream_participantOverlayInfo: streamInfo.participantOverlayInfo,
    stream_stbOverlayInfo: streamInfo.stbOverlayInfo,
    stream_qrCodeOverlayInfo: streamInfo.qrCodeOverlayInfo,
    stream_imageOverlayInfo: streamInfo.imageOverlayInfo,
    stream_formattedTextDisplayInfo: streamInfo.formattedTextDisplayInfo,
    stream_boardPostStreamInfo: streamInfo.boardPostStreamInfo,
  };

  localStorage.setItem("projectorInfo", JSON.stringify(projectorInfo));
  localStorage.setItem("monitorInfo", JSON.stringify(monitorInfo));
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
    JSON.stringify(streamItemContentBlocked),
  );

  set(
    ref(
      globalFireDbInfo.db,
      getChurchDataPath(globalFireDbInfo.churchId, "presentation"),
    ),
    cleanObject(presentationUpdate),
  );
};

let lastActionTime = 0;
let currentGroupId = 0;

const excludedActions: string[] = [
  itemSlice.actions.setItemIsLoading.toString(),
  itemSlice.actions.setSectionLoading.toString(),
  itemSlice.actions.setItemFormatting.toString(),
  itemSlice.actions.setSelectedSlide.toString(),
  itemSlice.actions.setIsEditMode.toString(),
  itemSlice.actions.setHasPendingUpdate.toString(),
  itemSlice.actions.forceUpdate.toString(),
  itemSlice.actions.markItemPersisted.toString(),
  itemSlice.actions.bufferRemoteItemUpdate.toString(),
  itemSlice.actions.discardPendingRemoteItem.toString(),
  itemSlice.actions.applyPendingRemoteItem.toString(),
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

// handle item updates
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    const excluded = isAnyOf(
      itemSlice.actions.setSelectedSlide,
      itemSlice.actions.setSelectedBox,
      itemSlice.actions.setIsEditMode,
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
      action.type !== "RESET"
    );
  },

  effect: async (action, listenerApi) => {
    let state = listenerApi.getState() as RootState;
    if (itemSlice.actions.setActiveItem.match(action)) {
      state = listenerApi.getOriginalState() as RootState;
    } else {
      listenerApi.cancelActiveListeners();
      await listenerApi.delay(1500);
    }

    // update Item
    const item = state.undoable.present.item;
    if (!db) return;
    let db_item: DBItem = await db.get(item._id);

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
      shouldSendTo: item.shouldSendTo,
      updatedAt,
    };
    db_item = applyPouchAudit(db_item, nextItem, {
      // Doc came from db.get — always an update (legacy rows may lack createdAt).
      isNew: false,
    });
    const result = await db.put(db_item);
    db_item = {
      ...db_item,
      _rev: result.rev,
    };
    listenerApi.dispatch(itemSlice.actions.setHasPendingUpdate(false));
    listenerApi.dispatch(itemSlice.actions.markItemPersisted(db_item));

    listenerApi.dispatch(upsertItemInAllDocs(db_item));

    // Local machine updates
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
        !!(currentItem.hasPendingUpdate || currentItem.isEditMode) &&
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
      action.type !== "RESET"
    );
  },

  effect: async (action, listenerApi) => {
    let state = listenerApi.getState() as RootState;
    if (itemListsSlice.actions.selectItemList.match(action)) {
      state = listenerApi.getOriginalState() as RootState;
    } else {
      listenerApi.cancelActiveListeners();
      await listenerApi.delay(1500);
    }

    listenerApi.dispatch(itemListSlice.actions.setHasPendingUpdate(false));

    // update ItemList
    const { list } = state.undoable.present.itemList;
    const { selectedList } = state.undoable.present.itemLists;
    if (!db || !selectedList) return;
    const db_itemList: DBItemListDetails = await db.get(selectedList._id);
    db_itemList.items = [...list];
    db_itemList.updatedAt = new Date().toISOString();
    db.put(db_itemList);

    // Local machine updates
    safePostMessage({
      type: "update",
      data: {
        docs: db_itemList,
        hostId: globalHostId,
      },
    });
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
      itemListsSlice.actions.selectItemList,
      itemListsSlice.actions.setIsInitialized,
    );
    return (
      (currentState as RootState).undoable.present.itemLists !==
        (previousState as RootState).undoable.present.itemLists &&
      !excluded(action) &&
      action.type !== "RESET"
    );
  },

  effect: async (action, listenerApi) => {
    listenerApi.dispatch(
      autosaveIndicatorSlice.actions.beginKeyedDebouncedSave(
        AUTOSAVE_DEBOUNCE_KEYS.itemLists,
      ),
    );
    try {
      listenerApi.cancelActiveListeners();
      await listenerApi.delay(1500);

      // update ItemList
      const { currentLists, activeList } = (listenerApi.getState() as RootState)
        .undoable.present.itemLists;

      if (!db || !activeList) return;
      const db_itemLists: DBItemLists = await db.get("ItemLists");
      db_itemLists.itemLists = [...currentLists];
      db_itemLists.activeList = activeList;
      db_itemLists.updatedAt = new Date().toISOString();
      db.put(db_itemLists);

      // Local machine updates
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
      allItemsSlice.actions.setIsInitialized,
    );
    return (
      (currentState as RootState).allItems !==
        (previousState as RootState).allItems &&
      !excluded(action) &&
      action.type !== "RESET"
    );
  },

  effect: async (action, listenerApi) => {
    listenerApi.dispatch(
      autosaveIndicatorSlice.actions.beginKeyedDebouncedSave(
        AUTOSAVE_DEBOUNCE_KEYS.allItems,
      ),
    );
    try {
      listenerApi.cancelActiveListeners();
      await listenerApi.delay(1500);

      // update ItemList
      const { list } = (listenerApi.getState() as RootState).allItems;

      if (!db) return;
      const db_allItems: DBAllItems = await db.get("allItems");
      db_allItems.items = [...list];
      db_allItems.updatedAt = new Date().toISOString();
      db.put(db_allItems);

      // Local machine updates
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
      action.type !== "RESET" &&
      !!(currentState as RootState).undoable.present.overlay.hasPendingUpdate
    );
  },

  effect: async (action, listenerApi) => {
    const persistOutgoingSelection =
      overlaySlice.actions.selectOverlay.match(action);

    listenerApi.cancelActiveListeners();
    if (!persistOutgoingSelection) {
      await listenerApi.delay(1500);
    }

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
    if (!db) return;

    listenerApi.throwIfCancelled();
    overlayToPersist = readOverlayToPersist();
    if (!overlayToPersist?.id) {
      listenerApi.dispatch(overlaySlice.actions.setHasPendingUpdate(false));
      return;
    }

    let persisted: DBOverlay | undefined;
    try {
      persisted = await listenerApi.pause(
        persistExistingOverlayDoc(db, overlayToPersist),
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
      action.type !== "RESET"
    );
  },

  effect: async (action, listenerApi) => {
    let state = listenerApi.getState() as RootState;
    if (itemListsSlice.actions.selectItemList.match(action)) {
      state = listenerApi.getOriginalState() as RootState;
    } else {
      listenerApi.cancelActiveListeners();
      await listenerApi.delay(1500);
    }

    listenerApi.dispatch(overlaysSlice.actions.setHasPendingUpdate(false));

    // update ItemList
    const { list } = state.undoable.present.overlays;
    const { selectedList } = state.undoable.present.itemLists;

    if (!db || !selectedList) return;
    const db_itemList: DBItemListDetails = await db.get(selectedList._id);

    db_itemList.overlays = list.map((overlay) => overlay.id);
    db_itemList.updatedAt = new Date().toISOString();
    db.put(db_itemList);

    // Local machine updates
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
      (currentState as RootState).timers !==
        (previousState as RootState).timers &&
      !excluded(action) &&
      action.type !== "RESET"
    );
  },

  effect: async (action, listenerApi) => {
    const state = listenerApi.getState() as RootState;
    listenerApi.cancelActiveListeners();
    await listenerApi.delay(10);

    // update firebase with timers
    const { timers, shouldUpdateTimers } = state.timers;

    if (!shouldUpdateTimers) return;

    const ownTimers = timers.filter((timer) => timer.hostId === globalHostId);

    if (ownTimers.length > 0) {
      localStorage.setItem("timerInfo", JSON.stringify(ownTimers));
    } else {
      localStorage.removeItem("timerInfo");
    }

    if (globalFireDbInfo.db && globalFireDbInfo.churchId) {
      // Get current timers from Firebase
      const timersRef = ref(
        globalFireDbInfo.db,
        getChurchDataPath(globalFireDbInfo.churchId, "timers"),
      );

      // Get current timers and merge with own timers
      const snapshot = await get(timersRef);
      const currentTimers = Array.isArray(snapshot.val()) ? snapshot.val() : [];

      // Merge timers, prioritizing own timers over remote ones.
      // Passing an empty ownTimers array removes this host's timers remotely.
      const mergedTimers = mergeTimers(currentTimers, ownTimers, globalHostId);

      set(timersRef, cleanObject(mergedTimers));
    }

    // Reset flag after writing (to localStorage and/or Firebase) so effect doesn't keep re-running.
    listenerApi.dispatch(timersSlice.actions.setShouldUpdateTimers(false));
  },
});

// When a timer expires and the monitor is showing that timer, switch to the item's wrap-up slide (slides[1])
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    if (!timersSlice.actions.tickTimers.match(action)) return false;
    const curr = currentState as RootState;
    const prev = previousState as RootState;
    const { monitorInfo } = curr.presentation;
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
    const { monitorInfo } = state.presentation;
    const itemId = monitorInfo.itemId ?? monitorInfo.timerId;
    if (!itemId) return;
    const currentItem = state.undoable.present.item;
    let item: DBItem | null = null;
    if (currentItem._id === itemId && currentItem.slides?.length > 1) {
      item = currentItem as unknown as DBItem;
    } else if (db) {
      try {
        item = (await db.get(itemId)) as DBItem;
      } catch {
        return;
      }
    }
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
      action.type !== "RESET"
    );
  },

  effect: async (_action, listenerApi) => {
    const preDelay = listenerApi.getState() as RootState;
    const snapshotCredits = preDelay.undoable.present.credits;
    if (!snapshotCredits.isInitialized) return;

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

      const fireDb = globalFireDbInfo.db;
      const fireChurchId = globalFireDbInfo.churchId;
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

      if (!db) return;

      const now = new Date().toISOString();
      const creditIds = list.map((c) => c.id);
      const docsToBroadcast: DBCredits[] = [];

      try {
        await ensureCreditsIndexDoc(db, snapshotOutlineId);
        const db_credits: DBCredits = await db.get(
          getCreditsDocId(snapshotOutlineId),
        );
        db_credits.creditIds = creditIds;
        db_credits.updatedAt = now;
        await db.put(db_credits);
        docsToBroadcast.push(db_credits);
      } catch (e) {
        console.error("credits index save failed", e);
      }

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
    // Full store RESET (e.g. overlay/controller page unmount) clears slices to initial
    // state; activeList becomes undefined transiently. Do not treat that as "no active
    // outline" for audience RTDB — avoids wiping `publishedList` while displays stay open.
    if (action.type === "RESET") return false;
    const prevId = (previousState as RootState).undoable.present.itemLists
      .activeList?._id;
    const nextId = (currentState as RootState).undoable.present.itemLists
      .activeList?._id;
    return prevId !== nextId;
  },
  effect: async (_action, listenerApi) => {
    const stateBefore = listenerApi.getState() as RootState;
    const outlineId = stateBefore.undoable.present.itemLists.activeList?._id;

    if (!globalFireDbInfo.db || !globalFireDbInfo.churchId) return;

    const publishedRef = ref(
      globalFireDbInfo.db,
      getChurchDataPath(globalFireDbInfo.churchId, "credits", "publishedList"),
    );

    if (!outlineId) {
      set(publishedRef, []);
      return;
    }

    if (!db) return;

    try {
      await migrateLegacyCreditsToActiveOutlineIfNeeded(db, outlineId);
      await ensureCreditsIndexDoc(db, outlineId);
      const creditsDoc = (await db.get(
        getCreditsDocId(outlineId),
      )) as DBCredits;
      const creditIds = creditsDoc.creditIds ?? [];
      const credits = await getCreditsByIds(db, outlineId, creditIds);
      const visible = credits.filter((c) => !c.hidden).map((c) => ({ ...c }));

      const stillActive = (listenerApi.getState() as RootState).undoable.present
        .itemLists.activeList?._id;
      if (stillActive !== outlineId) return;

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
      mediaItemsSlice.actions.setIsInitialized,
    );
    return (
      (currentState as RootState).media !==
        (previousState as RootState).media &&
      !excluded(action) &&
      action.type !== "RESET"
    );
  },

  effect: async (action, listenerApi) => {
    listenerApi.dispatch(
      autosaveIndicatorSlice.actions.beginKeyedDebouncedSave(
        AUTOSAVE_DEBOUNCE_KEYS.media,
      ),
    );
    try {
      listenerApi.cancelActiveListeners();
      await listenerApi.delay(1500);

      // update ItemList
      const { list, folders } = (listenerApi.getState() as RootState).media;

      if (!db) return;
      try {
        const db_media: DBMedia = await db.get("media");
        db_media.list = [...list];
        db_media.folders = [...folders];
        db_media.updatedAt = new Date().toISOString();
        await db.put(db_media);

        // Local machine updates — only after Pouch reports success so `_rev` matches other tabs.
        safePostMessage({
          type: "update",
          data: {
            docs: db_media,
            hostId: globalHostId,
          },
        });

        // Sync media cache to match the saved media list (Electron only)
        if (window.electronAPI) {
          try {
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
              "Error syncing media cache after media list save:",
              error,
            );
          }
        }
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

// Sync media cache when media list is updated from remote (media doc)
listenerMiddleware.startListening({
  predicate: (action) =>
    mediaItemsSlice.actions.syncMediaFromRemote.match(action) ||
    mediaItemsSlice.actions.updateMediaListFromRemote.match(action),
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
      preferencesSlice.actions.setIsInitialized,
    );
    return (
      (currentState as RootState).undoable.present.preferences !==
        (previousState as RootState).undoable.present.preferences &&
      !excluded(action) &&
      action.type !== "RESET"
    );
  },

  effect: async (action, listenerApi) => {
    listenerApi.dispatch(
      autosaveIndicatorSlice.actions.beginKeyedDebouncedSave(
        AUTOSAVE_DEBOUNCE_KEYS.preferences,
      ),
    );
    try {
      listenerApi.cancelActiveListeners();
      await listenerApi.delay(1500);

      const { preferences, monitorSettings, quickLinks, mediaRouteFolders } = (
        listenerApi.getState() as RootState
      ).undoable.present.preferences;

      if (globalFireDbInfo.db && globalFireDbInfo.churchId) {
        set(
          ref(
            globalFireDbInfo.db,
            getChurchDataPath(globalFireDbInfo.churchId, "monitorSettings"),
          ),
          cleanObject({
            ...monitorSettings,
          }),
        );
      }

      if (!db) return;
      const pouchDb = db;
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

        const f0 = (await getDoc(
          MEDIA_ROUTE_FOLDERS_POUCH_ID,
        )) as DBMediaRouteFoldersDoc | null;
        const foldToPut = (
          f0
            ? {
                ...f0,
                mediaRouteFolders: { ...mediaRouteFolders },
                updatedAt: now,
                docType: "mediaRouteFolders" as const,
              }
            : {
                _id: MEDIA_ROUTE_FOLDERS_POUCH_ID,
                mediaRouteFolders: { ...mediaRouteFolders },
                createdAt: now,
                updatedAt: now,
                docType: "mediaRouteFolders" as const,
              }
        ) as DBMediaRouteFoldersDoc;
        const foldRes = await pouchDb.put(foldToPut);
        const foldOut = {
          ...foldToPut,
          _rev: (foldRes as { rev: string }).rev,
        } as DBMediaRouteFoldersDoc;

        safePostMessage({
          type: "update",
          data: {
            docs: [prefsOut, qlOut, monOut, foldOut],
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
      action.type !== "RESET"
    );
  },

  effect: async (action, listenerApi) => {
    listenerApi.cancelActiveListeners();
    await listenerApi.delay(1500);

    listenerApi.dispatch(
      overlayTemplatesSlice.actions.setHasPendingUpdate(false),
    );

    // update overlay templates
    const { templatesByType } = (listenerApi.getState() as RootState).undoable
      .present.overlayTemplates;

    if (!db) return;
    try {
      const db_templates: DBOverlayTemplates =
        await db.get("overlay-templates");
      db_templates.templatesByType = templatesByType;
      db_templates.updatedAt = new Date().toISOString();
      db.put(db_templates);
      // Local machine updates
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
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      db.put(db_templates);
    }
  },
});

// handle updating service times
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    const excluded = isAnyOf(
      serviceTimesSlice.actions.initiateServices,
      serviceTimesSlice.actions.updateServicesFromRemote,
      serviceTimesSlice.actions.setIsInitialized,
    );
    return (
      (currentState as RootState).undoable.present.serviceTimes !==
        (previousState as RootState).undoable.present.serviceTimes &&
      !excluded(action) &&
      action.type !== "RESET"
    );
  },

  effect: async (action, listenerApi) => {
    listenerApi.dispatch(
      autosaveIndicatorSlice.actions.beginKeyedDebouncedSave(
        AUTOSAVE_DEBOUNCE_KEYS.serviceTimes,
      ),
    );
    try {
      listenerApi.cancelActiveListeners();
      await listenerApi.delay(1500);

      // update service times
      const { list } = (listenerApi.getState() as RootState).undoable.present
        .serviceTimes;

      // Prevent syncing empty arrays to Firebase if we have no services
      // This prevents clearing Firebase when Redux is empty but PouchDB has services
      if (list.length === 0) {
        // Still update PouchDB if it exists, but don't clear Firebase
        if (db) {
          try {
            const db_services: DBServices = await db.get("services");
            // Only update PouchDB if it already has services (don't create empty)
            if (db_services?.list && db_services.list.length > 0) {
              db_services.list = list;
              db_services.updatedAt = new Date().toISOString();
              db.put(db_services);
            }
          } catch (error) {
            // Don't create empty services document
          }
        }
        return;
      }

      if (db) {
        try {
          const db_services: DBServices = await db.get("services");
          db_services.list = list;
          db_services.updatedAt = new Date().toISOString();
          db.put(db_services);
          // Local machine updates
          safePostMessage({
            type: "update",
            data: {
              docs: db_services,
              hostId: globalHostId,
            },
          });
        } catch (error) {
          // if the services are not found, create a new one
          const db_services = {
            _id: "services",
            list,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          db.put(db_services);
          // Only broadcast if list is not empty
          if (list.length > 0) {
            safePostMessage({
              type: "update",
              data: {
                docs: db_services,
                hostId: globalHostId,
              },
            });
          }
        }
      }
      if (globalFireDbInfo.db && globalFireDbInfo.churchId) {
        set(
          ref(
            globalFireDbInfo.db,
            getChurchDataPath(globalFireDbInfo.churchId, "services"),
          ),
          cleanObject(list),
        );
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

// Ensure firebase has updated services on load
listenerMiddleware.startListening({
  actionCreator: serviceTimesSlice.actions.initiateServices,

  effect: async (action, listenerApi) => {
    listenerApi.cancelActiveListeners();
    await listenerApi.delay(1500);

    // update service times
    const { list } = (listenerApi.getState() as RootState).undoable.present
      .serviceTimes;

    // Prevent syncing empty arrays to Firebase on load
    // Only sync if we actually have services
    if (list.length === 0) {
      return;
    }

    if (globalFireDbInfo.db && globalFireDbInfo.churchId) {
      set(
        ref(
          globalFireDbInfo.db,
          getChurchDataPath(globalFireDbInfo.churchId, "services"),
        ),
        cleanObject(list),
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
    );
    return (
      (currentState as RootState).presentation !==
        (previousState as RootState).presentation &&
      !excluded(action) &&
      action.type !== "RESET"
    );
  },

  effect: async (action, listenerApi) => {
    if (!globalFireDbInfo.db) return;
    listenerApi.cancelActiveListeners();
    await listenerApi.delay(10);
    writePresentationSnapshotToFirebase(listenerApi.getState() as RootState);
  },
});

// Stream transmit toggle is excluded from the predicate above, so remotes never see
// stream-on until the next slide/overlay change. Push full snapshot when stream goes live.
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    if (!presentationSlice.actions.toggleStreamTransmitting.match(action))
      return false;
    const curr = (currentState as RootState).presentation;
    const prev = (previousState as RootState).presentation;
    return curr.isStreamTransmitting && !prev.isStreamTransmitting;
  },
  effect: async (_action, listenerApi) => {
    if (!globalFireDbInfo.db) return;
    await listenerApi.delay(15);
    writePresentationSnapshotToFirebase(listenerApi.getState() as RootState);
  },
});

listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    if (!presentationSlice.actions.setTransmitToAll.match(action)) return false;
    const curr = (currentState as RootState).presentation;
    const prev = (previousState as RootState).presentation;
    return curr.isStreamTransmitting && !prev.isStreamTransmitting;
  },
  effect: async (_action, listenerApi) => {
    if (!globalFireDbInfo.db) return;
    await listenerApi.delay(15);
    writePresentationSnapshotToFirebase(listenerApi.getState() as RootState);
  },
});

// handle updating from remote projector
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    const state = (previousState as RootState).presentation;
    const info = action.payload as Presentation;
    return (
      action.type === "debouncedUpdateProjector" &&
      !!(
        (info.time &&
          state.projectorInfo.time &&
          info.time > state.projectorInfo.time) ||
        (info.time && !state.projectorInfo.time)
      )
    );
  },

  effect: async (action, listenerApi) => {
    listenerApi.cancelActiveListeners();
    await listenerApi.delay(10);

    listenerApi.dispatch(
      updateProjectorFromRemote(action.payload as Presentation),
    );
  },
});

// handle updating from remote monitor
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    const state = (previousState as RootState).presentation;
    const info = action.payload as Presentation;
    return (
      action.type === "debouncedUpdateMonitor" &&
      !!(
        (info.time &&
          state.monitorInfo.time &&
          info.time > state.monitorInfo.time) ||
        (info.time && !state.monitorInfo.time)
      )
    );
  },

  effect: async (action, listenerApi) => {
    listenerApi.cancelActiveListeners();
    await listenerApi.delay(10);

    listenerApi.dispatch(
      updateMonitorFromRemote(action.payload as Presentation),
    );
  },
});

// handle updating from remote stream (strict > so we skip our own Firebase echo and avoid prev/current both having current slide)
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    const state = (previousState as RootState).presentation;
    const info = action.payload as Presentation;
    return (
      action.type === "debouncedUpdateStream" &&
      !!(
        (info.time &&
          state.streamInfo.time &&
          info.time > state.streamInfo.time) ||
        (info.time && !state.streamInfo.time)
      )
    );
  },

  effect: async (action, listenerApi) => {
    listenerApi.cancelActiveListeners();
    await listenerApi.delay(10);

    listenerApi.dispatch(
      updateStreamFromRemote(action.payload as Presentation),
    );
  },
});

// handle updating from remote bible info
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    const state = (previousState as RootState).presentation;
    const info = action.payload as BibleDisplayInfo;
    return (
      action.type === "debouncedUpdateBibleDisplayInfo" &&
      !!(
        (info.time &&
          state.streamInfo.bibleDisplayInfo?.time &&
          info.time > state.streamInfo.bibleDisplayInfo.time) ||
        (info.time && !state.streamInfo.bibleDisplayInfo?.time)
      )
    );
  },

  effect: async (action, listenerApi) => {
    listenerApi.cancelActiveListeners();
    await listenerApi.delay(10);

    listenerApi.dispatch(
      updateBibleDisplayInfoFromRemote(action.payload as BibleDisplayInfo),
    );
  },
});

// handle updating from remote participant overlay info
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    const state = (previousState as RootState).presentation;
    const info = action.payload as OverlayInfo;
    return (
      action.type === "debouncedUpdateParticipantOverlayInfo" &&
      !!(
        (info.time &&
          state.streamInfo.participantOverlayInfo?.time &&
          info.time > state.streamInfo.participantOverlayInfo.time) ||
        (info.time && !state.streamInfo.participantOverlayInfo?.time)
      )
    );
  },

  effect: async (action, listenerApi) => {
    listenerApi.cancelActiveListeners();
    await listenerApi.delay(10);

    listenerApi.dispatch(
      updateParticipantOverlayInfoFromRemote(action.payload as OverlayInfo),
    );
  },
});

// handle updating from remote stb overlay info
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    const state = (previousState as RootState).presentation;
    const info = action.payload as OverlayInfo;
    return (
      action.type === "debouncedUpdateStbOverlayInfo" &&
      !!(
        (info.time &&
          state.streamInfo.stbOverlayInfo?.time &&
          info.time > state.streamInfo.stbOverlayInfo.time) ||
        (info.time && !state.streamInfo.stbOverlayInfo?.time)
      )
    );
  },

  effect: async (action, listenerApi) => {
    listenerApi.cancelActiveListeners();
    await listenerApi.delay(10);

    listenerApi.dispatch(
      updateStbOverlayInfoFromRemote(action.payload as OverlayInfo),
    );
  },
});

// handle updating from remote qr code overlay info
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    const state = (previousState as RootState).presentation;
    const info = action.payload as OverlayInfo;
    return (
      action.type === "debouncedUpdateQrCodeOverlayInfo" &&
      !!(
        (info.time &&
          state.streamInfo.qrCodeOverlayInfo?.time &&
          info.time > state.streamInfo.qrCodeOverlayInfo.time) ||
        (info.time && !state.streamInfo.qrCodeOverlayInfo?.time)
      )
    );
  },

  effect: async (action, listenerApi) => {
    listenerApi.cancelActiveListeners();
    await listenerApi.delay(10);

    listenerApi.dispatch(
      updateQrCodeOverlayInfoFromRemote(action.payload as OverlayInfo),
    );
  },
});

// handle updating from remote image overlay info
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    const state = (previousState as RootState).presentation;
    const info = action.payload as OverlayInfo;
    return (
      action.type === "debouncedUpdateImageOverlayInfo" &&
      !!(
        (info.time &&
          state.streamInfo.imageOverlayInfo?.time &&
          info.time > state.streamInfo.imageOverlayInfo.time) ||
        (info.time && !state.streamInfo.imageOverlayInfo?.time)
      )
    );
  },

  effect: async (action, listenerApi) => {
    listenerApi.cancelActiveListeners();
    await listenerApi.delay(10);

    listenerApi.dispatch(
      updateImageOverlayInfoFromRemote(action.payload as OverlayInfo),
    );
  },
});

// handle updating from remote formatted text display info
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    const state = (previousState as RootState).presentation;
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
    listenerApi.cancelActiveListeners();
    await listenerApi.delay(10);

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
    const state = (currentState as RootState).presentation;
    const info = action.payload as { time?: number; text?: string };
    if (!info.time) return false;
    const current = state.streamInfo.boardPostStreamInfo;
    // Always apply when incoming has content but local is empty (stream page opened after post was sent)
    if (info.text?.trim() && !current?.text?.trim()) return true;
    return !!(
      (current?.time && info.time > current.time) ||
      !current?.time
    );
  },

  effect: async (action, listenerApi) => {
    listenerApi.cancelActiveListeners();
    await listenerApi.delay(10);
    listenerApi.dispatch(
      updateBoardPostStreamInfoFromRemote(action.payload as Parameters<typeof updateBoardPostStreamInfoFromRemote>[0]),
    );
  },
});

// handle updating from remote stream item content blocked
listenerMiddleware.startListening({
  predicate: (action) =>
    action.type === "debouncedUpdateStreamItemContentBlocked",
  effect: async (action, listenerApi) => {
    listenerApi.cancelActiveListeners();
    await listenerApi.delay(10);
    listenerApi.dispatch(
      setStreamItemContentBlockedFromRemote(action.payload as boolean),
    );
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
    listenerApi.cancelActiveListeners();
    await listenerApi.delay(10);

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
    const currentState = listenerApi.getState() as RootState;
    const previousState = listenerApi.getOriginalState() as RootState;
    const reconciledOverlaySelection = getOverlaySelectionForUndoRedo(
      currentState,
      previousState,
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

const areControllerSlicesReady = (state: RootState) => {
  return (
    state.allItems.isInitialized &&
    state.undoable.present.preferences.isInitialized &&
    state.undoable.present.itemList.isInitialized &&
    state.undoable.present.overlays.isInitialized &&
    state.undoable.present.itemLists.isInitialized &&
    state.media.isInitialized &&
    (state.undoable.present.overlayTemplates as { isInitialized: boolean })
      .isInitialized
  );
};

listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    if (action.type === "RESET_INITIALIZATION") {
      hasFinishedInitialization = false;
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
      safeRequestIdleCallback(
        () => {
          console.log("✅ Initialization complete - Starting undo history");
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
});

const rootReducer: Reducer = (state: RootState, action: Action) => {
  if (action.type === "RESET") {
    state = {} as RootState;
  }
  return combinedReducers(state, action);
};

const store = configureStore({
  reducer: rootReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: false,
    }).prepend(listenerMiddleware.middleware),
});

export default store;

// Infer the `RootState` and `AppDispatch` types from the store itself
export type RootState = ReturnType<typeof combinedReducers>;
// Inferred type: {posts: PostsState, comments: CommentsState, users: UsersState}
export type AppDispatch = typeof store.dispatch;
