import {
  Action,
  combineReducers,
  configureStore,
  createListenerMiddleware,
  Reducer,
} from "@reduxjs/toolkit";
import undoable, { excludeAction } from "redux-undo";
import {
  presentationSlice,
  updateBibleDisplayInfoFromRemote,
  updateMonitorFromRemote,
  updateParticipantOverlayInfoFromRemote,
  updateProjectorFromRemote,
  updateQrCodeOverlayInfoFromRemote,
  updateStbOverlayInfoFromRemote,
  updateStreamFromRemote,
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
import { globalDb as db } from "../context/controllerInfo";
import { globalFireDbInfo } from "../context/globalInfo";
import { ref, set } from "firebase/database";
import {
  BibleDisplayInfo,
  DBAllItems,
  DBCredits,
  DBItem,
  DBItemListDetails,
  DBItemLists,
  DBMedia,
  OverlayInfo,
  Presentation,
} from "../types";
import { allDocsSlice } from "./allDocsSlice";
import { creditsSlice } from "./creditsSlice";

const cleanObject = (obj: Object) =>
  JSON.parse(JSON.stringify(obj, (_, val) => (val === undefined ? null : val)));

const undoableReducers = undoable(
  combineReducers({
    item: itemSlice.reducer,
    overlays: overlaysSlice.reducer,
    credits: creditsSlice.reducer,
    itemList: itemListSlice.reducer,
    itemLists: itemListsSlice.reducer,
    media: mediaItemsSlice.reducer,
  }),
  {
    filter: excludeAction([
      itemSlice.actions.setItemIsLoading.toString(),
      itemSlice.actions.setActiveItem.toString(),
      itemSlice.actions.setSelectedSlide.toString(),
      itemSlice.actions.toggleEditMode.toString(),
      itemSlice.actions.setHasPendingUpdate.toString(),
      itemSlice.actions.setSelectedSlide.toString(),
      itemSlice.actions.setSelectedBox.toString(),
      overlaysSlice.actions.selectOverlay.toString(),
      overlaysSlice.actions.initiateOverlayList.toString(),
      overlaysSlice.actions.updateOverlayListFromRemote.toString(),
      overlaysSlice.actions.setHasPendingUpdate.toString(),
      overlaysSlice.actions.updateInitialList.toString(),
      creditsSlice.actions.initiateCreditsList.toString(),
      creditsSlice.actions.initiateTransitionScene.toString(),
      creditsSlice.actions.initiatePublishedCreditsList.toString(),
      creditsSlice.actions.updateCreditsListFromRemote.toString(),
      creditsSlice.actions.updatePublishedCreditsListFromRemote.toString(),
      creditsSlice.actions.updateInitialList.toString(),
      creditsSlice.actions.setIsLoading.toString(),
      itemListSlice.actions.initiateItemList.toString(),
      itemListSlice.actions.updateItemListFromRemote.toString(),
      itemListSlice.actions.setItemListIsLoading.toString(),
      itemListSlice.actions.setHasPendingUpdate.toString(),
      itemListsSlice.actions.initiateItemLists.toString(),
      itemListsSlice.actions.updateItemListsFromRemote.toString(),
      itemListsSlice.actions.setInitialItemList.toString(),
      mediaItemsSlice.actions.initiateMediaList.toString(),
      mediaItemsSlice.actions.updateMediaListFromRemote.toString(),
    ]),
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
      action.type !== "item/toggleEditMode" &&
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
      await listenerApi.delay(3500);
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
    };
    db.put(db_item);
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
    let db_itemList: DBItemListDetails = await db.get(selectedList._id);
    db_itemList.items = [...list];
    db.put(db_itemList);
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
    db.put(db_itemLists);
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

    // update ItemList
    const { list } = (listenerApi.getState() as RootState).allItems;

    if (!db) return;
    const db_allItems: DBAllItems = await db.get("allItems");
    db_allItems.items = [...list];
    db.put(db_allItems);
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
      action.type !== "overlays/selectOverlay" &&
      action.type !== "overlays/setHasPendingUpdate" &&
      action.type !== "overlays/updateInitialList" &&
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
    db_itemList.overlays = [...list];
    db.put(db_itemList);
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
      action.type !== "RESET"
    );
  },

  effect: async (action, listenerApi) => {
    let state = listenerApi.getState() as RootState;
    listenerApi.cancelActiveListeners();
    await listenerApi.delay(1500);

    // update db with lists
    const { list, publishedList, transitionScene } =
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
    }

    if (!db) return;
    const db_credits: DBCredits = await db.get("credits");
    db_credits.list = list;
    db.put(db_credits);
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
    db.put(db_backgrounds);
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
      },
      stream_bibleInfo: streamInfo.bibleDisplayInfo,
      stream_participantOverlayInfo: streamInfo.participantOverlayInfo,
      stream_stbOverlayInfo: streamInfo.stbOverlayInfo,
      stream_qrCodeOverlayInfo: streamInfo.qrCodeOverlayInfo,
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
  preferences: preferencesSlice.reducer,
  allDocs: allDocsSlice.reducer,
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
    getDefaultMiddleware().prepend(listenerMiddleware.middleware),
});

export default store;

// Infer the `RootState` and `AppDispatch` types from the store itself
export type RootState = ReturnType<typeof combinedReducers>;
// Inferred type: {posts: PostsState, comments: CommentsState, users: UsersState}
export type AppDispatch = typeof store.dispatch;
