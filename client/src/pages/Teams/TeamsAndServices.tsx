import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ChevronLeft, ChevronRight, ListChecks, Users } from "lucide-react";
import {
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import Icon from "../../components/Icon/Icon";
import AppWorkspaceShell from "../../components/AppPageShell/AppWorkspaceShell";
import ErrorBoundary from "../../components/ErrorBoundary/ErrorBoundary";
import Button from "../../components/Button/Button";
import { cn } from "@/utils/cnHelper";
import Sidebar, { APP_SIDEBAR_WIDTH_CLASS } from "../../components/Sidebar/Sidebar";
import TeamsMobileNavigation from "./components/TeamsMobileNavigation";
import TeamsSidebarNav from "./components/TeamsSidebarNav";
import { useTeamsAbandonedReturnCleanup } from "./hooks/useTeamsAbandonedReturnCleanup";
import { TeamsPageProvider, useTeamsPage } from "./TeamsPageContext";
import { TeamsNavigationGuardProvider } from "./TeamsNavigationGuardContext";
import { getTeamsSectionSkeleton } from "./teamsPageSkeletons";
import { teamsSectionScrollClassName } from "./teamsStyles";
import {
  getActiveTeamsNavSection,
  servicesNavSections,
  teamsNavSections,
} from "./teamsNavSections";
import {
  getStoredTeamsAndServicesRoute,
  saveTeamsAndServicesRoute,
} from "./teamsRoutePersistence";

const TeamsSchedulesPage = lazy(() => import("./pages/TeamsSchedulesPage"));
const TeamsFormsPage = lazy(() => import("./pages/TeamsFormsPage"));
const TeamsMembersPage = lazy(() => import("./pages/TeamsMembersPage"));
const TeamsPositionsPage = lazy(() => import("./pages/TeamsPositionsPage"));
const TeamsGroupsPage = lazy(() => import("./pages/TeamsGroupsPage"));
const TeamsRolesPage = lazy(() => import("./pages/TeamsRolesPage"));
const TeamsQualificationsPage = lazy(() => import("./pages/TeamsQualificationsPage"));
const TeamsPlansPage = lazy(() => import("./pages/TeamsPlansPage"));
const TeamsTemplatesPage = lazy(() => import("./pages/TeamsTemplatesPage"));
const TeamsMicrophonesPage = lazy(() => import("./pages/TeamsMicrophonesPage"));
const TeamsServiceSettingsPage = lazy(() => import("./pages/TeamsServiceSettingsPage"));

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
        Try again, or open another section from the sidebar.
      </p>
    </div>
    <Button type="button" onClick={() => window.location.reload()}>
      Reload page
    </Button>
  </div>
);

const TeamsSectionRoute = ({ children }: { children: ReactNode }) => (
  <ErrorBoundary fallback={<TeamsSectionErrorFallback />}>
    <Suspense fallback={<TeamsSectionLoadingFallback />}>{children}</Suspense>
  </ErrorBoundary>
);

const TeamsAndServicesIndexRedirect = () => {
  const navigate = useNavigate();

  useEffect(() => {
    navigate(getStoredTeamsAndServicesRoute() ?? teamsNavSections[0].path, {
      replace: true,
    });
  }, [navigate]);

  return null;
};

const TeamsAndServicesLayout = () => {
  const { loading, toolbarLogoUrl, churchName } = useTeamsPage();
  const location = useLocation();
  useTeamsAbandonedReturnCleanup();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const activeSection = useMemo(
    () =>
      getActiveTeamsNavSection(
        location.pathname === "/teams-and-services"
          ? getStoredTeamsAndServicesRoute() ?? teamsNavSections[0].path
          : location.pathname,
      ),
    [location.pathname],
  );

  useEffect(() => {
    saveTeamsAndServicesRoute(location.pathname);
  }, [location.pathname]);

  return (
    <AppWorkspaceShell
      title="Teams and Services"
      mobileTitle={activeSection.label}
      centerTitleOnMobile
      icon={Users}
      toolbarLogoUrl={toolbarLogoUrl}
      churchName={churchName}
      mobileNavigation={
        (menuItems) => <TeamsMobileNavigation menuItems={menuItems} />
      }
    >
        <section className="mx-auto mt-0 flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-none border border-gray-700 bg-gray-900/40 lg:grid lg:grid-cols-[auto_minmax(0,1fr)]">
          <Sidebar
            className={cn(
              "relative hidden flex-col transition-[width,padding] duration-300 ease-in-out lg:flex lg:border-r",
              sidebarCollapsed ? "w-14 lg:p-2" : `${APP_SIDEBAR_WIDTH_CLASS} lg:p-2`,
            )}
          >
            <Button
              type="button"
              variant="tertiary"
              padding="p-0"
              position="absolute"
              className="right-0 top-1/2 z-20 flex size-8 min-h-0 max-md:min-h-0 shrink-0 items-center justify-center translate-x-1/2 -translate-y-1/2 rounded-full border border-gray-700 bg-gray-950 shadow-sm"
              aria-expanded={!sidebarCollapsed}
              aria-label={
                sidebarCollapsed ? "Expand sections" : "Collapse sections"
              }
              onClick={() => setSidebarCollapsed((current) => !current)}
            >
              {sidebarCollapsed ? (
                <ChevronRight className="size-4 shrink-0" aria-hidden />
              ) : (
                <ChevronLeft className="size-4 shrink-0" aria-hidden />
              )}
            </Button>
            <TeamsSidebarNav collapsed={sidebarCollapsed} />
          </Sidebar>

          <div className={teamsSectionScrollClassName}>
            <div className="flex min-h-0 flex-1 flex-col">
              {loading ? (
                getTeamsSectionSkeleton(activeSection.routePath)
              ) : (
                <Outlet />
              )}
            </div>
          </div>
        </section>
    </AppWorkspaceShell>
  );
};

const TeamsAndServicesRoutes = () => (
  <Routes>
    <Route element={<TeamsAndServicesLayout />}>
      <Route index element={<TeamsAndServicesIndexRedirect />} />
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
            <TeamsFormsPage />
          </TeamsSectionRoute>
        }
      />
      <Route
        path={servicesNavSections[0].routePath}
        element={
          <TeamsSectionRoute>
            <TeamsPlansPage />
          </TeamsSectionRoute>
        }
      />
      <Route
        path={servicesNavSections[1].routePath}
        element={
          <TeamsSectionRoute>
            <TeamsTemplatesPage />
          </TeamsSectionRoute>
        }
      />
      <Route
        path={servicesNavSections[2].routePath}
        element={
          <TeamsSectionRoute>
            <TeamsMicrophonesPage />
          </TeamsSectionRoute>
        }
      />
      <Route
        path={servicesNavSections[3].routePath}
        element={
          <TeamsSectionRoute>
            <TeamsServiceSettingsPage />
          </TeamsSectionRoute>
        }
      />
      {/* Compatibility redirects retained for one release. */}
      <Route
        path="plans/*"
        element={<Navigate to={servicesNavSections[0].path} replace />}
      />
      <Route
        path="service-settings/*"
        element={<Navigate to={servicesNavSections[3].path} replace />}
      />
      <Route path="*" element={<Navigate to="schedules" replace />} />
    </Route>
  </Routes>
);

const TeamsAndServicesPage = () => (
  <TeamsPageProvider>
    <TeamsNavigationGuardProvider>
      <TeamsAndServicesRoutes />
    </TeamsNavigationGuardProvider>
  </TeamsPageProvider>
);

export default TeamsAndServicesPage;
