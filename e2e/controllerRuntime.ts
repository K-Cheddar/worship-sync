import { expect, type BrowserContext, type Page } from "@playwright/test";
import { allowedE2EAuthOrigins } from "./authOrigins";
import {
  assertControllerFirebaseTargetSupported,
  ControllerFirebaseWriteFirewall,
  isRealtimeDatabaseUrl,
} from "./controllerFirebaseIsolation";

export type ControllerFirebaseIsolationMetrics = {
  allowedRealtimeReads: number;
  blockedHttpWrites: number;
  blockedLongPollingWrites: number;
  blockedUnknownLongPollingCommands: number;
  blockedRealtimeWebSockets: number;
  suppressedSdkWrites: Record<string, number>;
};

const emptyIsolationMetrics = (): ControllerFirebaseIsolationMetrics => ({
  allowedRealtimeReads: 0,
  blockedHttpWrites: 0,
  blockedLongPollingWrites: 0,
  blockedUnknownLongPollingCommands: 0,
  blockedRealtimeWebSockets: 0,
  suppressedSdkWrites: {},
});

const redactDiagnosticText = (value: string) => value
  .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[redacted-email]")
  .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [redacted-token]")
  .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]{5,})?\b/g, "[redacted-token]")
  .replace(/((?:id[_-]?token|access[_-]?token|refresh[_-]?token|auth[_-]?token|firebase[_-]?token|token|cookie|password|credential|private[_-]?key|api[_-]?key|firebaseUid|churchId|userId)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^,\s;}]+)/gi, "$1[redacted]")
  .replace(/churches\/[^/\s,"'}]+/gi, "churches/[redacted]")
  .replace(/\b(?:verification|authentication|auth|login|sign[- ]?in|email|sms|2fa|mfa)\s+(?:verification\s+)?(?:code|passcode|otp)\s*(?:is|:|=|#)?\s*\d{4,8}\b/gi, "[redacted-code]")
  .replace(/https?:\/\/[^\s"']+/gi, (rawUrl) => {
    try {
      const url = new URL(rawUrl);
      return `${url.origin}${url.pathname}`;
    } catch {
      return "[redacted-url]";
    }
  })
  .slice(0, 1_000);

const safeConsoleMessage = (value: string) => redactDiagnosticText(value);

const startupRequestCategory = (rawUrl: string) => {
  try {
    const url = new URL(rawUrl);
    if (url.pathname === "/api/auth/me") return "auth_bootstrap";
    if (url.pathname === "/api/auth/session") return "session";
    if (url.pathname === "/api/auth/shared-data-token") return "shared_data_token";
    if (url.pathname === "/api/getDbSession") return "content_database_session";
    if (/\/_(?:bulk_get|bulk_docs|changes|revs_diff|all_docs|find)(?:\/|$)/i.test(url.pathname)) return "content_database";
    if (/identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com/i.test(url.hostname)) return "firebase_auth";
    if (isRealtimeDatabaseUrl(url)) return "firebase_realtime_database";
  } catch {
    return null;
  }
  return null;
};

const realtimeDatabaseRoutePattern = /(?:firebaseio\.com|firebasedatabase\.app|\/\.lp(?:[/?#]|$)|\/\.ws(?:[/?#]|$)|\.json(?:[?#]|$))/i;

/** Install test-only Firebase transport and network guards before any page opens. */
export async function installControllerRuntime(context: BrowserContext) {
  const metrics = emptyIsolationMetrics();
  const firewall = new ControllerFirebaseWriteFirewall();

  // Long polling uses GET requests for both reads and writes. The firewall
  // decodes only the protocol action header and never records the payload.
  await context.route(realtimeDatabaseRoutePattern, async (route) => {
    const request = route.request();
    const decision = firewall.inspectRequest(request.method(), request.url());
    if (decision.action === "ignore") {
      await route.continue();
      return;
    }
    if (decision.action === "block") {
      if (decision.reason === "http_write_method") metrics.blockedHttpWrites += 1;
      else if (decision.reason === "unknown_long_poll_action") metrics.blockedUnknownLongPollingCommands += 1;
      else metrics.blockedLongPollingWrites += 1;
      await route.abort("blockedbyclient");
      return;
    }
    metrics.allowedRealtimeReads += 1;
    await route.continue();
  });

  // If the app or Firebase SDK escapes the forced long-poll transport, close
  // the RTDB socket before any protocol frame can reach Firebase.
  await context.routeWebSocket(
    (url) => isRealtimeDatabaseUrl(url),
    (socket) => {
      metrics.blockedRealtimeWebSockets += 1;
      socket.close();
    },
  );

  await context.exposeBinding("__controllerE2ERecordSuppressedSdkWrite", (_source, command: string) => {
    if (!/^(?:onDisconnect|remove|runTransaction|set|setPriority|setWithPriority|update)$/.test(command)) return;
    metrics.suppressedSdkWrites[command] = (metrics.suppressedSdkWrites[command] ?? 0) + 1;
  });

  // Patch Firebase's modular write exports before the app imports them. App
  // writes are stopped before the SDK can queue offline mutations; the route
  // firewall remains a second boundary and the direct probe deliberately uses
  // the saved raw setter to prove that bypass is still blocked on the wire.
  await context.route(/firebase_database\.js(?:\?|$)/i, async (route) => {
    const response = await route.fetch();
    let source = await response.text();
    const writeFunctions = ["onDisconnect", "remove", "runTransaction", "set", "setPriority", "setWithPriority", "update"];
    if (writeFunctions.some((name) => !new RegExp(`function\\s+${name}\\s*\\(`).test(source))) {
      throw new Error("Controller E2E could not patch every Firebase modular write export; refusing to run without SDK-level write isolation.");
    }
    const exportMarker = /\nexport\s*\{/;
    if (!exportMarker.test(source)) {
      throw new Error("Controller E2E could not locate the Firebase module export boundary; refusing to run without SDK-level write isolation.");
    }
    const boundary = `
if (typeof window !== 'undefined' && window.__controllerE2ENetworkGuardInstalled === true) {
  const controllerE2ERawFirebaseWrites = {
    onDisconnect, remove, runTransaction, set, setPriority, setWithPriority, update
  };
  window.__controllerE2ERawFirebaseWrites = controllerE2ERawFirebaseWrites;
  const controllerE2ERecordBlockedWrite = (command) => {
    const counts = window.__controllerE2ESdkWriteBlocks || (window.__controllerE2ESdkWriteBlocks = {});
    counts[command] = (counts[command] || 0) + 1;
    void window.__controllerE2ERecordSuppressedSdkWrite?.(command);
  };
  onDisconnect = () => {
    controllerE2ERecordBlockedWrite('onDisconnect');
    return { cancel: () => Promise.resolve(), remove: () => Promise.resolve(), set: () => Promise.resolve(), update: () => Promise.resolve() };
  };
  remove = () => { controllerE2ERecordBlockedWrite('remove'); return Promise.resolve(); };
  runTransaction = () => { controllerE2ERecordBlockedWrite('runTransaction'); return Promise.resolve({ committed: false, snapshot: null }); };
  set = () => { controllerE2ERecordBlockedWrite('set'); return Promise.resolve(); };
  setPriority = () => { controllerE2ERecordBlockedWrite('setPriority'); return Promise.resolve(); };
  setWithPriority = () => { controllerE2ERecordBlockedWrite('setWithPriority'); return Promise.resolve(); };
  update = () => { controllerE2ERecordBlockedWrite('update'); return Promise.resolve(); };
  window.__controllerE2EFirebaseWriteBoundaryInstalled = true;
}
`;
    source = source.replace(exportMarker, `${boundary}\nexport {`);
    await route.fulfill({ response, body: source });
  });

  await context.exposeBinding("__controllerE2EIsolationMetrics", () => ({
    ...metrics,
    suppressedSdkWrites: { ...metrics.suppressedSdkWrites },
  }));
  await context.addInitScript(() => {
    const target = window as unknown as {
      __controllerE2ENetworkGuardInstalled?: boolean;
      __controllerE2ERecordSuppressedSdkWrite?: (command: string) => Promise<void>;
      __controllerE2EFirebaseWriteBoundaryInstalled?: boolean;
      __controllerE2ERawFirebaseWrites?: { set: (reference: unknown, value: unknown) => Promise<void> };
      __controllerE2ESdkWriteBlocks?: Record<string, number>;
      __controllerE2ESafeDiagnostics?: Array<Record<string, unknown>>;
      __controllerE2ERecordSafeDiagnostic?: (event: Record<string, unknown>) => void;
    };
    target.__controllerE2ENetworkGuardInstalled = true;
    target.__controllerE2ESafeDiagnostics = [];
    target.__controllerE2ERecordSafeDiagnostic = (event) => {
      const events = target.__controllerE2ESafeDiagnostics;
      if (!events) return;
      events.push(event);
      if (events.length > 30) events.splice(0, events.length - 30);
    };
  });

  // Keep sanitized startup diagnostics in the page so failure reports can
  // distinguish token, auth, connection, and registry failures.
  context.on("page", (page) => {
    const statusEventsByCategory = new Map<string, number>();
    const record = (event: Record<string, unknown>) => {
      void page.evaluate((safeEvent) => {
        (window as any).__controllerE2ERecordSafeDiagnostic?.(safeEvent);
      }, event).catch(() => undefined);
    };

    page.on("console", (message) => {
      if (message.type() !== "error") return;
      record({ kind: "console_error", message: safeConsoleMessage(message.text()) });
    });
    page.on("pageerror", (error) => {
      record({ kind: "page_error", message: safeConsoleMessage(error.message) });
    });
    page.on("response", (response) => {
      const request = response.request();
      const category = startupRequestCategory(response.url());
      if (!category) return;
      const seen = statusEventsByCategory.get(category) ?? 0;
      if (category === "firebase_realtime_database" && response.status() < 400 && seen >= 5) return;
      statusEventsByCategory.set(category, seen + 1);
      record({ kind: "request_status", category, method: request.method(), status: response.status() });
    });
    page.on("requestfailed", (request) => {
      const category = startupRequestCategory(request.url());
      if (!category) return;
      record({
        kind: "request_failed",
        category,
        method: request.method(),
        message: redactDiagnosticText(request.failure()?.errorText ?? "Request failed"),
      });
    });
  });

  await context.route(/\/src\/(context\/(controllerInfo|globalInfo)|store\/store)\.tsx?(?:\?|$)/, async (route) => {
    const response = await route.fetch();
    let source = await response.text();
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith("/controllerInfo.tsx")) {
      source += `\nwindow.__controllerE2E = {
        database: () => globalDb,
        remote: (databaseName = globalDb.name) => new PouchDB(import.meta.env.VITE_COUCHDB_HOST + '/' + databaseName, {
          fetch: (url, options) => fetch(url, { ...options, credentials: 'include' })
        }),
        initialReplicationComplete: () => !!globalDb &&
          typeof hasSuccessfulInitialContentReplication === 'function' &&
          hasSuccessfulInitialContentReplication(globalDb.name),
        startup: () => window.__controllerE2EStartupSnapshot?.(),
        directFirebaseWrite: (path, value) => window.__controllerE2EDirectFirebaseWrite(path, value),
        readFirebasePath: (path) => window.__controllerE2EReadFirebasePath(path),
        probePath: (probeId) => 'churches/' + window.__controllerE2EFirebaseStatus().churchId + '/data/presentation/outputs/' + probeId
      };`;
    } else if (pathname.endsWith("/store.ts")) {
      source += `\nwindow.__controllerE2EStore = store;
        window.__controllerE2EStartupSnapshot = () => {
          const state = store.getState();
          const firebaseStatus = window.__controllerE2EFirebaseStatus?.() || {};
          const profiles = state.controllerProfiles || {};
          const outputs = state.displayOutputs || {};
          const profileList = Array.isArray(profiles.list) ? profiles.list : [];
          const outputList = Array.isArray(outputs.list) ? outputs.list : [];
          const presentationProfile = profileList.find((profile) => profile.id === 'presentation');
          const firebase = {
            databaseAvailable: firebaseStatus.databaseAvailable === true,
            sharedDataAuthenticated: firebaseStatus.sharedDataAuthenticated === true,
            churchScoped: firebaseStatus.churchScoped === true,
            connected: firebaseStatus.connected === true,
            demoTenant: firebaseStatus.demoTenant === true,
            databaseUrlSupported: firebaseStatus.databaseUrlSupported === true
          };
          return {
            firebase,
            itemLibrary: {
              remoteReplicationComplete: window.__controllerE2E?.initialReplicationComplete?.() === true,
              initialized: state.allDocs?.isInitialized === true,
              songCount: Array.isArray(state.allDocs?.allSongDocs) ? state.allDocs.allSongDocs.length : 0,
              errorPresent: typeof state.allDocs?.error === 'string' && state.allDocs.error.length > 0
            },
            outline: {
              listsInitialized: state.undoable?.present?.itemLists?.isInitialized === true,
              activeListInitialized: state.undoable?.present?.itemList?.isInitialized === true
            },
            controllerProfiles: {
              loaded: profiles.isLoaded === true,
              syncedToCurrentChurch: !!firebase.churchScoped && profiles.syncedChurchId === firebaseStatus.churchId,
              count: profileList.length,
              presentationFound: !!presentationProfile,
              presentationEnabled: presentationProfile?.enabled === true
            },
            displayOutputs: {
              loaded: outputs.isLoaded === true,
              syncedToCurrentChurch: !!firebase.churchScoped && outputs.syncedChurchId === firebaseStatus.churchId,
              count: outputList.length
            }
          };
        };
        `;
    } else {
      const firebaseModule = source.match(/from\s+["']([^"']*firebase_database[^"']*)["']/)?.[1];
      if (!firebaseModule) {
        throw new Error("Controller E2E requires the local Vite Firebase module; read/write isolation was not installed.");
      }
      source = `import { forceLongPolling as controllerE2EForceLongPolling, get as controllerE2EGet } from ${JSON.stringify(firebaseModule)};\nif (!window.__controllerE2EIsolation?.longPollingConfigured) controllerE2EForceLongPolling();\n${source}`;
      source += `\nconst controllerE2EBlockedWriteCapabilities = Object.freeze({
          presentation: false, timers: false, serviceRuntime: false, serviceManagement: false
        });
        Object.defineProperty(globalFireDbInfo, 'writeCapabilities', {
          configurable: true, enumerable: true,
          get: () => controllerE2EBlockedWriteCapabilities,
          set: () => {}
        });
        window.__controllerE2EIsolation = {
          networkGuardInstalled: window.__controllerE2ENetworkGuardInstalled === true,
          sdkWriteBoundaryInstalled: window.__controllerE2EFirebaseWriteBoundaryInstalled === true,
          longPollingConfigured: true,
          writeCapabilitiesDisabled: Object.values(globalFireDbInfo.writeCapabilities).every((value) => value === false)
        };
        window.__controllerE2EFirebaseStatus = () => {
          const databaseUrl = globalFireDbInfo.db?.app?.options?.databaseURL || '';
          let databaseUrlSupported = false;
          try {
            const host = new URL(databaseUrl).hostname.toLowerCase();
            databaseUrlSupported = host === 'firebaseio.com' || host.endsWith('.firebaseio.com') ||
              host === 'firebasedatabase.app' || host.endsWith('.firebasedatabase.app');
          } catch {}
          return {
            networkGuardInstalled: window.__controllerE2ENetworkGuardInstalled === true,
            sdkWriteBoundaryInstalled: window.__controllerE2EFirebaseWriteBoundaryInstalled === true,
            longPollingConfigured: true,
            writeCapabilitiesDisabled: Object.values(globalFireDbInfo.writeCapabilities).every((value) => value === false),
            databaseUrlSupported,
            databaseAvailable: !!globalFireDbInfo.db,
            sharedDataAuthenticated: !!getSharedDataAuth().currentUser,
            churchScoped: !!globalFireDbInfo.churchId,
            churchId: globalFireDbInfo.churchId,
            connected: globalFireDbInfo.isConnected === true,
            demoTenant: globalFireDbInfo.database?.toLowerCase() === 'demo'
          };
        };
        window.__controllerE2EReadFirebasePath = async (path) => {
          if (!globalFireDbInfo.db) throw new Error('Shared Realtime Database is unavailable');
          const snapshot = await controllerE2EGet(ref(globalFireDbInfo.db, path));
          return snapshot.exists() ? snapshot.val() : null;
        };
        window.__controllerE2EDirectFirebaseWrite = (path, value) => {
          if (!globalFireDbInfo.db) throw new Error('Shared Realtime Database is unavailable');
          if (!window.__controllerE2ERawFirebaseWrites?.set) throw new Error('Raw Firebase write probe is unavailable; refusing to test without the network firewall.');
          return window.__controllerE2ERawFirebaseWrites.set(ref(globalFireDbInfo.db, path), value);
        };`;
    }
    await route.fulfill({ response, body: source });
  });

  return {
    metrics: () => ({ ...metrics, suppressedSdkWrites: { ...metrics.suppressedSdkWrites } }),
    assertReady: async (page: Page) => {
      const status = await page.evaluate(() => (window as any).__controllerE2EFirebaseStatus?.() ?? null);
      assertControllerFirebaseTargetSupported(status);
    },
  };
}

export async function installControllerAuthRequestGuard(context: BrowserContext, baseURL: string) {
  let blockedRequests = 0;
  const trustedOrigins = allowedE2EAuthOrigins(baseURL);
  await context.route(/\/api\/auth(?:\/|$)|mailslurp\.com/i, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    let renewal = false;
    try {
      renewal = url.pathname === "/api/auth/session" && request.postDataJSON()?.requestNewCode === false;
    } catch {
      // An unreadable session request is unsafe.
    }
    if (/mailslurp\.com/i.test(url.hostname) || !trustedOrigins.has(url.origin) || (request.method() === "POST" && !renewal)) {
      blockedRequests += 1;
      await route.abort("blockedbyclient");
    } else {
      await route.continue();
    }
  });
  return { blockedRequests: () => blockedRequests };
}

// Browser-side types are intentionally kept here; the app has no E2E globals.
declare global {
  interface Window {
    __controllerE2E: {
      database: () => any;
      remote: (databaseName?: string) => any;
      startup: () => any;
      directFirebaseWrite: (path: string, value: unknown) => Promise<void>;
      readFirebasePath: (path: string) => Promise<unknown>;
      probePath: (probeId: string) => string;
      initialReplicationComplete: () => boolean;
    };
    __controllerE2EStore: { getState: () => any; dispatch: (action: any) => void };
    __controllerE2EIsolation?: {
      networkGuardInstalled: boolean;
      sdkWriteBoundaryInstalled: boolean;
      longPollingConfigured: boolean;
      writeCapabilitiesDisabled: boolean;
    };
    __controllerE2EFirebaseStatus?: () => any;
    __controllerE2EReadFirebasePath?: (path: string) => Promise<unknown>;
    __controllerE2EDirectFirebaseWrite?: (path: string, value: unknown) => Promise<void>;
    __controllerE2EStartupSnapshot?: () => any;
    __controllerE2ENetworkGuardInstalled?: boolean;
    __controllerE2ESafeDiagnostics?: Array<Record<string, unknown>>;
    __controllerE2ERecordSafeDiagnostic?: (event: Record<string, unknown>) => void;
    __controllerE2EIsolationMetrics?: () => Promise<ControllerFirebaseIsolationMetrics>;
    __controllerE2ERecordSuppressedSdkWrite?: (command: string) => Promise<void>;
    __controllerE2ERawFirebaseWrites?: { set: (reference: unknown, value: unknown) => Promise<void> };
    __controllerE2EFirebaseWriteBoundaryInstalled?: boolean;
    __controllerE2ESdkWriteBlocks?: Record<string, number>;
  }
}

export async function readControllerStartupSnapshot(page: Page) {
  return page.evaluate(async () => ({
    isolation: window.__controllerE2EIsolation ?? null,
    isolationMetrics: await window.__controllerE2EIsolationMetrics?.() ?? null,
    firebase: (() => {
      const status = window.__controllerE2EFirebaseStatus?.();
      if (!status) return null;
      const { churchId: _churchId, ...safeStatus } = status;
      return safeStatus;
    })(),
    startup: window.__controllerE2EStartupSnapshot?.() ?? null,
    networkDiagnostics: window.__controllerE2ESafeDiagnostics?.slice(-20) ?? [],
  }));
}

export async function waitForControllerConfiguration(page: Page) {
  await expect.poll(async () => {
    const snapshot = await readControllerStartupSnapshot(page).catch(() => null);
    const startup = snapshot?.startup;
    return Boolean(
      snapshot?.firebase?.databaseAvailable &&
      snapshot?.firebase?.sharedDataAuthenticated &&
      startup?.controllerProfiles?.loaded &&
      startup?.controllerProfiles?.syncedToCurrentChurch &&
      startup?.displayOutputs?.loaded &&
      startup?.displayOutputs?.syncedToCurrentChurch &&
      snapshot?.firebase?.databaseUrlSupported &&
      snapshot?.firebase?.writeCapabilitiesDisabled &&
      snapshot?.firebase?.networkGuardInstalled &&
      snapshot?.firebase?.longPollingConfigured,
    );
  }, { timeout: 60_000, message: "Firebase controller profiles and display outputs must load from the authenticated church" }).toBe(true);

  const snapshot = await readControllerStartupSnapshot(page);
  assertControllerFirebaseTargetSupported(snapshot.firebase);
  if (!snapshot.firebase.demoTenant) {
    throw new Error("Controller E2E is restricted to the approved demo tenant; refusing fixture mutations.");
  }
  return snapshot;
}

export type FixtureDocument = Record<string, any> & { _id: string; _rev?: string };

export async function waitForControllerDatabase(page: Page) {
  await expect.poll(() => page.evaluate(() => Boolean(
    window.__controllerE2EIsolation?.networkGuardInstalled &&
    window.__controllerE2EIsolation.longPollingConfigured &&
    window.__controllerE2EIsolation.writeCapabilitiesDisabled &&
    window.__controllerE2E?.database(),
  )), { timeout: 120_000, message: "Controller E2E Firebase isolation must be installed before database use" }).toBe(true);
  await waitForControllerConfiguration(page);
  try {
    await expect.poll(() => page.evaluate(() => {
    const state = window.__controllerE2EStore?.getState();
    return Boolean(window.__controllerE2E?.initialReplicationComplete?.() && state?.allDocs?.isInitialized && !state.allDocs.error &&
      state.undoable.present.itemLists.isInitialized && state.undoable.present.itemList.isInitialized);
    }), { timeout: 90_000, message: "Controller library, remote replication, and outline hydration must complete" }).toBe(true);
  } catch (error) {
    const startup = await readControllerStartupSnapshot(page).catch(() => null);
    const pouch = await page.evaluate(async () => {
      const db = window.__controllerE2E?.database();
      if (!db) return { available: false };
      try {
        const [info, snapshot] = await Promise.all([
          db.info(),
          db.allDocs({ include_docs: false, update_seq: true, limit: 0 }),
        ]);
        return {
          available: true,
          adapter: typeof db.type === "function" ? db.type() : "unknown",
          docCount: typeof info.doc_count === "number" ? info.doc_count : null,
          infoSequenceType: typeof info.update_seq,
          snapshotSequenceType: typeof snapshot.update_seq,
          snapshotRows: typeof snapshot.total_rows === "number" ? snapshot.total_rows : null,
        };
      } catch (diagnosticError) {
        return { available: true, diagnosticError: diagnosticError instanceof Error ? diagnosticError.name : "unknown" };
      }
    }).catch(() => ({ available: false, diagnosticError: "browser_unavailable" }));
    throw new Error([
      "Controller library, remote replication, and outline hydration did not complete.",
      `Safe startup state: ${JSON.stringify(startup)}`,
      `Local PouchDB snapshot: ${JSON.stringify(pouch)}`,
      `Sanitized browser diagnostics: ${JSON.stringify(startup?.networkDiagnostics ?? [])}`,
      String(error),
    ].join("\n"));
  }
}

export async function readDocument(page: Page, id: string): Promise<FixtureDocument | null> {
  return page.evaluate(async (id) => {
    try { return await window.__controllerE2E.database().get(id); }
    catch (error: any) { if (error.status === 404) return null; throw error; }
  }, id);
}

export async function resetLocalOutputs(page: Page) {
  const status = await page.evaluate(() => window.__controllerE2EFirebaseStatus?.() ?? null);
  assertControllerFirebaseTargetSupported(status);
  await page.evaluate(() => {
    window.__controllerE2EStore.dispatch({ type: "presentation/clearAll" });
    window.__controllerE2EStore.dispatch({ type: "presentation/setTransmitToAll", payload: false });
  });
}
