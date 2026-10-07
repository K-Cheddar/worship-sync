import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { getChatImageUrl } from "./api";
import ChatImageAttachment from "./ChatImageAttachment";
import type { ChatImageAttachment as ImageAttachment } from "./types";

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

  it("loads a private thumbnail, opens the full image, and restores focus to its trigger", async () => {
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
          expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
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
    await waitFor(() => expect(screen.getByRole("button", { name: "Open photo from Alex" })).toHaveFocus());
  });

  it("shows an expired placeholder for legacy images without expiry metadata", () => {
    render(
      <ChatImageAttachment
        churchId="church_1"
        messageId="message_legacy"
        authorName="Alex"
        attachment={{
          type: "image",
          id: "legacy-image",
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

    expect(screen.getByRole("status")).toHaveTextContent("Image expired");
    expect(mockedGetChatImageUrl).not.toHaveBeenCalled();
  });

  it("ignores a full image response after the message identity changes", async () => {
    let resolveFull!: (value: Awaited<ReturnType<typeof getChatImageUrl>>) => void;
    mockedGetChatImageUrl.mockImplementation(async (_church, message, variant) => {
      if (message === "pending-message" && variant === "full") {
        return new Promise((resolve) => { resolveFull = resolve; });
      }
      return { url: `https://r2.example.test/${message}/${variant}`, expiresAt: new Date(Date.now() + 900_000).toISOString() };
    });
    const attachment: ImageAttachment = { type: "image", id: "pending-image", contentType: "image/webp", sizeBytes: 1200, thumbnailSizeBytes: 300, width: 1200, height: 800, thumbnailWidth: 480, thumbnailHeight: 320, expiresAt: Date.now() + 900_000 };
    const { rerender } = render(<ChatImageAttachment churchId="church-identity" messageId="pending-message" authorName="Alex" attachment={attachment} />);
    await screen.findByRole("button", { name: "Open photo from Alex" });
    fireEvent.click(screen.getByRole("button", { name: "Open photo from Alex" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Loading photo");
    rerender(<ChatImageAttachment churchId="church-identity" messageId="new-message" authorName="Morgan" attachment={{ ...attachment, id: "new-image" }} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await act(async () => resolveFull({ url: "https://r2.example.test/old/full", expiresAt: new Date(Date.now() + 900_000).toISOString() }));
    fireEvent.click(await screen.findByRole("button", { name: "Open photo from Morgan" }));
    expect(await within(screen.getByRole("dialog")).findByAltText("Shared by Morgan")).toHaveAttribute("src", "https://r2.example.test/new-message/full");
  });
});
