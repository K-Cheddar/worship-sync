import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type PouchDB from "pouchdb-browser";
import type { DBItem } from "@worshipsync/types";
import { getDemoSession, signInToDemo, signOutOfDemo, verifyDemoEmailCode, type DemoAuthBootstrap } from "./auth";
import {
  BOARD_LOCAL_DB,
  CONTENT_LOCAL_DB,
  getRuntime,
  inspectNativeDatabase,
  openNativeDatabase,
  type NativeDbInfo,
  type NativeDbRole,
} from "./db/nativePouch";
import {
  BOARD_REMOTE_DB,
  CONTENT_REMOTE_DB,
  DEFAULT_REMOTE_CONFIG,
  DEMO_TENANT,
  MOBILE_TEST_DOCUMENT_PREFIX,
  assertSafeOutboundTestIds,
  createRemoteDatabase,
  establishCouchSession,
  outboundTestReplicationOptions,
  readOnlyReplicationOptions,
  type RemoteConfig,
} from "./db/remote";
import {
  createServicePlanReference,
  hydrateSongFromLocalDatabase,
  readFirstDemoBoard,
  readSongLibrary,
  searchSongLibrary,
  type SongLibrarySnapshot,
} from "./db/library";
import {
  assertRegisteredTestDocument,
  createRemoteTestDocument,
  deleteRemoteTestDocumentLocally,
  inspectRemoteTestDocumentConflicts,
  isRegisteredDeletedTestDocument,
  LOCAL_PERSISTENCE_TEST_ID,
  reviseRemoteTestDocument,
  saveLocalPersistenceSample,
} from "./db/testDocuments";

type SyncState = {
  status: "idle" | "connecting" | "syncing" | "live" | "retrying" | "failed";
  docsRead: number;
  docsWritten: number;
  pending: number | null;
  retryCount: number;
  startedAt?: number;
  lastSuccessfulAt?: string;
  initialDurationMs?: number;
  error?: string;
};

type ReplicationHandle = PouchDB.Replication.Replication<{}>;

const idleSync = (): SyncState => ({
  status: "idle",
  docsRead: 0,
  docsWritten: 0,
  pending: null,
  retryCount: 0,
});

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
};

const formatDate = (value?: string) => value ? new Date(value).toLocaleString() : "Never";

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

const newRemoteTestText = () => "Mobile edit created for the explicitly scoped CouchDB test.";

const App = () => {
  const runtime = useMemo(() => getRuntime(), []);
  const [remoteConfig, setRemoteConfig] = useState<RemoteConfig>(() => {
    const saved = localStorage.getItem("worshipsync-mobile-poc-remote-config");
    if (!saved) return DEFAULT_REMOTE_CONFIG;
    try { return { ...DEFAULT_REMOTE_CONFIG, ...JSON.parse(saved) as Partial<RemoteConfig> }; }
    catch { return DEFAULT_REMOTE_CONFIG; }
  });
  const [authSession, setAuthSession] = useState<DemoAuthBootstrap | null>(null);
  const [authStatus, setAuthStatus] = useState<"checking" | "signed-out" | "signed-in" | "failed">("checking");
  const [authError, setAuthError] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [pendingEmailCode, setPendingEmailCode] = useState<{ id: string; email: string } | null>(null);
  const [emailCode, setEmailCode] = useState("");
  const [configDraft, setConfigDraft] = useState(remoteConfig);
  const [dbs, setDbs] = useState<Partial<Record<NativeDbRole, PouchDB.Database>>>({});
  const [dbInfo, setDbInfo] = useState<Partial<Record<NativeDbRole, NativeDbInfo>>>({});
  const [initialization, setInitialization] = useState<"checking" | "ready" | "failed">("checking");
  const [initializationMs, setInitializationMs] = useState<number | null>(null);
  const [initializationError, setInitializationError] = useState("");
  const [sync, setSync] = useState<Record<NativeDbRole, SyncState>>({ content: idleSync(), boards: idleSync() });
  const [globalError, setGlobalError] = useState("");
  const [songLibrary, setSongLibrary] = useState<SongLibrarySnapshot | null>(null);
  const [songSearch, setSongSearch] = useState("");
  const [selectedSong, setSelectedSong] = useState<Record<string, unknown> | null>(null);
  const [boardSummary, setBoardSummary] = useState<{ boardId: string | null; posts: unknown[] } | null>(null);
  const [localDoc, setLocalDoc] = useState<Record<string, unknown> | null>(null);
  const [testDocId, setTestDocId] = useState("");
  const [testDocSummary, setTestDocSummary] = useState<Record<string, unknown> | null>(null);
  const [authorizeRemoteWrites, setAuthorizeRemoteWrites] = useState(false);
  const [storageBackendsVerified, setStorageBackendsVerified] = useState(false);
  const [lastAction, setLastAction] = useState("Waiting for native SQLite.");
  const [searchDurationMs, setSearchDurationMs] = useState<number | null>(null);
  const replications = useRef(new Map<NativeDbRole, ReplicationHandle>());
  const remoteDatabases = useRef(new Map<NativeDbRole, PouchDB.Database>());
  const authRecovery = useRef(new Set<NativeDbRole>());
  const authRetryCounts = useRef<Record<NativeDbRole, number>>({ content: 0, boards: 0 });
  const initializationPromise = useRef<Promise<void> | null>(null);
  const mounted = useRef(false);

  const setSyncFor = useCallback((role: NativeDbRole, update: Partial<SyncState> | ((current: SyncState) => SyncState)) => {
    setSync((current) => ({
      ...current,
      [role]: typeof update === "function" ? update(current[role]) : { ...current[role], ...update },
    }));
  }, []);

  const refreshDatabaseInfo = useCallback(async (role: NativeDbRole) => {
    const info = await inspectNativeDatabase(role);
    setDbInfo((current) => ({ ...current, [role]: info }));
    return info;
  }, []);

  const initialize = useCallback(() => {
    if (initializationPromise.current) return initializationPromise.current;
    const task = (async () => {
      setInitialization("checking");
      setInitializationError("");
      const started = performance.now();
      try {
        const [contentDb, boardDb] = await Promise.all([
          openNativeDatabase("content"),
          openNativeDatabase("boards"),
        ]);
        const [contentInfo, boardInfo] = await Promise.all([
          inspectNativeDatabase("content"),
          inspectNativeDatabase("boards"),
        ]);
        if (!mounted.current) return;
        setDbs({ content: contentDb, boards: boardDb });
        setDbInfo({ content: contentInfo, boards: boardInfo });
        setStorageBackendsVerified(true);
        setInitializationMs(performance.now() - started);
        setInitialization("ready");
        setLastAction("Both local PouchDB databases opened on verified native SQLite.");
      } catch (error) {
        if (!mounted.current) return;
        setInitialization("failed");
        setStorageBackendsVerified(false);
        setInitializationError(errorMessage(error));
        setGlobalError(errorMessage(error));
      }
    })();
    initializationPromise.current = task;
    void task.finally(() => {
      if (initializationPromise.current === task) initializationPromise.current = null;
    });
    return task;
  }, []);

  useEffect(() => {
    mounted.current = true;
    void initialize();
    return () => {
      mounted.current = false;
      for (const replication of replications.current.values()) replication.cancel();
      replications.current.clear();
      for (const remote of remoteDatabases.current.values()) void remote.close().catch(() => undefined);
      remoteDatabases.current.clear();
    };
  }, [initialize]);

  useEffect(() => {
    let active = true;
    setAuthStatus("checking");
    setAuthError("");
    if (!remoteConfig.apiBaseUrl.trim()) {
      setAuthStatus("signed-out");
      return () => { active = false; };
    }
    void getDemoSession(remoteConfig.apiBaseUrl).then((session) => {
      if (!active) return;
      setAuthSession(session);
      setAuthStatus(session ? "signed-in" : "signed-out");
    }).catch((error) => {
      if (!active) return;
      setAuthSession(null);
      setAuthStatus("signed-out");
      setAuthError(errorMessage(error));
    });
    return () => { active = false; };
  }, [remoteConfig.apiBaseUrl]);

  useEffect(() => () => {
    for (const replication of replications.current.values()) replication.cancel();
    for (const remote of remoteDatabases.current.values()) void remote.close().catch(() => undefined);
  }, []);

  const saveConfig = () => {
    setRemoteConfig(configDraft);
    localStorage.setItem("worshipsync-mobile-poc-remote-config", JSON.stringify(configDraft));
    setLastAction("Service origins saved locally. No credentials are stored by this PoC.");
  };

  const signIn = () => run("Sign in to the demo tenant", async () => {
    saveConfig();
    setAuthError("");
    const result = await signInToDemo(configDraft.apiBaseUrl, authEmail, authPassword);
    setAuthPassword("");
    if (result.requiresEmailCode) {
      setPendingEmailCode({ id: result.pendingAuthId, email: result.verificationEmail });
      setAuthStatus("checking");
      return;
    }
    setPendingEmailCode(null);
    setAuthSession(result.bootstrap);
    setAuthStatus("signed-in");
  });

  const verifySignInCode = () => run("Verify demo account sign-in", async () => {
    if (!pendingEmailCode) throw new Error("Start a sign-in first.");
    saveConfig();
    const bootstrap = await verifyDemoEmailCode(configDraft.apiBaseUrl, pendingEmailCode.id, emailCode);
    setPendingEmailCode(null);
    setEmailCode("");
    setAuthSession(bootstrap);
    setAuthStatus("signed-in");
  });

  const signOut = () => run("Sign out of the demo tenant", async () => {
    await signOutOfDemo(remoteConfig.apiBaseUrl, authSession?.csrfToken);
    setAuthSession(null);
    setAuthStatus("signed-out");
    setPendingEmailCode(null);
  });

  const checkDemoSession = () => run("Check demo tenant session", async () => {
    saveConfig();
    setAuthError("");
    const session = await getDemoSession(configDraft.apiBaseUrl);
    setAuthSession(session);
    setAuthStatus(session ? "signed-in" : "signed-out");
  });

  const startReadOnlyReplication = useCallback(async (role: NativeDbRole, recover = false) => {
    const localDb = dbs[role];
    if (!localDb) throw new Error("Native databases are not initialized.");
    if (!remoteConfig.apiBaseUrl.trim() || !remoteConfig.couchDbUrl.trim()) {
      throw new Error("Set the API and CouchDB service origins in Connection setup first.");
    }
    const existing = replications.current.get(role);
    existing?.cancel();
    replications.current.delete(role);
    const remote = remoteDatabases.current.get(role) ?? createRemoteDatabase(role, remoteConfig.couchDbUrl);
    remoteDatabases.current.set(role, remote);

    setSyncFor(role, (current) => ({
      ...current,
      status: recover ? "retrying" : "connecting",
      startedAt: current.startedAt ?? performance.now(),
      error: undefined,
    }));
    await establishCouchSession(remoteConfig.apiBaseUrl);
    const replication = remote.replicate.to(localDb, readOnlyReplicationOptions(role));
    replications.current.set(role, replication);
    let finishedInitialPull = false;

    replication
      .on("change", (event: { docs?: unknown[]; docs_read?: number; docs_written?: number; pending?: number }) => {
        setSyncFor(role, (current) => ({
          ...current,
          status: "syncing",
          docsRead: (current.docsRead ?? 0) + (event.docs_read ?? event.docs?.length ?? 0),
          docsWritten: (current.docsWritten ?? 0) + (event.docs_written ?? event.docs?.length ?? 0),
          pending: typeof event.pending === "number" ? event.pending : current.pending,
          error: undefined,
        }));
      })
      .on("active", () => setSyncFor(role, { status: "syncing", error: undefined }))
      .on("paused", (error?: unknown) => {
        if (error) {
          const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
          setSyncFor(role, { status: status === 401 || status === 403 ? "retrying" : "syncing", error: errorMessage(error) });
          if ((status === 401 || status === 403) && !authRecovery.current.has(role)) {
            authRecovery.current.add(role);
            const retryCount = ++authRetryCounts.current[role];
            const failed = replication;
            void (async () => {
              try {
                if (retryCount > 5) throw new Error("CouchDB session recovery stopped after five attempts. Sign in again, then retry.");
                await establishCouchSession(remoteConfig.apiBaseUrl);
                if (replications.current.get(role) !== failed) return;
                failed.cancel();
                replications.current.delete(role);
                await startReadOnlyReplication(role, true);
              } catch (recoveryError) {
                if (replications.current.get(role) === failed) {
                  setSyncFor(role, { status: "failed", retryCount, error: errorMessage(recoveryError) });
                }
              } finally {
                authRecovery.current.delete(role);
              }
            })();
          }
          return;
        }
        authRetryCounts.current[role] = 0;
        finishedInitialPull = true;
        void refreshDatabaseInfo(role).catch((infoError) => setGlobalError(errorMessage(infoError)));
        setSyncFor(role, (current) => ({
          ...current,
          status: "live",
          pending: 0,
          retryCount: 0,
          lastSuccessfulAt: new Date().toISOString(),
          ...(current.startedAt && current.initialDurationMs === undefined
            ? { initialDurationMs: performance.now() - current.startedAt }
            : {}),
          error: undefined,
        }));
        setLastAction(`${role === "content" ? "Demo content" : "Demo boards"} are caught up. Incoming live changes remain read-only.`);
      })
      .on("error", (error: unknown) => {
        setSyncFor(role, (current) => ({ ...current, status: "failed", retryCount: current.retryCount + 1, error: errorMessage(error) }));
        setGlobalError(errorMessage(error));
      })
      .on("complete", (result: { status?: string }) => {
        if (replications.current.get(role) === replication) replications.current.delete(role);
        if (result.status === "cancelled") return;
        if (!finishedInitialPull) {
          setSyncFor(role, { status: "live", pending: 0, lastSuccessfulAt: new Date().toISOString() });
        }
      });
  }, [dbs, refreshDatabaseInfo, remoteConfig, setSyncFor]);

  const run = useCallback(async (label: string, action: () => Promise<void>) => {
    setGlobalError("");
    setLastAction(`${label}…`);
    try {
      await action();
      setLastAction(`${label} completed.`);
    } catch (error) {
      setGlobalError(errorMessage(error));
      setLastAction(`${label} failed.`);
    }
  }, []);

  const localPouch = dbs.content;
  const searchResults = useMemo(() => {
    if (!songLibrary || !songSearch.trim()) return [];
    const started = performance.now();
    const results = searchSongLibrary(songLibrary.songs, songSearch.trim());
    const elapsed = performance.now() - started;
    queueMicrotask(() => setSearchDurationMs(elapsed));
    return results.slice(0, 20);
  }, [songLibrary, songSearch]);

  const createLocalSample = () => run("Local SQLite create/update", async () => {
    if (!localPouch) throw new Error("The content database is unavailable.");
    const doc = await saveLocalPersistenceSample(localPouch);
    setLocalDoc(doc as unknown as Record<string, unknown>);
    await refreshDatabaseInfo("content");
  });

  const readLocalSample = () => run("Local SQLite read", async () => {
    if (!localPouch) throw new Error("The content database is unavailable.");
    const doc = await localPouch.get(LOCAL_PERSISTENCE_TEST_ID);
    setLocalDoc(doc as unknown as Record<string, unknown>);
  });

  const updateLocalSample = () => run("Local SQLite update", async () => {
    if (!localPouch) throw new Error("The content database is unavailable.");
    const doc = await localPouch.get(LOCAL_PERSISTENCE_TEST_ID) as PouchDB.Core.ExistingDocument<{ saveNumber?: number }>;
    const result = await localPouch.put({ ...doc, saveNumber: (doc.saveNumber ?? 0) + 1, savedAt: new Date().toISOString() });
    setLocalDoc(await localPouch.get(LOCAL_PERSISTENCE_TEST_ID) as unknown as Record<string, unknown>);
    setLastAction(`Local SQLite update completed at revision ${result.rev}.`);
    await refreshDatabaseInfo("content");
  });

  const deleteLocalSample = () => run("Local SQLite delete", async () => {
    if (!localPouch) throw new Error("The content database is unavailable.");
    const doc = await localPouch.get(LOCAL_PERSISTENCE_TEST_ID);
    await localPouch.remove(doc);
    setLocalDoc(null);
    await refreshDatabaseInfo("content");
  });

  const loadSongLibrary = () => run("Read song library projections", async () => {
    if (!localPouch) throw new Error("The content database is unavailable.");
    setSongLibrary(await readSongLibrary(localPouch));
  });

  const inspectBoards = () => run("Read demo board content", async () => {
    if (!dbs.boards) throw new Error("The board database is unavailable.");
    setBoardSummary(await readFirstDemoBoard(dbs.boards));
  });

  const selectSong = (songId: string, song: DBItem) => run("Hydrate selected song", async () => {
    if (!localPouch) throw new Error("The content database is unavailable.");
    const hydrated = await hydrateSongFromLocalDatabase(localPouch, songId);
    const reference = createServicePlanReference(hydrated);
    setSelectedSong({
      identity: { id: hydrated._id, title: hydrated.name },
      metadata: hydrated.songMetadata ?? {},
      key: hydrated.songMetadata?.key ?? "",
      arrangements: (hydrated.arrangements ?? []).length,
      slides: (hydrated.arrangements ?? []).reduce((sum, arrangement) => sum + (arrangement.slides?.length ?? 0), 0),
      servicePlanSongReference: reference,
      originalProjection: { id: song._id, title: song.name },
    });
  });

  const createTestDocument = () => run("Create namespaced mobile test document locally", async () => {
    if (!localPouch) throw new Error("The content database is unavailable.");
    const id = await createRemoteTestDocument(localPouch);
    setTestDocId(id);
    setTestDocSummary({ _id: id, mobileText: newRemoteTestText(), desktopText: "", editNumber: 0 });
    await refreshDatabaseInfo("content");
  });

  const editTestDocument = (editor: "mobile" | "desktop") => run(`Edit namespaced test document on ${editor}`, async () => {
    if (!localPouch || !testDocId) throw new Error("Create or enter a mobile POC test document ID first.");
    const doc = await reviseRemoteTestDocument(localPouch, testDocId, editor);
    setTestDocSummary({ _id: testDocId, mobileText: doc.mobileText ?? "", desktopText: doc.desktopText ?? "", editNumber: doc.editNumber ?? 0, _rev: doc._rev });
  });

  const loadTestDocument = () => run("Read selected test document and conflicts", async () => {
    if (!localPouch || !testDocId) throw new Error("Enter a mobile POC test document ID first.");
    const summary = await inspectRemoteTestDocumentConflicts(localPouch, testDocId);
    setTestDocSummary(summary);
  });

  const deleteTestDocumentLocally = () => run("Delete selected test document locally", async () => {
    if (!localPouch || !testDocId) throw new Error("Create or enter a mobile POC test document ID first.");
    const result = await deleteRemoteTestDocumentLocally(localPouch, testDocId);
    setTestDocSummary({ _id: testDocId, tombstoneRevision: result.rev, status: "local tombstone created; not pushed" });
  });

  const pushTestDocument = () => run("Push exact test document ID", async () => {
    if (!authorizeRemoteWrites) throw new Error("Enable the explicit remote-write authorization checkbox first.");
    if (!localPouch || !testDocId) throw new Error("Create or enter a mobile POC test document ID first.");
    const [safeId] = assertSafeOutboundTestIds([testDocId]);
    assertRegisteredTestDocument(safeId);
    if (!isRegisteredDeletedTestDocument(safeId)) {
      const document = await localPouch.get(safeId) as PouchDB.Core.ExistingDocument<{ type?: string; tenant?: string }>;
      if (document.type !== "worshipsync-mobile-poc-test" || document.tenant !== DEMO_TENANT) {
        throw new Error("Only demo-tenant mobile POC test documents created on this device can be pushed.");
      }
    }
    await establishCouchSession(remoteConfig.apiBaseUrl);
    const remote = remoteDatabases.current.get("content") ?? createRemoteDatabase("content", remoteConfig.couchDbUrl);
    remoteDatabases.current.set("content", remote);
    const result = await localPouch.replicate.to(remote, outboundTestReplicationOptions([safeId]));
    setTestDocSummary((current) => ({ ...current, lastPush: result.status ?? "complete", pushedDocumentIds: [safeId] }));
    await refreshDatabaseInfo("content");
  });

  const pullAll = () => run("Pull latest demo content and boards", async () => {
    await startReadOnlyReplication("content");
    await startReadOnlyReplication("boards");
  });

  const repairSession = (role: NativeDbRole) => run(`Renew CouchDB session and restart ${role} pull`, async () => {
    await establishCouchSession(remoteConfig.apiBaseUrl);
    await startReadOnlyReplication(role, true);
  });

  const localMemory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;

  return (
    <main className="app-shell">
      <header className="masthead">
        <div>
          <p className="eyebrow">WorshipSync · isolated experiment</p>
          <h1>Native storage diagnostics</h1>
        </div>
        <div className={`status-pill ${initialization === "ready" && storageBackendsVerified ? "good" : initialization === "failed" ? "bad" : "waiting"}`}>
          <span className="status-dot" />
          {initialization === "ready" && storageBackendsVerified ? "SQLite verified" : initialization === "failed" ? "SQLite unavailable" : "Checking native runtime"}
        </div>
      </header>

      <section className="runtime-grid" aria-label="Runtime diagnostics">
        <Diagnostic label="Platform / runtime" value={`${runtime.platform}${runtime.isNative ? " · native" : " · browser"}`} />
        <Diagnostic label="Capacitor" value={runtime.capacitor} />
        <Diagnostic label="PouchDB" value={runtime.pouchDb} />
        <Diagnostic label="Selected adapter" value={runtime.selectedAdapter} />
        <Diagnostic label="SQLite plugin API" value={runtime.sqlitePluginAvailable ? "Available" : "Missing"} />
        <Diagnostic label="Verified backend" value={storageBackendsVerified ? "Native SQLite tables + PRAGMA" : "Unverified · no fallback"} />
      </section>

      {initialization === "checking" && <p className="notice">Waiting for the Capacitor runtime and Cordova <code>deviceready</code> event.</p>}
      {initializationError && <div className="error-box" role="alert"><strong>Native storage could not start</strong><p>{initializationError}</p><button onClick={() => void initialize()}>Retry initialization</button></div>}

      <section className="panel">
        <div className="section-heading"><div><p className="eyebrow">Remote read access</p><h2>Connection setup</h2></div><span className="tag">Tenant locked to demo</span></div>
        <p className="muted">The PoC reads <code>{CONTENT_REMOTE_DB}</code> and filters <code>{BOARD_REMOTE_DB}</code> to the existing <code>{DEMO_TENANT}</code> tenant. Passwords are held only in memory for sign-in. The app verifies <code>/api/auth/me</code> resolves to <code>demo</code> before it requests a CouchDB session.</p>
        <div className="form-grid">
          <label>WorshipSync API base URL<input value={configDraft.apiBaseUrl} onChange={(event) => setConfigDraft((current) => ({ ...current, apiBaseUrl: event.target.value }))} placeholder="https://www.worshipsync.net/" autoCapitalize="none" /></label>
          <label>CouchDB base URL<input value={configDraft.couchDbUrl} onChange={(event) => setConfigDraft((current) => ({ ...current, couchDbUrl: event.target.value }))} placeholder="https://db.worshipsync.net" autoCapitalize="none" /></label>
        </div>
        <div className="button-row"><button className="secondary" onClick={saveConfig}>Save origins on this device</button></div>
        <div className="auth-card">
          <div className="section-heading"><div><p className="eyebrow">Existing WorshipSync authentication</p><h3>{authStatus === "signed-in" ? "Demo account connected" : authStatus === "checking" ? "Checking demo account" : "Sign in to the demo account"}</h3></div><span className={`status-pill ${authStatus === "signed-in" ? "good" : authStatus === "failed" ? "bad" : "waiting"}`}>{authStatus}</span></div>
          {authStatus === "signed-in" && authSession ? <>
            <p className="muted">{authSession.user?.displayName || authSession.user?.email || authSession.churchName || "Authenticated account"} · tenant <code>{authSession.database}</code></p>
            <div className="button-row"><button className="secondary" onClick={() => void checkDemoSession()}>Refresh session</button><button className="secondary" onClick={() => void signOut()}>Sign out</button><button disabled={initialization !== "ready"} onClick={() => void run("Start read-only content replication", () => startReadOnlyReplication("content"))}>Pull demo content</button><button className="secondary" disabled={initialization !== "ready"} onClick={() => void run("Start read-only board replication", () => startReadOnlyReplication("boards"))}>Pull demo boards</button></div>
          </> : pendingEmailCode ? <>
            <p className="muted">Enter the verification code sent to <strong>{pendingEmailCode.email}</strong>.</p>
            <div className="form-grid"><label>Email verification code<input value={emailCode} onChange={(event) => setEmailCode(event.target.value)} autoComplete="one-time-code" inputMode="numeric" /></label></div>
            <div className="button-row"><button disabled={!emailCode.trim()} onClick={() => void verifySignInCode()}>Verify and continue</button><button className="secondary" onClick={() => { setPendingEmailCode(null); setEmailCode(""); setAuthStatus("signed-out"); }}>Cancel sign-in</button></div>
          </> : <>
            <div className="form-grid"><label>Email<input type="email" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} autoComplete="username" autoCapitalize="none" /></label><label>Password<input type="password" value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} autoComplete="current-password" /></label></div>
            <div className="button-row"><button disabled={!authEmail.trim() || !authPassword || authStatus === "checking"} onClick={() => void signIn()}>Sign in using WorshipSync</button><button className="secondary" onClick={() => void checkDemoSession()}>Check existing session</button></div>
          </>}
          {authError && <p className="sync-error" role="alert">{authError}</p>}
        </div>
        <p className="hint">Credentialed API and CouchDB requests require the app WebView origin to be present in the server’s existing, narrowly scoped CORS allowlists. See the setup guide before testing a device.</p>
      </section>

      <section className="db-grid" aria-label="Local native databases">
        <DatabaseCard role="content" info={dbInfo.content} sync={sync.content} localName={CONTENT_LOCAL_DB} onRefresh={() => void run("Refresh content database diagnostics", () => refreshDatabaseInfo("content").then(() => undefined))} onRetry={() => void repairSession("content")} />
        <DatabaseCard role="boards" info={dbInfo.boards} sync={sync.boards} localName={BOARD_LOCAL_DB} onRefresh={() => void run("Refresh board database diagnostics", () => refreshDatabaseInfo("boards").then(() => undefined))} onRetry={() => void repairSession("boards")} />
      </section>

      <section className="panel">
        <div className="section-heading"><div><p className="eyebrow">Durability</p><h2>Local persistence check</h2></div><span className="tag">Never pushed remotely</span></div>
        <p className="muted">This fixed local-only document checks SQLite create, read, update, and delete. Restart the app and press Read again to verify app-restart persistence.</p>
        <div className="button-row wrap">
          <button disabled={!localPouch} onClick={() => void createLocalSample()}>Create / save sample</button>
          <button className="secondary" disabled={!localPouch} onClick={() => void readLocalSample()}>Read after restart</button>
          <button className="secondary" disabled={!localPouch} onClick={() => void updateLocalSample()}>Update sample</button>
          <button className="danger" disabled={!localPouch} onClick={() => void deleteLocalSample()}>Delete sample</button>
        </div>
        {localDoc && <pre className="json-output">{JSON.stringify(localDoc, null, 2)}</pre>}
      </section>

      <section className="panel">
        <div className="section-heading"><div><p className="eyebrow">Existing WorshipSync readers</p><h2>Song library</h2></div><span className="tag">Paged read · projections only</span></div>
        <p className="muted">Loads only legacy songs and song-v2 root, arrangement, and slide rows from local SQLite. The existing discovery, library search, song hydration, and service-plan reference helpers are reused.</p>
        <div className="button-row"><button disabled={!localPouch} onClick={() => void loadSongLibrary()}>Load local song library</button><button className="secondary" disabled={!dbs.boards} onClick={() => void inspectBoards()}>Inspect a demo board</button></div>
        {songLibrary && <>
          <div className="metric-row"><Diagnostic label="Library songs" value={String(songLibrary.songs.length)} /><Diagnostic label="Source documents scanned" value={String(songLibrary.sourceDocumentCount)} /><Diagnostic label="Projection time" value={`${songLibrary.elapsedMs.toFixed(1)} ms`} /><Diagnostic label="Song-v2 diagnostics" value={String(songLibrary.diagnostics.length)} /></div>
          <div className="doc-types">{Object.entries(songLibrary.docTypeCounts).map(([name, count]) => <span key={name}>{name}: {count}</span>)}</div>
          <label className="search-field">Search by title or lyrics<input value={songSearch} onChange={(event) => setSongSearch(event.target.value)} placeholder="Try a title or lyric phrase" /></label>
          {searchDurationMs !== null && <p className="hint">Search time: {searchDurationMs.toFixed(2)} ms · first 20 matching songs shown</p>}
          <div className="song-results">{searchResults.map((result) => (
            <button key={result.song._id} className="song-row" onClick={() => void selectSong(result.song._id, result.song)}>
              <span><strong>{result.song.name}</strong><small>{result.song.songMetadata?.artistName || "No artist metadata"}{result.song.songMetadata?.key ? ` · key ${result.song.songMetadata.key}` : ""}</small></span>
              <span className="song-score">{result.matchRank.toFixed(0)}</span>
            </button>
          ))}{songSearch && !searchResults.length && <p className="muted">No local song matched that title or lyric phrase.</p>}</div>
          {selectedSong && <div className="result-card"><h3>Hydrated song and plan reference</h3><pre className="json-output">{JSON.stringify(selectedSong, null, 2)}</pre></div>}
          {songLibrary.diagnostics.length > 0 && <details><summary>Incomplete song-v2 roots ({songLibrary.diagnostics.length})</summary><pre className="json-output">{JSON.stringify(songLibrary.diagnostics, null, 2)}</pre></details>}
        </>}
        {boardSummary && <div className="result-card"><h3>Existing discussion-board selector result</h3><p>Board ID: <code>{boardSummary.boardId ?? "No demo posts downloaded yet"}</code> · posts: {boardSummary.posts.length}</p><p className="hint">Rows are read with the existing <code>getLocalBoardPosts</code> range selector.</p></div>}
      </section>

      <section className="panel safety-panel">
        <div className="section-heading"><div><p className="eyebrow">Separate opt-in test mode</p><h2>Scoped remote-write test</h2></div><span className="tag warning">No push during initial replication</span></div>
        <p className="muted">Creates a disposable, namespaced document on this device. Remote writes require the checkbox and a second explicit push action; the request sends exactly one <code>doc_ids</code> entry and cannot push the downloaded demo database.</p>
        <div className="button-row wrap">
          <button disabled={!localPouch} onClick={() => void createTestDocument()}>Create namespaced test document</button>
          <button className="secondary" disabled={!testDocId} onClick={() => void editTestDocument("mobile")}>Edit on mobile</button>
          <button className="secondary" disabled={!testDocId} onClick={() => void loadTestDocument()}>Inspect revisions / conflicts</button>
          <button className="danger" disabled={!testDocId} onClick={() => void deleteTestDocumentLocally()}>Delete locally</button>
        </div>
        <label className="id-field">Mobile POC test document ID<input value={testDocId} onChange={(event) => setTestDocId(event.target.value)} placeholder={`${MOBILE_TEST_DOCUMENT_PREFIX}…`} autoCapitalize="none" /></label>
        <div className="authorization">
          <label className="checkbox-label"><input type="checkbox" checked={authorizeRemoteWrites} onChange={(event) => setAuthorizeRemoteWrites(event.target.checked)} />I explicitly authorize a CouchDB write for the selected, namespaced mobile POC test document.</label>
          <button className="danger" disabled={!authorizeRemoteWrites || !testDocId} onClick={() => void pushTestDocument()}>Push this exact test document ID</button>
        </div>
        {testDocSummary && <pre className="json-output">{JSON.stringify(testDocSummary, null, 2)}</pre>}
        <p className="hint">For desktop-to-mobile and concurrent-edit scenarios, use the same test ID from a browser PouchDB peer. Conflict leaves are only inspected here; this app never auto-resolves or deletes them.</p>
      </section>

      <section className="panel compact-panel">
        <div className="section-heading"><div><p className="eyebrow">Performance sample</p><h2>Available measurements</h2></div></div>
        <div className="metric-row"><Diagnostic label="Cold DB initialization" value={initializationMs === null ? "—" : `${initializationMs.toFixed(1)} ms`} /><Diagnostic label="Content initial pull" value={sync.content.initialDurationMs === undefined ? "Not completed" : `${sync.content.initialDurationMs.toFixed(0)} ms`} /><Diagnostic label="Content local docs" value={String(dbInfo.content?.docCount ?? 0)} /><Diagnostic label="Native DB file size" value={dbInfo.content ? formatBytes(dbInfo.content.storageBytes) : "—"} /><Diagnostic label="WebView heap" value={localMemory ? formatBytes(localMemory) : "Not exposed"} /></div>
        <p className="hint">CPU and device-restart measurements need a physical Android device. The library scan is paged and skips full slide hydration until one song is selected.</p>
      </section>

      <footer className="page-footer">
        <div><span className="status-dot" />{lastAction}</div>
        <button className="text-button" onClick={() => void run("Pull both demo databases", pullAll)}>Pull both databases</button>
        <button className="text-button" onClick={() => { void refreshDatabaseInfo("content"); void refreshDatabaseInfo("boards"); }}>Refresh diagnostics</button>
      </footer>
      {globalError && <div className="toast-error" role="alert"><strong>Action needs attention</strong><span>{globalError}</span><button aria-label="Dismiss error" onClick={() => setGlobalError("")}>×</button></div>}
    </main>
  );
};

const Diagnostic = ({ label, value }: { label: string; value: string }) => (
  <div className="diagnostic"><span>{label}</span><strong>{value}</strong></div>
);

const DatabaseCard = ({ role, info, sync, localName, onRefresh, onRetry }: {
  role: NativeDbRole;
  info?: NativeDbInfo;
  sync: SyncState;
  localName: string;
  onRefresh: () => void;
  onRetry: () => void;
}) => (
  <article className="db-card">
    <div className="section-heading"><div><p className="eyebrow">{role === "content" ? "Content & songs" : "Discussion boards"}</p><h2>{role === "content" ? "Local content DB" : "Local board DB"}</h2></div><StatusPill status={sync.status} /></div>
    <dl>
      <div><dt>Database</dt><dd><code>{info?.name ?? localName}</code></dd></div>
      <div><dt>Adapter</dt><dd>{info?.adapter ?? "—"}</dd></div>
      <div><dt>Backend</dt><dd>{info ? `${info.verifiedBackend} · ${info.sqliteTables.length} tables` : "Not verified"}</dd></div>
      <div><dt>Documents</dt><dd>{info?.docCount ?? "—"}</dd></div>
      <div><dt>File size</dt><dd>{info ? formatBytes(info.storageBytes) : "—"}</dd></div>
      <div><dt>Sync direction</dt><dd>Remote → local only</dd></div>
      <div><dt>Pending / written</dt><dd>{sync.pending ?? "—"} / {sync.docsWritten}</dd></div>
      <div><dt>Last successful pull</dt><dd>{formatDate(sync.lastSuccessfulAt)}</dd></div>
      <div><dt>Retry count</dt><dd>{sync.retryCount}</dd></div>
    </dl>
    {sync.error && <p className="sync-error">{sync.error}</p>}
    <div className="button-row"><button className="secondary" onClick={onRefresh}>Refresh DB status</button><button className="secondary" onClick={onRetry}>Renew session / retry</button></div>
  </article>
);

const StatusPill = ({ status }: { status: SyncState["status"] }) => (
  <span className={`status-pill ${status === "live" ? "good" : status === "failed" ? "bad" : status === "idle" ? "waiting" : "working"}`}><span className="status-dot" />{status}</span>
);

export default App;
