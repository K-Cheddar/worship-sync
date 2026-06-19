import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ServiceManager from "./ServiceManager";
import { ToastProvider } from "../../../context/toastContext";
import type { TeamService } from "../../../api/authTypes";

const mockDispatch = jest.fn();

jest.mock("../../../hooks", () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: (state: unknown) => unknown) => selector({}),
}));

const service = (overrides: Partial<TeamService>): TeamService => ({
  id: overrides.serviceId || "service",
  serviceId: overrides.serviceId || "service",
  churchId: "church-1",
  name: "Service",
  timerType: "countdown",
  reccurence: "weekly",
  dayOfWeek: 0,
  time: "10:00",
  ...overrides,
});

const sundayMorning = service({
  serviceId: "first",
  name: "First Service",
  dayOfWeek: 0,
  time: "09:00",
});
const sundayLate = service({
  serviceId: "second",
  name: "Second Service",
  dayOfWeek: 0,
  time: "11:00",
});
const midweek = service({
  serviceId: "midweek",
  name: "Midweek Service",
  dayOfWeek: 3,
  time: "18:30",
});

const renderManager = (services: TeamService[]) =>
  render(
    <ToastProvider>
      <ServiceManager
        services={services}
        positions={[]}
        teams={[]}
        canEdit
      />
    </ToastProvider>,
  );

const findActions = (calls: unknown[][], type: string) =>
  calls
    .map((call) => call[0] as { type: string; payload: unknown })
    .filter((action) => action?.type === type);

beforeEach(() => {
  mockDispatch.mockClear();
});

describe("ServiceManager combined services", () => {
  it("only offers services that can fall on the same day", async () => {
    const user = userEvent.setup();
    renderManager([sundayMorning, sundayLate, midweek]);

    await user.click(screen.getByRole("button", { name: "Create service" }));

    // A new service defaults to weekly Sunday, so only the Sunday services qualify.
    expect(
      screen.getByRole("checkbox", { name: /First Service/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /Second Service/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: /Midweek Service/ }),
    ).not.toBeInTheDocument();
  });

  it("stamps a shared group id on the new service and its partner when saved", async () => {
    const user = userEvent.setup();
    renderManager([sundayMorning, sundayLate, midweek]);

    await user.click(screen.getByRole("button", { name: "Create service" }));
    await user.type(screen.getByLabelText(/^Name:?$/), "Combined Sunday");
    await user.click(screen.getByRole("checkbox", { name: /First Service/ }));
    await user.click(screen.getByRole("button", { name: "Save service" }));

    const created = findActions(mockDispatch.mock.calls, "serviceTimes/addService");
    expect(created).toHaveLength(1);
    const groupId = (created[0].payload as TeamService).serviceGroupId;
    expect(groupId).toBeTruthy();

    // The selected partner is stamped with the same id so they merge on schedules.
    const updates = findActions(
      mockDispatch.mock.calls,
      "serviceTimes/updateService",
    );
    expect(updates).toContainEqual(
      expect.objectContaining({
        payload: { id: "first", changes: { serviceGroupId: groupId } },
      }),
    );
  });
});
