import "core-js/stable/structured-clone";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import Outlines from "./Outlines";
import store from "../../../store/store";
import { itemListsSlice } from "../../../store/itemListsSlice";
import * as controllerModule from "../../../context/controllerInfo";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { ActiveControllerProvider } from "../../../context/activeController";
import { PresentationControllerModeProvider } from "../../../context/presentationControllerMode";
import { ToastProvider } from "../../../context/toastContext";
import type { DBItemLists } from "../../../types";
import { createMockControllerContext, createMockGlobalContext, createMockPouchDB } from "../../../test/mocks";

const databaseBinding = controllerModule as unknown as { globalDb: unknown };

afterEach(() => {
  databaseBinding.globalDb = undefined;
  store.dispatch({ type: "RESET" });
  jest.useRealTimers();
});

it("opens the real recovery picker, reviews both names, and commits a choice with pending feedback", async () => {
  jest.useFakeTimers();
  let document: DBItemLists = {
    _id: "ItemLists", _rev: "2-remote", itemLists: [{ _id: "a", name: "Remote name" }, { _id: "b", name: "Independent remote outline", controllerScope: "aux" }],
    activeList: { _id: "a", name: "Remote name" }, selectedIdByScope: { presentation: "a", aux: "b" },
  };
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => { finish = resolve; });
  const db = createMockPouchDB({
    get: jest.fn(async () => structuredClone(document)),
    put: jest.fn(async (next: DBItemLists) => { await gate; document = { ...next, _rev: "3-resolved" }; return { rev: document._rev }; }),
  });
  databaseBinding.globalDb = db;
  store.dispatch({ type: "RESET" });
  store.dispatch(itemListsSlice.actions.initiateItemLists([{ _id: "a", name: "Original name" }]));
  store.dispatch(itemListsSlice.actions.updateItemLists([{ _id: "a", name: "Local name" }]));
  await jest.advanceTimersByTimeAsync(1500);
  expect(store.getState().undoable.present.itemLists.registrySave.status).toBe("review");
  jest.useRealTimers();
  const user = userEvent.setup();
  render(<Provider store={store}><GlobalInfoContext.Provider value={createMockGlobalContext({ access: "full" })}>
    <controllerModule.ControllerInfoContext.Provider value={createMockControllerContext({ db })}>
      <MemoryRouter><ToastProvider><ActiveControllerProvider profileId="presentation"><PresentationControllerModeProvider>
        <Outlines servicePanel />
      </PresentationControllerModeProvider></ActiveControllerProvider></ToastProvider></MemoryRouter>
    </controllerModule.ControllerInfoContext.Provider>
  </GlobalInfoContext.Provider></Provider>);
  expect(screen.queryByRole("region", { name: "Outline list recovery" })).not.toBeInTheDocument();
  await user.click(screen.getByTestId("controller-outline-picker"));
  const recovery = await screen.findByRole("region", { name: "Outline list recovery" });
  expect(within(recovery).getByRole("button", { name: "Save choices" })).toBeDisabled();
  expect(within(recovery).getByRole("button", { name: "Keep: Local name" })).toBeInTheDocument();
  expect(within(recovery).getByRole("button", { name: "Use saved: Remote name" })).toBeInTheDocument();
  await user.click(within(recovery).getByRole("button", { name: "Keep: Local name" }));
  expect(within(recovery).getByRole("button", { name: "Keep: Local name", pressed: true })).toBeInTheDocument();
  await user.click(within(recovery).getByRole("button", { name: "Save choices" }));
  expect(recovery).toHaveAttribute("aria-busy", "true");
  expect(within(recovery).getByRole("status")).toHaveTextContent("Saving outline list");
  expect(within(recovery).queryByRole("button", { name: "Retry save" })).not.toBeInTheDocument();
  await act(async () => { finish(); });
  await waitFor(() => expect(screen.queryByRole("region", { name: "Outline list recovery" })).not.toBeInTheDocument());
  expect(document.itemLists).toEqual([{ _id: "a", name: "Local name" }, { _id: "b", name: "Independent remote outline", controllerScope: "aux" }]);
  expect(store.getState().undoable.present.itemLists.activeList?._id).toBe("a");
  expect(store.getState().undoable.present.itemLists.selectedList?.name).toBe("Local name");
});
