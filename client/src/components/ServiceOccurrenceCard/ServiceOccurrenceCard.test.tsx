import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import ServiceOccurrenceCard from "./ServiceOccurrenceCard";

const renderCard = (overrides: Partial<ComponentProps<typeof ServiceOccurrenceCard>> = {}) => {
  const onOpen = jest.fn();
  const props: ComponentProps<typeof ServiceOccurrenceCard> = {
    calendarDate: "2026-10-21",
    startsAt: "2026-10-21T14:30:00.000Z",
    timeZone: "UTC",
    serviceName: "Sabbath Service",
    ariaLabel: "Open Sabbath Service on Wed, Oct 21, 10:30 AM",
    isNextUpcoming: false,
    isToday: false,
    statusTone: "neutral",
    onOpen,
    ...overrides,
  };
  const view = render(
    <ul>
      <ServiceOccurrenceCard {...props} />
    </ul>,
  );
  return { ...view, onOpen };
};

describe("ServiceOccurrenceCard", () => {
  it("keeps the Plans card date, status marker, ribbon, and open action together", async () => {
    const user = userEvent.setup();
    const { onOpen } = renderCard({
      ariaLabel: "Open plan for Wed, Oct 21, 10:30 AM, up next",
      isNextUpcoming: true,
      statusTone: "success",
      statusMarker: <span data-testid="plan-ready-marker">Ready</span>,
    });

    const openButton = screen.getByRole("button", { name: /Open plan/i });
    const article = screen.getByRole("article");
    expect(openButton).toHaveClass("flex-col", "w-full");
    expect(screen.getByText("Up next")).toHaveClass("bg-orange-950", "text-orange-200");
    expect(article).toHaveClass(
      "border-orange-400",
      "bg-gray-800/80",
      "group-hover:border-emerald-400/45",
    );
    expect(screen.getByTestId("plan-ready-marker")).toBeInTheDocument();
    expect(screen.getByText("21")).toHaveClass("text-[21px]");
    expect(screen.getByText("Oct")).toBeInTheDocument();
    expect(screen.getByText("2:30 PM")).toBeInTheDocument();
    expect(screen.getByText("Sabbath Service")).toHaveClass(
      "text-[13px]",
      "font-medium",
      "line-clamp-2",
    );

    await user.click(openButton);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("allows long service names to wrap below the compact date and time", () => {
    const name = "Sabbath Service & 2nd service";
    renderCard({ serviceName: name });

    const serviceName = screen.getByText(name);
    expect(serviceName).toHaveClass(
      "line-clamp-2",
      "whitespace-normal",
      "text-[13px]",
    );
    expect(serviceName).not.toHaveClass("truncate");
    expect(screen.getByText("2:30 PM")).toHaveClass("text-[11px]");
  });

  it("keeps My Schedule response buttons independent from the card open action", async () => {
    const user = userEvent.setup();
    const onOpen = jest.fn();
    render(
      <ul>
        <ServiceOccurrenceCard
          calendarDate="2026-10-21"
          startsAt="2026-10-21T14:30:00.000Z"
          timeZone="UTC"
          serviceName="Sabbath Service"
          ariaLabel="Open Sabbath Service on Wed, Oct 21, 10:30 AM, today"
          isNextUpcoming={false}
          isToday
          statusTone="neutral"
          statusMarker={<span aria-label="Plan status" />}
          onOpen={onOpen}
        >
          <div>
            <p>Camera - Stationary · Media</p>
            <button type="button" onClick={jest.fn()}>Accept</button>
            <button type="button" onClick={jest.fn()}>Decline</button>
          </div>
        </ServiceOccurrenceCard>
      </ul>,
    );

    const card = screen.getByRole("button", { name: /Open Sabbath Service/i });
    expect(screen.getByText("Today")).toHaveClass("bg-sky-950", "text-sky-200");
    expect(card).toHaveClass("flex-col", "w-full");
    expect(screen.getAllByRole("button")).toHaveLength(3);
    await user.click(screen.getByRole("button", { name: "Accept" }));
    expect(onOpen).not.toHaveBeenCalled();

    card.focus();
    expect(card).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
