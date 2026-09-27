import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { plainTextToRichText } from "../../types/richText";
import type { ServicePlanSection } from "../../types/servicePlan";
import ServicePlanAmbiguityReview from "./ServicePlanAmbiguityReview";

const sections: ServicePlanSection[] = [{
  id: "section-1",
  name: "Reading",
  elements: [{
    id: "element-1",
    type: "free",
    title: plainTextToRichText("Reading the Word"),
    importAmbiguity: {
      source: "servicePlanning",
      sourceKey: "Reading:0",
      sourceElementType: "Reading",
      sourceTitle: "Psalms 97 Jasmine Williams",
      sourceLedBy: "Jeriyah Brown",
      parts: [{ kind: "description", value: "Jasmine Williams", destination: "content" }],
      reasons: ["The remaining title text is uncertain."],
      status: "unresolved",
      sourceFingerprint: "source",
    },
  }],
}];

describe("ServicePlanAmbiguityReview", () => {
  it("offers a compact defer prompt and lets the operator open the per-item review", async () => {
    const user = userEvent.setup();
    const onLater = jest.fn();
    const onResolve = jest.fn();
    render(<ServicePlanAmbiguityReview sections={sections} elementIds={["element-1"]} prompt onLater={onLater} onResolve={onResolve} />);

    expect(screen.getByText(/1 imported item needs a quick interpretation review/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Review later" }));
    expect(onLater).toHaveBeenCalledTimes(1);
  });

  it("shows original source fields and confirms a selected interpretation", async () => {
    const user = userEvent.setup();
    const onResolve = jest.fn();
    render(<ServicePlanAmbiguityReview sections={sections} elementIds={["element-1"]} prompt onLater={jest.fn()} onResolve={onResolve} />);
    await user.click(screen.getByRole("button", { name: "Review items" }));

    expect(screen.getByText("Psalms 97 Jasmine Williams")).toBeInTheDocument();
    expect(screen.getByText("Jeriyah Brown")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm interpretation" }));

    expect(onResolve).toHaveBeenCalledWith("element-1", expect.objectContaining({
      importAmbiguity: expect.objectContaining({ status: "confirmed", reasons: [] }),
    }));
    const changes = onResolve.mock.calls[0][1];
    expect(changes.resources).toHaveLength(1);
    expect(changes.resources?.[0]).toMatchObject({
      type: "text",
      title: "Imported description",
    });
  });

  it("acknowledges without applying any suggested field changes", async () => {
    const user = userEvent.setup();
    const onResolve = jest.fn();
    render(<ServicePlanAmbiguityReview sections={sections} elementIds={["element-1"]} prompt onLater={jest.fn()} onResolve={onResolve} />);
    await user.click(screen.getByRole("button", { name: "Review items" }));
    await user.click(screen.getByRole("button", { name: "Acknowledge as-is" }));

    expect(onResolve).toHaveBeenCalledWith("element-1", {
      importAmbiguity: expect.objectContaining({ status: "acknowledged" }),
    });
    expect(onResolve.mock.calls[0][1]).not.toHaveProperty("assignees");
    expect(onResolve.mock.calls[0][1]).not.toHaveProperty("resources");
  });

  it("can defer one item and leave it available for a later review", async () => {
    const user = userEvent.setup();
    const onResolve = jest.fn();
    render(<ServicePlanAmbiguityReview sections={sections} elementIds={["element-1"]} prompt onLater={jest.fn()} onResolve={onResolve} />);
    await user.click(screen.getByRole("button", { name: "Review items" }));
    await user.click(screen.getByRole("button", { name: "Leave for later" }));

    expect(onResolve).toHaveBeenCalledWith("element-1", {
      importAmbiguity: expect.objectContaining({ status: "deferred" }),
    });
  });
});
