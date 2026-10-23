import { Suspense, useContext, useEffect, useMemo, type ReactNode } from "react";
import { ListChecks, LogIn } from "lucide-react";
import {
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import Button from "../components/Button/Button";
import { GlobalInfoContext } from "../context/globalInfo";
import AppWorkspaceShell from "../components/AppPageShell/AppWorkspaceShell";
import { useSelector } from "../hooks";
import type { RootState } from "../store/store";
import Icon from "../components/Icon/Icon";
import ErrorBoundary from "../components/ErrorBoundary/ErrorBoundary";
import { cn } from "../utils/cnHelper";
import {
  getAccountSection,
  getActiveAccountSection,
  parseLegacyAccountTab,
  type AccountTabId,
} from "./Account/accountConstants";
import { AccountPageProvider, useAccountPage } from "./Account/AccountPageContext";
import AccountAccessDenied from "./Account/components/AccountAccessDenied";
import AccountDeleteModalHost from "./Account/components/AccountDeleteModalHost";
import AccountSidebarNav from "./Account/components/AccountSidebarNav";
import AccountMobileNavigation from "./Account/components/AccountMobileNavigation";
import AccountMobileShortcuts from "./Account/components/AccountMobileShortcuts";
import { getAccountSectionSkeleton } from "./Account/accountPageSkeletons";
import { PAGE_APPEARANCES } from "./pageAppearances";
import Sidebar from "../components/Sidebar/Sidebar";
import {
  PendingRouteNavigationProvider,
  PendingRouteReady,
  usePendingRouteNavigation,
} from "../hooks/usePendingRouteNavigation";
import { lazyRoute } from "../utils/lazyRoute";

const AccountPeoplePage = lazyRoute(() => import("./Account/pages/AccountPeoplePage"));
const AccountSetupPage = lazyRoute(() => import("./Account/pages/AccountSetupPage"));
const AccountControllersPage = lazyRoute(
  () => import("./Account/pages/AccountControllersPage"),
);
const AccountBrandingPage = lazyRoute(
  () => import("./Account/pages/AccountBrandingPage"),
);
const AccountIntegrationsPage = lazyRoute(
  () => import("./Account/pages/AccountIntegrationsPage"),
);
const AccountWorkspacePage = lazyRoute(
  () => import("./Account/pages/AccountWorkspacePage"),
);
const AccountDataTransferPage = lazyRoute(
  () => import("./Account/pages/AccountDataTransferPage"),
);

const AccountSectionErrorFallback = ({ routePath }: { routePath: string }) => (
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
        Try again, or open another administration section from the sidebar.
      </p>
    </div>
    <Button type="button" onClick={() => window.location.reload()}>
      Reload administration
    </Button>
    <PendingRouteReady routePath={routePath} />
  </div>
);

const AccountSectionLoadingFallback = () => {
  const location = useLocation();
  const { pathname: pendingPathname } = usePendingRouteNavigation();
  const section = getActiveAccountSection(pendingPathname || location.pathname);
  return getAccountSectionSkeleton(section.id);
};

const AccountSectionRoute = ({
  children,
  sectionId,
}: {
  children: ReactNode;
  sectionId: AccountTabId;
}) => {
  const routePath = getAccountSection(sectionId).path;
  return (
    <ErrorBoundary fallback={<AccountSectionErrorFallback routePath={routePath} />}>
      <Suspense fallback={<AccountSectionLoadingFallback />}>
        <>
          {children}
          <PendingRouteReady routePath={routePath} />
        </>
      </Suspense>
    </ErrorBoundary>
  );
};

const AccountIndexRedirect = () => {
  const location = useLocation();
  const legacyTab = parseLegacyAccountTab(location.search);
  return (
    <Navigate
      to={legacyTab ? `/account/${legacyTab}` : "/account/people"}
      replace
    />
  );
};

const AccountSectionLayout = () => {
  const { canManage } = useAccountPage();
  if (!canManage) {
    return <AccountAccessDenied />;
  }

  return (
    <div className="space-y-4 text-white">
      <Outlet />
      <AccountDeleteModalHost />
    </div>
  );
};

const AccountShell = () => {
  const location = useLocation();
  const { loginState, churchName } = useContext(GlobalInfoContext) || {};
  const { canManage, toolbarLogos } = useAccountPage();
  const { pathname: pendingPathname, clear } = usePendingRouteNavigation();
  useEffect(() => {
    if (!canManage) clear();
  }, [canManage, clear]);
  const isLoggedIn = loginState === "success";
  const churchNameTrimmed = churchName?.trim() ?? "";
  const activeSection = useMemo(
    () =>
      getActiveAccountSection(
        canManage ? pendingPathname || location.pathname : location.pathname,
      ),
    [canManage, location.pathname, pendingPathname],
  );
  const scrollbarWidth = useSelector(
    (state: RootState) => state.undoable.present.preferences.scrollbarWidth,
  );
  return (
    <AppWorkspaceShell
      title="Church administration"
      mobileTitle={activeSection.label}
      centerTitleOnMobile
      {...PAGE_APPEARANCES.churchAdministration}
      compactMobileToolbar
      className="[--account-bottom-navigation-height:calc(57px_+_env(safe-area-inset-bottom))] max-lg:pb-[var(--account-bottom-navigation-height)] lg:[--account-bottom-navigation-height:0px]"
      toolbarLogos={toolbarLogos}
      churchName={churchNameTrimmed}
      scrollbarWidth={scrollbarWidth}
      toolbarActions={
        !isLoggedIn ? (
          <Button
            variant="tertiary"
            svg={LogIn}
            iconSize="sm"
            padding="px-4 py-1"
            component="link"
            to="/login"
          >
            Sign in
          </Button>
        ) : null
      }
      mobileNavigation={
        canManage
          ? (menuItems) => <AccountMobileNavigation menuItems={menuItems} />
          : undefined
      }
    >
      {canManage ? (
        <AccountMobileShortcuts>
          <section
            data-account-workspace
            className={cn(
              "mx-auto mt-0 flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-none border border-gray-700 bg-gray-900/40",
              "lg:grid lg:grid-cols-[13rem_minmax(0,1fr)]",
            )}
          >
            <Sidebar className="hidden lg:block lg:border-r">
              <AccountSidebarNav />
            </Sidebar>

            <div
              data-account-scrollport
              className={cn(
                "scrollbar-variable min-h-0 min-w-0 flex flex-1 flex-col overflow-y-auto overflow-x-hidden",
                activeSection.id === "branding" ? "p-0" : "p-3 sm:p-5",
              )}
            >
              <div
                className={
                  pendingPathname ? "hidden" : "flex min-h-0 flex-1 flex-col"
                }
                aria-hidden={pendingPathname ? true : undefined}
              >
                <Outlet />
              </div>
              {pendingPathname ? getAccountSectionSkeleton(activeSection.id) : null}
            </div>
          </section>
        </AccountMobileShortcuts>
      ) : (
        <section data-account-workspace className="mx-auto mt-0 flex min-h-0 w-full flex-1 flex-col overflow-y-auto overflow-x-hidden rounded-none border border-gray-700 bg-gray-900/40 p-3 sm:p-5">
          <Outlet />
        </section>
      )}
    </AppWorkspaceShell>
  );
};

const AccountRoutes = () => (
  <PendingRouteNavigationProvider>
    <Routes>
      <Route index element={<AccountIndexRedirect />} />
      <Route element={<AccountShell />}>
        <Route element={<AccountSectionLayout />}>
          <Route
            path={getAccountSection("people").routePath}
            element={
              <AccountSectionRoute sectionId="people">
                <AccountPeoplePage />
              </AccountSectionRoute>
            }
          />
          <Route
            path={getAccountSection("setup").routePath}
            element={
              <AccountSectionRoute sectionId="setup">
                <AccountSetupPage />
              </AccountSectionRoute>
            }
          />
          <Route
            path={getAccountSection("controllers").routePath}
            element={
              <AccountSectionRoute sectionId="controllers">
                <AccountControllersPage />
              </AccountSectionRoute>
            }
          />
          <Route
            path={getAccountSection("branding").routePath}
            element={
              <AccountSectionRoute sectionId="branding">
                <AccountBrandingPage />
              </AccountSectionRoute>
            }
          />
          <Route
            path={getAccountSection("integrations").routePath}
            element={
              <AccountSectionRoute sectionId="integrations">
                <AccountIntegrationsPage />
              </AccountSectionRoute>
            }
          />
          <Route
            path={getAccountSection("workspace").routePath}
            element={
              <AccountSectionRoute sectionId="workspace">
                <AccountWorkspacePage />
              </AccountSectionRoute>
            }
          />
          <Route
            path={getAccountSection("data-transfer").routePath}
            element={
              <AccountSectionRoute sectionId="data-transfer">
                <AccountDataTransferPage />
              </AccountSectionRoute>
            }
          />
          <Route path="*" element={<Navigate to="people" replace />} />
        </Route>
      </Route>
    </Routes>
  </PendingRouteNavigationProvider>
);

const AccountPage = () => (
  <AccountPageProvider>
    <AccountRoutes />
  </AccountPageProvider>
);

export default AccountPage;

export {
  ACCOUNT_SECTIONS,
  getLegacyAccountTabPath,
  parseLegacyAccountTab,
} from "./Account/accountConstants";
export type { AccountTabId } from "./Account/accountConstants";
