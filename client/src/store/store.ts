import {
  Action,
  combineReducers,
  configureStore,
  createListenerMiddleware,
  Reducer,
} from "@reduxjs/toolkit";
import undoable, { ActionCreators } from "redux-undo";
import {
  presentationSlice,
  updateBibleDisplayInfoFromRemote,
  updateMonitorFromRemote,
  updateParticipantOverlayInfoFromRemote,
  updateProjectorFromRemote,
  updateQrCodeOverlayInfoFromRemote,
  updateImageOverlayInfoFromRemote,
  updateStbOverlayInfoFromRemote,
  updateStreamFromRemote,
  updateFormattedTextDisplayInfoFromRemote,
} from "./presentationSlice";
import { itemSlice } from "./itemSlice";
import { overlaysSlice } from "./overlaysSlice";
import { bibleSlice } from "./bibleSlice";
import { itemListSlice } from "./itemListSlice";
import { allItemsSlice } from "./allItemsSlice";
import { createItemSlice } from "./createItemSlice";
import { preferencesSlice } from "./preferencesSlice";
import { itemListsSlice } from "./itemListsSlice";
import { mediaItemsSlice } from "./mediaSlice";
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
  DBServices,
  FormattedTextDisplayInfo,
  OverlayInfo,
  Presentation,
  TimerInfo,
} from "../types";
import { allDocsSlice } from "./allDocsSlice";
import { creditsSlice } from "./creditsSlice";
import { timersSlice, addTimer, updateTimerFromRemote } from "./timersSlice";
import { overlayTemplatesSlice } from "./overlayTemplatesSlice";
import serviceTimesSlice from "./serviceTimesSlice";
import { mergeTimers } from "../utils/timerUtils";
import { extractAllVideoUrlsFromOutlines } from "../utils/videoCacheUtils";
import _ from "lodash";
import { capitalizeFirstLetter } from "../utils/generalUtils";

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

let lastActionTime = 0;
let currentGroupId = 0;

const excludedActions: string[] = [
  itemSlice.actions.setItemIsLoading.toString(),
  itemSlice.actions.setSectionLoading.toString(),
  itemSlice.actions.setSelectedSlide.toString(),
  itemSlice.actions.setIsEditMode.toString(),
  itemSlice.actions.setHasPendingUpdate.toString(),
  itemSlice.actions.forceUpdate.toString(),
  itemSlice.actions.setSelectedSlide.toString(),
  itemSlice.actions.setSelectedBox.toString(),
  overlaysSlice.actions.initiateOverlayList.toString(),
  overlaysSlice.actions.updateOverlayListFromRemote.toString(),
  overlaysSlice.actions.setHasPendingUpdate.toString(),
  overlaysSlice.actions.forceUpdate.toString(),
  overlaysSlice.actions.updateInitialList.toString(),
  overlaysSlice.actions.initiateOverlayHistory.toString(),
  overlaysSlice.actions.mergeOverlayHistoryFromDb.toString(),
  overlaysSlice.actions.deleteOverlayHistoryEntry.toString(),
  overlaysSlice.actions.mergeOverlayIntoHistory.toString(),
  creditsSlice.actions.initiateCreditsList.toString(),
  creditsSlice.actions.initiateTransitionScene.toString(),
  creditsSlice.actions.initiateCreditsScene.toString(),
  creditsSlice.actions.initiatePublishedCreditsList.toString(),
  creditsSlice.actions.updateCreditsListFromRemote.toString(),
  creditsSlice.actions.updatePublishedCreditsListFromRemote.toString(),
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
  timersSlice.actions.syncTimersFromRemote.toString(),
  timersSlice.actions.setShouldUpdateTimers.toString(),
  allDocsSlice.actions.updateAllFreeFormDocs.toString(),
  allDocsSlice.actions.updateAllSongDocs.toString(),
  allDocsSlice.actions.updateAllTimerDocs.toString(),
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
    serviceTimes: serviceTimesSlice,
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
    limit: 100,
  }
);

const listenerMiddleware = createListenerMiddleware();

// handle item updates
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    return (
      (currentState as RootState).undoable.present.item !==
        (previousState as RootState).undoable.present.item &&
      action.type !== "item/setSelectedSlide" &&
      action.type !== "item/setSelectedBox" &&
      action.type !== "item/setIsEditMode" &&
      action.type !== "item/setItemIsLoading" &&
      action.type !== "item/setSectionLoading" &&
      action.type !== "item/setHasPendingUpdate" &&
      !!(currentState as RootState).undoable.present.item.hasPendingUpdate &&
      action.type !== "RESET"
    );
  },

  effect: async (action, listenerApi) => {
    let state = listenerApi.getState() as RootState;
    if (action.type === "item/setActiveItem") {
      state = listenerApi.getOriginalState() as RootState;
    } else {
      listenerApi.cancelActiveListeners();
      await listenerApi.delay(2500);
    }

    listenerApi.dispatch(itemSlice.actions.setHasPendingUpdate(false));

    // update Item
    const item = state.undoable.present.item;
    if (!db) return;
    let db_item: DBItem = await db.get(item._id);

    db_item = {
      ...db_item,
      name: item.name,
      background: item.background,
      slides: item.slides,
      arrangements: item.arrangements,
      selectedArrangement: item.selectedArrangement,
      bibleInfo: item.bibleInfo,
      timerInfo: item.timerInfo,
      shouldSendTo: item.shouldSendTo,
      updatedAt: new Date().toISOString(),
    };
    db.put(db_item);

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

// When opening a timer item, ensure its timer is in the timers slice (for Demo and when timer was created elsewhere)
listenerMiddleware.startListening({
  predicate: (action) => action.type === "item/setActiveItem",

  effect: (action, listenerApi) => {
    const state = listenerApi.getState() as RootState;
    const item = state.undoable.present.item;
    if (item.type !== "timer" || !item.timerInfo) return;
    const exists = state.timers.timers.some(
      (t) => t.id === item.timerInfo!.id || t.id === item._id
    );
    if (!exists) {
      listenerApi.dispatch(
        addTimer({ ...item.timerInfo, hostId: globalHostId })
      );
    }
  },
});

// handle ItemList updates
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    const state = (currentState as RootState).undoable.present.itemList;
    // Don't save until initialization is complete
    if (!state.isInitialized) return false;

    return (
      (currentState as RootState).undoable.present.itemList !==
        (previousState as RootState).undoable.present.itemList &&
      action.type !== "itemList/initiateItemList" &&
      action.type !== "itemList/setItemListIsLoading" &&
      action.type !== "itemList/setActiveItemInList" &&
      action.type !== "itemList/updateItemListFromRemote" &&
      action.type !== "itemList/setHasPendingUpdate" &&
      action.type !== "itemList/setHighlightedItems" &&
      action.type !== "itemList/addToInitialItems" &&
      action.type !== "itemList/setIsInitialized" &&
      !!(currentState as RootState).undoable.present.itemList
        .hasPendingUpdate &&
      action.type !== "RESET"
    );
  },

  effect: async (action, listenerApi) => {
    let state = listenerApi.getState() as RootState;
    if (action.type === "itemLists/selectItemList") {
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

    return (
      (currentState as RootState).undoable.present.itemLists !==
        (previousState as RootState).undoable.present.itemLists &&
      action.type !== "itemLists/setInitialItemList" &&
      action.type !== "itemLists/initiateItemLists" &&
      action.type !== "itemLists/updateItemListsFromRemote" &&
      action.type !== "itemLists/selectItemList" &&
      action.type !== "itemLists/setIsInitialized" &&
      action.type !== "RESET"
    );
  },

  effect: async (action, listenerApi) => {
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
  },
});

// handle allItems updates
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    const state = (currentState as RootState).allItems;
    // Don't save until initialization is complete
    if (!state.isInitialized) return false;

    return (
      (currentState as RootState).allItems !==
        (previousState as RootState).allItems &&
      action.type !== "allItems/initiateAllItemsList" &&
      action.type !== "allItems/updateAllItemsListFromRemote" &&
      action.type !== "allItems/setSongSearchValue" &&
      action.type !== "allItems/setFreeFormSearchValue" &&
      action.type !== "allItems/setIsInitialized" &&
      action.type !== "RESET"
    );
  },

  effect: async (action, listenerApi) => {
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
  },
});

// handle updating overlay
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    return (
      (currentState as RootState).undoable.present.overlay !==
        (previousState as RootState).undoable.present.overlay &&
      action.type !== "overlay/setHasPendingUpdate" &&
      action.type !== "overlay/setIsOverlayLoading" &&
      action.type !== "RESET" &&
      !!(currentState as RootState).undoable.present.overlay.hasPendingUpdate
    );
  },

  effect: async (action, listenerApi) => {
    let state = listenerApi.getState() as RootState;
    if (action.type === "overlay/selectOverlay") {
      state = listenerApi.getOriginalState() as RootState;
    } else {
      listenerApi.cancelActiveListeners();
      await listenerApi.delay(1500);
    }

    listenerApi.dispatch(overlaySlice.actions.setHasPendingUpdate(false));

    // update overlay
    const { selectedOverlay } = state.undoable.present.overlay;

    if (!db || !selectedOverlay) return;
    const db_overlay: DBOverlay = await db.get(`overlay-${selectedOverlay.id}`);
    db.put({
      ...db_overlay,
      ...selectedOverlay,
      updatedAt: new Date().toISOString(),
    });
  },
});

// handle updating overlays
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    return (
      (currentState as RootState).undoable.present.overlays !==
        (previousState as RootState).undoable.present.overlays &&
      action.type !== "overlays/initiateOverlayList" &&
      action.type !== "overlays/updateOverlayListFromRemote" &&
      action.type !== "overlays/setHasPendingUpdate" &&
      action.type !== "overlays/updateInitialList" &&
      action.type !== "overlays/addToInitialList" &&
      !!(currentState as RootState).undoable.present.overlays
        .hasPendingUpdate &&
      action.type !== "RESET"
    );
  },

  effect: async (action, listenerApi) => {
    let state = listenerApi.getState() as RootState;
    if (action.type === "itemLists/selectItemList") {
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
    return (
      (currentState as RootState).timers !==
        (previousState as RootState).timers &&
      action.type !== "timers/updateTimerFromRemote" &&
      action.type !== "timers/syncTimersFromRemote" &&
      action.type !== "timers/setIntervalId" &&
      action.type !== "timers/setShouldUpdateTimers" &&
      action.type !== "timers/tickTimers" &&
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

      if (globalFireDbInfo.db && globalFireDbInfo.database) {
        // Get current timers from Firebase
        const timersRef = ref(
          globalFireDbInfo.db,
          "users/" +
            capitalizeFirstLetter(globalFireDbInfo.database) +
            "/v2/timers"
        );

        // Get current timers and merge with own timers
        const snapshot = await get(timersRef);
        const currentTimers = snapshot.val() || [];

        // First add other timers to the map
        // Merge timers, prioritizing own timers over remote ones
        const mergedTimers = mergeTimers(
          currentTimers,
          ownTimers,
          globalHostId
        );

        set(timersRef, cleanObject(mergedTimers));
      }
      // Reset flag after writing (to localStorage and/or Firebase) so effect doesn't keep re-running (e.g. for Demo)
      listenerApi.dispatch(timersSlice.actions.setShouldUpdateTimers(false));
    }
  },
});

// handle updating credits
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    const state = (currentState as RootState).undoable.present.credits;
    // Don't save until initialization is complete
    if (!state.isInitialized) return false;

    return (
      (currentState as RootState).undoable.present.credits !==
        (previousState as RootState).undoable.present.credits &&
      action.type !== "credits/initiateCreditsList" &&
      action.type !== "credits/initiateCreditsHistory" &&
      action.type !== "credits/initiatePublishedCreditsList" &&
      action.type !== "credits/updateCreditsListFromRemote" &&
      action.type !== "credits/setHasPendingUpdate" &&
      action.type !== "credits/updateInitialList" &&
      action.type !== "credits/setIsLoading" &&
      action.type !== "credits/initiateTransitionScene" &&
      action.type !== "credits/initiateCreditsScene" &&
      action.type !== "credits/selectCredit" &&
      action.type !== "credits/setIsInitialized" &&
      action.type !== "credits/updateCredit" &&
      action.type !== "credits/deleteCredit" &&
      action.type !== "credits/deleteCreditsHistoryEntry" &&
      action.type !== "credits/updateCreditsHistoryEntry" &&
      action.type !== "RESET"
    );
  },

  effect: async (action, listenerApi) => {
    const state = listenerApi.getState() as RootState;
    listenerApi.cancelActiveListeners();
    await listenerApi.delay(1500);

    const { list, publishedList, transitionScene, creditsScene, scheduleName } =
      state.undoable.present.credits;

    if (
      action.type ===
        creditsSlice.actions.updatePublishedCreditsList.toString() &&
      globalFireDbInfo.db &&
      globalFireDbInfo.database
    ) {
      set(
        ref(
          globalFireDbInfo.db,
          "users/" +
            capitalizeFirstLetter(globalFireDbInfo.database) +
            "/v2/credits/publishedList"
        ),
        cleanObject(publishedList)
      );
      set(
        ref(
          globalFireDbInfo.db,
          "users/" +
            capitalizeFirstLetter(globalFireDbInfo.database) +
            "/v2/credits/transitionScene"
        ),
        transitionScene
      );
      set(
        ref(
          globalFireDbInfo.db,
          "users/" +
            capitalizeFirstLetter(globalFireDbInfo.database) +
            "/v2/credits/creditsScene"
        ),
        creditsScene
      );
      set(
        ref(
          globalFireDbInfo.db,
          "users/" +
            capitalizeFirstLetter(globalFireDbInfo.database) +
            "/v2/credits/scheduleName"
        ),
        scheduleName
      );
    }

    if (!db) return;

    const now = new Date().toISOString();
    const creditIds = list.map((c) => c.id);
    const docsToBroadcast: DBCredits[] = [];

    // List order changed (e.g. drag-and-drop). Update only the index; credit docs are managed by components.
    const db_credits: DBCredits = await db.get("credits");
    db_credits.creditIds = creditIds;
    db_credits.updatedAt = now;
    await db.put(db_credits);
    docsToBroadcast.push(db_credits);

    // Credit history docs (per heading) are written by components: on Publish and when deleting from the history drawer.
    safePostMessage({
      type: "update",
      data: {
        docs: docsToBroadcast,
        hostId: globalHostId,
      },
    });
  },
});

// handle updating media
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    const state = (currentState as RootState).media;
    // Don't save until initialization is complete
    if (!state.isInitialized) return false;

    return (
      (currentState as RootState).media !==
        (previousState as RootState).media &&
      action.type !== "media/initiateMediaList" &&
      action.type !== "media/updateMediaListFromRemote" &&
      action.type !== "media/setIsInitialized" &&
      action.type !== "RESET"
    );
  },

  effect: async (action, listenerApi) => {
    listenerApi.cancelActiveListeners();
    await listenerApi.delay(1500);

    // update ItemList
    const { list } = (listenerApi.getState() as RootState).media;

    if (!db) return;
    const db_backgrounds: DBMedia = await db.get("images");
    db_backgrounds.backgrounds = [...list];
    db_backgrounds.updatedAt = new Date().toISOString();
    db.put(db_backgrounds);

    // Local machine updates
    safePostMessage({
      type: "update",
      data: {
        docs: db_backgrounds,
        hostId: globalHostId,
      },
    });
  },
});

// handle video cache sync when videos are set on items
listenerMiddleware.startListening({
  predicate: (action) => {
    return (
      action.type === "item/updateSlideBackground" ||
      action.type === "item/updateAllSlideBackgrounds"
    );
  },
  effect: async (action, listenerApi) => {
    // Only sync in Electron
    if (!window.electronAPI) return;

    // Check if a video is being set
    const payload = action.payload as {
      background: string;
      mediaInfo?: { type: string };
    };
    if (payload?.mediaInfo?.type !== "video") return;

    // Debounce sync - wait 2 seconds after video is set
    listenerApi.cancelActiveListeners();
    await listenerApi.delay(2000);

    try {
      // Get current state to extract video URLs from Redux state (not database)
      // This ensures we get the latest video even if database save is still pending
      const state = listenerApi.getState() as RootState;
      const currentItem = state.undoable.present.item;

      // Extract video URLs from the current item in Redux state
      const { extractVideoUrlsFromItem } =
        await import("../utils/videoCacheUtils");
      const itemVideoUrls = extractVideoUrlsFromItem(currentItem);

      // Also get all other video URLs from database (for cleanup)
      if (!db) return;
      const allVideoUrls = await extractAllVideoUrlsFromOutlines(db);

      // Combine: current item videos + all other videos from database
      const combinedUrls = new Set([
        ...itemVideoUrls,
        ...Array.from(allVideoUrls),
      ]);
      const urlArray = Array.from(combinedUrls);

      // Sync the cache
      const electronAPI = window.electronAPI as unknown as {
        syncVideoCache: (
          urls: string[]
        ) => Promise<{ downloaded: number; cleaned: number }>;
      };

      if (urlArray.length > 0) {
        const result = await electronAPI.syncVideoCache(urlArray);
        console.log(
          `Video cache sync after item update: ${result.downloaded} downloaded, ${result.cleaned} cleaned`
        );
      } else {
        // No videos, just cleanup
        await electronAPI.syncVideoCache([]);
      }
    } catch (error) {
      console.error("Error syncing video cache after item update:", error);
    }
  },
});

// handle updating preferences
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    const state = (currentState as RootState).undoable.present.preferences;
    // Don't save until initialization is complete
    if (!state.isInitialized) return false;

    return (
      (currentState as RootState).undoable.present.preferences !==
        (previousState as RootState).undoable.present.preferences &&
      action.type !== "preferences/initiatePreferences" &&
      action.type !== "preferences/initiateMonitorSettings" &&
      action.type !== "preferences/initiateQuickLinks" &&
      action.type !== "preferences/increaseSlides" &&
      action.type !== "preferences/increaseSlidesMobile" &&
      action.type !== "preferences/decreaseSlides" &&
      action.type !== "preferences/decreaseSlidesMobile" &&
      action.type !== "preferences/setSlides" &&
      action.type !== "preferences/setSlidesMobile" &&
      action.type !== "preferences/increaseFormattedLyrics" &&
      action.type !== "preferences/decreaseFormattedLyrics" &&
      action.type !== "preferences/setFormattedLyrics" &&
      action.type !== "preferences/setMediaItems" &&
      action.type !== "preferences/setShouldShowItemEditor" &&
      action.type !== "preferences/setIsMediaExpanded" &&
      action.type !== "preferences/setShouldShowStreamFormat" &&
      action.type !== "preferences/setIsLoading" &&
      action.type !== "preferences/setSelectedPreference" &&
      action.type !== "preferences/setSelectedQuickLink" &&
      action.type !== "preferences/setTab" &&
      action.type !== "preferences/setScrollbarWidth" &&
      action.type !== "preferences/updatePreferencesFromRemote" &&
      action.type !== "preferences/setIsInitialized" &&
      action.type !== "RESET"
    );
  },

  effect: async (action, listenerApi) => {
    listenerApi.cancelActiveListeners();
    await listenerApi.delay(1500);

    const { preferences, monitorSettings, quickLinks } = (
      listenerApi.getState() as RootState
    ).undoable.present.preferences;

    if (globalFireDbInfo.db && globalFireDbInfo.database) {
      set(
        ref(
          globalFireDbInfo.db,
          "users/" +
            capitalizeFirstLetter(globalFireDbInfo.database) +
            "/v2/monitorSettings"
        ),
        cleanObject({
          ...monitorSettings,
        })
      );
    }

    if (!db) return;
    try {
      const db_preferences: DBPreferences = await db.get("preferences");
      db_preferences.preferences = preferences;
      db_preferences.quickLinks = quickLinks;
      db_preferences.monitorSettings = monitorSettings;
      db_preferences.updatedAt = new Date().toISOString();
      db.put(db_preferences);
      // Local machine updates
      safePostMessage({
        type: "update",
        data: {
          docs: db_preferences,
          hostId: globalHostId,
        },
      });
    } catch (error) {
      // if the preferences are not found, create a new one
      console.error(error);
      const db_preferences = {
        preferences: preferences,
        quickLinks: quickLinks,
        monitorSettings: monitorSettings,
        _id: "preferences",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      db.put(db_preferences);
    }
  },
});

// handle updating overlay templates
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    const state = (currentState as RootState).undoable.present.overlayTemplates;
    // Don't save until initialization is complete
    if (!state.isInitialized) return false;

    return (
      (currentState as RootState).undoable.present.overlayTemplates !==
        (previousState as RootState).undoable.present.overlayTemplates &&
      action.type !== "overlayTemplates/initiateTemplates" &&
      action.type !== "overlayTemplates/updateTemplatesFromRemote" &&
      action.type !== "overlayTemplates/setIsLoading" &&
      action.type !== "overlayTemplates/setHasPendingUpdate" &&
      action.type !== "overlayTemplates/forceUpdate" &&
      action.type !== "overlayTemplates/setIsInitialized" &&
      !!(currentState as RootState).undoable.present.overlayTemplates
        ?.hasPendingUpdate &&
      action.type !== "RESET"
    );
  },

  effect: async (action, listenerApi) => {
    listenerApi.cancelActiveListeners();
    await listenerApi.delay(1500);

    listenerApi.dispatch(
      overlayTemplatesSlice.actions.setHasPendingUpdate(false)
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
    return (
      (currentState as RootState).undoable.present.serviceTimes !==
        (previousState as RootState).undoable.present.serviceTimes &&
      action.type !== "serviceTimes/initiateServices" &&
      action.type !== "serviceTimes/updateServicesFromRemote" &&
      action.type !== "serviceTimes/setIsInitialized" &&
      action.type !== "RESET"
    );
  },

  effect: async (action, listenerApi) => {
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
    if (globalFireDbInfo.db && globalFireDbInfo.database) {
      set(
        ref(
          globalFireDbInfo.db,
          "users/" +
            capitalizeFirstLetter(globalFireDbInfo.database) +
            "/v2/services"
        ),
        cleanObject(list)
      );
    }
  },
});

// Ensure firebase has updated services on load
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    return action.type === "serviceTimes/initiateServices";
  },

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

    if (globalFireDbInfo.db && globalFireDbInfo.database) {
      set(
        ref(
          globalFireDbInfo.db,
          "users/" +
            capitalizeFirstLetter(globalFireDbInfo.database) +
            "/v2/services"
        ),
        cleanObject(list)
      );
    }
  },
});

// handle updating presentation
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    return (
      (currentState as RootState).presentation !==
        (previousState as RootState).presentation &&
      action.type !== "presentation/toggleProjectorTransmitting" &&
      action.type !== "presentation/toggleMonitorTransmitting" &&
      action.type !== "presentation/toggleStreamTransmitting" &&
      action.type !== "presentation/setTransmitToAll" &&
      action.type !== "presentation/updateProjectorFromRemote" &&
      action.type !== "presentation/updateMonitorFromRemote" &&
      action.type !== "presentation/updateStreamFromRemote" &&
      action.type !== "presentation/updateParticipantOverlayInfoFromRemote" &&
      action.type !== "presentation/updateStbOverlayInfoFromRemote" &&
      action.type !== "presentation/updateBibleDisplayInfoFromRemote" &&
      action.type !== "presentation/updateQrCodeOverlayInfoFromRemote" &&
      action.type !== "presentation/updateImageOverlayInfoFromRemote" &&
      action.type !== "presentation/updateFormattedTextDisplayInfoFromRemote" &&
      action.type !== "RESET"
    );
  },

  effect: async (action, listenerApi) => {
    if (!globalFireDbInfo.db) return;
    listenerApi.cancelActiveListeners();
    await listenerApi.delay(10);

    const { projectorInfo, monitorInfo, streamInfo } = (
      listenerApi.getState() as RootState
    ).presentation;
    const presentationUpdate = {
      projectorInfo,
      monitorInfo,
      streamInfo: {
        displayType: streamInfo.displayType,
        time: streamInfo.time,
        slide: streamInfo.slide,
        timerId: streamInfo.timerId,
      },
      stream_bibleInfo: streamInfo.bibleDisplayInfo,
      stream_participantOverlayInfo: streamInfo.participantOverlayInfo,
      stream_stbOverlayInfo: streamInfo.stbOverlayInfo,
      stream_qrCodeOverlayInfo: streamInfo.qrCodeOverlayInfo,
      stream_imageOverlayInfo: streamInfo.imageOverlayInfo,
      stream_formattedTextDisplayInfo: streamInfo.formattedTextDisplayInfo,
    };

    localStorage.setItem("projectorInfo", JSON.stringify(projectorInfo));
    localStorage.setItem("monitorInfo", JSON.stringify(monitorInfo));
    localStorage.setItem("streamInfo", JSON.stringify(streamInfo));
    localStorage.setItem(
      "stream_bibleInfo",
      JSON.stringify(streamInfo.bibleDisplayInfo)
    );
    localStorage.setItem(
      "stream_participantOverlayInfo",
      JSON.stringify(streamInfo.participantOverlayInfo)
    );
    localStorage.setItem(
      "stream_stbOverlayInfo",
      JSON.stringify(streamInfo.stbOverlayInfo)
    );
    localStorage.setItem(
      "stream_qrCodeOverlayInfo",
      JSON.stringify(streamInfo.qrCodeOverlayInfo)
    );
    localStorage.setItem(
      "stream_imageOverlayInfo",
      JSON.stringify(streamInfo.imageOverlayInfo)
    );
    localStorage.setItem(
      "stream_formattedTextDisplayInfo",
      JSON.stringify(streamInfo.formattedTextDisplayInfo)
    );

    set(
      ref(
        globalFireDbInfo.db,
        "users/" +
          capitalizeFirstLetter(globalFireDbInfo.database) +
          "/v2/presentation"
      ),
      cleanObject(presentationUpdate)
    );
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
      updateProjectorFromRemote(action.payload as Presentation)
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
      updateMonitorFromRemote(action.payload as Presentation)
    );
  },
});

// handle updating from remote stream
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
      updateStreamFromRemote(action.payload as Presentation)
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
      updateBibleDisplayInfoFromRemote(action.payload as BibleDisplayInfo)
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
      updateParticipantOverlayInfoFromRemote(action.payload as OverlayInfo)
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
      updateStbOverlayInfoFromRemote(action.payload as OverlayInfo)
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
      updateQrCodeOverlayInfoFromRemote(action.payload as OverlayInfo)
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
      updateImageOverlayInfoFromRemote(action.payload as OverlayInfo)
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
        action.payload as FormattedTextDisplayInfo
      )
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

    // Only force update for slices that actually changed during undo/redo
    if (
      !_.isEqual(
        currentState.undoable.present.item,
        previousState.undoable.present.item
      )
    ) {
      listenerApi.dispatch(itemSlice.actions.forceUpdate());
    }

    if (
      !_.isEqual(
        currentState.undoable.present.overlay,
        previousState.undoable.present.overlay
      )
    ) {
      listenerApi.dispatch(overlaySlice.actions.forceUpdate());
    }

    if (
      !_.isEqual(
        currentState.undoable.present.overlays,
        previousState.undoable.present.overlays
      )
    ) {
      listenerApi.dispatch(overlaysSlice.actions.forceUpdate());
    }

    if (
      !_.isEqual(
        currentState.undoable.present.itemList,
        previousState.undoable.present.itemList
      )
    ) {
      listenerApi.dispatch(itemListSlice.actions.forceUpdate());
    }

    if (
      !_.isEqual(
        currentState.undoable.present.itemLists,
        previousState.undoable.present.itemLists
      )
    ) {
      listenerApi.dispatch(itemListsSlice.actions.forceUpdate());
    }

    if (
      !_.isEqual(
        currentState.undoable.present.preferences,
        previousState.undoable.present.preferences
      )
    ) {
      listenerApi.dispatch(preferencesSlice.actions.forceUpdate());
    }

    if (
      !_.isEqual(
        currentState.undoable.present.credits,
        previousState.undoable.present.credits
      )
    ) {
      listenerApi.dispatch(creditsSlice.actions.forceUpdate());
    }

    if (
      !_.isEqual(
        currentState.undoable.present.overlayTemplates,
        previousState.undoable.present.overlayTemplates
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
export const INFO_CONTROLLER_PAGE_READY = "INFO_CONTROLLER_PAGE_READY";

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

const isInfoControllerPageReady = (state: RootState) => {
  return state.undoable.present.serviceTimes.isInitialized;
};

listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    if (action.type === "RESET_INITIALIZATION") {
      hasFinishedInitialization = false;
    }

    const explicitPageReady =
      action.type === CREDITS_EDITOR_PAGE_READY ||
      action.type === CONTROLLER_PAGE_READY ||
      action.type === INFO_CONTROLLER_PAGE_READY;
    if (explicitPageReady) return true;

    // Fallback for hot reload / full reload: no page-ready was dispatched yet
    // but state already has a page's slices initialized. Any state change can trigger this.
    if (hasFinishedInitialization) return false;
    if (currentState === previousState) return false;

    const state = currentState as RootState;
    const ready =
      isCreditsPageReady(state) ||
      areControllerSlicesReady(state) ||
      isInfoControllerPageReady(state);
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
        { timeout: 10000 }
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
  overlayTemplates: overlayTemplatesSlice.reducer,
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
