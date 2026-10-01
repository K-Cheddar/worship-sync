import { render, screen, fireEvent, within } from "@testing-library/react";
import type { ContextType } from "react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import ServiceManager from "./ServiceManager";
import { ToastProvider } from "../../../context/toastContext";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { TeamsNavigationGuardProvider } from "../TeamsNavigationGuardContext";
import type { TeamPosition, TeamRecord, TeamService } from "../../../api/authTypes";
import type { ServiceTime } from "../../../types";
import type { ServicePlanTemplate } from "../../../types/servicePlan";
import { toTeamService } from "../teamsUtils";

const mockDispatch = jest.fn();
let mockSelectorState: unknown = {};

jest.mock("../../../hooks", () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: (state: unknown) => unknown) => selector(mockSelectorState),
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

const roundTripPersistedService = (service: ServiceTime): ServiceTime =>
  JSON.parse(
    JSON.stringify(service, (_key, value: unknown) =>
      value === undefined ? null : value,
    ),
  ) as ServiceTime;

const toPersistedTeamService = (service: ServiceTime) =>
  toTeamService(roundTripPersistedService(service));

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

const managerElement = (
  services: TeamService[],
  positions: TeamPosition[] = [],
  teams: TeamRecord[] = [],
  planTemplates: ServicePlanTemplate[] = [],
) => (
    <MemoryRouter>
      <ToastProvider>
        <GlobalInfoContext.Provider
          value={{ churchId: "church-1" } as NonNullable<ContextType<typeof GlobalInfoContext>>}
        >
          <TeamsNavigationGuardProvider>
            <ServiceManager
              services={services}
              positions={positions}
              teams={teams}
              planTemplates={planTemplates}
              canEdit
            />
          </TeamsNavigationGuardProvider>
        </GlobalInfoContext.Provider>
      </ToastProvider>
    </MemoryRouter>
  );

const renderManager = (
  services: TeamService[],
  positions: TeamPosition[] = [],
  teams: TeamRecord[] = [],
  planTemplates: ServicePlanTemplate[] = [],
) => render(managerElement(services, positions, teams, planTemplates));

const serviceFormSaveButton = () =>
  screen.getAllByRole("button", { name: /^(Create service|Save service|Saved|Created)$/ }).at(-1)!;

const findActions = (calls: unknown[][], type: string) =>
  calls
    .map((call) => call[0] as { type: string; payload: unknown })
    .filter((action) => action?.type === type);

beforeEach(() => {
  mockDispatch.mockClear();
  mockSelectorState = {};
  originalMatchMedia = window.matchMedia;
  // Desktop default: max-width queries do not match, so the edit panel stays open.
  window.matchMedia = makeMatchMedia(false);
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

describe("ServiceManager combined services", () => {
  it("confirms before discarding unsaved service changes", async () => {
    const user = userEvent.setup();
    renderManager([sundayMorning, sundayLate, midweek]);

    await user.click(screen.getByRole("button", { name: /Edit First Service/i }));
    // Set the name in one event — character-by-character typing burns the
    // default 5s test budget under full-suite load.
    fireEvent.change(screen.getByLabelText(/^Name:?$/), {
      target: { value: "Unsaved Service" },
    });
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByRole("dialog", { name: "Unsaved changes" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Stay" }));
    expect(
      await screen.findByRole("heading", { name: "Edit service" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^Name:?$/)).toHaveValue("Unsaved Service");

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Discard changes" }));

    expect(screen.queryByRole("heading", { name: "Edit service" })).not.toBeInTheDocument();
  }, 15_000);

  it("only offers services that can fall on the same day", async () => {
    const user = userEvent.setup();
    renderManager([sundayMorning, sundayLate, midweek]);

    await user.click(screen.getAllByRole("button", { name: "Create service" })[0]);

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
    await user.click(serviceFormSaveButton());

    const updates = findActions(mockDispatch.mock.calls, "serviceTimes/updateService");
    expect(updates.length).toBeGreaterThan(0);
    expect(await screen.findByRole("button", { name: "Saved" })).toBeDisabled();
    expect(screen.getByTestId("form-save-success-icon")).toHaveClass("text-emerald-300");
    // The panel stays open on edit so services can be edited back-to-back, and
    // the form is re-seeded from the saved snapshot.
    expect(
      screen.getByRole("heading", { name: "Edit service" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^Name:?$/)).toHaveValue("Early Service");

    const savedButton = screen.getByRole("button", { name: "Saved" });
    expect(savedButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/^Name:?$/), {
      target: { value: "Earlier Service" },
    });
    expect(screen.getByRole("button", { name: "Save service" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
  });

  it("disables save until a service setting changes", async () => {
    const user = userEvent.setup();
    renderManager([sundayMorning, sundayLate, midweek]);

    await user.click(screen.getByRole("button", { name: /Edit First Service/i }));
    expect(serviceFormSaveButton()).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/^Name:?$/), {
      target: { value: "First Service Updated" },
    });
    expect(screen.getByRole("button", { name: "Save service" })).toBeEnabled();
  });

  it("shows saving while service changes are awaiting persistence", async () => {
    const user = userEvent.setup();
    mockSelectorState = { autosaveIndicator: { debouncedSaveDepth: {} } };
    const adaptedServices = [sundayMorning, sundayLate, midweek].map(toPersistedTeamService);
    const { rerender } = renderManager(adaptedServices);

    await user.click(screen.getByRole("button", { name: /Edit First Service/i }));
    fireEvent.change(screen.getByLabelText(/^Name:?$/), {
      target: { value: "Early Service" },
    });
    await user.click(screen.getByRole("button", { name: "Save service" }));
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();

    mockSelectorState = {
      autosaveIndicator: { debouncedSaveDepth: { "debounced/serviceTimes": 1 } },
    };
    rerender(managerElement(adaptedServices));
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();

    const changes = (findActions(mockDispatch.mock.calls, "serviceTimes/updateService")[0].payload as {
      changes: Partial<ServiceTime>;
    }).changes;
    const persistedService = toPersistedTeamService({ ...sundayMorning, ...changes });
    mockSelectorState = { autosaveIndicator: { debouncedSaveDepth: {} } };
    rerender(managerElement([persistedService, ...adaptedServices.slice(1)]));

    expect(screen.getByRole("button", { name: "Saved" })).toBeDisabled();
  });

  it("acknowledges a persisted ServiceTime despite adapter metadata and closes cleanly", async () => {
    const user = userEvent.setup();
    mockSelectorState = { autosaveIndicator: { debouncedSaveDepth: {} } };
    const persistedService: ServiceTime = {
      id: "first",
      name: "First Service",
      timerType: "countdown",
      reccurence: "weekly",
      dayOfWeek: 0,
      time: "09:00",
    };
    const adaptedService = toPersistedTeamService(persistedService);
    const { rerender } = renderManager([
      adaptedService,
      toPersistedTeamService(sundayLate),
      toPersistedTeamService(midweek),
    ]);

    await user.click(screen.getByRole("button", { name: /Edit First Service/i }));
    await user.click(screen.getByRole("combobox", { name: "Time" }));
    await user.click(
      within(screen.getByRole("listbox", { name: "Select hour" })).getByRole(
        "option",
        { name: /^10$/ },
      ),
    );
    await user.click(screen.getByRole("button", { name: "Save service" }));
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();

    mockSelectorState = {
      autosaveIndicator: { debouncedSaveDepth: { "debounced/serviceTimes": 1 } },
    };
    rerender(managerElement([
      adaptedService,
      toPersistedTeamService(sundayLate),
      toPersistedTeamService(midweek),
    ]));
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();

    const changes = (findActions(mockDispatch.mock.calls, "serviceTimes/updateService")[0].payload as {
      changes: Partial<ServiceTime>;
    }).changes;
    expect(changes.time).not.toBe(persistedService.time);
    mockSelectorState = { autosaveIndicator: { debouncedSaveDepth: {} } };
    const savedService = toPersistedTeamService({ ...persistedService, ...changes });
    rerender(managerElement([
      savedService,
      toPersistedTeamService(sundayLate),
      toPersistedTeamService(midweek),
    ]));

    expect(await screen.findByRole("button", { name: "Saved" })).toBeDisabled();
    const editor = screen.getByRole("region", { name: "Edit service" });
    expect(within(editor).getByRole("button", { name: "Close" })).toBeEnabled();
    expect(within(editor).getByRole("button", { name: "Saved" })).toBeDisabled();

    await user.click(within(editor).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Unsaved changes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Edit service" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Edit First Service/i }));
    fireEvent.change(screen.getByLabelText(/^Name:?$/), {
      target: { value: "First Service Updated" },
    });
    expect(screen.getByRole("button", { name: "Save service" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
  });

  it("keeps a rolled-back service edit dirty and retryable", async () => {
    const user = userEvent.setup();
    mockSelectorState = { autosaveIndicator: { debouncedSaveDepth: {} } };
    const adaptedServices = [sundayMorning, sundayLate, midweek].map(toPersistedTeamService);
    const { rerender } = renderManager(adaptedServices);

    await user.click(screen.getByRole("button", { name: /Edit First Service/i }));
    fireEvent.change(screen.getByLabelText(/^Name:?$/), {
      target: { value: "Rolled Back Service" },
    });
    await user.click(screen.getByRole("button", { name: "Save service" }));
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();

    mockSelectorState = {
      autosaveIndicator: { debouncedSaveDepth: { "debounced/serviceTimes": 1 } },
    };
    rerender(managerElement(adaptedServices));
    mockSelectorState = { autosaveIndicator: { debouncedSaveDepth: {} } };
    rerender(managerElement(adaptedServices));

    expect(screen.getByRole("button", { name: "Save service" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Save service" }));
    expect(findActions(mockDispatch.mock.calls, "serviceTimes/updateService")).toHaveLength(2);
  });

  it("keeps the editor open after saving on narrow screens until Cancel", async () => {
    window.matchMedia = makeMatchMedia(true);
    const user = userEvent.setup();
    renderManager([sundayMorning, sundayLate, midweek]);

    await user.click(screen.getByRole("button", { name: /Edit First Service/i }));
    expect(
      screen.getByRole("heading", { name: "Edit service" }),
    ).toBeInTheDocument();

    await user.click(serviceFormSaveButton());

    expect(
      screen.getByRole("heading", { name: "Edit service" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^Name:?$/)).toHaveValue("First Service");

    await user.click(
      within(screen.getByRole("region", { name: "Edit service" })).getByRole(
        "button",
        { name: "Close" },
      ),
    );
    expect(
      screen.queryByRole("heading", { name: "Edit service" }),
    ).not.toBeInTheDocument();
  });

  it("stamps a shared group id on the new service and its partner when saved", async () => {
    const user = userEvent.setup();
    renderManager([sundayMorning, sundayLate, midweek]);

    await user.click(screen.getAllByRole("button", { name: "Create service" })[0]);
    await user.type(screen.getByLabelText(/^Name:?$/), "Combined Sunday");
    await user.click(screen.getByRole("checkbox", { name: /First Service/ }));
    await user.click(serviceFormSaveButton());

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

    expect(screen.getByRole("heading", { name: "Edit service" })).toBeInTheDocument();
    const nameInput = screen.getByLabelText(/^Name:?$/);
    fireEvent.change(nameInput, {
      target: { value: "Combined Sunday Updated" },
    });
    await user.click(serviceFormSaveButton());
    expect(findActions(mockDispatch.mock.calls, "serviceTimes/addService")).toHaveLength(1);
    expect(findActions(mockDispatch.mock.calls, "serviceTimes/updateService")).toContainEqual(
      expect.objectContaining({ payload: expect.objectContaining({ id: (created[0].payload as TeamService).id }) }),
    );
  });
});

describe("ServiceManager position requirements", () => {
  it("marks unblurred position counts dirty and saves their current value", async () => {
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
    const staffedService = service({
      serviceId: "staffed",
      name: "Staffed service",
      positionRequirements: [{ positionId: position.positionId, count: 1 }],
    });
    renderManager([staffedService], [position], [team]);

    await user.click(screen.getByRole("button", { name: "Edit Staffed service" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "People needed for Producer" }), {
      target: { value: "2" },
    });
    expect(screen.getByRole("button", { name: "Save service" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Save service" }));

    expect(findActions(mockDispatch.mock.calls, "serviceTimes/updateService")).toContainEqual(
      expect.objectContaining({
        payload: expect.objectContaining({
          id: staffedService.id,
          changes: expect.objectContaining({
            positionRequirements: [{ positionId: "producer", count: 2 }],
          }),
        }),
      }),
    );
  });

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
      icon: { source: "lucide", name: "MicVocal" },
    };
    renderManager([sundayMorning], [position], [team]);

    await user.click(screen.getAllByRole("button", { name: "Create service" })[0]);

    expect(screen.getByText("People needed")).toBeInTheDocument();
    expect(screen.queryByText("People needed:")).not.toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "People needed for Producer" })).toHaveValue(0);
    const producerCheckbox = screen.getByRole("checkbox", { name: "Producer" });
    expect(screen.getByText("Producer")).toHaveClass("inline-flex", "gap-2");

    await user.click(screen.getByRole("button", { name: "Increase people needed for Producer" }));
    expect(screen.getByRole("spinbutton", { name: "People needed for Producer" })).toHaveValue(1);
    expect(producerCheckbox).toBeChecked();

    await user.click(screen.getByRole("button", { name: "Decrease people needed for Producer" }));
    expect(screen.getByRole("spinbutton", { name: "People needed for Producer" })).toHaveValue(0);
    expect(producerCheckbox).not.toBeChecked();
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
    await user.click(serviceFormSaveButton());

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
