import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { Arrangment, Box, FormattedLyrics, SongOrder, UpdateItemState } from '../types';

type ItemState = {
  slidesPerRow: number,
  formattedLyricsPerRow: number,
  isEditMode: boolean,
  name: string,
  type: string,
  id: string,
  selectedArrangement: number,
  shouldSkipTitle: boolean,
  arrangements: Arrangment[],
  selectedSlide: number
}

const initialState: ItemState = {
  slidesPerRow: 4,
  formattedLyricsPerRow: 4,
  isEditMode: false,
  name: '',
  type: '',
  id: '1',
  selectedArrangement: 0,
  shouldSkipTitle: false,
  arrangements: [],
  selectedSlide: 0
}

export const itemSlice = createSlice({
  name: 'item',
  initialState,
  reducers: {
    setActiveItem: (state, action : PayloadAction<UpdateItemState>) => {
      state.name = action.payload.name;
      state.type = action.payload.type;
      state.id = action.payload.id;
      state.selectedArrangement = action.payload.selectedArrangement;
      state.shouldSkipTitle = action.payload.shouldSkipTitle;
      state.arrangements = action.payload.arrangements;
    },
    increaseSlides: (state) => {
      state.slidesPerRow =  Math.min(state.slidesPerRow + 1, 5)
    },
    decreaseSlides: (state) => {
      state.slidesPerRow =  Math.max(state.slidesPerRow - 1, 3)
    },
    increaseFormattedLyrics: (state) => {
      state.formattedLyricsPerRow =  Math.min(state.formattedLyricsPerRow + 1, 5)
    },
    decreaseFormattedLyrics: (state) => {
      state.formattedLyricsPerRow =  Math.max(state.formattedLyricsPerRow - 1, 3)
    },
    toggleEditMode: (state) => {
      state.isEditMode = !state.isEditMode
    },
    setName: (state, action : PayloadAction<string>) => {
      state.name = action.payload
    },
    setSelectedSlide: (state, action : PayloadAction<number>) => {
      state.selectedSlide = action.payload
    },
    setSelectedArrangement: (state, action : PayloadAction<number>) => {
      state.selectedArrangement = action.payload
    },
    updateBoxes: (state, action : PayloadAction<Box[]>) => {
      state.arrangements[state.selectedArrangement].slides[state.selectedSlide].boxes = [...action.payload];
    },
    updateSongOrder: (state, action : PayloadAction<SongOrder[]>) => {
      state.arrangements[state.selectedArrangement].songOrder = [...action.payload];
    },
    updateFormattedLyrics: (state, action : PayloadAction<FormattedLyrics[]>) => {
      state.arrangements[state.selectedArrangement].formattedLyrics = [...action.payload];
    },
    updateAllSlideBackgrounds: (state, action : PayloadAction<string>) => {
      const allSlides = state.arrangements[state.selectedArrangement].slides;
      const updatedSlides = allSlides.map((slide) => {
        return {...slide, 
          boxes: [...slide.boxes.map((box, index) => {
            if (index === 0) {
              return {...box, background: action.payload}
            }
            return box;
        }
        )]
        }
      });
      state.arrangements[state.selectedArrangement].slides = [...updatedSlides];
    },
    updateSlideBackground: (state, action : PayloadAction<string>) => {
      state.arrangements[state.selectedArrangement].slides[state.selectedSlide].boxes[0].background = action.payload;
    }
  }
});

export const { 
  setSelectedSlide, 
  setSelectedArrangement, 
  increaseSlides, 
  decreaseSlides, 
  toggleEditMode, 
  setName,
  updateBoxes,
  updateSongOrder,
  increaseFormattedLyrics,
  decreaseFormattedLyrics,
  updateFormattedLyrics,
  setActiveItem,
  updateAllSlideBackgrounds,
  updateSlideBackground
} = itemSlice.actions;

export default itemSlice.reducer;