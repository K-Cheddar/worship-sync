import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ControllerServicePlanView from "./ControllerServicePlanView";
import { getServicePlanMicrophones } from "../../api/auth";
import { plainTextToRichText } from "../../types/richText";
import type { ServicePlan } from "../../types/servicePlan";

jest.mock("../../api/auth", () => ({
  getServicePlanMicrophones: jest.fn(),
}));

const mockGetServicePlanMicrophones = jest.mocked(getServicePlanMicrophones);

const plan: ServicePlan = {
  planId: "plan-1",
  churchId: "church-1",
  planKey: "service-1@2026-09-25",
  serviceId: "service-1",
  date: "2026-09-25",
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

describe("ControllerServicePlanView", () => {
  beforeEach(() => {
    localStorage.clear();
    mockGetServicePlanMicrophones.mockResolvedValue({ success: true, microphones: [], audiences: [] });
  });

  it("keeps shared notes visible and filters operational notes for a selected team and role", async () => {
    const user = userEvent.setup();
    render(<ControllerServicePlanView plan={plan} churchId="church-1" controllerProfileId="presentation" />);
    await waitFor(() => expect(mockGetServicePlanMicrophones).toHaveBeenCalledWith("church-1"));
    await user.selectOptions(screen.getByLabelText("Filter service plan notes by team"), "Presentation");
    await user.click(screen.getByLabelText("Text Master"));
    await user.click(screen.getByLabelText("Stage Manager"));

    expect(screen.getByText("Shared safety note")).toBeInTheDocument();
    expect(screen.getByText("Text team cue")).toBeInTheDocument();
    expect(screen.getByText("Stage team cue")).toBeInTheDocument();
    expect(screen.getByText("Presentation team cue")).toBeInTheDocument();
    expect(screen.queryByText("Graphics team cue")).not.toBeInTheDocument();
    expect(screen.getByText("Jordan Rivera")).toBeInTheDocument();
    expect(screen.getByText("18:00")).toBeInTheDocument();
    expect(screen.getByText("1:30")).toBeInTheDocument();
    expect(screen.getByText("Run sheet")).toHaveAttribute("href", "https://example.test/run-sheet");
  });

  it("persists role choices independently by church and controller profile", async () => {
    const user = userEvent.setup();
    const { unmount: unmountPresentation } = render(<ControllerServicePlanView plan={plan} churchId="church-1" controllerProfileId="presentation" />);
    await user.selectOptions(screen.getByLabelText("Filter service plan notes by team"), "Presentation");
    await user.click(screen.getByLabelText("Text Master"));
    unmountPresentation();

    const { unmount: unmountOverlay } = render(<ControllerServicePlanView plan={plan} churchId="church-1" controllerProfileId="overlay" />);
    await user.selectOptions(screen.getByLabelText("Filter service plan notes by team"), "Graphics");
    await user.click(screen.getByLabelText("Graphics Operator"));
    unmountOverlay();

    render(<ControllerServicePlanView plan={plan} churchId="church-1" controllerProfileId="presentation" />);
    expect(screen.getByLabelText("Filter service plan notes by team")).toHaveValue("Presentation");
    expect(screen.getByLabelText("Text Master")).toBeChecked();
    expect(localStorage.getItem("worship-sync:service-plan-operator:church-1:presentation")).toContain("text-master");
    expect(localStorage.getItem("worship-sync:service-plan-operator:church-1:overlay")).toContain("graphics-operator");
  });
});
