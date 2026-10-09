import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import PouchDB from "pouchdb-browser";
import { Cloudinary } from "@cloudinary/url-gen";
import { GlobalInfoContext } from "./globalInfo";
import { useLocation } from "react-router-dom";
import { useDispatch } from "../hooks";
import { backoff } from "../utils/generalUtils";
import { getApiBasePath } from "../utils/environment";
import { MAX_INITIAL_SESSION_RETRIES, MAX_REPLICATION_AUTH_RETRIES } from "../constants";
import { seedOfflineGuestDatabase } from "../utils/offlineGuestSeed";

export type ConnectionStatus = {
  status: "connecting" | "retrying" | "failed" | "connected";
  retryCount: number;
  failureReason?: "push-too-large" | "replication";
  message?: string;
};

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
  bibleDb: PouchDB.Database | undefined;
  cloud: Cloudinary;
  updater: EventTarget;
  /** True while `loginState === "guest"` (local demo DB; no remote sync). */
  isGuestSession: boolean;
  isMobile: boolean;
  isPhone: boolean;
  dbProgress: number;
  bibleDbProgress: number;
  connectionStatus: ConnectionStatus;
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

type CleanupMaintenanceState = {
  lastStartedAt: number;
  running?: Promise<void>;
  timer?: ReturnType<typeof setTimeout>;
  consecutiveFailures: number;
  rerunRequested: boolean;
};
const cleanupMaintenanceRuns = new WeakMap<PouchDB.Database, CleanupMaintenanceState>();
const scheduleSongV2CleanupMaintenance = (db: PouchDB.Database, force = false) => {
  const state = cleanupMaintenanceRuns.get(db) ?? {
    lastStartedAt: 0,
    consecutiveFailures: 0,
    rerunRequested: false,
  };
  cleanupMaintenanceRuns.set(db, state);

  const scheduleAfter = (delay: number) => {
    if (state.timer) return;
    state.timer = setTimeout(() => {
      state.timer = undefined;
      scheduleSongV2CleanupMaintenance(db, true);
    }, delay);
  };
  const retryDelay = () => Math.min(30_000 * 2 ** Math.min(state.consecutiveFailures - 1, 4), 300_000);

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
  state.running = import("../utils/songV2Writer")
    .then(({ reconcilePendingSongV2Cleanup }) => reconcilePendingSongV2Cleanup(db, 20))
    .then((result) => {
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
      state.consecutiveFailures += 1;
      console.error("Could not run song cleanup maintenance:", error);
      scheduleAfter(retryDelay());
    })
    .finally(() => {
      state.running = undefined;
      if (state.rerunRequested) {
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
    cloudName: "portable-media",
    apiKey: import.meta.env.VITE_CLOUDINARY_KEY,
    apiSecret: import.meta.env.VITE_CLOUDINARY_SECRET,
  },
});

let pendingMax = 0;

let syncTimeout: NodeJS.Timeout | null = null;

const ControllerInfoProvider = ({ children }: any) => {
  const [db, setDb] = useState<PouchDB.Database | undefined>(undefined);
  const [bibleDb, setBibleDb] = useState<PouchDB.Database | undefined>(
    undefined
  );
  const [dbProgress, setDbProgress] = useState(0);
  const [bibleDbProgress, setBibleDbProgress] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const [isPhone, setIsPhone] = useState(false);
  const [isDbSetup, setIsDbSetup] = useState(false);
  const [isBibleDbSetup, setIsBibleDbSetup] = useState(false);
  const [hasCouchSession, setHasCouchSession] = useState(false);
  const [hasCheckedSession, setHasCheckedSession] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
    status: "connecting",
    retryCount: 0,
  });

  const location = useLocation();
  const dispatch = useDispatch();

  const { database, loginState, logout, setLoginState, login } =
    useContext(GlobalInfoContext) || {};

  const isAuthenticatedSession = loginState === "success";
  const isGuestSession = loginState === "guest";
  const isLoginAuthSurface =
    location.pathname === "/login" ||
    location.pathname.startsWith("/login/");
  const shouldInitializeControllerData =
    (isAuthenticatedSession || isGuestSession) &&
    location.pathname !== "/" &&
    !isLoginAuthSurface;
  const activeDatabaseKey = (database || DEMO_DATABASE_KEY).toLowerCase();
  const broadcastDatabaseKey = isGuestSession
    ? `${DEMO_DATABASE_KEY}-guest`
    : activeDatabaseKey;
  const activeDatabaseKeyRef = useRef(activeDatabaseKey);
  activeDatabaseKeyRef.current = activeDatabaseKey;

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
      setLocalDbIdentity(GUEST_DATABASE_NAME);
    } else if (loginState === "success") {
      setLocalDbIdentity(`worship-sync-${activeDatabaseKey}`);
    } else if (loginState === "loading" || loginState === "error") {
      // keep prior identity during sign-in attempts and recoverable errors
    } else {
      setLocalDbIdentity(null);
    }
  }, [loginState, activeDatabaseKey]);

  const updater = useRef(new EventTarget());
  const syncRef = useRef<any>(null);
  const syncGenerationRef = useRef(0);
  const syncBatchSizeRef = useRef(40);
  const remoteDbRef = useRef<PouchDB.Database | null>(null);
  const syncRetryRef = useRef(0);
  const replicateRetryRef = useRef(0);
  const replicateRef = useRef<any>(null);
  const bibleSyncRef = useRef<any>(null);
  const bibleSyncRetryRef = useRef(0);
  const bibleReplicateRetryRef = useRef(0);
  const bibleReplicateRef = useRef<any>(null);
  const initialSessionRetryRef = useRef(0);
  const prevLocalDbIdentityRef = useRef<string | null>(null);

  const getCouchSession = useCallback(async (canCommit: () => boolean = () => true) => {
    const controller = new AbortController();
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
        return false;
      }

      const data = await response.json();
      if (canCommit()) setHasCouchSession(data.success);
      return data.success;
    } catch (error: any) {
      clearTimeout(timeoutId);
      // Network error (server down, no internet, timeout)
      if (error.name === "AbortError" || error.name === "TypeError") {
        console.error("getCouchSession: Network error or timeout:", error);
      } else {
        console.error("getCouchSession: Error fetching session:", error);
      }
      return false;
    }
  }, []);

  const syncDb = useCallback(
    (localDb: PouchDB.Database, remoteDb: PouchDB.Database, churchKey: string) => {
      syncRef.current?.cancel();
      syncRef.current = null;
      const generation = ++syncGenerationRef.current;
      let authRecovery: Promise<void> | null = null;

      const startLiveSync = () => {
        if (
          generation !== syncGenerationRef.current ||
          activeDatabaseKeyRef.current !== churchKey
        ) return;
        const liveSync = localDb.sync(remoteDb, {
          retry: true,
          live: true,
          selector: { _id: { $ne: "media" } },
          batch_size: syncBatchSizeRef.current,
          batches_limit: 5,
        });
        syncRef.current = liveSync;
        liveSync
          .on("change", (event) => {
            if (event.direction === "pull") {
              updater.current.dispatchEvent(
                new CustomEvent("update", { detail: event.change.docs })
              );
              if ((event.change.docs as Array<{ docType?: string }> | undefined)
                ?.some((doc) => doc.docType === "song-v2-cleanup")) {
                scheduleSongV2CleanupMaintenance(localDb);
              }
            }
          })
          .on("active", () => {
            if (syncRef.current === liveSync) {
              setConnectionStatus({ status: "connected", retryCount: syncRetryRef.current });
            }
          })
          .on("paused", (error?: unknown) => {
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
            void handleSyncError(error, liveSync);
          })
          .on("error", (error: any) => {
            void handleSyncError(error, liveSync);
          });
      };

      const handleSyncError = async (error: any, failedSync: any) => {
        if (syncRef.current !== failedSync) return;
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
            const success = await getCouchSession(() =>
              generation === syncGenerationRef.current &&
              activeDatabaseKeyRef.current === churchKey,
            );
            if (
              generation !== syncGenerationRef.current ||
              activeDatabaseKeyRef.current !== churchKey
            ) return;
            if (syncRef.current !== null) return;
            if (!success) {
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
    remote
      .replicate.to(db, { retry: false, selector: { _id: { $ne: "media" } } })
      .on("change", (info: any) => {
        if (info.docs?.length) {
          updater.current.dispatchEvent(
            new CustomEvent("update", { detail: info.docs })
          );
        }
      });
  }, [db, isAuthenticatedSession]);

  const bibleSyncDb = useCallback(
    async (localDb: PouchDB.Database, remoteDb: PouchDB.Database) => {
      bibleSyncRef.current?.cancel();

      bibleSyncRef.current = localDb
        .changes({ since: "now", live: true })
        .on("change", () => {
          if (syncTimeout) clearTimeout(syncTimeout);
          syncTimeout = setTimeout(() => {
            localDb.sync(remoteDb, { retry: true });
          }, 10000); // Wait 10 second after last change
        })
        .on("error", async (error: any) => {
          if (error.status === 401 || error.status === 403) {
            setConnectionStatus({ status: "retrying", retryCount: bibleSyncRetryRef.current + 1 });
            setHasCouchSession(false);
            const success = await getCouchSession();
            if (!success) {
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
    [getCouchSession]
  );

  useEffect(() => {
    const attemptSession = async () => {
      if (isGuestSession && shouldInitializeControllerData) {
        if (
          !hasCheckedSession ||
          !hasCouchSession ||
          connectionStatus.status !== "connected"
        ) {
          initialSessionRetryRef.current = 0;
          setHasCouchSession(true);
          setConnectionStatus({ status: "connected", retryCount: 0 });
          setHasCheckedSession(true);
        }
        return;
      }

      if (shouldInitializeControllerData && !hasCheckedSession && !isGuestSession) {
        setConnectionStatus({ status: "connecting", retryCount: 0 });
        const success = await getCouchSession();

        if (!success) {
          initialSessionRetryRef.current++;

          if (initialSessionRetryRef.current <= MAX_INITIAL_SESSION_RETRIES) {
            setConnectionStatus({
              status: "retrying",
              retryCount: initialSessionRetryRef.current,
            });
            // Start at 5 seconds (base=5000ms), grow exponentially, cap at 30 seconds
            await backoff(initialSessionRetryRef.current, 5000, 30000);
            attemptSession();
          } else {
            console.error(
              `Failed to establish session after ${MAX_INITIAL_SESSION_RETRIES} attempts. Server may be down.`
            );
            setConnectionStatus({
              status: "failed",
              retryCount: MAX_INITIAL_SESSION_RETRIES,
            });
            setHasCheckedSession(true);
          }
        } else {
          // Success! Reset retry counter and mark as checked
          initialSessionRetryRef.current = 0;
          setConnectionStatus({ status: "connected", retryCount: 0 });
          setHasCheckedSession(true);
        }
      }
    };

    attemptSession();
  }, [
    connectionStatus.status,
    getCouchSession,
    hasCheckedSession,
    hasCouchSession,
    isGuestSession,
    shouldInitializeControllerData,
  ]);

  // Reset retry counter when login state or database changes
  useEffect(() => {
    if (isGuestSession) return;
    initialSessionRetryRef.current = 0;
    setHasCheckedSession(false);
    setHasCouchSession(false);
    setConnectionStatus({ status: "connecting", retryCount: 0 });
  }, [loginState, activeDatabaseKey, isGuestSession]);

  useEffect(() => {
    const setupDb = async () => {
      try {
        const dbName = isGuestSession
          ? GUEST_DATABASE_NAME
          : `worship-sync-${activeDatabaseKey}`;

        if (isGuestSession) {
          setDbProgress(0);
          try {
            await new PouchDB(GUEST_DATABASE_NAME).destroy();
          } catch (error) {
            // Ignore "missing database" and continue with a fresh setup.
          }

          const localDb = new PouchDB(dbName);
          await seedOfflineGuestDatabase(localDb);
          setDbProgress(100);
          setDb(localDb);
          setIsDbSetup(true);
          globalDb = localDb;
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
        } catch (dbError: any) {
          console.error("Error creating local PouchDB:", dbError);
          // If IndexedDB fails, try to handle it gracefully
          if (dbError.name === "IndexedDBError" || dbError.message?.includes("IndexedDB")) {
            console.error("IndexedDB error detected. This may be due to browser storage issues.");
            // Try to clear and retry once
            try {
              // Wait a bit and retry
              await new Promise(resolve => setTimeout(resolve, 1000));
              localDb = new PouchDB(dbName);
            } catch (retryError) {
              console.error("Failed to create PouchDB after retry:", retryError);
              // Set error state or show user notification
              setDbProgress(0);
              return;
            }
          } else {
            throw dbError;
          }
        }

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
          remoteDbRef.current = remoteDb;
        } catch (remoteError) {
          console.error("Error creating remote PouchDB:", remoteError);
          setDbProgress(0);
          return;
        }

        syncRef.current?.cancel();
        replicateRef.current?.cancel();
        pendingMax = 0;

        replicateRef.current = remoteDb.replicate
          .to(localDb, {
            retry: true,
            batch_size: 150,
            batches_limit: 15,
            selector: { _id: { $ne: "media" } },
          })
          .on("change", (info) => {
            const pending: number = (info as any).pending; // this property exists when printing info
            pendingMax = pendingMax < pending ? pending : pendingMax;
            if (pendingMax > 0) {
              setDbProgress(Math.floor((1 - pending / pendingMax) * 100));
            } else {
              setDbProgress(100);
            }
          })
          .on("error", async (error: any) => {
            console.error("Replication error:", error);
            if (error.status === 401 || error.status === 403) {
              setHasCouchSession(false);
              replicateRef.current?.cancel();

              replicateRetryRef.current++;
              if (replicateRetryRef.current > MAX_REPLICATION_AUTH_RETRIES) {
                setConnectionStatus({
                  status: "failed",
                  retryCount: replicateRetryRef.current,
                });
                return;
              }

              setConnectionStatus({
                status: "retrying",
                retryCount: replicateRetryRef.current,
              });
              const success = await getCouchSession();
              if (!success) {
                setConnectionStatus({
                  status: "failed",
                  retryCount: replicateRetryRef.current,
                });
                return;
              }
              // Do not reset replicateRetryRef here; allow cap to stop the loop
            }
          })
          .on("complete", () => {
            setDbProgress(100);
            setDb(localDb);
            setIsDbSetup(true);
            globalDb = localDb;
            scheduleSongV2CleanupMaintenance(localDb, true);
            if (broadcastDatabaseKey) {
              updateGlobalBroadcast(broadcastDatabaseKey);
            }
            if (isAuthenticatedSession) {
              syncDb(localDb, remoteDb, activeDatabaseKey);
            }
          });
      } catch (error) {
        console.error("Error in setupDb:", error);
        setDbProgress(0);
        // Don't set isDbSetup to true on error, so it can retry
      }
    };

    if (
      shouldInitializeControllerData &&
      !isDbSetup &&
      hasCouchSession
    ) {
      setupDb();
    }
  }, [
    shouldInitializeControllerData,
    activeDatabaseKey,
    broadcastDatabaseKey,
    isAuthenticatedSession,
    isGuestSession,
    isDbSetup,
    hasCouchSession,
    syncDb,
    getCouchSession,
  ]);

  useEffect(() => {
    const setupBibleDb = async () => {
      if (isGuestSession) {
        try {
          await new PouchDB("worship-sync-bibles-guest").destroy();
        } catch {
          // Ignore missing local guest Bible DB.
        }
        const localDb = new PouchDB("worship-sync-bibles-guest");
        setBibleDbProgress(100);
        setBibleDb(localDb);
        setIsBibleDbSetup(true);
        globalBibleDb = localDb;
        return;
      }

      const dbName = "worship-sync-bibles";
      const localDb = new PouchDB(dbName);
      const remoteUrl = `${import.meta.env.VITE_COUCHDB_HOST}/${dbName}`;
      const remoteDb = new PouchDB(remoteUrl, {
        fetch: (url, options: any) => {
          options.credentials = "include";
          return fetch(url, options);
        },
      });

      bibleSyncRef.current?.cancel();
      bibleReplicateRef.current?.cancel();
      pendingMax = 0;

      bibleReplicateRef.current = remoteDb.replicate
        .to(localDb, { retry: true, batch_size: 1000, batches_limit: 25 })
        .on("change", (info) => {
          const pending: number = (info as any).pending; // this property exists when printing info
          pendingMax = pendingMax < pending ? pending : pendingMax;
          if (pendingMax > 0) {
            setBibleDbProgress(Math.floor((1 - pending / pendingMax) * 100));
          } else {
            setBibleDbProgress(100);
          }
        })
        .on("error", async (error: any) => {
          if (error.status === 401 || error.status === 403) {
            setHasCouchSession(false);
            bibleReplicateRef.current?.cancel();

            bibleReplicateRetryRef.current++;
            if (bibleReplicateRetryRef.current > MAX_REPLICATION_AUTH_RETRIES) {
              setConnectionStatus({
                status: "failed",
                retryCount: bibleReplicateRetryRef.current,
              });
              return;
            }

            setConnectionStatus({
              status: "retrying",
              retryCount: bibleReplicateRetryRef.current,
            });
            const success = await getCouchSession();
            if (!success) {
              setConnectionStatus({
                status: "failed",
                retryCount: bibleReplicateRetryRef.current,
              });
              return;
            }
            // Do not reset bibleReplicateRetryRef here; allow cap to stop the loop
          }
        })
        .on("complete", () => {
          setBibleDbProgress(100);
          setBibleDb(localDb);
          setIsBibleDbSetup(true);
          globalBibleDb = localDb;
          if (isAuthenticatedSession) {
            bibleSyncDb(localDb, remoteDb);
          }
        });
    };

    if (
      shouldInitializeControllerData &&
      !isBibleDbSetup &&
      isDbSetup &&
      hasCouchSession
    ) {
      setupBibleDb();
    }
  }, [
    shouldInitializeControllerData,
    isBibleDbSetup,
    isDbSetup,
    hasCouchSession,
    bibleSyncDb,
    getCouchSession,
    isAuthenticatedSession,
    isGuestSession,
  ]);

  const tearDownLocalDatabases = useCallback(async () => {
    // Invalidate auth-recovery continuations before cancelling handles or
    // destroying the database owned by the previous church.
    syncGenerationRef.current += 1;
    if (syncTimeout) {
      clearTimeout(syncTimeout);
      syncTimeout = null;
    }
    await syncRef.current?.cancel();
    await bibleSyncRef.current?.cancel();
    await replicateRef.current?.cancel();
    await bibleReplicateRef.current?.cancel();
    remoteDbRef.current = null;
    globalDb = undefined;
    globalBibleDb = undefined;
    const mainDb = db;
    const bibleDbInstance = bibleDb;
    setDb(undefined);
    setDbProgress(0);
    setIsDbSetup(false);
    setBibleDb(undefined);
    setBibleDbProgress(0);
    setIsBibleDbSetup(false);
    pendingMax = 0;
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
      syncGenerationRef.current += 1;
      if (syncTimeout) {
        clearTimeout(syncTimeout);
        syncTimeout = null;
      }
      syncRef.current?.cancel();
      bibleSyncRef.current?.cancel();
      replicateRef.current?.cancel();
      bibleReplicateRef.current?.cancel();
      remoteDbRef.current = null;
    };
  }, []);

  const value = useMemo(
    () => ({
      db,
      cloud,
      updater: updater.current,
      isGuestSession,
      bibleDb,
      bibleDbProgress,
      logout: _logout,
      isMobile,
      setIsMobile,
      isPhone,
      setIsPhone,
      dbProgress,
      connectionStatus,
      login: _login,
      pullFromRemote,
    }),
    [
      db,
      bibleDb,
      bibleDbProgress,
      dbProgress,
      isGuestSession,
      isMobile,
      isPhone,
      connectionStatus,
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
