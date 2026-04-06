import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import BoardPresent from "./BoardPresent";
import { getBoardAlias, getBoardPosts } from "../boards/api";
import { useBoardEventStream } from "../boards/useBoardEventStream";

jest.mock("../boards/api", () => ({
  getBoardAlias: jest.fn(),
  getBoardPosts: jest.fn(),
}));

jest.mock("../boards/useBoardEventStream", () => ({
  useBoardEventStream: jest.fn(),
}));

const mockGetBoardAlias = jest.mocked(getBoardAlias);
const mockGetBoardPosts = jest.mocked(getBoardPosts);
const mockUseBoardEventStream = jest.mocked(useBoardEventStream);

describe("BoardPresent", () => {
  beforeEach(() => {
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
        presentationFontScale: 1,
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
      <MemoryRouter initialEntries={["/boards/present/sunday"]}>
        <Routes>
          <Route path="/boards/present/:aliasId" element={<BoardPresent />} />
        </Routes>
      </MemoryRouter>,
    );

  it("renders only highlighted posts and refreshes on event stream updates", async () => {
    let refreshCallback: ((event: { type: string; presentationFontScale?: number }) => void) | undefined;
    mockUseBoardEventStream.mockImplementation((_aliasId, onMessage) => {
      refreshCallback = onMessage;
    });

    mockGetBoardPosts
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
            text: "Not highlighted",
            timestamp: 1,
            hidden: false,
            highlighted: false,
          },
        ],
      })
      .mockResolvedValueOnce({
        aliasId: "sunday",
        boardId: "board-a",
        posts: [
          {
            _id: "post:board-a:2",
            type: "post",
            docType: "board-post",
            id: "2",
            aliasId: "sunday",
            boardId: "board-a",
            database: "demo",
            author: "Jamie",
            text: "Highlighted now",
            timestamp: 2,
            hidden: false,
            highlighted: true,
          },
        ],
      });

    renderPage();

    expect(await screen.findByText(/No highlighted posts yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/Not highlighted/i)).not.toBeInTheDocument();

    await act(async () => {
      refreshCallback?.({ type: "post-created" });
    });

    expect(await screen.findByText(/Highlighted now/i)).toBeInTheDocument();
    expect(mockGetBoardAlias).toHaveBeenCalledTimes(1);
    expect(mockGetBoardPosts).toHaveBeenCalledTimes(2);
  });

  it("updates presentation font scale from stream events without refetching posts", async () => {
    let refreshCallback: ((event: { type: string; presentationFontScale?: number }) => void) | undefined;
    mockUseBoardEventStream.mockImplementation((_aliasId, onMessage) => {
      refreshCallback = onMessage;
    });

    mockGetBoardPosts.mockResolvedValue({
      aliasId: "sunday",
      boardId: "board-a",
      posts: [
        {
          _id: "post:board-a:2",
          type: "post",
          docType: "board-post",
          id: "2",
          aliasId: "sunday",
          boardId: "board-a",
          database: "demo",
          author: "Jamie",
          text: "Highlighted now",
          timestamp: 2,
          hidden: false,
          highlighted: true,
        },
      ],
    });

    renderPage();

    const postText = await screen.findByText(/Highlighted now/i);
    const initialCalls = mockGetBoardPosts.mock.calls.length;

    await act(async () => {
      refreshCallback?.({
        type: "board-presentation-updated",
        presentationFontScale: 1.5,
      });
    });

    expect(postText).toHaveStyle({
      fontSize: "clamp(3.375rem, 4.5vw, 7.5rem)",
    });
    expect(mockGetBoardPosts).toHaveBeenCalledTimes(initialCalls);
  });
});
