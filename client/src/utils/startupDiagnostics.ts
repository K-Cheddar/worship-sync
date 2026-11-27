import {
  beginReplicationBatchDiagnostics,
  configureReplicationDiagnosticScope,
  finishReplicationBatchDiagnostics,
  getReplicationDiagnosticsSnapshot,
  markReplicationBatchCheckpoint,
  recordReplicationHeapSample,
  recordReplicationWriteTransaction,
  type ReplicationBatchDiagnosticToken,
  type ReplicationDiagnosticIdentity,
} from "./replicationDiagnostics";

export const STARTUP_DIAGNOSTIC_STORAGE_KEY = "worshipsync.startup-diagnostics.mode";
export const STARTUP_DIAGNOSTIC_SAMPLE_INTERVAL_MS = 5_000;
const MAX_DIAGNOSTIC_EVENTS = 200;
const RECENT_HEAP_SAMPLE_COUNT = 5;

export const STARTUP_DIAGNOSTIC_MODES = [
  "off",
  "normal",
  "skip-databases",
  "content-only",
  "replication-only",
  "bible-only",
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
const diagnosticAggregates = new Map<string, Record<string, { samples: number; total: number; max: number }>>();
const replicationStats: Record<StartupDatabaseKind, ReplicationStats> = {
  content: { active: 0, batches: 0, documents: 0 },
  bible: { active: 0, batches: 0, documents: 0 },
};
const startedAt = typeof performance === "undefined" ? 0 : performance.now();
const recentHeapSamples: number[] = [];
let eventCursor = 0;
const currentMode: StartupDiagnosticMode = readStoredMode();
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
  if (typeof window === "undefined") return "off";
  try {
    const value = window.sessionStorage.getItem(STARTUP_DIAGNOSTIC_STORAGE_KEY);
    return isStartupDiagnosticMode(value) ? value : "off";
  } catch {
    return "off";
  }
}

export const isStartupDiagnosticsActive = () =>
  currentMode !== "off";

export const isStartupDiagnosticIsolationMode = (mode: StartupDiagnosticMode) =>
  mode === "skip-databases" || mode === "content-only" || mode === "replication-only" || mode === "bible-only";

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
  bible: mode !== "skip-databases" && mode !== "content-only" && mode !== "replication-only",
  sequential: mode === "sequential",
});

export const REPLICATION_OPTIONS = {
  content: { batch_size: 150, batches_limit: 15 },
  bible: { batch_size: 1000, batches_limit: 25 },
} as const;

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

/** Retain lightweight counters and timings without logging every hot-path operation. */
export const recordStartupAggregate = (
  subsystem: string,
  values: Record<string, number>,
) => {
  if (!isStartupDiagnosticsActive()) return;
  const aggregate = diagnosticAggregates.get(subsystem) ?? {};
  for (const [name, value] of Object.entries(values)) {
    if (!Number.isFinite(value)) continue;
    const current = aggregate[name] ?? { samples: 0, total: 0, max: 0 };
    current.samples += 1;
    current.total += value;
    current.max = Math.max(current.max, value);
    aggregate[name] = current;
  }
  diagnosticAggregates.set(subsystem, aggregate);
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
    batchSizeUnit: "changes-feed rows",
    batchesLimitUnit: "queued batches",
    nominalQueuedChangeRows: options.batchSize * options.batchesLimit,
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
  longTasks: {
    count: longTaskCount,
    totalMs: Math.round(longTaskTotalMs),
    maxMs: Math.round(longTaskMaxMs),
  },
  recentEvents: snapshotEvents(),
  ...(() => {
    const replication = getReplicationDiagnosticsSnapshot(currentMode !== "off");
    return {
      expensiveReplicationBatches: replication.expensiveBatches,
      boundedRevisionWriteStatistics: replication.boundedWriteStatistics,
      recoveredInterruptedReplicationBatches: replication.recoveredInterruptedBatches,
    };
  })(),
  aggregates: Object.fromEntries(
    [...diagnosticAggregates].map(([subsystem, metrics]) => [subsystem, { ...metrics }]),
  ),
});

export {
  beginReplicationBatchDiagnostics,
  configureReplicationDiagnosticScope,
  finishReplicationBatchDiagnostics,
  markReplicationBatchCheckpoint,
  recordReplicationWriteTransaction,
};
export type {
  ReplicationBatchDiagnosticToken,
  ReplicationDiagnosticIdentity,
};

export const setStartupDiagnosticMode = (mode: StartupDiagnosticMode) => {
  if (!isStartupDiagnosticMode(mode) || typeof window === "undefined") {
    return false;
  }
  try {
    window.sessionStorage.setItem(STARTUP_DIAGNOSTIC_STORAGE_KEY, mode);
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
}

if (typeof window !== "undefined") {
  const diagnosticsEnabled = isStartupDiagnosticsActive();
  if (diagnosticsEnabled) {
    recordStartupDiagnostic("runtime", "diagnostics.enabled", { mode: currentMode });
  }

  if (diagnosticsEnabled && typeof PerformanceObserver !== "undefined") {
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

  const memory = (performance as Performance & {
    memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
  }).memory;
  heapSupported = Boolean(memory);

  if (diagnosticsEnabled || import.meta.env.PROD) window.setInterval(() => {
    const currentMemory = (performance as Performance & {
      memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
    }).memory;
    const toMb = (bytes: number) => Math.round((bytes / 1024 / 1024) * 10) / 10;
    heapSampleCount += 1;
    heapSupported = Boolean(currentMemory);
    const heapUsedMb = currentMemory ? toMb(currentMemory.usedJSHeapSize) : null;
    heapLimitMb = currentMemory ? toMb(currentMemory.jsHeapSizeLimit) : null;
    if (heapUsedMb !== null) {
      heapPeakUsedMb = heapPeakUsedMb === null
        ? heapUsedMb
        : Math.max(heapPeakUsedMb, heapUsedMb);
      recentHeapSamples.push(heapUsedMb);
      if (recentHeapSamples.length > RECENT_HEAP_SAMPLE_COUNT) {
        recentHeapSamples.shift();
      }
    }
    recordReplicationHeapSample(heapUsedMb);
    recordStartupDiagnostic("runtime", "memory.sample", {
      heapSupported,
      heapUsedMb,
      heapAllocatedMb: currentMemory ? toMb(currentMemory.totalJSHeapSize) : null,
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
