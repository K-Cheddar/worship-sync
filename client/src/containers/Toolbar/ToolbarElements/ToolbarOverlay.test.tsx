import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import ToolbarOverlay from "./ToolbarOverlay";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { preferencesSlice } from "../../../store/preferencesSlice";

const mockDispatch = jest.fn();
let mockGenerateCredits: {
  generateFromOverlays: jest.Mock;
  isGenerating: boolean;
  justGenerated: boolean;
  hasOverlays: boolean;
};

jest.mock("../../../hooks", () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: (state: typeof mockState) => unknown) =>
    selector(mockState),
}));

jest.mock("./ToolbarButton", () => ({
  __esModule: true,
  default: ({
    children,
    onClick,
    disabled,
    "aria-label": ariaLabel,
  }: {
    children?: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    "aria-label"?: string;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={ariaLabel}>
      {children}
    </button>
  ),
}));

jest.mock("./Outlines", () => ({
  __esModule: true,
  default: () => <div>Outlines</div>,
}));

jest.mock("../../../hooks/useGenerateCreditsFromOverlays", () => ({
  useGenerateCreditsFromOverlays: () => mockGenerateCredits,
}));

let mockState: {
  undoable: {
    present: {
      preferences: ReturnType<typeof preferencesSlice.getInitialState>;
    };
  };
};

const renderOverlay = ({
  access = "full" as const,
  overlayPanel = "overlays" as const,
}: {
  access?: "full" | "music" | "view";
  overlayPanel?: "overlays" | "credits" | "serviceTimes";
} = {}) => {
  mockState = {
    undoable: {
      present: {
        preferences: {
          ...preferencesSlice.getInitialState(),
          overlayControllerPanel: overlayPanel,
        },
      },
    },
  };
  mockGenerateCredits = {
    generateFromOverlays: jest.fn(),
    isGenerating: false,
    justGenerated: false,
    hasOverlays: true,
  };

  return render(
    <GlobalInfoContext.Provider value={{ access } as any}>
      <ToolbarOverlay
        isEditMode={false}
        quickLinksDrawerOpen={false}
        onQuickLinksOpenChange={jest.fn()}
      />
    </GlobalInfoContext.Provider>,
  );
};

describe("ToolbarOverlay", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows Quick Links on overlays tab for full access", () => {
    renderOverlay({ access: "full", overlayPanel: "overlays" });
    expect(screen.getByRole("button", { name: "Quick Links" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Generate Credits" }),
    ).not.toBeInTheDocument();
  });

  it("shows Generate Credits on credits tab and hides Quick Links", () => {
    renderOverlay({ access: "full", overlayPanel: "credits" });
    expect(screen.getByRole("button", { name: "Generate Credits" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Quick Links" })).not.toBeInTheDocument();
  });

  it("hides Quick Links and Generate Credits on service times tab", () => {
    renderOverlay({ access: "full", overlayPanel: "serviceTimes" });
    expect(screen.queryByRole("button", { name: "Quick Links" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Generate Credits" }),
    ).not.toBeInTheDocument();
  });

  it("dispatches open overlay credits settings when Settings is clicked on credits tab", () => {
    renderOverlay({ access: "full", overlayPanel: "credits" });
    screen.getByRole("button", { name: "Credits settings" }).click();
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "preferences/setOverlayCreditsSettingsDrawerOpen",
        payload: true,
      }),
    );
  });

  it("disables Generate Credits when there are no overlays", () => {
    mockGenerateCredits = {
      generateFromOverlays: jest.fn(),
      isGenerating: false,
      justGenerated: false,
      hasOverlays: false,
    };
    mockState = {
      undoable: {
        present: {
          preferences: {
            ...preferencesSlice.getInitialState(),
            overlayControllerPanel: "credits",
          },
        },
      },
    };
    render(
      <GlobalInfoContext.Provider value={{ access: "full" } as any}>
        <ToolbarOverlay
          isEditMode={false}
          quickLinksDrawerOpen={false}
          onQuickLinksOpenChange={jest.fn()}
        />
      </GlobalInfoContext.Provider>,
    );

    expect(screen.getByRole("button", { name: "Generate Credits" })).toBeDisabled();
  });

  it("dispatches setOverlayControllerPanel when switching tabs", () => {
    renderOverlay({ access: "full", overlayPanel: "overlays" });

    screen.getByRole("button", { name: "Credits Editor" }).click();

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "preferences/setOverlayControllerPanel",
        payload: "credits",
      }),
    );
  });

  it("dispatches setOverlayControllerPanel when Service Times is clicked", () => {
    renderOverlay({ access: "full", overlayPanel: "overlays" });

    screen.getByRole("button", { name: "Service Times" }).click();

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "preferences/setOverlayControllerPanel",
        payload: "serviceTimes",
      }),
    );
  });

  it("hides Credits Editor tab for view access", () => {
    renderOverlay({ access: "view", overlayPanel: "overlays" });
    expect(
      screen.queryByRole("button", { name: "Credits Editor" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Service Times" }),
    ).not.toBeInTheDocument();
  });
});
