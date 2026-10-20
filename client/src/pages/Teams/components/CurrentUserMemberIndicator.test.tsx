import { render, screen } from "@testing-library/react";
import {
  CurrentMemberIdentityProvider,
  MemberNameWithIndicator,
} from "./CurrentUserMemberIndicator";

describe("CurrentUserMemberIndicator", () => {
  it("marks only the exact linked member ID, even when another member has the same name", () => {
    render(
      <CurrentMemberIdentityProvider memberId="member-self">
        <div>
          <MemberNameWithIndicator
            name="Rae Kim"
            memberId="member-self"
          />
          <MemberNameWithIndicator name="Rae Kim" memberId="member-other" />
        </div>
      </CurrentMemberIdentityProvider>,
    );

    expect(screen.getAllByText("Rae Kim")).toHaveLength(2);
    expect(screen.getAllByText("You")).toHaveLength(1);
  });

  it("keeps names readable and hides the indicator when no linked identity is available", () => {
    const { rerender } = render(
      <CurrentMemberIdentityProvider memberId={null}>
        <MemberNameWithIndicator name="Rae Kim" memberId="member-self" />
      </CurrentMemberIdentityProvider>,
    );

    expect(screen.getByText("Rae Kim")).toBeInTheDocument();
    expect(screen.queryByText("You")).not.toBeInTheDocument();

    rerender(
      <CurrentMemberIdentityProvider memberId="member-self">
        <MemberNameWithIndicator name="Rae Kim" memberId={null} />
      </CurrentMemberIdentityProvider>,
    );
    expect(screen.getByText("Rae Kim")).toBeInTheDocument();
    expect(screen.queryByText("You")).not.toBeInTheDocument();
  });
});
