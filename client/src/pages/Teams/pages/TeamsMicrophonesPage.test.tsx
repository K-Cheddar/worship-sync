import { render, screen } from "@testing-library/react";
import type { ContextType } from "react";
import { MemoryRouter } from "react-router-dom";
import TeamsMicrophonesPage from "./TeamsMicrophonesPage";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { ToastProvider } from "../../../context/toastContext";
import { createMockGlobalContext } from "../../../test/mocks";
import { getServicePlanMicrophones } from "../../../api/auth";
import { TeamsNavigationGuardProvider } from "../TeamsNavigationGuardContext";
import type { ServicePlanMicrophone } from "../../../types/servicePlan";

jest.mock("../../../api/auth", () => ({
  getServicePlanMicrophones: jest.fn(),
  saveServicePlanMicrophones: jest.fn(),
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

const microphone = (
  overrides: Partial<ServicePlanMicrophone> = {},
): ServicePlanMicrophone => ({
  id: "mic-1",
  name: "Handheld 1",
  type: "handheld",
  ...overrides,
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
});
