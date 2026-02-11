import { configureStore } from "@reduxjs/toolkit";
import serviceTimesReducer, {
  addService,
  updateService,
  removeService,
  initiateServices,
  updateServicesFromRemote,
} from "./serviceTimesSlice";
import { createServiceTime } from "../test/fixtures";

type ServiceTimesState = ReturnType<typeof serviceTimesReducer>;
type ServiceTimesSliceState = { serviceTimes: ServiceTimesState };

const createStore = (preloadedState?: Partial<ServiceTimesSliceState>) =>
  configureStore({
    reducer: { serviceTimes: serviceTimesReducer },
    ...(preloadedState != null &&
      Object.keys(preloadedState).length > 0 && {
        preloadedState: preloadedState as ServiceTimesSliceState,
      }),
  });

describe("serviceTimesSlice", () => {
  describe("reducer only", () => {
    it("addService appends to list", () => {
      const store = createStore();
      const service = createServiceTime({ id: "s1", name: "Service 1" });
      store.dispatch(addService(service));
      expect(store.getState().serviceTimes.list).toHaveLength(1);
      expect(store.getState().serviceTimes.list[0].name).toBe("Service 1");
    });

    it("updateService updates existing service by id", () => {
      const store = createStore({
        serviceTimes: {
          list: [
            createServiceTime({ id: "s1", name: "Old" }),
            createServiceTime({ id: "s2", name: "Other" }),
          ],
          isInitialized: true,
        },
      });
      store.dispatch(updateService({ id: "s1", changes: { name: "Updated" } }));
      const list = store.getState().serviceTimes.list;
      expect(list[0].name).toBe("Updated");
      expect(list[1].name).toBe("Other");
    });

    it("removeService removes by id", () => {
      const store = createStore({
        serviceTimes: {
          list: [
            createServiceTime({ id: "s1", name: "A" }),
            createServiceTime({ id: "s2", name: "B" }),
          ],
          isInitialized: true,
        },
      });
      store.dispatch(removeService("s1"));
      expect(store.getState().serviceTimes.list).toHaveLength(1);
      expect(store.getState().serviceTimes.list[0].id).toBe("s2");
    });

    it("initiateServices replaces list", () => {
      const store = createStore();
      const list = [
        createServiceTime({ id: "a", name: "A" }),
        createServiceTime({ id: "b", name: "B" }),
      ];
      store.dispatch(initiateServices(list));
      expect(store.getState().serviceTimes.list).toHaveLength(2);
    });

    it("updateServicesFromRemote updates when payload has list", () => {
      const store = createStore();
      store.dispatch(
        updateServicesFromRemote({
          _id: "services",
          _rev: "1",
          list: [createServiceTime({ id: "r1", name: "Remote 1" })],
        }),
      );
      expect(store.getState().serviceTimes.list).toHaveLength(1);
      expect(store.getState().serviceTimes.list[0].name).toBe("Remote 1");
    });

    it("updateServicesFromRemote does not overwrite with empty when list already has items", () => {
      const store = createStore({
        serviceTimes: {
          list: [createServiceTime({ id: "existing", name: "Existing" })],
          isInitialized: true,
        },
      });
      store.dispatch(
        updateServicesFromRemote({ _id: "services", _rev: "1", list: [] }),
      );
      expect(store.getState().serviceTimes.list).toHaveLength(1);
      expect(store.getState().serviceTimes.list[0].name).toBe("Existing");
    });

    it("updateServicesFromRemote accepts empty list when current list is empty", () => {
      const store = createStore();
      expect(store.getState().serviceTimes.list).toHaveLength(0);
      store.dispatch(
        updateServicesFromRemote({ _id: "services", _rev: "1", list: [] }),
      );
      expect(store.getState().serviceTimes.list).toHaveLength(0);
    });
  });
});
