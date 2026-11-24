import { type ContextType, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import "../src/index.css";
import { GlobalInfoContext } from "../src/context/globalInfo";
import { ToastProvider } from "../src/context/toastContext";
import IntakeManager from "../src/pages/Teams/managers/IntakeManager";
import TeamIntakePublic from "../src/pages/Teams/TeamIntakePublic";
import { TeamsNavigationGuardProvider } from "../src/pages/Teams/TeamsNavigationGuardContext";
import { CurrentMemberIdentityProvider } from "../src/pages/Teams/components/CurrentUserMemberIndicator";
import { teamsSectionScrollClassName } from "../src/pages/Teams/teamsStyles";
import type {
  TeamIntakeForm,
  TeamIntakeSubmission,
  TeamRosterMember,
  TeamRecord,
} from "../src/api/authTypes";
import type { useTeamsPage } from "../src/pages/Teams/TeamsPageContext";
import { setServerTimeOffset } from "../src/utils/serverTime";

declare global {
  var __availabilityFixtureTeams: Pick<
    ReturnType<typeof useTeamsPage>,
    "serviceTimeZone"
  >;
  var __teamAvailabilityIntakeFixture:
    | {
        addSubmission: (submission: TeamIntakeSubmission) => void;
        goToManager: () => void;
        goToPublicForm: () => void;
      }
    | undefined;
}

setServerTimeOffset(new Date("2026-11-24T12:00:00Z").getTime() - Date.now());
globalThis.__availabilityFixtureTeams = { serviceTimeZone: "UTC" };

const occurrences = [
  {
    occurrenceId: "sunday-service@2026-12-06T10:00:00.000Z",
    serviceId: "sunday-service",
    name: "Sunday worship",
    startsAt: "2026-12-06T10:00:00.000Z",
    serviceDate: "2026-12-06",
  },
  {
    occurrenceId: "sunday-service@2026-12-13T10:00:00.000Z",
    serviceId: "sunday-service",
    name: "Sunday worship",
    startsAt: "2026-12-13T10:00:00.000Z",
    serviceDate: "2026-12-13",
  },
];

const initialForm: TeamIntakeForm = {
  formId: "availability-form",
  churchId: "church",
  purpose: "team_availability",
  name: "December Availability",
  startDate: "2026-12-01",
  endDate: "2026-12-31",
  responseDeadline: "2026-12-31",
  availabilityServices: [{ serviceId: "sunday-service", name: "Sunday worship" }],
  availabilityOccurrences: occurrences,
  teamIds: ["worship"],
  enabledFields: ["availability"],
  active: true,
  welcomeMessage: "",
  submissionCount: 0,
};

const initialMember: TeamRosterMember = {
  memberId: "member-rae",
  churchId: "church",
  firstName: "Rae",
  lastName: "Kim",
  email: "rae@example.test",
  positionIds: [],
  blockoutDates: [],
  teamMemberships: { worship: { teamId: "worship" } },
};

const worshipTeam: TeamRecord = {
  teamId: "worship",
  churchId: "church",
  name: "Worship Team",
  memberIds: [initialMember.memberId],
};

function FixtureRoutes({
  forms,
  submissions,
  members,
  saveForm,
  saveSubmission,
  saveMember,
}: {
  forms: TeamIntakeForm[];
  submissions: TeamIntakeSubmission[];
  members: TeamRosterMember[];
  saveForm: (form: TeamIntakeForm) => void;
  saveSubmission: (submission: TeamIntakeSubmission) => void;
  saveMember: (member: TeamRosterMember) => void;
}) {
  const navigate = useNavigate();
  const addSubmission = useCallback(
    (submission: TeamIntakeSubmission) => saveSubmission(submission),
    [saveSubmission],
  );

  useEffect(() => {
    globalThis.__teamAvailabilityIntakeFixture = {
      addSubmission,
      goToManager: () => navigate("/manage"),
      goToPublicForm: () => navigate("/team-intake/general-availability"),
    };
    return () => {
      globalThis.__teamAvailabilityIntakeFixture = undefined;
    };
  }, [addSubmission, navigate]);

  return (
    <Routes>
      <Route
        path="/manage"
        element={
          <IntakeManager
            forms={forms}
            submissions={submissions}
            intakeRecipients={[]}
            services={[]}
            members={members}
            positions={[]}
            teams={[worshipTeam]}
            canEdit
            onFormSaved={saveForm}
            onSubmissionSaved={saveSubmission}
            onMemberSaved={saveMember}
            onTeamSaved={() => undefined}
            onRecipientSaved={() => undefined}
          />
        }
      />
      <Route path="/team-intake/:token" element={<TeamIntakePublic />} />
    </Routes>
  );
}

function Fixture() {
  const [forms, setForms] = useState([initialForm]);
  const [submissions, setSubmissions] = useState<TeamIntakeSubmission[]>([]);
  const [members, setMembers] = useState([initialMember]);
  const saveForm = useCallback((form: TeamIntakeForm) => {
    setForms((current) => current.map((item) => item.formId === form.formId ? form : item));
  }, []);
  const saveSubmission = useCallback((submission: TeamIntakeSubmission) => {
    setSubmissions((current) => current.some((item) => item.submissionId === submission.submissionId)
      ? current.map((item) => item.submissionId === submission.submissionId ? submission : item)
      : [...current, submission]);
  }, []);
  const saveMember = useCallback((member: TeamRosterMember) => {
    setMembers((current) => current.map((item) => item.memberId === member.memberId ? member : item));
  }, []);

  return (
    <GlobalInfoContext.Provider
      value={{ churchId: "church", role: "admin" } as ContextType<typeof GlobalInfoContext>}
    >
      <ToastProvider>
        <MemoryRouter initialEntries={["/manage"]}>
          <CurrentMemberIdentityProvider memberId={null}>
            <TeamsNavigationGuardProvider>
              <main className="flex h-dvh min-h-0 flex-col overflow-hidden bg-gray-950 pb-[57px] text-white">
                <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
                  <div
                    data-testid="teams-page-scroll"
                    className={teamsSectionScrollClassName}
                  >
                    <FixtureRoutes
                      forms={forms}
                      submissions={submissions}
                      members={members}
                      saveForm={saveForm}
                      saveSubmission={saveSubmission}
                      saveMember={saveMember}
                    />
                  </div>
                </section>
                <div className="fixed inset-x-0 bottom-0 z-30 h-[57px] border-t border-gray-800 bg-gray-900" />
              </main>
            </TeamsNavigationGuardProvider>
          </CurrentMemberIdentityProvider>
        </MemoryRouter>
      </ToastProvider>
    </GlobalInfoContext.Provider>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
