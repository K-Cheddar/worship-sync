import { render, screen } from "@testing-library/react";
import QuickLinks from "./QuickLinks";

const mockDispatch = jest.fn();

const mockState = {
  undoable: {
    present: {
      preferences: {
        quickLinks: [
          {
            id: "projector-link",
            label: "Projector Link",
            canDelete: true,
            displayType: "projector",
            linkType: "media",
          },
          {
            id: "monitor-link",
            label: "Monitor Link",
            canDelete: true,
            displayType: "monitor",
            linkType: "slide",
          },
          {
            id: "stream-link",
            label: "Stream Link",
            canDelete: true,
            displayType: "stream",
            linkType: "overlay",
          },
        ],
        selectedQuickLink: null,
      },
    },
  },
  timers: {
    timers: [],
  },
};

jest.mock("../../hooks", () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: (state: typeof mockState) => unknown) =>
    selector(mockState),
}));

jest.mock("./QuickLink", () => ({
  __esModule: true,
  default: ({
    label,
    displayType,
  }: {
    label: string;
    displayType: string;
  }) => <div>{`${displayType}:${label}`}</div>,
}));

jest.mock("../../context/controllerInfo", () => ({
  ControllerInfoContext: {
    Provider: ({ children }: { children: React.ReactNode }) => children,
  },
}));

describe("QuickLinks", () => {
  it("shows only stream quick links in stream-only mode", () => {
    render(<QuickLinks streamOnly />);

    expect(screen.getByText("stream:Stream Link")).toBeInTheDocument();
    expect(screen.queryByText("projector:Projector Link")).not.toBeInTheDocument();
    expect(screen.queryByText("monitor:Monitor Link")).not.toBeInTheDocument();
  });
});
