import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ServicePublicView from "./ServicePublicView";
import type { PublicServiceFlowSnapshot } from "../services/serviceFlowTypes";
import { buildServicePlanFlowSnapshot } from "./buildServicePlanFlowSnapshot";
import { createServicePlanTextResource } from "./Services/servicePlanResources";

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
          equipment: [
            { id: "iem-red", name: "Red", category: "iem", subtype: "wireless-beltpack", color: "#ef4444" },
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

describe("ServicePublicView equipment assignments", () => {
  let originalScrollIntoView: PropertyDescriptor | undefined;
  let scrollIntoViewWasPatched = false;

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (scrollIntoViewWasPatched) {
      if (originalScrollIntoView) {
        Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScrollIntoView);
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
      }
      originalScrollIntoView = undefined;
      scrollIntoViewWasPatched = false;
    }
  });

  it("scrolls the live item below a supplied sticky page header", async () => {
    originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
    scrollIntoViewWasPatched = true;
    const scrollIntoView = jest.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute("data-current-service-toolbar")) {
        return { height: 132 } as DOMRect;
      }
      return { height: 0 } as DOMRect;
    });

    render(
      <ServicePublicView
        snapshot={{
          ...detailedSnapshot,
          service: {
            ...detailedSnapshot.service,
            live: { mode: "manual", currentItemId: "opening-song" },
          },
        }}
        pageHeader={
          <div role="toolbar" aria-label="Current service toolbar" data-current-service-toolbar />
        }
      />,
    );

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    expect(screen.getAllByRole("listitem")[0]).toHaveStyle({ scrollMarginTop: "148px" });
    const equipmentPanel = screen.getByRole("complementary", { name: "Equipment assignments" });
    expect(equipmentPanel).toHaveClass(
      "lg:max-h-[calc(100dvh-6rem)]",
    );
    // The separate sticky wrapper reserves room for the current-service toolbar.
    // eslint-disable-next-line testing-library/no-node-access
    expect(equipmentPanel.parentElement).toHaveClass("lg:top-20");
  });

  it("toggles between dark and light service plan themes and remembers the choice", async () => {
    const user = userEvent.setup();
    render(<ServicePublicView snapshot={detailedSnapshot} />);

    const toggle = screen.getByRole("button", { name: "Switch to light mode" });
    expect(screen.getByRole("button", { name: /fullscreen/i })).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveClass("bg-neutral-950");

    await user.click(toggle);

    expect(screen.getByRole("button", { name: "Switch to dark mode" })).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveClass("bg-slate-50");
    expect(localStorage.getItem("worshipsyncServicePublicTheme")).toBe("light");
  });

  it("keeps the anonymous public plan's equipment panel below its existing page top", () => {
    render(<ServicePublicView snapshot={detailedSnapshot} />);

    const equipmentPanel = screen.getByRole("complementary", { name: "Equipment assignments" });
    expect(screen.queryByRole("toolbar", { name: "Current service toolbar" })).not.toBeInTheDocument();
    expect(equipmentPanel).toHaveClass("lg:max-h-[calc(100dvh-2rem)]");
    // Anonymous public pages have no added sticky toolbar.
    // eslint-disable-next-line testing-library/no-node-access
    expect(equipmentPanel.parentElement).toHaveClass("lg:top-4");
  });

  it("restores the selected role-note filter from local storage", () => {
    localStorage.setItem("worshipsyncServicePublicNotesRole", "lead");
    render(
      <ServicePublicView
        snapshot={{
          ...detailedSnapshot,
          roles: [{ positionId: "lead", label: "Lead vocal", teamId: "worship", teamName: "Worship Team" }],
          service: {
            ...detailedSnapshot.service,
            sections: [{
              ...detailedSnapshot.service.sections[0],
              items: [{
                ...detailedSnapshot.service.sections[0].items[0],
                teamNotes: [{
                  scope: "role",
                  positionId: "lead",
                  label: "Worship Team · Lead vocal",
                  notes: { blocks: [{ type: "paragraph", spans: [{ text: "Check the monitor mix." }] }] },
                }],
              }],
            }],
          },
        }}
      />,
    );

    expect(screen.getByRole("button", { name: /Filter role notes/i })).toHaveTextContent("Lead vocal");
    expect(screen.getByText("Check the monitor mix.")).toBeInTheDocument();
  });

  it("shows scheduled team equipment beside the detailed plan", () => {
    render(<ServicePublicView snapshot={detailedSnapshot} embedded />);

    const panel = screen.getByRole("complementary", {
      name: "Equipment assignments",
    });
    // Embedded views have no page toolbar and retain their existing sticky offset.
    // eslint-disable-next-line testing-library/no-node-access
    expect(panel.parentElement).toHaveClass("lg:top-4");
    expect(panel).toHaveClass(
      "lg:max-h-[calc(100dvh-2rem)]",
      "lg:overflow-y-auto",
      "lg:overscroll-contain",
    );
    expect(within(panel).getByRole("heading", { name: "Worship Team" }))
      .toHaveStyle({ color: "#f59e0b" });
    expect(within(panel).getByText("Equipment in use for this service.")).toBeInTheDocument();
    expect(within(panel).getByText("Avery Stone")).toBeInTheDocument();
    expect(within(panel).getByText("Lead vocal")).toBeInTheDocument();
    expect(within(panel).getByText("Blue")).toBeInTheDocument();
    expect(within(panel).getByText("Red")).toBeInTheDocument();
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

  it("shows title-only and notes-only resources and previews their rich notes", async () => {
    const notes = { blocks: [{ type: "paragraph" as const, spans: [{ text: "Formatted cue", bold: true, italic: true }] }] };
    const snapshot = buildServicePlanFlowSnapshot({
      plan: {
        planId: "resources", churchId: "church-1", planKey: "resources", serviceId: "service-1", date: "2099-09-06",
        name: "Service", sections: [{ id: "main", name: "Main", elements: [{
          id: "cues", type: "free", title: { blocks: [] },
          resources: [
            createServicePlanTextResource({ title: "Title only", text: { blocks: [] } }),
            createServicePlanTextResource({ title: "", text: notes }),
          ],
        }] }],
      },
      startsAt: "2099-09-06T15:00:00.000Z",
    });
    render(<ServicePublicView snapshot={snapshot} />);
    expect(screen.getByText("Title only")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "View Notes: Notes" }));
    expect(screen.getByText("Formatted cue")).toHaveClass("font-bold", "italic");
  });

  it("shows every resource type with wrapped titles, details, and safe links", async () => {
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
                resources: [
                  { type: "song", title: "Opening Song with a deliberately long title that should wrap on narrow screens" },
                  { type: "scripture", title: "Psalm 100:1–5" },
                  {
                    type: "url",
                    title: "Rehearsal video",
                    url: "https://example.com/rehearsal",
                  },
                  { type: "youtube", title: "Sermon video", url: "https://youtube.com/watch?v=abc123" },
                  { type: "audio", title: "Reference audio" },
                  { type: "document", title: "Private church document" },
                  { type: "custom-document", title: "Presentation Notes" },
                  {
                    type: "text",
                    title: "Call notes",
                    detail: "Bring the spare cable.",
                  },
                  { type: "unrecognized-type", title: "Future resource", detail: "Future details" },
                ],
              }],
            }],
          },
        }}
      />,
    );

    const item = within(screen.getByRole("main")).getAllByRole("listitem")[0];
    expect(within(item).getByRole("button", { name: "View Web link: Rehearsal video" })).toBeInTheDocument();
    expect(within(item).getByRole("button", { name: "View YouTube: Sermon video" })).toBeInTheDocument();
    expect(within(item).getByRole("button", { name: "View Notes: Call notes" })).toBeInTheDocument();
    expect(within(item).getByText("Opening Song with a deliberately long title that should wrap on narrow screens")).toBeInTheDocument();
    expect(within(item).getByText("Psalm 100:1–5")).toBeInTheDocument();
    expect(within(item).getByText("Reference audio")).toBeInTheDocument();
    expect(within(item).getByText("Private church document")).toBeInTheDocument();
    expect(within(item).getByText("Presentation Notes")).toBeInTheDocument();
    expect(within(item).getByRole("button", { name: "View Other: Future resource" })).toBeInTheDocument();
    expect(within(item).queryByRole("button", { name: /Private church document/i })).not.toBeInTheDocument();
    expect(within(item).getByText(/Opening Song with a deliberately long title/)).toHaveClass("break-words");

    await userEvent.setup().click(within(item).getByRole("button", { name: "View Notes: Call notes" }));
    expect(await screen.findByText("Bring the spare cable.")).toBeInTheDocument();
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
      screen.getByRole("complementary", { name: "Equipment assignments" }),
    ).toBeInTheDocument();
  });

  it("renders an IEM-only scheduled member and item-level IEM assignment", () => {
    const iemSnapshot: PublicServiceFlowSnapshot = {
      ...detailedSnapshot,
      servingTeams: [{
        teamId: "worship",
        teamName: "Worship Team",
        members: [{
          positionId: "lead",
          positionName: "Lead vocal",
          memberName: "Clover Palmer",
          microphones: [],
          equipment: [{ id: "iem-red", name: "Red", category: "iem", subtype: "wireless-beltpack", color: "#ef4444" }],
        }],
      }],
      service: {
        ...detailedSnapshot.service,
        sections: [{
          ...detailedSnapshot.service.sections[0],
          items: [{
            ...detailedSnapshot.service.sections[0].items[0],
            equipmentAssignments: [{
              equipment: { id: "iem-red", name: "Red", category: "iem", subtype: "wireless-beltpack", color: "#ef4444" },
              holderName: "Clover Palmer",
            }],
          }],
        }],
      },
    };
    render(<ServicePublicView snapshot={iemSnapshot} embedded />);

    expect(screen.getByLabelText("Red · Wireless beltpack · Clover Palmer")).toBeInTheDocument();
    expect(screen.getByLabelText("Red · Wireless beltpack")).toBeInTheDocument();
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
      screen.queryByRole("complementary", { name: "Equipment assignments" }),
    ).not.toBeInTheDocument();
  });
});
