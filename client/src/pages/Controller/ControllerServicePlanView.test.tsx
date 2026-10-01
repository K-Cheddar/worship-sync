import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ControllerServicePlanView from "./ControllerServicePlanView";
import { buildServicePlanFlowSnapshot } from "../buildServicePlanFlowSnapshot";
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
      resources: [{ id: "resource-1", type: "url", title: "Run sheet", url: "https://example.test/run-sheet" }],
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

describe("ControllerServicePlanView", () => {
  beforeEach(() => localStorage.clear());

  it("keeps quiet roster roles selectable while rendering compact controller rows", async () => {
    const user = userEvent.setup();
    render(
      <ControllerServicePlanView
        plan={plan}
        snapshot={snapshot}
        churchId="church-1"
        controllerProfileId="presentation"
      />,
    );

    expect(screen.getByText("Welcome")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Worship" })).toBeInTheDocument();
    expect(screen.getByText("Shared safety note")).toBeInTheDocument();
    expect(screen.getByText("Presentation team cue")).toBeInTheDocument();
    expect(screen.getByText("Vocal mic")).toBeInTheDocument();
    expect(screen.getByText("IEM 1 · Avery Volunteer")).toBeInTheDocument();
    expect(screen.getByText("18:00")).toBeInTheDocument();
    expect(screen.getByText("1:30")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Filter roles/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Filter roles/ }));
    expect(screen.getByRole("button", { name: "Presentation Operator" })).toBeInTheDocument();
  });

  it("filters microphones and role notes by the selected controller role", async () => {
    const user = userEvent.setup();
    render(
      <ControllerServicePlanView
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
    expect(screen.queryByText("Text team cue")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Text Master" }));
    expect(screen.getByText("Text team cue")).toBeInTheDocument();
  });

  it("persists profile-scoped filters and removes stale role ids", async () => {
    const key = "worship-sync:service-plan-operator:church-1:presentation";
    localStorage.setItem(key, JSON.stringify({ teamName: "Presentation", positionIds: ["text-master", "deleted-role"] }));
    render(
      <ControllerServicePlanView
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
    expect(screen.getByRole("combobox", { name: /Filter service plan by team/ })).toHaveValue("Presentation");
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
    render(
      <ControllerServicePlanView
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
    await user.click(screen.getByRole("button", { name: "View resource: Dropbox link" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("marks the live item clearly and supports an unpublished plan without a viewer snapshot", () => {
    render(
      <ControllerServicePlanView
        plan={plan}
        churchId="church-1"
        controllerProfileId="presentation"
        activeItemId="welcome"
      />,
    );

    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.getByRole("listitem")).toHaveAttribute("aria-current", "true");
    expect(screen.getByText("Welcome")).toBeInTheDocument();
  });

  it("follows the current item from the shared service snapshot", () => {
    const liveSnapshot = {
      ...snapshot,
      service: { ...snapshot.service, live: { mode: "manual" as const, currentItemId: "welcome" } },
    };
    render(
      <ControllerServicePlanView
        plan={plan}
        snapshot={liveSnapshot}
        churchId="church-1"
        controllerProfileId="presentation"
      />,
    );

    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.getByRole("listitem")).toHaveAttribute("aria-current", "true");
  });

  it("filters the compact microphone cues by team while retaining shared notes", async () => {
    const user = userEvent.setup();
    render(
      <ControllerServicePlanView
        plan={plan}
        snapshot={snapshot}
        churchId="church-1"
        controllerProfileId="presentation"
      />,
    );

    await user.selectOptions(screen.getByRole("combobox", { name: "Filter service plan by team" }), "Presentation");
    expect(screen.queryByText("Vocal mic")).not.toBeInTheDocument();
    expect(screen.getByText("Shared safety note")).toBeInTheDocument();
  });
});
