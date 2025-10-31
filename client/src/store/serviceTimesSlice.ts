import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { DBServices, ServiceTime } from "../types";

type ServiceTimesState = {
  list: ServiceTime[];
};

const initialState: ServiceTimesState = {
  list: [],
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
      action: PayloadAction<{ id: string; changes: Partial<ServiceTime> }>
    ) => {
      state.list = state.list.map((s) =>
        s.id === action.payload.id ? { ...s, ...action.payload.changes } : s
      );
    },
    removeService: (state, action: PayloadAction<string>) => {
      state.list = state.list.filter((s) => s.id !== action.payload);
    },
    initiateServices: (state, action: PayloadAction<ServiceTime[]>) => {
      state.list = action.payload;
    },
    updateServicesFromRemote: (state, action: PayloadAction<DBServices>) => {
      state.list = action.payload.list;
    },
  },
});

export const {
  addService,
  updateService,
  removeService,
  initiateServices,
  updateServicesFromRemote,
} = serviceTimesSlice.actions;

export default serviceTimesSlice.reducer;
