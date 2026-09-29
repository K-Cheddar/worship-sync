import { configureStore } from "@reduxjs/toolkit";
import { render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import ItemLibrary from "./ItemLibrary";
import allItemsReducer, { initiateAllItemsList } from "../../store/allItemsSlice";
import allDocsReducer from "../../store/allDocsSlice";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import { PresentationControllerModeProvider } from "../../context/presentationControllerMode";
import {
  createMockControllerContext,
  createMockGlobalContext,
} from "../../test/mocks";
import type { ServiceItem } from "../../types";

const items: ServiceItem[] = [
  { _id: "song-1", name: "Library Song", type: "song", listId: "song-1" },
  { _id: "custom-1", name: "Library Custom", type: "free", listId: "custom-1" },
  { _id: "timer-1", name: "Library Timer", type: "timer", listId: "timer-1" },
];

const createTestStore = () => {
  const store = configureStore({
    reducer: {
      allItems: allItemsReducer,
      allDocs: allDocsReducer,
      undoable: (
        state = { present: { serviceTimes: { list: [] } } },
      ) => state,
    },
  });
  store.dispatch(initiateAllItemsList(items));
  return store;
};

describe("ItemLibrary route initialization", () => {
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

  it.each([
    { path: "/controller/songs", filter: "Songs", visible: "Library Song", hidden: "Library Custom" },
    { path: "/controller/free", filter: "Custom", visible: "Library Custom", hidden: "Library Timer" },
    { path: "/controller/timers", filter: "Timers", visible: "Library Timer", hidden: "Library Song" },
  ])("initializes $filter from $path", async ({ path, filter, visible, hidden }) => {
    render(
      <Provider store={createTestStore()}>
        <ControllerInfoContext.Provider
          value={createMockControllerContext() as any}
        >
          <GlobalInfoContext.Provider value={createMockGlobalContext() as any}>
            <PresentationControllerModeProvider>
              <MemoryRouter initialEntries={[path]}>
                <ItemLibrary />
              </MemoryRouter>
            </PresentationControllerModeProvider>
          </GlobalInfoContext.Provider>
        </ControllerInfoContext.Provider>
      </Provider>,
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: filter })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    expect(await screen.findByTitle(visible)).toBeInTheDocument();
    expect(screen.queryByTitle(hidden)).not.toBeInTheDocument();
  });
});
