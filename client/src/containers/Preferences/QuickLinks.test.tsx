import { fireEvent, render, screen } from "@testing-library/react";
import QuickLinks from "./QuickLinks";
import { setQuickLinks } from "../../store/preferencesSlice";

const mockDispatch = jest.fn();
const mockGenerateRandomId = jest.fn(() => "new-quick-link");

const mockState = {
  undoable: {
    present: {
      preferences: {
        defaultQuickLinks: [],
        quickLinks: [
          {
            id: "projector-link",
            label: "Projector Link",
            canDelete: true,
            displayType: "projector" as const,
            linkType: "media" as const,
          },
          {
            id: "monitor-link",
            label: "Monitor Link",
            canDelete: true,
            displayType: "monitor" as const,
            linkType: "slide" as const,
          },
          {
            id: "stream-link",
            label: "Stream Link",
            canDelete: true,
            displayType: "stream" as const,
            linkType: "overlay" as const,
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

jest.mock("../../utils/generateRandomId", () => ({
  __esModule: true,
  default: () => mockGenerateRandomId(),
}));

jest.mock("../../context/controllerInfo", () => ({
  ControllerInfoContext: {
    Provider: ({ children }: { children: React.ReactNode }) => children,
  },
}));

jest.mock("../../utils/dndUtils", () => ({
  useSensors: () => [],
}));

jest.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  verticalListSortingStrategy: {},
}));

jest.mock("../../components/Select/Select", () => ({
  __esModule: true,
  default: ({
    options,
    value,
    onChange,
    label,
  }: {
    options: { label: string; value: string }[];
    value: string;
    onChange: (value: string) => void;
    label: string;
  }) => (
    <label>
      {label}
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  ),
}));

jest.mock("./SortableQuickLink", () => ({
  __esModule: true,
  default: ({
    label,
    displayType,
  }: {
    label: string;
    displayType: string;
  }) => <div>{`${displayType}:${label}`}</div>,
}));

describe("QuickLinks", () => {
  beforeEach(() => {
    mockDispatch.mockClear();
    mockGenerateRandomId.mockClear();
  });

  it("shows only stream quick links in stream-only mode", () => {
    render(<QuickLinks streamOnly />);

    expect(screen.getByText("stream:Stream Link")).toBeInTheDocument();
    expect(screen.queryByText("projector:Projector Link")).not.toBeInTheDocument();
    expect(screen.queryByText("monitor:Monitor Link")).not.toBeInTheDocument();
  });

  it("renders quick links in projector, monitor, stream order by default", () => {
    render(<QuickLinks />);

    expect(
      screen.getAllByText(/:(Projector Link|Monitor Link|Stream Link)$/).map(
        (node) => node.textContent
      )
    ).toEqual([
      "projector:Projector Link",
      "monitor:Monitor Link",
      "stream:Stream Link",
    ]);
  });

  it("adds projector quick links by default in the full quick-links view", () => {
    render(<QuickLinks />);

    fireEvent.click(screen.getByRole("button", { name: /add quick link/i }));

    expect(mockGenerateRandomId).toHaveBeenCalledTimes(1);
    expect(mockDispatch).toHaveBeenCalledWith(
      setQuickLinks([
        ...mockState.undoable.present.preferences.quickLinks,
        {
          id: "new-quick-link",
          label: "",
          canDelete: true,
          displayType: "projector" as const,
          linkType: "media" as const,
        },
      ])
    );
  });

  it("adds stream overlay quick links in stream-only mode", () => {
    render(<QuickLinks streamOnly />);

    fireEvent.click(screen.getByRole("button", { name: /add quick link/i }));

    expect(mockGenerateRandomId).toHaveBeenCalledTimes(1);
    expect(mockDispatch).toHaveBeenCalledWith(
      setQuickLinks([
        ...mockState.undoable.present.preferences.quickLinks,
        {
          id: "new-quick-link",
          label: "",
          canDelete: true,
          displayType: "stream" as const,
          linkType: "overlay" as const,
        },
      ])
    );
  });
});
