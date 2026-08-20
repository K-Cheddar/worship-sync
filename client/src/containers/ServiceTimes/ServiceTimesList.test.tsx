import { fireEvent, render, screen } from "@testing-library/react";
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
  it("lets an operator adjust a service's countdown even when it isn't detected as upcoming", () => {
    render(
      <ServiceTimesList
        services={services}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
        upcomingService={null}
        upcomingServiceTimeText={null}
        canEdit
      />,
    );

    expect(screen.queryByText("Adjust countdown")).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Adjust" })[0]);

    expect(screen.getByText("Adjust countdown")).toBeInTheDocument();
  });

  it("toggles a service's adjuster closed on a second click", () => {
    render(
      <ServiceTimesList
        services={services}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
        upcomingService={null}
        upcomingServiceTimeText={null}
        canEdit
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Adjust" })[0]);
    expect(screen.getByText("Adjust countdown")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Hide adjust" }));
    expect(screen.queryByText("Adjust countdown")).not.toBeInTheDocument();
  });

  it("keeps only one service's adjuster open at a time", () => {
    render(
      <ServiceTimesList
        services={services}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
        upcomingService={null}
        upcomingServiceTimeText={null}
        canEdit
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Adjust" })[0]);
    expect(screen.getAllByText("Adjust countdown")).toHaveLength(1);

    fireEvent.click(screen.getAllByRole("button", { name: "Adjust" })[0]);
    expect(screen.getAllByText("Adjust countdown")).toHaveLength(1);
  });

  it("does not offer manual adjustment without edit access", () => {
    render(
      <ServiceTimesList
        services={services}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
        upcomingService={null}
        upcomingServiceTimeText={null}
        canEdit={false}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Adjust" }),
    ).not.toBeInTheDocument();
  });
});
