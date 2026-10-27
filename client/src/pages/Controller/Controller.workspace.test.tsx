import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from "react-router-dom";
import { Provider } from "react-redux";
import Controller from "./Controller";
import store from "../../store/store";
import { hydrateItemCache } from "../../store/allDocsSlice";
import { initiateItemList } from "../../store/itemListSlice";
import { itemSlice } from "../../store/itemSlice";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import { createMockControllerContext, createMockGlobalContext, createMockPouchDB } from "../../test/mocks";
import type { DBItem } from "../../types";

jest.mock("./useControllerPageLifecycle", () => ({ useControllerPageLifecycle: () => ({ layoutRef: { current: null } }) }));
jest.mock("./useServicePlanningSyncRunner", () => ({ useServicePlanningSyncRunner: () => undefined }));
jest.mock("../../components/ControllerPageShell/ControllerPageShell", () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
jest.mock("../../containers/PanelButtons/PanelButtons", () => () => null);
jest.mock("../../containers/ItemEditor/LyricsEditor", () => () => null);
jest.mock("../../containers/ItemEditor/SlideEditor", () => () => <div data-testid="editor" />);
jest.mock("../../containers/ItemSlides/ItemSlides", () => ({ __esModule: true, default: () => <div data-testid="grid" />, ItemSlidesDndContext: jest.requireActual("react").createContext("ancestor") }));
jest.mock("../../containers/Media/Media", () => () => null);
jest.mock("../../containers/Media/MediaDragOverlay", () => () => null);
jest.mock("../../containers/Media/ControllerMediaPreparationPublisher", () => () => null);
jest.mock("../../containers/TransmitHandler/TransmitHandler", () => () => null);
jest.mock("../../containers/Overlays/Overlays", () => () => null);
jest.mock("../../containers/Bible/Bible", () => () => null);
jest.mock("../../containers/Songs/Songs", () => () => <div>Song library</div>);
jest.mock("../../containers/FreeForms/FreeForms", () => () => null);
jest.mock("../../containers/Timers/Timers", () => () => null);
jest.mock("../../containers/CreateItem/CreateItem", () => () => null);
jest.mock("./Preferences", () => () => null);
jest.mock("./QuickLinks", () => () => null);
jest.mock("./Displays", () => () => null);
jest.mock("./ServicePlanningImportPanel", () => () => null);
jest.mock("./ServicePlanningSyncFloatingWindow", () => () => null);
jest.mock("../../containers/Toolbar/ToolbarElements/Outlines", () => () => null);
jest.mock("../../hooks/useDisplayedUpcomingService", () => () => null);
jest.mock("@gsap/react", () => ({ useGSAP: () => undefined }));
jest.mock("../../components/FloatingWindow/FloatingWindow", () => () => null);

const Location = () => <span data-testid="location" data-navigation={useNavigationType()}>{useLocation().pathname}</span>;
const rows = ["A", "B", "C"].map((_id) => ({ _id, name: _id, type: "free", listId: `${_id}-row` }));
const mount = (path = "/controller") => {
  store.dispatch({ type: "RESET" });
  store.dispatch(hydrateItemCache(rows.map((row): DBItem => ({ ...itemSlice.getInitialState(), ...row, type: "free" }))));
  store.dispatch(initiateItemList(rows));
  store.dispatch({ type: "itemList/setItemListIsLoading", payload: false });
  const db = createMockPouchDB({ get: jest.fn(), allDocs: jest.fn(), changes: jest.fn() });
  const view = render(<Provider store={store}><GlobalInfoContext.Provider value={createMockGlobalContext({ access: "full" })}>
    <ControllerInfoContext.Provider value={createMockControllerContext({ db })}>
      <MemoryRouter initialEntries={[path]}><Location /><Routes><Route path="/controller/*" element={<Controller />} /></Routes></MemoryRouter>
    </ControllerInfoContext.Provider>
  </GlobalInfoContext.Provider></Provider>);
  return { ...view, db };
};
const clickRow = (name: string, options = {}) => fireEvent.click(screen.getByRole("button", { name, description: "" }), options);

beforeEach(() => { localStorage.setItem("worshipsync_presentation_controller_mode", "edit"); });

test("real outline clicks and arrow keys activate cached Redux content without routing or replacing the editor/grid", () => {
  const { db } = mount();
  expect(screen.getByText("No Item Selected")).toBeInTheDocument();
  clickRow("A");
  const editor = screen.getByTestId("editor");
  const grid = screen.getByTestId("grid");
  clickRow("B");
  expect(store.getState().undoable.present.item).toMatchObject({ _id: "B", listId: "B-row" });
  fireEvent.keyDown(screen.getByRole("button", { name: "B", description: "" }), { key: "ArrowDown" });
  expect(store.getState().undoable.present.item._id).toBe("C");
  expect(screen.getByTestId("editor")).toBe(editor);
  expect(screen.getByTestId("grid")).toBe(grid);
  expect(screen.getByTestId("location")).toHaveTextContent(/^\/controller$/);
  expect(screen.getByTestId("location")).toHaveAttribute("data-navigation", "POP");
  expect(db.get).not.toHaveBeenCalled();
  expect(db.allDocs).not.toHaveBeenCalled();
});

test("Shift, Ctrl, Cmd and selection-only clicks leave the active document and workspace alone", () => {
  mount();
  clickRow("A");
  clickRow("B", { shiftKey: true });
  clickRow("C", { ctrlKey: true });
  clickRow("B", { metaKey: true });
  clickRow("C");
  expect(store.getState().undoable.present.item._id).toBe("A");
  expect(screen.getByTestId("location")).toHaveTextContent(/^\/controller$/);
});

test("selection-only gestures with no active item never trigger initialization activation", () => {
  mount();
  clickRow("A", { ctrlKey: true });
  clickRow("B", { shiftKey: true });
  expect(store.getState().undoable.present.item.type).toBe("");
  expect(screen.getByText("No Item Selected")).toBeInTheDocument();
});

test("touch long press enters selection-only mode without activating another item", () => {
  jest.useFakeTimers();
  mount();
  clickRow("A");
  const target = screen.getByRole("button", { name: "B", description: "" });
  const event = new Event("pointerdown", { bubbles: true });
  Object.defineProperties(event, { pointerType: { value: "touch" }, clientX: { value: 10 }, clientY: { value: 10 } });
  fireEvent(target, event);
  act(() => { jest.advanceTimersByTime(550); });
  clickRow("B");
  expect(store.getState().undoable.present.item._id).toBe("A");
  expect(screen.getByTestId("location")).toHaveTextContent(/^\/controller$/);
  jest.useRealTimers();
});

test("selecting from a section enters the workspace with cached content", () => {
  mount("/controller/songs");
  expect(screen.getByText("Song library")).toBeInTheDocument();
  clickRow("B");
  expect(screen.getByTestId("location")).toHaveTextContent(/^\/controller$/);
  expect(store.getState().undoable.present.item._id).toBe("B");
});

test("legacy item URLs redirect to the workspace without activating their encoded item", () => {
  mount("/controller/item/QQ==/QS1yb3c=");
  expect(screen.getByTestId("location")).toHaveTextContent(/^\/controller$/);
  expect(screen.getByText("No Item Selected")).toBeInTheDocument();
  expect(store.getState().undoable.present.item.type).toBe("");
});
