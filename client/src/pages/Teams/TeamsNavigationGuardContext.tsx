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
import { useLocation } from "react-router-dom";
import Button from "../../components/Button/Button";
import Modal from "../../components/Modal/Modal";
import {
  PendingRouteNavigationProvider,
  usePendingRouteNavigation,
} from "../../hooks/usePendingRouteNavigation";

type PendingNavigation = {
  to: string;
  state?: unknown;
  onNavigated?: () => void;
};

type PendingAction = {
  action: () => void;
};

type TeamsNavigationGuardContextValue = {
  setDirtySource: (sourceId: string, isDirty: boolean) => void;
  setSavingSource: (sourceId: string, isSaving: boolean) => void;
  requestNavigation: (to: string, options?: NavigationOptions) => void;
  requestDiscardAction: (action: () => void) => void;
};

type NavigationOptions = {
  state?: unknown;
  onNavigated?: () => void;
};

const TeamsNavigationGuardContext =
  createContext<TeamsNavigationGuardContextValue | null>(null);

const TeamsNavigationGuardContent = ({
  children,
}: {
  children: ReactNode;
}) => {
  const location = useLocation();
  const [dirtySources, setDirtySources] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [savingSources, setSavingSources] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const hasUnsavedChanges = dirtySources.size > 0;
  const hasSaveInProgress = savingSources.size > 0;
  const [blockedBySaveAttempt, setBlockedBySaveAttempt] = useState(false);
  const [pendingNavigation, setPendingNavigation] =
    useState<PendingNavigation | null>(null);
  const pendingRoute = usePendingRouteNavigation();
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [pendingHistoryDelta, setPendingHistoryDelta] = useState<number | null>(null);
  const historyIndexRef = useRef<number | null>(null);
  const restoreHistoryPopRef = useRef(false);
  const allowHistoryPopRef = useRef(false);
  const hasPendingConfirmation = Boolean(
    pendingNavigation || pendingAction || pendingHistoryDelta !== null,
  );

  const navigateTo = useCallback((to: string, options: NavigationOptions = {}) => {
    pendingRoute.request(to, { state: options.state });
    options.onNavigated?.();
  }, [pendingRoute]);

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

  const setSavingSource = useCallback((sourceId: string, isSaving: boolean) => {
    setSavingSources((current) => {
      const next = new Set(current);
      if (isSaving) {
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
    if (!hasSaveInProgress) setBlockedBySaveAttempt(false);
  }, [hasSaveInProgress]);

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
      if (!hasUnsavedChanges && !hasSaveInProgress) return;

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
      if (hasSaveInProgress) {
        setBlockedBySaveAttempt(true);
      } else {
        setPendingHistoryDelta(delta);
      }
      window.history.go(-delta);
    };

    window.addEventListener("popstate", handlePopState, true);
    return () => window.removeEventListener("popstate", handlePopState, true);
  }, [hasSaveInProgress, hasUnsavedChanges]);

  const requestNavigation = useCallback((to: string, options: NavigationOptions = {}) => {
    if (hasSaveInProgress) {
      pendingRoute.clear();
      setBlockedBySaveAttempt(true);
      return;
    }
    if (hasUnsavedChanges) {
      pendingRoute.clear();
      setPendingNavigation({ to, ...options });
      return;
    }
    navigateTo(to, options);
  }, [hasSaveInProgress, hasUnsavedChanges, navigateTo, pendingRoute]);

  const requestDiscardAction = useCallback((action: () => void) => {
    if (hasSaveInProgress) {
      setBlockedBySaveAttempt(true);
      return;
    }
    if (hasUnsavedChanges) {
      setPendingAction({ action });
      return;
    }
    action();
  }, [hasSaveInProgress, hasUnsavedChanges]);

  const discardAndNavigate = () => {
    if (hasSaveInProgress) return;
    if (!pendingNavigation && !pendingAction && pendingHistoryDelta === null) return;
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
    () => ({ setDirtySource, setSavingSource, requestNavigation, requestDiscardAction }),
    [requestDiscardAction, requestNavigation, setDirtySource, setSavingSource],
  );

  const showSaveInProgress = blockedBySaveAttempt && hasSaveInProgress;

  return (
    <TeamsNavigationGuardContext.Provider value={navigationGuardValue}>
      {children}
      <Modal
        isOpen={hasPendingConfirmation || showSaveInProgress}
        onClose={() => {
          setPendingNavigation(null);
          setPendingAction(null);
          setPendingHistoryDelta(null);
          setBlockedBySaveAttempt(false);
        }}
        title={showSaveInProgress ? "Saving changes" : "Unsaved changes"}
        size="sm"
        contentPadding="px-4 pb-4 pt-0"
        showCloseButton={false}
      >
        {showSaveInProgress ? (
          <>
            <p className="mb-6 text-sm text-gray-200">
              A save is in progress. Wait for it to finish before leaving this page.
            </p>
            <div className="flex justify-end">
              <Button
                variant="secondary"
                onClick={() => setBlockedBySaveAttempt(false)}
              >
                Stay on page
              </Button>
            </div>
          </>
        ) : (
          <>
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
          </>
        )}
      </Modal>
    </TeamsNavigationGuardContext.Provider>
  );
};

export const TeamsNavigationGuardProvider = ({
  children,
}: {
  children: ReactNode;
}) => (
  <PendingRouteNavigationProvider>
    <TeamsNavigationGuardContent>{children}</TeamsNavigationGuardContent>
  </PendingRouteNavigationProvider>
);

export const usePendingTeamsNavigation = () => {
  return usePendingRouteNavigation();
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
