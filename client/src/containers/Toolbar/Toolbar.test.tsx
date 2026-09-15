import { act, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import Toolbar from "./Toolbar";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import { preferencesSlice } from "../../store/preferencesSlice";
import { PresentationControllerModeProvider } from "../../context/presentationControllerMode";

const mockDispatch = jest.fn();
let mockPathname = "/controller/item/item-id/list-id";

let mockState: {
  undoable: {
    present: {
      item: {
        isLyricsEditorOpen: boolean;
        type: string;
      };
      preferences: ReturnType<typeof preferencesSlice.getInitialState>;
    };
  };
};

jest.mock("react-router-dom", () => ({
  ...jest.requireActual("react-router-dom"),
  useLocation: () => ({ pathname: mockPathname }),
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
    to,
  }: {
    children?: ReactNode;
    hidden?: boolean;
    onClick?: () => void;
    to?: string;
  }) =>
    hidden ? null : to ? (
      <a href={to}>{children}</a>
    ) : (
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
  default: ({ className }: { className?: string }) =>
    className?.includes("hidden") ? null : <div>Slide Tools Panel</div>,
}));

jest.mock("./ToolbarElements/ItemEditTools", () => ({
  __esModule: true,
  default: ({ className }: { className?: string }) =>
    className?.includes("hidden") ? null : <div>Item Tools Panel</div>,
}));

jest.mock("./ToolbarElements/Undo", () => ({
  __esModule: true,
  default: () => <div>Undo</div>,
}));

jest.mock("./ToolbarElements/UserSection", () => ({
  __esModule: true,
  default: ({ variant }: { variant?: string }) => (
    <div data-testid={variant === "compact" ? "compact-user" : "full-user"}>User</div>
  ),
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

jest.mock("../../context/activeController", () => ({
  useControllerBasePath: () => mockControllerBasePath,
}));

let mockControllerBasePath = "/controller";

const renderToolbar = ({
  access,
  itemType,
  lastControllerConfigurationRoute,
  variant,
  workspaceMode,
}: {
  access: "full" | "music" | "view";
  itemType: string;
  lastControllerConfigurationRoute?: string;
  variant?: "default" | "aux";
  workspaceMode?: "present" | "edit";
}) => {
  mockState = {
    undoable: {
      present: {
        item: {
          isLyricsEditorOpen: false,
          type: itemType,
        },
        preferences: {
          ...preferencesSlice.getInitialState(),
          ...(lastControllerConfigurationRoute
            ? { lastControllerConfigurationRoute }
            : {}),
        },
      },
    },
  };

  const toolbar = <Toolbar className="toolbar" variant={variant} />;
  return render(
    <GlobalInfoContext.Provider value={{ access } as any}>
      <ControllerInfoContext.Provider value={{ isPhone: false } as any}>
        {workspaceMode ? (
          <PresentationControllerModeProvider>{toolbar}</PresentationControllerModeProvider>
        ) : toolbar}
      </ControllerInfoContext.Provider>
    </GlobalInfoContext.Provider>,
  );
};

const renderToolbarOverlay = ({
  access,
  overlayPanel = "overlays",
}: {
  access: "full" | "music" | "view";
  overlayPanel?:
  | "overlays"
  | "boardPosts"
  | "overlaysAndPosts"
  | "credits"
  | "serviceTimes";
}) => {
  mockState = {
    undoable: {
      present: {
        item: {
          isLyricsEditorOpen: false,
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
    localStorage.clear();
    mockPathname = "/controller/item/item-id/list-id";
    mockControllerBasePath = "/controller";
  });

  it("hides undo and secondary toolbar rows in Present mode", () => {
    renderToolbar({ access: "full", itemType: "song", workspaceMode: "present" });

    const primaryRow = screen.getByTestId("toolbar-primary-row");
    expect(within(primaryRow).getByText("Menu")).toBeInTheDocument();
    expect(within(primaryRow).getByRole("button", { name: "Present" })).toBeInTheDocument();
    expect(screen.queryByText("Undo")).not.toBeInTheDocument();
    expect(screen.queryByText("Slide Tools Panel")).not.toBeInTheDocument();
    expect(screen.getByTestId("compact-user")).toBeInTheDocument();
  });

  it("keeps undo and full toolbar content in Edit mode", () => {
    renderToolbar({ access: "full", itemType: "song", workspaceMode: "present" });
    act(() => {
      screen.getByRole("button", { name: "Edit" }).click();
    });

    const primaryRow = screen.getByTestId("toolbar-primary-row");
    expect(within(primaryRow).getByText("Menu")).toBeInTheDocument();
    expect(within(primaryRow).getByText("Undo")).toBeInTheDocument();
    expect(within(primaryRow).getByRole("link", { name: "Configurations" })).toBeInTheDocument();
    const leftColumn = screen.getByTestId("toolbar-left-column");
    expect(within(leftColumn).getByText("Slide Tools Panel")).toBeInTheDocument();
    expect(screen.getByTestId("toolbar-user-section")).toContainElement(screen.getByTestId("full-user"));
    expect(screen.getByTestId("full-user")).toBeInTheDocument();
  });

  it("does not change presentation state when switching workspace modes", () => {
    renderToolbar({ access: "full", itemType: "song", workspaceMode: "present" });
    const presentationItem = { ...mockState.undoable.present.item };

    act(() => {
      screen.getByRole("button", { name: "Edit" }).click();
    });

    expect(mockState.undoable.present.item).toEqual(presentationItem);
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

    expect(
      screen.getByRole("button", { name: "Slide Tools" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Box Tools" }),
    ).toBeInTheDocument();
  });

  it("shows slide and box tools for music access on free form items", () => {
    renderToolbar({ access: "music", itemType: "free" });

    expect(
      screen.getByRole("button", { name: "Slide Tools" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Box Tools" }),
    ).toBeInTheDocument();
  });

  it("hides quick links and displays for music access", () => {
    renderToolbar({ access: "music", itemType: "song" });

    expect(
      screen.queryByRole("button", { name: "Quick Links" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Displays" }),
    ).not.toBeInTheDocument();
  });

  it("renders Configurations as a link to the last saved configuration route", () => {
    renderToolbar({
      access: "full",
      itemType: "song",
      lastControllerConfigurationRoute: "/controller/service-planning",
    });

    const settings = screen.getByRole("link", { name: "Configurations" });
    expect(settings).toHaveAttribute("href", "/controller/service-planning");
  });

  it("falls back to preferences for Configurations when no other tab was saved", () => {
    renderToolbar({ access: "full", itemType: "song" });

    const settings = screen.getByRole("link", { name: "Configurations" });
    expect(settings).toHaveAttribute("href", "/controller/preferences");
  });

  it("scopes configuration links to an auxiliary controller base path", () => {
    mockControllerBasePath = "/aux-controller/ctrl_lobby";
    mockPathname = "/aux-controller/ctrl_lobby/displays";
    renderToolbar({
      access: "full",
      itemType: "song",
      variant: "aux",
      lastControllerConfigurationRoute: "/controller/displays",
    });

    expect(screen.getByRole("link", { name: "Configurations" })).toHaveAttribute(
      "href",
      "/aux-controller/ctrl_lobby/displays",
    );
    expect(screen.getByRole("link", { name: "Displays" })).toHaveAttribute(
      "href",
      "/aux-controller/ctrl_lobby/displays",
    );
    expect(screen.getByRole("link", { name: "Preferences" })).toHaveAttribute(
      "href",
      "/aux-controller/ctrl_lobby/preferences",
    );
    expect(
      screen.queryByRole("link", { name: "Service Planning" }),
    ).not.toBeInTheDocument();
  });

  it("shows slide and item tools on an auxiliary controller item page", () => {
    mockControllerBasePath = "/aux-controller/ctrl_lobby";
    mockPathname = "/aux-controller/ctrl_lobby/item/item-id/list-id";
    renderToolbar({
      access: "full",
      itemType: "song",
      variant: "aux",
    });

    expect(
      screen.getByRole("button", { name: "Slide Tools" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Box Tools" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Item Tools" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Stream Format" }),
    ).not.toBeInTheDocument();
  });

  it("supports Present and Edit modes on an auxiliary controller", () => {
    mockControllerBasePath = "/aux-controller/ctrl_lobby";
    renderToolbar({
      access: "full",
      itemType: "song",
      variant: "aux",
      workspaceMode: "present",
    });

    expect(screen.getByRole("button", { name: "Present" })).toBeInTheDocument();
    expect(screen.getByTestId("toolbar-primary-row")).toBeInTheDocument();
    expect(screen.getByTestId("toolbar-user-section")).toBeInTheDocument();
    expect(screen.queryByText("Undo")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Slide Tools" })).not.toBeInTheDocument();
    expect(screen.getByTestId("compact-user")).toBeInTheDocument();

    act(() => {
      screen.getByRole("button", { name: "Edit" }).click();
    });

    expect(screen.getByText("Undo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Slide Tools" })).toBeInTheDocument();
    expect(screen.getByTestId("full-user")).toBeInTheDocument();
  });

  it("renders Configurations as a button for view access", () => {
    renderToolbar({ access: "view", itemType: "song" });

    expect(
      screen.queryByRole("link", { name: "Configurations" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Configurations" }),
    ).toBeInTheDocument();
  });

  it("switches to Slide Tools when navigating to a timer item", () => {
    const view = renderToolbar({ access: "full", itemType: "song" });

    expect(screen.getByText("Slide Tools Panel")).toBeInTheDocument();

    act(() => {
      screen.getByRole("button", { name: "Item Tools" }).click();
    });

    expect(screen.queryByText("Slide Tools Panel")).not.toBeInTheDocument();
    expect(screen.getByText("Item Tools Panel")).toBeInTheDocument();

    mockPathname = "/controller/item/timer-id/list-id";
    mockState = {
      undoable: {
        present: {
          item: {
            isLyricsEditorOpen: false,
            type: "timer",
          },
          preferences: preferencesSlice.getInitialState(),
        },
      },
    };

    view.rerender(
      <GlobalInfoContext.Provider value={{ access: "full" } as any}>
        <ControllerInfoContext.Provider value={{ isPhone: false } as any}>
          <Toolbar className="toolbar" />
        </ControllerInfoContext.Provider>
      </GlobalInfoContext.Provider>,
    );

    expect(screen.getByText("Slide Tools Panel")).toBeInTheDocument();
    expect(screen.queryByText("Item Tools Panel")).not.toBeInTheDocument();
  });

  it("overlay variant shows Overlays, Board Posts, Overlays & Posts, Credits Editor, and Service Times tabs", () => {
    renderToolbarOverlay({ access: "full" });

    expect(
      screen.getByRole("button", { name: "Overlays" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Board Posts" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Overlays & Posts" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Credits Editor" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Service Times" }),
    ).toBeInTheDocument();
  });

  it("overlay variant hides Credits Editor and Service Times tabs for view access", () => {
    renderToolbarOverlay({ access: "view" });

    expect(
      screen.queryByRole("button", { name: "Credits Editor" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Service Times" }),
    ).not.toBeInTheDocument();
  });

  it("overlay variant hides Quick Links for non-full access", () => {
    renderToolbarOverlay({ access: "music" });

    expect(
      screen.queryByRole("button", { name: "Quick Links" }),
    ).not.toBeInTheDocument();
  });

  it("overlay variant hides Credits Editor for music access but shows Service Times", () => {
    renderToolbarOverlay({ access: "music" });

    expect(
      screen.queryByRole("button", { name: "Credits Editor" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Service Times" }),
    ).toBeInTheDocument();
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

  it("overlay variant dispatches when Service Times is clicked", () => {
    renderToolbarOverlay({ access: "full" });

    screen.getByRole("button", { name: "Service Times" }).click();

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "preferences/setOverlayControllerPanel",
        payload: "serviceTimes",
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

    expect(
      screen.getByRole("button", { name: "Quick Links" }),
    ).toBeInTheDocument();
  });

  it("overlay variant hides Quick Links on service times tab when full access", () => {
    renderToolbarOverlay({ access: "full", overlayPanel: "serviceTimes" });

    expect(
      screen.queryByRole("button", { name: "Quick Links" }),
    ).not.toBeInTheDocument();
  });
});
