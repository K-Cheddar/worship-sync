import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ServicePublic from "./ServicePublic";
import { usePublicServiceFlow } from "../services/usePublicServiceFlow";

jest.mock("react-router-dom", () => ({
  useParams: () => ({ shareId: "share-token" }),
}));

jest.mock("../services/usePublicServiceFlow", () => ({
  usePublicServiceFlow: jest.fn(),
}));

const mockUsePublicServiceFlow = jest.mocked(usePublicServiceFlow);

describe("ServicePublic", () => {
  it("shows the current item, on-deck context, and safe formatted notes", () => {
    const now = Date.now();
    mockUsePublicServiceFlow.mockReturnValue({
      snapshot: {
        success: true,
        churchName: "Northside",
        serverNowMs: now,
        service: {
          shareId: "share-token",
          title: "Sunday Service",
          startsAt: new Date(now - 30_000).toISOString(),
          timezone: "UTC",
          revision: now,
          live: { mode: "schedule" },
          sections: [{
            id: "main",
            title: "Main service",
            items: [
              {
                id: "welcome",
                title: "Welcome",
                durationSeconds: 120,
                notes: {
                  blocks: [{
                    type: "paragraph",
                    spans: [{ text: "Red mic", color: "#dd0000", bold: true }],
                  }],
                },
                teamNotes: [{
                  label: "Media Team",
                  notes: {
                    blocks: [{
                      type: "paragraph",
                      spans: [{ text: "Capture the greetings." }],
                    }],
                  },
                }],
              },
              {
                id: "song",
                title: "Opening song",
                durationSeconds: 240,
                notes: { blocks: [] },
                teamNotes: [],
              },
            ],
          }],
        },
      },
      error: "",
      loading: false,
      connection: "connected",
      revoked: false,
      refresh: jest.fn(),
    });

    render(<ServicePublic />);

    expect(screen.getByRole("heading", { name: "Welcome" })).toBeInTheDocument();
    expect(screen.getByText("Up next:")).toHaveTextContent("Opening song");
    expect(screen.getByText("Red mic")).toHaveStyle({ color: "#dd0000" });
    expect(screen.getByRole("button", { name: /Jump to current/i })).toBeInTheDocument();
  });

  it("shows notes scoped to the selected team alongside shared notes", async () => {
    const user = userEvent.setup();
    const now = Date.now();
    mockUsePublicServiceFlow.mockReturnValue({
      snapshot: {
        success: true,
        churchName: "Northside",
        serverNowMs: now,
        service: {
          shareId: "share-token",
          title: "Sunday Service",
          startsAt: new Date(now - 30_000).toISOString(),
          timezone: "UTC",
          revision: now,
          live: { mode: "schedule" },
          sections: [{
            id: "main",
            title: "Main service",
            items: [{
              id: "welcome",
              title: "Welcome",
              durationSeconds: 120,
              notes: { blocks: [{ type: "paragraph", spans: [{ text: "Shared cue" }] }] },
              teamNotes: [{
                label: "Media Team",
                notes: { blocks: [{ type: "paragraph", spans: [{ text: "Capture the greetings." }] }] },
              }],
            }],
          }],
        },
      },
      error: "",
      loading: false,
      connection: "connected",
      revoked: false,
      refresh: jest.fn(),
    });

    render(<ServicePublic />);
    await user.click(screen.getByRole("combobox", { name: /View notes for/i }));
    await user.click(await screen.findByRole("option", { name: "Media Team" }));

    expect(screen.getByText("Shared notes")).toBeInTheDocument();
    expect(screen.getByText("Capture the greetings.")).toBeInTheDocument();
  });

  it("keeps operational notes out of the general view while showing credits", () => {
    const now = Date.now();
    mockUsePublicServiceFlow.mockReturnValue({
      snapshot: {
        success: true,
        churchName: "Northside",
        serverNowMs: now,
        service: {
          shareId: "general-share-token",
          viewMode: "general",
          title: "Sunday Service",
          startsAt: new Date(now - 30_000).toISOString(),
          timezone: "UTC",
          revision: now,
          live: { mode: "schedule" },
          sections: [{
            id: "main",
            title: "Main service",
            items: [{
              id: "welcome",
              title: "Welcome",
              durationSeconds: 120,
              creditName: "Jamie Rivera",
              notes: { blocks: [{ type: "paragraph", spans: [{ text: "Operational cue" }] }] },
              teamNotes: [{
                label: "Media Team",
                notes: { blocks: [{ type: "paragraph", spans: [{ text: "Private media cue" }] }] },
              }],
            }],
          }],
        },
      },
      error: "",
      loading: false,
      connection: "connected",
      revoked: false,
      refresh: jest.fn(),
    });

    render(<ServicePublic />);

    expect(screen.getByText("Led by")).toHaveTextContent("Jamie Rivera");
    expect(screen.queryByRole("combobox", { name: /View notes for/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Operational cue")).not.toBeInTheDocument();
    expect(screen.queryByText("Private media cue")).not.toBeInTheDocument();
  });

  it("keeps non-current notes collapsed so the program stays scannable", async () => {
    const user = userEvent.setup();
    const now = Date.now();
    mockUsePublicServiceFlow.mockReturnValue({
      snapshot: {
        success: true,
        churchName: "Northside",
        serverNowMs: now,
        service: {
          shareId: "share-token",
          title: "Sunday Service",
          startsAt: new Date(now - 30_000).toISOString(),
          timezone: "UTC",
          revision: now,
          live: { mode: "schedule" },
          sections: [{
            id: "main",
            title: "Main service",
            items: [
              {
                id: "welcome",
                title: "Welcome",
                durationSeconds: 120,
                notes: { blocks: [{ type: "paragraph", spans: [{ text: "Current cue" }] }] },
                teamNotes: [],
              },
              {
                id: "song",
                title: "Opening song",
                durationSeconds: 240,
                notes: { blocks: [{ type: "paragraph", spans: [{ text: "Later cue" }] }] },
                teamNotes: [],
              },
            ],
          }],
        },
      },
      error: "",
      loading: false,
      connection: "connected",
      revoked: false,
      refresh: jest.fn(),
    });

    render(<ServicePublic />);

    expect(screen.getByText("Current cue")).toBeInTheDocument();
    expect(screen.queryByText("Later cue")).not.toBeInTheDocument();

    const noteToggles = screen.getAllByRole("button", { name: /^Notes$/i });
    expect(noteToggles).toHaveLength(2);
    await user.click(noteToggles[1]);
    expect(screen.getByText("Later cue")).toBeInTheDocument();
  });
});
