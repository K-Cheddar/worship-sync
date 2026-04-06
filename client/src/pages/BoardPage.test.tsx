import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import BoardPage from "./BoardPage";
import { createBoardPost, getBoardAlias, getBoardPosts } from "../boards/api";
import { useBoardEventStream } from "../boards/useBoardEventStream";

jest.mock("../boards/api", () => ({
  createBoardPost: jest.fn(),
  getBoardAlias: jest.fn(),
  getBoardPosts: jest.fn(),
}));

jest.mock("../boards/useBoardEventStream", () => ({
  useBoardEventStream: jest.fn(),
}));

const mockGetBoardAlias = jest.mocked(getBoardAlias);
const mockGetBoardPosts = jest.mocked(getBoardPosts);
const mockCreateBoardPost = jest.mocked(createBoardPost);
const mockUseBoardEventStream = jest.mocked(useBoardEventStream);

describe("BoardPage", () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    mockGetBoardAlias.mockResolvedValue({
      alias: {
        _id: "alias:sunday",
        type: "alias",
        docType: "board-alias",
        aliasId: "sunday",
        title: "Sunday Board",
        database: "demo",
        currentBoardId: "board-a",
        history: [],
        createdAt: 1,
        updatedAt: 1,
      },
      board: {
        _id: "board:board-a",
        type: "board",
        docType: "board",
        id: "board-a",
        aliasId: "sunday",
        database: "demo",
        createdAt: 1,
        archived: false,
      },
    });
  });

  const renderPage = () =>
    render(
      <MemoryRouter initialEntries={["/boards/sunday"]}>
        <Routes>
          <Route path="/boards/:aliasId" element={<BoardPage />} />
        </Routes>
      </MemoryRouter>,
    );

  it("uses the saved display name and submits a post after the name step", async () => {
    localStorage.setItem("worshipsyncBoardName", "Taylor");
    localStorage.setItem("worshipsyncBoardParticipantId", "participant-123");
    mockGetBoardPosts.mockResolvedValue({
      aliasId: "sunday",
      boardId: "board-a",
      posts: [],
    });
    mockCreateBoardPost.mockResolvedValue({
      post: {} as any,
    });

    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText(/Posting as/i)).toBeInTheDocument();
    expect(screen.getByText("Taylor")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Display name/i)).not.toBeInTheDocument();

    await user.type(
      await screen.findByLabelText(/Question/i),
      "Please pray for our team.",
    );
    await user.click(screen.getByRole("button", { name: /^Send$/i }));

    expect(mockGetBoardPosts).toHaveBeenCalledWith("sunday", {
      includeHidden: false,
      viewerAuthorId: "participant-123",
    });
    expect(mockCreateBoardPost).toHaveBeenCalledWith(
      "sunday",
      expect.objectContaining({
        author: "Taylor",
        authorId: expect.any(String),
        text: "Please pray for our team.",
      }),
    );
    expect(mockGetBoardAlias).toHaveBeenCalledTimes(1);
    expect(mockGetBoardPosts).toHaveBeenCalledTimes(1);
  });

  it("blocks continue when the display name is taken by another participant", async () => {
    localStorage.setItem("worshipsyncBoardParticipantId", "my-device");
    mockGetBoardPosts.mockResolvedValue({
      aliasId: "sunday",
      boardId: "board-a",
      posts: [
        {
          _id: "post:board-a:1",
          type: "post",
          docType: "board-post",
          id: "1",
          aliasId: "sunday",
          boardId: "board-a",
          database: "demo",
          author: "Alex",
          authorId: "other-device",
          text: "Hi",
          timestamp: 1,
          hidden: false,
          highlighted: false,
        },
      ],
    });

    const user = userEvent.setup();
    renderPage();

    const nameInput = await screen.findByLabelText(/Display name/i);
    await user.type(nameInput, "Alex");
    await user.click(screen.getByRole("button", { name: /^Continue$/i }));

    expect(
      await screen.findByText(/That display name is already in use/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Posting as/i)).not.toBeInTheDocument();
  });

  it("saves the display name after continue, supports edit, and hides other users' hidden posts", async () => {
    mockGetBoardPosts.mockResolvedValue({
      aliasId: "sunday",
      boardId: "board-a",
      posts: [
        {
          _id: "post:board-a:1",
          type: "post",
          docType: "board-post",
          id: "1",
          aliasId: "sunday",
          boardId: "board-a",
          database: "demo",
          author: "Alex",
          authorId: "p1",
          text: "Visible post",
          timestamp: 1,
          hidden: false,
          highlighted: false,
        },
        {
          _id: "post:board-a:2",
          type: "post",
          docType: "board-post",
          id: "2",
          aliasId: "sunday",
          boardId: "board-a",
          database: "demo",
          author: "Jamie",
          authorId: "p2",
          text: "Hidden post",
          timestamp: 2,
          hidden: true,
          highlighted: false,
        },
      ],
    });

    const user = userEvent.setup();
    renderPage();

    const nameInput = await screen.findByLabelText(/Display name/i);
    await user.type(nameInput, "Jordan");
    await user.click(screen.getByRole("button", { name: /^Continue$/i }));

    await waitFor(() => {
      expect(localStorage.getItem("worshipsyncBoardName")).toBe("Jordan");
    });

    expect(screen.getByText(/Posting as/i)).toBeInTheDocument();
    expect(screen.getByText("Jordan")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /Edit display name/i }),
    );
    const dialog = await screen.findByRole("dialog", { name: /Change display name/i });
    const editInput = within(dialog).getByLabelText(/Display name/i);
    await user.clear(editInput);
    await user.type(editInput, "Riley");
    await user.click(within(dialog).getByRole("button", { name: /^Save$/i }));

    await waitFor(() => {
      expect(localStorage.getItem("worshipsyncBoardName")).toBe("Riley");
    });
    expect(screen.getByText("Riley")).toBeInTheDocument();

    expect(screen.getByText(/^Visible post$/i)).toBeInTheDocument();
    expect(screen.queryByText(/Hidden post/i)).not.toBeInTheDocument();
  });

  it("shows the author's own hidden post with a hidden-from-others label", async () => {
    localStorage.setItem("worshipsyncBoardParticipantId", "p2");
    mockGetBoardPosts.mockResolvedValue({
      aliasId: "sunday",
      boardId: "board-a",
      posts: [
        {
          _id: "post:board-a:1",
          type: "post",
          docType: "board-post",
          id: "1",
          aliasId: "sunday",
          boardId: "board-a",
          database: "demo",
          author: "Alex",
          authorId: "p1",
          text: "Visible post",
          timestamp: 1,
          hidden: false,
          highlighted: false,
        },
        {
          _id: "post:board-a:2",
          type: "post",
          docType: "board-post",
          id: "2",
          aliasId: "sunday",
          boardId: "board-a",
          database: "demo",
          author: "Jamie",
          authorId: "p2",
          text: "My hidden post",
          timestamp: 2,
          hidden: true,
          highlighted: false,
        },
      ],
    });

    const user = userEvent.setup();
    renderPage();

    const nameInput = await screen.findByLabelText(/Display name/i);
    await user.type(nameInput, "Jamie");
    await user.click(screen.getByRole("button", { name: /^Continue$/i }));

    expect(screen.getByText(/^Visible post$/i)).toBeInTheDocument();
    expect(screen.getByText(/^My hidden post$/i)).toBeInTheDocument();
    expect(screen.getByText(/Hidden from others/i)).toBeInTheDocument();
  });

  it("shows a character count after 400 characters and enforces the 800 character limit", async () => {
    localStorage.setItem("worshipsyncBoardName", "Taylor");
    mockGetBoardPosts.mockResolvedValue({
      aliasId: "sunday",
      boardId: "board-a",
      posts: [],
    });

    renderPage();

    const questionInput = await screen.findByLabelText(/Question/i);

    expect(screen.queryByText("0/800")).not.toBeInTheDocument();

    fireEvent.change(questionInput, { target: { value: "a".repeat(401) } });
    expect(screen.getByText("401/800")).toBeInTheDocument();

    fireEvent.change(questionInput, { target: { value: "b".repeat(800) } });
    expect((questionInput as HTMLTextAreaElement).value).toHaveLength(800);
    expect(screen.getByText("800/800")).toBeInTheDocument();
  });

  it("refreshes only posts on post events from the board stream", async () => {
    let refreshCallback:
      | ((event: { type: string; presentationFontScale?: number }) => void)
      | undefined;
    mockUseBoardEventStream.mockImplementation((_aliasId, onMessage) => {
      refreshCallback = onMessage;
    });

    mockGetBoardPosts
      .mockResolvedValueOnce({
        aliasId: "sunday",
        boardId: "board-a",
        posts: [],
      })
      .mockResolvedValueOnce({
        aliasId: "sunday",
        boardId: "board-a",
        posts: [
          {
            _id: "post:board-a:1",
            type: "post",
            docType: "board-post",
            id: "1",
            aliasId: "sunday",
            boardId: "board-a",
            database: "demo",
            author: "Alex",
            text: "New post from stream",
            timestamp: 1,
            hidden: false,
            highlighted: false,
          },
        ],
      });

    renderPage();

    expect(await screen.findByText(/No posts yet/i)).toBeInTheDocument();
    const initialAliasCalls = mockGetBoardAlias.mock.calls.length;

    await act(async () => {
      refreshCallback?.({ type: "post-created" });
    });

    expect(await screen.findByText(/New post from stream/i)).toBeInTheDocument();
    expect(mockGetBoardAlias).toHaveBeenCalledTimes(initialAliasCalls);
    expect(mockGetBoardPosts).toHaveBeenCalledTimes(2);
  });
});
