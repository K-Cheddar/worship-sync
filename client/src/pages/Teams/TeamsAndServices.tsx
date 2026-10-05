import {
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
import { lazyRoute } from "../../utils/lazyRoute";
import {
  getActiveTeamsNavSection,
  getFirstAvailableTeamsNavPath,
  isTeamsNavPathAvailable,
} from "./teamsNavSections";
import {
  getStoredTeamsAndServicesRoute,
  saveTeamsAndServicesRoute,
} from "./teamsRoutePersistence";

const TeamsSchedulesPage = lazyRoute(() => import("./pages/TeamsSchedulesPage"));
const TeamsMessagesPage = lazyRoute(() => import("./pages/TeamsMessagesPage"));
const TeamsFormsPage = lazyRoute(() => import("./pages/TeamsFormsPage"));
const TeamsMembersPage = lazyRoute(() => import("./pages/TeamsMembersPage"));
const TeamsPositionsPage = lazyRoute(() => import("./pages/TeamsPositionsPage"));
const TeamsGroupsPage = lazyRoute(() => import("./pages/TeamsGroupsPage"));
const TeamsRolesPage = lazyRoute(() => import("./pages/TeamsRolesPage"));
const TeamsQualificationsPage = lazyRoute(() => import("./pages/TeamsQualificationsPage"));
const TeamsPlansPage = lazyRoute(() => import("./pages/TeamsPlansPage"));
const TeamsTemplatesPage = lazyRoute(() => import("./pages/TeamsTemplatesPage"));
const TeamsMicrophonesPage = lazyRoute(() => import("./pages/TeamsMicrophonesPage"));
const TeamsServiceSettingsPage = lazyRoute(() => import("./pages/TeamsServiceSettingsPage"));

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
  const { availableNavSections } = useTeamsPage();

  useEffect(() => {
    const storedRoute = getStoredTeamsAndServicesRoute();
    navigate(
      storedRoute && isTeamsNavPathAvailable(storedRoute, availableNavSections)
        ? storedRoute
        : getFirstAvailableTeamsNavPath(availableNavSections),
      {
        replace: true,
      },
    );
  }, [availableNavSections, navigate]);

  return null;
};

const TeamsAndServicesLayout = () => {
  const { loading, toolbarLogos, churchName, availableNavSections } = useTeamsPage();
  const location = useLocation();
  useTeamsAbandonedReturnCleanup();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const storedRoute = getStoredTeamsAndServicesRoute();
  const activePath =
    location.pathname === "/teams-and-services"
      ? storedRoute && isTeamsNavPathAvailable(storedRoute, availableNavSections)
        ? storedRoute
        : getFirstAvailableTeamsNavPath(availableNavSections)
      : location.pathname;
  const activeSection = useMemo(
    () => getActiveTeamsNavSection(activePath),
    [activePath],
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
      toolbarLogos={toolbarLogos}
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
      <Route element={<TeamsSectionAccessGuard />}>
      <Route index element={<TeamsAndServicesIndexRedirect />} />
      <Route
        path="messages"
        element={
          <TeamsSectionRoute>
            <TeamsMessagesPage />
          </TeamsSectionRoute>
        }
      />
      <Route
        path="schedules"
        element={
          <TeamsSectionRoute>
            <TeamsSchedulesPage />
          </TeamsSectionRoute>
        }
      />
      <Route
        path="members"
        element={
          <TeamsSectionRoute>
            <TeamsMembersPage />
          </TeamsSectionRoute>
        }
      />
      <Route
        path="positions"
        element={
          <TeamsSectionRoute>
            <TeamsPositionsPage />
          </TeamsSectionRoute>
        }
      />
      <Route
        path="groups"
        element={
          <TeamsSectionRoute>
            <TeamsGroupsPage />
          </TeamsSectionRoute>
        }
      />
      <Route
        path="roles"
        element={
          <TeamsSectionRoute>
            <TeamsRolesPage />
          </TeamsSectionRoute>
        }
      />
      <Route
        path="qualifications"
        element={
          <TeamsSectionRoute>
            <TeamsQualificationsPage />
          </TeamsSectionRoute>
        }
      />
      <Route
        path="forms"
        element={
          <TeamsSectionRoute>
            <TeamsFormsPage />
          </TeamsSectionRoute>
        }
      />
      <Route
        path="services"
        element={
          <TeamsSectionRoute>
            <TeamsPlansPage />
          </TeamsSectionRoute>
        }
      />
      <Route
        path="templates"
        element={
          <TeamsSectionRoute>
            <TeamsTemplatesPage />
          </TeamsSectionRoute>
        }
      />
      <Route
        path="microphones"
        element={
          <TeamsSectionRoute>
            <TeamsMicrophonesPage />
          </TeamsSectionRoute>
        }
      />
      <Route
        path="service-setup"
        element={
          <TeamsSectionRoute>
            <TeamsServiceSettingsPage />
          </TeamsSectionRoute>
        }
      />
      {/* Compatibility redirects retained for one release. */}
      <Route
        path="plans/*"
        element={<Navigate to="/teams-and-services/services" replace />}
      />
      <Route
        path="service-settings/*"
        element={<Navigate to="/teams-and-services/service-setup" replace />}
      />
      <Route path="*" element={<Navigate to="schedules" replace />} />
      </Route>
    </Route>
  </Routes>
);

const TeamsSectionAccessGuard = () => {
  const { loading, availableNavSections } = useTeamsPage();
  const location = useLocation();

  if (
    loading ||
    location.pathname === "/teams-and-services" ||
    isTeamsNavPathAvailable(location.pathname, availableNavSections)
  ) {
    return <Outlet />;
  }

  return (
    <Navigate to={getFirstAvailableTeamsNavPath(availableNavSections)} replace />
  );
};

const TeamsNoAccess = () => (
  <main className="flex min-h-dvh items-center justify-center bg-homepage-canvas px-4 text-white">
    <section className="w-full max-w-md rounded-xl border border-gray-700 bg-gray-900/80 p-6 text-center">
      <h1 className="text-2xl font-semibold">No team access</h1>
      <p className="mt-2 text-sm leading-relaxed text-gray-200">
        You aren’t currently linked to a team in WorshipSync. If you think you should be, ask a team leader or administrator.
      </p>
      <div className="mt-5 flex justify-center">
        <Button component="link" to="/home" variant="secondary">
          Home
        </Button>
      </div>
    </section>
  </main>
);

const TeamsAndServicesContent = () => {
  const { accessDenied } = useTeamsPage();
  return accessDenied ? <TeamsNoAccess /> : <TeamsAndServicesRoutes />;
};

const TeamsAndServicesPage = () => (
  <TeamsPageProvider>
    <TeamsNavigationGuardProvider>
      <TeamsAndServicesContent />
    </TeamsNavigationGuardProvider>
  </TeamsPageProvider>
);

export default TeamsAndServicesPage;
