import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import BoardPresent from "./BoardPresent";
import { getBoardAlias, getBoardDisplayItems } from "../boards/api";
import { useBoardEventStream } from "../boards/useBoardEventStream";

jest.mock("../boards/api", () => ({
  getBoardAlias: jest.fn(),
  getBoardDisplayItems: jest.fn(),
}));

jest.mock("../boards/useBoardEventStream", () => ({
  useBoardEventStream: jest.fn(),
}));

const mockGetBoardAlias = jest.mocked(getBoardAlias);
const mockGetBoardDisplayItems = jest.mocked(getBoardDisplayItems);
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

    mockGetBoardDisplayItems
      .mockResolvedValueOnce({
        aliasId: "sunday",
        items: [],
      })
      .mockResolvedValueOnce({
        aliasId: "sunday",
        items: [
          {
            id: "board-1",
            source: "board",
            sourceLabel: "Board",
            author: "Alex",
            text: "Highlighted now",
            timestamp: 2,
          },
        ],
      });

    renderPage();

    expect(await screen.findByText(/No highlighted messages yet/i)).toBeInTheDocument();

    await act(async () => {
      refreshCallback?.({ type: "post-created" });
    });

    expect(await screen.findByText(/Highlighted now/i)).toBeInTheDocument();
    expect(mockGetBoardAlias).toHaveBeenCalledTimes(1);
    expect(mockGetBoardDisplayItems).toHaveBeenCalledTimes(2);
  });

  it("shows restream source labels in the mixed presentation feed", async () => {
    mockGetBoardDisplayItems.mockResolvedValue({
      aliasId: "sunday",
      items: [
        {
          id: "restream-1",
          source: "restream",
          sourceLabel: "YouTube",
          author: "Jamie",
          text: "Stream comment",
          timestamp: 2,
        },
      ],
    });

    renderPage();

    expect(await screen.findByText(/Stream comment/i)).toBeInTheDocument();
    expect(screen.getByText("YouTube")).toBeInTheDocument();
  });

  it("updates presentation font scale from stream events without refetching items", async () => {
    let refreshCallback:
      | ((event: { type: string; presentationFontScale?: number }) => void)
      | undefined;
    mockUseBoardEventStream.mockImplementation((_aliasId, onMessage) => {
      refreshCallback = onMessage;
    });

    mockGetBoardDisplayItems.mockResolvedValue({
      aliasId: "sunday",
      items: [
        {
          id: "board-2",
          source: "board",
          sourceLabel: "Board",
          author: "Jamie",
          text: "Highlighted now",
          timestamp: 2,
        },
      ],
    });

    renderPage();

    const postText = await screen.findByText(/Highlighted now/i);
    const initialCalls = mockGetBoardDisplayItems.mock.calls.length;

    await act(async () => {
      refreshCallback?.({
        type: "board-presentation-updated",
        presentationFontScale: 1.5,
      });
    });

    expect(postText).toHaveStyle({
      fontSize: "clamp(3.375rem, 4.5vw, 7.5rem)",
    });
    expect(mockGetBoardDisplayItems).toHaveBeenCalledTimes(initialCalls);
  });
});
