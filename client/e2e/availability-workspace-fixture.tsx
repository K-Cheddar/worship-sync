import type { ContextType } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { createRoot } from "react-dom/client";
import "../src/index.css";
import TeamsFormsPage from "../src/pages/Teams/pages/TeamsFormsPage";
import type { useTeamsPage } from "../src/pages/Teams/TeamsPageContext";
import { GlobalInfoContext } from "../src/context/globalInfo";
import { ToastProvider } from "../src/context/toastContext";
import { TeamsNavigationGuardProvider } from "../src/pages/Teams/TeamsNavigationGuardContext";
import { emptyData } from "../src/pages/Teams/teamsConstants";
import { setServerTimeOffset } from "../src/utils/serverTime";
import type { TeamIntakeForm } from "../src/api/authTypes";

declare global {
  var __availabilityFixtureTeams: ReturnType<typeof useTeamsPage>;
}
setServerTimeOffset(new Date("2026-10-01T12:00:00Z").getTime() - Date.now());

const form: TeamIntakeForm = {
  formId: "form",
  churchId: "church",
  purpose: new URLSearchParams(location.search).has("missingPurpose")
    ? undefined
    : "general_intake",
  enabledFields: ["firstName", "lastName", "email", "availability", "notes"],
  name: "October Availability",
  active: true,
  startDate: "2026-10-01",
  endDate: "2026-10-31",
  teamIds: ["praise"],
  availabilityServices: [],
  availabilityOccurrences: [4, 11, 18, 25].map((day) => ({
    occurrenceId: `day-${day}`,
    serviceId: "service",
    serviceDate: `2026-10-${String(day).padStart(2, "0")}`,
    startsAt: `2026-10-${String(day).padStart(2, "0")}T10:00:00Z`,
    name: "Sunday worship",
  })),
};
const members = ["Jane Smith", "John Davis", "Mary Wilson"].map(
  (name, index) => ({
    memberId: `member-${index}`,
    churchId: "church",
    firstName: name.split(" ")[0],
    lastName: name.split(" ")[1],
    positionIds: [],
    blockoutDates: [],
    teamMemberships: { praise: { teamId: "praise" } },
  }),
);
const recipients = members.slice(0, 2).map((member, index) => ({
  recipientId: `recipient-${index}`,
  memberId: member.memberId,
  churchId: "church",
  formId: "form",
  createdAt: "2026-10-21T10:00:00Z",
  linkCopiedAt: "2026-10-21T10:00:00Z",
  ...(index === 0
    ? { respondedAt: "2026-10-21T11:00:00Z", submissionId: "submission" }
    : {}),
}));
const teams = [
  {
    teamId: "praise",
    churchId: "church",
    name: "Praise Team",
    memberIds: members.map((member) => member.memberId),
  },
];

const noop = () => undefined;
globalThis.__availabilityFixtureTeams = {
  churchId: "church",
  serviceTimeZone: "UTC",
  canEditTeams: true,
  canEditTeam: () => true,
  canManageTeamAvailability: true,
  refresh: noop,
  upsertData: noop,
  pageData: {
    ...emptyData,
    members,
    teams,
    intakeForms: [form],
    intakeRecipients: recipients,
    intakeSubmissions: [
      {
        submissionId: "submission",
        churchId: "church",
        formId: form.formId,
        firstName: "Jane",
        lastName: "Smith",
        normalizedName: "jane smith",
        positionIds: [],
        blockoutRanges: [],
        occurrenceAvailability: {
          "day-4": "available",
          "day-11": "unavailable",
          "day-18": "available",
        },
        status: "applied",
        submittedAt: "2026-10-21T11:00:00Z",
      },
    ],
    smsEligibilityByMemberId: Object.fromEntries(
      members.map((member) => [member.memberId, { eligible: true }]),
    ),
  },
} as unknown as ReturnType<typeof useTeamsPage>;

function Fixture() {
  return (
    <MemoryRouter initialEntries={["/teams-and-services/forms"]}>
      <GlobalInfoContext.Provider
        value={
          { churchId: "church", role: "admin" } as ContextType<
            typeof GlobalInfoContext
          >
        }
      >
        <ToastProvider>
          <TeamsNavigationGuardProvider>
            <main className="flex h-dvh min-h-0 flex-col overflow-y-auto bg-gray-950 p-3 text-white sm:p-6">
              <Routes>
                <Route
                  path="/teams-and-services/forms"
                  element={<TeamsFormsPage />}
                />
              </Routes>
            </main>
          </TeamsNavigationGuardProvider>
        </ToastProvider>
      </GlobalInfoContext.Provider>
    </MemoryRouter>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
