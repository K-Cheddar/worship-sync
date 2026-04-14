import { render, screen } from "@testing-library/react";
import { LastUpdatedByline } from "./LastUpdatedByline";

describe("LastUpdatedByline", () => {
  it("renders name and formatted time when both are set", () => {
    render(
      <LastUpdatedByline
        updatedBy="pat@uid"
        updatedAt="2020-05-01T15:30:00.000Z"
      />,
    );
    expect(screen.getByText(/Last updated by pat@uid on/)).toBeInTheDocument();
  });

  it("renders time-only line when updatedBy is missing", () => {
    render(<LastUpdatedByline updatedAt="2020-05-01T15:30:00.000Z" />);
    expect(screen.getByText(/Last updated on/)).toBeInTheDocument();
    expect(screen.queryByText(/Last updated by/)).not.toBeInTheDocument();
  });

  it("renders nothing when no timestamp", () => {
    const { container } = render(
      <LastUpdatedByline updatedBy="only-name-no-time" />,
    );
    expect(container.firstChild).toBeNull();
  });
});
