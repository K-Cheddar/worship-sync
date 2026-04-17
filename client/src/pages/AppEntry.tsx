import { useContext, useMemo, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { ArrowLeft, KeyRound, UserRound } from "lucide-react";
import AuthScreenMain from "../components/AuthScreenMain";
import Button from "../components/Button/Button";
import { GlobalInfoContext } from "../context/globalInfo";
import { getAuthRedirectPathnameFromState } from "../utils/authRedirectPath";
import { getStoredServerSessionHint } from "../utils/authStorage";
import { getAllowedRouteOrDefault } from "../utils/sessionRouteAccess";

type SetupStep = "start" | "link";

const AppEntry = () => {
  const location = useLocation();
  const context = useContext(GlobalInfoContext);
  const [setupStep, setSetupStep] = useState<SetupStep>("start");
  const [isRetryingAuthConnection, setIsRetryingAuthConnection] = useState(false);
  const requestedPath = getAuthRedirectPathnameFromState(location.state) ?? "";
  const authServerStatus = context?.authServerStatus;
  const isAuthConnectionNoticeVisible =
    authServerStatus === "offline" || authServerStatus === "checking";
  const isServerBackedModeDisabled = authServerStatus === "offline";
  const storedServerSessionHint = getStoredServerSessionHint();
  const hasStoredServerSession = storedServerSessionHint !== null;
  const isStoredServerSessionBlocked =
    isServerBackedModeDisabled && hasStoredServerSession;

  const nextState = useMemo(
    () => ({
      from:
        requestedPath && requestedPath !== "/"
          ? { pathname: requestedPath }
          : location,
    }),
    [location, requestedPath]
  );

  const guestDestination =
    requestedPath && requestedPath !== "/" ? requestedPath : "/controller";

  const handleRetryAuthConnection = async () => {
    if (!context || isRetryingAuthConnection) {
      return;
    }

    setIsRetryingAuthConnection(true);
    try {
      await context.refreshAuthBootstrap();
    } finally {
      setIsRetryingAuthConnection(false);
    }
  };

  if (context?.sessionKind === "human") {
    return <Navigate to={requestedPath && requestedPath !== "/" ? requestedPath : "/home"} replace />;
  }

  if (context?.loginState === "guest") {
    const nextPath = getAllowedRouteOrDefault(requestedPath, {
      loginState: context.loginState,
      sessionKind: context.sessionKind,
      access: context.access,
      operatorName: context.operatorName,
      displaySurfaceType: context.device?.surfaceType,
    });
    return <Navigate to={nextPath} replace />;
  }

  if (context?.sessionKind === "workstation") {
    const routeContext = {
      loginState: context.loginState,
      sessionKind: context.sessionKind,
      access: context.access,
      operatorName: context.operatorName,
      displaySurfaceType: context.device?.surfaceType,
    };
    const nextPath =
      requestedPath && requestedPath !== "/"
        ? getAllowedRouteOrDefault(requestedPath, routeContext)
        : "/home";
    return <Navigate to={nextPath} replace />;
  }

  if (context?.sessionKind === "display") {
    const nextPath = getAllowedRouteOrDefault(requestedPath, {
      loginState: context.loginState,
      sessionKind: context.sessionKind,
      access: context.access,
      operatorName: context.operatorName,
      displaySurfaceType: context.device?.surfaceType,
    });
    return (
      <Navigate
        to={nextPath}
        replace
      />
    );
  }

  return (
    <AuthScreenMain>
      <div className="flex w-full max-w-2xl flex-col rounded-2xl border border-gray-500 bg-gray-800 p-6 sm:p-8">
        <div className="shrink-0">
          <h1 className="text-2xl font-semibold sm:text-3xl">
            {isStoredServerSessionBlocked
              ? "Reconnect to continue"
              : "Get started with WorshipSync"}
          </h1>
          <p className="mt-2 max-w-xl text-sm text-gray-200 sm:text-base">
            {isStoredServerSessionBlocked
              ? "This device has a saved sign-in or link."
              : "Choose how to use this device."}
          </p>
          {isAuthConnectionNoticeVisible ? (
            <div
              className="mt-4 rounded-lg border border-yellow-400/40 bg-yellow-500/10 p-3 text-sm text-yellow-50"
              role="status"
            >
              <p className="font-semibold">
                {authServerStatus === "checking"
                  ? "Connecting to WorshipSync..."
                  : hasStoredServerSession
                    ? "Could not verify this device."
                    : "Could not reach WorshipSync."}
              </p>
              <p className="mt-1 text-yellow-100/90">
                {hasStoredServerSession
                  ? "WorshipSync can't verify this device with your church right now. You can retry or use the offline demo on this device."
                  : "Sign-in and device linking need a connection. You can still use the offline demo on this device."}
              </p>
              {authServerStatus === "offline" ? (
                <Button
                  type="button"
                  variant="tertiary"
                  className="mt-3 border border-yellow-300/40 bg-yellow-400/10 text-yellow-50 hover:bg-yellow-400/20"
                  onClick={() => {
                    void handleRetryAuthConnection();
                  }}
                  disabled={isRetryingAuthConnection}
                  isLoading={isRetryingAuthConnection}
                >
                  {isRetryingAuthConnection ? "Trying again..." : "Try again"}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="mt-8 space-y-8">
          {setupStep === "link" ? (
            <section aria-labelledby="entry-link-heading">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2
                  id="entry-link-heading"
                  className="text-xs font-semibold uppercase tracking-wide text-gray-400"
                >
                  Link with a code (no personal account)
                </h2>
                <Button
                  component="button"
                  type="button"
                  variant="textLink"
                  svg={ArrowLeft}
                  iconSize="sm"
                  gap="gap-1.5"
                  className="shrink-0"
                  onClick={() => {
                    setSetupStep("start");
                  }}
                >
                  Back
                </Button>
              </div>
              <p className="mt-1 text-sm text-gray-300">
                Shared controller for the live presentation, or a linked display for the audience
                (room screens, stream, credits, or discussion board). Enter the code from account
                settings. There is no mode switch on the next screen.
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Button
                  component="link"
                  to="/workstation/pair"
                  variant="tertiary"
                  className="min-h-22 flex-col items-start justify-center gap-2 rounded-xl border border-gray-500 bg-gray-900/50 p-4 text-left sm:min-h-24"
                  state={nextState}
                  disabled={isServerBackedModeDisabled}
                  wrap
                >
                  <span className="text-lg font-semibold">Link as workstation</span>
                  <span className="text-sm font-normal text-gray-200">
                    Shared computer for the full live controller with no personal sign-in. You can
                    also open audience outputs on this device, or use a linked display on another
                    machine.
                  </span>
                </Button>
                <Button
                  component="link"
                  to="/display/pair"
                  variant="tertiary"
                  className="min-h-22 flex-col items-start justify-center gap-2 rounded-xl border border-gray-500 bg-gray-900/50 p-4 text-left sm:min-h-24"
                  state={nextState}
                  disabled={isServerBackedModeDisabled}
                  wrap
                >
                  <span className="text-lg font-semibold">Link as display</span>
                  <span className="text-sm font-normal text-gray-200">
                    Room screens, stream, credits, or discussion board content your team presents
                    from WorshipSync.
                  </span>
                </Button>
              </div>
              {isServerBackedModeDisabled ? (
                <p className="mt-2 text-sm text-yellow-100/90">Connection required</p>
              ) : null}
            </section>
          ) : (
            <>
              <section aria-labelledby="entry-personal-heading">
                <h2
                  id="entry-personal-heading"
                  className="text-xs font-semibold uppercase tracking-wide text-gray-400"
                >
                  Personal sign-in
                </h2>
                <div className="mt-3">
                  <Button
                    component="link"
                    to="/login"
                    variant="cta"
                    className="min-h-22 w-full flex-col items-start justify-center gap-2 rounded-xl border border-cyan-500/40 bg-cyan-700/30 p-4 text-left sm:min-h-24"
                    state={nextState}
                    disabled={isServerBackedModeDisabled}
                    wrap
                  >
                    <span className="text-lg font-semibold">Sign in</span>
                    <span className="text-sm font-normal text-gray-100">
                      Sign in to your church with Google, Microsoft, or email/password.
                    </span>
                  </Button>
                  {isServerBackedModeDisabled ? (
                    <p className="mt-2 text-sm text-yellow-100/90">Connection required</p>
                  ) : null}
                </div>
              </section>

              <div className="border-t border-gray-600/80" role="presentation" />

              <section aria-labelledby="entry-link-heading">
                <h2
                  id="entry-link-heading"
                  className="text-xs font-semibold uppercase tracking-wide text-gray-400"
                >
                  More setup options
                </h2>
                <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 sm:items-start sm:gap-4">
                  <div className="flex min-w-0 flex-col gap-2">
                    <Button
                      component="button"
                      type="button"
                      variant="secondary"
                      svg={KeyRound}
                      iconSize="sm"
                      gap="gap-2"
                      className="w-full justify-center"
                      disabled={isServerBackedModeDisabled}
                      onClick={() => {
                        setSetupStep("link");
                      }}
                    >
                      Link with code
                    </Button>
                    {isServerBackedModeDisabled ? (
                      <p className="text-sm text-yellow-100/90">Connection required</p>
                    ) : null}
                  </div>
                  <div className="flex min-w-0 flex-col gap-2">
                    <Button
                      component="button"
                      type="button"
                      variant="secondary"
                      svg={UserRound}
                      iconSize="sm"
                      gap="gap-2"
                      className="w-full justify-center"
                      onClick={() => {
                        context?.enterGuestMode(guestDestination);
                      }}
                    >
                      Test as guest
                    </Button>
                  </div>
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </AuthScreenMain>
  );
};

export default AppEntry;
