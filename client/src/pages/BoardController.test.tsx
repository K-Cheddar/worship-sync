/* eslint-disable testing-library/no-node-access -- Compare the decorative icon SVG directly to verify its identity. */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { BoardControllerContent } from "./BoardController";
import { useBoardSync } from "../boards/BoardSyncContext";
import { useElectronWindows } from "../hooks/useElectronWindows";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { ToastProvider } from "../context/toastContext";
import { GlobalInfoContext } from "../context/globalInfo";
import { createMockGlobalContext } from "../test/mocks";
import { useRestreamSession } from "../boards/useRestreamSession";
import { useYouTubeConnectionStatus } from "../boards/useYouTubeConnectionStatus";
import { useAboutChangelogMenu } from "../hooks/useAboutChangelogMenu";
import type { RootState } from "../store/store";
import { PAGE_APPEARANCES } from "./pageAppearances";
import { getLucideIconInnerMarkup } from "../test/lucideIconTestUtils";

jest.mock("../hooks", () => {
  const actual = jest.requireActual("../hooks") as typeof import("../hooks");
  const boardControllerTestState = {
    undoable: {
      past: [],
      present: {
        preferences: { scrollbarWidth: "thin" as const },
      },
      future: [],
    },
  } as unknown as RootState;
  return {
    ...actual,
    useSelector: (selector: (state: RootState) => unknown) =>
      selector(boardControllerTestState),
  };
});

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

jest.mock("../boards/useRestreamSession", () => ({
  useRestreamSession: jest.fn(),
}));

jest.mock("../boards/useYouTubeConnectionStatus", () => ({
  useYouTubeConnectionStatus: jest.fn(() => ({ connected: false, accountLabel: "" })),
}));

jest.mock("../hooks/useAboutChangelogMenu", () => ({
  useAboutChangelogMenu: jest.fn(),
}));

jest.mock("../boards/api", () => ({
  createBoardAlias: jest.fn(),
  createBoardPost: jest.fn(),
  disconnectRestream: jest.fn(),
  deleteBoardAlias: jest.fn(),
  hardResetBoardAlias: jest.fn(),
  keepCurrentRestreamSession: jest.fn(),
  resetRestreamSession: jest.fn(),
  softResetBoardAlias: jest.fn(),
  updateBoardAliasTitle: jest.fn(),
  updateBoardPresentationFontScale: jest.fn(),
  updateBoardPostHidden: jest.fn(),
  updateBoardPostHighlighted: jest.fn(),
  updateRestreamMessageHidden: jest.fn(),
  updateRestreamMessageHighlighted: jest.fn(),
  sendYouTubeLiveChatMessage: jest.fn(),
}));

const mockedBoardApi = jest.requireMock("../boards/api") as {
  createBoardAlias: jest.Mock;
  deleteBoardAlias: jest.Mock;
  hardResetBoardAlias: jest.Mock;
  keepCurrentRestreamSession: jest.Mock;
  resetRestreamSession: jest.Mock;
  softResetBoardAlias: jest.Mock;
  updateBoardAliasTitle: jest.Mock;
  updateBoardPresentationFontScale: jest.Mock;
  updateBoardPostHidden: jest.Mock;
  updateBoardPostHighlighted: jest.Mock;
  updateRestreamMessageHighlighted: jest.Mock;
  sendYouTubeLiveChatMessage: jest.Mock;
};

const mockCreateBoardAlias = mockedBoardApi.createBoardAlias;
const mockDeleteBoardAlias = mockedBoardApi.deleteBoardAlias;
const mockHardResetBoardAlias = mockedBoardApi.hardResetBoardAlias;
const mockKeepCurrentRestreamSession = mockedBoardApi.keepCurrentRestreamSession;
const mockResetRestreamSession = mockedBoardApi.resetRestreamSession;
const mockSoftResetBoardAlias = mockedBoardApi.softResetBoardAlias;
const mockUpdateBoardAliasTitle = mockedBoardApi.updateBoardAliasTitle;
const mockUpdateBoardPresentationFontScale =
  mockedBoardApi.updateBoardPresentationFontScale;
const mockUpdateBoardPostHidden = mockedBoardApi.updateBoardPostHidden;
const mockUpdateBoardPostHighlighted = mockedBoardApi.updateBoardPostHighlighted;
const mockUseBoardSync = jest.mocked(useBoardSync);
const mockUseRestreamSession = jest.mocked(useRestreamSession);
const mockUseYouTubeConnectionStatus = jest.mocked(useYouTubeConnectionStatus);
const mockUseAboutChangelogMenu = jest.mocked(useAboutChangelogMenu);
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
      createdAt: Date.now(),
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
      {
        _id: "post:board-current:3",
        _rev: "1-g",
        type: "post" as const,
        docType: "board-post" as const,
        id: "3",
        aliasId: "sunday",
        boardId: "board-current",
        database: "test",
        author: "Morgan",
        text: "Withdrawn message",
        timestamp: 25,
        hidden: false,
        highlighted: false,
        deleted: true,
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
  const changeListeners: Array<(change?: unknown) => void> = [];
  let deferNextPostLoad = false;
  const deferredPostLoadResolvers: Array<(result: unknown) => void> = [];

  const db = {
    allDocs: jest.fn(async (options: any) => {
      if (
        options.startkey === "alias:" &&
        typeof options.endkey === "string" &&
        options.endkey.startsWith("alias:")
      ) {
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
      const result = {
        rows: (postDocsByBoardId[boardId] || []).map((doc) => ({ doc })),
      };
      if (deferNextPostLoad) {
        deferNextPostLoad = false;
        return new Promise((resolve) => {
          deferredPostLoadResolvers.push(resolve);
        });
      }
      return result;
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
      if (docId.startsWith("board:")) {
        const board = boardDocs[docId.slice("board:".length)];
        if (board) return board;
      }
      throw new Error(`Unexpected doc lookup: ${docId}`);
    }),
    changes: jest.fn(() => ({
      on: jest.fn((eventName: string, callback: (change?: unknown) => void) => {
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
    __updatePost: (boardId: string, postId: string, patch: Record<string, unknown>) => {
      postDocsByBoardId[boardId] = (postDocsByBoardId[boardId] || []).map((post) =>
        post.id === postId ? { ...post, ...patch } : post,
      );
    },
    __deferNextPostLoad: () => {
      deferNextPostLoad = true;
    },
    __hasDeferredPostLoad: () => deferredPostLoadResolvers.length > 0,
    __resolveDeferredPostLoad: (result?: unknown) => {
      deferredPostLoadResolvers.shift()?.(
        result || { rows: (postDocsByBoardId["board-current"] || []).map((doc) => ({ doc })) },
      );
    },
    __emitChange: (change?: unknown) => {
      changeListeners.forEach((listener) => listener(change));
    },
  };

  return db as any;
};

describe("BoardControllerContent", () => {
  afterEach(() => {
    cleanup();
  });

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
    mockUseAboutChangelogMenu.mockReturnValue({
      aboutChangelogMenuItems: [],
      aboutChangelogModals: null,
      updateReadyVersion: "",
    });
    mockUseBoardSync.mockReturnValue({
      db: mockBoardDb,
      status: "connected",
      pullFromRemote: jest.fn(),
      subscribeToChanges: (listener: (change?: unknown) => void) => {
        const changes = mockBoardDb.changes();
        changes.on("change", listener);
        return () => changes.cancel();
      },
    } as any);
    mockUseRestreamSession.mockReturnValue({
      session: {
        churchId: "church-1",
        database: "test",
        sessionId: "restream-session-1",
        startedAt: Date.now(),
        messageCount: 0,
        enabled: false,
        connected: false,
        connectionState: "disconnected",
        accountLabel: "",
        lastError: "",
        platformSummary: [],
      },
      messages: [],
      isLoading: false,
      error: "",
      bestEffortOnly: true,
      oauthConfigured: true,
      isOffline: false,
      streamState: "connected",
      streamFailure: null,
      feedState: "pending",
      reload: jest.fn(() => Promise.resolve()),
    });
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
    mockHardResetBoardAlias.mockResolvedValue({
      alias: { currentBoardId: "board-new" },
    } as any);
    mockResetRestreamSession.mockResolvedValue({
      session: { sessionId: "restream-session-new" },
    } as any);
    mockUpdateBoardPostHidden.mockResolvedValue({ post: {} as any });
    mockUpdateBoardPostHighlighted.mockResolvedValue({ post: {} as any });
  });

  const pageElement = (
    options: {
      globalOverrides?: Record<string, unknown>;
    } = {},
  ) => (
      <MemoryRouter>
        <GlobalInfoContext.Provider
          value={
            createMockGlobalContext({
              database: "test",
              ...options.globalOverrides,
            }) as any
          }
        >
          <ToastProvider>
            <BoardControllerContent />
          </ToastProvider>
        </GlobalInfoContext.Provider>
      </MemoryRouter>
    );

  const renderPage = (options: { globalOverrides?: Record<string, unknown> } = {}) =>
    render(pageElement(options));

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

      const earlierQuestionArticle = screen
        .getAllByRole("article")
        .find((el) => within(el).queryByText(/Earlier question/i));
      expect(earlierQuestionArticle).toBeDefined();

      const articleContent = within(earlierQuestionArticle as HTMLElement);
      const message = articleContent.getByText("Earlier question");
      const hideAction = articleContent.getByRole("button", { name: /^Hide$/i });
      const highlightAction = articleContent.getByRole("button", { name: /^Highlight$/i });
      expect(message.compareDocumentPosition(hideAction) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(message.compareDocumentPosition(highlightAction) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

      await user.click(
        within(earlierQuestionArticle as HTMLElement).getByRole("button", {
          name: /^Highlight$/i,
        }),
      );
      await waitFor(() => {
        expect(
          within(earlierQuestionArticle as HTMLElement).getByRole("button", {
            name: /^Unhighlight$/i,
          }),
        ).toBeInTheDocument();
      });

      await user.click(
        within(earlierQuestionArticle as HTMLElement).getByRole("button", {
          name: /^Hide$/i,
        }),
      );
      await waitFor(() => {
        expect(
          within(earlierQuestionArticle as HTMLElement).getByRole("button", {
            name: /^Unhide$/i,
          }),
        ).toBeInTheDocument();
      });

      await openBoardToolsSheetIfMobile(user);
      await user.click(
        await screen.findByRole("button", { name: /Reset presentation text size/i }),
      );
      // The font-size control debounces the persist into a single write.
      await waitFor(() =>
        expect(mockUpdateBoardPresentationFontScale).toHaveBeenCalledWith(
          "sunday",
          1,
        ),
      );

      await user.click(
        await screen.findByRole("button", { name: /Clear all posts/i }),
      );
      expect(mockSoftResetBoardAlias).toHaveBeenCalledWith("sunday");

      await user.keyboard("{Escape}");

      await user.type(screen.getByLabelText(/^Title/i), "New Board");
      expect(screen.getByText(/^new-board$/i)).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: /Create Discussion Board/i }));

      await waitFor(() => {
        expect(mockCreateBoardAlias).toHaveBeenCalledWith({
          aliasId: "new-board",
          title: "New Board",
          database: "test",
        });
      });
    },
    20000,
  );

  it("places Restream message text before its one-tap Highlight action", async () => {
    const user = userEvent.setup();
    const longMessage = "Restream question content that should remain fully expanded. ".repeat(12);
    mockUseRestreamSession.mockReturnValue({
      session: {
        churchId: "church-1", database: "test", sessionId: "restream-session-1",
        startedAt: 100, messageCount: 1, enabled: true, connected: true,
        connectionState: "connected", accountLabel: "Main channel", lastError: "",
        platformSummary: ["YouTube: Main channel"],
      },
      messages: [{
        id: "restream-message-1", churchId: "church-1", database: "test",
        sessionId: "restream-session-1", platform: "YouTube",
        connectionIdentifier: "youtube-main", author: "Long named viewer",
        text: longMessage, postedAt: 30, receivedAt: 30,
        rawEventType: "message", kind: "viewer_message", isHighlighted: false,
        hidden: false,
      }],
      isLoading: false, error: "", bestEffortOnly: true, oauthConfigured: true,
      isOffline: false, streamState: "connected", streamFailure: null,
      feedState: "connected", reload: jest.fn(() => Promise.resolve()),
    } as any);
    renderPage();

    const article = await screen.findByRole("article", { name: /Restream.*YouTube/i });
    const message = within(article).getByText(/Restream question content that should remain fully expanded/);
    expect(message.textContent).toContain(longMessage.trim());
    const highlight = within(article).getByRole("button", { name: /^Highlight$/i });
    expect(message.compareDocumentPosition(highlight) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(article).queryByRole("button", { name: /Show more/i })).not.toBeInTheDocument();

    await user.click(highlight);
    await waitFor(() => {
      expect(mockedBoardApi.updateRestreamMessageHighlighted).toHaveBeenCalledWith(
        "church-1",
        "restream-message-1",
        true,
      );
    });
  });

  it("sorts moderator posts by timestamp ascending", async () => {
    renderPage();

    expect(await screen.findByText(/Earlier question/i)).toBeInTheDocument();

    const postTexts = screen.getAllByText(/question/i);
    expect(postTexts[0]).toHaveTextContent("Earlier question");
    expect(postTexts[1]).toHaveTextContent("Visible question");
  });

  it("disables Hide on posts the author deleted while moderating the current session", async () => {
    renderPage();

    await screen.findByText(/Withdrawn message/i);
    const article = screen
      .getAllByRole("article")
      .find((el) => within(el).queryByText(/Withdrawn message/i));
    expect(article).toBeDefined();
    expect(
      within(article as HTMLElement).getByRole("button", { name: /^Hide$/i }),
    ).toBeDisabled();
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

    await screen.findByRole("heading", { name: "Sunday Board" });

    await user.click(screen.getByRole("button", { name: /Open menu/i }));
    await user.click(await screen.findByRole("menuitem", { name: /Open Board/i }));

    expect(openSpy).toHaveBeenCalledWith(
      expect.stringContaining("#/boards/display"),
      "_board",
      "width=1280,height=720",
    );

    openSpy.mockRestore();
  });

  it("selecting a discussion board closes the mobile manage boards sheet", async () => {
    const user = userEvent.setup();
    mockUseMediaQuery.mockImplementation(() => false);
    renderPage();

    await screen.findByRole("button", { name: /Current board: Sunday Board/i });
    await user.click(screen.getByRole("button", { name: /Current board: Sunday Board/i }));
    await screen.findByRole("dialog", { name: "Manage boards" });

    const boardButtons = screen.getAllByTitle("Sunday Board (sunday)");
    await user.click(boardButtons[boardButtons.length - 1]);

    await waitFor(() => {
      expect(screen.getAllByTitle("Sunday Board (sunday)")).toHaveLength(1);
    });
    expect(screen.getByRole("button", { name: /Current board: Sunday Board/i })).toBeInTheDocument();
    expect(screen.getByText(/Session:/i)).toBeInTheDocument();
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
      mockBoardDb.__emitChange({
        id: "alias:sunday",
        doc: {
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
        },
      });
    });

    expect(await screen.findByText(/Brand new session post/i)).toBeInTheDocument();
    expect(screen.queryByText(/Earlier question/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Return to current session/i }),
    ).not.toBeInTheDocument();
  });

  it("does not let an older view load overwrite a newer alias change", async () => {
    renderPage();
    await screen.findByText(/Earlier question/i);

    mockBoardDb.__deferNextPostLoad();
    await act(async () => {
      mockBoardDb.__emitChange({
        id: "board:board-current",
      });
    });
    await waitFor(() =>
      expect(mockBoardDb.__hasDeferredPostLoad()).toBe(true),
    );

    const nextAlias = {
      _id: "alias:sunday",
      _rev: "2-a",
      type: "alias",
      docType: "board-alias",
      aliasId: "sunday",
      title: "Sunday Board",
      database: "test",
      currentBoardId: "board-new",
      history: ["board-current", "board-old"],
      presentationFontScale: 1.1,
      createdAt: 1,
      updatedAt: 3,
    };
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
        text: "Fresh board load",
        timestamp: 55,
        hidden: false,
        highlighted: false,
      },
    ]);
    mockBoardDb.__setAliasDoc(nextAlias);
    await act(async () => {
      mockBoardDb.__emitChange({ id: "alias:sunday", doc: nextAlias });
    });

    expect(await screen.findByText(/Fresh board load/i)).toBeInTheDocument();

    await act(async () => {
      mockBoardDb.__resolveDeferredPostLoad();
    });

    expect(screen.getByText(/Fresh board load/i)).toBeInTheDocument();
    expect(screen.queryByText(/Earlier question/i)).not.toBeInTheDocument();
  });

  it("offers a Restream-only reset when only Restream is stale", async () => {
    mockBoardDb.__setPosts("board-current", [
      {
        _id: "post:board-current:today",
        _rev: "1-today",
        type: "post",
        docType: "board-post",
        id: "today",
        aliasId: "sunday",
        boardId: "board-current",
        database: "test",
        author: "Alex",
        text: "Today's question",
        timestamp: Date.now(),
        hidden: false,
        highlighted: false,
      },
    ]);
    mockUseRestreamSession.mockReturnValue({
      session: {
        churchId: "church-1",
        database: "test",
        sessionId: "restream-session-old",
        startedAt: 100,
        lastMessageAt: 100,
        messageCount: 2,
        enabled: true,
        connected: true,
        connectionState: "connected",
        accountLabel: "Main channel",
        lastError: "",
        platformSummary: [],
      },
      messages: [],
      isLoading: false,
      error: "",
      bestEffortOnly: true,
      oauthConfigured: true,
      isOffline: false,
      streamState: "connected",
      streamFailure: null,
      feedState: "empty",
      reload: jest.fn(() => Promise.resolve()),
    });

    renderPage();

    await screen.findByRole("heading", { name: "Sunday Board" });
    const resetButton = await screen.findByRole("button", {
      name: /Start new Restream session/i,
    });
    expect(resetButton).toBeInTheDocument();
    expect(mockHardResetBoardAlias).not.toHaveBeenCalled();
    expect(mockResetRestreamSession).not.toHaveBeenCalled();
    const user = userEvent.setup();
    await user.click(resetButton);
    const dialog = await screen.findByRole("dialog", {
      name: /Start a new Restream session/i,
    });
    await user.click(within(dialog).getByRole("button", { name: /^Continue$/i }));
    await waitFor(() => expect(mockResetRestreamSession).toHaveBeenCalledTimes(1));
    expect(mockHardResetBoardAlias).not.toHaveBeenCalled();
  });

  it("resets only the board when it is stale and Restream has activity today", async () => {
    const user = userEvent.setup();
    mockBoardDb.__setBoardDoc("board-current", {
      _id: "board:board-current",
      _rev: "1-b",
      type: "board",
      docType: "board",
      id: "board-current",
      aliasId: "sunday",
      database: "test",
      createdAt: Date.now() - 5 * 24 * 60 * 60 * 1000,
      archived: false,
    });
    mockBoardDb.__setPosts("board-current", []);
    mockUseRestreamSession.mockReturnValue({
      session: {
        churchId: "church-1",
        database: "test",
        sessionId: "restream-session-today",
        startedAt: Date.now() - 5 * 24 * 60 * 60 * 1000,
        lastEventAt: Date.now(),
        messageCount: 1,
        enabled: true,
        connected: false,
        connectionState: "disconnected",
        accountLabel: "Main channel",
        lastError: "",
        platformSummary: [],
      },
      messages: [],
      isLoading: false,
      error: "",
      bestEffortOnly: true,
      oauthConfigured: true,
      isOffline: false,
      streamState: "disconnected",
      streamFailure: null,
      feedState: "empty",
      reload: jest.fn(() => Promise.resolve()),
    });

    renderPage();
    await user.click(
      await screen.findByRole("button", { name: /Start fresh for today/i }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: /Start a fresh discussion board/i,
    });
    expect(within(dialog).queryByText(/Restream chat starts a new session/i)).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: /^Continue$/i }));
    await waitFor(() => expect(mockHardResetBoardAlias).toHaveBeenCalledWith("sunday", "board-current"));
    expect(mockResetRestreamSession).not.toHaveBeenCalled();
  });

  it("confirms reset eligibility for a board created today with only earlier-day posts", async () => {
    const user = userEvent.setup();
    mockBoardDb.__setBoardDoc("board-current", {
      _id: "board:board-current", _rev: "1-b", type: "board", docType: "board",
      id: "board-current", aliasId: "sunday", database: "test", createdAt: Date.now(), archived: false,
    });
    mockBoardDb.__setPosts("board-current", [{
      _id: "post:board-current:old", _rev: "1-old", type: "post", docType: "board-post",
      id: "old", aliasId: "sunday", boardId: "board-current", database: "test",
      author: "Alex", text: "Earlier-day post", timestamp: Date.now() - 3 * 86400000,
      hidden: false, highlighted: false,
    }]);

    renderPage();
    await user.click(await screen.findByRole("button", { name: /Start fresh for today/i }));
    const dialog = await screen.findByRole("dialog", { name: /Start a fresh discussion board/i });
    await user.click(within(dialog).getByRole("button", { name: /^Continue$/i }));

    await waitFor(() => expect(mockHardResetBoardAlias).toHaveBeenCalledWith("sunday", "board-current"));
    expect(mockResetRestreamSession).not.toHaveBeenCalled();
  });

  it("validates both targets before a combined reset and preserves new board activity", async () => {
    const user = userEvent.setup();
    const yesterday = Date.now() - 3 * 86400000;
    mockBoardDb.__setBoardDoc("board-current", {
      _id: "board:board-current", _rev: "1-b", type: "board", docType: "board",
      id: "board-current", aliasId: "sunday", database: "test", createdAt: yesterday, archived: false,
    });
    mockBoardDb.__setPosts("board-current", []);
    mockUseRestreamSession.mockReturnValue({
      session: {
        churchId: "church-1", database: "test", sessionId: "restream-session-old",
        startedAt: yesterday, lastMessageAt: yesterday, messageCount: 1, enabled: true,
        connected: false, connectionState: "disconnected", accountLabel: "Main channel",
        lastError: "", platformSummary: [],
      },
      messages: [], isLoading: false, error: "", bestEffortOnly: true, oauthConfigured: true,
      isOffline: false, streamState: "disconnected", streamFailure: null, feedState: "empty",
      reload: jest.fn(() => Promise.resolve()),
    });

    renderPage();
    await user.click(await screen.findByRole("button", { name: /Start fresh for today/i }));
    const dialog = await screen.findByRole("dialog", { name: /Start fresh for today/i });
    mockBoardDb.__setPosts("board-current", [{
      _id: "post:board-current:today", _rev: "1-today", type: "post", docType: "board-post",
      id: "today", aliasId: "sunday", boardId: "board-current", database: "test",
      author: "Alex", text: "New activity", timestamp: Date.now(), hidden: false, highlighted: false,
    }]);
    await user.click(within(dialog).getByRole("button", { name: /^Start fresh$/i }));

    expect(await screen.findByText("The discussion board is no longer stale or has activity today, so it was left unchanged.")).toBeInTheDocument();
    expect(mockResetRestreamSession).not.toHaveBeenCalled();
    expect(mockHardResetBoardAlias).not.toHaveBeenCalled();
  });

  it("retries a combined reset without repeating the Restream reset after a board failure", async () => {
    const user = userEvent.setup();
    const yesterday = Date.now() - 3 * 86400000;
    mockBoardDb.__setBoardDoc("board-current", {
      _id: "board:board-current", _rev: "1-b", type: "board", docType: "board",
      id: "board-current", aliasId: "sunday", database: "test", createdAt: yesterday, archived: false,
    });
    mockBoardDb.__setPosts("board-current", []);
    mockUseRestreamSession.mockReturnValue({
      session: {
        churchId: "church-1", database: "test", sessionId: "restream-session-old",
        startedAt: yesterday, lastMessageAt: yesterday, messageCount: 1, enabled: true,
        connected: false, connectionState: "disconnected", accountLabel: "Main channel",
        lastError: "", platformSummary: [],
      },
      messages: [], isLoading: false, error: "", bestEffortOnly: true, oauthConfigured: true,
      isOffline: false, streamState: "disconnected", streamFailure: null, feedState: "empty",
      reload: jest.fn(() => Promise.resolve()),
    });
    mockHardResetBoardAlias.mockRejectedValueOnce(new Error("Board archive failed"));

    renderPage();
    await user.click(await screen.findByRole("button", { name: /Start fresh for today/i }));
    const dialog = await screen.findByRole("dialog", { name: /Start fresh for today/i });
    const confirm = within(dialog).getByRole("button", { name: /^Start fresh$/i });
    await user.click(confirm);
    expect(await screen.findByText("Board archive failed")).toBeInTheDocument();
    await user.click(confirm);

    await waitFor(() => expect(mockHardResetBoardAlias).toHaveBeenCalledTimes(2));
    expect(mockResetRestreamSession).toHaveBeenCalledTimes(1);
  });

  it("offers a board-only reset when Restream is authoritatively absent", async () => {
    const user = userEvent.setup();
    mockBoardDb.__setBoardDoc("board-current", {
      _id: "board:board-current",
      _rev: "1-b",
      type: "board",
      docType: "board",
      id: "board-current",
      aliasId: "sunday",
      database: "test",
      createdAt: Date.now() - 5 * 24 * 60 * 60 * 1000,
      archived: false,
    });
    mockBoardDb.__setPosts("board-current", []);
    mockUseRestreamSession.mockReturnValue({
      session: null,
      messages: [],
      isLoading: true,
      error: "",
      bestEffortOnly: true,
      oauthConfigured: true,
      isOffline: false,
      streamState: "disconnected",
      streamFailure: null,
      feedState: "empty",
      reload: jest.fn(() => Promise.resolve()),
    });

    const view = renderPage();
    await screen.findByRole("heading", { name: "Sunday Board" });
    expect(
      screen.queryByRole("button", { name: /Start fresh for today/i }),
    ).not.toBeInTheDocument();
    mockUseRestreamSession.mockReturnValue({
      session: null,
      messages: [],
      isLoading: false,
      error: "",
      bestEffortOnly: true,
      oauthConfigured: true,
      isOffline: false,
      streamState: "disconnected",
      streamFailure: null,
      feedState: "empty",
      reload: jest.fn(() => Promise.resolve()),
    });
    view.rerender(pageElement());
    await user.click(
      await screen.findByRole("button", { name: /Start fresh for today/i }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: /Start a fresh discussion board/i,
    });
    await user.click(within(dialog).getByRole("button", { name: /^Continue$/i }));

    await waitFor(() => expect(mockHardResetBoardAlias).toHaveBeenCalledWith("sunday", "board-current"));
    expect(mockResetRestreamSession).not.toHaveBeenCalled();
  });

  it("resumes a combined reset after Restream succeeds and the board reset fails", async () => {
    const user = userEvent.setup();
    const oldSessionAt = Date.now() - 5 * 24 * 60 * 60 * 1000;
    mockBoardDb.__setBoardDoc("board-current", {
      _id: "board:board-current",
      _rev: "1-b",
      type: "board",
      docType: "board",
      id: "board-current",
      aliasId: "sunday",
      database: "test",
      createdAt: oldSessionAt,
      archived: false,
    });
    mockBoardDb.__setPosts("board-current", []);
    let currentSessionId = "restream-session-old";
    const reloadRestream = jest.fn(async () => {
      currentSessionId = "restream-session-new";
    });
    mockUseRestreamSession.mockImplementation(() => ({
      session: {
        churchId: "church-1",
        database: "test",
        sessionId: currentSessionId,
        startedAt: currentSessionId === "restream-session-old" ? oldSessionAt : Date.now(),
        messageCount: 0,
        enabled: true,
        connected: false,
        connectionState: "disconnected",
        accountLabel: "Main channel",
        lastError: "",
        platformSummary: [],
      },
      messages: [],
      isLoading: false,
      isRefreshing: false,
      error: "",
      bestEffortOnly: true,
      oauthConfigured: true,
      isOffline: false,
      streamState: "disconnected",
      streamFailure: null,
      feedState: "empty",
      reload: reloadRestream,
    }));
    mockHardResetBoardAlias
      .mockRejectedValueOnce(new Error("Board archive failed"))
      .mockResolvedValueOnce(undefined);

    renderPage();
    await user.click(
      await screen.findByRole("button", { name: /Start fresh for today/i }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: /Start fresh for today/i,
    });
    const confirmButton = () =>
      within(dialog).getByRole("button", { name: /^Start fresh$/i });
    await user.click(confirmButton());

    expect(await screen.findByText("Board archive failed")).toBeInTheDocument();
    expect(mockResetRestreamSession).toHaveBeenCalledTimes(1);
    expect(mockHardResetBoardAlias).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("dialog", { name: /Start fresh for today/i })).toBeInTheDocument();

    await user.click(confirmButton());
    await waitFor(() => expect(mockHardResetBoardAlias).toHaveBeenCalledTimes(2));
    expect(mockResetRestreamSession).toHaveBeenCalledTimes(1);
  });

  it("preserves new board posts before retrying a partially completed reset", async () => {
    const user = userEvent.setup();
    const oldSessionAt = Date.now() - 5 * 24 * 60 * 60 * 1000;
    mockBoardDb.__setBoardDoc("board-current", {
      _id: "board:board-current",
      _rev: "1-b",
      type: "board",
      docType: "board",
      id: "board-current",
      aliasId: "sunday",
      database: "test",
      createdAt: oldSessionAt,
      archived: false,
    });
    mockBoardDb.__setPosts("board-current", []);
    const reloadRestream = jest.fn(() => Promise.resolve());
    mockUseRestreamSession.mockReturnValue({
      session: {
        churchId: "church-1",
        database: "test",
        sessionId: "restream-session-old",
        startedAt: oldSessionAt,
        messageCount: 0,
        enabled: true,
        connected: false,
        connectionState: "disconnected",
        accountLabel: "Main channel",
        lastError: "",
        platformSummary: [],
      },
      messages: [],
      isLoading: false,
      isRefreshing: false,
      error: "",
      bestEffortOnly: true,
      oauthConfigured: true,
      isOffline: false,
      streamState: "disconnected",
      streamFailure: null,
      feedState: "empty",
      reload: reloadRestream,
    });
    mockHardResetBoardAlias.mockRejectedValueOnce(new Error("Board archive failed"));

    renderPage();
    await user.click(
      await screen.findByRole("button", { name: /Start fresh for today/i }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: /Start fresh for today/i,
    });
    const confirmButton = () =>
      within(dialog).getByRole("button", { name: /^Start fresh$/i });
    await user.click(confirmButton());

    expect(await screen.findByText("Board archive failed")).toBeInTheDocument();
    expect(mockResetRestreamSession).toHaveBeenCalledTimes(1);
    expect(mockHardResetBoardAlias).toHaveBeenCalledTimes(1);

    mockBoardDb.__setPosts("board-current", [
      {
        _id: "post:board-current:today",
        _rev: "1-today",
        type: "post",
        docType: "board-post",
        id: "today",
        aliasId: "sunday",
        boardId: "board-current",
        database: "test",
        author: "Alex",
        text: "Today's question",
        timestamp: Date.now(),
        hidden: false,
        highlighted: false,
      },
    ]);
    await user.click(confirmButton());

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: /Start fresh for today/i }),
      ).not.toBeInTheDocument(),
    );
    expect(mockHardResetBoardAlias).toHaveBeenCalledTimes(1);
    expect(mockResetRestreamSession).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/discussion board.*activity today/i)).toBeInTheDocument();
  });

  it("remembers Keep current across visits for the same stale session identities", async () => {
    const user = userEvent.setup();
    mockBoardDb.__setBoardDoc("board-current", {
      _id: "board:board-current",
      _rev: "1-b",
      type: "board",
      docType: "board",
      id: "board-current",
      aliasId: "sunday",
      database: "test",
      createdAt: Date.now() - 5 * 24 * 60 * 60 * 1000,
      archived: false,
    });
    mockBoardDb.__setPosts("board-current", []);
    mockUseRestreamSession.mockReturnValue({
      session: {
        churchId: "church-1",
        database: "test",
        sessionId: "restream-session-kept",
        startedAt: Date.now() - 5 * 24 * 60 * 60 * 1000,
        messageCount: 0,
        enabled: true,
        connected: false,
        connectionState: "disconnected",
        accountLabel: "Main channel",
        lastError: "",
        platformSummary: [],
      },
      messages: [],
      isLoading: false,
      error: "",
      bestEffortOnly: true,
      oauthConfigured: true,
      isOffline: false,
      streamState: "disconnected",
      streamFailure: null,
      feedState: "empty",
      reload: jest.fn(() => Promise.resolve()),
    });

    const view = renderPage();
    await user.click(await screen.findByRole("button", { name: /Keep current session/i }));
    await waitFor(() => expect(mockKeepCurrentRestreamSession).toHaveBeenCalledWith("church-1"));
    await waitFor(() => expect(screen.queryByRole("status", { name: /session/i })).not.toBeInTheDocument());
    mockUseRestreamSession.mockReturnValue({
      session: {
        churchId: "church-1",
        database: "test",
        sessionId: "restream-session-kept",
        startedAt: Date.now() - 5 * 24 * 60 * 60 * 1000,
        lastEventAt: Date.now(),
        messageCount: 1,
        enabled: true,
        connected: false,
        connectionState: "disconnected",
        accountLabel: "Main channel",
        lastError: "",
        platformSummary: [],
      },
      messages: [],
      isLoading: false,
      error: "",
      bestEffortOnly: true,
      oauthConfigured: true,
      isOffline: false,
      streamState: "disconnected",
      streamFailure: null,
      feedState: "empty",
      reload: jest.fn(() => Promise.resolve()),
    });
    view.rerender(pageElement());
    expect(screen.queryByRole("status", { name: /session/i })).not.toBeInTheDocument();
    view.unmount();
    const { rerender: rerenderSecondView } = renderPage();
    await screen.findByRole("heading", { name: "Sunday Board" });
    expect(screen.queryByRole("button", { name: /Keep current session/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Start fresh for today/i })).not.toBeInTheDocument();

    mockUseRestreamSession.mockReturnValue({
      session: {
        churchId: "church-1",
        database: "test",
        sessionId: "restream-session-new",
        startedAt: Date.now() - 5 * 24 * 60 * 60 * 1000,
        messageCount: 0,
        enabled: true,
        connected: false,
        connectionState: "disconnected",
        accountLabel: "Main channel",
        lastError: "",
        platformSummary: [],
      },
      messages: [],
      isLoading: false,
      error: "",
      bestEffortOnly: true,
      oauthConfigured: true,
      isOffline: false,
      streamState: "disconnected",
      streamFailure: null,
      feedState: "empty",
      reload: jest.fn(() => Promise.resolve()),
    });
    rerenderSecondView(pageElement());
    expect(await screen.findByRole("button", { name: /Start new Restream session/i })).toBeInTheDocument();
  });

  it("waits for delayed PouchDB posts before evaluating an empty stale board", async () => {
    mockBoardDb.__setBoardDoc("board-current", {
      _id: "board:board-current",
      _rev: "1-b",
      type: "board",
      docType: "board",
      id: "board-current",
      aliasId: "sunday",
      database: "test",
      createdAt: Date.now() - 5 * 24 * 60 * 60 * 1000,
      archived: false,
    });
    mockBoardDb.__setPosts("board-current", []);
    mockBoardDb.__deferNextPostLoad();
    renderPage();
    await waitFor(() => expect(mockBoardDb.__hasDeferredPostLoad()).toBe(true));
    expect(screen.queryByRole("button", { name: /Start fresh for today/i })).not.toBeInTheDocument();
    await act(async () => mockBoardDb.__resolveDeferredPostLoad({ rows: [] }));
    expect(await screen.findByRole("button", { name: /Start fresh for today/i })).toBeInTheDocument();
  });

  it("shows one timestamped toast for an empty October 10 board and old Restream activity on October 15, then leaves a header recovery action when dismissed", async () => {
    const user = userEvent.setup();
    const oct10 = new Date(2026, 9, 10, 12).getTime();
    mockBoardDb.__setBoardDoc("board-current", {
      _id: "board:board-current",
      _rev: "1-b",
      type: "board",
      docType: "board",
      id: "board-current",
      aliasId: "sunday",
      database: "test",
      createdAt: oct10,
      archived: false,
    });
    mockBoardDb.__setPosts("board-current", []);
    mockUseRestreamSession.mockReturnValue({
      session: {
        churchId: "church-1",
        database: "test",
        sessionId: "restream-session-oct10",
        startedAt: oct10,
        lastMessageAt: oct10,
        messageCount: 2,
        enabled: true,
        connected: false,
        connectionState: "disconnected",
        accountLabel: "Main channel",
        lastError: "",
        platformSummary: [],
      },
      messages: [
        {
          _id: "restream-message-old",
          sessionId: "restream-session-oct10",
          author: "Restream viewer",
          postedAt: oct10,
          receivedAt: oct10,
          text: "Old Restream message",
        },
      ],
      isLoading: false,
      error: "",
      bestEffortOnly: true,
      oauthConfigured: true,
      isOffline: false,
      streamState: "disconnected",
      streamFailure: null,
      feedState: "ready",
      reload: jest.fn(() => Promise.resolve()),
    } as any);

    const view = renderPage();
    await screen.findByRole("heading", { name: "Sunday Board" });
    expect(
      await screen.findByText(
        "The discussion board created Oct 10 has no posts today. Restream started Oct 10 and has no activity today.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Keep current session/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Start fresh for today/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close toast" }));
    expect(await screen.findByRole("button", { name: "Start fresh" })).toBeInTheDocument();

    view.unmount();
    renderPage();
    await screen.findByRole("heading", { name: "Sunday Board" });
    expect(screen.getByRole("button", { name: "Start fresh" })).toBeInTheDocument();
    expect(
      screen.queryByText(/The discussion board created Oct 10/),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Start fresh" }));
    expect(
      await screen.findByRole("dialog", { name: /Start fresh for today/i }),
    ).toBeInTheDocument();
  });

  it("re-evaluates stale sessions after local midnight", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 9, 15, 23, 59, 40));
    try {
      mockBoardDb.__setBoardDoc("board-current", {
        _id: "board:board-current",
        _rev: "1-b",
        type: "board",
        docType: "board",
        id: "board-current",
        aliasId: "sunday",
        database: "test",
        createdAt: new Date(2026, 9, 10, 12).getTime(),
        archived: false,
      });
      mockBoardDb.__setPosts("board-current", []);
      mockUseRestreamSession.mockReturnValue({
        session: null,
        messages: [],
        isLoading: false,
        error: "",
        bestEffortOnly: true,
        oauthConfigured: true,
        isOffline: false,
        streamState: "disconnected",
        streamFailure: null,
        feedState: "empty",
        reload: jest.fn(() => Promise.resolve()),
      });
      renderPage();
      expect(
        await screen.findByRole("button", { name: /Start fresh for today/i }),
      ).toBeInTheDocument();

      await act(async () => {
        jest.advanceTimersByTime(20_100);
      });

      expect(
        screen.getByRole("button", { name: /Start fresh for today/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/The discussion board created Oct 10 has no posts today/),
      ).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  it("waits for Restream status refresh before suggesting a reset", async () => {
    const user = userEvent.setup();
    mockBoardDb.__setBoardDoc("board-current", {
      _id: "board:board-current",
      _rev: "1-b",
      type: "board",
      docType: "board",
      id: "board-current",
      aliasId: "sunday",
      database: "test",
      createdAt: Date.now() - 5 * 24 * 60 * 60 * 1000,
      archived: false,
    });
    mockBoardDb.__setPosts("board-current", []);
    const oldRestreamSession = {
      churchId: "church-1",
      database: "test",
      sessionId: "restream-session-refreshing",
      startedAt: Date.now() - 5 * 24 * 60 * 60 * 1000,
      messageCount: 0,
      enabled: true,
      connected: false,
      connectionState: "disconnected" as const,
      accountLabel: "Main channel",
      lastError: "",
      platformSummary: [],
    };
    let restreamIsLoading = true;
    let restreamIsRefreshing = false;
    let restreamHasActivityToday = false;
    mockUseRestreamSession.mockImplementation(() => ({
      session: {
        ...oldRestreamSession,
        lastEventAt: restreamHasActivityToday ? Date.now() : undefined,
      },
      messages: [],
      isLoading: restreamIsLoading,
      isRefreshing: restreamIsRefreshing,
      error: "",
      bestEffortOnly: true,
      oauthConfigured: true,
      isOffline: false,
      streamState: "disconnected",
      streamFailure: null,
      feedState: restreamIsLoading ? "pending" : "empty",
      reload: jest.fn(() => Promise.resolve()),
    }));

    const view = renderPage();
    await screen.findByRole("heading", { name: "Sunday Board" });
    expect(screen.queryByRole("button", { name: /Start fresh for today/i })).not.toBeInTheDocument();

    restreamIsLoading = false;
    view.rerender(pageElement());
    expect(await screen.findByRole("button", { name: /Start fresh for today/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Start fresh for today/i }));
    expect(await screen.findByRole("dialog", { name: /Start fresh for today/i })).toBeInTheDocument();

    restreamIsRefreshing = true;
    view.rerender(pageElement());
    expect(screen.getByRole("dialog", { name: /Start fresh for today/i })).toBeInTheDocument();

    restreamHasActivityToday = true;
    view.rerender(pageElement());
    expect(screen.getByRole("dialog", { name: /Start fresh for today/i })).toBeInTheDocument();

    restreamIsRefreshing = false;
    view.rerender(pageElement());
    expect(screen.queryByRole("dialog", { name: /Start fresh for today/i })).not.toBeInTheDocument();
  });

  it("waits for board sync to connect before suggesting a reset", async () => {
    mockBoardDb.__setBoardDoc("board-current", {
      _id: "board:board-current",
      _rev: "1-b",
      type: "board",
      docType: "board",
      id: "board-current",
      aliasId: "sunday",
      database: "test",
      createdAt: Date.now() - 5 * 24 * 60 * 60 * 1000,
      archived: false,
    });
    mockBoardDb.__setPosts("board-current", []);
    const boardSync = {
      db: mockBoardDb,
      status: "retrying",
      pullFromRemote: jest.fn(),
      subscribeToChanges: (listener: (change?: unknown) => void) => {
        const changes = mockBoardDb.changes();
        changes.on("change", listener);
        return () => changes.cancel();
      },
    };
    mockUseBoardSync.mockReturnValue(boardSync as any);
    const view = renderPage();
    await screen.findByRole("heading", { name: "Sunday Board" });
    expect(screen.queryByRole("button", { name: /Start fresh for today/i })).not.toBeInTheDocument();

    mockUseBoardSync.mockReturnValue({ ...boardSync, status: "connected" } as any);
    view.rerender(pageElement());
    expect(await screen.findByRole("button", { name: /Start fresh for today/i })).toBeInTheDocument();
  });

  it("removes the current-session suggestion when switching to an archived board", async () => {
    const user = userEvent.setup();
    mockBoardDb.__setBoardDoc("board-current", {
      _id: "board:board-current",
      _rev: "1-b",
      type: "board",
      docType: "board",
      id: "board-current",
      aliasId: "sunday",
      database: "test",
      createdAt: Date.now() - 5 * 24 * 60 * 60 * 1000,
      archived: false,
    });
    mockBoardDb.__setPosts("board-current", []);
    renderPage();
    await user.click(
      await screen.findByRole("button", { name: /Start fresh for today/i }),
    );
    const confirmation = await screen.findByRole("dialog", {
      name: /Start a fresh discussion board/i,
    });
    await user.click(within(confirmation).getByRole("button", { name: "Cancel" }));
    await openBoardToolsSheetIfMobile(user);
    await user.click(screen.getByLabelText(/Show posts from/i));
    await user.click(screen.getByRole("option", { name: /Earlier session:/i }));
    await screen.findByText(/Archived session question/i);
    expect(screen.queryByRole("button", { name: /Start fresh for today/i })).not.toBeInTheDocument();
  });

  it("keeps the actionable stale-session toast on mobile without an inline duplicate", async () => {
    mockUseMediaQuery.mockReturnValue(false);
    renderPage();

    expect(
      await screen.findByRole("button", { name: /Start fresh for today/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Keep current session/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Earlier-day comments are still in this board."),
    ).not.toBeInTheDocument();
  });

  it("remembers Keep current for the same board session and day after remount", async () => {
    const user = userEvent.setup();
    const { unmount } = renderPage();

    await user.click(
      await screen.findByRole("button", { name: /Keep current session/i }),
    );
    expect(
      screen.queryByRole("button", { name: /Start fresh for today/i }),
    ).not.toBeInTheDocument();

    unmount();
    renderPage();
    await screen.findByText("Visible question");
    expect(
      screen.queryByRole("button", { name: /Start fresh for today/i }),
    ).not.toBeInTheDocument();
  });

  it("resets both the discussion board and Restream when the operator starts fresh", async () => {
    const user = userEvent.setup();
    mockBoardDb.__setBoardDoc("board-current", {
      _id: "board:board-current",
      _rev: "1-b",
      type: "board",
      docType: "board",
      id: "board-current",
      aliasId: "sunday",
      database: "test",
      createdAt: Date.now() - 5 * 24 * 60 * 60 * 1000,
      archived: false,
    });
    mockBoardDb.__setPosts("board-current", []);
    const oldSessionAt = Date.now() - 5 * 24 * 60 * 60 * 1000;
    const reloadRestream = jest.fn(() => Promise.resolve());
    let resolveResetRestream: ((value: unknown) => void) | undefined;
    mockResetRestreamSession.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveResetRestream = resolve;
        }),
    );
    mockUseRestreamSession.mockReturnValue({
      session: {
        churchId: "church-1",
        database: "test",
        sessionId: "restream-session-old",
        startedAt: oldSessionAt,
        lastMessageAt: oldSessionAt,
        messageCount: 2,
        enabled: true,
        connected: false,
        connectionState: "disconnected",
        accountLabel: "Main channel",
        lastError: "",
        platformSummary: [],
      },
      messages: [
        {
          id: "old-message",
          churchId: "church-1",
          database: "test",
          sessionId: "restream-session-old",
          platform: "YouTube",
          connectionIdentifier: "connection-1",
          author: "Viewer",
          text: "Old Restream message",
          postedAt: oldSessionAt,
          receivedAt: oldSessionAt,
          rawEventType: "message",
          kind: "viewer_message",
          isHighlighted: false,
          hidden: false,
        },
      ],
      isLoading: false,
      error: "",
      bestEffortOnly: true,
      oauthConfigured: true,
      isOffline: false,
      streamState: "connected",
      streamFailure: null,
      feedState: "empty",
      reload: reloadRestream,
    });

    renderPage();

    await user.click(
      await screen.findByRole("button", { name: /Start fresh for today/i }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: /Start fresh for today/i,
    });
    expect(
      within(dialog).getByText(/Earlier Restream chat is cleared/i),
    ).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: /^Start fresh$/i }),
    );

    const pendingButton = within(dialog).getByRole("button", {
      name: /Starting fresh\.\.\./i,
    });
    expect(pendingButton).toBeDisabled();
    expect(pendingButton).toHaveAttribute("aria-busy", "true");
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();

    await user.click(pendingButton);
    expect(mockResetRestreamSession).toHaveBeenCalledTimes(1);

    resolveResetRestream?.({ session: { sessionId: "restream-session-new" } });
    await waitFor(() => expect(reloadRestream).toHaveBeenCalled());
    expect(
      screen.queryByRole("dialog", { name: /Start fresh for today/i }),
    ).not.toBeInTheDocument();
    expect(mockResetRestreamSession).toHaveBeenCalledWith("church-1", {
      sessionId: "restream-session-old",
      startedAt: oldSessionAt,
      lastEventAt: undefined,
      messageCount: 2,
    });
    expect(mockHardResetBoardAlias).toHaveBeenCalledWith("sunday", "board-current");
  });

  it("closes a combined reset confirmation when Restream becomes active", async () => {
    const user = userEvent.setup();
    mockBoardDb.__setBoardDoc("board-current", {
      _id: "board:board-current",
      _rev: "1-b",
      type: "board",
      docType: "board",
      id: "board-current",
      aliasId: "sunday",
      database: "test",
      createdAt: Date.now() - 5 * 24 * 60 * 60 * 1000,
      archived: false,
    });
    mockBoardDb.__setPosts("board-current", []);
    const staleSession = {
      churchId: "church-1",
      database: "test",
      sessionId: "restream-session-stale",
      startedAt: Date.now() - 5 * 24 * 60 * 60 * 1000,
      messageCount: 0,
      enabled: true,
      connected: false,
      connectionState: "disconnected" as const,
      accountLabel: "Main channel",
      lastError: "",
      platformSummary: [],
    };
    mockUseRestreamSession.mockReturnValue({
      session: staleSession,
      messages: [],
      isLoading: false,
      error: "",
      bestEffortOnly: true,
      oauthConfigured: true,
      isOffline: false,
      streamState: "disconnected",
      streamFailure: null,
      feedState: "empty",
      reload: jest.fn(() => Promise.resolve()),
    });

    const view = renderPage();
    await user.click(
      await screen.findByRole("button", { name: /Start fresh for today/i }),
    );
    expect(await screen.findByRole("dialog", { name: /Start fresh for today/i })).toBeInTheDocument();

    mockUseRestreamSession.mockReturnValue({
      session: { ...staleSession, lastEventAt: Date.now() },
      messages: [],
      isLoading: false,
      error: "",
      bestEffortOnly: true,
      oauthConfigured: true,
      isOffline: false,
      streamState: "connected",
      streamFailure: null,
      feedState: "empty",
      reload: jest.fn(() => Promise.resolve()),
    });
    view.rerender(pageElement());
    expect(screen.queryByRole("dialog", { name: /Start fresh for today/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Start fresh for today/i, hidden: true })).toBeInTheDocument();
    expect(mockResetRestreamSession).not.toHaveBeenCalled();
  });

  it("restores the Start Fresh confirmation after the operation fails", async () => {
    const user = userEvent.setup();
    mockBoardDb.__setBoardDoc("board-current", {
      _id: "board:board-current",
      _rev: "1-b",
      type: "board",
      docType: "board",
      id: "board-current",
      aliasId: "sunday",
      database: "test",
      createdAt: Date.now() - 5 * 24 * 60 * 60 * 1000,
      archived: false,
    });
    mockBoardDb.__setPosts("board-current", []);
    mockUseRestreamSession.mockReturnValue({
      session: {
        churchId: "church-1",
        database: "test",
        sessionId: "restream-session-old",
        startedAt: Date.now() - 5 * 24 * 60 * 60 * 1000,
        messageCount: 0,
        enabled: true,
        connected: false,
        connectionState: "disconnected",
        accountLabel: "Main channel",
        lastError: "",
        platformSummary: [],
      },
      messages: [],
      isLoading: false,
      error: "",
      bestEffortOnly: true,
      oauthConfigured: true,
      isOffline: false,
      streamState: "disconnected",
      streamFailure: null,
      feedState: "empty",
      reload: jest.fn(() => Promise.resolve()),
    });
    mockResetRestreamSession.mockRejectedValueOnce(
      new Error("Restream is unavailable"),
    );

    renderPage();

    await user.click(
      await screen.findByRole("button", { name: /Start fresh for today/i }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: /Start fresh for today/i,
    });
    await user.click(
      within(dialog).getByRole("button", { name: /^Start fresh$/i }),
    );

    await waitFor(() => {
      expect(
        within(dialog).getByRole("button", { name: /^Start fresh$/i }),
      ).not.toBeDisabled();
    });
    expect(screen.getByText("Restream is unavailable")).toBeInTheDocument();
    expect(mockHardResetBoardAlias).not.toHaveBeenCalled();
  });

  it("ignores a stale-session toast action after switching to an earlier board session", async () => {
    const user = userEvent.setup();
    renderPage();

    const staleToastAction = await screen.findByRole("button", {
      name: /Start fresh for today/i,
    });
    await openBoardToolsSheetIfMobile(user);
    await user.click(screen.getByLabelText(/Show posts from/i));
    await user.click(screen.getByRole("option", { name: /Earlier session:/i }));

    await user.click(staleToastAction);

    expect(
      screen.queryByRole("dialog", { name: /Start fresh for today/i }),
    ).not.toBeInTheDocument();
    expect(mockResetRestreamSession).not.toHaveBeenCalled();
    expect(mockHardResetBoardAlias).not.toHaveBeenCalled();
  });

  it("hides Hide and Highlight on posts when viewing an earlier session", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole("heading", { name: "Sunday Board" });
    expect(await screen.findAllByRole("button", { name: /^Hide$/i })).toHaveLength(3);

    await openBoardToolsSheetIfMobile(user);
    await user.click(screen.getByLabelText(/Show posts from/i));
    await user.click(
      screen.getByRole("option", { name: /Earlier session:/i }),
    );

    expect(await screen.findByText(/Archived session question/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Hide$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Highlight$/i })).not.toBeInTheDocument();
  });

  it("keeps the presentation highlight count tied to the current board while viewing an earlier session", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole("heading", { name: "Sunday Board" });
    expect(await screen.findByText(/0 highlighted/i)).toBeInTheDocument();

    await openBoardToolsSheetIfMobile(user);
    await user.click(screen.getByLabelText(/Show posts from/i));
    await user.click(
      screen.getByRole("option", { name: /Earlier session:/i }),
    );
    expect(await screen.findByText(/Archived session question/i)).toBeInTheDocument();

    await act(async () => {
      mockBoardDb.__updatePost("board-current", "2", { highlighted: true });
      mockBoardDb.__emitChange({
        id: "post:board-current:2",
        doc: {
          _id: "post:board-current:2",
          boardId: "board-current",
          highlighted: true,
        },
      });
    });

    expect(await screen.findByText(/1 highlighted/i)).toBeInTheDocument();
  });

  it("ignores unrelated PouchDB document changes without reloading board state", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Sunday Board" });
    expect(await screen.findByText(/Earlier question/i)).toBeInTheDocument();

    const allDocsCallsAfterLoad = mockBoardDb.allDocs.mock.calls.length;

    await act(async () => {
      mockBoardDb.__emitChange({ id: "item:song-unrelated" });
      mockBoardDb.__emitChange({ id: "media:video-unrelated" });
    });

    expect(mockBoardDb.allDocs.mock.calls.length).toBe(allDocsCallsAfterLoad);
    expect(screen.getByText(/Earlier question/i)).toBeInTheDocument();
  });

  it("renders Restream connection guidance in the live activity feed", async () => {
    renderPage();

    await screen.findByRole("heading", { name: "Sunday Board" });

    expect(
      await screen.findByText(/Restream is not connected/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Ask a church admin to connect Restream/i),
    ).toBeInTheDocument();
  });

  it("orders labeled Restream and board activity by timestamp", async () => {
    mockUseRestreamSession.mockReturnValue({
      session: {
        churchId: "church-1",
        database: "test",
        sessionId: "restream-session-1",
        startedAt: 100,
        messageCount: 1,
        enabled: true,
        connected: true,
        connectionState: "connected",
        accountLabel: "Main channel",
        streamTitle: "Sabbath School Weekly",
        lastError: "",
        platformSummary: ["YouTube: Main channel"],
      },
      messages: [
        {
          id: "restream-1",
          churchId: "church-1",
          database: "test",
          sessionId: "restream-session-1",
          platform: "YouTube",
          connectionIdentifier: "conn-1",
          author: "Evan",
          authorAvatarUrl: "",
          text: "Hello from chat",
          postedAt: 15,
          receivedAt: 15,
          rawEventType: "5",
          kind: "viewer_message",
          isHighlighted: false,
          hidden: false,
        },
      ],
      isLoading: false,
      error: "",
      bestEffortOnly: true,
      oauthConfigured: true,
      isOffline: false,
      streamState: "connected",
      streamFailure: null,
      feedState: "has_messages",
      reload: jest.fn(() => Promise.resolve()),
    });

    renderPage();

    await screen.findByRole("heading", { name: "Sunday Board" });

    expect(await screen.findByText(/Stream name:/i)).toBeInTheDocument();
    expect(screen.getByText("Sabbath School Weekly")).toBeInTheDocument();
    expect(screen.getByText("RE")).toBeInTheDocument();
    expect(screen.getAllByText("DB")).toHaveLength(3);

    const [first, second] = screen.getAllByRole("article");
    expect(within(first).getByText("Earlier question")).toBeInTheDocument();
    expect(within(second).getByText("Hello from chat")).toBeInTheDocument();
  });

  it("keeps the discussion board composer available beside live chat", async () => {
    mockUseRestreamSession.mockReturnValue({
      session: {
        churchId: "church-1",
        database: "test",
        sessionId: "restream-session-1",
        startedAt: 100,
        messageCount: 0,
        enabled: true,
        connected: true,
        connectionState: "connected",
        accountLabel: "Main channel",
        streamTitle: "",
        lastError: "",
        platformSummary: ["YouTube: Main channel"],
      },
      messages: [],
      isLoading: false,
      error: "",
      bestEffortOnly: true,
      oauthConfigured: true,
      isOffline: false,
      streamState: "connected",
      streamFailure: null,
      feedState: "empty",
      reload: jest.fn(() => Promise.resolve()),
    });

    renderPage();

    await screen.findByRole("heading", { name: "Sunday Board" });

    expect(
      screen.getByRole("button", {
        name: "Board post",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", {
        name: /Add to discussion board/i,
      }),
    ).not.toBeInTheDocument();
  });

  it("uses the compact mobile context, opens Board Tools directly, and retains destination drafts", async () => {
    const user = userEvent.setup();
    mockUseMediaQuery.mockReturnValue(false);
    mockUseRestreamSession.mockReturnValue({
      session: {
        churchId: "church-1", database: "test", sessionId: "restream-session-1",
        startedAt: 100, messageCount: 0, enabled: true, connected: true,
        connectionState: "connected", accountLabel: "Main channel", streamTitle: "",
        lastError: "", platformSummary: [],
      },
      messages: [], isLoading: false, error: "", bestEffortOnly: true,
      oauthConfigured: true, isOffline: false, streamState: "connected",
      streamFailure: null, feedState: "empty", reload: jest.fn(() => Promise.resolve()),
    } as any);
    mockUseYouTubeConnectionStatus.mockReturnValue({ connected: true, accountLabel: "Main channel" });
    renderPage({ globalOverrides: { churchIntegrations: { youtube: { connected: true, accountLabel: "Main channel" } } } });

    expect(await screen.findByRole("button", { name: /Current board: Sunday Board/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Discussion Board" })).toHaveClass("hidden");
    expect(screen.getByRole("region", { name: "Live activity feed" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Board post" }));
    const boardDraft = await screen.findByRole("textbox", { name: /Add to discussion board/i });
    await user.type(boardDraft, "Keep this board draft");
    await user.click(screen.getByRole("button", { name: "YouTube chat" }));
    const youtubeDraft = await screen.findByPlaceholderText("Write a message as the connected channel…");
    await user.type(youtubeDraft, "Keep this YouTube draft");
    await user.click(screen.getByRole("button", { name: "Board post" }));
    expect(await screen.findByRole("textbox", { name: /Add to discussion board/i })).toHaveValue("Keep this board draft");
    await user.click(screen.getByRole("button", { name: "YouTube chat" }));
    expect(await screen.findByPlaceholderText("Write a message as the connected channel…")).toHaveValue("Keep this YouTube draft");
    await user.click(screen.getByRole("button", { name: "Board tools" }));
    expect(await screen.findByRole("dialog", { name: "Board tools" })).toBeInTheDocument();
  });

  it("keeps the selected composer open when a pending YouTube send finishes after switching", async () => {
    const user = userEvent.setup();
    mockUseMediaQuery.mockReturnValue(false);
    mockUseYouTubeConnectionStatus.mockReturnValue({ connected: true, accountLabel: "Main channel" });
    let resolveSend: ((value: unknown) => void) | undefined;
    mockedBoardApi.sendYouTubeLiveChatMessage.mockImplementation(
      () => new Promise((resolve) => { resolveSend = resolve; }),
    );
    renderPage({ globalOverrides: { churchIntegrations: { youtube: { connected: true, accountLabel: "Main channel" } } } });

    await user.click(await screen.findByRole("button", { name: "YouTube chat" }));
    await user.type(screen.getByRole("textbox", { name: /YouTube live chat message/i }), "Hello live");
    await user.click(screen.getByRole("button", { name: "Send to YouTube" }));
    expect(mockedBoardApi.sendYouTubeLiveChatMessage).toHaveBeenCalledWith("church-1", {
      messageText: "Hello live",
    });

    await user.click(screen.getByRole("button", { name: "Board post" }));
    expect(screen.getByRole("textbox", { name: /Add to discussion board/i })).toBeVisible();
    await act(async () => {
      resolveSend?.({ success: true, messageId: "message-1", liveChatId: "chat-1" });
    });

    expect(screen.getByRole("textbox", { name: /Add to discussion board/i })).toBeVisible();
    expect(screen.queryByRole("textbox", { name: /YouTube live chat message/i })).not.toBeInTheDocument();
    expect(await screen.findByText("Message sent to YouTube live chat.")).toBeInTheDocument();
  });

  it("keeps and reports a YouTube failure after switching destinations", async () => {
    const user = userEvent.setup();
    let rejectSend: ((reason: Error) => void) | undefined;
    mockedBoardApi.sendYouTubeLiveChatMessage.mockImplementation(
      () => new Promise((_resolve, reject) => { rejectSend = reject; }),
    );
    renderPage({ globalOverrides: { churchIntegrations: { youtube: { connected: true, accountLabel: "Main channel" } } } });
    await user.click(await screen.findByRole("button", { name: "YouTube chat" }));
    const input = await screen.findByRole("textbox", { name: /YouTube live chat message/i });
    await user.type(input, "Retry this message");
    await user.click(screen.getByRole("button", { name: "Send to YouTube" }));
    await user.click(screen.getByRole("button", { name: "Board post" }));
    await act(async () => rejectSend?.(new Error("YouTube is temporarily unavailable.")));

    expect((await screen.findAllByText("YouTube is temporarily unavailable.")).length).toBeGreaterThanOrEqual(1);
    await user.click(screen.getByRole("button", { name: "YouTube chat" }));
    expect(screen.getByRole("textbox", { name: /YouTube live chat message/i })).toHaveValue("Retry this message");
    expect(screen.getByRole("alert", { hidden: true })).toHaveTextContent("YouTube is temporarily unavailable.");
    mockedBoardApi.sendYouTubeLiveChatMessage.mockResolvedValueOnce({ success: true });
    await user.click(screen.getByRole("button", { name: "Send to YouTube" }));
    expect(await screen.findByText("Message sent to YouTube live chat.")).toBeInTheDocument();
    expect(mockedBoardApi.sendYouTubeLiveChatMessage).toHaveBeenCalledTimes(2);
  });

  it("allows closing and reopening the dock while a YouTube send is pending", async () => {
    const user = userEvent.setup();
    let resolveSend: ((value: unknown) => void) | undefined;
    mockedBoardApi.sendYouTubeLiveChatMessage.mockImplementation(
      () => new Promise((resolve) => { resolveSend = resolve; }),
    );
    renderPage({ globalOverrides: { churchIntegrations: { youtube: { connected: true, accountLabel: "Main channel" } } } });
    const youtubeButton = await screen.findByRole("button", { name: "YouTube chat" });
    await user.click(youtubeButton);
    await user.type(await screen.findByRole("textbox", { name: /YouTube live chat message/i }), "Pending message");
    await user.click(screen.getByRole("button", { name: "Send to YouTube" }));
    await user.click(screen.getByRole("button", { name: /YouTube chat Sending/i }));
    expect(screen.queryByRole("textbox", { name: /YouTube live chat message/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /YouTube chat Sending/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /YouTube chat Sending/i }));
    expect(screen.getByRole("textbox", { name: /YouTube live chat message/i })).toBeDisabled();
    await act(async () => resolveSend?.({ success: true }));
    expect(await screen.findByText("Message sent to YouTube live chat.")).toBeInTheDocument();
    expect(screen.getByText("Sent to YouTube live chat")).toBeInTheDocument();
  });

  it("blocks rapid repeated YouTube sends and keeps old-context results out of a new composer", async () => {
    const user = userEvent.setup();
    let rejectSend: ((reason: Error) => void) | undefined;
    mockedBoardApi.sendYouTubeLiveChatMessage.mockImplementation(
      () => new Promise((_resolve, reject) => { rejectSend = reject; }),
    );
    const view = renderPage({ globalOverrides: { churchIntegrations: { youtube: { connected: true, accountLabel: "Main channel" } } } });
    await user.click(await screen.findByRole("button", { name: "YouTube chat" }));
    await user.type(await screen.findByRole("textbox", { name: /YouTube live chat message/i }), "Old church draft");
    const sendButton = screen.getByRole("button", { name: "Send to YouTube" });
    fireEvent.click(sendButton);
    fireEvent.click(sendButton);
    expect(mockedBoardApi.sendYouTubeLiveChatMessage).toHaveBeenCalledTimes(1);
    expect(mockedBoardApi.sendYouTubeLiveChatMessage).toHaveBeenCalledWith("church-1", { messageText: "Old church draft" });

    view.rerender(pageElement({ globalOverrides: {
      churchId: "church-2",
      churchIntegrations: { youtube: { connected: true, accountLabel: "Other channel" } },
    } }));
    await act(async () => rejectSend?.(new Error("Old church send failed.")));
    expect(await screen.findByText("Old church send failed.")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /YouTube live chat message/i })).toHaveValue("");
  });

  it("posts to the discussion board from the live activity feed", async () => {
    const user = userEvent.setup();
    const api = jest.requireMock("../boards/api") as {
      createBoardPost: jest.Mock;
    };
    api.createBoardPost.mockResolvedValue({
      post: {
        _id: "post:new-1",
        type: "board-post",
        docType: "board-post",
        aliasId: "sunday",
        boardId: "board-current",
        database: "test",
        author: "test-user",
        authorId: "worshipsync:test-user-id",
        text: "Announcement for everyone",
        timestamp: Date.now(),
        hidden: false,
        highlighted: false,
        deleted: false,
      },
    });

    renderPage();

    await screen.findByRole("heading", { name: "Sunday Board" });

    await user.click(
      screen.getByRole("button", { name: "Board post" }),
    );
    const field = await screen.findByRole("textbox", {
      name: /Add to discussion board/i,
    });
    await user.type(field, "Announcement for everyone");
    await user.click(screen.getByRole("button", { name: "Send to discussion board" }));

    await waitFor(() => {
      expect(api.createBoardPost).toHaveBeenCalledWith("sunday", {
        author: "Moderator",
        authorId: "worshipsync:test-user-id",
        text: "Announcement for everyone",
        expectedBoardId: "board-current",
      });
    });
  });

  it("shows share links in Board tools and board context in the toolbar", async () => {
    renderPage();

    const title = await screen.findByRole("heading", { name: "Discussion Board" });
    const titleIcon = title.querySelector("svg");
    expect(titleIcon?.innerHTML).toBe(
      getLucideIconInnerMarkup(PAGE_APPEARANCES.boardModeration.icon),
    );
    expect(titleIcon?.parentElement).toHaveClass(
      PAGE_APPEARANCES.boardModeration.iconColorClass,
    );
    expect(document.querySelector("[data-board-toolbar]")).toHaveClass(
      "h-[48px]",
      "min-h-[48px]",
      "xl:h-auto",
    );
    await screen.findByRole("heading", { name: "Sunday Board" });
    expect(screen.queryByRole("heading", { name: "Discussion boards" })).not.toBeInTheDocument();
    expect(screen.getByText(/\d+ total/i)).toBeInTheDocument();
    expect(screen.getByText(/\d+ visible/i)).toBeInTheDocument();
    expect(screen.getByText(/\d+ highlighted/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Current session:/i).length).toBeGreaterThan(0);

    const tools = await findBoardToolsPanel();
    expect(within(tools).getByText("Share links")).toBeInTheDocument();
    expect(within(tools).getByText("Attendee link")).toBeInTheDocument();
    expect(within(tools).getByText("Board link")).toBeInTheDocument();
  });

  it("offers Sign in again when board sync is paused for auth", async () => {
    const user = userEvent.setup();
    const logout = jest.fn().mockResolvedValue(undefined);
    mockUseBoardSync.mockReturnValue({
      db: undefined,
      status: "paused",
      pullFromRemote: jest.fn(),
      retryNow: jest.fn(),
    } as any);

    renderPage({ globalOverrides: { logout } });

    expect(
      screen.getByText(/Sign in again to load and moderate posts/i),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Sign in again/i }));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("offers Try again when board sync failed to connect", async () => {
    const user = userEvent.setup();
    const retryNow = jest.fn();
    mockUseBoardSync.mockReturnValue({
      db: undefined,
      status: "failed",
      pullFromRemote: jest.fn(),
      retryNow,
    } as any);

    renderPage();

    expect(
      screen.getByText(/Check the server connection, then try again/i),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Try again/i }));
    expect(retryNow).toHaveBeenCalledTimes(1);
  });
});
