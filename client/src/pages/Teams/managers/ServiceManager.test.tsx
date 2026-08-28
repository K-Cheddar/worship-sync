import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import ServiceManager from "./ServiceManager";
import { ToastProvider } from "../../../context/toastContext";
import { TeamsNavigationGuardProvider } from "../TeamsNavigationGuardContext";
import type { TeamPosition, TeamRecord, TeamService } from "../../../api/authTypes";
import type { ServicePlanTemplate } from "../../../types/servicePlan";

const mockDispatch = jest.fn();

jest.mock("../../../hooks", () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: (state: unknown) => unknown) => selector({}),
}));

const makeMatchMedia = (matches: boolean): typeof window.matchMedia =>
  jest.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    addListener: jest.fn(),
    removeListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })) as unknown as typeof window.matchMedia;

let originalMatchMedia: typeof window.matchMedia;

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

const renderManager = (
  services: TeamService[],
  positions: TeamPosition[] = [],
  teams: TeamRecord[] = [],
  planTemplates: ServicePlanTemplate[] = [],
) =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <TeamsNavigationGuardProvider>
          <ServiceManager
            services={services}
            positions={positions}
            teams={teams}
            planTemplates={planTemplates}
            canEdit
          />
        </TeamsNavigationGuardProvider>
      </ToastProvider>
    </MemoryRouter>,
  );

const findActions = (calls: unknown[][], type: string) =>
  calls
    .map((call) => call[0] as { type: string; payload: unknown })
    .filter((action) => action?.type === type);

beforeEach(() => {
  mockDispatch.mockClear();
  originalMatchMedia = window.matchMedia;
  // Desktop default: max-width queries do not match, so the edit panel stays open.
  window.matchMedia = makeMatchMedia(false);
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
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

  it("keeps the editor open after saving an edited service", async () => {
    const user = userEvent.setup();
    renderManager([sundayMorning, sundayLate, midweek]);

    await user.click(screen.getByRole("button", { name: /Edit First Service/i }));
    expect(
      screen.getByRole("heading", { name: "Edit service" }),
    ).toBeInTheDocument();

    const nameInput = screen.getByLabelText(/^Name:?$/);
    await user.clear(nameInput);
    await user.type(nameInput, "Early Service");
    await user.click(screen.getByRole("button", { name: "Save service" }));

    const updates = findActions(mockDispatch.mock.calls, "serviceTimes/updateService");
    expect(updates.length).toBeGreaterThan(0);
    // The panel stays open on edit so services can be edited back-to-back, and
    // the form is re-seeded from the saved snapshot.
    expect(
      screen.getByRole("heading", { name: "Edit service" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^Name:?$/)).toHaveValue("Early Service");
  });

  it("closes the editor after saving on narrow screens", async () => {
    window.matchMedia = makeMatchMedia(true);
    const user = userEvent.setup();
    renderManager([sundayMorning, sundayLate, midweek]);

    await user.click(screen.getByRole("button", { name: /Edit First Service/i }));
    expect(
      screen.getByRole("heading", { name: "Edit service" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save service" }));

    expect(
      screen.queryByRole("heading", { name: "Edit service" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create service" }),
    ).toBeInTheDocument();
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

describe("ServiceManager position requirements", () => {
  it("uses one heading and adjusts people needed with plus and minus buttons", async () => {
    const user = userEvent.setup();
    const team: TeamRecord = {
      teamId: "media",
      churchId: "church-1",
      name: "Media",
      memberIds: [],
    };
    const position: TeamPosition = {
      positionId: "producer",
      churchId: "church-1",
      teamId: team.teamId,
      name: "Producer",
    };
    renderManager([sundayMorning], [position], [team]);

    await user.click(screen.getByRole("button", { name: "Create service" }));

    expect(screen.getByText("People needed")).toBeInTheDocument();
    expect(screen.queryByText("People needed:")).not.toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "People needed for Producer" })).toHaveValue(0);

    await user.click(screen.getByRole("button", { name: "Increase people needed for Producer" }));
    expect(screen.getByRole("spinbutton", { name: "People needed for Producer" })).toHaveValue(1);
    expect(screen.getByRole("checkbox", { name: "Producer" })).toBeChecked();

    await user.click(screen.getByRole("button", { name: "Decrease people needed for Producer" }));
    expect(screen.getByRole("spinbutton", { name: "People needed for Producer" })).toHaveValue(0);
    expect(screen.getByRole("checkbox", { name: "Producer" })).not.toBeChecked();
  });
});

describe("ServiceManager default plan template", () => {
  it("saves the template that should initialize new plans", async () => {
    const user = userEvent.setup();
    const template: ServicePlanTemplate = {
      templateId: "template-standard",
      churchId: "church-1",
      serviceId: sundayMorning.serviceId,
      name: "Standard service",
      sections: [],
    };
    renderManager([sundayMorning], [], [], [template]);

    await user.click(screen.getByRole("button", { name: /Edit First Service/i }));
    await user.click(
      screen.getByRole("combobox", { name: /Default plan template/i }),
    );
    await user.click(screen.getByRole("option", { name: "Standard service" }));
    await user.click(screen.getByRole("button", { name: "Save service" }));

    const updates = findActions(mockDispatch.mock.calls, "serviceTimes/updateService");
    expect(updates).toContainEqual(
      expect.objectContaining({
        payload: expect.objectContaining({
          id: sundayMorning.id,
          changes: expect.objectContaining({
            defaultPlanTemplateId: template.templateId,
          }),
        }),
      }),
    );
  });
});
