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
  DBCredits,
  DBItem,
  DBItemListDetails,
  DBItemLists,
  DBMedia,
  DBOverlay,
  DBPreferences,
  FormattedTextDisplayInfo,
  OverlayInfo,
  Presentation,
  TimerInfo,
} from "../types";
import { allDocsSlice } from "./allDocsSlice";
import { creditsSlice } from "./creditsSlice";
import { timersSlice, updateTimerFromRemote } from "./timersSlice";
import { mergeTimers } from "../utils/timerUtils";
import _ from "lodash";

const cleanObject = (obj: Object) =>
  JSON.parse(JSON.stringify(obj, (_, val) => (val === undefined ? null : val)));

let lastActionTime = 0;
let currentGroupId = 0;

const excludedActions: string[] = [
  itemSlice.actions.setItemIsLoading.toString(),
  itemSlice.actions.setActiveItem.toString(),
  itemSlice.actions.setSelectedSlide.toString(),
  itemSlice.actions.setIsEditMode.toString(),
  itemSlice.actions.setHasPendingUpdate.toString(),
  itemSlice.actions.setSelectedSlide.toString(),
  itemSlice.actions.setSelectedBox.toString(),
  overlaysSlice.actions.initiateOverlayList.toString(),
  overlaysSlice.actions.updateOverlayListFromRemote.toString(),
  overlaysSlice.actions.setHasPendingUpdate.toString(),
  overlaysSlice.actions.updateInitialList.toString(),
  creditsSlice.actions.initiateCreditsList.toString(),
  creditsSlice.actions.initiateTransitionScene.toString(),
  creditsSlice.actions.initiateCreditsScene.toString(),
  creditsSlice.actions.initiatePublishedCreditsList.toString(),
  creditsSlice.actions.updateCreditsListFromRemote.toString(),
  creditsSlice.actions.updatePublishedCreditsListFromRemote.toString(),
  creditsSlice.actions.updateInitialList.toString(),
  creditsSlice.actions.setIsLoading.toString(),
  creditsSlice.actions.selectCredit.toString(),
  itemListSlice.actions.initiateItemList.toString(),
  itemListSlice.actions.updateItemListFromRemote.toString(),
  itemListSlice.actions.setItemListIsLoading.toString(),
  itemListSlice.actions.setHasPendingUpdate.toString(),
  itemListSlice.actions.setActiveItemInList.toString(),
  itemListsSlice.actions.initiateItemLists.toString(),
  itemListsSlice.actions.updateItemListsFromRemote.toString(),
  itemListsSlice.actions.setInitialItemList.toString(),
  mediaItemsSlice.actions.initiateMediaList.toString(),
  mediaItemsSlice.actions.updateMediaListFromRemote.toString(),
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
  overlaySlice.actions.setIsOverlayLoading.toString(),
  overlaySlice.actions.setHasPendingUpdate.toString(),
  overlaySlice.actions.selectOverlay.toString(),
  timersSlice.actions.syncTimersFromRemote.toString(),
  timersSlice.actions.setTimersFromDocs.toString(),
  timersSlice.actions.setShouldUpdateTimers.toString(),
  allDocsSlice.actions.updateAllFreeFormDocs.toString(),
  allDocsSlice.actions.updateAllSongDocs.toString(),
  allDocsSlice.actions.updateAllTimerDocs.toString(),
  allItemsSlice.actions.initiateAllItemsList.toString(),
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
    media: mediaItemsSlice.reducer,
    preferences: preferencesSlice.reducer,
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
    globalBroadcastRef.postMessage({
      type: "update",
      data: {
        docs: db_item,
        hostId: globalHostId,
      },
    });
  },
});

// handle ItemList updates
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
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
    globalBroadcastRef.postMessage({
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
    return (
      (currentState as RootState).undoable.present.itemLists !==
        (previousState as RootState).undoable.present.itemLists &&
      action.type !== "itemLists/setInitialItemList" &&
      action.type !== "itemLists/initiateItemLists" &&
      action.type !== "itemLists/updateItemListsFromRemote" &&
      action.type !== "RESET"
    );
  },

  effect: async (action, listenerApi) => {
    listenerApi.cancelActiveListeners();
    await listenerApi.delay(1500);

    // update ItemList
    const { currentLists, selectedList } = (listenerApi.getState() as RootState)
      .undoable.present.itemLists;

    if (!db || !selectedList) return;
    const db_itemLists: DBItemLists = await db.get("ItemLists");
    db_itemLists.itemLists = [...currentLists];
    db_itemLists.selectedList = selectedList;
    db_itemLists.updatedAt = new Date().toISOString();
    db.put(db_itemLists);

    // Local machine updates
    globalBroadcastRef.postMessage({
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
    return (
      (currentState as RootState).allItems !==
        (previousState as RootState).allItems &&
      action.type !== "allItems/initiateAllItemsList" &&
      action.type !== "allItems/updateAllItemsListFromRemote" &&
      action.type !== "allItems/setSongSearchValue" &&
      action.type !== "allItems/setFreeFormSearchValue" &&
      action.type !== "RESET"
    );
  },

  effect: async (action, listenerApi) => {
    listenerApi.cancelActiveListeners();
    await listenerApi.delay(1500);

    console.log("allItems update", action);

    // update ItemList
    const { list } = (listenerApi.getState() as RootState).allItems;

    if (!db) return;
    const db_allItems: DBAllItems = await db.get("allItems");
    db_allItems.items = [...list];
    db_allItems.updatedAt = new Date().toISOString();
    db.put(db_allItems);

    // Local machine updates
    globalBroadcastRef.postMessage({
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
    globalBroadcastRef.postMessage({
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

      if (globalFireDbInfo.db && globalFireDbInfo.user) {
        // Get current timers from Firebase
        const timersRef = ref(
          globalFireDbInfo.db,
          "users/" + globalFireDbInfo.user + "/v2/timers"
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
        listenerApi.dispatch(timersSlice.actions.setShouldUpdateTimers(false));
      }
    }
  },
});

// handle updating credits
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    return (
      (currentState as RootState).undoable.present.credits !==
        (previousState as RootState).undoable.present.credits &&
      action.type !== "credits/initiateCreditsList" &&
      action.type !== "credits/initiatePublishedCreditsList" &&
      action.type !== "credits/updateCreditsListFromRemote" &&
      action.type !== "credits/setHasPendingUpdate" &&
      action.type !== "credits/updateInitialList" &&
      action.type !== "credits/setIsLoading" &&
      action.type !== "credits/initiateTransitionScene" &&
      action.type !== "credits/initiateCreditsScene" &&
      action.type !== "credits/selectCredit" &&
      action.type !== "RESET"
    );
  },

  effect: async (action, listenerApi) => {
    const state = listenerApi.getState() as RootState;
    listenerApi.cancelActiveListeners();
    await listenerApi.delay(1500);

    // update db with lists
    const { list, publishedList, transitionScene, creditsScene, scheduleName } =
      state.undoable.present.credits;

    if (
      action.type ===
        creditsSlice.actions.updatePublishedCreditsList.toString() &&
      globalFireDbInfo.db &&
      globalFireDbInfo.user
    ) {
      set(
        ref(
          globalFireDbInfo.db,
          "users/" + globalFireDbInfo.user + "/v2/credits/publishedList"
        ),
        cleanObject(publishedList)
      );
      set(
        ref(
          globalFireDbInfo.db,
          "users/" + globalFireDbInfo.user + "/v2/credits/transitionScene"
        ),
        transitionScene
      );
      set(
        ref(
          globalFireDbInfo.db,
          "users/" + globalFireDbInfo.user + "/v2/credits/creditsScene"
        ),
        creditsScene
      );
      set(
        ref(
          globalFireDbInfo.db,
          "users/" + globalFireDbInfo.user + "/v2/credits/scheduleName"
        ),
        scheduleName
      );
    }

    if (!db) return;
    const db_credits: DBCredits = await db.get("credits");
    db_credits.list = list;
    db_credits.updatedAt = new Date().toISOString();
    db.put(db_credits);
    // Local machine updates
    globalBroadcastRef.postMessage({
      type: "update",
      data: {
        docs: db_credits,
        hostId: globalHostId,
      },
    });
  },
});

// handle updating media
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    return (
      (currentState as RootState).undoable.present.media !==
        (previousState as RootState).undoable.present.media &&
      action.type !== "media/initiateMediaList" &&
      action.type !== "media/updateMediaListFromRemote" &&
      action.type !== "RESET"
    );
  },

  effect: async (action, listenerApi) => {
    listenerApi.cancelActiveListeners();
    await listenerApi.delay(1500);

    // update ItemList
    const { list } = (listenerApi.getState() as RootState).undoable.present
      .media;

    if (!db) return;
    const db_backgrounds: DBMedia = await db.get("images");
    db_backgrounds.backgrounds = [...list];
    db_backgrounds.updatedAt = new Date().toISOString();
    db.put(db_backgrounds);

    // Local machine updates
    globalBroadcastRef.postMessage({
      type: "update",
      data: {
        docs: db_backgrounds,
        hostId: globalHostId,
      },
    });
  },
});

// handle updating preferences
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    return (
      (currentState as RootState).undoable.present.preferences !==
        (previousState as RootState).undoable.present.preferences &&
      action.type !== "preferences/initiatePreferences" &&
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
      action.type !== "RESET"
    );
  },

  effect: async (action, listenerApi) => {
    listenerApi.cancelActiveListeners();
    await listenerApi.delay(1500);

    // update ItemList
    const { preferences, quickLinks } = (listenerApi.getState() as RootState)
      .undoable.present.preferences;

    if (!db) return;
    try {
      const db_preferences: DBPreferences = await db.get("preferences");
      db_preferences.preferences = preferences;
      db_preferences.quickLinks = quickLinks;
      db_preferences.updatedAt = new Date().toISOString();
      db.put(db_preferences);
      // Local machine updates
      globalBroadcastRef.postMessage({
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
        _id: "preferences",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      db.put(db_preferences);
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
        "users/" + globalFireDbInfo.user + "/v2/presentation"
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
    console.log("Updating timer from remote", action.payload);
    listenerApi.cancelActiveListeners();
    await listenerApi.delay(10);

    listenerApi.dispatch(updateTimerFromRemote(action.payload as TimerInfo));
  },
});

// Handle undo/redo operations to set hasPendingUpdate for affected slices
listenerMiddleware.startListening({
  predicate: (action) => {
    return (
      action.type === "@@redux-undo/UNDO" || action.type === "@@redux-undo/REDO"
    );
  },
  effect: async (action, listenerApi) => {
    const currentState = listenerApi.getState() as RootState;
    const previousState = listenerApi.getOriginalState() as RootState;

    // Only set hasPendingUpdate to true for slices that actually changed during undo/redo
    if (
      !_.isEqual(
        currentState.undoable.present.item,
        previousState.undoable.present.item
      )
    ) {
      listenerApi.dispatch(itemSlice.actions.setHasPendingUpdate(true));
    }

    if (
      !_.isEqual(
        currentState.undoable.present.overlay,
        previousState.undoable.present.overlay
      )
    ) {
      listenerApi.dispatch(overlaySlice.actions.setHasPendingUpdate(true));
    }

    if (
      !_.isEqual(
        currentState.undoable.present.overlays,
        previousState.undoable.present.overlays
      )
    ) {
      listenerApi.dispatch(overlaysSlice.actions.setHasPendingUpdate(true));
    }

    if (
      !_.isEqual(
        currentState.undoable.present.itemList,
        previousState.undoable.present.itemList
      )
    ) {
      listenerApi.dispatch(itemListSlice.actions.setHasPendingUpdate(true));
    }
  },
});

// Track when all slices are actually initialized and clear undo history
let hasFinishedInitialization = false;

const safeRequestIdleCallback =
  window.requestIdleCallback ||
  function (cb) {
    return setTimeout(cb, 1);
  };

listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    // Check if any slice state changed
    if (currentState === previousState) return false;

    // Only proceed if we haven't cleared history yet
    if (hasFinishedInitialization) return false;

    const state = currentState as RootState;

    // Check if all required slices have isInitialized = true
    const allSlicesInitialized =
      state.allItems.isInitialized &&
      state.undoable.present.preferences.isInitialized &&
      state.undoable.present.itemList.isInitialized &&
      state.undoable.present.overlays.isInitialized &&
      state.undoable.present.itemLists.isInitialized &&
      state.undoable.present.media.isInitialized;

    return allSlicesInitialized;
  },

  effect: async (_, listenerApi) => {
    // Wait for browser to be idle to ensure all state updates are processed

    if (!hasFinishedInitialization) {
      hasFinishedInitialization = true;
      safeRequestIdleCallback(
        () => {
          console.log("✅ All slices initialized - clearing undo history");
          listenerApi.dispatch(ActionCreators.clearHistory());
        },
        { timeout: 10000 }
      );
    }
  },
});

listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    return currentState !== previousState;
  },
  effect: async (action, listenerApi) => {
    console.log(action);
  },
});

const combinedReducers = combineReducers({
  undoable: undoableReducers,
  presentation: presentationSlice.reducer,
  bible: bibleSlice.reducer,
  allItems: allItemsSlice.reducer,
  createItem: createItemSlice.reducer,
  allDocs: allDocsSlice.reducer,
  timers: timersSlice.reducer,
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
