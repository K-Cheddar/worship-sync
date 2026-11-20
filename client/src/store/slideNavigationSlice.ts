import { createSlice } from "@reduxjs/toolkit";

/** Runtime-only intent signal kept outside undoable item content. */
export const slideNavigationSlice = createSlice({
  name: "slideNavigation",
  initialState: { selectedSlideScrollRequest: 0 },
  reducers: {
    requestSelectedSlideNavigation: (state) => {
      state.selectedSlideScrollRequest += 1;
    },
  },
});

export const { requestSelectedSlideNavigation } = slideNavigationSlice.actions;
