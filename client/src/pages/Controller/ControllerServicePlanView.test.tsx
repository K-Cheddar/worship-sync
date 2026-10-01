import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import store from "../../store/store";
import { setActiveItemInList } from "../../store/itemListSlice";
import { getServiceFlowProgress } from "../../services/serviceFlowProgress";
import ControllerServicePlanView from "./ControllerServicePlanView";
import { buildServicePlanFlowSnapshot } from "../buildServicePlanFlowSnapshot";
import { getServicePlanLiveProgress } from "../Services/servicePlanLive";
import { plainTextToRichText } from "../../types/richText";
import type { ServicePlan } from "../../types/servicePlan";

const plan: ServicePlan = {
  planId: "plan-1",
  churchId: "church-1",
  planKey: "service-1@2026-09-25",
  serviceId: "service-1",
  date: "2026-09-25",
  startsAt: "2026-09-25T22:00:00.000Z",
  name: "Friday Service",
  sections: [{
    id: "section-1",
    name: "Worship",
    elements: [{
      id: "welcome",
      type: "free",
      title: plainTextToRichText("Welcome"),
      startTime: "18:00",
      durationSeconds: 90,
      notes: plainTextToRichText("Shared safety note"),
      teamNotes: [
        { id: "text-note", scope: "role", label: "Text Master", teamId: "presentation", teamName: "Presentation", positionId: "text-master", note: plainTextToRichText("Text team cue") },
        { id: "stage-note", scope: "role", label: "Stage Manager", teamId: "presentation", teamName: "Presentation", positionId: "stage-manager", note: plainTextToRichText("Stage team cue") },
        { id: "graphics-note", scope: "role", label: "Graphics Operator", teamId: "graphics", teamName: "Graphics", positionId: "graphics-operator", note: plainTextToRichText("Graphics team cue") },
        { id: "team-note", scope: "team", label: "Presentation", note: plainTextToRichText("Presentation team cue") },
      ],
      assignees: [{ id: "assignee-1", name: "Jordan Rivera", microphoneIds: [] }],
      resources: [
        { id: "resource-1", type: "url", title: "Run sheet", url: "https://example.test/run-sheet" },
        { id: "resource-2", type: "song", title: "Opening Song" },
        { id: "resource-3", type: "scripture", title: "Psalm 100:1–5" },
      ],
    }],
  }],
};

const snapshot = (() => {
  const built = buildServicePlanFlowSnapshot({
    plan,
    startsAt: plan.startsAt!,
    churchName: "Test Church",
  });
  built.roles = [
    { positionId: "text-master", label: "Text Master", teamId: "presentation", teamName: "Presentation" },
    { positionId: "stage-manager", label: "Stage Manager", teamId: "presentation", teamName: "Presentation" },
    { positionId: "graphics-operator", label: "Graphics Operator", teamId: "graphics", teamName: "Graphics" },
    { positionId: "presentation-operator", label: "Presentation Operator", teamId: "presentation", teamName: "Presentation" },
    { positionId: "vocalist", label: "Vocalist", teamId: "worship", teamName: "Worship" },
  ];
  const item = built.service.sections[0].items[0];
  built.service.sections[0].items[0] = {
    ...item,
    microphoneAssignments: [{
      microphone: { id: "mic-vocal", name: "Vocal mic", type: "Headset", color: "#22d3ee" },
      audiences: [{ positionId: "vocalist", roleName: "Vocalist", teamId: "worship", teamName: "Worship" }],
      holderName: "Avery Volunteer",
    }],
    equipmentAssignments: [{
      equipment: { id: "iem-1", name: "IEM 1", category: "iem" },
      holderName: "Avery Volunteer",
    }],
  };
  return built;
})();
const brandColors = {
  sectionLabelColor: "#a855f7",
  sectionBorderColor: "#06b6d4",
};

const renderWithStore = (ui: React.ReactElement) => render(
  <Provider store={store}>{ui}</Provider>,
);

describe("ControllerServicePlanView", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("keeps quiet roster roles selectable while rendering compact controller rows", async () => {
    const user = userEvent.setup();
    renderWithStore(
      <ControllerServicePlanView
        {...brandColors}
        plan={plan}
        snapshot={snapshot}
        churchId="church-1"
        controllerProfileId="presentation"
      />,
    );

    expect(screen.getByRole("heading", { name: "Welcome" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Worship" })).toBeInTheDocument();
    expect(screen.getByText("Shared safety note")).toBeInTheDocument();
    expect(screen.getByText("Presentation team cue")).toBeInTheDocument();
    expect(screen.getByText("Vocal mic")).toBeInTheDocument();
    expect(screen.getByText("IEM 1 · Avery Volunteer")).toBeInTheDocument();
    expect(screen.getByText("18:00")).toBeInTheDocument();
    expect(screen.getByText("1:30")).toBeInTheDocument();
    expect(screen.getByText("Led by:")).toHaveClass("text-zinc-400");
    expect(screen.getByText("Jordan Rivera")).toHaveClass("text-white");
    expect(screen.getByRole("heading", { name: "Welcome" })).toHaveClass("min-w-0", "flex-1", "break-words", "whitespace-normal", "text-xs", "font-semibold");
    expect(screen.getByText("18:00")).toHaveClass("shrink-0");
    expect(screen.getByText("1:30")).toHaveClass("shrink-0");
    expect(screen.getByRole("button", { name: "View Web link: Run sheet" })).toHaveClass("border-neutral-700", "bg-neutral-900/80");
    expect(screen.getByTitle("Song: Opening Song")).toBeInTheDocument();
    expect(screen.getByTitle("Scripture: Psalm 100:1–5")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Worship" })).toHaveClass("px-2.5", "py-1.5");
    expect(screen.getByRole("heading", { name: "Worship" })).toHaveStyle({ color: brandColors.sectionLabelColor });
    expect(screen.getByRole("region", { name: "Service plan section: Worship" })).toHaveStyle({
      borderLeftColor: brandColors.sectionBorderColor,
    });
    expect(screen.getAllByRole("listitem")[0]).toHaveClass("flex", "px-2.5", "py-2");
    expect(screen.getByRole("button", { name: /Filter roles/ })).toHaveClass("!bg-zinc-900", "!border-zinc-700", "!h-7");

    await user.click(screen.getByRole("button", { name: /Filter roles/ }));
    expect(screen.getByRole("button", { name: "Presentation Operator" })).toBeInTheDocument();
  });

  it("filters microphones and role notes by the selected controller role", async () => {
    const user = userEvent.setup();
    renderWithStore(
      <ControllerServicePlanView
        {...brandColors}
        plan={plan}
        snapshot={snapshot}
        churchId="church-1"
        controllerProfileId="presentation"
      />,
    );

    await user.click(screen.getByRole("button", { name: /Filter roles/ }));
    await user.click(screen.getByRole("button", { name: "Presentation Operator" }));
    expect(screen.queryByText("Vocal mic")).not.toBeInTheDocument();
    expect(screen.queryByText("IEM 1 · Avery Volunteer")).not.toBeInTheDocument();
    expect(screen.getByText("Shared safety note")).toBeInTheDocument();
    expect(screen.getByText("Presentation team cue")).toBeInTheDocument();
    expect(screen.queryByText("Graphics team cue")).not.toBeInTheDocument();
    expect(screen.queryByText("Text team cue")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Text Master" }));
    expect(screen.getByText("Text team cue")).toBeInTheDocument();
  });

  it("persists profile-scoped filters and removes stale role ids", async () => {
    const key = "worship-sync:service-plan-operator:church-1:presentation";
    localStorage.setItem(key, JSON.stringify({ teamName: "Presentation", positionIds: ["text-master", "deleted-role"] }));
    renderWithStore(
      <ControllerServicePlanView
        {...brandColors}
        plan={plan}
        snapshot={snapshot}
        churchId="church-1"
        controllerProfileId="presentation"
      />,
    );

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(key) || "{}")).toEqual({
        teamName: "Presentation",
        positionIds: ["text-master"],
      });
    });
    expect(screen.getByRole("combobox", { name: "Team:" })).toHaveTextContent("Presentation");
    expect(within(screen.getByRole("button", { name: /Filter roles/ })).getByText("Text Master")).toBeInTheDocument();
  });

  it("keeps long notes and resources available without expanding the running order", async () => {
    const user = userEvent.setup();
    const longUrl = `https://example.test/${"very-long-resource-path/".repeat(20)}`;
    const resourcePlan = {
      ...plan,
      sections: [{
        ...plan.sections[0],
        elements: [{
          ...plan.sections[0].elements[0],
          notes: plainTextToRichText("A long shared note for the operator."),
          resources: [{ id: "long-url", type: "url" as const, title: "Dropbox link", url: longUrl }],
        }],
      }],
    };
    const resourceSnapshot = buildServicePlanFlowSnapshot({ plan: resourcePlan, startsAt: resourcePlan.startsAt! });
    renderWithStore(
      <ControllerServicePlanView
        {...brandColors}
        plan={resourcePlan}
        snapshot={resourceSnapshot}
        churchId="church-1"
        controllerProfileId="presentation"
      />,
    );

    expect(screen.getByText("Dropbox link")).toBeInTheDocument();
    expect(screen.queryByText(longUrl)).not.toBeInTheDocument();
    expect(screen.getByText(/View notes/)).toBeInTheDocument();
    expect(screen.getByRole("group")).not.toHaveAttribute("open");
    expect(screen.getByText("A long shared note for the operator.")).toBeInTheDocument();

    await user.click(screen.getByText(/View notes/));
    expect(screen.getByRole("group")).toHaveAttribute("open");
    await user.click(screen.getByRole("button", { name: "View Web link: Dropbox link" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("marks the live item clearly and supports an unpublished plan without a viewer snapshot", () => {
    const manualPlan = {
      ...plan,
      publicLive: { mode: "manual" as const, currentElementId: "welcome" },
    };
    renderWithStore(
      <ControllerServicePlanView
        {...brandColors}
        plan={manualPlan}
        churchId="church-1"
        controllerProfileId="presentation"
      />,
    );

    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.getByRole("listitem", { current: true })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("listitem", { current: true })).toHaveClass("border-emerald-400", "bg-emerald-500/[0.07]");
    expect(screen.getByText("Welcome")).toBeInTheDocument();
  });

  it("uses controller surfaces and ignores the standalone public-view theme preference", () => {
    localStorage.setItem("worshipsyncServicePublicTheme", "light");
    const getItem = jest.spyOn(Storage.prototype, "getItem");
    renderWithStore(
      <ControllerServicePlanView
        {...brandColors}
        plan={plan}
        snapshot={snapshot}
        churchId="church-1"
        controllerProfileId="presentation"
      />,
    );

    expect(getItem).not.toHaveBeenCalledWith("worshipsyncServicePublicTheme");
    expect(screen.getByLabelText("Selected service plan running order")).not.toHaveClass("text-gray-100");
    expect(screen.getByRole("heading", { name: "Worship" })).toHaveClass("bg-zinc-950/80");
  });

  it("uses the canonical manual plan override", () => {
    const manualPlan = {
      ...plan,
      publicLive: { mode: "manual" as const, currentElementId: "welcome" },
    };
    const liveSnapshot = buildServicePlanFlowSnapshot({
      plan: manualPlan,
      startsAt: manualPlan.startsAt!,
    });
    renderWithStore(
      <ControllerServicePlanView
        {...brandColors}
        plan={manualPlan}
        snapshot={liveSnapshot}
        churchId="church-1"
        controllerProfileId="presentation"
      />,
    );

    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.getByRole("listitem", { current: true })).toHaveAttribute("aria-current", "true");
  });

  it("highlights the scheduled item and stays unchanged when an outline item is selected", () => {
    const startsAt = new Date(Date.now() - 100_000).toISOString();
    const schedulePlan: ServicePlan = {
      ...plan,
      startsAt,
      sections: [{
        id: "section-1",
        name: "Worship",
        elements: [
          { ...plan.sections[0].elements[0], startTime: undefined, durationSeconds: 90 },
          {
            id: "song",
            type: "free",
            title: plainTextToRichText("Song"),
            durationSeconds: 120,
          },
        ],
      }],
    };
    const ui = (
      <ControllerServicePlanView
        {...brandColors}
        plan={schedulePlan}
        churchId="church-1"
        controllerProfileId="presentation"
      />
    );
    const { rerender } = renderWithStore(ui);

    const liveRow = screen.getByRole("listitem", { current: true });
    expect(within(liveRow).getByRole("heading", { name: "Song" })).toBeInTheDocument();
    expect(getServicePlanLiveProgress(schedulePlan, Date.now())?.current?.item.id).toBe("song");

    // Outline browsing updates Redux selection only. The plan's live row is
    // still determined by the service-flow schedule.
    store.dispatch(setActiveItemInList("outline-welcome"));
    rerender(ui);

    expect(screen.getAllByRole("listitem", { current: true })).toHaveLength(1);
    expect(within(screen.getByRole("listitem", { current: true })).getByRole("heading", { name: "Song" }))
      .toBeInTheDocument();
    expect(within(screen.getByRole("listitem", { current: true })).queryByRole("heading", { name: "Welcome" }))
      .not.toBeInTheDocument();
  });

  it("uses the anchored live timeline and agrees with public service progress", () => {
    const startedAt = new Date(Date.now() - 30_000).toISOString();
    const anchoredPlan: ServicePlan = {
      ...plan,
      publicLive: {
        mode: "anchored",
        currentElementId: "song",
        startedAt,
      },
      sections: [{
        ...plan.sections[0],
        elements: [
          { ...plan.sections[0].elements[0], startTime: undefined, durationSeconds: 90 },
          {
            id: "song",
            type: "free",
            title: plainTextToRichText("Song"),
            durationSeconds: 120,
          },
        ],
      }],
    };
    const publicSnapshot = buildServicePlanFlowSnapshot({
      plan: anchoredPlan,
      startsAt: anchoredPlan.startsAt!,
      serverNowMs: Date.now(),
    });
    const controllerProgress = getServicePlanLiveProgress(anchoredPlan, Date.now());
    const publicProgress = getServiceFlowProgress(publicSnapshot.service, Date.now());

    expect(controllerProgress?.current?.item.id).toBe("song");
    expect(controllerProgress?.current?.item.id).toBe(publicProgress.current?.item.id);

    renderWithStore(
      <ControllerServicePlanView
        {...brandColors}
        plan={anchoredPlan}
        snapshot={publicSnapshot}
        churchId="church-1"
        controllerProfileId="presentation"
      />,
    );
    expect(within(screen.getByRole("listitem", { current: true })).getByRole("heading", { name: "Song" }))
      .toBeInTheDocument();
  });

  it("filters the compact microphone cues by team while retaining shared notes", async () => {
    const user = userEvent.setup();
    renderWithStore(
      <ControllerServicePlanView
        {...brandColors}
        plan={plan}
        snapshot={snapshot}
        churchId="church-1"
        controllerProfileId="presentation"
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "Team:" }));
    await user.click(screen.getByRole("option", { name: "Presentation" }));
    expect(screen.queryByText("Vocal mic")).not.toBeInTheDocument();
    expect(screen.getByText("Shared safety note")).toBeInTheDocument();
  });
});
