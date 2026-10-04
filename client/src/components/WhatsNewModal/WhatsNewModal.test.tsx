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
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.getByText("Improved")).toBeInTheDocument();
    expect(screen.getByText("Fixed")).toBeInTheDocument();
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
