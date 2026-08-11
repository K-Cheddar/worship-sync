import { fireEvent, render, screen } from "@testing-library/react";
import { useChat } from "./ChatContext";
import ChatLauncher from "./ChatLauncher";

jest.mock("./ChatContext", () => ({
  useChat: jest.fn(),
}));

const mockedUseChat = jest.mocked(useChat);

describe("ChatLauncher", () => {
  it("stays out of sessions where chat is unavailable", () => {
    mockedUseChat.mockReturnValue(null);
    const { container } = render(<ChatLauncher />);
    expect(container).toBeEmptyDOMElement();
  });

  it("opens chat and announces unread messages", () => {
    const openChat = jest.fn();
    const onOpen = jest.fn();
    mockedUseChat.mockReturnValue({
      available: true,
      unreadCount: 3,
      openChat,
    } as ReturnType<typeof useChat>);

    render(<ChatLauncher onOpen={onOpen} />);
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
});
