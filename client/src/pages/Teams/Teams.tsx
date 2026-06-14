import { lazy, Suspense, useMemo, type ReactNode } from "react";
import {
  CalendarDays,
  ClipboardList,
  ContactRound,
  ListChecks,
  Settings2,
  UserRoundCog,
  Users,
} from "lucide-react";
import {
  Navigate,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import HomeToolbarMenu from "../../components/HomeToolbarMenu/HomeToolbarMenu";
import Icon from "../../components/Icon/Icon";
import UserSection from "../../containers/Toolbar/ToolbarElements/UserSection";
import { ChurchLogoImg } from "../../components/ChurchLogoImg";
import ErrorBoundary from "../../components/ErrorBoundary/ErrorBoundary";
import Button from "../../components/Button/Button";
import Select from "../../components/Select/Select";
import { cn } from "../../utils/cnHelper";
import { TeamsPageProvider, useTeamsPage } from "./TeamsPageContext";
import { getTeamsSectionSkeleton } from "./teamsPageSkeletons";

const TeamsSchedulesPage = lazy(() => import("./pages/TeamsSchedulesPage"));
const TeamsFormsPage = lazy(() => import("./pages/TeamsFormsPage"));
const TeamsMembersPage = lazy(() => import("./pages/TeamsMembersPage"));
const TeamsPositionsPage = lazy(() => import("./pages/TeamsPositionsPage"));
const TeamsGroupsPage = lazy(() => import("./pages/TeamsGroupsPage"));
const TeamsServicesPage = lazy(() => import("./pages/TeamsServicesPage"));

const teamsAdminSections = [
  {
    path: "/teams/schedules",
    routePath: "schedules",
    label: "Schedules",
    description: "Assign people to services by position.",
    icon: CalendarDays,
  },
  {
    path: "/teams/members",
    routePath: "members",
    label: "Members",
    description: "Keep roster details and availability current.",
    icon: ContactRound,
  },
  {
    path: "/teams/positions",
    routePath: "positions",
    label: "Positions",
    description: "Define roles and position requirements.",
    icon: UserRoundCog,
  },
  {
    path: "/teams/groups",
    routePath: "groups",
    label: "Teams",
    description: "Organize members into scheduling teams.",
    icon: Users,
  },
  {
    path: "/teams/services",
    routePath: "services",
    label: "Services",
    description: "Manage service times used for scheduling.",
    icon: Settings2,
  },
  {
    path: "/teams/forms",
    routePath: "forms",
    label: "Forms",
    description: "Share intake forms and review submissions.",
    icon: ClipboardList,
  },
] as const;

const teamsSectionSelectOptions = teamsAdminSections.map((section) => ({
  value: section.path,
  label: section.label,
}));

const getActiveSection = (pathname: string) =>
  teamsAdminSections.find(
    (section) =>
      pathname === section.path || pathname.startsWith(`${section.path}/`),
  ) || teamsAdminSections[0];

const TeamsSectionLoadingFallback = () => {
  const location = useLocation();
  const activeSection = getActiveSection(location.pathname);
  return getTeamsSectionSkeleton(activeSection.routePath);
};

const TeamsSectionErrorFallback = () => (
  <div
    className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-lg border border-red-700/60 bg-red-950/30 p-6 text-center"
    role="alert"
  >
    <Icon svg={ListChecks} size="lg" className="text-red-300" />
    <div className="space-y-1">
      <h3 className="text-base font-semibold text-red-100">
        This section could not load.
      </h3>
      <p className="text-sm text-red-100/80">
        Try again, or open another Teams section from the sidebar.
      </p>
    </div>
    <Button type="button" onClick={() => window.location.reload()}>
      Reload Teams
    </Button>
  </div>
);

const TeamsSectionRoute = ({ children }: { children: ReactNode }) => (
  <ErrorBoundary fallback={<TeamsSectionErrorFallback />}>
    <Suspense fallback={<TeamsSectionLoadingFallback />}>{children}</Suspense>
  </ErrorBoundary>
);

const TeamsLayout = () => {
  const { loading, toolbarLogoUrl, churchName, canEditTeams } = useTeamsPage();
  const location = useLocation();
  const navigate = useNavigate();
  const activeSection = useMemo(
    () => getActiveSection(location.pathname),
    [location.pathname],
  );

  return (
    <main className="flex h-dvh min-h-0 flex-col overflow-hidden bg-homepage-canvas text-white">
      <div className="mx-auto flex min-h-0 w-full max-w-none flex-1 flex-col px-4 pb-6 lg:px-6">
        <div className="grid w-full shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-4 border-b border-gray-700 py-3 text-lg">
          <div className="flex flex-wrap items-center gap-2 justify-self-start">
            <HomeToolbarMenu />
          </div>
          <div className="flex max-w-[min(22rem,calc(100vw-6rem))] justify-center justify-self-center px-1 sm:max-w-[min(26rem,calc(100vw-10rem))]">
            {toolbarLogoUrl ? (
              <ChurchLogoImg
                src={toolbarLogoUrl}
                alt={churchName ? `${churchName} logo` : "Church logo"}
                variant="account-header"
              />
            ) : null}
          </div>
          <div className="flex flex-wrap items-center justify-end justify-self-end gap-4">
            <UserSection />
          </div>
        </div>

        <section className="mx-auto mt-4 flex w-full max-w-5xl shrink-0 flex-col gap-3 text-center">
          <h1 className="flex items-center justify-center gap-2 text-3xl font-semibold">
            <Icon svg={Users} size="lg" className="text-orange-400" />
            Teams
          </h1>
          <p className="mx-auto max-w-3xl text-sm text-gray-200">
            Manage scheduling roster people, positions, teams, services, and schedule assignments.
          </p>
          {!canEditTeams ? (
            <p className="mx-auto rounded-full border border-cyan-400/40 bg-cyan-500/10 px-3 py-1 text-xs font-semibold text-cyan-100">
              View-only Teams access
            </p>
          ) : null}
        </section>

        <section className="mx-auto mt-6 grid min-h-0 w-full flex-1 grid-rows-[auto_1fr] overflow-hidden rounded-xl border border-gray-700 bg-gray-900/40 lg:grid-cols-[16rem_minmax(0,1fr)] lg:grid-rows-1">
          <aside className="border-b border-gray-700 bg-gray-950/70 p-3 lg:border-b-0 lg:border-r lg:p-4">
            <nav
              className="hidden gap-2 lg:flex lg:flex-col"
              aria-label="Teams sections"
            >
              {teamsAdminSections.map((section) => (
                <NavLink
                  key={section.path}
                  to={section.path}
                  aria-label={section.label}
                  className={({ isActive }) =>
                    cn(
                      "group flex items-start gap-3 rounded-lg px-3 py-3 text-left text-sm transition-colors",
                      isActive
                        ? "bg-cyan-500/15 text-white ring-1 ring-cyan-400/40"
                        : "text-gray-200 hover:bg-gray-800 hover:text-white",
                    )
                  }
                >
                  <Icon
                    svg={section.icon}
                    size="md"
                    className="mt-0.5 shrink-0 text-cyan-300"
                  />
                  <span className="min-w-0">
                    <span className="block font-semibold">{section.label}</span>
                    <span className="mt-0.5 block text-xs leading-snug text-gray-400 group-hover:text-gray-300">
                      {section.description}
                    </span>
                  </span>
                </NavLink>
              ))}
            </nav>

            <Select
              id="teams-section-select"
              label="Teams section"
              hideLabel
              className="lg:hidden"
              selectClassName="rounded-lg border-gray-600 font-semibold"
              value={activeSection.path}
              onChange={(path) => navigate(path)}
              options={teamsSectionSelectOptions}
            />
          </aside>

          <div className="scrollbar-variable min-h-0 overflow-y-auto p-3 sm:p-5">
            {loading ? (
              getTeamsSectionSkeleton(activeSection.routePath)
            ) : (
              <Outlet />
            )}
          </div>
        </section>
      </div>
    </main>
  );
};

const TeamsRoutes = () => (
  <Routes>
    <Route element={<TeamsLayout />}>
      <Route index element={<Navigate to="schedules" replace />} />
      <Route
        path={teamsAdminSections[0].routePath}
        element={
          <TeamsSectionRoute>
            <TeamsSchedulesPage />
          </TeamsSectionRoute>
        }
      />
      <Route
        path={teamsAdminSections[1].routePath}
        element={
          <TeamsSectionRoute>
            <TeamsMembersPage />
          </TeamsSectionRoute>
        }
      />
      <Route
        path={teamsAdminSections[2].routePath}
        element={
          <TeamsSectionRoute>
            <TeamsPositionsPage />
          </TeamsSectionRoute>
        }
      />
      <Route
        path={teamsAdminSections[3].routePath}
        element={
          <TeamsSectionRoute>
            <TeamsGroupsPage />
          </TeamsSectionRoute>
        }
      />
      <Route
        path={teamsAdminSections[4].routePath}
        element={
          <TeamsSectionRoute>
            <TeamsServicesPage />
          </TeamsSectionRoute>
        }
      />
      <Route
        path={teamsAdminSections[5].routePath}
        element={
          <TeamsSectionRoute>
            <TeamsFormsPage />
          </TeamsSectionRoute>
        }
      />
      <Route path="*" element={<Navigate to="schedules" replace />} />
    </Route>
  </Routes>
);

const TeamsPage = () => (
  <TeamsPageProvider>
    <TeamsRoutes />
  </TeamsPageProvider>
);

export default TeamsPage;
