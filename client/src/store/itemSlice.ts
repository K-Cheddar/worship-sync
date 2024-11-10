import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { Arrangment, Box, ItemSlide, ItemState } from "../types";

const initialState: ItemState = {
  isEditMode: false,
  name: "",
  type: "",
  id: "1",
  listId: "",
  selectedArrangement: 0,
  shouldSkipTitle: false,
  arrangements: [],
  selectedSlide: 0,
  slides: [],
  selectedBox: 1,
  bibleInfo: { book: "", chapter: "", version: "", verses: [] },
};

export const itemSlice = createSlice({
  name: "item",
  initialState,
  reducers: {
    setActiveItem: (state, action: PayloadAction<ItemState>) => {
      state.name = action.payload.name;
      state.type = action.payload.type;
      state.id = action.payload.id;
      state.listId = action.payload.listId;
      state.selectedArrangement = action.payload.selectedArrangement || 0;
      state.shouldSkipTitle = action.payload.shouldSkipTitle || false;
      state.arrangements = action.payload.arrangements || [];
      state.slides = action.payload.slides || [];
      state.bibleInfo = action.payload.bibleInfo || {
        book: "",
        chapter: "",
        version: "",
        verses: [],
      };
    },
    toggleEditMode: (state) => {
      state.isEditMode = !state.isEditMode;
    },
    setName: (state, action: PayloadAction<string>) => {
      state.name = action.payload;
    },
    setSelectedSlide: (state, action: PayloadAction<number>) => {
      state.selectedSlide = action.payload;
    },
    setSelectedArrangement: (state, action: PayloadAction<number>) => {
      state.selectedArrangement = action.payload;
    },
    updateBoxes: (state, action: PayloadAction<Box[]>) => {
      if (state.arrangements[state.selectedArrangement]?.slides?.length > 0) {
        state.arrangements[state.selectedArrangement].slides[
          state.selectedSlide
        ].boxes = [...action.payload];
      }

      state.slides[state.selectedSlide].boxes = [...action.payload];
    },
    updateArrangements: (state, action: PayloadAction<Arrangment[]>) => {
      state.arrangements = [...action.payload];
      state.slides = [...action.payload[state.selectedArrangement].slides];
    },
    updateAllSlideBackgrounds: (state, action: PayloadAction<string>) => {
      const arrangementSlides =
        state.arrangements[state.selectedArrangement]?.slides;
      const mapSlides = (slides: ItemSlide[]) => {
        return slides.map((slide) => {
          return {
            ...slide,
            boxes: [
              ...slide.boxes.map((box, index) => {
                if (index === 0) {
                  return { ...box, background: action.payload };
                }
                return box;
              }),
            ],
          };
        });
      };
      if (arrangementSlides) {
        const updatedSlides = mapSlides(arrangementSlides);
        state.arrangements[state.selectedArrangement].slides = [
          ...updatedSlides,
        ];
      }
      state.slides = mapSlides(state.slides);
    },
    updateSlideBackground: (state, action: PayloadAction<string>) => {
      const arrangementSlides =
        state.arrangements[state.selectedArrangement]?.slides;

      if (arrangementSlides) {
        state.arrangements[state.selectedArrangement].slides[
          state.selectedSlide
        ].boxes[0].background = action.payload;
      }

      state.slides[state.selectedSlide].boxes[0].background = action.payload;
    },
    addSlide: (state, action: PayloadAction<ItemSlide>) => {
      state.slides = [...state.slides, action.payload];
    },
    removeSlide: (state, action: PayloadAction<number>) => {
      state.slides = state.slides.filter(
        (_, index) => index !== action.payload
      );
    },
    updateSlides: (state, action: PayloadAction<ItemSlide[]>) => {
      state.slides = [...action.payload];
    },
  },
});

export const {
  setSelectedSlide,
  setSelectedArrangement,
  toggleEditMode,
  setName,
  updateBoxes,
  updateArrangements,
  setActiveItem,
  updateAllSlideBackgrounds,
  updateSlideBackground,
  addSlide,
  removeSlide,
  updateSlides,
} = itemSlice.actions;

export default itemSlice.reducer;
