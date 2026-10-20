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

  it("keeps a long self name truncated beside its badge in a compact row", () => {
    const name = "Alexandria Longlastname With An Exceptionally Long Display Name";

    render(
      <CurrentMemberIdentityProvider memberId="member-self">
        <div className="w-24 min-w-0">
          <MemberNameWithIndicator
            name={name}
            memberId="member-self"
            className="block w-full"
          />
        </div>
      </CurrentMemberIdentityProvider>,
    );

    const nameWithIndicator = screen.getByTestId("member-name-with-indicator");
    expect(nameWithIndicator).toHaveClass("inline-flex", "w-full", "min-w-0");
    expect(nameWithIndicator).not.toHaveClass("block");
    expect(screen.getByText(name)).toHaveClass("min-w-0", "truncate");
    expect(screen.getByText("You")).toHaveClass("shrink-0", "whitespace-nowrap");
  });
});
