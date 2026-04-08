import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import Toolbar from "./Toolbar";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";

const mockDispatch = jest.fn();
let mockState: {
  undoable: {
    present: {
      item: {
        isEditMode: boolean;
        type: string;
      };
    };
  };
};

jest.mock("react-router-dom", () => ({
  ...jest.requireActual("react-router-dom"),
  useLocation: () => ({ pathname: "/controller/item/item-id/list-id" }),
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

describe("Toolbar", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
});
