import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ContextType } from "react";
import { MemoryRouter } from "react-router-dom";
import TeamsMicrophonesPage from "./TeamsMicrophonesPage";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { ToastProvider } from "../../../context/toastContext";
import { createMockGlobalContext } from "../../../test/mocks";
import { getServiceEquipment, getServicePlanMicrophones, saveServiceEquipment, saveServicePlanMicrophones } from "../../../api/auth";
import { TeamsNavigationGuardProvider } from "../TeamsNavigationGuardContext";
import type { ServicePlanMicrophone } from "../../../types/servicePlan";

jest.mock("../../../api/auth", () => ({
  getServicePlanMicrophones: jest.fn(),
  saveServicePlanMicrophones: jest.fn(),
  getServiceEquipment: jest.fn(),
  saveServiceEquipment: jest.fn(),
}));

jest.mock("../TeamsPageContext", () => ({
  useTeamsPage: () => ({
    pageData: {
      services: [],
      positions: [],
      teams: [],
      members: [],
      schedules: [],
    },
    canEditTeams: true,
  }),
}));

const mockGetServicePlanMicrophones = jest.mocked(getServicePlanMicrophones);
const mockSaveServicePlanMicrophones = jest.mocked(saveServicePlanMicrophones);
const mockGetServiceEquipment = jest.mocked(getServiceEquipment);
const mockSaveServiceEquipment = jest.mocked(saveServiceEquipment);

const microphone = (
  overrides: Partial<ServicePlanMicrophone> = {},
): ServicePlanMicrophone => ({
  id: "mic-1",
  name: "Handheld 1",
  type: "handheld",
  ...overrides,
  color: overrides.color ?? "#9ca3af",
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <GlobalInfoContext.Provider
        value={
          createMockGlobalContext({
            churchId: "church-1",
            canEditServices: true,
            canEditTeams: true,
          }) as ContextType<typeof GlobalInfoContext>
        }
      >
        <ToastProvider>
          <TeamsNavigationGuardProvider>
            <TeamsMicrophonesPage />
          </TeamsNavigationGuardProvider>
        </ToastProvider>
      </GlobalInfoContext.Provider>
    </MemoryRouter>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockGetServicePlanMicrophones.mockResolvedValue({
    success: true,
    microphones: [microphone()],
    audiences: [],
  });
  mockSaveServicePlanMicrophones.mockResolvedValue({ success: true, microphones: [microphone()], audiences: [] });
  mockGetServiceEquipment.mockResolvedValue({ success: true, equipment: [] });
  mockSaveServiceEquipment.mockImplementation(async (_churchId, equipment) => ({ success: true, equipment }));
});

describe("TeamsMicrophonesPage", () => {
  it("shows a loading skeleton while microphones are fetching", async () => {
    let resolveList: ((value: {
      success: true;
      microphones: ServicePlanMicrophone[];
      audiences: [];
    }) => void) | undefined;
    mockGetServicePlanMicrophones.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveList = resolve;
        }),
    );

    renderPage();

    expect(
      screen.getByRole("status", { name: "Loading microphones" }),
    ).toBeInTheDocument();

    resolveList?.({
      success: true,
      microphones: [microphone()],
      audiences: [],
    });
    expect(await screen.findByText("Handheld 1")).toBeInTheDocument();
    expect(
      screen.queryByRole("status", { name: "Loading microphones" }),
    ).not.toBeInTheDocument();
  });

  it("preserves an unknown subtype as custom and saves IEM edits without saving microphones", async () => {
    const user = userEvent.setup();
    mockGetServiceEquipment.mockResolvedValue({
      success: true,
      equipment: [{ id: "iem-1", category: "iem", name: "Blue", subtype: "Auracast receiver", color: "#2255cc" }],
    });
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Edit IEMs" }));
    expect(screen.getByRole("textbox", { name: "Custom type:" })).toHaveValue("Auracast receiver");
    await user.clear(screen.getByRole("textbox", { name: "Name:" }));
    await user.type(screen.getByRole("textbox", { name: "Name:" }), "Blue pack");
    await user.click(screen.getByRole("button", { name: "Save IEMs" }));

    expect(await screen.findByText("Blue pack")).toBeInTheDocument();
    expect(mockSaveServiceEquipment).toHaveBeenCalledWith("church-1", [expect.objectContaining({
      id: "iem-1",
      category: "iem",
      name: "Blue pack",
      subtype: "Auracast receiver",
      color: "#2255cc",
    })]);
    expect(mockSaveServicePlanMicrophones).not.toHaveBeenCalled();
  });

  it("saves an IEM color independently from the microphone catalog", async () => {
    const user = userEvent.setup();
    mockGetServiceEquipment.mockResolvedValue({
      success: true,
      equipment: [{ id: "iem-1", category: "iem", name: "Blue", subtype: "wireless-beltpack", color: "#2255cc" }],
    });
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Edit IEMs" }));
    await user.click(screen.getByRole("button", { name: "#2255cc" }));
    const colorInput = screen.getByDisplayValue("#2255cc");
    fireEvent.change(colorInput, { target: { value: "#123abc" } });
    await user.click(screen.getByRole("button", { name: "Save IEMs" }));

    expect(mockSaveServiceEquipment).toHaveBeenCalledWith("church-1", [expect.objectContaining({ id: "iem-1", color: "#123abc" })]);
    expect(mockSaveServicePlanMicrophones).not.toHaveBeenCalled();
  });
});
