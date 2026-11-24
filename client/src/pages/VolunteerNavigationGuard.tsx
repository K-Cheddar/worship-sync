import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  Link,
  resolvePath,
  useLocation,
  useNavigate,
  type LinkProps,
  type NavigateOptions,
  type To,
} from "react-router-dom";
import Button from "../components/Button/Button";
import Modal from "../components/Modal/Modal";

type NavigationOptions = Pick<NavigateOptions, "replace" | "state"> & {
  onNavigated?: () => void;
};

type PendingNavigation =
  | { to: To; options?: NavigationOptions }
  | { action: () => void }
  | { historyDelta: number };

type VolunteerNavigationGuard = {
  setDirtySource: (sourceId: string, isDirty: boolean) => void;
  setSavingSource: (sourceId: string, isSaving: boolean) => void;
  requestNavigation: (to: To, options?: NavigationOptions) => void;
  requestDiscardAction: (action: () => void) => void;
};

const VolunteerNavigationGuardContext =
  createContext<VolunteerNavigationGuard | null>(null);

const VolunteerNavigationGuardContent = ({ children }: { children: ReactNode }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [dirtySources, setDirtySources] = useState<ReadonlySet<string>>(() => new Set());
  const [savingSources, setSavingSources] = useState<ReadonlySet<string>>(() => new Set());
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation | null>(null);
  const [blockedBySave, setBlockedBySave] = useState(false);
  const historyIndexRef = useRef<number | null>(null);
  const restoreHistoryPopRef = useRef(false);
  const allowHistoryPopRef = useRef(false);
  const hasUnsavedChanges = dirtySources.size > 0;
  const hasSaveInProgress = savingSources.size > 0;
  const hasUnsavedChangesRef = useRef(hasUnsavedChanges);
  const hasSaveInProgressRef = useRef(hasSaveInProgress);
  hasUnsavedChangesRef.current = hasUnsavedChanges;
  hasSaveInProgressRef.current = hasSaveInProgress;

  const setSource = useCallback((
    update: Dispatch<SetStateAction<ReadonlySet<string>>>,
    sourceId: string,
    active: boolean,
  ) => {
    update((current) => {
      if (current.has(sourceId) === active) return current;
      const next = new Set(current);
      if (active) next.add(sourceId);
      else next.delete(sourceId);
      return next;
    });
  }, []);

  const setDirtySource = useCallback((sourceId: string, isDirty: boolean) => {
    setSource(setDirtySources, sourceId, isDirty);
  }, [setSource]);

  const setSavingSource = useCallback((sourceId: string, isSaving: boolean) => {
    setSource(setSavingSources, sourceId, isSaving);
  }, [setSource]);

  useEffect(() => {
    if (!hasSaveInProgress) setBlockedBySave(false);
  }, [hasSaveInProgress]);

  const navigateTo = useCallback((to: To, options?: NavigationOptions) => {
    const destination = resolvePath(to, location.pathname);
    const current = location.pathname + location.search + location.hash;
    const resolved = destination.pathname + destination.search + destination.hash;
    if (resolved !== current || options?.replace || options?.state !== undefined) {
      navigate(to, options);
    }
    options?.onNavigated?.();
  }, [location, navigate]);

  const requestNavigation = useCallback((to: To, options?: NavigationOptions) => {
    const destination = resolvePath(to, location.pathname);
    const current = location.pathname + location.search + location.hash;
    const resolved = destination.pathname + destination.search + destination.hash;
    if (resolved === current && !options?.replace && options?.state === undefined) {
      options?.onNavigated?.();
      return;
    }
    if (hasSaveInProgress) {
      setBlockedBySave(true);
      return;
    }
    if (hasUnsavedChanges) {
      setPendingNavigation({ to, options });
      return;
    }
    navigateTo(to, options);
  }, [hasSaveInProgress, hasUnsavedChanges, location, navigateTo]);

  const requestDiscardAction = useCallback((action: () => void) => {
    if (hasSaveInProgress) {
      setBlockedBySave(true);
      return;
    }
    if (hasUnsavedChanges) {
      setPendingNavigation({ action });
      return;
    }
    action();
  }, [hasSaveInProgress, hasUnsavedChanges]);

  useLayoutEffect(() => {
    historyIndexRef.current = typeof window.history.state?.idx === "number"
      ? window.history.state.idx
      : null;
  }, [location.key]);

  useEffect(() => {
    if (!hasUnsavedChanges && !hasSaveInProgress) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [hasSaveInProgress, hasUnsavedChanges]);

  useLayoutEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      if (allowHistoryPopRef.current) {
        allowHistoryPopRef.current = false;
        return;
      }
      if (restoreHistoryPopRef.current) {
        restoreHistoryPopRef.current = false;
        return;
      }
      if (!hasUnsavedChangesRef.current && !hasSaveInProgressRef.current) return;

      const targetIndex = typeof event.state?.idx === "number" ? event.state.idx : null;
      const currentIndex = historyIndexRef.current;
      if (targetIndex === null || currentIndex === null || targetIndex === currentIndex) return;

      const delta = targetIndex - currentIndex;
      event.stopImmediatePropagation();
      restoreHistoryPopRef.current = true;
      if (hasSaveInProgressRef.current) setBlockedBySave(true);
      else setPendingNavigation({ historyDelta: delta });
      window.history.go(-delta);
    };

    window.addEventListener("popstate", handlePopState, true);
    return () => window.removeEventListener("popstate", handlePopState, true);
  }, []);

  const finishNavigation = () => {
    if (hasSaveInProgress || !pendingNavigation) return;
    const pending = pendingNavigation;
    setPendingNavigation(null);
    setBlockedBySave(false);
    if ("historyDelta" in pending) {
      allowHistoryPopRef.current = true;
      window.history.go(pending.historyDelta);
    } else if ("to" in pending) {
      navigateTo(pending.to, pending.options);
    } else {
      pending.action();
    }
  };

  const closeNavigationDialog = () => {
    setPendingNavigation(null);
    setBlockedBySave(false);
  };

  const contextValue = useMemo(() => ({
    setDirtySource,
    setSavingSource,
    requestNavigation,
    requestDiscardAction,
  }), [requestDiscardAction, requestNavigation, setDirtySource, setSavingSource]);

  const showSaveMessage = blockedBySave && hasSaveInProgress;

  return (
    <VolunteerNavigationGuardContext.Provider value={contextValue}>
      {children}
      <Modal
        isOpen={Boolean(pendingNavigation || showSaveMessage)}
        onClose={closeNavigationDialog}
        title={showSaveMessage ? "Saving changes" : "Unsaved changes"}
        size="sm"
        contentPadding="px-4 pb-4 pt-0"
        showCloseButton={false}
      >
        {showSaveMessage ? (
          <>
            <p className="mb-6 text-sm text-gray-200">
              A save is in progress. Wait for it to finish before leaving this page.
            </p>
            <div className="flex justify-end">
              <Button variant="secondary" onClick={() => setBlockedBySave(false)}>Stay on page</Button>
            </div>
          </>
        ) : (
          <>
            <p className="mb-6 text-sm text-gray-200">
              You have unsaved changes. Do you want to discard them and leave?
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={closeNavigationDialog}>Stay</Button>
              <Button variant="destructive" onClick={finishNavigation}>Discard changes</Button>
            </div>
          </>
        )}
      </Modal>
    </VolunteerNavigationGuardContext.Provider>
  );
};

export const VolunteerNavigationGuardProvider = ({ children }: { children: ReactNode }) => (
  <VolunteerNavigationGuardContent>{children}</VolunteerNavigationGuardContent>
);

export const useVolunteerNavigationGuard = () => {
  const context = useContext(VolunteerNavigationGuardContext);
  if (!context) {
    throw new Error("useVolunteerNavigationGuard must be used within VolunteerNavigationGuardProvider.");
  }
  return context;
};

type VolunteerNavigationLinkProps = Pick<LinkProps, "to" | "children" | "className" | "title" | "aria-label" | "aria-current"> & {
  onNavigate?: () => void;
};

const VolunteerNavigationLink = ({
  to,
  children,
  onNavigate,
  ...props
}: VolunteerNavigationLinkProps) => {
  const { requestNavigation } = useVolunteerNavigationGuard();

  const handleClick = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (
      event.defaultPrevented || event.button !== 0 || event.metaKey || event.altKey ||
      event.ctrlKey || event.shiftKey
    ) return;
    event.preventDefault();
    requestNavigation(to, { onNavigated: onNavigate });
  };

  return <Link to={to} {...props} onClick={handleClick}>{children}</Link>;
};

export default VolunteerNavigationLink;
