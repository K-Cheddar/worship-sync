import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import Toolbar from "./Toolbar";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import { preferencesSlice } from "../../store/preferencesSlice";

const mockDispatch = jest.fn();
const mockNavigate = jest.fn();
let mockPathname = "/controller/item/item-id/list-id";

let mockState: {
  undoable: {
    present: {
      item: {
        isEditMode: boolean;
        type: string;
      };
      preferences: ReturnType<typeof preferencesSlice.getInitialState>;
    };
  };
};

jest.mock("react-router-dom", () => ({
  ...jest.requireActual("react-router-dom"),
  useLocation: () => ({ pathname: mockPathname }),
  useNavigate: () => mockNavigate,
}));

jest.mock("../../hooks", () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: (state: typeof mockState) => unknown) =>
    selector(mockState),
}));

jest.mock("../../components/Button/Button", () => ({
  __esModule: true,
  default: ({
    children,
    className,
    onClick,
  }: {
    children?: ReactNode;
    className?: string;
    onClick?: () => void;
  }) => (
    <button type="button" className={className} onClick={onClick}>
      {children}
    </button>
  ),
}));

jest.mock("./ToolbarElements/ToolbarButton", () => ({
  __esModule: true,
  default: ({
    children,
    hidden,
    onClick,
  }: {
    children?: ReactNode;
    hidden?: boolean;
    onClick?: () => void;
  }) =>
    hidden ? null : (
      <button type="button" onClick={onClick}>
        {children}
      </button>
    ),
}));

jest.mock("./ToolbarElements/Menu", () => ({
  __esModule: true,
  default: () => <div>Menu</div>,
}));

jest.mock("./ToolbarElements/Outlines", () => ({
  __esModule: true,
  default: () => <div>Outlines</div>,
}));

jest.mock("./ToolbarElements/SlideEditTools", () => ({
  __esModule: true,
  default: () => <div>Slide Tools Panel</div>,
}));

jest.mock("./ToolbarElements/ItemEditTools", () => ({
  __esModule: true,
  default: () => <div>Item Tools Panel</div>,
}));

jest.mock("./ToolbarElements/Undo", () => ({
  __esModule: true,
  default: () => <div>Undo</div>,
}));

jest.mock("./ToolbarElements/UserSection", () => ({
  __esModule: true,
  default: () => <div>User</div>,
}));

jest.mock("./ToolbarElements/FormattedTextEditor", () => ({
  __esModule: true,
  default: () => <div>Formatted Text Editor</div>,
}));

jest.mock("./ToolbarElements/BoxEditor", () => ({
  __esModule: true,
  default: () => <div>Box Tools Panel</div>,
}));

jest.mock("../../components/Drawer/Drawer", () => ({
  __esModule: true,
  default: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

jest.mock("../../pages/Controller/QuickLinks", () => ({
  __esModule: true,
  default: () => <div>Quick Links Page</div>,
}));

jest.mock("../../components/ErrorBoundary/ErrorBoundary", () => ({
  __esModule: true,
  default: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

jest.mock("../../hooks/useGenerateCreditsFromOverlays", () => ({
  useGenerateCreditsFromOverlays: () => ({
    generateFromOverlays: jest.fn(),
    isGenerating: false,
    justGenerated: false,
    hasOverlays: true,
  }),
}));

const renderToolbar = ({
  access,
  itemType,
}: {
  access: "full" | "music" | "view";
  itemType: string;
}) => {
  mockState = {
    undoable: {
      present: {
        item: {
          isEditMode: false,
          type: itemType,
        },
        preferences: preferencesSlice.getInitialState(),
      },
    },
  };

  return render(
    <GlobalInfoContext.Provider value={{ access } as any}>
      <ControllerInfoContext.Provider value={{ isPhone: false } as any}>
        <Toolbar className="toolbar" />
      </ControllerInfoContext.Provider>
    </GlobalInfoContext.Provider>,
  );
};

const renderToolbarOverlay = ({
  access,
  overlayPanel = "overlays",
}: {
  access: "full" | "music" | "view";
  overlayPanel?: "overlays" | "credits";
}) => {
  mockState = {
    undoable: {
      present: {
        item: {
          isEditMode: false,
          type: "song",
        },
        preferences: {
          ...preferencesSlice.getInitialState(),
          overlayControllerPanel: overlayPanel,
        },
      },
    },
  };

  return render(
    <GlobalInfoContext.Provider value={{ access } as any}>
      <ControllerInfoContext.Provider value={{ isPhone: false } as any}>
        <Toolbar className="toolbar" variant="overlay" />
      </ControllerInfoContext.Provider>
    </GlobalInfoContext.Provider>,
  );
};

describe("Toolbar", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPathname = "/controller/item/item-id/list-id";
  });

  it("hides slide and box tools for music access on non-song items", () => {
    renderToolbar({ access: "music", itemType: "bible" });

    expect(
      screen.queryByRole("button", { name: "Slide Tools" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Box Tools" }),
    ).not.toBeInTheDocument();
  });

  it("shows slide and box tools for music access on song items", () => {
    renderToolbar({ access: "music", itemType: "song" });

    expect(screen.getByRole("button", { name: "Slide Tools" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Box Tools" })).toBeInTheDocument();
  });

  it("hides quick links and monitor settings for music access", () => {
    renderToolbar({ access: "music", itemType: "song" });

    expect(
      screen.queryByRole("button", { name: "Quick Links" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Monitor Settings" }),
    ).not.toBeInTheDocument();
  });

  it("navigates to preferences when Settings is clicked from another settings sub-route", () => {
    mockPathname = "/controller/quick-links";
    renderToolbar({ access: "full", itemType: "song" });

    screen.getByRole("button", { name: "Settings" }).click();

    expect(mockNavigate).toHaveBeenCalledWith("/controller/preferences");
  });

  it("navigates to preferences when Settings is clicked from an item route", () => {
    mockPathname = "/controller/item/item-id/list-id";
    renderToolbar({ access: "full", itemType: "song" });

    screen.getByRole("button", { name: "Settings" }).click();

    expect(mockNavigate).toHaveBeenCalledWith("/controller/preferences");
  });

  it("does not navigate to preferences when Settings is clicked for view access", () => {
    mockPathname = "/controller/quick-links";
    renderToolbar({ access: "view", itemType: "song" });

    screen.getByRole("button", { name: "Settings" }).click();

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("overlay variant shows Overlays and Credits Editor tabs", () => {
    renderToolbarOverlay({ access: "full" });

    expect(
      screen.getByRole("button", { name: "Overlays" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Credits Editor" }),
    ).toBeInTheDocument();
  });

  it("overlay variant hides Credits Editor tab for view access", () => {
    renderToolbarOverlay({ access: "view" });

    expect(
      screen.queryByRole("button", { name: "Credits Editor" }),
    ).not.toBeInTheDocument();
  });

  it("overlay variant hides Quick Links for non-full access", () => {
    renderToolbarOverlay({ access: "music" });

    expect(
      screen.queryByRole("button", { name: "Quick Links" }),
    ).not.toBeInTheDocument();
  });

  it("overlay variant dispatches when Credits Editor is clicked", () => {
    renderToolbarOverlay({ access: "full" });

    screen.getByRole("button", { name: "Credits Editor" }).click();

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "preferences/setOverlayControllerPanel",
        payload: "credits",
      }),
    );
  });

  it("overlay variant shows Generate Credits instead of Quick Links on credits tab", () => {
    renderToolbarOverlay({ access: "full", overlayPanel: "credits" });

    expect(
      screen.getByRole("button", { name: "Generate Credits" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Quick Links" }),
    ).not.toBeInTheDocument();
  });

  it("overlay variant shows Quick Links on overlays tab when full access", () => {
    renderToolbarOverlay({ access: "full", overlayPanel: "overlays" });

    expect(screen.getByRole("button", { name: "Quick Links" })).toBeInTheDocument();
  });
});
