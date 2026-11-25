import { flushItemCacheChanges, startItemCacheSync } from "../store/itemCacheSync";
import { resetItemCache } from "../store/allDocsSlice";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import PouchDB from "pouchdb-browser";
import { Cloudinary } from "@cloudinary/url-gen";
import { GlobalInfoContext, globalFireDbInfo } from "./globalInfo";
import { useLocation } from "react-router-dom";
import { useStore } from "react-redux";
import { useDispatch, useSelector } from "../hooks";
import type { RootState } from "../store/store";
import { backoff } from "../utils/generalUtils";
import { getApiBasePath } from "../utils/environment";
import { CLOUDINARY_CLOUD_NAME } from "../utils/cloudinaryConfig";
import { MAX_INITIAL_SESSION_RETRIES, MAX_REPLICATION_AUTH_RETRIES } from "../constants";
import { seedOfflineGuestDatabase } from "../utils/offlineGuestSeed";
import {
  flushContentDatabaseBeforeTeardown,
  flushPendingItemMutationsForContentDatabase,
  getActiveContentDatabaseOwner,
  getContentDatabaseForOwner,
  setActiveContentDatabase,
} from "../store/deferredItemMutations";
import {
  trackContentReplication,
  beginContentDatabaseSession,
  type ContentReplicationActivity,
  hasSuccessfulInitialContentReplication,
  hasVerifiedInitialContentReplication,
  recordVerifiedInitialContentReplication,
  subscribeToContentActivity,
} from "../utils/contentReplicationActivity";
import { cancelBibleItemCleanupRetry } from "../utils/bibleItemCleanup";
import { createReplicationProgressTracker } from "../utils/replicationProgress";
import {
  beginStartupReplication,
  getStartupDiagnosticMode,
  isStartupDiagnosticsActive,
  recordStartupAggregate,
  recordStartupDiagnostic,
  resolveStartupDatabasePlan,
  resolveStartupReplicationOptions,
  type StartupDatabaseKind,
  type StartupReplicationRun,
} from "../utils/startupDiagnostics";

export type ConnectionStatus = {
  status: "connecting" | "retrying" | "failed" | "connected";
  retryCount: number;
  failureReason?: "push-too-large" | "replication";
  message?: string;
};

export type StartupFailure = {
  kind:
    | "local-storage"
    | "server-connection"
    | "authentication"
    | "remote-database"
    | "replication";
  message: string;
  diagnostic?: string;
};

type CouchSessionResult = {
  success: boolean;
  failureKind?: "server-connection" | "authentication";
  diagnostic?: string;
};

export type ControllerStartupInfo = {
  stage:
    | "idle"
    | "preparing-local-database"
    | "preparing-local-database-and-connecting"
    | "preparing-local-database-and-reconnecting"
    | "connecting-to-server"
    | "preparing-database-sync"
    | "synchronizing-database-content"
    | "finalizing-initialization"
    | "reconnecting"
    | "completed"
    | "failed";
  startedAt: number;
  lastMeaningfulActivityAt: number;
  failure: StartupFailure | null;
};

export type StartupActivitySubscription = (
  listener: (activityAt: number) => void,
) => () => void;

export const nextSyncBatchSize = (current: number) => Math.max(1, Math.floor(current / 2));
export const canRetrySync413 = (batchSize: number) => batchSize > 1;

export const describeControllerSyncError = (error: unknown) => {
  if (error && typeof error === "object") {
    const value = error as { status?: number; reason?: string; message?: string; name?: string };
    return value.reason || value.message || value.name || (value.status ? `HTTP ${value.status}` : "Unknown replication error");
  }
  return String(error);
};

type ControllerInfoContextType = {
  db: PouchDB.Database | undefined;
  bootstrapReady: boolean;
  canCreateBootstrapDocuments: () => boolean;
  bibleDb: PouchDB.Database | undefined;
  cloud: Cloudinary;
  updater: EventTarget;
  /** True while `loginState === "guest"` (local demo DB; no remote sync). */
  isGuestSession: boolean;
  isMobile: boolean;
  isPhone: boolean;
  dbProgress: number | null;
  bibleDbProgress: number | null;
  connectionStatus: ConnectionStatus;
  startupInfo: ControllerStartupInfo;
  bibleStartupFailure: StartupFailure | null;
  subscribeToStartupActivity: StartupActivitySubscription;
  setIsMobile: (val: boolean) => void;
  setIsPhone: (val: boolean) => void;
  logout: () => Promise<void>;
  login: ({
    email,
    password,
  }: {
    email: string;
    password: string;
  }) => Promise<void>;
  pullFromRemote: () => void;
};

export const ControllerInfoContext =
  createContext<ControllerInfoContextType | null>(null);

export let globalDb: PouchDB.Database | undefined = undefined;
export let globalBibleDb: PouchDB.Database | undefined = undefined;
export let globalBroadcastRef: BroadcastChannel | undefined = undefined;

export const setGlobalContentDatabase = (
  databaseInstance: PouchDB.Database | undefined,
  scope?: { databaseKey: string; churchId: string; accountId?: string },
) => {
  if (!databaseInstance || !scope) {
    const previousOwner = getActiveContentDatabaseOwner();
    if (previousOwner) {
      flushPendingItemMutationsForContentDatabase(previousOwner.scopeId);
    }
    globalDb = databaseInstance;
    setActiveContentDatabase(null);
    return;
  }

  const databaseKey = scope.databaseKey.toLowerCase();
  const churchId = scope.churchId || "";
  const accountId = scope.accountId || "anonymous";
  const scopeId = JSON.stringify([
    churchId,
    accountId,
    databaseKey,
    databaseInstance.name,
  ]);
  const owner = { scopeId, databaseKey, churchId, accountId };
  const previousOwner = getActiveContentDatabaseOwner();
  if (
    previousOwner &&
    (previousOwner.scopeId !== owner.scopeId ||
      getContentDatabaseForOwner(previousOwner) !== databaseInstance)
  ) {
    flushPendingItemMutationsForContentDatabase(previousOwner.scopeId);
  }
  globalDb = databaseInstance;
  setActiveContentDatabase(owner, databaseInstance);
};

type CleanupMaintenanceState = {
  lastStartedAt: number;
  running?: Promise<void>;
  timer?: ReturnType<typeof setTimeout>;
  abortController?: AbortController;
  consecutiveFailures: number;
  rerunRequested: boolean;
  cancelled: boolean;
};
const cleanupMaintenanceRuns = new WeakMap<PouchDB.Database, CleanupMaintenanceState>();
export const cancelSongV2CleanupMaintenance = (db: PouchDB.Database | undefined) => {
  if (!db) return;
  const state = cleanupMaintenanceRuns.get(db);
  if (!state || state.cancelled) return;
  state.cancelled = true;
  state.rerunRequested = false;
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = undefined;
  }
  state.abortController?.abort();
};
export const scheduleSongV2CleanupMaintenance = (db: PouchDB.Database, force = false) => {
  const state = cleanupMaintenanceRuns.get(db) ?? {
    lastStartedAt: 0,
    consecutiveFailures: 0,
    rerunRequested: false,
    cancelled: false,
  };
  cleanupMaintenanceRuns.set(db, state);
  const isActive = () => !state.cancelled && cleanupMaintenanceRuns.get(db) === state;

  const scheduleAfter = (delay: number) => {
    if (!isActive()) return;
    if (state.timer) return;
    state.timer = setTimeout(() => {
      state.timer = undefined;
      if (!isActive()) return;
      scheduleSongV2CleanupMaintenance(db, true);
    }, delay);
  };
  const retryDelay = () => Math.min(30_000 * 2 ** Math.min(state.consecutiveFailures - 1, 4), 300_000);

  if (!isActive()) return;
  if (state.running) {
    state.rerunRequested = true;
    return;
  }
  if (state.timer) {
    if (!force) return;
    clearTimeout(state.timer);
    state.timer = undefined;
  }
  const throttleRemaining = 30_000 - (Date.now() - state.lastStartedAt);
  if (!force && throttleRemaining > 0) {
    scheduleAfter(throttleRemaining);
    return;
  }
  state.lastStartedAt = Date.now();
  const maintenanceStartedAt = performance.now();
  let maintenanceResult: Awaited<ReturnType<typeof import("../utils/songV2Writer").reconcilePendingSongV2Cleanup>> | undefined;
  let maintenanceFailed = false;
  const abortController = new AbortController();
  state.abortController = abortController;
  state.running = import("../utils/songV2Writer")
    .then(({ reconcilePendingSongV2Cleanup }) => {
      if (!isActive() || abortController.signal.aborted) return undefined;
      return reconcilePendingSongV2Cleanup(db, 20, abortController.signal);
    })
    .then((result) => {
      maintenanceResult = result;
      if (!isActive() || abortController.signal.aborted || result?.cancelled) return;
      if (!result) return;
      if (result.quarantined.length) {
        console.warn("Song cleanup records were quarantined after their target revisions changed:", result.quarantined);
      }
      if (result.cleanupErrors.length) {
        console.error("Song cleanup maintenance left records for a later retry:", result.cleanupErrors);
      }
      state.consecutiveFailures = result.cleanupErrors.length ? state.consecutiveFailures + 1 : 0;
      if (result.cleanupErrors.length) scheduleAfter(retryDelay());
      else if (result.hasMore) scheduleAfter(250);
    })
    .catch((error) => {
      maintenanceFailed = true;
      if (!isActive() || abortController.signal.aborted) return;
      state.consecutiveFailures += 1;
      console.error("Could not run song cleanup maintenance:", error);
      scheduleAfter(retryDelay());
    })
    .finally(() => {
      recordStartupAggregate("post-replication-maintenance", {
        songV2CleanupRuns: 1,
        songV2CleanupDurationMs: performance.now() - maintenanceStartedAt,
        songV2CleanupDeleted: maintenanceResult?.deleted.length ?? 0,
        songV2CleanupRetired: maintenanceResult?.retired.length ?? 0,
        songV2CleanupQuarantined: maintenanceResult?.quarantined.length ?? 0,
        songV2CleanupErrors: maintenanceResult?.cleanupErrors.length ?? (maintenanceFailed ? 1 : 0),
      });
      if (cleanupMaintenanceRuns.get(db) !== state) return;
      state.running = undefined;
      state.abortController = undefined;
      if (isActive() && state.rerunRequested) {
        state.rerunRequested = false;
        scheduleAfter(0);
      }
    });
};

const DEMO_DATABASE_KEY = "demo";
const GUEST_DATABASE_NAME = "worship-sync-demo-guest";

export const updateGlobalBroadcast = (database: string) => {
  if (globalBroadcastRef) {
    globalBroadcastRef.close();
  }
  globalBroadcastRef = new BroadcastChannel(`worship-sync-${database}-updates`);
};

export type CouchResponse = {
  success: boolean;
  message: string;
};

const cloud = new Cloudinary({
  cloud: {
    cloudName: CLOUDINARY_CLOUD_NAME,
    apiKey: import.meta.env.VITE_CLOUDINARY_KEY,
    apiSecret: import.meta.env.VITE_CLOUDINARY_SECRET,
  },
});

type ScopedStartupMetadata = {
  sessionKey: string;
  startedAt: number;
  lastMeaningfulActivityAt: number;
  failure: StartupFailure | null;
};

type StartupReplicationPhase =
  | "waiting"
  | "preparing"
  | "synchronizing"
  | "finalizing";

const sanitizeStartupDiagnostic = (error: unknown): string => {
  if (!error || typeof error !== "object") return "Unexpected error";
  const value = error as {
    status?: number | string;
    name?: string;
    code?: string;
  };
  const parts: string[] = [];
  const status = Number(value.status);
  if (Number.isInteger(status) && status >= 100 && status <= 599) {
    parts.push(`HTTP ${status}`);
  }
  for (const token of [value.name, value.code]) {
    if (typeof token === "string" && /^[A-Za-z0-9_.-]{1,48}$/.test(token)) {
      parts.push(token);
    }
  }
  return [...new Set(parts)].join(" · ") || "Unexpected error";
};

const recordLocalDatabaseOpen = (
  database: StartupDatabaseKind,
  db: PouchDB.Database,
) => {
  if (!isStartupDiagnosticsActive()) return;
  const startedAt = performance.now();
  recordStartupDiagnostic("database", "open.started", { database });
  void db.info().then((info) => {
    recordStartupDiagnostic("database", "open.completed", {
      database,
      durationMs: Math.round(performance.now() - startedAt),
      documents: info.doc_count,
    });
  }).catch(() => {
    recordStartupDiagnostic("database", "open.failed", {
      database,
      durationMs: Math.round(performance.now() - startedAt),
    });
  });
};

let syncTimeout: NodeJS.Timeout | null = null;

const ControllerInfoProvider = ({ children }: any) => {
  const [db, setDb] = useState<PouchDB.Database | undefined>(undefined);
  const [itemCacheHydratedFor, setItemCacheHydratedFor] = useState<string | null>(null);
  const [contentPullCompletedFor, setContentPullCompletedFor] = useState<string | null>(null);
  const contentDbRef = useRef<PouchDB.Database | undefined>(db);
  contentDbRef.current = db;
  const [bibleDb, setBibleDb] = useState<PouchDB.Database | undefined>(
    undefined
  );
  const [dbProgress, setDbProgress] = useState<number | null>(null);
  const [bibleDbProgress, setBibleDbProgress] = useState<number | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [isPhone, setIsPhone] = useState(false);
  const [isDbSetup, setIsDbSetup] = useState(false);
  const [isBibleDbSetup, setIsBibleDbSetup] = useState(false);
  const [initialPullRestartVersion, setInitialPullRestartVersion] =
    useState(0);
  const [biblePullRestartVersion, setBiblePullRestartVersion] = useState(0);
  const [hasCouchSession, setHasCouchSession] = useState(false);
  const [hasCheckedSession, setHasCheckedSession] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
    status: "connecting",
    retryCount: 0,
  });

  const location = useLocation();
  const dispatch = useDispatch();
  const reduxStore = useStore<RootState>();
  // A full Redux session reset retires the feed even if the database name is unchanged.
  const cacheSession = useSelector((state) => state.allDocs.session);

  const { database, churchId, userId, loginState, logout, setLoginState, login } =
    useContext(GlobalInfoContext) || {};

  const isAuthenticatedSession = loginState === "success";
  const isGuestSession = loginState === "guest";
  const isLoginAuthSurface =
    location.pathname === "/login" ||
    location.pathname.startsWith("/login/");
  const startupDiagnosticMode = getStartupDiagnosticMode();
  const startupDatabasePlan = resolveStartupDatabasePlan(startupDiagnosticMode);
  const shouldInitializeControllerData =
    (isAuthenticatedSession || isGuestSession) &&
    location.pathname !== "/" &&
    !isLoginAuthSurface &&
    (startupDatabasePlan.content || startupDatabasePlan.bible);
  const shouldInitializeContentDatabase =
    shouldInitializeControllerData && startupDatabasePlan.content;
  const shouldInitializeBibleDatabase =
    shouldInitializeControllerData && startupDatabasePlan.bible;
  const isSequentialStartup = startupDatabasePlan.sequential;
  const activeDatabaseKey = (database || DEMO_DATABASE_KEY).toLowerCase();
  const broadcastDatabaseKey = isGuestSession
    ? `${DEMO_DATABASE_KEY}-guest`
    : activeDatabaseKey;
  const databaseSessionKey = JSON.stringify([churchId || "", userId || "", broadcastDatabaseKey]);
  const contentDatabaseScope = db
    ? JSON.stringify([databaseSessionKey, db.name])
    : "";
  const isItemCacheHydrated = Boolean(
    contentDatabaseScope && itemCacheHydratedFor === contentDatabaseScope,
  );
  const isContentPullComplete = Boolean(
    contentDatabaseScope && contentPullCompletedFor === contentDatabaseScope,
  );
  const canStartContentPull = !isSequentialStartup || isItemCacheHydrated;
  const canStartBiblePull = !isSequentialStartup || (
    isItemCacheHydrated && isContentPullComplete
  );
  const initialStartupMetadata = useMemo<ScopedStartupMetadata>(() => {
    const now = Date.now();
    return {
      sessionKey: databaseSessionKey,
      startedAt: now,
      lastMeaningfulActivityAt: now,
      failure: null,
    };
  // Restart elapsed-time diagnostics when the controller enters or leaves startup.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [databaseSessionKey, shouldInitializeControllerData]);
  const [startupMetadata, setStartupMetadata] =
    useState<ScopedStartupMetadata>(initialStartupMetadata);
  const activeStartupMetadata =
    startupMetadata.sessionKey === databaseSessionKey
      ? startupMetadata
      : initialStartupMetadata;
  const [bibleFailureSession, setBibleFailureSession] = useState<{
    sessionKey: string;
    failure: StartupFailure | null;
  }>({ sessionKey: databaseSessionKey, failure: null });
  const activeBibleStartupFailure =
    bibleFailureSession.sessionKey === databaseSessionKey
      ? bibleFailureSession.failure
      : null;
  const [replicationPhaseState, setReplicationPhaseState] = useState<{
    sessionKey: string;
    phase: StartupReplicationPhase;
  }>({ sessionKey: databaseSessionKey, phase: "waiting" });
  const activeReplicationPhase =
    replicationPhaseState.sessionKey === databaseSessionKey
      ? replicationPhaseState.phase
      : "waiting";
  const dbProgressSessionRef = useRef(databaseSessionKey);
  const bibleProgressSessionRef = useRef(databaseSessionKey);
  const startupActivityListenersRef = useRef(
    new Set<(activityAt: number) => void>(),
  );
  const lastPublishedStartupActivityAtRef = useRef(
    initialStartupMetadata.startedAt,
  );
  const contentAccountId = userId || (isGuestSession ? "guest" : "anonymous");
  const databaseSessionRef = useRef(databaseSessionKey);
  databaseSessionRef.current = databaseSessionKey;
  const dbSessionRef = useRef<string | null>(null);
  const activeDatabaseKeyRef = useRef(activeDatabaseKey);
  activeDatabaseKeyRef.current = activeDatabaseKey;

  const subscribeToStartupActivity = useCallback<StartupActivitySubscription>(
    (listener) => {
      startupActivityListenersRef.current.add(listener);
      return () => startupActivityListenersRef.current.delete(listener);
    },
    [],
  );
  const noteStartupActivity = useCallback(
    (sessionKey: string, publishDetails = false) => {
      if (databaseSessionRef.current !== sessionKey) return;
      const activityAt = Date.now();
      startupActivityListenersRef.current.forEach((listener) =>
        listener(activityAt),
      );
      if (
        !publishDetails &&
        activityAt - lastPublishedStartupActivityAtRef.current < 10_000
      ) {
        return;
      }
      lastPublishedStartupActivityAtRef.current = activityAt;
      setStartupMetadata((current) =>
        current.sessionKey === sessionKey
          ? { ...current, lastMeaningfulActivityAt: activityAt }
          : current,
      );
    },
    [],
  );
  const setStartupFailure = useCallback(
    (sessionKey: string, failure: StartupFailure) => {
      if (databaseSessionRef.current !== sessionKey) return;
      const failedAt = Date.now();
      startupActivityListenersRef.current.forEach((listener) =>
        listener(failedAt),
      );
      lastPublishedStartupActivityAtRef.current = failedAt;
      setStartupMetadata((current) =>
        current.sessionKey === sessionKey && !current.failure
          ? {
              ...current,
              failure,
              lastMeaningfulActivityAt: failedAt,
            }
          : current,
      );
    },
    [],
  );
  const setBibleStartupFailure = useCallback(
    (sessionKey: string, failure: StartupFailure) => {
      if (databaseSessionRef.current !== sessionKey) return;
      setBibleFailureSession((current) =>
        current.sessionKey === sessionKey
          ? { ...current, failure }
          : current,
      );
    },
    [],
  );
  const setReplicationPhase = useCallback(
    (sessionKey: string, phase: StartupReplicationPhase) => {
      if (databaseSessionRef.current !== sessionKey) return;
      setReplicationPhaseState((current) =>
        current.sessionKey === sessionKey && current.phase === phase
          ? current
          : { sessionKey, phase },
      );
    },
    [],
  );

  useEffect(() => {
    dbProgressSessionRef.current = databaseSessionKey;
    bibleProgressSessionRef.current = databaseSessionKey;
    lastPublishedStartupActivityAtRef.current =
      initialStartupMetadata.startedAt;
    setDbProgress(null);
    setBibleDbProgress(null);
    setStartupMetadata(initialStartupMetadata);
    setBibleFailureSession({ sessionKey: databaseSessionKey, failure: null });
    setReplicationPhaseState({ sessionKey: databaseSessionKey, phase: "waiting" });
    setInitialPullRestartVersion(0);
    setBiblePullRestartVersion(0);
    setItemCacheHydratedFor(null);
    setContentPullCompletedFor(null);
  }, [databaseSessionKey, initialStartupMetadata]);

  useEffect(() => {
    const contentReplicationOptions = resolveStartupReplicationOptions(
      startupDiagnosticMode,
      "content",
    );
    const bibleReplicationOptions = resolveStartupReplicationOptions(
      startupDiagnosticMode,
      "bible",
    );
    recordStartupDiagnostic("startup", "database-plan", {
      mode: startupDiagnosticMode,
      content: startupDatabasePlan.content,
      bible: startupDatabasePlan.bible,
      sequential: startupDatabasePlan.sequential,
      contentInitialPullBatchSize: contentReplicationOptions.batch_size,
      contentInitialPullBatchesLimit: contentReplicationOptions.batches_limit,
      contentInitialPullMaximumDocumentsInFlight:
        contentReplicationOptions.batch_size * contentReplicationOptions.batches_limit,
      bibleInitialPullBatchSize: bibleReplicationOptions.batch_size,
      bibleInitialPullBatchesLimit: bibleReplicationOptions.batches_limit,
      bibleInitialPullMaximumDocumentsInFlight:
        bibleReplicationOptions.batch_size * bibleReplicationOptions.batches_limit,
    });
  }, [startupDatabasePlan.bible, startupDatabasePlan.content, startupDatabasePlan.sequential, startupDiagnosticMode]);

  // Update broadcast channel when database changes
  useEffect(() => {
    if (broadcastDatabaseKey) {
      updateGlobalBroadcast(broadcastDatabaseKey);
    }
  }, [broadcastDatabaseKey]);

  /** Which local PouchDB name we should be using; stable through loading/error so guest DB stays valid until sign-in finishes. */
  const [localDbIdentity, setLocalDbIdentity] = useState<string | null>(null);

  useEffect(() => {
    if (loginState === "guest") {
      setLocalDbIdentity(databaseSessionKey);
    } else if (loginState === "success") {
      setLocalDbIdentity(databaseSessionKey);
    } else if (loginState === "loading" || loginState === "error") {
      // keep prior identity during sign-in attempts and recoverable errors
    } else {
      setLocalDbIdentity(null);
    }
  }, [loginState, databaseSessionKey]);

  useEffect(() => {
    const expectedName = isGuestSession ? GUEST_DATABASE_NAME : `worship-sync-${activeDatabaseKey}`;
    if (!db || db.name !== expectedName || dbSessionRef.current !== databaseSessionKey || !(isGuestSession || isAuthenticatedSession)) {
      dispatch(resetItemCache());
      setItemCacheHydratedFor(null);
      return;
    }
    const owner = JSON.stringify([databaseSessionKey, db.name]);
    setItemCacheHydratedFor(null);
    return startItemCacheSync(db, dispatch, {
      getCachedDocuments: () => {
        const cache = reduxStore.getState().allDocs;
        return [
          ...cache.allSongDocs,
          ...cache.allFreeFormDocs,
          ...cache.allTimerDocs,
          ...cache.allBibleDocs,
          ...cache.allServiceTimeDocs,
          ...cache.allHeadingDocs,
        ];
      },
      ...(isSequentialStartup
        ? { onHydrated: () => setItemCacheHydratedFor(owner) }
        : {}),
    });
  }, [db, activeDatabaseKey, databaseSessionKey, cacheSession, isGuestSession, isAuthenticatedSession, isSequentialStartup, dispatch, reduxStore]);

  const updater = useRef(new EventTarget());
  const syncRef = useRef<any>(null);
  const contentSyncActivityRef = useRef<ContentReplicationActivity | null>(null);
  const initialContentReplicationActivityRef =
    useRef<ContentReplicationActivity | null>(null);
  const manualContentPullRef = useRef<any>(null);
  const manualContentPullActivityRef =
    useRef<ContentReplicationActivity | null>(null);
  const syncGenerationRef = useRef(0);
  const syncBatchSizeRef = useRef(40);
  const contentLiveSyncDiagnosticRunRef = useRef<StartupReplicationRun | null>(null);
  const remoteDbRef = useRef<PouchDB.Database | null>(null);
  const syncRetryRef = useRef(0);
  const replicateRef = useRef<any>(null);
  const bibleSyncRef = useRef<any>(null);
  const bibleSyncRetryRef = useRef(0);
  const bibleReplicateRef = useRef<any>(null);
  const initialSessionRetryRef = useRef(0);
  const lastSessionFailureKindRef = useRef<CouchSessionResult["failureKind"]>(
    "server-connection",
  );
  const lastSessionFailureDiagnosticRef = useRef<string | undefined>(undefined);
  const prevLocalDbIdentityRef = useRef<string | null>(null);

  const getCouchSession = useCallback(async (
    canCommit: () => boolean = () => true,
    signal?: AbortSignal,
  ) => {
    const sessionRequestStartedAt = performance.now();
    recordStartupDiagnostic("database-session", "request.started");
    const controller = new AbortController();
    const abortRequest = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener("abort", abortRequest, { once: true });
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

    try {
      const response = await fetch(
        `${getApiBasePath()}api/getDbSession`,
        {
          credentials: "include",
          signal: controller.signal,
        }
      );

      clearTimeout(timeoutId);

      // Check if response is actually JSON
      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        console.warn("getCouchSession: Response is not JSON, skipping");
        recordStartupDiagnostic("database-session", "request.finished", {
          success: false,
          status: response.status,
          durationMs: Math.round(performance.now() - sessionRequestStartedAt),
        });
        return {
          success: false,
          failureKind:
            response.status === 401 || response.status === 403
              ? "authentication"
              : "server-connection",
          diagnostic: sanitizeStartupDiagnostic({
            status: response.status,
            name: "SessionRequestError",
          }),
        } satisfies CouchSessionResult;
      }

      const data = await response.json();
      const success = response.ok !== false && data.success === true;
      if (canCommit()) setHasCouchSession(success);
      recordStartupDiagnostic("database-session", "request.finished", {
        success,
        status: response.status,
        durationMs: Math.round(performance.now() - sessionRequestStartedAt),
      });
      if (success) return { success: true } satisfies CouchSessionResult;
      return {
        success: false,
        failureKind:
          data.failureKind === "authentication" ||
          response.status === 401 ||
          response.status === 403
            ? "authentication"
            : "server-connection",
        diagnostic: sanitizeStartupDiagnostic({
          status: response.status,
          name: "SessionRequestError",
        }),
      } satisfies CouchSessionResult;
    } catch (error: any) {
      clearTimeout(timeoutId);
      recordStartupDiagnostic("database-session", "request.finished", {
        success: false,
        outcome: "network-error",
        durationMs: Math.round(performance.now() - sessionRequestStartedAt),
      });
      if (signal?.aborted) {
        return {
          success: false,
          failureKind: "server-connection",
          diagnostic: sanitizeStartupDiagnostic(error),
        } satisfies CouchSessionResult;
      }
      // Network error (server down, no internet, timeout)
      if (error.name === "AbortError" || error.name === "TypeError") {
        console.error("getCouchSession: Network error or timeout:", error);
      } else {
        console.error("getCouchSession: Error fetching session:", error);
      }
      return {
        success: false,
        failureKind: "server-connection",
        diagnostic: sanitizeStartupDiagnostic(error),
      } satisfies CouchSessionResult;
    } finally {
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", abortRequest);
    }
  }, []);

  const syncDb = useCallback(
    (localDb: PouchDB.Database, remoteDb: PouchDB.Database, churchKey: string) => {
      contentSyncActivityRef.current?.release();
      const syncActivity = trackContentReplication(localDb.name);
      contentSyncActivityRef.current = syncActivity;
      contentLiveSyncDiagnosticRunRef.current?.finish("replaced");
      contentLiveSyncDiagnosticRunRef.current = null;
      syncRef.current?.cancel();
      syncRef.current = null;
      const generation = ++syncGenerationRef.current;
      let authRecovery: Promise<void> | null = null;

      const startLiveSync = () => {
        if (
          generation !== syncGenerationRef.current ||
          activeDatabaseKeyRef.current !== churchKey
        ) return;
        const syncOptions = {
          retry: true,
          live: true,
          selector: { _id: { $ne: "media" } },
          batch_size: syncBatchSizeRef.current,
          batches_limit: 5,
        };
        const diagnosticRun = beginStartupReplication("content", {
          kind: "live-sync",
          batchSize: syncOptions.batch_size,
          batchesLimit: syncOptions.batches_limit,
        });
        contentLiveSyncDiagnosticRunRef.current = diagnosticRun;
        const liveSync = localDb.sync(remoteDb, syncOptions);
        syncRef.current = liveSync;
        liveSync
          .on("change", (event) => {
            const changeDocs = (event as { change?: { docs?: unknown[] } })?.change?.docs;
            diagnosticRun.recordBatch(changeDocs?.length ?? 0);
            if (event.direction === "pull") {
              updater.current.dispatchEvent(
                new CustomEvent("update", { detail: event.change.docs })
              );
              if ((event.change.docs as Array<{ docType?: string }> | undefined)
                ?.some((doc) => doc.docType === "song-v2-cleanup" || doc.docType === "song-v2-cleanup-discovery")) {
                scheduleSongV2CleanupMaintenance(localDb);
              }
            }
          })
          .on("active", () => {
            recordStartupDiagnostic("content", "live-sync.active");
            syncActivity.setBusy(true);
            if (syncRef.current === liveSync) {
              setConnectionStatus({ status: "connected", retryCount: syncRetryRef.current });
            }
          })
          .on("paused", (error?: unknown) => {
            if (error) {
              diagnosticRun.recordRetry((error as { status?: number }).status);
            }
            syncActivity.setBusy(Boolean(error));
            if (syncRef.current === liveSync) {
              if (error) {
                setConnectionStatus((current) => current.status === "failed"
                  ? current
                  : { status: "retrying", retryCount: Math.max(syncRetryRef.current, 1) });
              } else {
                syncRetryRef.current = 0;
                setConnectionStatus({ status: "connected", retryCount: 0 });
              }
            }
          })
          .on("denied", (error: any) => {
            syncActivity.setBusy(true);
            void handleSyncError(error, liveSync);
          })
          .on("error", (error: any) => {
            syncActivity.setBusy(true);
            void handleSyncError(error, liveSync);
          })
          .on("complete", () => {
            diagnosticRun.finish("complete");
            if (contentLiveSyncDiagnosticRunRef.current === diagnosticRun) {
              contentLiveSyncDiagnosticRunRef.current = null;
            }
            syncActivity.release();
          });
      };

      const handleSyncError = async (error: any, failedSync: any) => {
        if (syncRef.current !== failedSync) return;
        contentLiveSyncDiagnosticRunRef.current?.finish("error");
        contentLiveSyncDiagnosticRunRef.current = null;
        if (error?.status === 413) {
          if (!canRetrySync413(syncBatchSizeRef.current)) {
            syncRef.current = null;
            failedSync.cancel();
            const message = "Sync is blocked because one database document is too large to upload. Local changes remain on this device and may not reach other devices. Contact support before continuing.";
            console.error(
              "Controller replication blocked by HTTP 413 at batch_size 1; an individual document is likely too large.",
              error,
            );
            setConnectionStatus({ status: "failed", retryCount: 0, failureReason: "push-too-large", message });
            return;
          }
          syncBatchSizeRef.current = nextSyncBatchSize(syncBatchSizeRef.current);
          syncRef.current = null;
          failedSync.cancel();
          console.warn(
            "Controller replication received HTTP 413; retrying with smaller batch_size:",
            syncBatchSizeRef.current,
          );
          setConnectionStatus({ status: "retrying", retryCount: 0 });
          startLiveSync();
          return;
        }

        if (error?.status === 401 || error?.status === 403) {
          if (authRecovery) return authRecovery;
          syncRef.current = null;
          failedSync.cancel();
          const retryCount = syncRetryRef.current + 1;
          syncRetryRef.current = retryCount;
          setHasCouchSession(false);
          setConnectionStatus({ status: "retrying", retryCount });
          authRecovery = (async () => {
            const sessionResult = await getCouchSession(() =>
              generation === syncGenerationRef.current &&
              activeDatabaseKeyRef.current === churchKey,
            );
            if (
              generation !== syncGenerationRef.current ||
              activeDatabaseKeyRef.current !== churchKey
            ) return;
            if (syncRef.current !== null) return;
            if (!sessionResult.success) {
              if (retryCount >= MAX_REPLICATION_AUTH_RETRIES) {
                const message = "Sync could not renew the server session. Sign in again to resume syncing.";
                setConnectionStatus({ status: "failed", retryCount, failureReason: "replication", message });
                return;
              }
              await backoff(retryCount);
              if (
                generation !== syncGenerationRef.current ||
                activeDatabaseKeyRef.current !== churchKey
              ) return;
              if (syncRef.current === null) startLiveSync();
              return;
            }
            syncRetryRef.current = 0;
            startLiveSync();
          })().finally(() => {
            authRecovery = null;
          });
          return authRecovery;
        }

        syncRef.current = null;
        failedSync.cancel();
        const detail = describeControllerSyncError(error);
        console.error("Controller replication stopped:", detail);
        setConnectionStatus({
          status: "failed",
          retryCount: syncRetryRef.current,
          failureReason: "replication",
          message: `Sync stopped: ${detail}. Check your connection and reload to try again.`,
        });
      };

      startLiveSync();
    },
    [getCouchSession]
  );

  const pullFromRemote = useCallback(() => {
    const remote = remoteDbRef.current;
    if (!db || !remote || !isAuthenticatedSession) return;
    manualContentPullRef.current?.cancel();
    manualContentPullActivityRef.current?.release();
    const activity = trackContentReplication(db.name);
    manualContentPullActivityRef.current = activity;
    const pull = remote
      .replicate.to(db, { retry: false, selector: { _id: { $ne: "media" } } })
      .on("change", (info: any) => {
        if (info.docs?.length) {
          updater.current.dispatchEvent(
            new CustomEvent("update", { detail: info.docs })
          );
        }
      })
      .on("complete", () => {
        activity.release();
        if (manualContentPullActivityRef.current === activity) {
          manualContentPullActivityRef.current = null;
          manualContentPullRef.current = null;
        }
      })
      .on("error", () => {
        activity.release();
        if (manualContentPullActivityRef.current === activity) {
          manualContentPullActivityRef.current = null;
          manualContentPullRef.current = null;
        }
      });
    manualContentPullRef.current = pull;
  }, [db, isAuthenticatedSession]);

  const bibleSyncDb = useCallback(
    async (localDb: PouchDB.Database, remoteDb: PouchDB.Database) => {
      bibleSyncRef.current?.cancel();
      recordStartupDiagnostic("bible", "live-change-feed.started");

      bibleSyncRef.current = localDb
        .changes({ since: "now", live: true })
        .on("change", () => {
          if (syncTimeout) clearTimeout(syncTimeout);
          syncTimeout = setTimeout(() => {
            const replicationOptions = resolveStartupReplicationOptions(
              startupDiagnosticMode,
              "bible",
            );
            const diagnosticRun = beginStartupReplication("bible", {
              kind: "live-sync",
              batchSize: replicationOptions.batch_size,
              batchesLimit: replicationOptions.batches_limit,
            });
            localDb.sync(remoteDb, { retry: true, ...replicationOptions })
              .on("change", (event) => {
                const changeDocs = (event as { change?: { docs?: unknown[] } })?.change?.docs;
                diagnosticRun.recordBatch(changeDocs?.length ?? 0);
              })
              .on("active", () => {
                recordStartupDiagnostic("bible", "live-sync.active");
              })
              .on("paused", (error?: unknown) => {
                if (error) diagnosticRun.recordRetry((error as { status?: number }).status);
              })
              .on("complete", () => diagnosticRun.finish("complete"))
              .on("error", (error: unknown) => {
                diagnosticRun.finish("error");
                recordStartupDiagnostic("bible", "live-sync.error", {
                  statusCode: (error as { status?: number })?.status ?? null,
                });
              });
          }, 10000); // Wait 10 second after last change
        })
        .on("error", async (error: any) => {
          if (error.status === 401 || error.status === 403) {
            setConnectionStatus({ status: "retrying", retryCount: bibleSyncRetryRef.current + 1 });
            setHasCouchSession(false);
            const sessionResult = await getCouchSession();
            if (!sessionResult.success) {
              bibleSyncRetryRef.current++;
              if (bibleSyncRetryRef.current > MAX_REPLICATION_AUTH_RETRIES) {
                setConnectionStatus({ status: "failed", retryCount: bibleSyncRetryRef.current });
                return;
              }
              await backoff(bibleSyncRetryRef.current);
            } else {
              bibleSyncRetryRef.current = 0;
            }
          }
        });
    },
    [getCouchSession, startupDiagnosticMode]
  );

  useEffect(() => {
    let cancelled = false;
    let retryTimeout: number | undefined;
    let resolveRetry: (() => void) | undefined;
    const requestController = new AbortController();
    const isCurrentSession = () =>
      !cancelled && databaseSessionRef.current === databaseSessionKey;
    const waitForRetry = (retryCount: number) =>
      new Promise<void>((resolve) => {
        resolveRetry = resolve;
        const delay = Math.min(30000, 5000 * 2 ** retryCount);
        retryTimeout = window.setTimeout(() => {
          retryTimeout = undefined;
          resolveRetry = undefined;
          resolve();
        }, delay);
      });
    const attemptSession = async () => {
      if (isGuestSession && shouldInitializeControllerData) {
        if (!hasCheckedSession) {
          initialSessionRetryRef.current = 0;
          setHasCouchSession(true);
          setConnectionStatus({ status: "connected", retryCount: 0 });
          setHasCheckedSession(true);
        }
        return;
      }

      if (shouldInitializeControllerData && !hasCheckedSession && !isGuestSession) {
        lastSessionFailureKindRef.current = "server-connection";
        lastSessionFailureDiagnosticRef.current = undefined;
        setConnectionStatus({ status: "connecting", retryCount: 0 });
        for (
          let retryCount = 0;
          retryCount <= MAX_INITIAL_SESSION_RETRIES;
          retryCount += 1
        ) {
          if (!isCurrentSession()) return;
          recordStartupDiagnostic("database-session", "attempt", {
            attempt: retryCount + 1,
          });
          noteStartupActivity(databaseSessionKey, true);
          const sessionResult = await getCouchSession(
            isCurrentSession,
            requestController.signal,
          );
          if (!isCurrentSession()) return;
          noteStartupActivity(databaseSessionKey);

          if (sessionResult.success) {
            initialSessionRetryRef.current = 0;
            lastSessionFailureKindRef.current = undefined;
            lastSessionFailureDiagnosticRef.current = undefined;
            setConnectionStatus({ status: "connected", retryCount: 0 });
            noteStartupActivity(databaseSessionKey, true);
            setHasCheckedSession(true);
            return;
          }

          lastSessionFailureKindRef.current =
            sessionResult.failureKind ?? "server-connection";
          lastSessionFailureDiagnosticRef.current = sessionResult.diagnostic;
          initialSessionRetryRef.current = retryCount + 1;
          if (retryCount < MAX_INITIAL_SESSION_RETRIES) {
            const nextRetryCount = retryCount + 1;
            setConnectionStatus({
              status: "retrying",
              retryCount: nextRetryCount,
            });
            noteStartupActivity(databaseSessionKey, true);
            await waitForRetry(nextRetryCount);
          }
        }

        if (!isCurrentSession()) return;
        console.error(
          `Failed to establish session after ${MAX_INITIAL_SESSION_RETRIES} attempts. Server may be down.`,
        );
        const message = `WorshipSync couldn't connect to the server after ${MAX_INITIAL_SESSION_RETRIES} retries. Check your connection, then reload WorshipSync.`;
        const failureKind = lastSessionFailureKindRef.current;
        const failureMessage = failureKind === "authentication"
          ? "WorshipSync couldn't verify its database session after automatic retries. Reload WorshipSync to try again. If this continues, contact support."
          : message;
        setConnectionStatus({
          status: "failed",
          retryCount: MAX_INITIAL_SESSION_RETRIES,
          message: failureMessage,
        });
        setStartupFailure(databaseSessionKey, {
          kind: failureKind,
          message: failureMessage,
          diagnostic: lastSessionFailureDiagnosticRef.current ?? (
            failureKind === "authentication"
              ? "The server rejected the session credentials"
              : "Connection attempts were exhausted"
          ),
        });
        setHasCheckedSession(true);
      }
    };

    void attemptSession();
    return () => {
      cancelled = true;
      requestController.abort();
      if (retryTimeout !== undefined) {
        window.clearTimeout(retryTimeout);
        retryTimeout = undefined;
        resolveRetry?.();
        resolveRetry = undefined;
      }
    };
  }, [
    getCouchSession,
    hasCheckedSession,
    isGuestSession,
    shouldInitializeControllerData,
    databaseSessionKey,
    noteStartupActivity,
    setStartupFailure,
  ]);

  // Reset retry counter when login state or database changes
  useEffect(() => {
    if (isGuestSession) return;
    initialSessionRetryRef.current = 0;
    setHasCheckedSession(false);
    setHasCouchSession(false);
    setConnectionStatus({ status: "connecting", retryCount: 0 });
  }, [loginState, databaseSessionKey, isGuestSession]);

  useEffect(() => {
    let cancelled = false;
    const setupDb = async () => {
      const sessionAtStart = databaseSessionKey;
      const isCurrentSession = () => !cancelled && databaseSessionRef.current === sessionAtStart;
      const setupStartedAt = performance.now();
      recordStartupDiagnostic("content", "database-setup.started");
      noteStartupActivity(sessionAtStart, true);
      try {
        const dbName = isGuestSession
          ? GUEST_DATABASE_NAME
          : `worship-sync-${activeDatabaseKey}`;

        if (isGuestSession) {
          setDbProgress(null);
          try {
            await new PouchDB(GUEST_DATABASE_NAME).destroy();
          } catch (error) {
            // Ignore "missing database" and continue with a fresh setup.
          }

          const localDb = new PouchDB(dbName);
          recordLocalDatabaseOpen("content", localDb);
          await seedOfflineGuestDatabase(localDb);
          if (!isCurrentSession()) return;
          noteStartupActivity(sessionAtStart, true);
          dbSessionRef.current = sessionAtStart;
          setDbProgress(100);
          contentDbRef.current = localDb;
          setDb(localDb);
          setIsDbSetup(true);
          recordStartupDiagnostic("content", "database-setup.ready", {
            durationMs: Math.round(performance.now() - setupStartedAt),
          });
          setGlobalContentDatabase(localDb, {
            databaseKey: broadcastDatabaseKey,
            churchId: globalFireDbInfo.churchId || "",
            accountId: contentAccountId,
          });
          scheduleSongV2CleanupMaintenance(localDb, true);
          if (broadcastDatabaseKey) {
            updateGlobalBroadcast(broadcastDatabaseKey);
          }
          return;
        }

        // Wrap PouchDB initialization in try-catch to handle IndexedDB errors
        let localDb: PouchDB.Database;
        try {
          localDb = new PouchDB(dbName);
          recordLocalDatabaseOpen("content", localDb);
        } catch (dbError: any) {
          console.error("Error creating local PouchDB:", dbError);
          // If IndexedDB fails, try to handle it gracefully
          if (dbError.name === "IndexedDBError" || dbError.message?.includes("IndexedDB")) {
            console.error("IndexedDB error detected. This may be due to browser storage issues.");
            // Try to clear and retry once
            try {
              // Wait a bit and retry
              await new Promise(resolve => setTimeout(resolve, 1000));
              if (!isCurrentSession()) return;
              localDb = new PouchDB(dbName);
            } catch (retryError) {
              console.error("Failed to create PouchDB after retry:", retryError);
              if (isCurrentSession()) {
                setStartupFailure(sessionAtStart, {
                  kind: "local-storage",
                  message: "WorshipSync couldn't open the local database. Check that browser storage is available, then reload WorshipSync.",
                  diagnostic: sanitizeStartupDiagnostic(retryError),
                });
              }
              return;
            }
          } else {
            throw dbError;
          }
        }

        if (!isCurrentSession()) return;
        // Local content is usable offline while the initial remote pull retries.
        dbSessionRef.current = sessionAtStart;
        setGlobalContentDatabase(localDb, {
          databaseKey: activeDatabaseKey,
          churchId: churchId || "",
          accountId: contentAccountId,
        });
        setDb(localDb);
        setIsDbSetup(true);
        recordStartupDiagnostic("content", "database-setup.ready", {
          durationMs: Math.round(performance.now() - setupStartedAt),
        });
        noteStartupActivity(sessionAtStart, true);

      } catch (error) {
        if (!isCurrentSession()) return;
        console.error("Error in setupDb:", error);
        recordStartupDiagnostic("content", "database-setup.failed", {
          durationMs: Math.round(performance.now() - setupStartedAt),
        });
        setStartupFailure(sessionAtStart, {
          kind: "local-storage",
          message: "WorshipSync couldn't prepare the local workspace. Check that browser storage is available, then reload WorshipSync.",
          diagnostic: sanitizeStartupDiagnostic(error),
        });
      }
    };
    if (shouldInitializeContentDatabase && !isDbSetup) void setupDb();
    return () => { cancelled = true; };
  }, [shouldInitializeContentDatabase, databaseSessionKey, churchId, activeDatabaseKey, broadcastDatabaseKey, contentAccountId, isGuestSession, isDbSetup, noteStartupActivity, setStartupFailure]);

  const initialRemoteDatabaseRef = useRef<PouchDB.Database | null>(null);
  const contentDatabaseSessionRef = useRef<
    ReturnType<typeof beginContentDatabaseSession> | null
  >(null);
  const canCreateBootstrapDocuments = useCallback(() => {
    if ((!isAuthenticatedSession && !isGuestSession) || !shouldInitializeContentDatabase) return false;
    if (!db || globalDb !== db || databaseSessionRef.current !== databaseSessionKey || dbSessionRef.current !== databaseSessionKey) return false;
    if (isGuestSession) return true;
    const session = contentDatabaseSessionRef.current;
    return Boolean(session && hasSuccessfulInitialContentReplication(db.name, session.token));
  }, [db, databaseSessionKey, isGuestSession, isAuthenticatedSession, shouldInitializeContentDatabase]);
  const bootstrapReady = useSyncExternalStore(
    subscribeToContentActivity,
    canCreateBootstrapDocuments,
    () => false,
  );
  const currentLocalDatabaseName = isGuestSession
    ? GUEST_DATABASE_NAME
    : `worship-sync-${activeDatabaseKey}`;
  const localDatabaseReady = Boolean(
    isDbSetup &&
      db &&
      db.name === currentLocalDatabaseName &&
      dbSessionRef.current === databaseSessionKey,
  );
  const startupStage: ControllerStartupInfo["stage"] = (() => {
    if (!shouldInitializeControllerData) return "idle";
    if (activeStartupMetadata.failure) return "failed";
    if (bootstrapReady) return "completed";
    if (connectionStatus.status === "retrying") {
      return localDatabaseReady
        ? "reconnecting"
        : "preparing-local-database-and-reconnecting";
    }
    if (activeReplicationPhase === "finalizing") {
      return "finalizing-initialization";
    }
    if (activeReplicationPhase === "synchronizing") {
      return "synchronizing-database-content";
    }
    if (activeReplicationPhase === "preparing") {
      return "preparing-database-sync";
    }
    if (!localDatabaseReady) {
      if (!hasCheckedSession && connectionStatus.status === "connecting") {
        return "preparing-local-database-and-connecting";
      }
      return "preparing-local-database";
    }
    if (!hasCheckedSession || !hasCouchSession) return "connecting-to-server";
    return "preparing-database-sync";
  })();
  const startupInfo = useMemo<ControllerStartupInfo>(
    () => ({
      stage: startupStage,
      startedAt: activeStartupMetadata.startedAt,
      lastMeaningfulActivityAt:
        activeStartupMetadata.lastMeaningfulActivityAt,
      failure: activeStartupMetadata.failure,
    }),
    [
      startupStage,
      activeStartupMetadata.startedAt,
      activeStartupMetadata.lastMeaningfulActivityAt,
      activeStartupMetadata.failure,
    ],
  );
  const readyDiagnosticSessionRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      !startupDatabasePlan.content ||
      !startupDatabasePlan.bible ||
      startupStage !== "completed" ||
      readyDiagnosticSessionRef.current === databaseSessionKey
    ) {
      return;
    }
    readyDiagnosticSessionRef.current = databaseSessionKey;
    recordStartupDiagnostic("startup", "application.ready", {
      startupDurationMs: Math.max(0, Date.now() - activeStartupMetadata.startedAt),
      sessionKind: isAuthenticatedSession ? "authenticated" : isGuestSession ? "guest" : "unknown",
    });
  }, [activeStartupMetadata.startedAt, databaseSessionKey, isAuthenticatedSession, isGuestSession, startupDatabasePlan.bible, startupDatabasePlan.content, startupStage]);
  const dbProgressForCurrentSession =
    dbProgressSessionRef.current === databaseSessionKey ? dbProgress : null;
  const currentDbProgress =
    bootstrapReady || dbProgressForCurrentSession === 100
      ? 100
      : dbProgressForCurrentSession;
  const currentBibleDbProgress =
    bibleProgressSessionRef.current === databaseSessionKey
      ? bibleDbProgress
      : null;
  useEffect(() => {
    if (!db || !isAuthenticatedSession || dbSessionRef.current !== databaseSessionKey) {
      return;
    }
    const localDb = db;
    const contentDatabaseSession = beginContentDatabaseSession(localDb.name);
    contentDatabaseSessionRef.current = contentDatabaseSession;
    const sourceDatabaseName = `worship-sync-${activeDatabaseKey}`;
    noteStartupActivity(databaseSessionKey, true);
    // This concrete PouchDB instance already completed its first remote pull.
    // Keep that fact when authentication refreshes the same local DB session.
    if (initialRemoteDatabaseRef.current === localDb) {
      contentDatabaseSession.markInitialReplicationComplete();
    }
    let active = true;
    const checkpointCheckStartedAt = performance.now();
    void hasVerifiedInitialContentReplication(localDb, sourceDatabaseName)
      .then((wasPreviouslyInitialized) => {
        if (
          !active ||
          databaseSessionRef.current !== databaseSessionKey ||
          contentDatabaseSessionRef.current !== contentDatabaseSession
        ) {
          return;
        }
        recordStartupDiagnostic("content", "checkpoint.checked", {
          exists: wasPreviouslyInitialized,
          durationMs: Math.round(performance.now() - checkpointCheckStartedAt),
        });
        if (wasPreviouslyInitialized) {
          contentDatabaseSession.markInitialReplicationComplete();
          setDbProgress(100);
          noteStartupActivity(databaseSessionKey, true);
        }
      })
      .catch((error) => {
        if (
          !active ||
          databaseSessionRef.current !== databaseSessionKey ||
          contentDatabaseSessionRef.current !== contentDatabaseSession
        ) {
          return;
        }
        recordStartupDiagnostic("content", "checkpoint.failed", {
          durationMs: Math.round(performance.now() - checkpointCheckStartedAt),
        });
        console.error("Could not verify the local content replication checkpoint:", error);
        setStartupFailure(databaseSessionKey, {
          kind: "local-storage",
          message: "WorshipSync couldn't verify the local database. Check that browser storage is available, then reload WorshipSync.",
          diagnostic: sanitizeStartupDiagnostic(error),
        });
      });
    return () => {
      active = false;
      cancelBibleItemCleanupRetry(localDb, contentDatabaseSession.token);
      contentDatabaseSession.release();
      if (contentDatabaseSessionRef.current === contentDatabaseSession) {
        contentDatabaseSessionRef.current = null;
      }
    };
  }, [db, databaseSessionKey, activeDatabaseKey, isAuthenticatedSession, noteStartupActivity, setStartupFailure]);

  useEffect(() => {
    if (
      !shouldInitializeContentDatabase ||
      !db ||
      !hasCouchSession ||
      !isAuthenticatedSession ||
      !canStartContentPull ||
      dbSessionRef.current !== databaseSessionKey ||
      initialRemoteDatabaseRef.current === db
    ) return;
    let cancelled = false;
    let initialPullDiagnosticRun: StartupReplicationRun | null = null;
    const sessionAtStart = databaseSessionKey;
    const isCurrentSession = () => !cancelled && databaseSessionRef.current === sessionAtStart;
    const localDb = db;
    const contentDatabaseSession = contentDatabaseSessionRef.current;
    if (!contentDatabaseSession) return;
    const connectRemote = async () => {
      let pullActivity: ContentReplicationActivity | null = null;
      let pullFailed = false;
      let authRecovery: Promise<void> | null = null;
      const recoverInitialReplicationSession = () => {
        if (authRecovery) return authRecovery;
        authRecovery = (async () => {
          let lastFailureKind: NonNullable<CouchSessionResult["failureKind"]> =
            "authentication";
          let lastFailureDiagnostic: string | undefined;
          for (
            let retryCount = 1;
            retryCount <= MAX_REPLICATION_AUTH_RETRIES;
            retryCount += 1
          ) {
            if (!isCurrentSession()) return;
            initialPullDiagnosticRun?.recordRetry();
            recordStartupDiagnostic("content", "session-recovery.attempt", {
              attempt: retryCount,
            });
            setConnectionStatus({ status: "retrying", retryCount });
            noteStartupActivity(sessionAtStart, true);
            const sessionResult = await getCouchSession(() => false);
            if (!isCurrentSession()) return;
            if (sessionResult.success) {
              setHasCouchSession(true);
              setConnectionStatus({ status: "connected", retryCount: 0 });
              noteStartupActivity(sessionAtStart, true);
              setInitialPullRestartVersion((current) => current + 1);
              return;
            }
            lastFailureKind =
              sessionResult.failureKind ?? "server-connection";
            lastFailureDiagnostic = sessionResult.diagnostic;
            if (retryCount < MAX_REPLICATION_AUTH_RETRIES) {
              await backoff(retryCount, 5000, 30000);
            }
          }

          if (!isCurrentSession()) return;
          const message = lastFailureKind === "authentication"
            ? "WorshipSync couldn't verify its database session after automatic retries. Reload WorshipSync to try again. If this continues, contact support."
            : "WorshipSync couldn't reconnect to the server for database sync. Check your connection, then reload WorshipSync.";
          setConnectionStatus({
            status: "failed",
            retryCount: MAX_REPLICATION_AUTH_RETRIES,
            message,
          });
          setStartupFailure(sessionAtStart, {
            kind: lastFailureKind,
            message,
            diagnostic: lastFailureDiagnostic ?? (
              lastFailureKind === "authentication"
                ? "The server rejected the renewed session"
                : "Server connection attempts were exhausted"
            ),
          });
          initialPullDiagnosticRun?.finish("cancelled");
          replicateRef.current?.cancel();
        })().finally(() => {
          authRecovery = null;
        });
        return authRecovery;
      };
      try {
        const remoteSourceDbName = `worship-sync-${isGuestSession ? DEMO_DATABASE_KEY : activeDatabaseKey
          }`;
        const remoteUrl = `${import.meta.env.VITE_COUCHDB_HOST}/${remoteSourceDbName}`;
        let remoteDb: PouchDB.Database;
        try {
          remoteDb = new PouchDB(remoteUrl, {
            fetch: (url, options: any) => {
              const opts = options ?? {};
              opts.credentials = "include";
              return fetch(url, opts);
            },
          });
          recordStartupDiagnostic("content", "remote-client.created");
          remoteDbRef.current = remoteDb;
        } catch (remoteError) {
          console.error("Error creating remote PouchDB:", remoteError);
          setStartupFailure(sessionAtStart, {
            kind: "remote-database",
            message: "WorshipSync couldn't prepare database synchronization. Check your server connection, then reload WorshipSync.",
            diagnostic: sanitizeStartupDiagnostic(remoteError),
          });
          return;
        }

        contentLiveSyncDiagnosticRunRef.current?.finish("replaced");
        contentLiveSyncDiagnosticRunRef.current = null;
        syncRef.current?.cancel();
        replicateRef.current?.cancel();
        initialContentReplicationActivityRef.current?.release();
        const activePullActivity = trackContentReplication(localDb.name);
        pullActivity = activePullActivity;
        initialContentReplicationActivityRef.current = activePullActivity;
        setReplicationPhase(sessionAtStart, "preparing");
        noteStartupActivity(sessionAtStart, true);
        const progressForThisReplication = createReplicationProgressTracker();
        const replicationOptions = resolveStartupReplicationOptions(
          startupDiagnosticMode,
          "content",
        );
        initialPullDiagnosticRun = beginStartupReplication("content", {
          batchSize: replicationOptions.batch_size,
          batchesLimit: replicationOptions.batches_limit,
        });

        replicateRef.current = remoteDb.replicate
          .to(localDb, {
            retry: true,
            ...replicationOptions,
            selector: { _id: { $ne: "media" } },
          })
          .on("change", (info) => {
            if (!isCurrentSession()) return;
            const change = info as { pending?: unknown; docs?: unknown[] };
            initialPullDiagnosticRun?.recordBatch(change.docs?.length ?? 0);
            noteStartupActivity(sessionAtStart);
            if (Array.isArray(change.docs) && change.docs.length > 0) {
              setReplicationPhase(sessionAtStart, "synchronizing");
            }
            const progress = progressForThisReplication(change.pending);
            if (progress === null) return;
            setDbProgress((current) => {
              if (
                !isCurrentSession() ||
                hasSuccessfulInitialContentReplication(
                  localDb.name,
                  contentDatabaseSession.token,
                )
              ) {
                return current;
              }
              return current === progress ? current : progress;
            });
          })
          .on("active", () => {
            if (!isCurrentSession()) return;
            recordStartupDiagnostic("content", "replication.active");
            setReplicationPhase(sessionAtStart, "synchronizing");
            noteStartupActivity(sessionAtStart);
            setConnectionStatus((current) =>
              current.status === "retrying"
                ? { status: "connected", retryCount: 0 }
                : current,
            );
          })
          .on("paused", (error?: unknown) => {
            if (!isCurrentSession()) return;
            if (error) {
              const status = (error as { status?: number })?.status;
              initialPullDiagnosticRun?.recordRetry(status);
              setConnectionStatus((current) =>
                current.status === "failed"
                  ? current
                  : {
                      status: "retrying",
                      retryCount: Math.max(current.retryCount, 1),
                    },
              );
              noteStartupActivity(sessionAtStart);
              if (status === 401 || status === 403) {
                void recoverInitialReplicationSession();
              }
            } else {
              setConnectionStatus((current) =>
                current.status === "retrying"
                  ? { status: "connected", retryCount: 0 }
                  : current,
              );
            }
          })
          .on("error", async (error: any) => {
            initialPullDiagnosticRun?.finish("error");
            if (!isCurrentSession()) return;
            pullFailed = true;
            console.error("Replication error:", error);
            if (error.status === 401 || error.status === 403) {
              await recoverInitialReplicationSession();
              return;
            }
            const message =
              "The initial database sync couldn't finish. Check your connection, then reload WorshipSync to try again.";
            setConnectionStatus((current) => ({
              ...current,
              status: "failed",
              failureReason: "replication",
              message,
            }));
            setStartupFailure(sessionAtStart, {
              kind: "replication",
              message,
              diagnostic: sanitizeStartupDiagnostic(error),
            });
          })
          .on("complete", (result: { status?: string; ok?: boolean; errors?: unknown[] }) => {
            initialPullDiagnosticRun?.finish(
              result?.status === "cancelled" ? "cancelled" : "complete",
            );
            if (!isCurrentSession() || pullFailed) return;
            if (
              result?.status === "cancelled" ||
              result?.ok === false ||
              result?.errors?.length
            ) {
              const message =
                "The initial database sync ended before it was complete. Check your connection, then reload WorshipSync to try again.";
              setConnectionStatus((current) => ({
                ...current,
                status: "failed",
                failureReason: "replication",
                message,
              }));
              setStartupFailure(sessionAtStart, {
                kind: "replication",
                message,
                diagnostic: result?.status === "cancelled"
                  ? "The active replication was cancelled"
                  : sanitizeStartupDiagnostic(result?.errors?.[0] ?? result),
              });
              return;
            }
            setReplicationPhase(sessionAtStart, "finalizing");
            noteStartupActivity(sessionAtStart, true);
            void (async () => {
              try {
                await recordVerifiedInitialContentReplication(localDb, remoteSourceDbName);
              } catch (error) {
                // The current session is still ready from the successful pull;
                // without this local-only record, a later offline restart will
                // safely wait for another successful initial pull.
                console.error("Could not save the local content replication checkpoint:", error);
              }
              const cacheDrainStartedAt = performance.now();
              await flushItemCacheChanges(localDb);
              recordStartupDiagnostic("content", "item-cache.pending-batches-drained", {
                durationMs: Math.round(performance.now() - cacheDrainStartedAt),
              });
              if (!isCurrentSession()) return;
              contentDatabaseSession.markInitialReplicationComplete();
              if (isSequentialStartup) {
                setContentPullCompletedFor(
                  JSON.stringify([sessionAtStart, localDb.name]),
                );
              }
              setReplicationPhase(sessionAtStart, "waiting");
              activePullActivity.release();
              if (initialContentReplicationActivityRef.current === activePullActivity) {
                initialContentReplicationActivityRef.current = null;
              }
              setDbProgress(100);
              setConnectionStatus({ status: "connected", retryCount: 0 });
              noteStartupActivity(sessionAtStart, true);
              initialRemoteDatabaseRef.current = localDb;
              contentDbRef.current = localDb;
              scheduleSongV2CleanupMaintenance(localDb, true);
              if (broadcastDatabaseKey) {
                updateGlobalBroadcast(broadcastDatabaseKey);
              }
              if (isAuthenticatedSession) {
                syncDb(localDb, remoteDb, activeDatabaseKey);
              }
            })();
          });
      } catch (error) {
        initialPullDiagnosticRun?.finish("error");
        pullActivity?.release();
        if (initialContentReplicationActivityRef.current === pullActivity) {
          initialContentReplicationActivityRef.current = null;
        }
        if (isCurrentSession()) {
          console.error("Error connecting content replication:", error);
          setStartupFailure(sessionAtStart, {
            kind: "remote-database",
            message: "WorshipSync couldn't prepare database synchronization. Check your server connection, then reload WorshipSync.",
            diagnostic: sanitizeStartupDiagnostic(error),
          });
        }
      }
    };
    void connectRemote();
    return () => {
      cancelled = true;
      initialPullDiagnosticRun?.finish("cancelled");
      replicateRef.current?.cancel();
      initialContentReplicationActivityRef.current?.release();
      initialContentReplicationActivityRef.current = null;
    };
  }, [shouldInitializeContentDatabase, db, hasCouchSession, isAuthenticatedSession, canStartContentPull, isSequentialStartup, databaseSessionKey, activeDatabaseKey, broadcastDatabaseKey, isGuestSession, initialPullRestartVersion, syncDb, getCouchSession, noteStartupActivity, setStartupFailure, setReplicationPhase, startupDiagnosticMode]);

  useEffect(() => {
    let cancelled = false;
    let biblePullDiagnosticRun: StartupReplicationRun | null = null;
    const sessionAtStart = databaseSessionKey;
    const isCurrentSession = () =>
      !cancelled && databaseSessionRef.current === sessionAtStart;
    const setupBibleDb = async () => {
      const setupStartedAt = performance.now();
      recordStartupDiagnostic("bible", "database-setup.started");
      try {
        if (isGuestSession) {
          try {
            await new PouchDB("worship-sync-bibles-guest").destroy();
          } catch {
            // Ignore missing local guest Bible DB.
          }
          if (!isCurrentSession()) return;
          const localDb = new PouchDB("worship-sync-bibles-guest");
          recordLocalDatabaseOpen("bible", localDb);
          setBibleDbProgress(100);
          setBibleDb(localDb);
          setIsBibleDbSetup(true);
          globalBibleDb = localDb;
          recordStartupDiagnostic("bible", "database-setup.ready", {
            durationMs: Math.round(performance.now() - setupStartedAt),
          });
          return;
        }

        const dbName = "worship-sync-bibles";
        const localDb = new PouchDB(dbName);
        recordLocalDatabaseOpen("bible", localDb);
        const remoteUrl = `${import.meta.env.VITE_COUCHDB_HOST}/${dbName}`;
        const remoteDb = new PouchDB(remoteUrl, {
          fetch: (url, options: any) => {
            const opts = options ?? {};
            opts.credentials = "include";
            return fetch(url, opts);
          },
        });
        recordStartupDiagnostic("bible", "remote-client.created");
        if (!isCurrentSession()) return;

        bibleSyncRef.current?.cancel();
        bibleReplicateRef.current?.cancel();
        const progressForThisReplication = createReplicationProgressTracker();
        let pullFailed = false;
        let authRecovery: Promise<void> | null = null;
        const recoverBibleSession = () => {
          if (authRecovery) return authRecovery;
          authRecovery = (async () => {
            let lastFailureKind: NonNullable<CouchSessionResult["failureKind"]> =
              "authentication";
            let lastFailureDiagnostic: string | undefined;
            for (
              let retryCount = 1;
              retryCount <= MAX_REPLICATION_AUTH_RETRIES;
              retryCount += 1
            ) {
              if (!isCurrentSession()) return;
              biblePullDiagnosticRun?.recordRetry();
              recordStartupDiagnostic("bible", "session-recovery.attempt", {
                attempt: retryCount,
              });
              const sessionResult = await getCouchSession(() => false);
              if (!isCurrentSession()) return;
              if (sessionResult.success) {
                setHasCouchSession(true);
                setBiblePullRestartVersion((current) => current + 1);
                return;
              }
              lastFailureKind =
                sessionResult.failureKind ?? "server-connection";
              lastFailureDiagnostic = sessionResult.diagnostic;
              if (retryCount < MAX_REPLICATION_AUTH_RETRIES) {
                await backoff(retryCount, 5000, 30000);
              }
            }
            if (!isCurrentSession()) return;
            const message = lastFailureKind === "authentication"
              ? "WorshipSync couldn't verify its database session for Bible sync after automatic retries. Reload WorshipSync to try again. If this continues, contact support."
              : "WorshipSync couldn't reconnect to the server for Bible sync. Check your connection, then reload WorshipSync.";
            setBibleStartupFailure(sessionAtStart, {
              kind: lastFailureKind,
              message,
              diagnostic: lastFailureDiagnostic ?? (
                lastFailureKind === "authentication"
                  ? "The server rejected the renewed session"
                  : "Server connection attempts were exhausted"
              ),
            });
          })().finally(() => {
            authRecovery = null;
          });
          return authRecovery;
        };

        const replicationOptions = resolveStartupReplicationOptions(
          startupDiagnosticMode,
          "bible",
        );
        biblePullDiagnosticRun = beginStartupReplication("bible", {
          batchSize: replicationOptions.batch_size,
          batchesLimit: replicationOptions.batches_limit,
        });
        bibleReplicateRef.current = remoteDb.replicate
          .to(localDb, { retry: true, ...replicationOptions })
          .on("change", (info) => {
            if (!isCurrentSession()) return;
            const change = info as { pending?: unknown; docs?: unknown[] };
            biblePullDiagnosticRun?.recordBatch(change.docs?.length ?? 0);
            const progress = progressForThisReplication(change.pending);
            if (progress === null) return;
            setBibleDbProgress((current) =>
              isCurrentSession() && current !== progress ? progress : current,
            );
          })
          .on("active", () => {
            recordStartupDiagnostic("bible", "replication.active");
          })
          .on("paused", (error?: unknown) => {
            if (!isCurrentSession()) return;
            if (error) {
              const status = (error as { status?: number })?.status;
              biblePullDiagnosticRun?.recordRetry(status);
              if (status === 401 || status === 403) {
                void recoverBibleSession();
              }
            }
          })
          .on("error", async (error: any) => {
            biblePullDiagnosticRun?.finish("error");
            if (!isCurrentSession()) return;
            pullFailed = true;
            console.error("Bible replication error:", sanitizeStartupDiagnostic(error));
            if (error.status === 401 || error.status === 403) {
              await recoverBibleSession();
              return;
            }
            setBibleStartupFailure(sessionAtStart, {
              kind: "replication",
              message: "Bible synchronization couldn't finish. Check your connection, then reload WorshipSync to try again.",
              diagnostic: sanitizeStartupDiagnostic(error),
            });
          })
          .on("complete", (result: { status?: string; ok?: boolean; errors?: unknown[] }) => {
            biblePullDiagnosticRun?.finish(
              result?.status === "cancelled" ? "cancelled" : "complete",
            );
            if (!isCurrentSession() || pullFailed) return;
            if (
              result?.status === "cancelled" ||
              result?.ok === false ||
              result?.errors?.length
            ) {
              setBibleStartupFailure(sessionAtStart, {
                kind: "replication",
                message: "Bible synchronization ended before it was complete. Check your connection, then reload WorshipSync to try again.",
                diagnostic: sanitizeStartupDiagnostic(result?.errors?.[0] ?? result),
              });
              return;
            }
            setBibleDbProgress(100);
            setBibleDb(localDb);
            setIsBibleDbSetup(true);
            globalBibleDb = localDb;
            recordStartupDiagnostic("bible", "database-setup.ready", {
              durationMs: Math.round(performance.now() - setupStartedAt),
            });
            if (isAuthenticatedSession) {
              bibleSyncDb(localDb, remoteDb);
            }
          });
      } catch (error) {
        if (!isCurrentSession()) return;
        console.error("Error preparing Bible database:", sanitizeStartupDiagnostic(error));
        setBibleStartupFailure(sessionAtStart, {
          kind: "local-storage",
          message: "WorshipSync couldn't prepare the local Bible database. Check that browser storage is available, then reload WorshipSync.",
          diagnostic: sanitizeStartupDiagnostic(error),
        });
      }
    };

    if (
      shouldInitializeBibleDatabase &&
      !isBibleDbSetup &&
      (!shouldInitializeContentDatabase || isDbSetup) &&
      canStartBiblePull &&
      hasCouchSession
    ) {
      setupBibleDb();
    }
    return () => {
      cancelled = true;
      biblePullDiagnosticRun?.finish("cancelled");
      bibleReplicateRef.current?.cancel();
    };
  }, [
    shouldInitializeBibleDatabase,
    shouldInitializeContentDatabase,
    canStartBiblePull,
    isBibleDbSetup,
    isDbSetup,
    hasCouchSession,
    bibleSyncDb,
    getCouchSession,
    startupDiagnosticMode,
    isAuthenticatedSession,
    isGuestSession,
    databaseSessionKey,
    biblePullRestartVersion,
    setBibleStartupFailure,
  ]);

  const tearDownLocalDatabases = useCallback(async () => {
    const mainDb = db;
    const bibleDbInstance = bibleDb;
    const contentOwnerAtTeardown = getActiveContentDatabaseOwner();
    const contentDatabaseAtTeardown = contentOwnerAtTeardown
      ? getContentDatabaseForOwner(contentOwnerAtTeardown)
      : mainDb;
    cancelSongV2CleanupMaintenance(mainDb);
    if (contentDbRef.current === mainDb) contentDbRef.current = undefined;
    // Invalidate auth-recovery continuations before cancelling handles or
    // destroying the database owned by the previous church.
    syncGenerationRef.current += 1;
    if (syncTimeout) {
      clearTimeout(syncTimeout);
      syncTimeout = null;
    }
    contentLiveSyncDiagnosticRunRef.current?.finish("cancelled");
    contentLiveSyncDiagnosticRunRef.current = null;
    await syncRef.current?.cancel();
    await bibleSyncRef.current?.cancel();
    await replicateRef.current?.cancel();
    await bibleReplicateRef.current?.cancel();
    manualContentPullRef.current?.cancel();
    contentSyncActivityRef.current?.release();
    contentSyncActivityRef.current = null;
    initialContentReplicationActivityRef.current?.release();
    initialContentReplicationActivityRef.current = null;
    manualContentPullActivityRef.current?.release();
    manualContentPullActivityRef.current = null;
    manualContentPullRef.current = null;
    remoteDbRef.current = null;
    if (contentOwnerAtTeardown && contentDatabaseAtTeardown) {
      await flushContentDatabaseBeforeTeardown(
        contentOwnerAtTeardown,
        contentDatabaseAtTeardown,
      );
    }
    setGlobalContentDatabase(undefined);
    globalBibleDb = undefined;
    setDb(undefined);
    setDbProgress(null);
    setBibleDb(undefined);
    setBibleDbProgress(null);
    setReplicationPhaseState({
      sessionKey: databaseSessionRef.current,
      phase: "waiting",
    });
    dispatch({ type: "RESET_INITIALIZATION" });

    if (mainDb) {
      await mainDb.destroy().catch((e) => {
        console.error(e);
      });
    }
    if (bibleDbInstance) {
      await bibleDbInstance.destroy().catch((e) => {
        console.error(e);
      });
    }
    setIsDbSetup(false);
    setIsBibleDbSetup(false);
  }, [db, bibleDb, dispatch]);

  useEffect(() => {
    const prev = prevLocalDbIdentityRef.current;
    if (prev === localDbIdentity) {
      return;
    }
    if (prev !== null) {
      syncBatchSizeRef.current = 40;
      syncRetryRef.current = 0;
    }

    if (prev === null && localDbIdentity !== null) {
      prevLocalDbIdentityRef.current = localDbIdentity;
      return;
    }

    const needsTeardown =
      (prev !== null &&
        localDbIdentity !== null &&
        prev !== localDbIdentity) ||
      (prev !== null && localDbIdentity === null);

    if (needsTeardown) {
      void tearDownLocalDatabases();
    }

    prevLocalDbIdentityRef.current = localDbIdentity;
  }, [localDbIdentity, tearDownLocalDatabases]);

  const _logout = useCallback(async () => {
    setLoginState?.("loading");
    await tearDownLocalDatabases();
    await logout?.();
  }, [logout, setLoginState, tearDownLocalDatabases]);

  const _login = useCallback(
    async ({
      email,
      password,
    }: {
      email: string;
      password: string;
    }) => {
      await login?.({ method: "password", email, password });
    },
    [login]
  );

  useEffect(() => {
    return () => {
      // Auth recovery may still be awaiting session renewal or backoff.
      // Prevent its continuation from reconnecting after provider unmount.
      cancelSongV2CleanupMaintenance(contentDbRef.current);
      syncGenerationRef.current += 1;
      if (syncTimeout) {
        clearTimeout(syncTimeout);
        syncTimeout = null;
      }
      contentLiveSyncDiagnosticRunRef.current?.finish("cancelled");
      contentLiveSyncDiagnosticRunRef.current = null;
      syncRef.current?.cancel();
      contentSyncActivityRef.current?.release();
      contentSyncActivityRef.current = null;
      initialContentReplicationActivityRef.current?.release();
      initialContentReplicationActivityRef.current = null;
      bibleSyncRef.current?.cancel();
      replicateRef.current?.cancel();
      bibleReplicateRef.current?.cancel();
      manualContentPullRef.current?.cancel();
      remoteDbRef.current = null;
      manualContentPullActivityRef.current?.release();
      manualContentPullActivityRef.current = null;
      manualContentPullRef.current = null;
    };
  }, []);

  const value = useMemo(
    () => ({
      db: dbSessionRef.current === databaseSessionKey ? db : undefined,
      bootstrapReady,
      canCreateBootstrapDocuments,
      cloud,
      updater: updater.current,
      isGuestSession,
      bibleDb,
      bibleDbProgress: currentBibleDbProgress,
      bibleStartupFailure: activeBibleStartupFailure,
      logout: _logout,
      isMobile,
      setIsMobile,
      isPhone,
      setIsPhone,
      dbProgress: currentDbProgress,
      connectionStatus,
      startupInfo,
      subscribeToStartupActivity,
      login: _login,
      pullFromRemote,
    }),
    [
      db,
      databaseSessionKey,
      bootstrapReady,
      canCreateBootstrapDocuments,
      bibleDb,
      currentBibleDbProgress,
      activeBibleStartupFailure,
      currentDbProgress,
      isGuestSession,
      isMobile,
      isPhone,
      connectionStatus,
      startupInfo,
      subscribeToStartupActivity,
      _logout,
      _login,
      pullFromRemote,
    ]
  );

  return (
    <ControllerInfoContext.Provider value={value}>
      {children}
    </ControllerInfoContext.Provider>
  );
};

export default ControllerInfoProvider;
