import * as Sentry from "@sentry/react";
import appVersion from "../version.json";
import type {
  RevisionBatchComplexity,
  RevisionDocumentComplexity,
  RevisionWriteMetrics,
  RevisionWriteOutcome,
  RevisionWriteTransaction,
} from "./revisionReplication";

export const REPLICATION_DIAGNOSTIC_STORAGE_PREFIX = "worshipsync.replication-diagnostics";
export const REPLICATION_DIAGNOSTIC_MAX_HISTORY_ENTRIES = 15;
export const REPLICATION_DIAGNOSTIC_MAX_STORAGE_BYTES = 16 * 1024;
export const REPLICATION_DIAGNOSTIC_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
export const REPLICATION_DIAGNOSTIC_STALE_AFTER_MS = 5 * 60 * 1000;
export const REPLICATION_DIAGNOSTIC_ACTIVE_SESSION_MS = 2 * 60 * 1000;
export const REPLICATION_DIAGNOSTIC_WARNING_STALL_MS = 5_000;
export const REPLICATION_DIAGNOSTIC_WARNING_HEAP_DELTA_MB = 100;
export const REPLICATION_DIAGNOSTIC_WARNING_MAX_LEAVES = 25;
export const REPLICATION_DIAGNOSTIC_WARNING_HEAP_MB = 400;
export const REPLICATION_DIAGNOSTIC_WARNING_COMPLEXITY = 8_000;
export const REPLICATION_DIAGNOSTIC_WARNING_HISTORY_DEPTH = 500;

const MAX_DETAIL_BATCHES = 20;
const MAX_SENTRY_EVENTS_PER_SESSION = 5;
const SENTRY_COOLDOWN_MS = 15 * 60 * 1000;
const LEASE_HEARTBEAT_INTERVAL_MS = 30 * 1000;

type DiagnosticScope = {
  scopeHash: string;
  churchHash: string | null;
  deviceHash: string | null;
};

export type ReplicationDiagnosticIdentity = {
  churchId: string;
  accountId: string;
  databaseKey: string;
  deviceId?: string | null;
};

type LocalReplicationBatchEntry = {
  id: string;
  ownerSessionId: string;
  scopeHash: string;
  status: "pending" | "writes-complete" | "complete" | "cancelled" | "failure" | "suspected-interruption";
  startedAt: number;
  updatedAt: number;
  expiresAt: number;
  databaseCategory: string;
  replicationKind: string;
  batchNumber: number;
  pendingChangeRows: number | null;
  uniqueDocumentCount: number;
  totalIncomingLeafRevisions: number;
  maxLeafCountPerDocument: number;
  maxRevisionHistoryDepth: number;
  estimatedMetadataComplexity: number;
  boundedWriteProcessingActivated: boolean;
  processingDurationMs: number | null;
  remoteFetchHeadersDurationMs: number | null;
  indexedDbWriteDurationMs: number | null;
  writeTransactionCount: number | null;
  boundedWriteTransactionCount: number | null;
  maxWriteTransactionSize: number | null;
  heapBeforeMb: number | null;
  heapAfterMb: number | null;
  highestSampledHeapMb: number | null;
  interruptionReportedAt?: number;
};

export type ReplicationBatchDiagnosticSnapshot = {
  id: string;
  batchNumber: number;
  databaseCategory: string;
  replicationKind: string;
  pendingChangeRows: number | null;
  uniqueDocumentCount: number;
  totalIncomingLeafRevisions: number;
  maxLeafCountPerDocument: number;
  maxRevisionHistoryDepth: number;
  estimatedMetadataComplexity: number;
  likelyContributors: RevisionDocumentComplexity[];
  boundedWriteProcessingActivated: boolean;
  processingDurationMs: number | null;
  remoteFetchHeadersDurationMs: number | null;
  writeTransactionCount: number;
  boundedWriteTransactionCount: number;
  boundedRevisionWriteCount: number;
  maxWriteTransactionSize: number;
  totalIndexedDbWriteDurationMs: number;
  maxIndexedDbWriteDurationMs: number;
  heapBeforeMb: number | null;
  heapAfterMb: number | null;
  highestSampledHeapMb: number | null;
  heapSamples: number;
  outcome: LocalReplicationBatchEntry["status"];
};

export type ReplicationBatchDiagnosticToken = {
  id: string;
  batchNumber: number;
  databaseCategory: string;
  replicationKind: string;
  pendingChangeRows: number | null;
  summary: RevisionBatchComplexity;
  diagnosticScope: DiagnosticScope | null;
  scopeGeneration: number;
  boundedWriteProcessingActivated: boolean;
  heapBeforeMb: number | null;
  highestSampledHeapMb: number | null;
  heapSamples: number;
  fetchHeadersDurationMs: number | null;
  localEntryId: string | null;
  detailed: boolean;
  snapshot: ReplicationBatchDiagnosticSnapshot | null;
  metrics: RevisionWriteMetrics;
};

export type ReplicationDiagnosticsSnapshot = {
  expensiveBatches: ReplicationBatchDiagnosticSnapshot[];
  boundedWriteStatistics: {
    batches: number;
    transactions: number;
    revisionWrites: number;
    maxTransactionsPerBatch: number;
  };
  recoveredInterruptedBatches: Array<Pick<
    LocalReplicationBatchEntry,
    | "databaseCategory"
    | "replicationKind"
    | "batchNumber"
    | "uniqueDocumentCount"
    | "totalIncomingLeafRevisions"
    | "maxLeafCountPerDocument"
    | "maxRevisionHistoryDepth"
    | "estimatedMetadataComplexity"
    | "processingDurationMs"
    | "highestSampledHeapMb"
    | "status"
  >>;
};

let diagnosticScope: DiagnosticScope | null = null;
let currentBatchNumber = 0;
let details: ReplicationBatchDiagnosticSnapshot[] = [];
let recoveredBatches: ReplicationDiagnosticsSnapshot["recoveredInterruptedBatches"] = [];
let boundedBatches = 0;
let boundedTransactions = 0;
let boundedRevisionWrites = 0;
let maxTransactionsPerBatch = 0;
const activeLocalEntryIds = new Set<string>();
const reportedSentryEvents = new Map<string, number>();
let sentryEventCount = 0;
let leaseTimer: number | null = null;
let recoveryTimer: number | null = null;
let leaseScopeHash: string | null = null;
let scopeRequestGeneration = 0;
let scopeConfigurationRequest = 0;
let requestedScopeIdentity = "";
const activeDiagnosticTokens = new Set<ReplicationBatchDiagnosticToken>();
const sessionId = createOpaqueSessionId();

function createOpaqueSessionId() {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // Fall back to an ephemeral per-module token when secure random is unavailable.
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

const historyStorageKey = (scopeHash: string) =>
  `${REPLICATION_DIAGNOSTIC_STORAGE_PREFIX}.history:${scopeHash}`;
const activeSessionsStorageKey = (scopeHash: string) =>
  `${REPLICATION_DIAGNOSTIC_STORAGE_PREFIX}.sessions:${scopeHash}`;
const currentTime = () => Date.now();
const rounded = (value: number) => Math.round(value * 10) / 10;

const toMegabytes = (bytes: number) => rounded(bytes / (1024 * 1024));

const readHeapUsedMb = () => {
  if (typeof performance === "undefined") return null;
  const memory = (performance as Performance & {
    memory?: { usedJSHeapSize?: number };
  }).memory;
  return typeof memory?.usedJSHeapSize === "number"
    ? toMegabytes(memory.usedJSHeapSize)
    : null;
};

async function hashIdentifier(value: string) {
  if (!value || typeof crypto === "undefined" || !crypto.subtle || typeof TextEncoder === "undefined") {
    return null;
  }
  try {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return [...new Uint8Array(digest)].slice(0, 12).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

const readLocalJson = <T,>(key: string, fallback: T): T => {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const writeLocalJson = (key: string, value: unknown) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};

const loadLocalHistory = (scopeHash: string) => {
  const now = currentTime();
  const entries = readLocalJson<LocalReplicationBatchEntry[]>(historyStorageKey(scopeHash), []);
  if (!Array.isArray(entries)) return [];
  return entries.filter((entry) =>
    entry && entry.scopeHash === scopeHash &&
    Number.isFinite(entry.startedAt) && entry.expiresAt > now,
  ).slice(-REPLICATION_DIAGNOSTIC_MAX_HISTORY_ENTRIES);
};

const saveLocalHistory = (scopeHash: string, entries: LocalReplicationBatchEntry[]) => {
  const now = currentTime();
  const storageKey = historyStorageKey(scopeHash);
  let retained = entries
    .filter((entry) => entry.expiresAt > now)
    .slice(-REPLICATION_DIAGNOSTIC_MAX_HISTORY_ENTRIES);
  let serialized = JSON.stringify(retained);
  while (
    retained.length > 0 &&
    (serialized.length + storageKey.length) * 2 > REPLICATION_DIAGNOSTIC_MAX_STORAGE_BYTES
  ) {
    retained = retained.slice(1);
    serialized = JSON.stringify(retained);
  }
  if (retained.length === 0) {
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // Storage cleanup is best effort.
    }
    return;
  }
  try {
    window.localStorage.setItem(storageKey, serialized);
  } catch {
    // Storage failures must not affect synchronization.
  }
};

const readActiveSessions = (scopeHash: string) => {
  const sessions = readLocalJson<Record<string, number>>(activeSessionsStorageKey(scopeHash), {});
  if (!sessions || typeof sessions !== "object" || Array.isArray(sessions)) return {};
  const now = currentTime();
  return Object.fromEntries(Object.entries(sessions).filter(([, seenAt]) =>
    Number.isFinite(seenAt) && now - seenAt < REPLICATION_DIAGNOSTIC_ACTIVE_SESSION_MS,
  ));
};

const touchActiveSession = (scopeHash: string) => {
  if (typeof window === "undefined") return;
  const sessions = readActiveSessions(scopeHash);
  sessions[sessionId] = currentTime();
  writeLocalJson(activeSessionsStorageKey(scopeHash), sessions);
};

const releaseActiveSession = (scopeHash: string) => {
  if (typeof window === "undefined") return;
  const sessions = readActiveSessions(scopeHash);
  delete sessions[sessionId];
  if (Object.keys(sessions).length === 0) {
    try {
      window.localStorage.removeItem(activeSessionsStorageKey(scopeHash));
    } catch {
      // Storage cleanup is best effort.
    }
  } else {
    writeLocalJson(activeSessionsStorageKey(scopeHash), sessions);
  }
};

const retireDiagnosticScope = (scopeHash: string) => {
  if (typeof window === "undefined") return;
  const entries = loadLocalHistory(scopeHash).map((entry) =>
    entry.ownerSessionId === sessionId &&
    (entry.status === "pending" || entry.status === "writes-complete")
      ? { ...entry, status: "cancelled" as const, updatedAt: currentTime() }
      : entry,
  );
  saveLocalHistory(scopeHash, entries);
  releaseActiveSession(scopeHash);
  if (Object.keys(readActiveSessions(scopeHash)).length > 0) return;
  try {
    window.localStorage.removeItem(historyStorageKey(scopeHash));
  } catch {
    // Diagnostic cleanup must not affect synchronization.
  }
};

const keepSessionLease = (scopeHash: string) => {
  leaseScopeHash = scopeHash;
  touchActiveSession(scopeHash);
  if (leaseTimer === null && typeof window !== "undefined") {
    leaseTimer = window.setInterval(() => {
      if (leaseScopeHash) touchActiveSession(leaseScopeHash);
    }, LEASE_HEARTBEAT_INTERVAL_MS);
  }
};

const releaseSessionLeaseIfIdle = () => {
  if (activeLocalEntryIds.size > 0 || !leaseScopeHash) return;
  const scopeHash = leaseScopeHash;
  leaseScopeHash = null;
  if (leaseTimer !== null && typeof window !== "undefined") {
    window.clearInterval(leaseTimer);
    leaseTimer = null;
  }
  releaseActiveSession(scopeHash);
};

const scheduleInterruptedBatchRecoveryCheck = (
  identity: ReplicationDiagnosticIdentity,
  generation: number,
  entries: LocalReplicationBatchEntry[],
  activeSessions: Record<string, number>,
) => {
  if (recoveryTimer !== null && typeof window !== "undefined") {
    window.clearTimeout(recoveryTimer);
    recoveryTimer = null;
  }
  if (typeof window === "undefined") return;
  const now = currentTime();
  const nextCheckAt = entries.reduce((soonest, entry) => {
    if (
      (entry.status !== "pending" && entry.status !== "writes-complete") ||
      entry.interruptionReportedAt
    ) return soonest;
    const staleAt = entry.updatedAt + REPLICATION_DIAGNOSTIC_STALE_AFTER_MS;
    const activeUntil = (activeSessions[entry.ownerSessionId] ?? 0) +
      REPLICATION_DIAGNOSTIC_ACTIVE_SESSION_MS;
    return Math.min(soonest, Math.max(staleAt, activeUntil + 1));
  }, Number.POSITIVE_INFINITY);
  if (!Number.isFinite(nextCheckAt)) return;
  recoveryTimer = window.setTimeout(() => {
    if (generation !== scopeRequestGeneration) return;
    void configureReplicationDiagnosticScope(identity);
  }, Math.max(1_000, nextCheckAt - now));
};

const toRecoveredSnapshot = (
  entry: LocalReplicationBatchEntry,
): ReplicationDiagnosticsSnapshot["recoveredInterruptedBatches"][number] => ({
  databaseCategory: entry.databaseCategory,
  replicationKind: entry.replicationKind,
  batchNumber: entry.batchNumber,
  uniqueDocumentCount: entry.uniqueDocumentCount,
  totalIncomingLeafRevisions: entry.totalIncomingLeafRevisions,
  maxLeafCountPerDocument: entry.maxLeafCountPerDocument,
  maxRevisionHistoryDepth: entry.maxRevisionHistoryDepth,
  estimatedMetadataComplexity: entry.estimatedMetadataComplexity,
  processingDurationMs: entry.processingDurationMs,
  highestSampledHeapMb: entry.highestSampledHeapMb,
  status: entry.status,
});

export const configureReplicationDiagnosticScope = async (
  identity: ReplicationDiagnosticIdentity,
) => {
  const configurationRequest = ++scopeConfigurationRequest;
  const requestIdentity = JSON.stringify([
    identity.churchId || "guest",
    identity.accountId || "anonymous",
    identity.databaseKey.toLowerCase(),
  ]);
  if (requestedScopeIdentity !== requestIdentity) {
    requestedScopeIdentity = requestIdentity;
    scopeRequestGeneration += 1;
    details = [];
    recoveredBatches = [];
    boundedBatches = 0;
    boundedTransactions = 0;
    boundedRevisionWrites = 0;
    maxTransactionsPerBatch = 0;
    const oldScopeHash = diagnosticScope?.scopeHash ?? leaseScopeHash;
    activeDiagnosticTokens.clear();
    activeLocalEntryIds.clear();
    if (leaseTimer !== null && typeof window !== "undefined") {
      window.clearInterval(leaseTimer);
      leaseTimer = null;
    }
    if (recoveryTimer !== null && typeof window !== "undefined") {
      window.clearTimeout(recoveryTimer);
      recoveryTimer = null;
    }
    const retiringScopeHash = leaseScopeHash ?? oldScopeHash;
    if (retiringScopeHash) retireDiagnosticScope(retiringScopeHash);
    leaseScopeHash = null;
    diagnosticScope = null;
  }
  const generation = scopeRequestGeneration;
  const [scopeHash, churchHash, deviceHash] = await Promise.all([
    hashIdentifier(JSON.stringify([
      identity.churchId || "guest",
      identity.accountId || "anonymous",
      identity.databaseKey.toLowerCase(),
    ])),
    hashIdentifier(identity.churchId),
    hashIdentifier(identity.deviceId || ""),
  ]);
  if (generation !== scopeRequestGeneration) {
    if (scopeHash) retireDiagnosticScope(scopeHash);
    return { recoveredInterruptedBatches: 0 };
  }
  if (configurationRequest !== scopeConfigurationRequest) return { recoveredInterruptedBatches: 0 };
  if (!scopeHash) return { recoveredInterruptedBatches: 0 };

  if (diagnosticScope?.scopeHash !== scopeHash) {
    details = [];
    recoveredBatches = [];
    boundedBatches = 0;
    boundedTransactions = 0;
    boundedRevisionWrites = 0;
    maxTransactionsPerBatch = 0;
  }
  diagnosticScope = { scopeHash, churchHash, deviceHash };

  if (typeof window === "undefined") return { recoveredInterruptedBatches: 0 };
  const now = currentTime();
  const activeSessions = readActiveSessions(scopeHash);
  const entries = loadLocalHistory(scopeHash);
  let recovered = 0;
  const updated = entries.map((entry) => {
    const pending = entry.status === "pending" || entry.status === "writes-complete";
    const stale = now - entry.updatedAt >= REPLICATION_DIAGNOSTIC_STALE_AFTER_MS;
    const activeOwner = now - (activeSessions[entry.ownerSessionId] ?? 0) < REPLICATION_DIAGNOSTIC_ACTIVE_SESSION_MS;
    if (!pending || !stale || activeOwner || entry.interruptionReportedAt) return entry;

    recovered += 1;
    const suspected: LocalReplicationBatchEntry = {
      ...entry,
      status: "suspected-interruption",
      updatedAt: now,
      interruptionReportedAt: now,
    };
    recoveredBatches.push(toRecoveredSnapshot(suspected));
    reportReplicationSentryEvent("interrupted", {
      databaseCategory: entry.databaseCategory,
      replicationKind: entry.replicationKind,
      batchNumber: entry.batchNumber,
      pendingChangeRows: entry.pendingChangeRows,
      uniqueDocumentCount: entry.uniqueDocumentCount,
      totalIncomingLeafRevisions: entry.totalIncomingLeafRevisions,
      maxLeafCountPerDocument: entry.maxLeafCountPerDocument,
      maxRevisionHistoryDepth: entry.maxRevisionHistoryDepth,
      estimatedMetadataComplexity: entry.estimatedMetadataComplexity,
      boundedWriteProcessingActivated: entry.boundedWriteProcessingActivated,
      processingDurationMs: entry.processingDurationMs,
      remoteFetchHeadersDurationMs: entry.remoteFetchHeadersDurationMs,
      indexedDbWriteDurationMs: entry.indexedDbWriteDurationMs,
      writeTransactionCount: entry.writeTransactionCount,
      boundedWriteTransactionCount: entry.boundedWriteTransactionCount,
      maxWriteTransactionSize: entry.maxWriteTransactionSize,
      heapBeforeMb: entry.heapBeforeMb,
      heapAfterMb: entry.heapAfterMb,
      highestSampledHeapMb: entry.highestSampledHeapMb,
      outcome: "suspected-interruption",
    }, "warning");
    return suspected;
  });
  saveLocalHistory(scopeHash, updated);
  scheduleInterruptedBatchRecoveryCheck(identity, generation, updated, activeSessions);
  return { recoveredInterruptedBatches: recovered };
};

function createLocalEntry(
  token: ReplicationBatchDiagnosticToken,
): LocalReplicationBatchEntry | null {
  if (!diagnosticScope || typeof window === "undefined") return null;
  const now = currentTime();
  const summary = token.summary;
  return {
    id: token.id,
    ownerSessionId: sessionId,
    scopeHash: diagnosticScope.scopeHash,
    status: "pending",
    startedAt: now,
    updatedAt: now,
    expiresAt: now + REPLICATION_DIAGNOSTIC_RETENTION_MS,
    databaseCategory: token.databaseCategory,
    replicationKind: token.replicationKind,
    batchNumber: token.batchNumber,
    pendingChangeRows: token.pendingChangeRows,
    uniqueDocumentCount: summary.uniqueDocumentCount,
    totalIncomingLeafRevisions: summary.incomingLeafRevisionCount,
    maxLeafCountPerDocument: summary.maxLeafCountPerDocument,
    maxRevisionHistoryDepth: summary.maxRevisionHistoryDepth,
    estimatedMetadataComplexity: summary.estimatedMetadataComplexity,
    boundedWriteProcessingActivated: token.boundedWriteProcessingActivated,
    processingDurationMs: null,
    remoteFetchHeadersDurationMs: token.fetchHeadersDurationMs,
    indexedDbWriteDurationMs: null,
    writeTransactionCount: null,
    boundedWriteTransactionCount: null,
    maxWriteTransactionSize: null,
    heapBeforeMb: token.heapBeforeMb,
    heapAfterMb: null,
    highestSampledHeapMb: token.highestSampledHeapMb,
  };
}

const upsertLocalEntry = (
  token: ReplicationBatchDiagnosticToken,
  update: Partial<LocalReplicationBatchEntry>,
) => {
  if (!diagnosticScope || !token.localEntryId || typeof window === "undefined") return;
  const entries = loadLocalHistory(diagnosticScope.scopeHash);
  const index = entries.findIndex((entry) => entry.id === token.localEntryId);
  if (index < 0) return;
  entries[index] = { ...entries[index], ...update, updatedAt: currentTime() };
  saveLocalHistory(diagnosticScope.scopeHash, entries);
};

function getRuntimeContext(scope: DiagnosticScope | null = diagnosticScope) {
  const nav = typeof navigator === "undefined" ? null : navigator as Navigator & { deviceMemory?: number };
  return {
    applicationVersion: appVersion.version,
    browser: nav?.userAgent?.slice(0, 200) ?? null,
    platform: nav?.platform?.slice(0, 80) ?? null,
    availableDeviceMemoryGiB: typeof nav?.deviceMemory === "number" ? nav.deviceMemory : null,
    churchIdentifierHash: scope?.churchHash ?? null,
    deviceIdentifierHash: scope?.deviceHash ?? null,
  };
}

function reportReplicationSentryEvent(
  issue: "performance" | "failure" | "interrupted",
  context: Record<string, string | number | boolean | null>,
  level: "warning" | "error",
  diagnosticIdentity: DiagnosticScope | null = diagnosticScope,
) {
  if (!import.meta.env.PROD) return false;
  const now = currentTime();
  const dedupeKey = `${diagnosticIdentity?.scopeHash ?? "unknown"}:${context.databaseCategory ?? "unknown"}:${issue}`;
  const lastSentAt = reportedSentryEvents.get(dedupeKey) ?? 0;
  if (now - lastSentAt < SENTRY_COOLDOWN_MS || sentryEventCount >= MAX_SENTRY_EVENTS_PER_SESSION) {
    return false;
  }
  reportedSentryEvents.set(dedupeKey, now);
  sentryEventCount += 1;
  const message = issue === "failure"
    ? "WorshipSync initial content replication batch failed"
    : issue === "interrupted"
      ? "WorshipSync startup found a suspected interrupted expensive replication batch"
      : "WorshipSync detected an expensive initial content replication batch";
  try {
    Sentry.withScope((sentryScope) => {
      sentryScope.setLevel(level);
      sentryScope.setTag("failure_type", "replication_performance");
      sentryScope.setTag("database_category", String(context.databaseCategory ?? "unknown"));
      sentryScope.setTag("replication_kind", String(context.replicationKind ?? "unknown"));
      sentryScope.setTag("replication_issue", issue);
      sentryScope.setContext("runtime", getRuntimeContext(diagnosticIdentity));
      sentryScope.setContext("replication_batch", context);
      Sentry.captureMessage(message, level);
    });
  } catch {
    // Optional monitoring must not change synchronization behavior.
  }
  return true;
}

export const beginReplicationBatchDiagnostics = (
  summary: RevisionBatchComplexity,
  boundedWriteProcessingActivated: boolean,
  options: {
    databaseCategory: string;
    replicationKind: string;
    pendingChangeRows?: number | null;
    fetchHeadersDurationMs?: number | null;
    detailed: boolean;
  },
): ReplicationBatchDiagnosticToken => {
  const batchNumber = ++currentBatchNumber;
  const id = createOpaqueSessionId();
  const heapBeforeMb = readHeapUsedMb();
  const candidate = boundedWriteProcessingActivated ||
    summary.maxLeafCountPerDocument >= REPLICATION_DIAGNOSTIC_WARNING_MAX_LEAVES ||
    summary.estimatedMetadataComplexity >= REPLICATION_DIAGNOSTIC_WARNING_COMPLEXITY ||
    summary.maxRevisionHistoryDepth >= REPLICATION_DIAGNOSTIC_WARNING_HISTORY_DEPTH ||
    (heapBeforeMb ?? 0) >= REPLICATION_DIAGNOSTIC_WARNING_HEAP_MB;
  const metrics: RevisionWriteMetrics = {
    processingDurationMs: 0,
    writeTransactionCount: 0,
    boundedWriteTransactionCount: 0,
    boundedRevisionWriteCount: 0,
    maxWriteTransactionSize: 0,
    totalWriteDurationMs: 0,
    maxWriteDurationMs: 0,
  };
  const token: ReplicationBatchDiagnosticToken = {
    id,
    batchNumber,
    databaseCategory: options.databaseCategory,
    replicationKind: options.replicationKind,
    pendingChangeRows: Number.isFinite(options.pendingChangeRows) ? Number(options.pendingChangeRows) : null,
    summary,
    diagnosticScope,
    scopeGeneration: scopeRequestGeneration,
    boundedWriteProcessingActivated,
    heapBeforeMb,
    highestSampledHeapMb: heapBeforeMb,
    heapSamples: heapBeforeMb === null ? 0 : 1,
    fetchHeadersDurationMs: Number.isFinite(options.fetchHeadersDurationMs)
      ? Number(options.fetchHeadersDurationMs)
      : null,
    localEntryId: candidate ? id : null,
    detailed: options.detailed,
    snapshot: null,
    metrics,
  };

  if (boundedWriteProcessingActivated) boundedBatches += 1;
  if (candidate && diagnosticScope) {
    const localEntry = createLocalEntry(token);
    if (localEntry) {
      const entries = loadLocalHistory(diagnosticScope.scopeHash);
      entries.push(localEntry);
      saveLocalHistory(diagnosticScope.scopeHash, entries);
      activeLocalEntryIds.add(id);
      keepSessionLease(diagnosticScope.scopeHash);
    }
  }

  if (options.detailed && candidate) {
    const entry: ReplicationBatchDiagnosticSnapshot = {
      id,
      batchNumber,
      databaseCategory: options.databaseCategory,
      replicationKind: options.replicationKind,
      pendingChangeRows: token.pendingChangeRows,
      uniqueDocumentCount: summary.uniqueDocumentCount,
      totalIncomingLeafRevisions: summary.incomingLeafRevisionCount,
      maxLeafCountPerDocument: summary.maxLeafCountPerDocument,
      maxRevisionHistoryDepth: summary.maxRevisionHistoryDepth,
      estimatedMetadataComplexity: summary.estimatedMetadataComplexity,
      likelyContributors: summary.likelyContributors.map((document) => ({ ...document })),
      boundedWriteProcessingActivated,
      processingDurationMs: null,
      remoteFetchHeadersDurationMs: token.fetchHeadersDurationMs,
      writeTransactionCount: 0,
      boundedWriteTransactionCount: 0,
      boundedRevisionWriteCount: 0,
      maxWriteTransactionSize: 0,
      totalIndexedDbWriteDurationMs: 0,
      maxIndexedDbWriteDurationMs: 0,
      heapBeforeMb,
      heapAfterMb: null,
      highestSampledHeapMb: heapBeforeMb,
      heapSamples: token.heapSamples,
      outcome: "pending",
    };
    details.push(entry);
    if (details.length > MAX_DETAIL_BATCHES) details = details.slice(-MAX_DETAIL_BATCHES);
    token.snapshot = entry;
  }

  activeDiagnosticTokens.add(token);
  return token;
};

/** Feed the existing startup sampler into active batch diagnostics. */
export const recordReplicationHeapSample = (heapUsedMb: number | null) => {
  if (heapUsedMb === null || !Number.isFinite(heapUsedMb)) return;
  for (const token of activeDiagnosticTokens) {
    token.heapSamples += 1;
    token.highestSampledHeapMb = Math.max(token.highestSampledHeapMb ?? heapUsedMb, heapUsedMb);
  }
};

export const recordReplicationWriteTransaction = (
  token: ReplicationBatchDiagnosticToken,
  transaction: RevisionWriteTransaction,
) => {
  token.metrics.writeTransactionCount += 1;
  token.metrics.boundedWriteTransactionCount += transaction.bounded ? 1 : 0;
  token.metrics.boundedRevisionWriteCount += transaction.bounded ? transaction.documentCount : 0;
  token.metrics.maxWriteTransactionSize = Math.max(token.metrics.maxWriteTransactionSize, transaction.documentCount);
  token.metrics.totalWriteDurationMs += transaction.durationMs;
  token.metrics.maxWriteDurationMs = Math.max(token.metrics.maxWriteDurationMs, transaction.durationMs);
};

const updateDetailedSnapshot = (
  token: ReplicationBatchDiagnosticToken,
  metrics: RevisionWriteMetrics,
  heapAfterMb: number | null,
  outcome: ReplicationBatchDiagnosticSnapshot["outcome"],
) => {
  const entry = token.snapshot;
  if (!entry) return;
  entry.processingDurationMs = rounded(metrics.processingDurationMs);
  entry.writeTransactionCount = metrics.writeTransactionCount;
  entry.boundedWriteTransactionCount = metrics.boundedWriteTransactionCount;
  entry.boundedRevisionWriteCount = metrics.boundedRevisionWriteCount;
  entry.maxWriteTransactionSize = metrics.maxWriteTransactionSize;
  entry.totalIndexedDbWriteDurationMs = rounded(metrics.totalWriteDurationMs);
  entry.maxIndexedDbWriteDurationMs = rounded(metrics.maxWriteDurationMs);
  entry.heapAfterMb = heapAfterMb;
  entry.highestSampledHeapMb = token.highestSampledHeapMb;
  entry.heapSamples = token.heapSamples;
  entry.outcome = outcome;
  const index = details.findIndex((item) => item.id === token.id);
  if (index >= 0) details[index] = entry;
};

export const finishReplicationBatchDiagnostics = (
  token: ReplicationBatchDiagnosticToken,
  _summary: RevisionBatchComplexity,
  metrics: RevisionWriteMetrics,
  outcome: RevisionWriteOutcome,
) => {
  activeDiagnosticTokens.delete(token);
  if (token.scopeGeneration !== scopeRequestGeneration) return;
  const heapAfterMb = readHeapUsedMb();
  if (heapAfterMb !== null) {
    token.heapSamples += 1;
    token.highestSampledHeapMb = Math.max(token.highestSampledHeapMb ?? heapAfterMb, heapAfterMb);
  }
  token.metrics = { ...metrics };
  const heapIncreaseMb = token.heapBeforeMb === null || heapAfterMb === null
    ? null
    : rounded(heapAfterMb - token.heapBeforeMb);
  const significant = metrics.processingDurationMs >= REPLICATION_DIAGNOSTIC_WARNING_STALL_MS ||
    (heapIncreaseMb ?? 0) >= REPLICATION_DIAGNOSTIC_WARNING_HEAP_DELTA_MB ||
    Math.max(token.highestSampledHeapMb ?? 0, heapAfterMb ?? 0) >= REPLICATION_DIAGNOSTIC_WARNING_HEAP_MB ||
    token.summary.maxLeafCountPerDocument >= REPLICATION_DIAGNOSTIC_WARNING_MAX_LEAVES ||
    token.summary.estimatedMetadataComplexity >= REPLICATION_DIAGNOSTIC_WARNING_COMPLEXITY ||
    token.summary.maxRevisionHistoryDepth >= REPLICATION_DIAGNOSTIC_WARNING_HISTORY_DEPTH;
  const historyStatus = outcome === "complete" ? "writes-complete" : outcome === "cancelled" ? "cancelled" : "failure";

  updateDetailedSnapshot(token, metrics, heapAfterMb, historyStatus);
  if (token.boundedWriteProcessingActivated) {
    boundedTransactions += metrics.boundedWriteTransactionCount;
    boundedRevisionWrites += metrics.boundedRevisionWriteCount;
    maxTransactionsPerBatch = Math.max(maxTransactionsPerBatch, metrics.boundedWriteTransactionCount);
  }

  const localUpdate: Partial<LocalReplicationBatchEntry> = {
    status: historyStatus,
    processingDurationMs: rounded(metrics.processingDurationMs),
    indexedDbWriteDurationMs: rounded(metrics.totalWriteDurationMs),
    writeTransactionCount: metrics.writeTransactionCount,
    boundedWriteTransactionCount: metrics.boundedWriteTransactionCount,
    maxWriteTransactionSize: metrics.maxWriteTransactionSize,
    heapAfterMb,
    highestSampledHeapMb: token.highestSampledHeapMb,
  };
  upsertLocalEntry(token, localUpdate);
  if (historyStatus !== "writes-complete") {
    activeLocalEntryIds.delete(token.id);
    releaseSessionLeaseIfIdle();
  }

  if (outcome === "failure" || significant) {
    const safeContext = {
      databaseCategory: token.databaseCategory,
      replicationKind: token.replicationKind,
      batchNumber: token.batchNumber,
      pendingChangeRows: token.pendingChangeRows,
      uniqueDocumentCount: token.summary.uniqueDocumentCount,
      totalIncomingLeafRevisions: token.summary.incomingLeafRevisionCount,
      maxLeafCountPerDocument: token.summary.maxLeafCountPerDocument,
      maxRevisionHistoryDepth: token.summary.maxRevisionHistoryDepth,
      estimatedMetadataComplexity: token.summary.estimatedMetadataComplexity,
      remoteFetchHeadersDurationMs: token.fetchHeadersDurationMs,
      processingDurationMs: rounded(metrics.processingDurationMs),
      indexedDbWriteDurationMs: rounded(metrics.totalWriteDurationMs),
      maxIndexedDbWriteDurationMs: rounded(metrics.maxWriteDurationMs),
      heapBeforeMb: token.heapBeforeMb,
      heapAfterMb,
      highestSampledHeapMb: token.highestSampledHeapMb,
      heapIncreaseMb,
      heapSamples: token.heapSamples,
      boundedWriteProcessingActivated: token.boundedWriteProcessingActivated,
      writeTransactionCount: metrics.writeTransactionCount,
      boundedWriteTransactionCount: metrics.boundedWriteTransactionCount,
      boundedRevisionWriteCount: metrics.boundedRevisionWriteCount,
      maxWriteTransactionSize: metrics.maxWriteTransactionSize,
      outcome: historyStatus,
    };
    reportReplicationSentryEvent(
      outcome === "failure" ? "failure" : "performance",
      safeContext,
      outcome === "failure" ? "error" : "warning",
      token.diagnosticScope,
    );
  }
};

export const markReplicationBatchCheckpoint = (
  token: ReplicationBatchDiagnosticToken,
  outcome: "complete" | "cancelled" | "failure" = "complete",
) => {
  if (token.scopeGeneration !== scopeRequestGeneration) return;
  const status = outcome === "complete" ? "complete" : outcome;
  if (token.snapshot) {
    token.snapshot.outcome = status;
    const index = details.findIndex((item) => item.id === token.id);
    if (index >= 0) details[index] = token.snapshot;
  }
  if (diagnosticScope && token.localEntryId) {
    upsertLocalEntry(token, { status });
    activeLocalEntryIds.delete(token.id);
    releaseSessionLeaseIfIdle();
  }
};

export const getReplicationDiagnosticsSnapshot = (
  detailed: boolean,
): ReplicationDiagnosticsSnapshot => ({
  expensiveBatches: detailed ? details.map((entry) => ({
    ...entry,
    likelyContributors: entry.likelyContributors.map((document) => ({ ...document })),
  })) : [],
  boundedWriteStatistics: {
    batches: detailed ? boundedBatches : 0,
    transactions: detailed ? boundedTransactions : 0,
    revisionWrites: detailed ? boundedRevisionWrites : 0,
    maxTransactionsPerBatch: detailed ? maxTransactionsPerBatch : 0,
  },
  recoveredInterruptedBatches: detailed ? recoveredBatches.map((entry) => ({ ...entry })) : [],
});

