import { act, render, screen } from "@testing-library/react";
import BoardDisplay from "./BoardDisplay";

jest.mock("../boards/BoardPresentationScreen", () => ({
  __esModule: true,
  default: ({
    aliasId,
    missingAliasTitle,
  }: {
    aliasId: string;
    missingAliasTitle?: string;
  }) => (
    <div>
      <div data-testid="board-display-alias">{aliasId}</div>
      <div data-testid="board-display-title">{missingAliasTitle}</div>
    </div>
  ),
}));

describe("BoardDisplay", () => {
  const originalBroadcastChannel = global.BroadcastChannel;

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    global.BroadcastChannel = originalBroadcastChannel;
  });

  it("uses the stored board alias for the display page", () => {
    localStorage.setItem("worshipsyncBoardDisplayAliasId", "sabbath-school");

    render(<BoardDisplay />);

    expect(screen.getByTestId("board-display-alias")).toHaveTextContent(
      "sabbath-school",
    );
  });

  it("updates when the selected board alias changes", () => {
    let notify: (() => void) | null = null;
    global.BroadcastChannel = class {
      onmessage: (() => void) | null = null;

      constructor() {
        notify = () => {
          this.onmessage?.();
        };
      }

      close() {}
    } as any;

    localStorage.setItem("worshipsyncBoardDisplayAliasId", "first-board");
    render(<BoardDisplay />);

    expect(screen.getByTestId("board-display-alias")).toHaveTextContent(
      "first-board",
    );

    localStorage.setItem("worshipsyncBoardDisplayAliasId", "second-board");
    act(() => {
      notify?.();
    });

    expect(screen.getByTestId("board-display-alias")).toHaveTextContent(
      "second-board",
    );
  });
});
