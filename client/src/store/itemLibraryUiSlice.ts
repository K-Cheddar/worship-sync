import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export type LibraryFilter = "all" | "song" | "free" | "timer";

// Search/filter controls only: no item data and no persistence listener.
export const itemLibraryUiSlice = createSlice({
  name: "itemLibraryUi",
  initialState: {
    libraryFilter: "all" as LibraryFilter,
    librarySearchValue: "",
  },
  reducers: {
    setLibraryFilter: (state, action: PayloadAction<LibraryFilter>) => { state.libraryFilter = action.payload; },
    setLibrarySearchValue: (state, action: PayloadAction<string>) => { state.librarySearchValue = action.payload; },
  },
});
export const { setLibraryFilter, setLibrarySearchValue } = itemLibraryUiSlice.actions;
export default itemLibraryUiSlice.reducer;
