import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ExistingCreditsDrawer from "./ExistingCreditsDrawer";
import {
  getAllCreditDocsForOutline,
  getCreditUsageByList,
} from "../../utils/dbUtils";
import { getCreditDocId } from "../../types";

jest.mock("../../store/store", () => ({
  broadcastCreditsUpdate: jest.fn(),
}));

jest.mock("../../utils/dbUtils", () => ({
  getAllCreditDocsForOutline: jest.fn(),
  getCreditUsageByList: jest.fn(),
}));

const mockDispatch = jest.fn();

jest.mock("../../hooks", () => ({
  useDispatch: () => mockDispatch,
  useSelector: (fn: (s: typeof mockState) => unknown) => fn(mockState),
}));

jest.mock("../../components/Drawer", () => ({
  __esModule: true,
  default: ({
    isOpen,
    title,
    children,
  }: {
    isOpen: boolean;
    title?: string;
    children: React.ReactNode;
  }) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        {children}
      </div>
    ) : null,
}));

jest.mock("../../components/Button/Button", () => ({
  __esModule: true,
  default: ({
    children,
    onClick,
    disabled,
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

jest.mock("../../components/Input/Input", () => ({
  __esModule: true,
  default: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (v: string | unknown) => void;
  }) => (
    <input
      data-testid="search-input"
      aria-label="Search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

jest.mock("../../components/Menu/Menu", () => ({
  __esModule: true,
  default: ({
    menuItems,
  }: {
    menuItems: {
      text: string;
      onClick?: () => void;
      disabled?: boolean;
    }[];
  }) => (
    <div>
      {menuItems.map((m, i) => (
        <button
          key={i}
          type="button"
          onClick={m.onClick}
          disabled={m.disabled}
        >
          {m.text}
        </button>
      ))}
    </div>
  ),
}));

jest.mock("../../components/Modal/DeleteModal", () => ({
  __esModule: true,
  default: () => null,
}));

const mockState = {
  undoable: {
    present: {
      itemLists: {
        selectedList: { _id: "ol1", name: "Sunday AM" } as const,
      },
    },
  },
};

const mockDb = {} as PouchDB.Database;

describe("ExistingCreditsDrawer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getAllCreditDocsForOutline as jest.Mock).mockResolvedValue([
      {
        _id: getCreditDocId("ol1", "c1"),
        id: "c1",
        heading: "Speaker",
        text: "Jane Doe",
        docType: "credit",
      },
    ]);
    (getCreditUsageByList as jest.Mock).mockResolvedValue(
      new Map<string, string[]>([["c1", ["Sunday AM"]]]),
    );
  });

  it("loads and lists credits when open with db and outline", async () => {
    render(
      <ExistingCreditsDrawer
        isOpen
        onClose={jest.fn()}
        db={mockDb}
        outlineId="ol1"
        currentListIds={[]}
        isMobile={false}
      />,
    );

    await waitFor(() => {
      expect(getAllCreditDocsForOutline).toHaveBeenCalledWith(mockDb, "ol1");
    });

    expect(await screen.findByText("Speaker")).toBeInTheDocument();
    expect(screen.getByText(/Jane Doe/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to list" })).toBeInTheDocument();
  });

  it("dispatches addCredit when adding a credit not in the current list", async () => {
    const user = userEvent.setup();
    render(
      <ExistingCreditsDrawer
        isOpen
        onClose={jest.fn()}
        db={mockDb}
        outlineId="ol1"
        currentListIds={[]}
        isMobile={false}
      />,
    );

    await screen.findByRole("button", { name: "Add to list" });
    await user.click(screen.getByRole("button", { name: "Add to list" }));

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "credits/addCredit",
        payload: expect.objectContaining({
          id: "c1",
          heading: "Speaker",
        }),
      }),
    );
  });

  it("does not load when closed", () => {
    render(
      <ExistingCreditsDrawer
        isOpen={false}
        onClose={jest.fn()}
        db={mockDb}
        outlineId="ol1"
        currentListIds={[]}
        isMobile={false}
      />,
    );

    expect(getAllCreditDocsForOutline).not.toHaveBeenCalled();
  });
});
