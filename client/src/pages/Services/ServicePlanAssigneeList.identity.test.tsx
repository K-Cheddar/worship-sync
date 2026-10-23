import { render, screen } from "@testing-library/react";
import { CurrentMemberIdentityProvider } from "../Teams/components/CurrentUserMemberIndicator";
import ServicePlanAssigneeList from "./ServicePlanAssigneeList";

it("marks a service-plan assignee only by roster member ID and leaves labels intact", () => {
  render(
    <CurrentMemberIdentityProvider memberId="member-self">
      <ServicePlanAssigneeList
        assignees={[
          { id: "assigned-self", name: "Rae Kim", memberId: "member-self" },
          { id: "assigned-other", name: "Rae Kim" },
        ]}
        allowEdit={false}
        microphones={[]}
        assignedToHistoryValues={[]}
        itemLabel="Song"
        onChange={jest.fn()}
      />
    </CurrentMemberIdentityProvider>,
  );

  expect(screen.getAllByText("Rae Kim")).toHaveLength(2);
  expect(screen.getAllByText("You")).toHaveLength(1);
});
