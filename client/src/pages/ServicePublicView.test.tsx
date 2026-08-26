import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ServicePublicView from "./ServicePublicView";
import type { PublicServiceFlowSnapshot } from "../services/serviceFlowTypes";

const detailedSnapshot: PublicServiceFlowSnapshot = {
  success: true,
  churchName: "Grace Chapel",
  churchSecondaryColor: "#f59e0b",
  serverNowMs: Date.now(),
  servingTeams: [
    {
      teamId: "worship",
      teamName: "Worship Team",
      members: [
        {
          positionId: "lead",
          positionName: "Lead vocal",
          memberName: "Avery Stone",
          profileImageUrl: "https://example.com/avery.jpg",
          microphones: [
            { id: "mic-blue", name: "Blue", type: "Handheld", color: "#2563eb" },
          ],
        },
      ],
    },
  ],
  service: {
    shareId: "team-share",
    viewMode: "team",
    title: "Sunday Service",
    startsAt: "2099-09-06T15:00:00.000Z",
    timezone: "America/New_York",
    revision: 1,
    sections: [
      {
        id: "worship",
        title: "Worship",
        items: [
          {
            id: "opening-song",
            title: "Opening song",
            durationSeconds: 300,
            notes: { blocks: [] },
            microphoneAssignments: [
              {
                microphone: { id: "mic-blue", name: "Blue", type: "Handheld", color: "#2563eb" },
                audiences: [
                  { positionId: "lead", roleName: "Lead vocal", teamId: "worship", teamName: "Worship Team" },
                ],
              },
            ],
          },
        ],
      },
    ],
    live: { mode: "schedule" },
  },
};

describe("ServicePublicView microphone assignments", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("toggles between dark and light service plan themes and remembers the choice", async () => {
    const user = userEvent.setup();
    render(<ServicePublicView snapshot={detailedSnapshot} />);

    const toggle = screen.getByRole("button", { name: "Switch to light mode" });
    expect(screen.getByRole("main")).toHaveClass("bg-neutral-950");

    await user.click(toggle);

    expect(screen.getByRole("button", { name: "Switch to dark mode" })).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveClass("bg-slate-50");
    expect(localStorage.getItem("worshipsyncServicePublicTheme")).toBe("light");
  });

  it("shows scheduled team microphone assignments beside the detailed plan", () => {
    render(<ServicePublicView snapshot={detailedSnapshot} embedded />);

    const panel = screen.getByRole("complementary", {
      name: "Microphone assignments",
    });
    expect(within(panel).getByRole("heading", { name: "Worship Team" }))
      .toHaveStyle({ color: "#f59e0b" });
    expect(within(panel).getByText("Microphones in use for this service.")).toBeInTheDocument();
    expect(within(panel).getByText("Avery Stone")).toBeInTheDocument();
    expect(within(panel).getByText("Lead vocal")).toBeInTheDocument();
    expect(within(panel).getByText("Blue")).toBeInTheDocument();
  });

  it("shows songs and scripture beneath the item title", () => {
    render(
      <ServicePublicView
        snapshot={{
          ...detailedSnapshot,
          service: {
            ...detailedSnapshot.service,
            sections: [{
              ...detailedSnapshot.service.sections[0],
              items: [{
                ...detailedSnapshot.service.sections[0].items[0],
                songs: ["Opening Song"],
                scriptureRefs: ["Psalm 100:1–5", "John 4:23–24"],
              }],
            }],
          },
        }}
      />,
    );

    const item = within(screen.getByRole("main")).getAllByRole("listitem")[0];
    expect(within(item).getByText("Opening Song")).toBeInTheDocument();
    expect(within(item).getByText("Psalm 100:1–5")).toBeInTheDocument();
    expect(within(item).getByText("John 4:23–24")).toBeInTheDocument();
  });

  it("opens a serving member image in a viewport-constrained modal", async () => {
    const user = userEvent.setup();
    render(<ServicePublicView snapshot={detailedSnapshot} embedded />);

    await user.click(
      screen.getByRole("button", { name: "View profile image of Avery Stone" }),
    );

    const dialog = await screen.findByRole("dialog", {
      name: "Avery Stone profile image",
    });
    expect(within(dialog).getByRole("img", { name: "Avery Stone profile" }))
      .toHaveClass("max-h-[calc(100vh-8rem)]", "max-w-[calc(100vw-2rem)]");
  });

  it("keeps scheduled teams visible when plan items have no microphone assignments", () => {
    render(
      <ServicePublicView
        snapshot={{
          ...detailedSnapshot,
          service: {
            ...detailedSnapshot.service,
            sections: detailedSnapshot.service.sections.map((section) => ({
              ...section,
              items: section.items.map((item) => ({
                ...item,
                microphoneAssignments: [],
              })),
            })),
          },
        }}
        embedded
      />,
    );

    expect(
      screen.getByRole("complementary", { name: "Microphone assignments" }),
    ).toBeInTheDocument();
  });

  it("continues when the browser blocks theme storage", async () => {
    jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Storage is unavailable");
    });
    jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Storage is unavailable");
    });
    const user = userEvent.setup();
    render(<ServicePublicView snapshot={detailedSnapshot} />);

    expect(screen.getByRole("main")).toHaveClass("bg-neutral-950");
    await user.click(screen.getByRole("button", { name: "Switch to light mode" }));
    expect(screen.getByRole("main")).toHaveClass("bg-slate-50");
  });

  it("does not show scheduled teams on the simple public link", () => {
    render(
      <ServicePublicView
        snapshot={{
          ...detailedSnapshot,
          service: { ...detailedSnapshot.service, viewMode: "general" },
        }}
        embedded
      />,
    );

    expect(
      screen.queryByRole("complementary", { name: "Microphone assignments" }),
    ).not.toBeInTheDocument();
  });
});
