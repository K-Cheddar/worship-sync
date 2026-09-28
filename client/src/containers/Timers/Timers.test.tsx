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

jest.mock("../../components/FilteredItems/FilteredItems", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return function FilteredItems({ list, type }: { list: any[]; type: string }) {
    return React.createElement(
      "ul",
      { role: "list" },
      list
        .filter((item) => item.type === type)
        .map((item) =>
          React.createElement("li", { key: item._id, role: "listitem" }, item.name),
        ),
    );
  };
});

describe("Timers library recovery integration", () => {
  let getBoundingClientRectSpy: jest.SpyInstance;

  beforeEach(() => {
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
  });
});
