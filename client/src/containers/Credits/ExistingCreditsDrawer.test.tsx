import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ExistingCreditsDrawer from "./ExistingCreditsDrawer";
import {
  getAllCreditDocsForOutline,
  getCreditUsageByList,
} from "../../utils/dbUtils";
import { getCreditDocId, getCreditsDocId } from "../../types";
import { broadcastCreditsUpdate } from "../../store/store";

jest.mock("../../store/store", () => ({
  __esModule: true,
  default: { getState: () => mockState },
  broadcastCreditsUpdate: jest.fn(),
}));

jest.mock("../../utils/dbUtils", () => ({
  getAllCreditDocsForOutline: jest.fn(),
  getCreditUsageByList: jest.fn(),
}));

const mockDispatch = jest.fn();
let mockGlobalDb: PouchDB.Database | undefined;

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
    color,
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    color?: string;
  }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={!children && color === "red" ? "Delete credit" : undefined}
    >
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
  default: ({ isOpen, onConfirm, confirmText }: {
    isOpen: boolean;
    onConfirm: () => void | Promise<void>;
    confirmText: string;
  }) => isOpen ? <button type="button" onClick={onConfirm}>{confirmText}</button> : null,
}));

jest.mock("../../context/controllerInfo", () => ({
  get globalDb() { return mockGlobalDb; },
}));

const mockState = {
  undoable: {
    present: {
      credits: { indexOwner: { database: "church-A", outlineId: "ol1" } },
      itemLists: {
        selectedList: { _id: "ol1", name: "Sunday AM" } as const,
      },
    },
  },
};

const makeMockDb = (name: string) => ({
  name,
  get: jest.fn(async (id: string) => id === getCreditDocId("ol1", "c1")
    ? { _id: id, _rev: "1-credit", id: "c1", heading: "Speaker", text: "Jane Doe" }
    : { _id: id, _rev: "1-index", creditIds: ["c1"] }),
  put: jest.fn(async () => ({ rev: "2-saved" })),
  remove: jest.fn(async () => ({ ok: true })),
});

type MockDb = ReturnType<typeof makeMockDb>;
let mockDb: MockDb;

describe("ExistingCreditsDrawer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb = makeMockDb("church-A");
    mockGlobalDb = mockDb as unknown as PouchDB.Database;
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
        db={mockDb as unknown as PouchDB.Database}
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
        db={mockDb as unknown as PouchDB.Database}
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
        db={mockDb as unknown as PouchDB.Database}
        outlineId="ol1"
        currentListIds={[]}
        isMobile={false}
      />,
    );

    expect(getAllCreditDocsForOutline).not.toHaveBeenCalled();
  });

  it("keeps a pending delete on its original church and suppresses its stale broadcast", async () => {
    const user = userEvent.setup();
    let resumeIndexRead!: (value: unknown) => void;
    const originalDb = mockDb;
    originalDb.get.mockImplementationOnce(() => new Promise(resolve => { resumeIndexRead = resolve; }) as never);
    const { rerender } = render(
      <ExistingCreditsDrawer
        isOpen
        onClose={jest.fn()}
        db={originalDb as unknown as PouchDB.Database}
        outlineId="ol1"
        currentListIds={["c1"]}
        isMobile={false}
      />,
    );
    await screen.findByRole("button", { name: "Add to list" });
    await user.click(screen.getByRole("button", { name: "Delete credit" }));
    await user.click(screen.getAllByRole("button", { name: "Delete credit" })[1]);
    await waitFor(() => expect(originalDb.get).toHaveBeenCalledTimes(1));

    const nextDb = makeMockDb("church-B");
    mockGlobalDb = nextDb as unknown as PouchDB.Database;
    rerender(
      <ExistingCreditsDrawer
        isOpen
        onClose={jest.fn()}
        db={nextDb as unknown as PouchDB.Database}
        outlineId="ol2"
        currentListIds={[]}
        isMobile={false}
      />,
    );
    resumeIndexRead({ _id: getCreditsDocId("ol1"), _rev: "1-index", creditIds: ["c1"] });

    await waitFor(() => expect(originalDb.remove).toHaveBeenCalledTimes(1));
    expect(originalDb.put).toHaveBeenCalledWith(expect.objectContaining({ creditIds: [] }));
    expect(nextDb.get).not.toHaveBeenCalled();
    expect(nextDb.put).not.toHaveBeenCalled();
    expect(broadcastCreditsUpdate).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "credits/deleteCredit" }));
  });
});
