import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ContextType } from "react";
import { MemoryRouter } from "react-router-dom";
import TeamsMicrophonesPage from "./TeamsMicrophonesPage";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { ToastProvider } from "../../../context/toastContext";
import { createMockGlobalContext } from "../../../test/mocks";
import { getServiceEquipment, getServicePlanMicrophones, saveServiceEquipment, saveServicePlanMicrophones } from "../../../api/auth";
import {
  TeamsNavigationGuardProvider,
  useTeamsNavigationGuard,
} from "../TeamsNavigationGuardContext";
import type { ServicePlanMicrophone } from "../../../types/servicePlan";

jest.mock("../../../api/auth", () => ({
  AuthApiError: class AuthApiError extends Error {},
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
            <NavigationProbe />
            <TeamsMicrophonesPage />
          </TeamsNavigationGuardProvider>
        </ToastProvider>
      </GlobalInfoContext.Provider>
    </MemoryRouter>,
  );

const NavigationProbe = () => {
  const { requestNavigation } = useTeamsNavigationGuard();
  return (
    <button type="button" onClick={() => requestNavigation("/members")}>
      Try to leave
    </button>
  );
};

beforeEach(() => {
  cleanup();
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
  it("keeps microphone actions in the header and preserves validation and save behavior", async () => {
    const user = userEvent.setup();
    mockSaveServicePlanMicrophones.mockImplementation(async (_churchId, microphones) => ({
      success: true,
      microphones,
      audiences: [],
    }));
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Edit microphones" }));
    expect(screen.queryByRole("heading", { name: "Equipment" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Microphones" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "In-Ear Monitors (IEMs)" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add microphone" }));
    expect(screen.getAllByRole("textbox", { name: "Name:" })).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await user.click(screen.getByRole("button", { name: "Edit microphones" }));
    const name = screen.getByRole("textbox", { name: "Name:" });
    await user.clear(name);
    expect(screen.getByRole("button", { name: "Save microphones" })).toBeDisabled();

    await user.type(name, "Lead mic");
    await user.click(screen.getByRole("button", { name: "Save microphones" }));

    expect(await screen.findByRole("textbox", { name: "Name:" })).toHaveValue("Lead mic");
    expect(mockSaveServicePlanMicrophones).toHaveBeenCalledWith(
      "church-1",
      [expect.objectContaining({ id: "mic-1", name: "Lead mic" })],
      [],
    );
    expect(mockSaveServiceEquipment).not.toHaveBeenCalled();
  });

  it("shows a pending and completed state for microphone saves", async () => {
    const user = userEvent.setup();
    let resolveSave: ((value: { success: true; microphones: ServicePlanMicrophone[]; audiences: [] }) => void) | undefined;
    mockSaveServicePlanMicrophones.mockImplementation(
      async (_churchId, microphones) => new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Edit microphones" }));
    await user.type(screen.getByRole("textbox", { name: "Name:" }), " updated");
    await user.click(screen.getByRole("button", { name: "Save microphones" }));

    expect(screen.getByRole("button", { name: "Saving microphones" })).toBeDisabled();
    resolveSave?.({ success: true, microphones: [microphone({ name: "Handheld 1 updated" })], audiences: [] });
    await waitFor(() => expect(screen.getByRole("button", { name: "Saved microphones" })).toBeDisabled());
    expect(screen.getByTestId("microphone-save-success-icon")).toHaveClass("text-emerald-300");
    expect(screen.queryByText("Microphone list saved.")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Name:" }), {
      target: { value: "Handheld 1 revised" },
    });
    expect(screen.getByRole("button", { name: "Save microphones" })).toBeEnabled();
  });

  it("keeps microphone save errors visible and the draft actionable", async () => {
    const user = userEvent.setup();
    mockSaveServicePlanMicrophones.mockRejectedValue(new Error("Microphone save failed."));
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Edit microphones" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Name:" }), {
      target: { value: "Lead mic" },
    });
    await user.click(screen.getByRole("button", { name: "Save microphones" }));

    expect(await screen.findByText("Microphone save failed.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save microphones" })).toBeEnabled();
    expect(screen.getByRole("textbox", { name: "Name:" })).toHaveValue("Lead mic");
  });

  it("keeps microphone and IEM edit modes independent", async () => {
    const user = userEvent.setup();
    mockGetServiceEquipment.mockResolvedValue({
      success: true,
      equipment: [{ id: "iem-1", category: "iem", name: "Blue", subtype: "wireless-beltpack", color: "#2255cc" }],
    });
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Edit microphones" }));
    expect(screen.getByRole("textbox", { name: "Name:" })).toBeInTheDocument();
    expect(screen.getByText("Blue")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save IEMs" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: "Edit IEMs" }));
    expect(await screen.findByRole("button", { name: "Add IEM" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Name")).toHaveValue("Blue");
    expect(screen.getByRole("button", { name: "Saved IEMs" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add IEM" }));
    expect(screen.getByRole("button", { name: "Save IEMs" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("textbox", { name: "Name:" })).not.toBeInTheDocument();
    expect(screen.getByText("Blue")).toBeInTheDocument();
  });

  it("opens the navigation guard for unsaved microphone and IEM edits", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Edit microphones" }));
    await user.type(screen.getByRole("textbox", { name: "Name:" }), " draft");
    await user.click(screen.getByRole("button", { name: "Try to leave" }));
    expect(screen.getByRole("dialog", { name: "Unsaved changes" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Stay" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await user.click(screen.getByRole("button", { name: "Edit IEMs" }));
    await user.click(screen.getByRole("button", { name: "Add IEM" }));
    await user.click(screen.getByRole("button", { name: "Try to leave" }));
    expect(screen.getByRole("dialog", { name: "Unsaved changes" })).toBeInTheDocument();
  });

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
    expect(screen.getByRole("button", { name: "Save IEMs" })).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "Name:" }), "Blue pack");
    await user.click(screen.getByRole("button", { name: "Save IEMs" }));

    expect(await screen.findByRole("textbox", { name: "Name:" })).toHaveValue("Blue pack");
    expect(screen.getByRole("button", { name: "Saved IEMs" })).toBeDisabled();
    expect(screen.getByTestId("iem-save-success-icon")).toHaveClass("text-emerald-300");
    expect(screen.queryByText("IEM list saved.")).not.toBeInTheDocument();
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
