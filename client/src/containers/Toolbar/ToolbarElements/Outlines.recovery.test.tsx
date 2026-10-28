import "core-js/stable/structured-clone";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import Outlines from "./Outlines";
import store from "../../../store/store";
import * as controllerModule from "../../../context/controllerInfo";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { ActiveControllerProvider } from "../../../context/activeController";
import { PresentationControllerModeProvider } from "../../../context/presentationControllerMode";
import { ToastProvider } from "../../../context/toastContext";
import type { DBItemLists, ItemList } from "../../../types";
import { createMockControllerContext, createMockGlobalContext, createMockPouchDB } from "../../../test/mocks";

const databaseBinding = controllerModule as unknown as { globalDb: unknown };

afterEach(() => {
  databaseBinding.globalDb = undefined;
  store.dispatch({ type: "RESET" });
});

it("opens the controller with the winning outline registry and ignores historical branches", async () => {
  const winner: DBItemLists & { _conflicts: string[] } = {
    _id: "ItemLists",
    _rev: "3-established-winner",
    _conflicts: ["2-old-losing-revision"],
    itemLists: [
      { _id: "canva", name: "Canva Test" },
      { _id: "morning", name: "Morning Service" },
      { _id: "evening", name: "Evening Service" },
      { _id: "aux", name: "Auxiliary Outline", controllerScope: "aux" },
    ],
    activeList: { _id: "canva", name: "Canva Test" },
  };
  const db = createMockPouchDB({ get: jest.fn(async () => structuredClone(winner)) });
  databaseBinding.globalDb = db;
  store.dispatch({ type: "RESET" });

  render(
    <Provider store={store}>
      <GlobalInfoContext.Provider value={createMockGlobalContext({ access: "full" })}>
        <controllerModule.ControllerInfoContext.Provider value={createMockControllerContext({ db })}>
          <MemoryRouter>
            <ToastProvider>
              <ActiveControllerProvider profileId="presentation">
                <PresentationControllerModeProvider>
                  <Outlines servicePanel />
                </PresentationControllerModeProvider>
              </ActiveControllerProvider>
            </ToastProvider>
          </MemoryRouter>
        </controllerModule.ControllerInfoContext.Provider>
      </GlobalInfoContext.Provider>
    </Provider>,
  );

  const picker = await screen.findByTestId("controller-outline-picker");
  await waitFor(() => expect(picker).toHaveTextContent("Canva Test"));
  expect((store.getState().undoable.present.itemLists.currentLists as ItemList[]).map((list) => list.name)).toEqual([
    "Canva Test", "Morning Service", "Evening Service", "Auxiliary Outline",
  ]);
  expect(store.getState().undoable.present.itemLists.activeList?._id).toBe("canva");
  expect(db.get).toHaveBeenCalledTimes(1);
  expect(db.put).not.toHaveBeenCalled();
  expect(screen.queryByText(/competing saved versions/i)).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Outline list recovery" })).not.toBeInTheDocument();

  const user = userEvent.setup();
  await user.click(picker);
  expect(await screen.findByText("Morning Service")).toBeInTheDocument();
  expect(screen.getByText("Evening Service")).toBeInTheDocument();
  expect(screen.queryByText("Service Outline (1)")).not.toBeInTheDocument();
  expect(screen.queryByText(/competing saved versions/i)).not.toBeInTheDocument();
});
