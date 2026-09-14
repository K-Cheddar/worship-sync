import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import userEvent from "@testing-library/user-event";
import BoardStreamPanel from "./BoardStreamPanel";
import { GlobalInfoContext } from "../../context/globalInfo";
import { createMockGlobalContext } from "../../test/mocks";
import {
  fromLegacyPresentationShape,
  updateBoardPostStreamInfo,
} from "../../store/presentationSlice";

const mockDispatch = jest.fn();
const mockUseSyncedBoardPosts = jest.fn();
const mockUseBoardSync = jest.fn();
const mockUseBoardData = jest.fn();
const mockUseBoardEventStream = jest.fn();
const mockUseRestreamSession = jest.fn();
const mockDisplayWindow = jest.fn(() => (
  <div data-testid="display-window-preview" />
));

let mockState = {
  presentation: fromLegacyPresentationShape({ isStreamTransmitting: true }),
};

jest.mock("../../hooks", () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: (state: typeof mockState) => unknown) =>
    selector(mockState),
}));

jest.mock("../../boards/BoardSyncContext", () => ({
  __esModule: true,
  useBoardSync: (...args: unknown[]) => mockUseBoardSync(...args),
}));

jest.mock("../../boards/useSyncedBoard", () => ({
  useSyncedBoardPosts: (...args: unknown[]) => mockUseSyncedBoardPosts(...args),
}));

jest.mock("../../boards/useBoardData", () => ({
  useBoardData: (...args: unknown[]) => mockUseBoardData(...args),
}));

jest.mock("../../boards/useBoardEventStream", () => ({
  useBoardEventStream: (...args: unknown[]) => mockUseBoardEventStream(...args),
}));

jest.mock("../../boards/useRestreamSession", () => ({
  useRestreamSession: (...args: unknown[]) => mockUseRestreamSession(...args),
}));

jest.mock("../../boards/boardSyncDebug", () => ({
  debugBoardSync: jest.fn(),
}));

jest.mock("../../boards/boardUtils", () => {
  const actual = jest.requireActual("../../boards/boardUtils");
  return {
    ...actual,
    filterHighlightedBoardPosts: (posts: Array<{ highlighted?: boolean }>) =>
      posts.filter((post) => post.highlighted),
    getBoardAuthorNameColorClass: () => "text-cyan-100",
    getBoardAuthorNameHexColor: (post: {
      source?: string;
      authorId?: string;
    }) => {
      if (post.source === "restream") return "#ff0000";
      if (post.authorId) return "#00ff00";
      return "#e7e5e4";
    },
    getStoredBoardDisplayAliasId: () => "board-alias",
  };
});

jest.mock("../../components/DisplayWindow/DisplayWindow", () => ({
  __esModule: true,
  default: () => mockDisplayWindow(),
}));

const actualUseSyncedBoardPosts = jest.requireActual(
  "../../boards/useSyncedBoard",
).useSyncedBoardPosts as typeof import("../../boards/useSyncedBoard").useSyncedBoardPosts;

jest.mock("../../components/ColorField/ColorField", () => ({
  __esModule: true,
  default: () => <div data-testid="color-field" />,
}));

jest.mock("../../components/Input/Input", () => ({
  __esModule: true,
  default: ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: string | number;
    onChange?: (value: string) => void;
  }) => (
    <label>
      {label}
      <input
        aria-label={label}
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
      />
    </label>
  ),
}));

jest.mock("../../components/Button/Button", () => ({
  __esModule: true,
  default: ({
    children,
    onClick,
    disabled,
    type = "button",
    wrap: _wrap,
    ...props
  }: {
    children?: ReactNode;
    onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
    disabled?: boolean;
    type?: "button" | "submit" | "reset";
    wrap?: boolean;
  }) => (
    <button type={type} onClick={onClick} disabled={disabled} {...props}>
      {children}
    </button>
  ),
}));

jest.mock("../../components/ui/DropdownMenu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onSelect,
  }: {
    children: ReactNode;
    onSelect?: () => void;
  }) => (
    <button type="button" onClick={onSelect}>
      {children}
    </button>
  ),
}));

describe("BoardStreamPanel", () => {
  beforeEach(() => {
    mockDispatch.mockClear();
    mockUseBoardSync.mockReset();
    mockUseSyncedBoardPosts.mockReset();
    mockUseBoardData.mockReset();
    mockUseBoardEventStream.mockReset();
    mockDisplayWindow.mockClear();
    mockState = {
      presentation: fromLegacyPresentationShape({ isStreamTransmitting: true }),
    };

    mockUseSyncedBoardPosts.mockReturnValue({
      posts: [
        {
          _id: "board-2",
          author: "Board later",
          authorId: "author-2",
          text: "Board highlighted later",
          highlighted: true,
          timestamp: 200,
        },
        {
          _id: "board-1",
          author: "Board earlier",
          authorId: "author-1",
          text: "Board highlighted earlier",
          highlighted: true,
          timestamp: 100,
        },
        {
          _id: "board-hidden",
          author: "Not highlighted",
          text: "Should not show",
          highlighted: false,
          timestamp: 50,
        },
      ],
      hasLoadedOnce: true,
      error: "",
      connectionStatus: { status: "connected" },
      retryNow: jest.fn(),
    });

    mockUseRestreamSession.mockReturnValue({
      messages: [
        {
          id: "restream-1",
          author: "Restream author",
          text: "Restream highlighted",
          postedAt: 150,
          isHighlighted: true,
          hidden: false,
          kind: "viewer_message",
        },
        {
          id: "restream-hidden",
          author: "Hidden author",
          text: "Should not show",
          postedAt: 160,
          isHighlighted: true,
          hidden: true,
          kind: "viewer_message",
        },
        {
          id: "restream-reply",
          author: "Moderator",
          text: "Reply should not show",
          postedAt: 170,
          isHighlighted: true,
          hidden: false,
          kind: "moderator_reply",
        },
      ],
    });
  });

  it("merges highlighted board and restream posts, then sends selected post payload", () => {
    render(
      <GlobalInfoContext.Provider value={createMockGlobalContext() as any}>
        <BoardStreamPanel />
      </GlobalInfoContext.Provider>,
    );

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(screen.getByText("Restream")).toBeInTheDocument();
    expect(screen.queryByText("Should not show")).not.toBeInTheDocument();
    expect(screen.queryByText("Reply should not show")).not.toBeInTheDocument();

    const orderedTexts = rows.map((row) => {
      if (within(row).queryByText("Board highlighted earlier"))
        return "board-1";
      if (within(row).queryByText("Restream highlighted")) return "restream-1";
      if (within(row).queryByText("Board highlighted later")) return "board-2";
      return "unknown";
    });
    expect(orderedTexts).toEqual(["board-1", "restream-1", "board-2"]);

    const restreamRow = rows.find((row) =>
      within(row).queryByText("Restream highlighted"),
    );
    expect(restreamRow).toBeDefined();

    fireEvent.click(
      within(restreamRow as HTMLElement).getByRole("button", { name: "Send" }),
    );

    expect(mockDispatch).toHaveBeenCalledWith(
      updateBoardPostStreamInfo({
        outputIds: ["stream"],
        author: "Restream author",
        authorHexColor: "#ff0000",
        text: "Restream highlighted",
        backgroundColor: "#32353beb",
        fontSize: 1.8,
        duration: 8,
      }),
    );
  });

  it("moves the selected post controls into the shared detail column without sending", () => {
    const detailTarget = document.createElement("div");
    const onDetailRequested = jest.fn();

    render(
      <GlobalInfoContext.Provider value={createMockGlobalContext() as any}>
        <BoardStreamPanel
          detailTarget={detailTarget}
          isDetailActive
          onDetailRequested={onDetailRequested}
        />
      </GlobalInfoContext.Provider>,
    );

    expect(
      within(detailTarget).getByTestId("display-window-preview"),
    ).toBeTruthy();
    expect(mockDisplayWindow).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("Board highlighted earlier"));

    expect(onDetailRequested).toHaveBeenCalledTimes(1);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("renders a local replicated highlight without an HTTP posts refetch", async () => {
    const listeners: Array<(change: unknown) => void> = [];
    const initialPost = {
      _id: "post:board-current:1",
      type: "post",
      boardId: "board-current",
      text: "Local initial highlight",
      author: "Board author",
      timestamp: 1,
      hidden: false,
      highlighted: true,
    };
    const updatedPost = {
      ...initialPost,
      _id: "post:board-current:2",
      text: "Local replicated highlight",
      timestamp: 2,
    };
    const db = {
      get: jest.fn().mockResolvedValue({
        _id: "alias:board-alias",
        type: "alias",
        aliasId: "board-alias",
        currentBoardId: "board-current",
        history: [],
      }),
      allDocs: jest.fn().mockResolvedValue({ rows: [{ doc: initialPost }] }),
    };
    mockUseBoardSync.mockReturnValue({
      db,
      connectionStatus: { status: "connected", retryCount: 0 },
      subscribeToChanges: (listener: (change: unknown) => void) => {
        listeners.push(listener);
        return () => undefined;
      },
      retryNow: jest.fn(),
    });
    mockUseSyncedBoardPosts.mockImplementation((aliasId: string) =>
      actualUseSyncedBoardPosts(aliasId),
    );

    render(
      <GlobalInfoContext.Provider value={createMockGlobalContext() as any}>
        <BoardStreamPanel />
      </GlobalInfoContext.Provider>,
    );

    expect(await screen.findByText("Local initial highlight")).toBeInTheDocument();
    const allDocsCalls = db.allDocs.mock.calls.length;

    await act(async () => {
      listeners.forEach((listener) =>
        listener({ id: updatedPost._id, doc: updatedPost }),
      );
    });

    expect(
      await screen.findByText("Local replicated highlight"),
    ).toBeInTheDocument();
    expect(db.allDocs).toHaveBeenCalledTimes(allDocsCalls);
  });

  it("keeps the public API/SSE board path for guest overlay sessions", () => {
    mockUseBoardData.mockReturnValue({
      posts: [
        {
          _id: "public-post",
          author: "Guest board author",
          text: "Guest-visible highlight",
          timestamp: 1,
          hidden: false,
          highlighted: true,
        },
      ],
      hasLoadedOnce: true,
      connectionStatus: { status: "connected", retryCount: 0 },
      loadBoard: jest.fn(),
      loadPosts: jest.fn(),
    });

    render(
      <GlobalInfoContext.Provider
        value={createMockGlobalContext({ loginState: "guest" }) as any}
      >
        <BoardStreamPanel />
      </GlobalInfoContext.Provider>,
    );

    expect(screen.getByText("Guest-visible highlight")).toBeInTheDocument();
    expect(mockUseBoardData).toHaveBeenCalledWith("board-alias");
    expect(mockUseBoardEventStream).toHaveBeenCalledWith(
      "board-alias",
      expect.any(Function),
    );
    expect(mockUseSyncedBoardPosts).not.toHaveBeenCalled();
  });

  it("offers retry when authenticated board sync fails", async () => {
    const user = userEvent.setup();
    const retryNow = jest.fn();
    mockUseSyncedBoardPosts.mockReturnValue({
      posts: [],
      hasLoadedOnce: false,
      error: "Could not read the local board replica.",
      connectionStatus: { status: "failed", retryCount: 3 },
      retryNow,
    });

    render(
      <GlobalInfoContext.Provider value={createMockGlobalContext() as any}>
        <BoardStreamPanel />
      </GlobalInfoContext.Provider>,
    );

    expect(
      screen.getByText("Could not read the local board replica."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(retryNow).toHaveBeenCalledTimes(1);
  });

  it("offers sign-in when authenticated board sync is paused", async () => {
    const user = userEvent.setup();
    const logout = jest.fn().mockResolvedValue(undefined);
    mockUseSyncedBoardPosts.mockReturnValue({
      posts: [],
      hasLoadedOnce: true,
      error: "",
      connectionStatus: { status: "paused", retryCount: 0 },
      retryNow: jest.fn(),
    });

    render(
      <GlobalInfoContext.Provider
        value={createMockGlobalContext({ logout }) as any}
      >
        <BoardStreamPanel />
      </GlobalInfoContext.Provider>,
    );

    expect(
      screen.getByText(/Sign-in is required to load board highlights/i),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sign in again" }));
    expect(logout).toHaveBeenCalledTimes(1);
  });
});
