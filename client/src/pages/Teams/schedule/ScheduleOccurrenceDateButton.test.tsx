import { render, screen } from "@testing-library/react";
import ScheduleOccurrenceDateButton from "./ScheduleOccurrenceDateButton";

describe("ScheduleOccurrenceDateButton", () => {
  it("renders the date label in a truncating span so clipped times show ellipsis", () => {
    render(
      <ScheduleOccurrenceDateButton
        label="Sat, Jul 25, 2026, 10:00"
        ariaLabel="View and copy assignments for Sabbath Service on Sat, Jul 25, 2026, 10:00"
        onClick={jest.fn()}
      />,
    );

    const button = screen.getByRole("button", {
      name: "View and copy assignments for Sabbath Service on Sat, Jul 25, 2026, 10:00",
    });
    expect(button).toHaveAttribute("title", "Sat, Jul 25, 2026, 10:00");

    expect(screen.getByText("Sat, Jul 25, 2026, 10:00")).toHaveClass(
      "min-w-0",
      "flex-1",
      "truncate",
    );
  });
});
