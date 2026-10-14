import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  resolvePath,
  useLocation,
  useNavigate,
} from "react-router-dom";
import Button from "../../components/Button/Button";
import Modal from "../../components/Modal/Modal";

type PendingNavigation = {
  to: string;
  state?: unknown;
  onNavigated?: () => void;
};

type PendingAction = {
  action: () => void;
};

type PendingTeamsNavigation = {
  pathname: string;
};

type TeamsNavigationGuardContextValue = {
  setDirtySource: (sourceId: string, isDirty: boolean) => void;
  requestNavigation: (to: string, options?: NavigationOptions) => void;
  requestDiscardAction: (action: () => void) => void;
};

type NavigationOptions = {
  state?: unknown;
  onNavigated?: () => void;
};

const TeamsNavigationGuardContext =
  createContext<TeamsNavigationGuardContextValue | null>(null);
const PendingTeamsNavigationContext = createContext<{
  pathname: string | null;
  clear: () => void;
} | null>(null);

export const TeamsNavigationGuardProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [dirtySources, setDirtySources] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const hasUnsavedChanges = dirtySources.size > 0;
  const [pendingNavigation, setPendingNavigation] =
    useState<PendingNavigation | null>(null);
  const [pendingTeamsNavigation, setPendingTeamsNavigation] =
    useState<PendingTeamsNavigation | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [pendingHistoryDelta, setPendingHistoryDelta] = useState<number | null>(null);
  const historyIndexRef = useRef<number | null>(null);
  const restoreHistoryPopRef = useRef(false);
  const allowHistoryPopRef = useRef(false);
  const hasPendingConfirmation = Boolean(
    pendingNavigation || pendingAction || pendingHistoryDelta !== null,
  );

  const setTeamsNavigationTarget = useCallback((to: string | null) => {
    if (!to) {
      setPendingTeamsNavigation(null);
      return;
    }
    const pathname = resolvePath(to, location.pathname).pathname;
    if (
      pathname !== "/teams-and-services" &&
      !pathname.startsWith("/teams-and-services/")
    ) {
      setPendingTeamsNavigation(null);
      return;
    }
    setPendingTeamsNavigation({ pathname });
  }, [location.pathname]);

  const navigateTo = useCallback((to: string, options: NavigationOptions = {}) => {
    setTeamsNavigationTarget(to);
    navigate(to, { state: options.state });
    options.onNavigated?.();
  }, [navigate, setTeamsNavigationTarget]);

  useEffect(() => {
    const clearPendingNavigationOnPop = () => {
      setPendingTeamsNavigation(null);
    };
    window.addEventListener("popstate", clearPendingNavigationOnPop);
    return () => {
      window.removeEventListener("popstate", clearPendingNavigationOnPop);
    };
  }, []);

  const clearPendingTeamsNavigation = useCallback(
    () => setPendingTeamsNavigation(null),
    [],
  );
  const pendingTeamsNavigationValue = useMemo(() => ({
    pathname: pendingTeamsNavigation?.pathname ?? null,
    clear: clearPendingTeamsNavigation,
  }), [clearPendingTeamsNavigation, pendingTeamsNavigation]);

  const setDirtySource = useCallback((sourceId: string, isDirty: boolean) => {
    setDirtySources((current) => {
      const next = new Set(current);
      if (isDirty) {
        next.add(sourceId);
      } else {
        next.delete(sourceId);
      }
      if (next.size === current.size && [...next].every((id) => current.has(id))) {
        return current;
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const index = window.history.state?.idx;
    historyIndexRef.current = typeof index === "number" ? index : null;
  }, [location.key]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      if (allowHistoryPopRef.current) {
        allowHistoryPopRef.current = false;
        return;
      }
      if (restoreHistoryPopRef.current) {
        restoreHistoryPopRef.current = false;
        return;
      }
      if (!hasUnsavedChanges) return;

      const targetIndex = event.state?.idx;
      const currentIndex = historyIndexRef.current;
      if (
        typeof targetIndex !== "number" ||
        currentIndex === null ||
        targetIndex === currentIndex
      ) {
        return;
      }

      const delta = targetIndex - currentIndex;
      // HashRouter cannot block POP navigations itself. Restore the current
      // history entry before React Router sees the POP, then show the same
      // discard dialog used for sidebar navigation.
      event.stopImmediatePropagation();
      restoreHistoryPopRef.current = true;
      setPendingHistoryDelta(delta);
      window.history.go(-delta);
    };

    window.addEventListener("popstate", handlePopState, true);
    return () => window.removeEventListener("popstate", handlePopState, true);
  }, [hasUnsavedChanges]);

  const requestNavigation = useCallback((to: string, options: NavigationOptions = {}) => {
    if (hasUnsavedChanges) {
      setTeamsNavigationTarget(null);
      setPendingNavigation({ to, ...options });
      return;
    }
    navigateTo(to, options);
  }, [hasUnsavedChanges, navigateTo, setTeamsNavigationTarget]);

  const requestDiscardAction = useCallback((action: () => void) => {
    if (hasUnsavedChanges) {
      setPendingAction({ action });
      return;
    }
    action();
  }, [hasUnsavedChanges]);

  const discardAndNavigate = () => {
    if (!pendingNavigation && !pendingAction) return;
    const nextNavigation = pendingNavigation;
    const nextAction = pendingAction;
    const nextHistoryDelta = pendingHistoryDelta;
    setPendingNavigation(null);
    setPendingAction(null);
    setPendingHistoryDelta(null);
    if (nextHistoryDelta !== null) {
      allowHistoryPopRef.current = true;
      window.history.go(nextHistoryDelta);
      return;
    }
    if (nextNavigation) {
      navigateTo(nextNavigation.to, nextNavigation);
      return;
    }
    nextAction?.action();
  };

  const navigationGuardValue = useMemo(
    () => ({ setDirtySource, requestNavigation, requestDiscardAction }),
    [requestDiscardAction, requestNavigation, setDirtySource],
  );

  return (
    <TeamsNavigationGuardContext.Provider
      value={navigationGuardValue}
    >
      <PendingTeamsNavigationContext.Provider value={pendingTeamsNavigationValue}>
        {children}
        <Modal
          isOpen={hasPendingConfirmation}
          onClose={() => {
            setPendingNavigation(null);
            setPendingAction(null);
            setPendingHistoryDelta(null);
          }}
          title="Unsaved changes"
          size="sm"
          contentPadding="px-4 pb-4 pt-0"
          showCloseButton={false}
        >
          <p className="mb-6 text-sm text-gray-200">
            You have unsaved changes. Do you want to discard them and leave?
          </p>
          <div className="flex justify-end gap-3">
            <Button
              variant="secondary"
              onClick={() => {
                setPendingNavigation(null);
                setPendingAction(null);
                setPendingHistoryDelta(null);
              }}
            >
              Stay
            </Button>
            <Button variant="destructive" onClick={discardAndNavigate}>
              Discard changes
            </Button>
          </div>
        </Modal>
      </PendingTeamsNavigationContext.Provider>
    </TeamsNavigationGuardContext.Provider>
  );
};

export const usePendingTeamsNavigation = () => {
  const context = useContext(PendingTeamsNavigationContext);
  if (!context) {
    throw new Error(
      "usePendingTeamsNavigation must be used within TeamsNavigationGuardProvider.",
    );
  }
  return context;
};

export const useTeamsNavigationGuard = () => {
  const context = useContext(TeamsNavigationGuardContext);
  if (!context) {
    throw new Error(
      "useTeamsNavigationGuard must be used within TeamsNavigationGuardProvider.",
    );
  }
  return context;
};
