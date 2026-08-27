import { lazy, Suspense, useContext, useMemo, useState, type ReactNode } from "react";
import { Building2, ListChecks, LogIn, PanelLeft } from "lucide-react";
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "../utils/cnHelper";
import {
  ACCOUNT_SECTIONS,
  getActiveAccountSection,
  parseLegacyAccountTab,
} from "./Account/accountConstants";
import { AccountPageProvider, useAccountPage } from "./Account/AccountPageContext";
import AccountAccessDenied from "./Account/components/AccountAccessDenied";
import AccountDeleteModalHost from "./Account/components/AccountDeleteModalHost";
import AccountSectionHeader from "./Account/components/AccountSectionHeader";
import AccountSidebarNav from "./Account/components/AccountSidebarNav";
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
  const location = useLocation();
  const { canManage } = useAccountPage();
  const activeSection = useMemo(
    () => getActiveAccountSection(location.pathname),
    [location.pathname],
  );
  if (!canManage) {
    return <AccountAccessDenied />;
  }

  return (
    <div className="space-y-4 text-white">
      <AccountSectionHeader section={activeSection} />
      <Outlet />
      <AccountDeleteModalHost />
    </div>
  );
};

const AccountShell = () => {
  const location = useLocation();
  const { loginState, churchName } = useContext(GlobalInfoContext) || {};
  const { canManage, toolbarLogoUrl } = useAccountPage();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
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
    >
        <section
          className={cn(
            "mx-auto mt-0 flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-none border border-gray-700 bg-gray-900/40",
            canManage && "lg:grid lg:grid-cols-[13rem_minmax(0,1fr)]",
          )}
        >
          {canManage ? (
            <>
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-700 bg-gray-950/70 px-3 py-3 lg:hidden">
                <Button
                  variant="secondary"
                  svg={PanelLeft}
                  iconSize="sm"
                  aria-label="Open church administration sections"
                  onClick={() => setMobileNavOpen(true)}
                >
                  Sections
                </Button>
                <p className="truncate text-sm font-semibold text-gray-100">
                  {activeSection.label}
                </p>
              </div>

              <Sidebar className="hidden lg:block lg:border-r">
                <AccountSidebarNav />
              </Sidebar>
            </>
          ) : null}

          <div className="scrollbar-variable min-h-0 min-w-0 flex flex-1 flex-col overflow-y-auto overflow-x-hidden p-3 sm:p-5">
            <Outlet />
          </div>
        </section>
      {canManage ? (
        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <SheetContent
            side="left"
            className="flex w-[16rem] max-w-[85vw] flex-col border-gray-700 bg-gray-950/95 p-0"
            aria-describedby={undefined}
          >
            <SheetHeader className="border-gray-700 bg-gray-950/95">
              <SheetTitle>Church administration sections</SheetTitle>
            </SheetHeader>
            <div className="scrollbar-variable min-h-0 flex-1 overflow-y-auto p-4">
              <AccountSidebarNav onNavigate={() => setMobileNavOpen(false)} />
            </div>
          </SheetContent>
        </Sheet>
      ) : null}
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
