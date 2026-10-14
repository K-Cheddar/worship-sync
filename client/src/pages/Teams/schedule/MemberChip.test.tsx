import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import MemberChip from "./MemberChip";

describe("MemberChip details", () => {
  it("renders deferred details on expansion and keeps them through the close transition", async () => {
    const renderDetails = jest.fn(() => <p>Member serving history</p>);
    const Harness = () => {
      const [expanded, setExpanded] = useState(false);
      return (
        <MemberChip
          label="Avery"
          expanded={expanded}
          renderDetails={renderDetails}
          onToggleExpand={() => setExpanded((current) => !current)}
        />
      );
    };
    render(<Harness />);

    expect(renderDetails).not.toHaveBeenCalled();
    expect(screen.queryByText("Member serving history")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show details for Avery" }));
    expect(renderDetails).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Member serving history")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Hide details for Avery" }));
    expect(screen.getByText("Member serving history")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("Member serving history")).not.toBeInTheDocument();
    });
  });
});
