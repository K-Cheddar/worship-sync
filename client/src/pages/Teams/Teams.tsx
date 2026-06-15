import { lazy, Suspense, useMemo, useState, type ReactNode } from "react";
import { ListChecks, PanelLeft, Users } from "lucide-react";
import {
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import HomeToolbarMenu from "../../components/HomeToolbarMenu/HomeToolbarMenu";
import Icon from "../../components/Icon/Icon";
import UserSection from "../../containers/Toolbar/ToolbarElements/UserSection";
import { ChurchLogoImg } from "../../components/ChurchLogoImg";
import ErrorBoundary from "../../components/ErrorBoundary/ErrorBoundary";
import Button from "../../components/Button/Button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import TeamsSidebarNav from "./components/TeamsSidebarNav";
import { TeamsPageProvider, useTeamsPage } from "./TeamsPageContext";
import { getTeamsSectionSkeleton } from "./teamsPageSkeletons";
import { getActiveTeamsNavSection, teamsNavSections } from "./teamsNavSections";

const TeamsSchedulesPage = lazy(() => import("./pages/TeamsSchedulesPage"));
const TeamsFormsPage = lazy(() => import("./pages/TeamsFormsPage"));
const TeamsMembersPage = lazy(() => import("./pages/TeamsMembersPage"));
const TeamsPositionsPage = lazy(() => import("./pages/TeamsPositionsPage"));
const TeamsGroupsPage = lazy(() => import("./pages/TeamsGroupsPage"));
const TeamsRolesPage = lazy(() => import("./pages/TeamsRolesPage"));
const TeamsQualificationsPage = lazy(() => import("./pages/TeamsQualificationsPage"));
const TeamsServicesPage = lazy(() => import("./pages/TeamsServicesPage"));

const TeamsSectionLoadingFallback = () => {
  const location = useLocation();
  const activeSection = getActiveTeamsNavSection(location.pathname);
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
  const { loading, toolbarLogoUrl, churchName, canEditAnyTeam } = useTeamsPage();
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const activeSection = useMemo(
    () => getActiveTeamsNavSection(location.pathname),
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
          {!canEditAnyTeam ? (
            <p className="mx-auto rounded-full border border-cyan-400/40 bg-cyan-500/10 px-3 py-1 text-xs font-semibold text-cyan-100">
              View-only Teams access
            </p>
          ) : null}
        </section>

        <section className="mx-auto mt-6 flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-xl border border-gray-700 bg-gray-900/40 lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-700 bg-gray-950/70 px-3 py-3 lg:hidden">
            <Button
              variant="secondary"
              svg={PanelLeft}
              iconSize="sm"
              aria-label="Open Teams sections"
              onClick={() => setMobileNavOpen(true)}
            >
              Sections
            </Button>
            <p className="truncate text-sm font-semibold text-gray-100">
              {activeSection.label}
            </p>
          </div>

          <aside className="hidden min-h-0 border-gray-700 bg-gray-950/70 lg:block lg:border-r lg:p-4">
            <TeamsSidebarNav />
          </aside>

          <div className="teams-section-scroll scrollbar-variable min-h-0 min-w-0 flex flex-1 flex-col overflow-y-auto overflow-x-hidden p-3 sm:p-5">
            {loading ? (
              getTeamsSectionSkeleton(activeSection.routePath)
            ) : (
              <Outlet />
            )}
          </div>
        </section>
      </div>

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent
          side="left"
          className="flex w-[16rem] max-w-[85vw] flex-col border-gray-700 bg-gray-950/95 p-0"
          aria-describedby={undefined}
        >
          <SheetHeader className="border-gray-700 bg-gray-950/95">
            <SheetTitle>Teams sections</SheetTitle>
          </SheetHeader>
          <div className="scrollbar-variable min-h-0 flex-1 overflow-y-auto p-4">
            <TeamsSidebarNav onNavigate={() => setMobileNavOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>
    </main>
  );
};

const TeamsRoutes = () => (
  <Routes>
    <Route element={<TeamsLayout />}>
      <Route index element={<Navigate to="schedules" replace />} />
      <Route
        path={teamsNavSections[0].routePath}
        element={
          <TeamsSectionRoute>
            <TeamsSchedulesPage />
          </TeamsSectionRoute>
        }
      />
      <Route
        path={teamsNavSections[1].routePath}
        element={
          <TeamsSectionRoute>
            <TeamsMembersPage />
          </TeamsSectionRoute>
        }
      />
      <Route
        path={teamsNavSections[2].routePath}
        element={
          <TeamsSectionRoute>
            <TeamsPositionsPage />
          </TeamsSectionRoute>
        }
      />
      <Route
        path={teamsNavSections[3].routePath}
        element={
          <TeamsSectionRoute>
            <TeamsGroupsPage />
          </TeamsSectionRoute>
        }
      />
      <Route
        path={teamsNavSections[4].routePath}
        element={
          <TeamsSectionRoute>
            <TeamsRolesPage />
          </TeamsSectionRoute>
        }
      />
      <Route
        path={teamsNavSections[5].routePath}
        element={
          <TeamsSectionRoute>
            <TeamsQualificationsPage />
          </TeamsSectionRoute>
        }
      />
      <Route
        path={teamsNavSections[6].routePath}
        element={
          <TeamsSectionRoute>
            <TeamsServicesPage />
          </TeamsSectionRoute>
        }
      />
      <Route
        path={teamsNavSections[7].routePath}
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
