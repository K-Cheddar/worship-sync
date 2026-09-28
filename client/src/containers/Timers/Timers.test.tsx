import React from "react";
import { configureStore } from "@reduxjs/toolkit";
import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import Timers from "./Timers";
import { allDocsSlice } from "../../store/allDocsSlice";
import { allItemsSlice } from "../../store/allItemsSlice";
import { createSongLibraryIndexRepairMiddleware } from "../../store/songLibraryIndexRepair";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import { PresentationControllerModeProvider } from "../../context/presentationControllerMode";
import { createMockControllerContext, createMockGlobalContext } from "../../test/mocks";
import type { DBItem } from "../../types";
import useDisplayedUpcomingService from "../../hooks/useDisplayedUpcomingService";

jest.mock("../../components/FilteredItems/FilteredItems", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return function FilteredItems({
    list,
    type,
    libraryFilter,
    pinnedTopContent,
  }: {
    list: any[];
    type: string;
    libraryFilter?: string;
    pinnedTopContent?: React.ReactNode;
  }) {
    return React.createElement(
      "ul",
      { role: "list" },
      React.createElement("div", { "data-testid": "library-filter" }, libraryFilter),
      pinnedTopContent,
      ...list
        .filter((item) => type === "all" || item.type === type)
        .map((item) =>
          React.createElement("li", { key: item._id, role: "listitem" }, item.name),
        ),
    );
  };
});

jest.mock("../../hooks/useDisplayedUpcomingService", () => ({
  __esModule: true,
  default: jest.fn(),
}));

describe("Timers library recovery integration", () => {
  let getBoundingClientRectSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.mocked(useDisplayedUpcomingService).mockReturnValue(null);
    getBoundingClientRectSpy = jest
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation(() =>
        ({
          width: 800,
          height: 600,
          top: 0,
          left: 0,
          bottom: 600,
          right: 800,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect,
      );
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      value: 600,
    });
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      value: 600,
    });
  });

  afterEach(() => {
    getBoundingClientRectSpy.mockRestore();
    window.localStorage.removeItem("worshipsync_presentation_controller_mode");
  });

  it("shows a valid durable timer document missing from allItems", async () => {
    const repairMiddleware = createSongLibraryIndexRepairMiddleware();
    const store = configureStore({
      reducer: {
        allItems: allItemsSlice.reducer,
        allDocs: allDocsSlice.reducer,
        undoable: (state = { present: { serviceTimes: { list: [] } } }) => state,
      },
      middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware().prepend(repairMiddleware.middleware),
    });
    const timerDoc = {
      _id: "11 AM Countdown",
      name: "11 AM Countdown",
      type: "timer",
      background: "navy",
      timerInfo: { id: "11 AM Countdown", name: "11 AM Countdown" },
    } as DBItem;
    store.dispatch(allItemsSlice.actions.initiateAllItemsList([]));
    store.dispatch(allDocsSlice.actions.updateAllTimerDocs([timerDoc]));
    expect(store.getState().allItems.list).toEqual([
      expect.objectContaining({ _id: "11 AM Countdown", type: "timer" }),
    ]);

    render(
      <Provider store={store}>
        <ControllerInfoContext.Provider
          value={createMockControllerContext() as any}
        >
          <GlobalInfoContext.Provider value={createMockGlobalContext() as any}>
            <PresentationControllerModeProvider>
              <MemoryRouter>
                <Timers />
              </MemoryRouter>
            </PresentationControllerModeProvider>
          </GlobalInfoContext.Provider>
        </ControllerInfoContext.Provider>
      </Provider>,
    );

    expect(screen.getByRole("listitem")).toHaveTextContent("11 AM Countdown");
    expect(screen.getByTestId("library-filter")).toHaveTextContent("timer");
  });

  it("keeps the upcoming service countdown separate from saved timers", async () => {
    jest.mocked(useDisplayedUpcomingService).mockReturnValue({
      service: { id: "service-1", name: "Sunday Service" },
      nextAt: new Date("2030-01-01T12:00:00.000Z"),
    } as any);
    const store = configureStore({
      reducer: {
        allItems: allItemsSlice.reducer,
        allDocs: allDocsSlice.reducer,
        undoable: (state = { present: { serviceTimes: { list: [] } } }) => state,
      },
    });
    const timer = {
      _id: "saved-timer",
      name: "Saved Timer",
      type: "timer",
      timerInfo: { id: "saved-timer", name: "Saved Timer" },
    } as DBItem;
    store.dispatch(allItemsSlice.actions.initiateAllItemsList([timer as any]));

    render(
      <Provider store={store}>
        <ControllerInfoContext.Provider
          value={createMockControllerContext() as any}
        >
          <GlobalInfoContext.Provider value={createMockGlobalContext() as any}>
            <PresentationControllerModeProvider>
              <MemoryRouter initialEntries={["/controller/timers"]}>
                <Timers />
              </MemoryRouter>
            </PresentationControllerModeProvider>
          </GlobalInfoContext.Provider>
        </ControllerInfoContext.Provider>
      </Provider>,
    );

    expect(screen.getByText("Sunday Service")).toBeInTheDocument();
    expect(screen.getByText("Upcoming")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")[1]).toHaveTextContent("Saved Timer");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});
