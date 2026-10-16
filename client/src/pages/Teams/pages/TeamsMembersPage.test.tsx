import { type ContextType } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { ToastProvider } from "../../../context/toastContext";
import { getTeamsBootstrap, recordMemberSmsConsent, updateTeamRosterMember } from "../../../api/auth";
import { TeamsNavigationGuardProvider } from "../TeamsNavigationGuardContext";
import { useTeamsPageState } from "../hooks/useTeamsPageState";
import TeamsMembersPage from "./TeamsMembersPage";

let mockState: unknown;
let mockTeamsPageState: unknown;
jest.mock("../../../hooks", () => ({
  useDispatch: () => jest.fn(),
  useSelector: (selector: (state: unknown) => unknown) => selector(mockState),
}));

jest.mock("../../../api/auth", () => ({
  getTeamsBootstrap: jest.fn(),
  getTeamScheduleDetail: jest.fn(),
  reorderTeamPositions: jest.fn(),
  updateTeamRosterMember: jest.fn(),
  createTeamRosterMember: jest.fn(),
  archiveTeamRosterMember: jest.fn(),
  deleteTeamRosterMember: jest.fn(),
  linkTeamRosterMember: jest.fn(),
  unlinkTeamRosterMember: jest.fn(),
  listChurchMembers: jest.fn(async () => ({ members: [] })),
  inviteTeamRosterMember: jest.fn(),
  recordMemberSmsConsent: jest.fn(),
}));

jest.mock("../hooks/useTeamsLiveSync", () => ({
  useTeamsLiveSync: jest.fn(() => ({ connectionState: "closed", reconnectVersion: 0 })),
  isServicePlanTemplateRemovedEvent: jest.fn(() => false),
  isServicePlanTemplateUpdatedEvent: jest.fn(() => false),
}));

jest.mock("../TeamsPageContext", () => ({
  useTeamsPage: () => mockTeamsPageState,
}));

const mockGetTeamsBootstrap = jest.mocked(getTeamsBootstrap);
const mockUpdateTeamRosterMember = jest.mocked(updateTeamRosterMember);
const mockRecordMemberSmsConsent = jest.mocked(recordMemberSmsConsent);

const memberWithoutPhone = {
  memberId: "member-sms",
  churchId: "church-1",
  firstName: "Rae",
  lastName: "Kim",
  phoneNumber: "",
  positionIds: [],
  blockoutDates: [],
};

const TestTeamsMembersRoute = () => {
  const pageState = useTeamsPageState();
  mockTeamsPageState = pageState;
  return <TeamsMembersPage />;
};

const renderMembersPage = () => render(
  <MemoryRouter>
    <GlobalInfoContext.Provider value={{
      churchId: "church-1",
      userId: "admin-1",
      role: "admin",
      canViewTeams: true,
      canEditTeams: true,
      canUseTeamsLiveSync: false,
      canEditTeam: () => true,
      permissions: { teams: "edit", teamScopes: {} },
    } as unknown as ContextType<typeof GlobalInfoContext>}>
      <ToastProvider>
        <TeamsNavigationGuardProvider>
          <TestTeamsMembersRoute />
        </TeamsNavigationGuardProvider>
      </ToastProvider>
    </GlobalInfoContext.Provider>
  </MemoryRouter>,
);

describe("TeamsMembersPage SMS eligibility refresh", () => {
  beforeEach(() => {
    mockState = { undoable: { present: { serviceTimes: { list: [] } } } };
    mockGetTeamsBootstrap.mockReset();
    mockUpdateTeamRosterMember.mockReset();
    mockRecordMemberSmsConsent.mockReset();
    let consentRecorded = false;
    mockGetTeamsBootstrap.mockImplementation(async () => ({
      success: true,
      members: [consentRecorded || mockGetTeamsBootstrap.mock.calls.length > 1
        ? { ...memberWithoutPhone, phoneNumber: "+19545551234" }
        : memberWithoutPhone],
      positions: [],
      teams: [],
      schedules: [],
      smsEligibilityByMemberId: {
        [memberWithoutPhone.memberId]: consentRecorded
          ? { status: "enabled", eligible: true, phoneNumber: "+19545551234" }
          : mockGetTeamsBootstrap.mock.calls.length > 1
            ? { status: "consent_needed", eligible: false, phoneNumber: "+19545551234" }
            : { status: "no_mobile", eligible: false, phoneNumber: "" },
      },
    } as never));
    mockUpdateTeamRosterMember.mockImplementation(async () => ({
      success: true,
      member: { ...memberWithoutPhone, phoneNumber: "+19545551234" },
    } as never));
    mockRecordMemberSmsConsent.mockImplementation(async () => {
      consentRecorded = true;
      return { success: true } as never;
    });
  });

  it("updates eligibility and exposes the authorized consent flow without remounting", async () => {
    const user = userEvent.setup();
    renderMembersPage();
    await user.click(await screen.findByRole("button", { name: /Rae Kim/ }));
    expect(screen.getByRole("status")).toHaveTextContent("No valid mobile number");

    await user.type(screen.getByLabelText(/Mobile/), "9545551234");
    await user.click(screen.getByRole("button", { name: "Save member" }));
    expect(await screen.findByText("Text message status: Consent needed")).toBeInTheDocument();
    expect(mockGetTeamsBootstrap).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole("button", { name: "Member actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Record text message consent" }));
    const dialog = screen.getByRole("dialog", { name: "Record text message consent" });
    await user.click(within(dialog).getByRole("checkbox"));
    await user.click(within(dialog).getByRole("button", { name: "Save consent" }));

    await waitFor(() => expect(mockRecordMemberSmsConsent).toHaveBeenCalledWith("church-1", expect.objectContaining({
      memberId: memberWithoutPhone.memberId,
      phoneNumberSnapshot: "+19545551234",
      source: "admin_verbal",
      confirmed: true,
    })));
    expect(await screen.findByText("Text message status: Enabled")).toBeInTheDocument();
  });
});
