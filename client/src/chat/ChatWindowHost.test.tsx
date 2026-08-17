import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import ChatWindowHost from "./ChatWindowHost";
import { useChat } from "./ChatContext";
import { useMediaQuery } from "../hooks/useMediaQuery";

jest.mock("./ChatContext", () => ({
  isChatPageRoute: (pathname: string) => pathname === "/chat",
  useChat: jest.fn(),
}));

jest.mock("../hooks/useMediaQuery", () => ({
  useMediaQuery: jest.fn(),
}));

jest.mock("./ChatWindow", () => ({
  __esModule: true,
  default: ({ onOpenFullPage }: { onOpenFullPage?: () => void }) => (
    <div>
      Chat content
      {onOpenFullPage ? (
        <button type="button" onClick={onOpenFullPage}>
          Open full chat
        </button>
      ) : null}
    </div>
  ),
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

const LocationHarness = () => {
  const location = useLocation();
  return <div>{location.pathname}</div>;
};

const renderHost = (route = "/home") =>
  render(
    <MemoryRouter initialEntries={[route]}>
      <ChatWindowHost />
      <LocationHarness />
    </MemoryRouter>,
  );

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

    renderHost();
    expect(screen.queryByTestId("floating-window")).not.toBeInTheDocument();
  });

  it("uses a floating window outside the full chat page", () => {
    mockedUseChat.mockReturnValue({
      available: true,
      isOpen: true,
      closeChat: jest.fn(),
    } as unknown as ReturnType<typeof useChat>);

    mockedUseMediaQuery.mockReturnValue(false);
    renderHost();
    expect(screen.getByTestId("floating-window")).toBeInTheDocument();
    expect(screen.getByText("Chat content")).toBeInTheDocument();
  });

  it("opens the full chat page and closes the floating window", () => {
    const closeChat = jest.fn();
    mockedUseChat.mockReturnValue({
      available: true,
      isOpen: true,
      closeChat,
    } as unknown as ReturnType<typeof useChat>);
    mockedUseMediaQuery.mockReturnValue(true);

    renderHost();
    fireEvent.click(screen.getByRole("button", { name: "Open full chat" }));

    expect(closeChat).toHaveBeenCalledTimes(1);
    expect(screen.getByText("/chat")).toBeInTheDocument();
  });

  it("does not render a floating window on the full chat page", () => {
    mockedUseChat.mockReturnValue({
      available: true,
      isOpen: true,
      closeChat: jest.fn(),
    } as unknown as ReturnType<typeof useChat>);
    mockedUseMediaQuery.mockReturnValue(true);

    renderHost("/chat");

    expect(screen.queryByTestId("floating-window")).not.toBeInTheDocument();
  });
});
