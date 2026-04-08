import { useContext, useMemo } from "react";
import { Navigate, useLocation } from "react-router-dom";
import Button from "../components/Button/Button";
import { GlobalInfoContext } from "../context/globalInfo";
import { getAuthRedirectPathnameFromState } from "../utils/authRedirectPath";
import { getAllowedRouteOrDefault } from "../utils/sessionRouteAccess";

const AppEntry = () => {
  const location = useLocation();
  const context = useContext(GlobalInfoContext);
  const requestedPath = getAuthRedirectPathnameFromState(location.state) ?? "";

  const nextState = useMemo(
    () => ({
      from:
        requestedPath && requestedPath !== "/"
          ? { pathname: requestedPath }
          : location,
    }),
    [location, requestedPath]
  );

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
    <main className="min-h-dvh overflow-y-auto bg-gray-700 px-4 py-8 text-white">
      <div className="mx-auto w-full max-w-2xl rounded-2xl border border-gray-500 bg-gray-800 p-6 sm:p-8">
        <h1 className="text-2xl font-semibold sm:text-3xl">Setup WorshipSync</h1>
        <p className="mt-2 max-w-xl text-sm text-gray-200 sm:text-base">
          Choose how to use this device.
        </p>

        <div className="mt-8 space-y-8">
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
                className="min-h-[5.5rem] w-full flex-col items-start justify-center gap-2 rounded-xl border border-cyan-500/40 bg-cyan-700/30 p-4 text-left sm:min-h-24"
                state={nextState}
                wrap
              >
                <span className="text-lg font-semibold">Sign in</span>
                <span className="text-sm font-normal text-gray-100">
                  Sign in to your church with your email and password.
                </span>
              </Button>
            </div>
          </section>

          <div className="border-t border-gray-600/80" role="presentation" />

          <section aria-labelledby="entry-setup-heading">
            <h2
              id="entry-setup-heading"
              className="text-xs font-semibold uppercase tracking-wide text-gray-400"
            >
              Setup with a code (no personal account)
            </h2>
            <p className="mt-1 text-sm text-gray-300">
              Shared controller for the live presentation, or display for the audience
              (projector, monitor, or stream). Enter the code from account settings—no mode
              switch on the next screen.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Button
                component="link"
                to="/workstation/pair"
                variant="tertiary"
                className="min-h-[5.5rem] flex-col items-start justify-center gap-2 rounded-xl border border-gray-500 bg-gray-900/50 p-4 text-left sm:min-h-24"
                state={nextState}
                wrap
              >
                <span className="text-lg font-semibold">Set up as workstation</span>
                <span className="text-sm font-normal text-gray-200">
                  Shared controller for your team—keyboard and controls only.
                </span>
              </Button>
              <Button
                component="link"
                to="/display/pair"
                variant="tertiary"
                className="min-h-[5.5rem] flex-col items-start justify-center gap-2 rounded-xl border border-gray-500 bg-gray-900/50 p-4 text-left sm:min-h-24"
                state={nextState}
                wrap
              >
                <span className="text-lg font-semibold">Set up as display</span>
                <span className="text-sm font-normal text-gray-200">
                  Projector, monitor, or stream output—shows what the controller sends.
                </span>
              </Button>
            </div>
          </section>

          <div className="border-t border-gray-600/80" role="presentation" />

          <section aria-labelledby="entry-demo-heading">
            <h2
              id="entry-demo-heading"
              className="text-xs font-semibold uppercase tracking-wide text-gray-400"
            >
              Local demo
            </h2>
            <div className="mt-3">
              <Button
                type="button"
                variant="tertiary"
                className="min-h-[5.5rem] w-full flex-col items-start justify-center gap-2 rounded-xl border border-gray-500 bg-gray-900/50 p-4 text-left sm:min-h-24"
                onClick={() =>
                  context?.enterGuestMode(
                    requestedPath && requestedPath !== "/" ? requestedPath : "/controller"
                  )
                }
                wrap
              >
                <span className="text-lg font-semibold">Test as guest</span>
                <span className="text-sm font-normal text-gray-200">
                  Explore the demo controller on this device only—nothing syncs to your
                  church.
                </span>
              </Button>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
};

export default AppEntry;
