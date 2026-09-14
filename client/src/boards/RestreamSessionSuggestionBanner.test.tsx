import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RestreamSessionSuggestionBanner from "./RestreamSessionSuggestionBanner";

const mockKeepCurrentRestreamSession = jest.fn();
const mockResetRestreamSession = jest.fn();

jest.mock("./api", () => ({
  keepCurrentRestreamSession: (...args: unknown[]) =>
    mockKeepCurrentRestreamSession(...args),
  resetRestreamSession: (...args: unknown[]) =>
    mockResetRestreamSession(...args),
}));

describe("RestreamSessionSuggestionBanner", () => {
  beforeEach(() => {
    mockKeepCurrentRestreamSession.mockReset();
    mockResetRestreamSession.mockReset();
    mockKeepCurrentRestreamSession.mockResolvedValue({});
    mockResetRestreamSession.mockResolvedValue({});
  });

  it("makes Keep current chat the primary action and calls keep-current", async () => {
    const user = userEvent.setup();
    const onResolved = jest.fn().mockResolvedValue(undefined);
    const showToast = jest.fn();

    render(
      <RestreamSessionSuggestionBanner
        churchId="church-1"
        suggestion={{
          reason: "possible_new_service",
          message: "Restream destinations look different from this session.",
        }}
        onResolved={onResolved}
        showToast={showToast}
      />,
    );

    const keepButton = screen.getByRole("button", {
      name: "Keep current chat",
    });
    const resetButton = screen.getByRole("button", {
      name: "Start new Restream session",
    });
    // Keep is the safety default: listed first and styled as the filled action.
    expect(keepButton.compareDocumentPosition(resetButton)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(keepButton.className).toContain("bg-black");
    expect(resetButton.className).not.toContain("bg-black");

    await user.click(keepButton);

    await waitFor(() => {
      expect(mockKeepCurrentRestreamSession).toHaveBeenCalledWith("church-1");
    });
    expect(mockResetRestreamSession).not.toHaveBeenCalled();
    expect(onResolved).toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      "Keeping the current Restream chat.",
      "success",
    );
  });

  it("calls session reset when Start new Restream session is chosen", async () => {
    const user = userEvent.setup();
    const onResolved = jest.fn().mockResolvedValue(undefined);

    render(
      <RestreamSessionSuggestionBanner
        churchId="church-1"
        suggestion={{
          reason: "day_boundary",
          message: "This Restream session started on a previous day.",
        }}
        onResolved={onResolved}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Start new Restream session" }),
    );

    await waitFor(() => {
      expect(mockResetRestreamSession).toHaveBeenCalledWith("church-1");
    });
    expect(mockKeepCurrentRestreamSession).not.toHaveBeenCalled();
    expect(onResolved).toHaveBeenCalled();
  });

  it("disables both actions while a request is in flight", async () => {
    const user = userEvent.setup();
    let resolveKeep: (() => void) | undefined;
    mockKeepCurrentRestreamSession.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveKeep = resolve;
        }),
    );

    render(
      <RestreamSessionSuggestionBanner
        churchId="church-1"
        suggestion={{
          reason: "possible_new_service",
          message: "Restream destinations look different from this session.",
        }}
        onResolved={jest.fn()}
      />,
    );

    const keepButton = screen.getByRole("button", {
      name: "Keep current chat",
    });
    await user.click(keepButton);

    expect(keepButton).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Start new Restream session" }),
    ).toBeDisabled();

    resolveKeep?.();
    await waitFor(() => {
      expect(keepButton).not.toBeDisabled();
    });
  });
});
