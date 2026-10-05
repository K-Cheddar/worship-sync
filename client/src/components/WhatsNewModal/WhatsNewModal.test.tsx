import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WhatsNewModal from "./WhatsNewModal";

const note = {
  id: "2026-10-02-media-transfers",
  date: "2026-10-02",
  type: "improved" as const,
  title: "Media transfers",
  description: "Transfer progress is easier to follow.",
};

describe("WhatsNewModal", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it("shows loading while fetching and groups updates by date", async () => {
    const user = userEvent.setup();
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        notes: [
          note,
          { ...note, id: "2026-10-02-equipment", title: "Equipment assignments", type: "new" },
          { ...note, id: "2026-10-01-members", date: "2026-10-01", title: "Member photos", type: "fixed" },
        ],
      }),
    } as Response);

    render(<WhatsNewModal isOpen onClose={jest.fn()} />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading updates...");
    expect(await screen.findByText("Media transfers")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "October 2, 2026" })).toHaveTextContent("Equipment assignments");
    expect(screen.getByRole("region", { name: "October 1, 2026" })).toHaveTextContent("Member photos");
    expect(screen.getByRole("button", { name: "October 2, 2026" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "October 1, 2026" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("New")).toBeVisible();
    expect(screen.getByText("Improved")).toBeVisible();
    expect(screen.getByText("Member photos")).not.toBeVisible();
    await user.click(screen.getByRole("button", { name: "October 1, 2026" }));
    expect(screen.getByText("Member photos")).toBeVisible();
    expect(screen.getByText("Fixed")).toBeVisible();
    expect(screen.getByText("Media transfers")).toBeVisible();
  });

  it("lets each date collapse and expand independently with the keyboard", async () => {
    const user = userEvent.setup();
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ notes: [note, { ...note, id: "older", date: "2026-10-01", title: "Older update" }] }),
    } as Response);
    render(<WhatsNewModal isOpen onClose={jest.fn()} />);
    const newest = await screen.findByRole("button", { name: "October 2, 2026" });
    await user.click(newest);
    expect(newest).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Media transfers")).not.toBeVisible();
    await user.keyboard("{Enter}");
    expect(newest).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Media transfers")).toBeVisible();
    await user.tab();
    await user.keyboard(" ");
    expect(screen.getByRole("button", { name: "October 1, 2026" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Older update")).toBeVisible();
    await user.keyboard(" ");
    expect(screen.getByText("Older update")).not.toBeVisible();
    expect(screen.getByText("Media transfers")).toBeVisible();
  });

  it("resets to only the newest date expanded when reopened", async () => {
    const user = userEvent.setup();
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ notes: [note, { ...note, id: "older", date: "2026-10-01", title: "Older update" }] }),
    } as Response);
    const onClose = jest.fn();
    const { rerender } = render(<WhatsNewModal isOpen onClose={onClose} />);
    await user.click(await screen.findByRole("button", { name: "October 2, 2026" }));
    await user.click(screen.getByRole("button", { name: "October 1, 2026" }));
    expect(screen.getByText("Older update")).toBeVisible();
    expect(screen.getByText("Media transfers")).not.toBeVisible();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(<WhatsNewModal isOpen={false} onClose={onClose} />);
    rerender(<WhatsNewModal isOpen onClose={onClose} />);
    expect(await screen.findByText("Media transfers")).toBeVisible();
    expect(screen.getByRole("button", { name: "October 2, 2026" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "October 1, 2026" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Older update")).not.toBeVisible();
  });

  it("shows an empty state when no updates are available", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ notes: [] }),
    } as Response);

    render(<WhatsNewModal isOpen onClose={jest.fn()} />);

    expect(await screen.findByText("No updates yet.")).toBeInTheDocument();
  });

  it("shows an error and retries the request", async () => {
    const user = userEvent.setup();
    const fetchMock = jest
      .spyOn(global, "fetch")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ notes: [note] }),
      } as Response);

    render(<WhatsNewModal isOpen onClose={jest.fn()} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn’t load updates. Check your connection and try again.",
    );
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Media transfers")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
