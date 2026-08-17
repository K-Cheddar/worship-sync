import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useChat } from "./ChatContext";
import ChatLauncher from "./ChatLauncher";

jest.mock("./ChatContext", () => ({
  isChatPageRoute: (pathname: string) => pathname === "/chat",
  useChat: jest.fn(),
}));

const mockedUseChat = jest.mocked(useChat);

const renderLauncher = (
  props: React.ComponentProps<typeof ChatLauncher> = {},
  route = "/home",
) =>
  render(
    <MemoryRouter initialEntries={[route]}>
      <ChatLauncher {...props} />
    </MemoryRouter>,
  );

describe("ChatLauncher", () => {
  it("stays out of sessions where chat is unavailable", () => {
    mockedUseChat.mockReturnValue(null);
    const { container } = renderLauncher();
    expect(container).toBeEmptyDOMElement();
  });

  it("opens chat and announces unread messages", () => {
    const openChat = jest.fn();
    const onOpen = jest.fn();
    mockedUseChat.mockReturnValue({
      available: true,
      unreadCount: 3,
      openChat,
    } as unknown as ReturnType<typeof useChat>);

    renderLauncher({ onOpen });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Open team chat. 3 unread messages.",
      }),
    );

    expect(openChat).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Team chat")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("stays out of the dedicated chat page", () => {
    mockedUseChat.mockReturnValue({
      available: true,
      unreadCount: 0,
    } as unknown as ReturnType<typeof useChat>);

    const { container } = renderLauncher({}, "/chat");

    expect(container).toBeEmptyDOMElement();
  });
});
