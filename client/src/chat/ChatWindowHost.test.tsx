import { render, screen } from "@testing-library/react";
import ChatWindowHost from "./ChatWindowHost";
import { useChat } from "./ChatContext";
import { useMediaQuery } from "../hooks/useMediaQuery";

jest.mock("./ChatContext", () => ({
  useChat: jest.fn(),
}));

jest.mock("../hooks/useMediaQuery", () => ({
  useMediaQuery: jest.fn(),
}));

jest.mock("./ChatWindow", () => ({
  __esModule: true,
  default: () => <div>Chat content</div>,
}));

jest.mock("../components/FloatingWindow/FloatingWindow", () => ({
  __esModule: true,
  default: ({
    children,
    title,
  }: {
    children: React.ReactNode;
    title: string;
  }) => (
    <div data-testid="floating-window" aria-label={title}>
      {children}
    </div>
  ),
}));

const mockedUseChat = jest.mocked(useChat);
const mockedUseMediaQuery = jest.mocked(useMediaQuery);

describe("ChatWindowHost", () => {
  beforeEach(() => {
    mockedUseChat.mockReset();
    mockedUseMediaQuery.mockReset();
  });

  it("renders nothing when chat is closed", () => {
    mockedUseChat.mockReturnValue({
      available: true,
      isOpen: false,
      closeChat: jest.fn(),
    } as unknown as ReturnType<typeof useChat>);
    mockedUseMediaQuery.mockReturnValue(true);

    const { container } = render(<ChatWindowHost />);
    expect(container).toBeEmptyDOMElement();
  });

  it("uses a floating window on desktop and mobile", () => {
    mockedUseChat.mockReturnValue({
      available: true,
      isOpen: true,
      closeChat: jest.fn(),
    } as unknown as ReturnType<typeof useChat>);

    mockedUseMediaQuery.mockReturnValue(false);
    const { rerender } = render(<ChatWindowHost />);
    expect(screen.getByTestId("floating-window")).toBeInTheDocument();
    expect(screen.getByText("Chat content")).toBeInTheDocument();

    mockedUseMediaQuery.mockReturnValue(true);
    rerender(<ChatWindowHost />);
    expect(screen.getByTestId("floating-window")).toBeInTheDocument();
  });
});
