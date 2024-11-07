import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { Arrangment, Box, ItemSlide, UpdateItemState } from "../types";
import { formatSong } from "../utils/overflow";

type ItemState = {
  slidesPerRow: number;
  formattedLyricsPerRow: number;
  isEditMode: boolean;
  name: string;
  type: string;
  id: string;
  listId?: string;
  selectedArrangement: number;
  shouldSkipTitle: boolean;
  arrangements: Arrangment[];
  selectedSlide: number;
  slides: ItemSlide[];
};

const initialState: ItemState = {
  slidesPerRow: 4,
  formattedLyricsPerRow: 4,
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
};

export const itemSlice = createSlice({
  name: "item",
  initialState,
  reducers: {
    setActiveItem: (state, action: PayloadAction<UpdateItemState>) => {
      state.name = action.payload.name;
      state.type = action.payload.type;
      state.id = action.payload.id;
      state.listId = action.payload.listId;
      state.selectedArrangement = action.payload.selectedArrangement || 0;
      state.shouldSkipTitle = action.payload.shouldSkipTitle || false;
      state.arrangements = action.payload.arrangements || [];
      state.slides = action.payload.slides || [];
    },
    increaseSlides: (state) => {
      state.slidesPerRow = Math.min(state.slidesPerRow + 1, 5);
    },
    decreaseSlides: (state) => {
      state.slidesPerRow = Math.max(state.slidesPerRow - 1, 3);
    },
    increaseFormattedLyrics: (state) => {
      state.formattedLyricsPerRow = Math.min(
        state.formattedLyricsPerRow + 1,
        5
      );
    },
    decreaseFormattedLyrics: (state) => {
      state.formattedLyricsPerRow = Math.max(
        state.formattedLyricsPerRow - 1,
        3
      );
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
      if (state.arrangements[state.selectedArrangement].slides.length > 0) {
        state.arrangements[state.selectedArrangement].slides[
          state.selectedSlide
        ].boxes = [...action.payload];
      }

      state.slides[state.selectedSlide].boxes = [...action.payload];
    },
    updateArrangements: (state, action: PayloadAction<Arrangment[]>) => {
      state.arrangements = [...action.payload];
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
  },
});

export const {
  setSelectedSlide,
  setSelectedArrangement,
  increaseSlides,
  decreaseSlides,
  toggleEditMode,
  setName,
  updateBoxes,
  increaseFormattedLyrics,
  decreaseFormattedLyrics,
  updateArrangements,
  setActiveItem,
  updateAllSlideBackgrounds,
  updateSlideBackground,
} = itemSlice.actions;

export default itemSlice.reducer;
