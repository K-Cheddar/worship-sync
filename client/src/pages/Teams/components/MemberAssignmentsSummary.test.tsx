import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemberAssignmentsDetails } from "./MemberAssignmentsSummary";

const createRect = (left: number, right: number): DOMRect => ({
  x: left,
  y: 0,
  left,
  right,
  top: 0,
  bottom: 16,
  width: right - left,
  height: 16,
  toJSON: () => ({}),
});

describe("MemberAssignmentsDetails", () => {
  it("counts position names clipped by the assignment text as additional", async () => {
    jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.dataset.memberPosition) {
        const [, index] = JSON.parse(this.dataset.memberPosition) as [string, number];
        const bounds = [[0, 40], [40, 80], [80, 120]][index];
        return createRect(bounds[0], bounds[1]);
      }
      if (this.dataset.testid === "member-assignment-text") return createRect(0, 100);
      return createRect(0, 0);
    });

    render(
      <MemberAssignmentsDetails
        memberName="Alex Kim"
        assignments={[
          { teamId: "worship", teamName: "Worship", positionName: "Vocalist" },
          { teamId: "worship", teamName: "Worship", positionName: "Piano" },
          { teamId: "worship", teamName: "Worship", positionName: "Guitar" },
          { teamId: "worship", teamName: "Worship", positionName: "Drums" },
        ]}
      />,
    );

    const moreButton = await screen.findByRole("button", {
      name: "Show 2 more positions for Alex Kim",
    });
    fireEvent.click(moreButton);

    const moreAssignments = await screen.findByRole("dialog", {
      name: "Additional assignments for Alex Kim",
    });
    expect(within(moreAssignments).getByText("Guitar")).toBeInTheDocument();
    expect(within(moreAssignments).getByText("Drums")).toBeInTheDocument();
  });
});
