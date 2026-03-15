import { createSlice, PayloadAction } from "@reduxjs/toolkit";

type MediaCacheMapState = {
  map: Record<string, string>;
};

const initialState: MediaCacheMapState = {
  map: {},
};

export const mediaCacheMapSlice = createSlice({
  name: "mediaCacheMap",
  initialState,
  reducers: {
    setMediaCacheMap: (state, action: PayloadAction<Record<string, string>>) => {
      state.map = action.payload;
    },
  },
});

export const { setMediaCacheMap } = mediaCacheMapSlice.actions;
export default mediaCacheMapSlice.reducer;
