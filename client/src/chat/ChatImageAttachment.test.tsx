import { fireEvent, render, screen, within } from "@testing-library/react";
import { getChatImageUrl } from "./api";
import ChatImageAttachment from "./ChatImageAttachment";

jest.mock("./api", () => ({
  getChatImageUrl: jest.fn(),
}));

const mockedGetChatImageUrl = jest.mocked(getChatImageUrl);

describe("ChatImageAttachment", () => {
  beforeEach(() => {
    mockedGetChatImageUrl.mockReset();
    mockedGetChatImageUrl.mockImplementation(
      async (_churchId, _messageId, variant) => ({
        url: `https://r2.example.test/${variant}`,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      }),
    );
  });

  it("loads a private thumbnail and opens the full image", async () => {
    render(
      <ChatImageAttachment
        churchId="church_1"
        messageId="message_1"
        authorName="Alex"
        attachment={{
          type: "image",
          id: "image_1",
          contentType: "image/webp",
          sizeBytes: 1200,
          thumbnailSizeBytes: 300,
          width: 1200,
          height: 800,
          thumbnailWidth: 480,
          thumbnailHeight: 320,
        }}
      />,
    );

    expect(await screen.findByAltText("Shared by Alex")).toHaveAttribute(
      "src",
      "https://r2.example.test/thumbnail",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Open photo from Alex" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Photo from Alex",
    });
    expect(dialog).toBeInTheDocument();
    expect(await within(dialog).findByAltText("Shared by Alex")).toHaveAttribute(
      "src",
      "https://r2.example.test/full",
    );
    fireEvent.click(screen.getByRole("button", { name: "Close photo" }));
    expect(
      screen.queryByRole("dialog", { name: "Photo from Alex" }),
    ).not.toBeInTheDocument();
  });
});
