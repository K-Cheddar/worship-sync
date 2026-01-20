import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import {
  Arrangment,
  BibleInfo,
  Box,
  FormattedSection,
  ItemSlideType,
  ItemState,
  MediaType,
  ShouldSendTo,
} from "../types";
import { createAsyncThunk } from "../hooks/reduxHooks";
import { updateAllItemsList } from "./allItemsSlice";
import { updateItemList } from "./itemListSlice";
import { updateItemInList } from "../utils/itemUtil";
import { AppDispatch, RootState } from "./store";

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
  hasPendingUpdate: false,
  shouldSendTo: {
    projector: true,
    monitor: true,
    stream: true,
  },
};

export const itemSlice = createSlice({
  name: "item",
  initialState,
  reducers: {
    setActiveItem: (state, action: PayloadAction<Partial<ItemState>>) => {
      state.name = action.payload.name || state.name;
      state.type = action.payload.type || state.type;
      state._id = action.payload._id || state._id;
      state.listId = action.payload.listId || state.listId;
      state.selectedArrangement = action.payload.selectedArrangement || 0;
      state.selectedSlide = action.payload.selectedSlide || 0;
      state.selectedBox = action.payload.selectedBox || 1;
      state.shouldSkipTitle = action.payload.shouldSkipTitle || false;
      state.arrangements = action.payload.arrangements || [];
      state.slides = action.payload.slides || [];
      state.formattedSections = action.payload.formattedSections || state.formattedSections;
      state.bibleInfo = action.payload.bibleInfo || {
        book: "",
        chapter: "",
        version: "",
        verses: [],
        fontMode: "separate",
      };
      state.timerInfo = action.payload.timerInfo;
      state.shouldSendTo = action.payload.shouldSendTo || {
        projector: true,
        monitor: true,
        stream: true,
      };
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
      state.selectedArrangement = action.payload;
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
    _updateFormattedSections: (state, action: PayloadAction<FormattedSection[]>) => {
      state.formattedSections = [...action.payload];
      state.hasPendingUpdate = true;
    },
    setItemIsLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
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
    setShouldSendTo: (state, action: PayloadAction<Partial<ShouldSendTo>>) => {
      state.shouldSendTo = {
        ...state.shouldSendTo,
        ...action.payload,
      };
      state.hasPendingUpdate = true;
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
  }
);

export const setSelectedArrangement = createAsyncThunk(
  "item/setSelectedArrangement",
  async (args: { selectedArrangement: number }, { dispatch }) => {
    dispatch(_setSelectedArrangement(args.selectedArrangement));
  }
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
  }
);

export const updateArrangements = createAsyncThunk(
  "item/updateArrangements",
  async (
    args: {
      arrangements: Arrangment[];
      selectedArrangement?: number;
    },
    { dispatch, getState }
  ) => {
    const { selectedArrangement: currentArrangement } =
      getState().undoable.present.item;
    const { selectedArrangement, arrangements } = args;
    dispatch(_updateArrangements(arrangements));
    if (selectedArrangement !== undefined) {
      dispatch(_setSelectedArrangement(selectedArrangement));
    }
    dispatch(
      _updateSlides(
        arrangements[selectedArrangement ?? currentArrangement].slides
      )
    );
  }
);

export const updateAllSlideBackgrounds = createAsyncThunk(
  "item/updateAllSlideBackgrounds",
  async (
    args: { background: string; mediaInfo?: MediaType },
    { dispatch, getState }
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
  }
);

export const updateSlideBackground = createAsyncThunk(
  "item/updateSlideBackground",
  async (
    args: { background: string; mediaInfo?: MediaType },
    { dispatch, getState }
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
  }
);

export const addSlide = createAsyncThunk(
  "item/addSlide",
  async (args: { slide: ItemSlideType }, { dispatch, getState }) => {
    const item = getState().undoable.present.item;
    const newSlides = [...item.slides, args.slide];
    dispatch(updateSlides({ slides: newSlides }));
  }
);

export const removeSlide = createAsyncThunk(
  "item/removeSlide",
  async (args: { index: number }, { dispatch, getState }) => {
    const item = getState().undoable.present.item;
    const newSlides = item.slides.filter((_, index) => index !== args.index);
    dispatch(updateSlides({ slides: newSlides }));
  }
);

export const updateSlides = createAsyncThunk(
  "item/updateSlides",
  async (
    args: { slides: ItemSlideType[]; formattedSections?: FormattedSection[] },
    { dispatch }
  ) => {
    dispatch(_updateSlides(args.slides));
    if (args.formattedSections) {
      dispatch(_updateFormattedSections(args.formattedSections));
    }
  }
);

export const updateBibleInfo = createAsyncThunk(
  "item/updateBibleInfo",
  async (args: { bibleInfo: BibleInfo }, { dispatch }) => {
    dispatch(_updateBibleInfo(args.bibleInfo));
  }
);

export const {
  setSelectedSlide,
  _setSelectedArrangement,
  setIsEditMode,
  _setName,
  _updateArrangements,
  setActiveItem,
  setItemIsLoading,
  _updateSlides,
  _updateBibleInfo,
  _updateFormattedSections,
  setBackground,
  setHasPendingUpdate,
  setSelectedBox,
  setShouldSendTo,
  forceUpdate,
} = itemSlice.actions;

export default itemSlice.reducer;
