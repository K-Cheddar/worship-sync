import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import _ from "lodash";
import {
  Arrangment,
  BibleInfo,
  Box,
  DBItem,
  FormattedSection,
  ItemSlideType,
  ItemState,
  MediaType,
  SongMetadata,
  ShouldSendTo,
  TimerInfo,
} from "../types";
import { createAsyncThunk } from "../hooks/reduxHooks";
import {
  getIndexFromSelectionHint,
  getSelectionHint,
} from "../utils/selectionHint";
import { updateAllItemsList } from "./allItemsSlice";
import { updateItemList } from "./itemListSlice";
import { updateItemInList } from "../utils/itemUtil";
import { mapSlidesUpdateBox0ById } from "../utils/slideBackgroundSubset";
import { AppDispatch, RootState } from "./store";

const defaultShouldSendTo: ShouldSendTo = {
  projector: true,
  monitor: true,
  stream: true,
};

const initialState: ItemState = {
  isEditMode: false,
  name: "",
  type: "",
  _id: "1",
  listId: "",
  selectedArrangement: 0,
  shouldSkipTitle: false,
  background: "",
  arrangements: [],
  selectedSlide: 0,
  slides: [],
  selectedBox: 1,
  bibleInfo: {
    book: "",
    chapter: "",
    version: "",
    verses: [],
    fontMode: "separate",
  },
  timerInfo: undefined,
  isLoading: true,
  isSectionLoading: false,
  isItemFormatting: false,
  hasPendingUpdate: false,
  hasRemoteUpdate: false,
  baseItem: null,
  pendingRemoteItem: null,
  shouldSendTo: defaultShouldSendTo,
  restoreFocusToBox: null,
  songMetadata: undefined,
  backgroundTargetSlideIds: [],
  backgroundTargetRangeAnchorId: null,
  mobileBackgroundTargetSelectMode: false,
};

const resetBackgroundTargetUi = (state: ItemState) => {
  state.backgroundTargetSlideIds = [];
  state.backgroundTargetRangeAnchorId = null;
  state.mobileBackgroundTargetSelectMode = false;
};

/** When the last target slide is deselected, leave subset selection mode (anchor + mobile). */
const exitBackgroundTargetSelectModeIfNoTargets = (state: ItemState) => {
  if (state.backgroundTargetSlideIds?.length) return;
  state.backgroundTargetRangeAnchorId = null;
  state.mobileBackgroundTargetSelectMode = false;
};

const resetTransientItemState = (state: ItemState) => {
  state.isLoading = false;
  state.isSectionLoading = false;
  state.isItemFormatting = false;
  state.hasPendingUpdate = false;
  state.restoreFocusToBox = null;
};

const createItemSnapshot = (
  item?: Partial<ItemState> | DBItem | null,
): DBItem | null => {
  if (!item?._id || !item.type) return null;

  return {
    _id: item._id,
    name: item.name || "",
    type: item.type,
    shouldSkipTitle: item.shouldSkipTitle,
    selectedArrangement: item.selectedArrangement ?? 0,
    background: item.background,
    arrangements: item.arrangements || [],
    slides: item.slides || [],
    bibleInfo: item.bibleInfo,
    timerInfo: item.timerInfo,
    shouldSendTo: item.shouldSendTo || defaultShouldSendTo,
    formattedSections: item.formattedSections,
    songMetadata: item.songMetadata,
    _rev: (item as DBItem)._rev,
    createdAt: (item as DBItem).createdAt,
    updatedAt: (item as DBItem).updatedAt,
    createdBy: (item as DBItem).createdBy,
    updatedBy: (item as DBItem).updatedBy,
    docType: (item as DBItem).docType,
  };
};

const defaultBibleInfoForCompare: BibleInfo = {
  book: "",
  chapter: "",
  version: "",
  verses: [],
  fontMode: "separate",
};

/** Align optional fields so DB docs missing nested objects match in-memory item state. */
function normalizeSnapshotForEditorCompare(snap: DBItem): DBItem {
  return {
    ...snap,
    shouldSkipTitle: snap.shouldSkipTitle ?? false,
    background: snap.background ?? "",
    bibleInfo: snap.bibleInfo ?? defaultBibleInfoForCompare,
    arrangements: snap.arrangements ?? [],
    slides: snap.slides ?? [],
    shouldSendTo: snap.shouldSendTo ?? defaultShouldSendTo,
  };
}

/** Strips Couch metadata so echo/sync round-trips match the editor despite new `_rev` / timestamps. */
const omitItemSyncMetadata = (snap: DBItem) => {
  const { _rev, updatedAt, createdAt, createdBy, updatedBy, ...rest } = snap;
  return rest;
};

/**
 * True when `doc` matches what the user already has in the editor (persisted shape), ignoring
 * `_rev` / `updatedAt` / `createdAt`. Used to avoid false "remote update" conflicts when sync
 * replays the user's own pending edits.
 */
export function itemDocMatchesEditorState(
  doc: DBItem,
  currentItem: ItemState,
): boolean {
  const snapDoc = createItemSnapshot(doc);
  const snapState = createItemSnapshot(currentItem);
  if (!snapDoc || !snapState) return false;
  return _.isEqual(
    omitItemSyncMetadata(normalizeSnapshotForEditorCompare(snapDoc)),
    omitItemSyncMetadata(normalizeSnapshotForEditorCompare(snapState)),
  );
}

const getSlideCount = (
  item: Partial<ItemState> | DBItem,
  arrangementIndex: number,
) => {
  if (item.type === "song" && item.arrangements?.length) {
    return (
      item.arrangements[arrangementIndex]?.slides?.length ??
      item.slides?.length ??
      0
    );
  }

  return item.slides?.length ?? 0;
};

const applyItemDataToState = (
  state: ItemState,
  payload: Partial<ItemState> | DBItem,
  options?: { preserveSelection?: boolean },
) => {
  const preserveSelection = options?.preserveSelection ?? false;
  const nextListId = "listId" in payload ? payload.listId : undefined;
  const nextSelectedSlide =
    "selectedSlide" in payload ? payload.selectedSlide : undefined;
  const nextSelectedBox =
    "selectedBox" in payload ? payload.selectedBox : undefined;
  const nextArrangement = preserveSelection
    ? Math.min(
        state.selectedArrangement ?? 0,
        Math.max(0, (payload.arrangements?.length ?? 1) - 1),
      )
    : (payload.selectedArrangement ?? 0);
  const slideCount = getSlideCount(payload, nextArrangement);

  state.name = payload.name || state.name;
  state.type = payload.type || state.type;
  state._id = payload._id || state._id;
  state.listId = nextListId || state.listId;
  if ("background" in payload && payload.background !== undefined) {
    state.background = payload.background;
  }
  state.selectedArrangement = nextArrangement;
  state.selectedSlide = preserveSelection
    ? Math.min(state.selectedSlide ?? 0, Math.max(0, slideCount - 1))
    : (nextSelectedSlide ?? 0);
  state.selectedBox = preserveSelection
    ? (state.selectedBox ?? 1)
    : (nextSelectedBox ?? 1);
  state.shouldSkipTitle = payload.shouldSkipTitle || false;
  state.arrangements = payload.arrangements || [];
  state.slides = payload.slides || [];
  state.formattedSections =
    payload.formattedSections || state.formattedSections;
  state.bibleInfo = payload.bibleInfo || {
    book: "",
    chapter: "",
    version: "",
    verses: [],
    fontMode: "separate",
  };
  state.timerInfo = payload.timerInfo;
  state.shouldSendTo = payload.shouldSendTo || defaultShouldSendTo;
  state.songMetadata = payload.songMetadata || undefined;
  resetTransientItemState(state);
};

export const itemSlice = createSlice({
  name: "item",
  initialState,
  reducers: {
    setActiveItem: (state, action: PayloadAction<Partial<ItemState>>) => {
      applyItemDataToState(state, action.payload);
      resetBackgroundTargetUi(state);
      state.baseItem = createItemSnapshot(action.payload);
      state.pendingRemoteItem = null;
      state.hasRemoteUpdate = false;
    },
    setIsEditMode: (state, action: PayloadAction<boolean>) => {
      state.isEditMode = action.payload;
    },
    _setName: (state, action: PayloadAction<string>) => {
      state.name = action.payload;
      state.hasPendingUpdate = true;
    },
    setSelectedSlide: (state, action: PayloadAction<number>) => {
      state.selectedSlide = action.payload;
    },
    _setSelectedArrangement: (state, action: PayloadAction<number>) => {
      const next = action.payload;
      if (state.selectedArrangement !== next) {
        resetBackgroundTargetUi(state);
      }
      state.selectedArrangement = next;
      state.hasPendingUpdate = true;
    },
    _updateArrangements: (state, action: PayloadAction<Arrangment[]>) => {
      state.arrangements = [...action.payload];
      state.hasPendingUpdate = true;
    },
    _updateSlides: (state, action: PayloadAction<ItemSlideType[]>) => {
      state.slides = [...action.payload];
      state.hasPendingUpdate = true;
    },
    _updateBibleInfo: (state, action: PayloadAction<BibleInfo>) => {
      state.bibleInfo = action.payload;
      state.hasPendingUpdate = true;
    },
    _updateTimerInfo: (state, action: PayloadAction<TimerInfo>) => {
      state.timerInfo = action.payload;
      state.hasPendingUpdate = true;
    },
    syncLiveTimerInfo: (state, action: PayloadAction<TimerInfo>) => {
      state.timerInfo = action.payload;
    },
    _updateFormattedSections: (
      state,
      action: PayloadAction<FormattedSection[]>,
    ) => {
      state.formattedSections = [...action.payload];
      state.hasPendingUpdate = true;
    },
    setSongMetadata: (
      state,
      action: PayloadAction<SongMetadata | null | undefined>,
    ) => {
      state.songMetadata = action.payload ?? undefined;
      state.hasPendingUpdate = true;
    },
    setItemIsLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
    },
    setSectionLoading: (state, action: PayloadAction<boolean>) => {
      state.isSectionLoading = action.payload;
    },
    setBackground: (state, action: PayloadAction<string>) => {
      state.background = action.payload;
      state.hasPendingUpdate = true;
    },
    setHasPendingUpdate: (state, action: PayloadAction<boolean>) => {
      state.hasPendingUpdate = action.payload;
    },
    forceUpdate: (state) => {
      state.hasPendingUpdate = true;
    },
    setSelectedBox: (state, action: PayloadAction<number>) => {
      state.selectedBox = action.payload;
    },
    setItemFormatting: (state, action: PayloadAction<boolean>) => {
      state.isItemFormatting = action.payload;
    },
    setShouldSendTo: (state, action: PayloadAction<Partial<ShouldSendTo>>) => {
      state.shouldSendTo = {
        ...state.shouldSendTo,
        ...action.payload,
      };
      state.hasPendingUpdate = true;
    },
    setRestoreFocusToBox: (
      state,
      action: PayloadAction<number | null | undefined>,
    ) => {
      state.restoreFocusToBox = action.payload ?? null;
    },
    clearTransientState: (state) => {
      resetTransientItemState(state);
    },
    markItemPersisted: (state, action: PayloadAction<DBItem>) => {
      if (state._id !== action.payload._id) return;
      state.baseItem = createItemSnapshot(action.payload);
      state.pendingRemoteItem = null;
      state.hasRemoteUpdate = false;
    },
    bufferRemoteItemUpdate: (state, action: PayloadAction<DBItem>) => {
      if (state._id !== action.payload._id) return;
      state.pendingRemoteItem = action.payload;
      state.hasRemoteUpdate = true;
    },
    discardPendingRemoteItem: (state) => {
      state.pendingRemoteItem = null;
      state.hasRemoteUpdate = false;
    },
    applyPendingRemoteItem: (state) => {
      if (!state.pendingRemoteItem) return;
      applyItemDataToState(state, state.pendingRemoteItem, {
        preserveSelection: true,
      });
      resetBackgroundTargetUi(state);
      state.baseItem = createItemSnapshot(state.pendingRemoteItem);
      state.pendingRemoteItem = null;
      state.hasRemoteUpdate = false;
    },
    toggleBackgroundTargetSlideId: (state, action: PayloadAction<string>) => {
      if (!state.backgroundTargetSlideIds) state.backgroundTargetSlideIds = [];
      const id = action.payload;
      const i = state.backgroundTargetSlideIds.indexOf(id);
      if (i >= 0) {
        state.backgroundTargetSlideIds.splice(i, 1);
      } else {
        state.backgroundTargetSlideIds.push(id);
      }
      exitBackgroundTargetSelectModeIfNoTargets(state);
      if (state.backgroundTargetSlideIds.length > 1) {
        state.mobileBackgroundTargetSelectMode = true;
      }
    },
    setBackgroundTargetSlideIds: (state, action: PayloadAction<string[]>) => {
      state.backgroundTargetSlideIds = [...action.payload];
      exitBackgroundTargetSelectModeIfNoTargets(state);
      if (state.backgroundTargetSlideIds.length > 1) {
        state.mobileBackgroundTargetSelectMode = true;
      }
    },
    setBackgroundTargetRangeAnchorId: (
      state,
      action: PayloadAction<string | null>,
    ) => {
      state.backgroundTargetRangeAnchorId = action.payload;
    },
    setMobileBackgroundTargetSelectMode: (
      state,
      action: PayloadAction<boolean>,
    ) => {
      state.mobileBackgroundTargetSelectMode = action.payload;
    },
    clearBackgroundTargetSelection: (state) => {
      resetBackgroundTargetUi(state);
    },
    clearBackgroundTargetSlideIdsOnly: (state) => {
      state.backgroundTargetSlideIds = [];
      exitBackgroundTargetSelectModeIfNoTargets(state);
    },
  },
});

type UpdateItemInListsType = {
  value: any;
  property: string;
  state: RootState;
  dispatch: AppDispatch;
};
const _updateItemInLists = ({
  value,
  property,
  state,
  dispatch,
}: UpdateItemInListsType) => {
  const { list } = state.undoable.present.itemList;
  const { list: allItemsList } = state.allItems;
  const { _id } = state.undoable.present.item;

  const updatedList = updateItemInList({
    property,
    value,
    id: _id,
    list,
  });
  const updatedAllItemsList = updateItemInList({
    property,
    value,
    id: _id,
    list: allItemsList,
  });

  dispatch(updateAllItemsList(updatedAllItemsList));
  dispatch(updateItemList(updatedList));
};

export const setName = createAsyncThunk(
  "item/updateName",
  async (args: { name: string }, { dispatch, getState }) => {
    const newName = args.name;

    const state = getState();

    dispatch(_setName(newName));

    _updateItemInLists({
      value: newName,
      property: "name",
      state,
      dispatch,
    });
  },
);

export const setSelectedArrangement = createAsyncThunk(
  "item/setSelectedArrangement",
  async (args: { selectedArrangement: number }, { dispatch }) => {
    dispatch(_setSelectedArrangement(args.selectedArrangement));
  },
);

export const updateBoxes = createAsyncThunk(
  "item/updateBoxes",
  async (args: { boxes: Box[] }, { dispatch, getState }) => {
    const item = getState().undoable.present.item;
    let arrangements = [...item.arrangements];
    if (item.arrangements[item.selectedArrangement]?.slides?.length > 0) {
      arrangements = arrangements.map((arrangement, index) => {
        if (index !== item.selectedArrangement) return arrangement;
        return {
          ...arrangement,
          slides: [
            ...arrangement.slides.map((slide, slideIndex) => {
              if (slideIndex !== item.selectedSlide) return slide;
              return { ...slide, boxes: [...args.boxes] };
            }),
          ],
        };
      });
      dispatch(_updateArrangements(arrangements));
    }

    const slides = item.slides.map((slide, index) => {
      if (index !== item.selectedSlide) return slide;
      return { ...slide, boxes: [...args.boxes] };
    });

    dispatch(_updateSlides(slides));
  },
);

export const updateArrangements = createAsyncThunk(
  "item/updateArrangements",
  async (
    args: {
      arrangements: Arrangment[];
      selectedArrangement?: number;
    },
    { dispatch, getState },
  ) => {
    const item = getState().undoable.present.item;
    const { selectedArrangement: currentArrangement } = item;
    const { selectedArrangement, arrangements } = args;
    const newSlides =
      arrangements[selectedArrangement ?? currentArrangement]?.slides ?? [];
    const oldSlides = item.arrangements[currentArrangement]?.slides ?? [];

    dispatch(_updateArrangements(arrangements));
    if (selectedArrangement !== undefined) {
      dispatch(_setSelectedArrangement(selectedArrangement));
    }
    dispatch(
      _updateSlides(
        arrangements[selectedArrangement ?? currentArrangement].slides,
      ),
    );

    if (item.type === "song" && oldSlides.length !== newSlides.length) {
      const hint = getSelectionHint(oldSlides, item.selectedSlide);
      const maxSlideIndex = Math.max(0, newSlides.length - 2);
      const fromHint = hint ? getIndexFromSelectionHint(newSlides, hint) : null;
      const newIndex =
        fromHint !== null
          ? Math.min(fromHint, maxSlideIndex)
          : Math.min(item.selectedSlide, maxSlideIndex);
      dispatch(setSelectedSlide(newIndex));
      dispatch(setRestoreFocusToBox(item.selectedBox));
    }
  },
);

export const updateAllSlideBackgrounds = createAsyncThunk(
  "item/updateAllSlideBackgrounds",
  async (
    args: { background: string; mediaInfo?: MediaType },
    { dispatch, getState },
  ) => {
    const state = getState();
    const item = state.undoable.present.item;

    const arrangementSlides =
      item.arrangements[item.selectedArrangement]?.slides;
    const mapSlides = (slides: ItemSlideType[]) => {
      return slides.map((slide) => {
        return {
          ...slide,
          boxes: [
            ...slide.boxes.map((box, index) => {
              if (index === 0) {
                return {
                  ...box,
                  background: args.background,
                  mediaInfo: args.mediaInfo,
                };
              }
              return box;
            }),
          ],
        };
      });
    };
    let arrangements = [...item.arrangements];
    if (arrangementSlides) {
      const updatedSlides = mapSlides(arrangementSlides);
      arrangements = arrangements.map((arrangement, index) => {
        if (index !== item.selectedArrangement) return arrangement;
        return {
          ...arrangement,
          slides: [...updatedSlides],
        };
      });
    }
    const slides = mapSlides(item.slides);

    dispatch(_updateSlides(slides));
    dispatch(_updateArrangements(arrangements));
    dispatch(setBackground(args.background));

    _updateItemInLists({
      value:
        args.mediaInfo?.type === "video"
          ? args.mediaInfo?.placeholderImage
          : args.background,
      property: "background",
      state,
      dispatch,
    });
    dispatch(itemSlice.actions.clearBackgroundTargetSelection());
  },
);

export const updateSlideBackground = createAsyncThunk(
  "item/updateSlideBackground",
  async (
    args: { background: string; mediaInfo?: MediaType },
    { dispatch, getState },
  ) => {
    const state = getState();
    const item = state.undoable.present.item;

    const arrangementSlides =
      item.arrangements[item.selectedArrangement]?.slides;

    let arrangements = [...item.arrangements];

    if (arrangementSlides) {
      arrangements = arrangements.map((arrangement, index) => {
        if (index !== item.selectedArrangement) return arrangement;
        return {
          ...arrangement,
          slides: [
            ...arrangement.slides.map((slide, slideIndex) => {
              if (slideIndex !== item.selectedSlide) return slide;
              return {
                ...slide,
                boxes: slide.boxes.map((box, index) => {
                  if (index !== 0) return box;
                  return {
                    ...box,
                    background: args.background,
                    mediaInfo: args.mediaInfo,
                  };
                }),
              };
            }),
          ],
        };
      });
    }

    const slides = item.slides.map((slide, index) => {
      if (index !== item.selectedSlide) return slide;
      return {
        ...slide,
        boxes: slide.boxes.map((box, index) => {
          if (index !== 0) return box;
          return {
            ...box,
            background: args.background,
            mediaInfo: args.mediaInfo,
          };
        }),
      };
    });

    dispatch(_updateSlides(slides));
    dispatch(_updateArrangements(arrangements));

    if (item.selectedSlide === 0) {
      dispatch(setBackground(args.background));
      _updateItemInLists({
        value:
          args.mediaInfo?.type === "video"
            ? args.mediaInfo?.placeholderImage
            : args.background,
        property: "background",
        state,
        dispatch,
      });
    }
    dispatch(itemSlice.actions.clearBackgroundTargetSelection());
  },
);

export const updateSlideBackgroundsOnSubset = createAsyncThunk(
  "item/updateSlideBackgroundsOnSubset",
  async (
    args: { slideIds: string[]; background: string; mediaInfo?: MediaType },
    { dispatch, getState },
  ) => {
    const state = getState();
    const item = state.undoable.present.item;
    const idSet = new Set(args.slideIds);
    if (idSet.size === 0) {
      dispatch(itemSlice.actions.clearBackgroundTargetSelection());
      return;
    }

    const arrangementSlides =
      item.arrangements[item.selectedArrangement]?.slides;
    let arrangements = [...item.arrangements];
    const patch = { background: args.background, mediaInfo: args.mediaInfo };

    if (arrangementSlides?.length) {
      arrangements = arrangements.map((arrangement, index) => {
        if (index !== item.selectedArrangement) return arrangement;
        return {
          ...arrangement,
          slides: mapSlidesUpdateBox0ById(arrangement.slides, idSet, patch),
        };
      });
    }
    const slides = mapSlidesUpdateBox0ById(item.slides, idSet, patch);

    dispatch(_updateSlides(slides));
    dispatch(_updateArrangements(arrangements));

    const firstSlideId = item.slides[0]?.id;
    const targetsIncludeIndex0 =
      firstSlideId !== undefined && idSet.has(firstSlideId);
    if (targetsIncludeIndex0) {
      dispatch(setBackground(args.background));
      _updateItemInLists({
        value:
          args.mediaInfo?.type === "video"
            ? args.mediaInfo?.placeholderImage
            : args.background,
        property: "background",
        state,
        dispatch,
      });
    }

    dispatch(itemSlice.actions.clearBackgroundTargetSelection());
  },
);

export const clearSlideBackgroundsOnSubset = createAsyncThunk(
  "item/clearSlideBackgroundsOnSubset",
  async (args: { slideIds: string[] }, { dispatch, getState }) => {
    const state = getState();
    const item = state.undoable.present.item;
    const idSet = new Set(args.slideIds);
    if (idSet.size === 0) {
      dispatch(itemSlice.actions.clearBackgroundTargetSelection());
      return;
    }
    const patch = {
      background: "",
      mediaInfo: undefined as MediaType | undefined,
    };

    const arrangementSlides =
      item.arrangements[item.selectedArrangement]?.slides;
    let arrangements = [...item.arrangements];
    if (arrangementSlides?.length) {
      arrangements = arrangements.map((arrangement, index) => {
        if (index !== item.selectedArrangement) return arrangement;
        return {
          ...arrangement,
          slides: mapSlidesUpdateBox0ById(arrangement.slides, idSet, patch),
        };
      });
    }
    const slides = mapSlidesUpdateBox0ById(item.slides, idSet, patch);

    dispatch(_updateSlides(slides));
    dispatch(_updateArrangements(arrangements));

    const firstSlideId = item.slides[0]?.id;
    const targetsIncludeIndex0 =
      firstSlideId !== undefined && idSet.has(firstSlideId);
    if (targetsIncludeIndex0) {
      dispatch(setBackground(""));
      _updateItemInLists({
        value: "",
        property: "background",
        state,
        dispatch,
      });
    }

    dispatch(itemSlice.actions.clearBackgroundTargetSelection());
  },
);

export const addSlide = createAsyncThunk(
  "item/addSlide",
  async (args: { slide: ItemSlideType }, { dispatch, getState }) => {
    const item = getState().undoable.present.item;
    const newSlides = [...item.slides, args.slide];
    dispatch(updateSlides({ slides: newSlides }));
  },
);

export const removeSlide = createAsyncThunk(
  "item/removeSlide",
  async (args: { index: number }, { dispatch, getState }) => {
    const item = getState().undoable.present.item;
    const newSlides = item.slides.filter((_, index) => index !== args.index);
    dispatch(updateSlides({ slides: newSlides }));
  },
);

/** Removes all slides whose ids are in `slideIds` (free-form multi-delete). Keeps at least one slide. */
export const removeSlidesByIds = createAsyncThunk(
  "item/removeSlidesByIds",
  async (args: { slideIds: string[] }, { dispatch, getState }) => {
    const item = getState().undoable.present.item;
    const idSet = new Set(args.slideIds);
    if (idSet.size === 0) return;
    const newSlides = item.slides.filter((s) => !idSet.has(s.id));
    if (newSlides.length === item.slides.length) return;
    if (newSlides.length === 0) return;
    await dispatch(updateSlides({ slides: newSlides })).unwrap();
    dispatch(itemSlice.actions.clearBackgroundTargetSelection());
  },
);

export const updateSlides = createAsyncThunk(
  "item/updateSlides",
  async (
    args: { slides: ItemSlideType[]; formattedSections?: FormattedSection[] },
    { dispatch, getState },
  ) => {
    const item = getState().undoable.present.item;
    const oldSlides = item.slides;
    const newSlides = args.slides;

    dispatch(_updateSlides(args.slides));
    if (args.formattedSections) {
      dispatch(_updateFormattedSections(args.formattedSections));
    }

    if (item.type !== "song" && oldSlides.length !== newSlides.length) {
      const hint = getSelectionHint(oldSlides, item.selectedSlide);
      const maxSlideIndex = Math.max(0, newSlides.length - 1);
      const fromHint = hint ? getIndexFromSelectionHint(newSlides, hint) : null;
      const newIndex =
        fromHint !== null
          ? Math.min(fromHint, maxSlideIndex)
          : Math.min(item.selectedSlide, maxSlideIndex);
      dispatch(setSelectedSlide(newIndex));
      dispatch(setRestoreFocusToBox(item.selectedBox));
    }
  },
);

export const updateBibleInfo = createAsyncThunk(
  "item/updateBibleInfo",
  async (args: { bibleInfo: BibleInfo }, { dispatch }) => {
    dispatch(_updateBibleInfo(args.bibleInfo));
  },
);

export const {
  setSelectedSlide,
  setRestoreFocusToBox,
  _setSelectedArrangement,
  setIsEditMode,
  _setName,
  _updateArrangements,
  clearTransientState,
  setActiveItem,
  setItemIsLoading,
  setSectionLoading,
  setItemFormatting,
  _updateSlides,
  _updateBibleInfo,
  _updateTimerInfo,
  syncLiveTimerInfo,
  _updateFormattedSections,
  setBackground,
  setHasPendingUpdate,
  setSelectedBox,
  setSongMetadata,
  setShouldSendTo,
  forceUpdate,
  bufferRemoteItemUpdate,
  discardPendingRemoteItem,
  applyPendingRemoteItem,
  markItemPersisted,
  toggleBackgroundTargetSlideId,
  setBackgroundTargetSlideIds,
  setBackgroundTargetRangeAnchorId,
  setMobileBackgroundTargetSelectMode,
  clearBackgroundTargetSelection,
  clearBackgroundTargetSlideIdsOnly,
} = itemSlice.actions;

export default itemSlice.reducer;
