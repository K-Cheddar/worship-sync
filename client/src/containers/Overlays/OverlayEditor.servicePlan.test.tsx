import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import OverlayEditor from "./OverlayEditor";
import { ControllerInfoContext } from "../../context/controllerInfo";
import type { OverlayInfo } from "../../types";

const mockShowToast = jest.fn();
const mockState = {
  undoable: {
    present: {
      overlays: { overlayHistory: {} },
      overlay: { hasRemoteUpdate: false as boolean, selectedOverlay: null, pendingRemoteOverlay: null },
    },
  },
};

jest.mock("../../hooks", () => ({
  useDispatch: () => jest.fn(),
  useSelector: (selector: (state: typeof mockState) => unknown) => selector(mockState),
  useWindowWidth: () => ({ windowWidth: 1024, windowRef: { current: null } }),
}));
jest.mock("react-redux", () => ({
  ...jest.requireActual("react-redux"),
  useStore: () => ({ getState: () => mockState }),
}));
jest.mock("../../hooks/useOverlayDraft", () => ({
  useOverlayDraft: (selectedOverlay: OverlayInfo) => ({
    draft: selectedOverlay,
    patchDraft: jest.fn(),
    flushDraft: jest.fn(),
    mergeDraftLocal: jest.fn(),
    replaceDraft: jest.fn(),
  }),
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
jest.mock("../../components/Drawer", () => ({ children }: { children: ReactNode }) => <div>{children}</div>);
jest.mock("../../components/Select/Select", () => () => null);

describe("OverlayEditor Service Plan review removal", () => {
  beforeEach(() => {
    mockShowToast.mockReset();
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
});
