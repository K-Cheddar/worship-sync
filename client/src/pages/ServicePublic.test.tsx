import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ServicePublic from "./ServicePublic";
import { usePublicServiceFlow } from "../services/usePublicServiceFlow";

const flushDoubleRaf = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  });

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
    // Still following live, so the return-to-live button stays hidden.
    expect(screen.queryByRole("button", { name: /Follow live/i })).not.toBeInTheDocument();
  });

  it("shows item times from the plan's own timeline, including pre-service items", () => {
    // Regression: a plan opening at 9:45 before a 10:00 service was rendered
    // from the service start, so every item read late — 10:00 / 10:05 here —
    // while the plan editor showed the operator 9:45 / 9:50.
    const now = Date.now();
    mockUsePublicServiceFlow.mockReturnValue({
      snapshot: {
        success: true,
        churchName: "Northside",
        serverNowMs: now,
        service: {
          shareId: "share-token",
          viewMode: "general",
          title: "Sunday Service",
          startsAt: "2026-07-26T10:00:00.000Z",
          timelineStartsAt: "2026-07-26T09:45:00.000Z",
          timezone: "UTC",
          revision: now,
          live: { mode: "schedule" },
          sections: [{
            id: "main",
            title: "Main service",
            items: [
              { id: "welcome", title: "Welcome", durationSeconds: 300, notes: { blocks: [] } },
              { id: "song", title: "Opening song", durationSeconds: 600, notes: { blocks: [] } },
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

    const times = screen.getAllByText(/\d{1,2}:\d{2}\s?(AM|PM)/i).map(
      (node) => node.textContent,
    );
    expect(times).toContain("9:45 AM");
    expect(times).toContain("9:50 AM");
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
              microphoneAssignments: [{
                microphone: {
                  id: "orange-handheld",
                  name: "Orange",
                  type: "Handheld",
                  color: "#f97316",
                },
                audiences: [{
                  positionId: "camera",
                  roleName: "Camera",
                  teamId: "media",
                  teamName: "Media Team",
                }],
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
    expect(screen.getByText("Show notes for")).toBeInTheDocument();
    expect(screen.getByText("Capture the greetings.")).toBeInTheDocument();
    expect(screen.getByText("Start in key of G.")).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: /Team notes/i }));
    await user.click(await screen.findByRole("option", { name: "Media Team" }));

    expect(screen.getByText("Shared notes")).toBeInTheDocument();
    expect(screen.getByText("Capture the greetings.")).toBeInTheDocument();
    expect(screen.getByText("Orange")).toBeInTheDocument();
    expect(screen.queryByText("Start in key of G.")).not.toBeInTheDocument();
    expect(localStorage.getItem("worshipsyncServicePublicNotesTeam")).toBe("Media Team");
  });

  it("shows selected team and role notes together", async () => {
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
                  notes: { blocks: [{ type: "paragraph", spans: [{ text: "Capture the greeting." }] }] },
                },
                {
                  label: "Worship Team",
                  notes: { blocks: [{ type: "paragraph", spans: [{ text: "Start in key of G." }] }] },
                },
                {
                  scope: "role",
                  positionId: "camera",
                  label: "Media Team · Camera",
                  notes: { blocks: [{ type: "paragraph", spans: [{ text: "Stay wide." }] }] },
                },
                {
                  scope: "role",
                  positionId: "lyrics",
                  label: "Media Team · Lyrics",
                  notes: { blocks: [{ type: "paragraph", spans: [{ text: "Advance on the bridge." }] }] },
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
    await user.click(screen.getByRole("combobox", { name: /Team notes/i }));
    await user.click(await screen.findByRole("option", { name: "Media Team" }));
    await user.click(screen.getByRole("button", { name: /Filter role notes/i }));
    await user.click(screen.getByRole("button", { name: /Camera/ }));

    expect(screen.getByText("Shared cue")).toBeInTheDocument();
    expect(screen.getByText("Capture the greeting.")).toBeInTheDocument();
    expect(screen.getByText("Stay wide.")).toBeInTheDocument();
    expect(screen.queryByText("Start in key of G.")).not.toBeInTheDocument();
    expect(screen.queryByText("Advance on the bridge.")).not.toBeInTheDocument();
    expect(screen.queryByText("Filter by team")).not.toBeInTheDocument();
  });

  it("limits all role notes and role choices to the selected team", async () => {
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
              notes: { blocks: [] },
              teamNotes: [
                {
                  label: "Media Team",
                  notes: { blocks: [{ type: "paragraph", spans: [{ text: "Camera ready." }] }] },
                },
                {
                  label: "Coordinators",
                  notes: { blocks: [{ type: "paragraph", spans: [{ text: "Call the service." }] }] },
                },
                {
                  scope: "role",
                  positionId: "director",
                  label: "Media Team · Director",
                  teamName: "Media Team",
                  notes: { blocks: [{ type: "paragraph", spans: [{ text: "Check the camera." }] }] },
                },
                {
                  scope: "role",
                  positionId: "lead-coordinator",
                  label: "Coordinators · Lead Coordinator",
                  teamName: "Coordinators",
                  notes: { blocks: [{ type: "paragraph", spans: [{ text: "Give the go-live cue." }] }] },
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
    await user.click(screen.getByRole("combobox", { name: /Team notes/i }));
    await user.click(await screen.findByRole("option", { name: "Coordinators" }));

    expect(screen.getByText("Call the service.")).toBeInTheDocument();
    expect(screen.getByText("Give the go-live cue.")).toBeInTheDocument();
    expect(screen.queryByText("Camera ready.")).not.toBeInTheDocument();
    expect(screen.queryByText("Check the camera.")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Filter role notes/i }));
    // Team is already chosen above, so the picker lists role names only.
    expect(screen.getByRole("button", { name: "Lead Coordinator" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Director" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Media Team · Director" })).not.toBeInTheDocument();
  });

  it("scopes team notes to the selected role when all teams are selected", async () => {
    const user = userEvent.setup();
    const now = Date.now();
    mockUsePublicServiceFlow.mockReturnValue({
      snapshot: {
        success: true,
        churchName: "Northside",
        serverNowMs: now,
        roles: [{
          positionId: "front-of-house-audio",
          label: "Front of House Audio",
          teamName: "Media Team",
        }],
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
                { label: "Media Team", notes: { blocks: [{ type: "paragraph", spans: [{ text: "Audio cue." }] }] } },
                { label: "Coordinators", notes: { blocks: [{ type: "paragraph", spans: [{ text: "Coordinator cue." }] }] } },
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
    await user.click(screen.getByRole("button", { name: /Filter role notes/i }));
    await user.click(screen.getByRole("button", { name: "Front of House Audio" }));

    expect(screen.getByText("Shared cue")).toBeInTheDocument();
    expect(screen.getByText("Audio cue.")).toBeInTheDocument();
    expect(screen.queryByText("Coordinator cue.")).not.toBeInTheDocument();
  });

  it("lets a quiet roster role hide other roles notes and clear with All roles", async () => {
    const user = userEvent.setup();
    const now = Date.now();
    mockUsePublicServiceFlow.mockReturnValue({
      snapshot: {
        success: true,
        churchName: "Northside",
        serverNowMs: now,
        roles: [
          {
            positionId: "camera",
            label: "Camera",
            teamId: "media",
            teamName: "Media Team",
          },
          {
            positionId: "sound",
            label: "Sound",
            teamId: "media",
            teamName: "Media Team",
          },
        ],
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
                  notes: { blocks: [{ type: "paragraph", spans: [{ text: "Capture the greeting." }] }] },
                },
                {
                  scope: "role",
                  positionId: "camera",
                  label: "Media Team · Camera",
                  teamId: "media",
                  teamName: "Media Team",
                  notes: { blocks: [{ type: "paragraph", spans: [{ text: "Stay wide." }] }] },
                },
              ],
              microphoneAssignments: [{
                microphone: {
                  id: "orange-handheld",
                  name: "Orange",
                  type: "Handheld",
                  color: "#f97316",
                },
                audiences: [{
                  positionId: "camera",
                  roleName: "Camera",
                  teamId: "media",
                  teamName: "Media Team",
                }],
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
    await user.click(screen.getByRole("combobox", { name: /Team notes/i }));
    await user.click(await screen.findByRole("option", { name: "Media Team" }));
    await user.click(screen.getByRole("button", { name: /Filter role notes/i }));
    expect(screen.getByRole("button", { name: "Sound" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sound" }));

    expect(screen.getByText("Shared cue")).toBeInTheDocument();
    expect(screen.getByText("Capture the greeting.")).toBeInTheDocument();
    expect(screen.queryByText("Stay wide.")).not.toBeInTheDocument();
    expect(screen.queryByText("Orange")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Filter role notes/i }));
    await user.click(screen.getByRole("button", { name: "All roles" }));

    expect(screen.getByText("Stay wide.")).toBeInTheDocument();
    expect(screen.getByText("Orange")).toBeInTheDocument();
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

  it("uses the church primary brand color for section borders when present", () => {
    const now = Date.now();
    mockUsePublicServiceFlow.mockReturnValue({
      snapshot: {
        success: true,
        churchName: "Northside",
        churchPrimaryColor: "#C45C26",
        serverNowMs: now,
        service: {
          shareId: "general-share-token",
          viewMode: "general",
          title: "Sunday Service",
          // Keep the service upcoming so the row is not live (live uses emerald).
          startsAt: new Date(now + 3_600_000).toISOString(),
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
              notes: { blocks: [] },
              teamNotes: [],
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

    expect(screen.getByRole("heading", { name: "Main service" })).not.toHaveStyle({
      color: "rgb(196, 92, 38)",
    });
    expect(
      within(screen.getByRole("region", { name: "Main service" })).getByRole("listitem"),
    ).toHaveStyle({
      borderLeftColor: "rgb(196, 92, 38)",
    });
  });

  it("uses brand color #2 for church name and section titles on the simple view", () => {
    const now = Date.now();
    mockUsePublicServiceFlow.mockReturnValue({
      snapshot: {
        success: true,
        churchName: "Northside",
        churchPrimaryColor: "#C45C26",
        churchSecondaryColor: "#2BB0C8",
        serverNowMs: now,
        service: {
          shareId: "general-share-token",
          viewMode: "general",
          title: "Sunday Service",
          startsAt: new Date(now + 3_600_000).toISOString(),
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
              notes: { blocks: [] },
              teamNotes: [],
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

    expect(screen.getByText("Northside")).toHaveStyle({
      color: "rgb(43, 176, 200)",
    });
    expect(screen.getByRole("heading", { name: "Main service" })).toHaveStyle({
      color: "rgb(43, 176, 200)",
    });
  });

  it("uses brand color #2 for section titles on the detailed view", () => {
    const now = Date.now();
    mockUsePublicServiceFlow.mockReturnValue({
      snapshot: {
        success: true,
        churchName: "Northside",
        churchPrimaryColor: "#C45C26",
        churchSecondaryColor: "#2BB0C8",
        serverNowMs: now,
        service: {
          shareId: "team-share-token",
          viewMode: "team",
          title: "Sunday Service",
          startsAt: new Date(now + 3_600_000).toISOString(),
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
              notes: { blocks: [] },
              teamNotes: [],
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

    expect(screen.getByText("Northside")).not.toHaveStyle({
      color: "rgb(43, 176, 200)",
    });
    expect(screen.getByRole("heading", { name: "Main service" })).toHaveStyle({
      color: "rgb(43, 176, 200)",
    });
  });

  it("keeps neutral church name and section titles on the simple view without brand color #2", () => {
    const now = Date.now();
    mockUsePublicServiceFlow.mockReturnValue({
      snapshot: {
        success: true,
        churchName: "Northside",
        churchPrimaryColor: "#C45C26",
        serverNowMs: now,
        service: {
          shareId: "general-share-token",
          viewMode: "general",
          title: "Sunday Service",
          startsAt: new Date(now + 3_600_000).toISOString(),
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
              notes: { blocks: [] },
              teamNotes: [],
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

    expect(screen.getByText("Northside")).not.toHaveStyle({
      color: "rgb(196, 92, 38)",
    });
    expect(screen.getByRole("heading", { name: "Main service" })).not.toHaveStyle({
      color: "rgb(196, 92, 38)",
    });
  });

  it("scrolls the live item near the top when the current item changes", async () => {
    const scrollIntoView = jest.fn();
    const previousScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;

    const now = Date.now();
    const baseSnapshot = {
      success: true as const,
      churchName: "Northside",
      serverNowMs: now,
      service: {
        shareId: "share-token",
        title: "Sunday Service",
        startsAt: new Date(now - 30_000).toISOString(),
        timezone: "UTC",
        revision: now,
        live: { mode: "manual" as const, currentItemId: "welcome" },
        sections: [{
          id: "main",
          title: "Main service",
          items: [
            {
              id: "welcome",
              title: "Welcome",
              durationSeconds: 120,
              notes: { blocks: [] },
              teamNotes: [],
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
    };

    mockUsePublicServiceFlow.mockReturnValue({
      snapshot: baseSnapshot,
      error: "",
      loading: false,
      connection: "connected",
      revoked: false,
      refresh: jest.fn(),
    });

    try {
      const { rerender } = render(<ServicePublic />);

      await act(async () => {
        await flushDoubleRaf();
      });
      await waitFor(() => {
        expect(scrollIntoView).toHaveBeenCalledWith({
          behavior: "smooth",
          block: "start",
        });
      });
      expect(screen.getByLabelText("Live service item")).toHaveTextContent("Welcome");

      scrollIntoView.mockClear();
      mockUsePublicServiceFlow.mockReturnValue({
        snapshot: {
          ...baseSnapshot,
          service: {
            ...baseSnapshot.service,
            live: { mode: "manual", currentItemId: "song" },
          },
        },
        error: "",
        loading: false,
        connection: "connected",
        revoked: false,
        refresh: jest.fn(),
      });
      rerender(<ServicePublic />);

      await act(async () => {
        await flushDoubleRaf();
      });
      await waitFor(() => {
        expect(scrollIntoView).toHaveBeenCalledWith({
          behavior: "smooth",
          block: "start",
        });
      });
      expect(screen.getByLabelText("Live service item")).toHaveTextContent(
        "Opening song",
      );
    } finally {
      Element.prototype.scrollIntoView = previousScrollIntoView;
    }
  });

  it("pauses auto-scroll after manual scroll and resumes from Follow live", async () => {
    const user = userEvent.setup();
    const scrollIntoView = jest.fn();
    const previousScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;

    const now = Date.now();
    const baseSnapshot = {
      success: true as const,
      churchName: "Northside",
      serverNowMs: now,
      service: {
        shareId: "share-token",
        title: "Sunday Service",
        startsAt: new Date(now - 30_000).toISOString(),
        timezone: "UTC",
        revision: now,
        live: { mode: "manual" as const, currentItemId: "welcome" },
        sections: [{
          id: "main",
          title: "Main service",
          items: [
            {
              id: "welcome",
              title: "Welcome",
              durationSeconds: 120,
              notes: { blocks: [] },
              teamNotes: [],
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
    };

    mockUsePublicServiceFlow.mockReturnValue({
      snapshot: baseSnapshot,
      error: "",
      loading: false,
      connection: "connected",
      revoked: false,
      refresh: jest.fn(),
    });

    try {
      const { rerender } = render(<ServicePublic />);

      await act(async () => {
        await flushDoubleRaf();
      });
      await waitFor(() => {
        expect(scrollIntoView).toHaveBeenCalled();
      });
      scrollIntoView.mockClear();

      fireEvent.wheel(screen.getByRole("main"));

      mockUsePublicServiceFlow.mockReturnValue({
        snapshot: {
          ...baseSnapshot,
          service: {
            ...baseSnapshot.service,
            live: { mode: "manual", currentItemId: "song" },
          },
        },
        error: "",
        loading: false,
        connection: "connected",
        revoked: false,
        refresh: jest.fn(),
      });
      rerender(<ServicePublic />);

      await act(async () => {
        await flushDoubleRaf();
      });
      expect(scrollIntoView).not.toHaveBeenCalled();
      expect(screen.getByLabelText("Live service item")).toHaveTextContent(
        "Opening song",
      );
      expect(screen.getByRole("button", { name: /Follow live/i })).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /Follow live/i }));
      expect(scrollIntoView).toHaveBeenCalledWith({
        behavior: "smooth",
        block: "start",
      });
    } finally {
      Element.prototype.scrollIntoView = previousScrollIntoView;
    }
  });

  it("keeps following when browser scroll anchoring runs during a live-item change", async () => {
    const scrollIntoView = jest.fn();
    const previousScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;

    const now = Date.now();
    const baseSnapshot = {
      success: true as const,
      churchName: "Northside",
      serverNowMs: now,
      service: {
        shareId: "share-token",
        title: "Sunday Service",
        startsAt: new Date(now - 30_000).toISOString(),
        timezone: "UTC",
        revision: now,
        live: { mode: "manual" as const, currentItemId: "welcome" },
        sections: [{
          id: "main",
          title: "Main service",
          items: [
            { id: "welcome", title: "Welcome", durationSeconds: 120, notes: { blocks: [] }, teamNotes: [] },
            { id: "song", title: "Opening song", durationSeconds: 240, notes: { blocks: [] }, teamNotes: [] },
          ],
        }],
      },
    };

    mockUsePublicServiceFlow.mockReturnValue({
      snapshot: baseSnapshot,
      error: "",
      loading: false,
      connection: "connected",
      revoked: false,
      refresh: jest.fn(),
    });

    try {
      const { rerender } = render(<ServicePublic />);
      await act(async () => {
        await flushDoubleRaf();
      });
      scrollIntoView.mockClear();

      // Browser scroll anchoring can dispatch this while React applies the
      // current-item styling, without any viewer scroll input.
      fireEvent.scroll(screen.getByRole("main"));

      mockUsePublicServiceFlow.mockReturnValue({
        snapshot: {
          ...baseSnapshot,
          service: {
            ...baseSnapshot.service,
            live: { mode: "manual", currentItemId: "song" },
          },
        },
        error: "",
        loading: false,
        connection: "connected",
        revoked: false,
        refresh: jest.fn(),
      });
      rerender(<ServicePublic />);

      await act(async () => {
        await flushDoubleRaf();
      });

      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
      expect(screen.queryByRole("button", { name: /Follow live/i })).not.toBeInTheDocument();
    } finally {
      Element.prototype.scrollIntoView = previousScrollIntoView;
    }
  });

  it("keeps following through a long auto-scroll animation instead of pausing on its own tail-end scroll events", async () => {
    const scrollIntoView = jest.fn();
    const previousScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;

    const now = Date.now();
    const baseSnapshot = {
      success: true as const,
      churchName: "Northside",
      serverNowMs: now,
      service: {
        shareId: "share-token",
        title: "Sunday Service",
        startsAt: new Date(now - 30_000).toISOString(),
        timezone: "UTC",
        revision: now,
        live: { mode: "manual" as const, currentItemId: "welcome" },
        sections: [{
          id: "main",
          title: "Main service",
          items: [
            {
              id: "welcome",
              title: "Welcome",
              durationSeconds: 120,
              notes: { blocks: [] },
              teamNotes: [],
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
    };

    mockUsePublicServiceFlow.mockReturnValue({
      snapshot: baseSnapshot,
      error: "",
      loading: false,
      connection: "connected",
      revoked: false,
      refresh: jest.fn(),
    });

    try {
      const { rerender } = render(<ServicePublic />);

      await act(async () => {
        await flushDoubleRaf();
      });
      await waitFor(() => {
        expect(scrollIntoView).toHaveBeenCalled();
      });

      // Simulate a real smooth-scroll animation that runs long because the
      // live item is far down the list: it keeps producing scroll events
      // past the old fixed 1s suppression window, spaced closely enough
      // that it should never be mistaken for a manual scroll.
      const main = screen.getByRole("main");
      await act(async () => {
        for (let elapsed = 0; elapsed <= 1200; elapsed += 150) {
          // eslint-disable-next-line no-await-in-loop
          await new Promise((resolve) => setTimeout(resolve, 150));
          fireEvent.scroll(main);
        }
        // Let the animation's scroll events actually settle before continuing.
        await new Promise((resolve) => setTimeout(resolve, 400));
      });

      scrollIntoView.mockClear();
      mockUsePublicServiceFlow.mockReturnValue({
        snapshot: {
          ...baseSnapshot,
          service: {
            ...baseSnapshot.service,
            live: { mode: "manual", currentItemId: "song" },
          },
        },
        error: "",
        loading: false,
        connection: "connected",
        revoked: false,
        refresh: jest.fn(),
      });
      rerender(<ServicePublic />);

      await act(async () => {
        await flushDoubleRaf();
      });

      // Follow never paused, so the next live-item change auto-scrolls again.
      expect(scrollIntoView).toHaveBeenCalledWith({
        behavior: "smooth",
        block: "start",
      });
    } finally {
      Element.prototype.scrollIntoView = previousScrollIntoView;
    }
  }, 10000);

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
