import { lazy, Suspense, useContext, useMemo, type ReactNode } from "react";
import { Building2, ListChecks, LogIn } from "lucide-react";
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
  ACCOUNT_SECTIONS,
  getActiveAccountSection,
  parseLegacyAccountTab,
} from "./Account/accountConstants";
import { AccountPageProvider, useAccountPage } from "./Account/AccountPageContext";
import AccountAccessDenied from "./Account/components/AccountAccessDenied";
import AccountDeleteModalHost from "./Account/components/AccountDeleteModalHost";
import AccountSidebarNav from "./Account/components/AccountSidebarNav";
import AccountMobileNavigation from "./Account/components/AccountMobileNavigation";
import { AccountSectionRouteSkeleton } from "./Account/accountPageSkeletons";
import Sidebar from "../components/Sidebar/Sidebar";

const AccountPeoplePage = lazy(() => import("./Account/pages/AccountPeoplePage"));
const AccountSetupPage = lazy(() => import("./Account/pages/AccountSetupPage"));
const AccountBrandingPage = lazy(
  () => import("./Account/pages/AccountBrandingPage"),
);
const AccountIntegrationsPage = lazy(
  () => import("./Account/pages/AccountIntegrationsPage"),
);

const AccountSectionErrorFallback = () => (
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
  </div>
);

const AccountSectionRoute = ({ children }: { children: ReactNode }) => (
  <ErrorBoundary fallback={<AccountSectionErrorFallback />}>
    <Suspense fallback={<AccountSectionRouteSkeleton />}>{children}</Suspense>
  </ErrorBoundary>
);

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
  const { canManage, toolbarLogoUrl } = useAccountPage();
  const isLoggedIn = loginState === "success";
  const churchNameTrimmed = churchName?.trim() ?? "";
  const activeSection = useMemo(
    () => getActiveAccountSection(location.pathname),
    [location.pathname],
  );
  const scrollbarWidth = useSelector(
    (state: RootState) => state.undoable.present.preferences.scrollbarWidth,
  );
  return (
    <AppWorkspaceShell
      title="Church administration"
      mobileTitle={activeSection.label}
      centerTitleOnMobile
      icon={Building2}
      toolbarLogoUrl={toolbarLogoUrl}
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
        <section
          className={cn(
            "mx-auto mt-0 flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-none border border-gray-700 bg-gray-900/40",
            canManage && "lg:grid lg:grid-cols-[13rem_minmax(0,1fr)]",
          )}
        >
          {canManage ? (
            <>
              <Sidebar className="hidden lg:block lg:border-r">
                <AccountSidebarNav />
              </Sidebar>
            </>
          ) : null}

          <div
            className={cn(
              "scrollbar-variable min-h-0 min-w-0 flex flex-1 flex-col overflow-y-auto overflow-x-hidden",
              activeSection.id === "branding" ? "p-0" : "p-3 sm:p-5",
            )}
          >
            <Outlet />
          </div>
        </section>
    </AppWorkspaceShell>
  );
};

const AccountRoutes = () => (
  <Routes>
    <Route index element={<AccountIndexRedirect />} />
    <Route element={<AccountShell />}>
      <Route element={<AccountSectionLayout />}>
        <Route
          path={ACCOUNT_SECTIONS[0].routePath}
          element={
            <AccountSectionRoute>
              <AccountPeoplePage />
            </AccountSectionRoute>
          }
        />
        <Route
          path={ACCOUNT_SECTIONS[1].routePath}
          element={
            <AccountSectionRoute>
              <AccountSetupPage />
            </AccountSectionRoute>
          }
        />
        <Route
          path={ACCOUNT_SECTIONS[2].routePath}
          element={
            <AccountSectionRoute>
              <AccountBrandingPage />
            </AccountSectionRoute>
          }
        />
        <Route
          path={ACCOUNT_SECTIONS[3].routePath}
          element={
            <AccountSectionRoute>
              <AccountIntegrationsPage />
            </AccountSectionRoute>
          }
        />
        <Route path="*" element={<Navigate to="people" replace />} />
      </Route>
    </Route>
  </Routes>
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
