import { ReactNode, useCallback, useContext, useMemo } from "react";
import { getAuthBootstrapLoadingDescription } from "../utils/authUserMessages";
import { Navigate, useLocation } from "react-router-dom";
import Button from "./Button/Button";
import { GlobalInfoContext } from "../context/globalInfo";
import { useCloseOnEscape } from "../hooks/useCloseOnEscape";
import { getElectronDisplayWindowTypeFromPathname } from "../utils/electronDisplayWindowFromPath";
import { isWorkstationDisplaySurfacePath } from "../utils/sessionRouteAccess";

type AllowedKind = "human" | "workstation" | "display";

const ValidationScreen = ({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) => (
  <div className="flex min-h-dvh w-full items-center justify-center bg-gray-700 px-6 text-white">
    <div className="max-w-md rounded-2xl border border-gray-500 bg-gray-800 p-8 text-center">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-3 text-sm text-gray-200" aria-live="polite">
        {description}
      </p>
      {actions ? <div className="mt-6 flex flex-wrap justify-center gap-2">{actions}</div> : null}
    </div>
  </div>
);

const DisplayBlockedScreen = () => {
  const location = useLocation();
  const closeDisplayWindow = useCallback(async () => {
    if (!window.electronAPI) return;
    const windowType = getElectronDisplayWindowTypeFromPathname(location.pathname);
    if (windowType) {
      await window.electronAPI.closeWindow(windowType);
    }
  }, [location.pathname]);
  useCloseOnEscape(closeDisplayWindow);
  return (
    <ValidationScreen
      title="This display isn’t linked yet"
      description="Ask an admin to link or reauthorize this screen before continuing."
      actions={
        <>
          <Button
            component="link"
            to="/display/pair"
            state={{ from: location }}
            variant="cta"
          >
            Link as display
          </Button>
          <Button
            component="link"
            to="/login"
            state={{ from: location }}
            variant="tertiary"
          >
            Sign in
          </Button>
        </>
      }
    />
  );
};

/** Blank transparent surface while auth loads (display outputs: no splash, no text) */
const DisplayAuthLoadingPlaceholder = () => (
  <div className="min-h-dvh w-full bg-transparent" aria-busy="true" />
);

const AuthGate = ({
  allowedKinds,
  allowGuest = false,
  children,
}: {
  allowedKinds: AllowedKind[];
  allowGuest?: boolean;
  children: ReactNode;
}) => {
  const location = useLocation();
  const context = useContext(GlobalInfoContext);

  const authServerStatus = context?.authServerStatus;
  const authServerRetryCount = context?.authServerRetryCount;
  const bootstrapStatus = context?.bootstrapStatus;
  const loginState = context?.loginState;
  const sessionKind = context?.sessionKind;
  const operatorName = context?.operatorName;

  const loadingDescription = useMemo(
    () =>
      getAuthBootstrapLoadingDescription(authServerStatus ?? "checking", {
        retryCount: authServerRetryCount ?? 0,
      }),
    [authServerRetryCount, authServerStatus]
  );

  const loadingTitle = useMemo(() => {
    if (allowedKinds.includes("workstation") && !allowedKinds.includes("human")) {
      return "Preparing this workstation...";
    }
    return "Checking your access...";
  }, [allowedKinds]);

  if (!context) {
    if (process.env.NODE_ENV === "development") {
      console.error("AuthGate must be used within GlobalInfoProvider.");
    }
    return <Navigate to="/" replace state={{ from: location }} />;
  }

  if (bootstrapStatus === "loading" || loginState === "loading") {
    if (allowedKinds.includes("display")) {
      return <DisplayAuthLoadingPlaceholder />;
    }
    return (
      <ValidationScreen
        title={loadingTitle}
        description={loadingDescription}
      />
    );
  }

  if (sessionKind && allowedKinds.includes(sessionKind as AllowedKind)) {
    const needsOperator =
      sessionKind === "workstation" &&
      !operatorName?.trim() &&
      !isWorkstationDisplaySurfacePath(location.pathname);
    if (needsOperator) {
      return <Navigate to="/workstation/operator" replace />;
    }
    return <>{children}</>;
  }

  if (allowGuest && loginState === "guest") {
    return <>{children}</>;
  }

  if (allowedKinds.includes("display")) {
    return <DisplayBlockedScreen />;
  }

  if (
    allowedKinds.includes("workstation") &&
    !allowedKinds.includes("human")
  ) {
    return <Navigate to="/" replace state={{ from: location }} />;
  }

  return <Navigate to="/" replace state={{ from: location }} />;
};

export default AuthGate;
