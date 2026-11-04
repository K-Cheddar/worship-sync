import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { DBServices, ServiceTime } from "../types";
import { sortServicesByScheduleOrder } from "../utils/serviceTimes";

const sortServiceList = (list: ServiceTime[]) => sortServicesByScheduleOrder(list);

type ServiceTimesState = {
  list: ServiceTime[];
  isInitialized: boolean;
};

export type ServiceGroupMutation = {
  primary:
    | { mode: "add" | "update"; service: ServiceTime }
    | { mode: "delete"; id: string };
  partnerUpdates: Array<{ id: string; serviceGroupId?: string }>;
  /** Every selected partner needed to keep the primary's requested group valid. */
  requiredPartnerIds?: string[];
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
      state.list = sortServiceList([...state.list, action.payload]);
    },
    updateService: (
      state,
      action: PayloadAction<{ id: string; changes: Partial<ServiceTime> }>,
    ) => {
      state.list = sortServiceList(
        state.list.map((s) =>
          s.id === action.payload.id ? { ...s, ...action.payload.changes } : s,
        ),
      );
    },
    applyServiceGroupMutation: (state, action: PayloadAction<ServiceGroupMutation>) => {
      const { primary, partnerUpdates } = action.payload;
      if (primary.mode === "delete") {
        const deleted = state.list.find((service) => service.id === primary.id);
        if (!deleted) return;
        state.list = state.list.filter((service) => service.id !== primary.id);
        const remainingGroupMembers = deleted.serviceGroupId
          ? state.list.filter((service) => service.serviceGroupId === deleted.serviceGroupId)
          : [];
        const cleanupIds = remainingGroupMembers.length < 2
          ? new Set(remainingGroupMembers.map((service) => service.id))
          : new Set<string>();
        const groupById = new Map(partnerUpdates.map(({ id, serviceGroupId }) => [id, serviceGroupId]));
        state.list = sortServiceList(state.list.map((service) => cleanupIds.has(service.id)
          ? { ...service, serviceGroupId: undefined }
          : groupById.has(service.id)
            ? { ...service, serviceGroupId: groupById.get(service.id) }
            : service,
        ));
        return;
      }
      if (primary.mode === "add") {
        if (state.list.some((service) => service.id === primary.service.id)) return;
        state.list.push(primary.service);
      } else {
        if (!state.list.some((service) => service.id === primary.service.id)) return;
        state.list = state.list.map((service) => service.id === primary.service.id
          ? { ...service, ...primary.service }
          : service,
        );
      }
      const groupById = new Map(partnerUpdates.map(({ id, serviceGroupId }) => [id, serviceGroupId]));
      state.list = sortServiceList(state.list.map((service) => groupById.has(service.id)
        ? { ...service, serviceGroupId: groupById.get(service.id) }
        : service,
      ));
    },
    removeService: (state, action: PayloadAction<string>) => {
      state.list = state.list.filter((s) => s.id !== action.payload);
    },
    setIsInitialized: (state, action: PayloadAction<boolean>) => {
      state.isInitialized = action.payload;
    },
    initiateServices: (state, action: PayloadAction<ServiceTime[]>) => {
      state.list = sortServiceList(action.payload);
      state.isInitialized = true;
    },
    syncServicesFromRemote: (state, action: PayloadAction<ServiceTime[]>) => {
      state.list = sortServiceList(action.payload);
      state.isInitialized = true;
    },
    updateServicesFromRemote: (state, action: PayloadAction<DBServices>) => {
      // Prevent overwriting with empty array if we already have services
      // Only update if the incoming list has services, or if our current list is empty
      if (
        action.payload.list &&
        (action.payload.list.length > 0 || state.list.length === 0)
      ) {
        state.list = sortServiceList(action.payload.list);
      }
    },
  },
});

export const {
  addService,
  updateService,
  applyServiceGroupMutation,
  removeService,
  initiateServices,
  syncServicesFromRemote,
  setIsInitialized,
  updateServicesFromRemote,
} = serviceTimesSlice.actions;

export default serviceTimesSlice.reducer;
