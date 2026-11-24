export const STARTUP_DIAGNOSTIC_STORAGE_KEY = "worshipsync.startup-diagnostics.mode";
export const STARTUP_DIAGNOSTIC_SAMPLE_INTERVAL_MS = 5_000;
const MAX_DIAGNOSTIC_EVENTS = 200;
const RECENT_HEAP_SAMPLE_COUNT = 5;

export const STARTUP_DIAGNOSTIC_MODES = [
  "off",
  "normal",
  "skip-databases",
  "content-only",
  "bible-only",
  "bounded-batches",
  "reduced-batches",
  "sequential",
] as const;

export type StartupDiagnosticMode = (typeof STARTUP_DIAGNOSTIC_MODES)[number];
export type StartupDatabaseKind = "content" | "bible";

type StartupDatabasePlan = {
  content: boolean;
  bible: boolean;
  sequential: boolean;
};

type DiagnosticValue = string | number | boolean | null;
type DiagnosticDetails = Record<string, DiagnosticValue>;

export type StartupDiagnosticEvent = {
  elapsedMs: number;
  subsystem: string;
  event: string;
} & DiagnosticDetails;

type ReplicationStats = {
  active: number;
  batches: number;
  documents: number;
};

export type StartupReplicationRun = {
  recordBatch: (documentCount: number) => void;
  recordRetry: (statusCode?: number) => void;
  finish: (outcome: "complete" | "cancelled" | "error" | "replaced") => void;
};

const diagnosticEvents: StartupDiagnosticEvent[] = [];
const replicationStats: Record<StartupDatabaseKind, ReplicationStats> = {
  content: { active: 0, batches: 0, documents: 0 },
  bible: { active: 0, batches: 0, documents: 0 },
};
const startedAt = typeof performance === "undefined" ? 0 : performance.now();
const recentHeapSamples: number[] = [];
let eventCursor = 0;
let currentMode: StartupDiagnosticMode = readStoredMode();
let longTaskCount = 0;
let longTaskTotalMs = 0;
let longTaskMaxMs = 0;
let heapSampleCount = 0;
let heapSupported: boolean | null = null;
let heapPeakUsedMb: number | null = null;
let heapLimitMb: number | null = null;

function isStartupDiagnosticMode(value: unknown): value is StartupDiagnosticMode {
  return STARTUP_DIAGNOSTIC_MODES.includes(value as StartupDiagnosticMode);
}

function readStoredMode(): StartupDiagnosticMode {
  if (typeof window === "undefined") return "normal";
  try {
    const value = window.localStorage.getItem(STARTUP_DIAGNOSTIC_STORAGE_KEY);
    return isStartupDiagnosticMode(value) ? value : "normal";
  } catch {
    return "normal";
  }
}

export const isStartupDiagnosticsActive = () =>
  currentMode !== "off";

export const isStartupDiagnosticIsolationMode = (mode: StartupDiagnosticMode) =>
  mode === "skip-databases" || mode === "content-only" || mode === "bible-only";

export const shouldShowStartupDiagnosticsPanel = (
  mode: StartupDiagnosticMode,
  pathname: string,
) => isStartupDiagnosticIsolationMode(mode) &&
  pathname !== "/workstation/pair" &&
  pathname !== "/workstation/operator" &&
  pathname !== "/login" &&
  !pathname.startsWith("/login/");

export const getStartupDiagnosticMode = () => currentMode;

export const resolveStartupDatabasePlan = (
  mode: StartupDiagnosticMode,
): StartupDatabasePlan => ({
  content: mode !== "skip-databases" && mode !== "bible-only",
  bible: mode !== "skip-databases" && mode !== "content-only",
  sequential: mode === "sequential",
});

export const resolveStartupReplicationOptions = (
  mode: StartupDiagnosticMode,
  database: StartupDatabaseKind,
) => {
  if (mode === "bounded-batches") return { batch_size: 100, batches_limit: 2 };
  if (mode === "reduced-batches") return { batch_size: 25, batches_limit: 2 };
  return database === "content"
    ? { batch_size: 150, batches_limit: 15 }
    : { batch_size: 1000, batches_limit: 25 };
};

export const getSettledHeapUsageMb = (samples: readonly number[]) => {
  if (samples.length < RECENT_HEAP_SAMPLE_COUNT) return null;
  const recentSamples = samples.slice(-RECENT_HEAP_SAMPLE_COUNT).sort((a, b) => a - b);
  return recentSamples[Math.floor(recentSamples.length / 2)];
};

const elapsedMs = () => Math.round(performance.now() - startedAt);

export const recordStartupDiagnostic = (
  subsystem: string,
  event: string,
  details: DiagnosticDetails = {},
) => {
  if (!isStartupDiagnosticsActive()) return;
  const entry: StartupDiagnosticEvent = {
    elapsedMs: elapsedMs(),
    subsystem,
    event,
    ...details,
  };
  if (diagnosticEvents.length < MAX_DIAGNOSTIC_EVENTS) {
    diagnosticEvents.push(entry);
  } else {
    diagnosticEvents[eventCursor] = entry;
    eventCursor = (eventCursor + 1) % MAX_DIAGNOSTIC_EVENTS;
  }
  console.info(`[WorshipSync startup] ${JSON.stringify(entry)}`);
};

export const beginStartupReplication = (
  database: StartupDatabaseKind,
  options: { batchSize: number; batchesLimit: number; kind?: string },
): StartupReplicationRun => {
  if (!isStartupDiagnosticsActive()) {
    return {
      recordBatch: () => undefined,
      recordRetry: () => undefined,
      finish: () => undefined,
    };
  }
  const stats = replicationStats[database];
  const startedAtForRun = performance.now();
  let batches = 0;
  let documents = 0;
  let active = true;
  stats.active += 1;
  recordStartupDiagnostic(database, "replication.started", {
    kind: options.kind ?? "initial-pull",
    batchSize: options.batchSize,
    batchesLimit: options.batchesLimit,
    maximumDocumentsInFlight: options.batchSize * options.batchesLimit,
    activeInstances: stats.active,
  });

  return {
    recordBatch: (documentCount) => {
      const count = Number.isSafeInteger(documentCount) && documentCount > 0
        ? documentCount
        : 0;
      batches += 1;
      documents += count;
      stats.batches += 1;
      stats.documents += count;
    },
    recordRetry: (statusCode) => {
      recordStartupDiagnostic(database, "replication.retry", {
        kind: options.kind ?? "initial-pull",
        statusCode: typeof statusCode === "number" ? statusCode : null,
        activeInstances: stats.active,
      });
    },
    finish: (outcome) => {
      if (!active) return;
      active = false;
      stats.active = Math.max(0, stats.active - 1);
      recordStartupDiagnostic(database, "replication.finished", {
        kind: options.kind ?? "initial-pull",
        outcome,
        batches,
        documents,
        durationMs: Math.round(performance.now() - startedAtForRun),
        activeInstances: stats.active,
      });
    },
  };
};

const snapshotEvents = () => {
  if (diagnosticEvents.length < MAX_DIAGNOSTIC_EVENTS || eventCursor === 0) {
    return diagnosticEvents.slice();
  }
  return [
    ...diagnosticEvents.slice(eventCursor),
    ...diagnosticEvents.slice(0, eventCursor),
  ];
};

const getSnapshot = () => ({
  mode: currentMode,
  elapsedMs: elapsedMs(),
  heap: {
    supported: heapSupported,
    sampleCount: heapSampleCount,
    peakUsedMb: heapPeakUsedMb,
    latestUsedMb: recentHeapSamples.at(-1) ?? null,
    settledUsedMb: getSettledHeapUsageMb(recentHeapSamples),
    settledWindowSamples: Math.min(recentHeapSamples.length, RECENT_HEAP_SAMPLE_COUNT),
    heapLimitMb,
  },
  activeReplications: {
    content: { ...replicationStats.content },
    bible: { ...replicationStats.bible },
  },
  recentEvents: snapshotEvents(),
});

export const setStartupDiagnosticMode = (mode: StartupDiagnosticMode) => {
  if (!isStartupDiagnosticMode(mode) || typeof window === "undefined") {
    return false;
  }
  try {
    window.localStorage.setItem(STARTUP_DIAGNOSTIC_STORAGE_KEY, mode);
    window.location.reload();
    return true;
  } catch {
    return false;
  }
};

declare global {
  interface Window {
    __worshipSyncStartupDiagnostics?: {
      getMode: () => StartupDiagnosticMode;
      setMode: (mode: StartupDiagnosticMode) => boolean;
      snapshot: typeof getSnapshot;
    };
  }
}

if (typeof window !== "undefined") {
  window.__worshipSyncStartupDiagnostics = {
    getMode: getStartupDiagnosticMode,
    setMode: setStartupDiagnosticMode,
    snapshot: getSnapshot,
  };

  window.addEventListener("storage", (event) => {
    if (event.key !== STARTUP_DIAGNOSTIC_STORAGE_KEY) return;
    currentMode = isStartupDiagnosticMode(event.newValue) ? event.newValue : "normal";
    window.location.reload();
  });
}

if (isStartupDiagnosticsActive() && typeof window !== "undefined") {
  recordStartupDiagnostic("runtime", "diagnostics.enabled", { mode: currentMode });

  if (typeof PerformanceObserver !== "undefined") {
    try {
      const observer = new PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => {
          longTaskCount += 1;
          longTaskTotalMs += entry.duration;
          longTaskMaxMs = Math.max(longTaskMaxMs, entry.duration);
        });
      });
      observer.observe({ entryTypes: ["longtask"] });
    } catch {
      // Long task entries are not supported in every browser.
    }
  }

  window.setInterval(() => {
    const memory = (performance as Performance & {
      memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
    }).memory;
    const toMb = (bytes: number) => Math.round((bytes / 1024 / 1024) * 10) / 10;
    heapSampleCount += 1;
    heapSupported = Boolean(memory);
    const heapUsedMb = memory ? toMb(memory.usedJSHeapSize) : null;
    heapLimitMb = memory ? toMb(memory.jsHeapSizeLimit) : null;
    if (heapUsedMb !== null) {
      heapPeakUsedMb = heapPeakUsedMb === null
        ? heapUsedMb
        : Math.max(heapPeakUsedMb, heapUsedMb);
      recentHeapSamples.push(heapUsedMb);
      if (recentHeapSamples.length > RECENT_HEAP_SAMPLE_COUNT) {
        recentHeapSamples.shift();
      }
    }
    recordStartupDiagnostic("runtime", "memory.sample", {
      heapSupported,
      heapUsedMb,
      heapAllocatedMb: memory ? toMb(memory.totalJSHeapSize) : null,
      heapLimitMb,
      peakHeapUsedMb: heapPeakUsedMb,
      settledHeapUsedMb: getSettledHeapUsageMb(recentHeapSamples),
      contentActiveReplications: replicationStats.content.active,
      bibleActiveReplications: replicationStats.bible.active,
      contentBatches: replicationStats.content.batches,
      contentDocuments: replicationStats.content.documents,
      bibleBatches: replicationStats.bible.batches,
      bibleDocuments: replicationStats.bible.documents,
      longTaskCount,
      longTaskTotalMs: Math.round(longTaskTotalMs),
      longTaskMaxMs: Math.round(longTaskMaxMs),
    });
    longTaskCount = 0;
    longTaskTotalMs = 0;
    longTaskMaxMs = 0;
  }, STARTUP_DIAGNOSTIC_SAMPLE_INTERVAL_MS);
}
