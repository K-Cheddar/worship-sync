import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { DBServices, ServiceTime } from "../types";

type ServiceTimesState = {
  list: ServiceTime[];
  isInitialized: boolean;
};

const initialState: ServiceTimesState = {
  list: [],
  isInitialized: false,
};

export const serviceTimesSlice = createSlice({
  name: "serviceTimes",
  initialState,
  reducers: {
    addService: (state, action: PayloadAction<ServiceTime>) => {
      state.list.push(action.payload);
    },
    updateService: (
      state,
      action: PayloadAction<{ id: string; changes: Partial<ServiceTime> }>,
    ) => {
      state.list = state.list.map((s) =>
        s.id === action.payload.id ? { ...s, ...action.payload.changes } : s,
      );
    },
    removeService: (state, action: PayloadAction<string>) => {
      state.list = state.list.filter((s) => s.id !== action.payload);
    },
    setIsInitialized: (state, action: PayloadAction<boolean>) => {
      state.isInitialized = action.payload;
    },
    initiateServices: (state, action: PayloadAction<ServiceTime[]>) => {
      state.list = action.payload;
      state.isInitialized = true;
    },
    updateServicesFromRemote: (state, action: PayloadAction<DBServices>) => {
      // Prevent overwriting with empty array if we already have services
      // Only update if the incoming list has services, or if our current list is empty
      if (
        action.payload.list &&
        (action.payload.list.length > 0 || state.list.length === 0)
      ) {
        state.list = action.payload.list;
      }
    },
  },
});

export const {
  addService,
  updateService,
  removeService,
  initiateServices,
  setIsInitialized,
  updateServicesFromRemote,
} = serviceTimesSlice.actions;

export default serviceTimesSlice.reducer;
