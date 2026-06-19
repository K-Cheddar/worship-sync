import { configureStore } from "@reduxjs/toolkit";
import serviceTimesReducer, {
  addService,
  updateService,
  removeService,
  initiateServices,
  syncServicesFromRemote,
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
    it("addService inserts services in schedule order", () => {
      const store = createStore({
        serviceTimes: {
          list: [
            createServiceTime({
              id: "sunday",
              name: "Sunday",
              reccurence: "weekly",
              dayOfWeek: 0,
              time: "11:00",
            }),
          ],
          isInitialized: true,
        },
      });
      store.dispatch(
        addService(
          createServiceTime({
            id: "wednesday",
            name: "Wednesday",
            reccurence: "weekly",
            dayOfWeek: 3,
            time: "19:00",
          }),
        ),
      );
      expect(store.getState().serviceTimes.list.map((service) => service.id)).toEqual([
        "sunday",
        "wednesday",
      ]);
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
      expect(list.find((service) => service.id === "s1")?.name).toBe("Updated");
      expect(list.find((service) => service.id === "s2")?.name).toBe("Other");
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

    it("syncServicesFromRemote replaces list and marks initialized", () => {
      const store = createStore();
      const list = [createServiceTime({ id: "remote", name: "Remote Service" })];
      store.dispatch(syncServicesFromRemote(list));
      expect(store.getState().serviceTimes.list).toEqual(list);
      expect(store.getState().serviceTimes.isInitialized).toBe(true);
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
