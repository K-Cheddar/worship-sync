import { render, screen } from "@testing-library/react";
import ServicePlanningOverlayPreview from "./ServicePlanningOverlayPreview";

describe("ServicePlanningOverlayPreview empty states", () => {
  it("explains how to assign participants when the plan has none", () => {
    render(<ServicePlanningOverlayPreview
      items={[]}
      expanded
      onExpandedChange={jest.fn()}
      nativeSummary={{ status: "ready", selectedItemCount: 0, assignedParticipantCount: 0 }}
    />);

    expect(screen.getByText(/No participants are assigned to this plan/)).toHaveTextContent(/Led by/);
    expect(screen.queryByText(/Turn on the setting|selected for participant overlays/i)).not.toBeInTheDocument();
  });

  it.each(["failed", "restricted"] as const)("keeps a %s projection distinct from no participants", (status) => {
    render(<ServicePlanningOverlayPreview
      items={[]}
      expanded
      onExpandedChange={jest.fn()}
      nativeSummary={{ status, selectedItemCount: 0, assignedParticipantCount: null }}
    />);

    expect(screen.getByText(/Participant details (could not be loaded|are not available)/)).toBeInTheDocument();
    expect(screen.queryByText(/No participants are assigned/)).not.toBeInTheDocument();
  });
});
