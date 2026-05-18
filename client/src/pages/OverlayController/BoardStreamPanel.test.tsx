import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import BoardStreamPanel from "./BoardStreamPanel";
import { GlobalInfoContext } from "../../context/globalInfo";
import { createMockGlobalContext } from "../../test/mocks";
import { updateBoardPostStreamInfo } from "../../store/presentationSlice";

const mockDispatch = jest.fn();
const mockUseBoardData = jest.fn();
const mockUseRestreamSession = jest.fn();

let mockState = {
  presentation: {
    isStreamTransmitting: true,
  },
};

jest.mock("../../hooks", () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: (state: typeof mockState) => unknown) =>
    selector(mockState),
}));

jest.mock("../../boards/useBoardData", () => ({
  useBoardData: (...args: unknown[]) => mockUseBoardData(...args),
}));

jest.mock("../../boards/useBoardEventStream", () => ({
  useBoardEventStream: jest.fn(),
}));

jest.mock("../../boards/useRestreamSession", () => ({
  useRestreamSession: (...args: unknown[]) => mockUseRestreamSession(...args),
}));

jest.mock("../../boards/boardUtils", () => ({
  filterHighlightedBoardPosts: (posts: Array<{ highlighted?: boolean }>) =>
    posts.filter((post) => post.highlighted),
  getBoardAuthorNameColorClass: () => "text-cyan-100",
  getBoardAuthorNameHexColor: (post: { source?: string; authorId?: string }) => {
    if (post.source === "restream") return "#ff0000";
    if (post.authorId) return "#00ff00";
    return "#e7e5e4";
  },
  getStoredBoardDisplayAliasId: () => "board-alias",
}));

jest.mock("../../components/DisplayWindow/DisplayWindow", () => ({
  __esModule: true,
  default: () => <div data-testid="display-window-preview" />,
}));

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
    ...props
  }: {
    children?: ReactNode;
    onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
    disabled?: boolean;
    type?: "button" | "submit" | "reset";
  }) => (
    <button type={type} onClick={onClick} disabled={disabled} {...props}>
      {children}
    </button>
  ),
}));

jest.mock("../../components/ui/DropdownMenu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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
    mockState = {
      presentation: {
        isStreamTransmitting: true,
      },
    };

    mockUseBoardData.mockReturnValue({
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
      connectionStatus: { status: "connected" },
      loadBoard: jest.fn(),
      loadPosts: jest.fn(),
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
      if (within(row).queryByText("Board highlighted earlier")) return "board-1";
      if (within(row).queryByText("Restream highlighted")) return "restream-1";
      if (within(row).queryByText("Board highlighted later")) return "board-2";
      return "unknown";
    });
    expect(orderedTexts).toEqual(["board-1", "restream-1", "board-2"]);

    const restreamRow = rows.find((row) =>
      within(row).queryByText("Restream highlighted"),
    );
    expect(restreamRow).toBeDefined();

    fireEvent.click(within(restreamRow as HTMLElement).getByRole("button", { name: "Send" }));

    expect(mockDispatch).toHaveBeenCalledWith(
      updateBoardPostStreamInfo({
        author: "Restream author",
        authorHexColor: "#ff0000",
        text: "Restream highlighted",
        backgroundColor: "#32353beb",
        fontSize: 1.5,
        duration: 15,
      }),
    );
  });
});
