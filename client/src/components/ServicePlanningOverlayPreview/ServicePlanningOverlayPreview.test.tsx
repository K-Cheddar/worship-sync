import { render, screen, within } from "@testing-library/react";
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


test("distinguishes matched overlays from field updates", () => {
  const base = {
    sectionName: "Worship", sourceRowIndex: 0, elementType: "free", title: "Welcome",
    ledBy: "", personIndex: 0, rawNameToken: "", action: "update" as const,
    patch: { name: "Alex", title: "", event: "Welcome" },
  };
  render(<ServicePlanningOverlayPreview
    items={[
      { ...base, placementOnly: true, targetOverlayName: "Existing host" },
      { ...base, sourceRowIndex: 1, targetOverlayName: "Changing host" },
    ]}
    expanded
    onExpandedChange={jest.fn()}
  />);

  const [matched, updated] = screen.getAllByRole("listitem");
  expect(within(matched).getByText("Found existing")).toBeInTheDocument();
  expect(within(matched).getByText(/Matched overlay:/)).toHaveTextContent("Matched overlay: Existing host");
  expect(within(matched).queryByText(/^Update:/)).not.toBeInTheDocument();
  expect(within(updated).getByText("Update existing")).toBeInTheDocument();
  expect(within(updated).getByText(/^Update:/)).toHaveTextContent("Update: Changing host");
});
