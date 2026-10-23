import {
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ChevronLeft, ChevronRight, ListChecks } from "lucide-react";
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
import TeamsMobileShortcuts from "./components/TeamsMobileShortcuts";
import { PAGE_APPEARANCES } from "../pageAppearances";
import ChurchServiceTimeZoneGate from "./components/ChurchServiceTimeZoneGate";
import { useTeamsAbandonedReturnCleanup } from "./hooks/useTeamsAbandonedReturnCleanup";
import { TeamsPageProvider, useTeamsPage } from "./TeamsPageContext";
import {
  TeamsNavigationGuardProvider,
  usePendingTeamsNavigation,
} from "./TeamsNavigationGuardContext";
import { getTeamsSectionSkeleton } from "./teamsPageSkeletons";
import { teamsSectionScrollClassName } from "./teamsStyles";
import { lazyRoute } from "../../utils/lazyRoute";
import { PendingRouteReady } from "../../hooks/usePendingRouteNavigation";
import { getPageTitle } from "../../utils/pageTitles";
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

const isTeamsSectionPath = (pathname: string, routePath: string) => {
  const sectionPath = `/teams-and-services/${routePath}`;
  return pathname === sectionPath || pathname.startsWith(`${sectionPath}/`);
};

const TeamsSectionErrorFallback = ({ routePath }: { routePath: string }) => {
  const location = useLocation();
  const { pathname, clear } = usePendingTeamsNavigation();

  useLayoutEffect(() => {
    if (
      pathname === location.pathname &&
      isTeamsSectionPath(location.pathname, routePath)
    ) {
      clear();
    }
  }, [clear, location.pathname, pathname, routePath]);

  return (
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
};

const TeamsSectionRoute = ({
  children,
  routePath,
}: {
  children: ReactNode;
  routePath: string;
}) => (
  <ErrorBoundary fallback={<TeamsSectionErrorFallback routePath={routePath} />}>
    <Suspense fallback={<TeamsSectionLoadingFallback />}>
      <>
        {children}
        <PendingRouteReady routePath={`/teams-and-services/${routePath}`} />
      </>
    </Suspense>
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
  const pendingNavigation = usePendingTeamsNavigation();
  useTeamsAbandonedReturnCleanup();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const storedRoute = getStoredTeamsAndServicesRoute();
  const pendingPath =
    pendingNavigation.pathname &&
    isTeamsNavPathAvailable(pendingNavigation.pathname, availableNavSections)
    ? pendingNavigation.pathname
    : null;
  const activePath =
    pendingPath || (location.pathname === "/teams-and-services"
      ? storedRoute && isTeamsNavPathAvailable(storedRoute, availableNavSections)
        ? storedRoute
        : getFirstAvailableTeamsNavPath(availableNavSections)
      : location.pathname);
  const activeSection = useMemo(
    () => getActiveTeamsNavSection(activePath),
    [activePath],
  );

  useLayoutEffect(() => {
    if (pendingPath) {
      document.title = getPageTitle(pendingPath);
    }
  }, [pendingPath]);

  useEffect(() => {
    if (pendingNavigation.pathname && !pendingPath) {
      pendingNavigation.clear();
    }
  }, [pendingNavigation, pendingPath]);

  useEffect(() => {
    saveTeamsAndServicesRoute(location.pathname);
  }, [location.pathname]);

  return (
    <AppWorkspaceShell
      title="Teams and Services"
      mobileTitle={activeSection.label}
      centerTitleOnMobile
      {...PAGE_APPEARANCES.teamsAndServices}
      toolbarLogos={toolbarLogos}
      churchName={churchName}
      compactMobileToolbar
      className="[--teams-bottom-navigation-height:calc(57px_+_env(safe-area-inset-bottom))] max-lg:pb-[var(--teams-bottom-navigation-height)] lg:[--teams-bottom-navigation-height:0px]"
      workspaceNavigation={
        (menuItems, updateReady) => <TeamsMobileNavigation menuItems={menuItems} updateReady={updateReady} />
      }
    >
      <TeamsMobileShortcuts secondary activePath={activePath}>
      <section data-teams-workspace className="mx-auto mt-0 flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-none border border-gray-700 bg-gray-900/40 lg:grid lg:grid-cols-[auto_minmax(0,1fr)]">
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

        <div
          className={teamsSectionScrollClassName}
          data-mobile-header-scroll-owner="workspace"
        >
          <div className="flex min-h-0 flex-1 flex-col">
            {loading ? (
              getTeamsSectionSkeleton(activeSection.routePath)
            ) : (
              <>
                <div
                  className={cn(
                    "flex min-h-0 flex-1 flex-col",
                    pendingPath && "hidden",
                  )}
                  aria-hidden={pendingPath ? true : undefined}
                >
                  <Outlet />
                </div>
                {pendingPath
                  ? getTeamsSectionSkeleton(activeSection.routePath)
                  : null}
              </>
            )}
          </div>
        </div>
      </section>
      </TeamsMobileShortcuts>
      <TeamsMobileShortcuts />
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
          <TeamsSectionRoute routePath="messages">
            <TeamsMessagesPage />
          </TeamsSectionRoute>
        }
      />
      <Route
        path="schedules"
        element={
          <TeamsSectionRoute routePath="schedules">
            <ChurchServiceTimeZoneGate area="Schedules">
              <TeamsSchedulesPage />
            </ChurchServiceTimeZoneGate>
          </TeamsSectionRoute>
        }
      />
      <Route
        path="members"
        element={
          <TeamsSectionRoute routePath="members">
            <TeamsMembersPage />
          </TeamsSectionRoute>
        }
      />
      <Route
        path="positions"
        element={
          <TeamsSectionRoute routePath="positions">
            <TeamsPositionsPage />
          </TeamsSectionRoute>
        }
      />
      <Route
        path="groups"
        element={
          <TeamsSectionRoute routePath="groups">
            <TeamsGroupsPage />
          </TeamsSectionRoute>
        }
      />
      <Route
        path="roles"
        element={
          <TeamsSectionRoute routePath="roles">
            <TeamsRolesPage />
          </TeamsSectionRoute>
        }
      />
      <Route
        path="qualifications"
        element={
          <TeamsSectionRoute routePath="qualifications">
            <TeamsQualificationsPage />
          </TeamsSectionRoute>
        }
      />
      <Route
        path="forms"
        element={
          <TeamsSectionRoute routePath="forms">
            <TeamsFormsPage />
          </TeamsSectionRoute>
        }
      />
      <Route
        path="services"
        element={
          <TeamsSectionRoute routePath="services">
            <TeamsPlansPage />
          </TeamsSectionRoute>
        }
      />
      <Route
        path="templates"
        element={
          <TeamsSectionRoute routePath="templates">
            <TeamsTemplatesPage />
          </TeamsSectionRoute>
        }
      />
      <Route
        path="microphones"
        element={
          <TeamsSectionRoute routePath="microphones">
            <TeamsMicrophonesPage />
          </TeamsSectionRoute>
        }
      />
      <Route
        path="service-setup"
        element={
          <TeamsSectionRoute routePath="service-setup">
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
  const { accessDenied, canViewServices } = useTeamsPage();
  if (accessDenied && !canViewServices) return <TeamsNoAccess />;
  return <TeamsAndServicesRoutes />;
};

const TeamsAndServicesPage = () => (
  <TeamsPageProvider>
    <TeamsNavigationGuardProvider>
      <TeamsAndServicesContent />
    </TeamsNavigationGuardProvider>
  </TeamsPageProvider>
);

export default TeamsAndServicesPage;
