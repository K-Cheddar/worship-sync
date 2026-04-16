import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { BoardControllerContent } from "./BoardController";
import { useBoardSync } from "../boards/BoardSyncContext";
import { useElectronWindows } from "../hooks/useElectronWindows";
import { useMediaQuery } from "../hooks/useMediaQuery";
import {
  createBoardAlias,
  deleteBoardAlias,
  hardResetBoardAlias,
  softResetBoardAlias,
  updateBoardAliasTitle,
  updateBoardPresentationFontScale,
  updateBoardPostHidden,
  updateBoardPostHighlighted,
} from "../boards/api";
import { ToastProvider } from "../context/toastContext";
import { GlobalInfoContext } from "../context/globalInfo";
import { createMockGlobalContext } from "../test/mocks";

jest.mock("../containers/Toolbar/ToolbarElements/UserSection", () => () => (
  <div>User</div>
));

jest.mock("../hooks/useElectronWindows", () => ({
  useElectronWindows: jest.fn(),
}));

jest.mock("../hooks/useMediaQuery", () => ({
  useMediaQuery: jest.fn(() => true),
}));

jest.mock("../boards/BoardSyncContext", () => ({
  useBoardSync: jest.fn(),
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock("../boards/api", () => ({
  createBoardAlias: jest.fn(),
  deleteBoardAlias: jest.fn(),
  hardResetBoardAlias: jest.fn(),
  softResetBoardAlias: jest.fn(),
  updateBoardAliasTitle: jest.fn(),
  updateBoardPresentationFontScale: jest.fn(),
  updateBoardPostHidden: jest.fn(),
  updateBoardPostHighlighted: jest.fn(),
}));

const mockCreateBoardAlias = jest.mocked(createBoardAlias);
const mockDeleteBoardAlias = jest.mocked(deleteBoardAlias);
const mockSoftResetBoardAlias = jest.mocked(softResetBoardAlias);
const mockUpdateBoardAliasTitle = jest.mocked(updateBoardAliasTitle);
const mockUpdateBoardPresentationFontScale = jest.mocked(updateBoardPresentationFontScale);
const mockUpdateBoardPostHidden = jest.mocked(updateBoardPostHidden);
const mockUpdateBoardPostHighlighted = jest.mocked(updateBoardPostHighlighted);
const mockUseBoardSync = jest.mocked(useBoardSync);
const mockUseElectronWindows = jest.mocked(useElectronWindows);
const mockUseMediaQuery = jest.mocked(useMediaQuery);
let mockBoardDb: any;

/** Board tools live in the right column on desktop (lg+); the mock uses desktop layout. */
const findBoardToolsPanel = () =>
  screen.findByRole(
    "complementary",
    { name: /board tools/i },
    { timeout: 15000 },
  );

const createMockBoardDb = () => {
  let aliasDoc = {
    _id: "alias:sunday",
    _rev: "1-a",
    type: "alias" as const,
    docType: "board-alias" as const,
    aliasId: "sunday",
    title: "Sunday Board",
    database: "test",
    currentBoardId: "board-current",
    history: ["board-old"],
    presentationFontScale: 1.1,
    createdAt: 1,
    updatedAt: 2,
  };

  const boardDocs: Record<string, any> = {
    "board-current": {
      _id: "board:board-current",
      _rev: "1-b",
      type: "board" as const,
      docType: "board" as const,
      id: "board-current",
      aliasId: "sunday",
      database: "test",
      createdAt: 10,
      archived: false,
    },
    "board-old": {
      _id: "board:board-old",
      _rev: "1-c",
      type: "board" as const,
      docType: "board" as const,
      id: "board-old",
      aliasId: "sunday",
      database: "test",
      createdAt: 5,
      archived: true,
    },
  };

  const postDocsByBoardId: Record<string, any[]> = {
    "board-current": [
      {
        _id: "post:board-current:1",
        _rev: "1-d",
        type: "post" as const,
        docType: "board-post" as const,
        id: "1",
        aliasId: "sunday",
        boardId: "board-current",
        database: "test",
        author: "Alex",
        text: "Visible question",
        timestamp: 20,
        hidden: false,
        highlighted: false,
      },
      {
        _id: "post:board-current:2",
        _rev: "1-e",
        type: "post" as const,
        docType: "board-post" as const,
        id: "2",
        aliasId: "sunday",
        boardId: "board-current",
        database: "test",
        author: "Jamie",
        text: "Earlier question",
        timestamp: 10,
        hidden: false,
        highlighted: false,
      },
    ],
    "board-old": [
      {
        _id: "post:board-old:1",
        _rev: "1-f",
        type: "post" as const,
        docType: "board-post" as const,
        id: "1",
        aliasId: "sunday",
        boardId: "board-old",
        database: "test",
        author: "Riley",
        text: "Archived session question",
        timestamp: 3,
        hidden: false,
        highlighted: false,
      },
    ],
  };
  const changeListeners: Array<() => void> = [];

  const db = {
    allDocs: jest.fn(async (options: any) => {
      if (options.startkey === "alias:" && options.endkey === "alias:\uffff") {
        return { rows: [{ doc: aliasDoc }] };
      }
      if (Array.isArray(options.keys)) {
        return {
          rows: options.keys.map((key: string) => {
            const boardId = key.replace("board:", "");
            return { doc: boardDocs[boardId] };
          }),
        };
      }

      const rangeKey = String(options.startkey);
      const boardId = rangeKey.replace(/^post:/, "").replace(/:$/, "").split(":")[0];
      return {
        rows: (postDocsByBoardId[boardId] || []).map((doc) => ({ doc })),
      };
    }),
    get: jest.fn(async (docId: string) => {
      if (docId === "alias:sunday") return aliasDoc;
      if (docId === "alias:new-board") {
        return {
          ...aliasDoc,
          _id: "alias:new-board",
          aliasId: "new-board",
          title: "New Board",
          currentBoardId: "board-new",
          history: [],
        };
      }
      throw new Error(`Unexpected doc lookup: ${docId}`);
    }),
    changes: jest.fn(() => ({
      on: jest.fn((eventName: string, callback: () => void) => {
        if (eventName === "change") {
          changeListeners.push(callback);
        }
        return {
          on: jest.fn().mockReturnThis(),
          cancel: jest.fn(),
        };
      }),
      cancel: jest.fn(),
    })),
    __setAliasDoc: (nextAliasDoc: any) => {
      aliasDoc = nextAliasDoc;
    },
    __setBoardDoc: (boardId: string, boardDoc: any) => {
      boardDocs[boardId] = boardDoc;
    },
    __setPosts: (boardId: string, posts: any[]) => {
      postDocsByBoardId[boardId] = posts;
    },
    __emitChange: () => {
      changeListeners.forEach((listener) => listener());
    },
  };

  return db as any;
};

describe("BoardControllerContent", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseMediaQuery.mockImplementation(() => true);
    localStorage.clear();
    mockBoardDb = createMockBoardDb();
    mockUseElectronWindows.mockReturnValue({
      isElectron: false,
      displays: [],
      windowStates: null,
      openWindow: jest.fn(),
      closeWindow: jest.fn(),
      focusWindow: jest.fn(),
      moveWindowToDisplay: jest.fn(),
      setDisplayPreference: jest.fn(),
    } as any);
    mockUseBoardSync.mockReturnValue({
      db: mockBoardDb,
      status: "connected",
      pullFromRemote: jest.fn(),
    } as any);
    mockCreateBoardAlias.mockResolvedValue({
      alias: {
        aliasId: "new-board",
        currentBoardId: "board-new",
      },
    } as any);
    mockDeleteBoardAlias.mockResolvedValue({ deletedAliasId: "sunday" } as any);
    mockSoftResetBoardAlias.mockResolvedValue({ deletedCount: 1 });
    mockUpdateBoardAliasTitle.mockResolvedValue({
      alias: { aliasId: "sunday", title: "Renamed Board" },
    } as any);
    mockUpdateBoardPresentationFontScale.mockResolvedValue({
      alias: { aliasId: "sunday", presentationFontScale: 1 },
    } as any);
    jest.mocked(hardResetBoardAlias).mockResolvedValue({
      alias: { currentBoardId: "board-new" },
    } as any);
    mockUpdateBoardPostHidden.mockResolvedValue({ post: {} as any });
    mockUpdateBoardPostHighlighted.mockResolvedValue({ post: {} as any });
  });

  const renderPage = () =>
    render(
      <MemoryRouter>
        <GlobalInfoContext.Provider
          value={createMockGlobalContext({ database: "test" }) as any}
        >
          <ToastProvider>
            <BoardControllerContent />
          </ToastProvider>
        </GlobalInfoContext.Provider>
      </MemoryRouter>,
    );

  const openBoardToolsSheetIfMobile = async (
    user: ReturnType<typeof userEvent.setup>,
  ) => {
    const mobileMore = screen.queryByRole("button", { name: /More board tools/i });
    if (mobileMore) {
      await user.click(mobileMore);
    } else {
      await findBoardToolsPanel();
    }
  };

  it(
    "creates boards and sends moderation actions to the board api",
    async () => {
      const user = userEvent.setup();
      renderPage();

      await findBoardToolsPanel();

      await user.click(screen.getAllByRole("button", { name: /^Hide$/i })[0]);
      expect(mockUpdateBoardPostHidden).toHaveBeenCalledWith(
        "post:board-current:2",
        true,
      );

      await user.click(screen.getAllByRole("button", { name: /^Highlight$/i })[0]);
      expect(mockUpdateBoardPostHighlighted).toHaveBeenCalledWith(
        "post:board-current:2",
        true,
      );

      await openBoardToolsSheetIfMobile(user);
      await user.click(
        await screen.findByRole("button", { name: /Reset presentation text size/i }),
      );
      expect(mockUpdateBoardPresentationFontScale).toHaveBeenCalledWith(
        "sunday",
        1,
      );

      await user.click(
        await screen.findByRole("button", { name: /Clear all posts/i }),
      );
      expect(mockSoftResetBoardAlias).toHaveBeenCalledWith("sunday");

      await user.keyboard("{Escape}");

      await user.type(screen.getByLabelText(/^Title/i), "New Board");
      expect(screen.getByText(/^new-board$/i)).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: /Create Discussion Board/i }));

      expect(mockCreateBoardAlias).toHaveBeenCalledWith({
        aliasId: "new-board",
        title: "New Board",
        database: "test",
      });
    },
    20000,
  );

  it("sorts moderator posts by timestamp ascending", async () => {
    renderPage();

    expect(await screen.findByText(/Earlier question/i)).toBeInTheDocument();

    const postTexts = screen.getAllByText(/question/i);
    expect(postTexts[0]).toHaveTextContent("Earlier question");
    expect(postTexts[1]).toHaveTextContent("Visible question");
  });

  it("stores the selected alias for the board display page", async () => {
    renderPage();

    await findBoardToolsPanel();

    expect(localStorage.getItem("worshipsyncBoardDisplayAliasId")).toBe(
      "sunday",
    );
  });

  it("opens the board display from the moderator menu", async () => {
    const user = userEvent.setup();
    const openSpy = jest.spyOn(window, "open").mockImplementation(() => null);
    renderPage();

    await findBoardToolsPanel();

    await user.click(screen.getByRole("button", { name: /Open menu/i }));
    await user.click(screen.getByRole("menuitem", { name: /Open Board/i }));

    expect(openSpy).toHaveBeenCalledWith(
      expect.stringContaining("#/boards/display"),
      "_board",
      "width=1280,height=720",
    );

    openSpy.mockRestore();
  });

  it("renames a discussion board without changing its alias", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: /Rename Sunday Board/i }));
    const dialog = await screen.findByRole("dialog", {
      name: /Rename discussion board/i,
    });

    const titleInput = within(dialog).getByLabelText(/^Title/i);
    await user.clear(titleInput);
    await user.type(titleInput, "Renamed Board");
    await user.click(within(dialog).getByRole("button", { name: /^Save$/i }));

    expect(mockUpdateBoardAliasTitle).toHaveBeenCalledWith(
      "sunday",
      "Renamed Board",
    );
    expect(await screen.findAllByText("Renamed Board")).toHaveLength(2);
    expect(screen.getByText("sunday")).toBeInTheDocument();
  });

  it("deletes a discussion board from the list", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: /Delete Sunday Board/i }));
    const dialog = await screen.findByRole("dialog", {
      name: /Delete discussion board/i,
    });
    await user.click(within(dialog).getByRole("button", { name: /Delete board/i }));

    expect(mockDeleteBoardAlias).toHaveBeenCalledWith("sunday");
    await screen.findByText(/No discussion boards yet/i);
  });

  it("keeps following the new current session after start new session", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText(/Earlier question/i);

    await openBoardToolsSheetIfMobile(user);
    await user.click(screen.getByRole("button", { name: /Start new session/i }));

    mockBoardDb.__setBoardDoc("board-new", {
      _id: "board:board-new",
      _rev: "1-new",
      type: "board",
      docType: "board",
      id: "board-new",
      aliasId: "sunday",
      database: "test",
      createdAt: 50,
      archived: false,
    });
    mockBoardDb.__setPosts("board-new", [
      {
        _id: "post:board-new:1",
        _rev: "1-new-post",
        type: "post",
        docType: "board-post",
        id: "1",
        aliasId: "sunday",
        boardId: "board-new",
        database: "test",
        author: "Taylor",
        text: "Brand new session post",
        timestamp: 55,
        hidden: false,
        highlighted: false,
      },
    ]);

    await act(async () => {
      mockBoardDb.__setAliasDoc({
        _id: "alias:sunday",
        _rev: "2-a",
        type: "alias",
        docType: "board-alias",
        aliasId: "sunday",
        title: "Sunday Board",
        database: "test",
        currentBoardId: "board-new",
        history: ["board-old", "board-current"],
        presentationFontScale: 1.1,
        createdAt: 1,
        updatedAt: 3,
      });
      mockBoardDb.__emitChange();
    });

    expect(await screen.findByText(/Brand new session post/i)).toBeInTheDocument();
    expect(screen.queryByText(/Earlier question/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Return to current session/i }),
    ).not.toBeInTheDocument();
  });

  it("hides Hide and Highlight on posts when viewing an earlier session", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findAllByRole("button", { name: /^Hide$/i })).toHaveLength(2);

    await openBoardToolsSheetIfMobile(user);
    await user.click(screen.getByLabelText(/Show posts from/i));
    await user.click(
      screen.getByRole("option", { name: /Earlier session:/i }),
    );

    expect(await screen.findByText(/Archived session question/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Hide$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Highlight$/i })).not.toBeInTheDocument();
  });
});
