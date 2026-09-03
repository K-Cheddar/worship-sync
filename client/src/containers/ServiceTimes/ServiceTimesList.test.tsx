import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ServiceTimesList from "./ServiceTimesList";
import { ServiceTime } from "../../types";

const mockDispatch = jest.fn();
let mockState: any;

jest.mock("../../hooks", () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: (state: unknown) => unknown) => selector(mockState),
}));

const makeService = (id: string, name: string): ServiceTime =>
  ({
    id,
    name,
    timerType: "countdown",
    reccurence: "one_time",
    dateTimeISO: "2026-01-08T13:00:00.000Z",
  }) as ServiceTime;

describe("ServiceTimesList manual adjust", () => {
  let services: ServiceTime[];

  beforeEach(() => {
    mockDispatch.mockClear();
    services = [
      makeService("service-1", "Sunday 9 AM"),
      makeService("service-2", "Sunday 11 AM"),
    ];
    mockState = {
      undoable: {
        present: {
          serviceTimes: { list: services },
        },
      },
    };
  });

  // Regression: previously the countdown adjuster was only reachable through
  // the auto-detected "Upcoming service" card. If that detection missed
  // (stale/misdetected upcoming service on a given device), the operator had
  // no way to reach the countdown control at all — even after a refresh.
  it("lets an operator adjust a service's countdown even when it isn't detected as upcoming", async () => {
    const user = userEvent.setup();
    render(
      <ServiceTimesList
        services={services}
        onEdit={jest.fn()}
        upcomingService={null}
        upcomingServiceTimeText={null}
        canEdit
      />,
    );

    expect(screen.queryByText("Adjust countdown")).not.toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "More service actions" })[0]);
    await user.click(screen.getByRole("menuitem", { name: "Adjust" }));

    expect(screen.getByText("Adjust countdown")).toBeInTheDocument();
  });

  it("toggles a service's adjuster closed on a second click", async () => {
    const user = userEvent.setup();
    render(
      <ServiceTimesList
        services={services}
        onEdit={jest.fn()}
        upcomingService={null}
        upcomingServiceTimeText={null}
        canEdit
      />,
    );

    await user.click(screen.getAllByRole("button", { name: "More service actions" })[0]);
    await user.click(screen.getByRole("menuitem", { name: "Adjust" }));
    expect(screen.getByText("Adjust countdown")).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "More service actions" })[0]);
    await user.click(screen.getByRole("menuitem", { name: "Hide adjust" }));
    expect(screen.queryByText("Adjust countdown")).not.toBeInTheDocument();
  });

  it("keeps only one service's adjuster open at a time", async () => {
    const user = userEvent.setup();
    render(
      <ServiceTimesList
        services={services}
        onEdit={jest.fn()}
        upcomingService={null}
        upcomingServiceTimeText={null}
        canEdit
      />,
    );

    await user.click(screen.getAllByRole("button", { name: "More service actions" })[0]);
    await user.click(screen.getByRole("menuitem", { name: "Adjust" }));
    expect(screen.getAllByText("Adjust countdown")).toHaveLength(1);

    await user.click(screen.getAllByRole("button", { name: "More service actions" })[1]);
    await user.click(screen.getByRole("menuitem", { name: "Adjust" }));
    expect(screen.getAllByText("Adjust countdown")).toHaveLength(1);
  });

  it("does not offer manual adjustment without edit access", () => {
    render(
      <ServiceTimesList
        services={services}
        onEdit={jest.fn()}
        upcomingService={null}
        upcomingServiceTimeText={null}
        canEdit={false}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "More service actions" }),
    ).not.toBeInTheDocument();
  });

  it("puts row actions in a menu without a delete option", async () => {
    const user = userEvent.setup();
    render(
      <ServiceTimesList
        services={services}
        onEdit={jest.fn()}
        upcomingService={null}
        upcomingServiceTimeText={null}
        canEdit
      />,
    );

    await user.click(screen.getAllByRole("button", { name: "More service actions" })[0]);

    expect(screen.getByRole("menuitem", { name: "Adjust" })).toHaveClass("min-h-[2.5rem]");
    expect(screen.getByRole("menuitem", { name: "Update" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Delete" })).not.toBeInTheDocument();
  });
});
