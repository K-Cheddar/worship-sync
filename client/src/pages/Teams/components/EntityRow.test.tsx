import { render, screen } from "@testing-library/react";
import EntityRow from "./EntityRow";

describe("EntityRow", () => {
  it("shows a top-end header badge when the row is not clickable", () => {
    render(
      <EntityRow
        title="Fall Volunteers"
        subtitle="Sep 1 – Sep 30"
        canEdit={false}
        headerBadge={<span>Open</span>}
        headerBadgePlacement="top-end"
      />,
    );

    expect(screen.getByText("Open")).toBeInTheDocument();
  });
});
