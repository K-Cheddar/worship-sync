import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { FloatingWindowZIndexProvider } from "../components/FloatingWindow/FloatingWindowZIndexContext";
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
  default: ({ floatingWindowContentVisible }: { floatingWindowContentVisible?: boolean }) => (
    <>
      <div>Chat content</div>
      <span data-testid="chat-content-visibility">
        {String(Boolean(floatingWindowContentVisible))}
      </span>
    </>
  ),
}));

const mockedUseChat = jest.mocked(useChat);
const mockedUseMediaQuery = jest.mocked(useMediaQuery);
const renderHost = () =>
  render(
    <FloatingWindowZIndexProvider>
      <ChatWindowHost />
    </FloatingWindowZIndexProvider>,
  );
const chatHostTree = () => (
  <FloatingWindowZIndexProvider>
    <ChatWindowHost />
  </FloatingWindowZIndexProvider>
);

describe("ChatWindowHost", () => {
  beforeEach(() => {
    mockedUseChat.mockReset();
    mockedUseMediaQuery.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders nothing when chat is closed", () => {
    mockedUseChat.mockReturnValue({
      available: true,
      isOpen: false,
      closeChat: jest.fn(),
    } as unknown as ReturnType<typeof useChat>);
    mockedUseMediaQuery.mockReturnValue(true);

    const { container } = renderHost();
    expect(container).toBeEmptyDOMElement();
  });

  it("uses a floating window on desktop and mobile", () => {
    mockedUseChat.mockReturnValue({
      available: true,
      isOpen: true,
      closeChat: jest.fn(),
    } as unknown as ReturnType<typeof useChat>);

    mockedUseMediaQuery.mockReturnValue(false);
    const { rerender } = renderHost();
    expect(screen.getByTestId("floating-window")).toBeInTheDocument();
    expect(screen.getByText("Chat content")).toBeInTheDocument();

    mockedUseMediaQuery.mockReturnValue(true);
    rerender(chatHostTree());
    expect(screen.getByTestId("floating-window")).toBeInTheDocument();
  });

  it("uses the floating window on the Viewer route", () => {
    mockedUseChat.mockReturnValue({
      available: true,
      isOpen: true,
      closeChat: jest.fn(),
    } as unknown as ReturnType<typeof useChat>);
    mockedUseMediaQuery.mockReturnValue(true);

    render(
      <MemoryRouter initialEntries={["/current-service/view"]}>
        <FloatingWindowZIndexProvider>
          <ChatWindowHost />
        </FloatingWindowZIndexProvider>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("floating-window")).toBeInTheDocument();
  });

  it("resets content visibility when a closed chat window is mounted again", async () => {
    const closeChat = jest.fn();
    mockedUseChat.mockReturnValue({
      available: true,
      isOpen: true,
      closeChat,
    } as unknown as ReturnType<typeof useChat>);
    mockedUseMediaQuery.mockReturnValue(true);

    const { rerender } = renderHost();
    await screen.findByText("true", {
      selector: '[data-testid="chat-content-visibility"]',
    });

    jest.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);

    mockedUseChat.mockReturnValue({
      available: true,
      isOpen: false,
      closeChat,
    } as unknown as ReturnType<typeof useChat>);
    rerender(chatHostTree());
    expect(screen.queryByTestId("floating-window")).not.toBeInTheDocument();

    mockedUseChat.mockReturnValue({
      available: true,
      isOpen: true,
      closeChat,
    } as unknown as ReturnType<typeof useChat>);
    rerender(chatHostTree());

    expect(screen.getByTestId("floating-window")).toBeInTheDocument();
    expect(screen.getByTestId("chat-content-visibility")).toHaveTextContent("false");
  });
});
