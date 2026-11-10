import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import OverlayEditor from "./OverlayEditor";
import { ControllerInfoContext } from "../../context/controllerInfo";
import type { OverlayInfo } from "../../types";
import overlayReducer, {
  clearOverlayDraftPending,
  markOverlayDraftPending,
  selectOverlay,
} from "../../store/overlaySlice";

const mockShowToast = jest.fn();
const mockDispatch = jest.fn();
const mockState = {
  undoable: {
    present: {
      overlays: { overlayHistory: {} },
      overlay: { hasRemoteUpdate: false as boolean, selectedOverlay: null, pendingRemoteOverlay: null },
    },
  },
};

jest.mock("../../hooks", () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: (state: typeof mockState) => unknown) => selector(mockState),
  useWindowWidth: () => ({ windowWidth: 1024, windowRef: { current: null } }),
}));
jest.mock("react-redux", () => ({
  ...jest.requireActual("react-redux"),
  useStore: () => ({ getState: () => mockState }),
}));
jest.mock("../../context/toastContext", () => ({
  useToast: () => ({ showToast: mockShowToast, removeToast: jest.fn() }),
}));
jest.mock("../../components/DisplayWindow/DisplayWindow", () => () => null);
jest.mock("../../components/HistorySuggestField", () => () => null);
jest.mock("../../components/StyleEditor", () => ({
  __esModule: true,
  default: () => null,
  ParticipantPositionControl: () => null,
}));
jest.mock("../../components/Drawer", () => ({ children, isOpen }: { children: ReactNode; isOpen: boolean }) => isOpen ? <div>{children}</div> : null);
jest.mock("../../components/Select/Select", () => () => null);

describe("OverlayEditor Service Plan review removal", () => {
  beforeEach(() => {
    mockShowToast.mockReset();
    mockDispatch.mockReset();
    mockState.undoable.present.overlay.hasRemoteUpdate = false;
  });

  it("does not render Service Plan review controls and keeps remote conflict protection", async () => {
    const overlay: OverlayInfo = {
      id: "overlay-1",
      type: "participant",
      name: "Dobney Keen",
      event: "Sabbath School Host",
      duration: 0,
      servicePlanSource: { planKey: "plan-1", elementId: "element-1", candidateId: "candidate-1" },
      servicePlanBaseline: { name: "Clarence Jones", event: "Sabbath School Host" },
      servicePlanOverrides: { name: true },
    };
    mockState.undoable.present.overlay.hasRemoteUpdate = true;

    render(
      <ControllerInfoContext.Provider value={{} as never}>
        <OverlayEditor
          selectedOverlay={overlay}
          isOverlayLoading={false}
          setShowPreview={jest.fn()}
          showPreview={false}
          setIsStyleDrawerOpen={jest.fn()}
          setIsTemplateDrawerOpen={jest.fn()}
          isMobile={false}
          handleOverlayUpdate={jest.fn()}
          handleFormattingChange={jest.fn()}
        />
      </ControllerInfoContext.Provider>,
    );

    expect(screen.queryByText("Review this existing overlay")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Use plan/ })).not.toBeInTheDocument();
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({
      message: "Someone else updated this overlay.",
    })));
  });

  it("forwards owner identity to the real draft hook for same-ID replacement and unmount", () => {
    jest.useFakeTimers();
    const ownerA = { isCurrent: jest.fn(() => true) };
    const ownerB = { isCurrent: jest.fn(() => true) };
    const saveA = jest.fn();
    const saveB = jest.fn();
    const tree = (draftOwner: typeof ownerA, imageUrl: string, save: typeof saveA) => <OverlayEditor
      selectedOverlay={{ id: "X", type: "image", imageUrl }}
      isOverlayLoading={false} isMobile={false} showPreview={false}
      setShowPreview={jest.fn()} setIsStyleDrawerOpen={jest.fn()} setIsTemplateDrawerOpen={jest.fn()}
      handleOverlayUpdate={save} handleFormattingChange={jest.fn()} draftOwner={draftOwner}
    />;
    const { rerender, unmount } = render(tree(ownerA, "A original", saveA));
    fireEvent.change(screen.getByLabelText(/Image URL/), { target: { value: "A pending" } });
    ownerA.isCurrent.mockReturnValue(false);
    rerender(tree(ownerB, "B original", saveB));
    act(() => { jest.advanceTimersByTime(300); });
    expect(saveA).toHaveBeenCalledWith(expect.objectContaining({ id: "X", imageUrl: "A pending" }));
    expect(saveB).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Image URL/)).toHaveValue("B original");
    fireEvent.change(screen.getByLabelText(/Image URL/), { target: { value: "B pending" } });
    unmount();
    expect(saveB).toHaveBeenCalledWith(expect.objectContaining({ id: "X", imageUrl: "B pending" }));
    expect(saveA).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it("clears a stale same-ID draft marker after its owner becomes inactive", () => {
    jest.useFakeTimers();
    const ownerA = { isCurrent: jest.fn(() => true) };
    const ownerB = { isCurrent: jest.fn(() => true) };
    const tree = (draftOwner: typeof ownerA, imageUrl: string) => <OverlayEditor
      selectedOverlay={{ id: "X", type: "image", imageUrl }}
      isOverlayLoading={false} isMobile={false} showPreview={false}
      setShowPreview={jest.fn()} setIsStyleDrawerOpen={jest.fn()} setIsTemplateDrawerOpen={jest.fn()}
      handleOverlayUpdate={jest.fn()} handleFormattingChange={jest.fn()} draftOwner={draftOwner}
    />;
    const { rerender } = render(tree(ownerA, "A original"));
    fireEvent.change(screen.getByLabelText(/Image URL/), { target: { value: "A pending" } });
    const markA = mockDispatch.mock.calls
      .map(([action]) => action)
      .find((action) => action.type === "overlay/markOverlayDraftPending");
    expect(markA).toBeDefined();

    ownerA.isCurrent.mockReturnValue(false);
    rerender(tree(ownerB, "B original"));
    const clearA = mockDispatch.mock.calls
      .map(([action]) => action)
      .find((action) => action.type === "overlay/clearOverlayDraftPending");
    expect(clearA).toMatchObject({ payload: markA.payload });

    fireEvent.change(screen.getByLabelText(/Image URL/), { target: { value: "B pending" } });
    const markB = mockDispatch.mock.calls
      .map(([action]) => action)
      .filter((action) => action.type === "overlay/markOverlayDraftPending")
      .at(-1);
    expect(markB).toBeDefined();

    const selectedOverlay: OverlayInfo = {
      id: "X",
      type: "image",
      imageUrl: "A original",
      name: "Overlay",
      duration: 0,
    };
    let state = overlayReducer(undefined, { type: "init" });
    state = overlayReducer(state, selectOverlay(selectedOverlay));
    state = overlayReducer(state, markOverlayDraftPending(markA.payload));
    state = overlayReducer(state, markOverlayDraftPending(markB.payload));
    state = overlayReducer(state, clearOverlayDraftPending(clearA.payload));
    expect(state.pendingDraftOverlayId).toBe("X");
    expect(state.pendingDraftId).toBe(markB.payload.draftId);
    jest.useRealTimers();
  });
});
