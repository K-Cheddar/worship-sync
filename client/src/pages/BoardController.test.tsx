import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
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
import { useAboutChangelogMenu } from "../hooks/useAboutChangelogMenu";
import type { RootState } from "../store/store";

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

jest.mock("../hooks/useAboutChangelogMenu", () => ({
  useAboutChangelogMenu: jest.fn(),
}));

jest.mock("../boards/api", () => ({
  createBoardAlias: jest.fn(),
  createBoardPost: jest.fn(),
  disconnectRestream: jest.fn(),
  deleteBoardAlias: jest.fn(),
  hardResetBoardAlias: jest.fn(),
  resetRestreamSession: jest.fn(),
  softResetBoardAlias: jest.fn(),
  updateBoardAliasTitle: jest.fn(),
  updateBoardPresentationFontScale: jest.fn(),
  updateBoardPostHidden: jest.fn(),
  updateBoardPostHighlighted: jest.fn(),
  updateRestreamMessageHidden: jest.fn(),
  updateRestreamMessageHighlighted: jest.fn(),
}));

const mockedBoardApi = jest.requireMock("../boards/api") as {
  createBoardAlias: jest.Mock;
  deleteBoardAlias: jest.Mock;
  hardResetBoardAlias: jest.Mock;
  softResetBoardAlias: jest.Mock;
  updateBoardAliasTitle: jest.Mock;
  updateBoardPresentationFontScale: jest.Mock;
  updateBoardPostHidden: jest.Mock;
  updateBoardPostHighlighted: jest.Mock;
};

const mockCreateBoardAlias = mockedBoardApi.createBoardAlias;
const mockDeleteBoardAlias = mockedBoardApi.deleteBoardAlias;
const mockSoftResetBoardAlias = mockedBoardApi.softResetBoardAlias;
const mockUpdateBoardAliasTitle = mockedBoardApi.updateBoardAliasTitle;
const mockUpdateBoardPresentationFontScale =
  mockedBoardApi.updateBoardPresentationFontScale;
const mockUpdateBoardPostHidden = mockedBoardApi.updateBoardPostHidden;
const mockUpdateBoardPostHighlighted = mockedBoardApi.updateBoardPostHighlighted;
const mockUseBoardSync = jest.mocked(useBoardSync);
const mockUseRestreamSession = jest.mocked(useRestreamSession);
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
  const changeListeners: Array<() => void> = [];

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
    } as any);
    mockUseRestreamSession.mockReturnValue({
      session: {
        churchId: "church-1",
        database: "test",
        sessionId: "restream-session-1",
        startedAt: 100,
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
    mockedBoardApi.hardResetBoardAlias.mockResolvedValue({
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

      const earlierQuestionArticle = screen
        .getAllByRole("article")
        .find((el) => within(el).queryByText(/Earlier question/i));
      expect(earlierQuestionArticle).toBeDefined();

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

    await screen.findByRole("heading", { name: "Sunday Board" });
    await user.click(screen.getByRole("button", { name: /Board tools and management/i }));
    await user.click(await screen.findByRole("menuitem", { name: /Manage boards/i }));
    await screen.findAllByText("Manage boards");

    const boardButtons = screen.getAllByTitle("Sunday Board (sunday)");
    await user.click(boardButtons[boardButtons.length - 1]);

    await waitFor(() => {
      expect(screen.getAllByTitle("Sunday Board (sunday)")).toHaveLength(1);
    });
    expect(screen.getByRole("heading", { name: "Sunday Board" })).toBeInTheDocument();
    expect(screen.getByText(/Current session:/i)).toBeInTheDocument();
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

  it("renders the Restream tab with connection guidance", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole("heading", { name: "Sunday Board" });
    await user.click(await screen.findByRole("tab", { name: /Restream/i }));

    expect(
      await screen.findByText(/Restream is not connected/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Ask a church admin to connect Restream/i),
    ).toBeInTheDocument();
  });

  it("shows the Restream stream name when it is available", async () => {
    const user = userEvent.setup();
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
          postedAt: 100,
          receivedAt: 100,
          rawEventType: "5",
          isHighlighted: false,
          hidden: false,
        },
      ],
      isLoading: false,
      error: "",
      bestEffortOnly: true,
      oauthConfigured: true,
      isOffline: false,
      feedState: "has_messages",
      reload: jest.fn(() => Promise.resolve()),
    });

    renderPage();

    await screen.findByRole("heading", { name: "Sunday Board" });
    await user.click(await screen.findByRole("tab", { name: /Restream/i }));

    expect(await screen.findByText(/Stream name:/i)).toBeInTheDocument();
    expect(screen.getByText("Sabbath School Weekly")).toBeInTheDocument();
  });

  it("does not show a discussion-board post composer on the Restream tab", async () => {
    const user = userEvent.setup();
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
      feedState: "empty",
      reload: jest.fn(() => Promise.resolve()),
    });

    renderPage();

    await screen.findByRole("heading", { name: "Sunday Board" });
    await user.click(await screen.findByRole("tab", { name: /Restream/i }));

    expect(
      screen.queryByRole("textbox", {
        name: /Add to discussion board/i,
      }),
    ).not.toBeInTheDocument();
  });

  it("posts to the discussion board from the Board Posts tab", async () => {
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

    const field = await screen.findByRole("textbox", {
      name: /Add to discussion board/i,
    });
    await user.type(field, "Announcement for everyone");
    await user.click(screen.getByRole("button", { name: /^Send$/i }));

    await waitFor(() => {
      expect(api.createBoardPost).toHaveBeenCalledWith("sunday", {
        author: "Moderator",
        authorId: "worshipsync:test-user-id",
        text: "Announcement for everyone",
      });
    });
  });
});
