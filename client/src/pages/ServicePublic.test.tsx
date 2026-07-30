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
  beforeEach(() => {
    localStorage.clear();
  });

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
                creditName: "Jamie Rivera",
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
    expect(screen.getByText("Led by")).toHaveTextContent("Jamie Rivera");
    expect(screen.getByText("Up next:")).toHaveTextContent("Opening song");
    expect(screen.getByText("Red mic")).toHaveStyle({ color: "rgb(221, 0, 0)" });
    expect(screen.getByText("Media Team notes")).toBeInTheDocument();
    expect(screen.getByText("Capture the greetings.")).toBeInTheDocument();
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
              teamNotes: [
                {
                  label: "Media Team",
                  notes: { blocks: [{ type: "paragraph", spans: [{ text: "Capture the greetings." }] }] },
                },
                {
                  label: "Worship Team",
                  notes: { blocks: [{ type: "paragraph", spans: [{ text: "Start in key of G." }] }] },
                },
              ],
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
    expect(screen.getByText("Capture the greetings.")).toBeInTheDocument();
    expect(screen.getByText("Start in key of G.")).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: /Team notes/i }));
    await user.click(await screen.findByRole("option", { name: "Media Team" }));

    expect(screen.getByText("Shared notes")).toBeInTheDocument();
    expect(screen.getByText("Capture the greetings.")).toBeInTheDocument();
    expect(screen.queryByText("Start in key of G.")).not.toBeInTheDocument();
    expect(localStorage.getItem("worshipsyncServicePublicNotesTeam")).toBe("Media Team");
  });

  it("restores a saved team notes filter when that team still exists", () => {
    localStorage.setItem("worshipsyncServicePublicNotesTeam", "Media Team");
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
              teamNotes: [
                {
                  label: "Media Team",
                  notes: { blocks: [{ type: "paragraph", spans: [{ text: "Capture the greetings." }] }] },
                },
                {
                  label: "Worship Team",
                  notes: { blocks: [{ type: "paragraph", spans: [{ text: "Start in key of G." }] }] },
                },
              ],
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

    expect(screen.getByRole("combobox", { name: /Team notes/i })).toHaveTextContent(
      "Media Team",
    );
    expect(screen.getByText("Capture the greetings.")).toBeInTheDocument();
    expect(screen.queryByText("Start in key of G.")).not.toBeInTheDocument();
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
    expect(screen.getByText("2 min")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /Team notes/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Operational cue")).not.toBeInTheDocument();
    expect(screen.queryByText("Private media cue")).not.toBeInTheDocument();
  });

  it("shows notes expanded by default and lets operators collapse them", async () => {
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
    expect(screen.getByText("Later cue")).toBeInTheDocument();

    const noteToggles = screen.getAllByRole("button", { name: /^Notes$/i });
    expect(noteToggles).toHaveLength(2);
    await user.click(noteToggles[1]);
    expect(screen.queryByText("Later cue")).not.toBeInTheDocument();
  });
});
