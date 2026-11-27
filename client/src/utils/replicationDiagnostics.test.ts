import * as Sentry from "@sentry/react";
import { webcrypto } from "crypto";
import {
  beginReplicationBatchDiagnostics,
  configureReplicationDiagnosticScope,
  finishReplicationBatchDiagnostics,
  getReplicationDiagnosticsSnapshot,
  markReplicationBatchCheckpoint,
  REPLICATION_DIAGNOSTIC_MAX_HISTORY_ENTRIES,
  REPLICATION_DIAGNOSTIC_MAX_STORAGE_BYTES,
  REPLICATION_DIAGNOSTIC_RETENTION_MS,
  REPLICATION_DIAGNOSTIC_STALE_AFTER_MS,
  REPLICATION_DIAGNOSTIC_WARNING_COMPLEXITY,
  REPLICATION_DIAGNOSTIC_WARNING_HEAP_DELTA_MB,
  REPLICATION_DIAGNOSTIC_WARNING_HEAP_MB,
  REPLICATION_DIAGNOSTIC_WARNING_HISTORY_DEPTH,
  REPLICATION_DIAGNOSTIC_WARNING_MAX_LEAVES,
  REPLICATION_DIAGNOSTIC_WARNING_STALL_MS,
  recordReplicationHeapSample,
} from "./replicationDiagnostics";
import {
  planRevisionWrites,
  type RevisionWriteMetrics,
} from "./revisionReplication";

jest.mock("@sentry/react", () => ({
  withScope: jest.fn((callback: (scope: unknown) => unknown) => callback({
    setLevel: jest.fn(),
    setTag: jest.fn(),
    setContext: jest.fn((...args: unknown[]) => {
      (globalThis as typeof globalThis & { __replicationSentryContexts?: unknown[][] })
        .__replicationSentryContexts?.push(args);
    }),
  })),
  captureMessage: jest.fn(),
}));

const scopeA = {
  churchId: "church-private-a",
  accountId: "account-private-a",
  databaseKey: "database-private-a",
  deviceId: "device-private-a",
};

const expensiveSummary = (documentId = "document-private") =>
  planRevisionWrites(Array.from({ length: 8 }, (_, index) => ({
    _id: documentId,
    _rev: `1000-revision-${index}`,
    _revisions: {
      start: 1000,
      ids: Array.from({ length: 1000 }, (_, historyIndex) => `history-${historyIndex}`),
    },
    type: "credits",
    lyrics: "private document body",
  }))).summary;

const metrics = (overrides: Partial<RevisionWriteMetrics> = {}): RevisionWriteMetrics => ({
  processingDurationMs: 100,
  writeTransactionCount: 2,
  boundedWriteTransactionCount: 2,
  boundedRevisionWriteCount: 8,
  maxWriteTransactionSize: 4,
  totalWriteDurationMs: 50,
  maxWriteDurationMs: 30,
  ...overrides,
});

const historyStorageEntries = () => Array.from(
  { length: window.localStorage.length },
  (_, index) => window.localStorage.key(index),
).filter((key): key is string => Boolean(key?.startsWith("worshipsync.replication-diagnostics.history:")));

const historyFor = (key: string) => {
  const storageKey = historyStorageEntries().find((entry) => entry.endsWith(key));
  return storageKey ? JSON.parse(window.localStorage.getItem(storageKey) ?? "[]") : [];
};

describe("replication batch diagnostics", () => {
  beforeEach(async () => {
    window.localStorage.clear();
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto });
    await configureReplicationDiagnosticScope(scopeA);
  });

  afterEach(async () => {
    await configureReplicationDiagnosticScope({
      ...scopeA,
      churchId: `cleanup-${Date.now()}`,
      accountId: `cleanup-account-${Date.now()}`,
      databaseKey: `cleanup-database-${Date.now()}`,
    });
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("records detailed likely contributors only in the in-memory diagnostic snapshot", () => {
    const token = beginReplicationBatchDiagnostics(expensiveSummary(), true, {
      databaseCategory: "content",
      replicationKind: "initial-pull",
      pendingChangeRows: 42,
      fetchHeadersDurationMs: 12.5,
      detailed: true,
    });

    finishReplicationBatchDiagnostics(token, token.summary, metrics(), "complete");
    const detailed = getReplicationDiagnosticsSnapshot(true).expensiveBatches[0];
    const storedText = window.localStorage.getItem(historyStorageEntries()[0]) ?? "";

    expect(detailed).toMatchObject({
      databaseCategory: "content",
      replicationKind: "initial-pull",
      pendingChangeRows: 42,
      totalIncomingLeafRevisions: 8,
      maxLeafCountPerDocument: 8,
      maxRevisionHistoryDepth: 1000,
      estimatedMetadataComplexity: 8000,
      boundedWriteProcessingActivated: true,
      remoteFetchHeadersDurationMs: 12.5,
      outcome: "writes-complete",
    });
    expect(detailed.likelyContributors[0]).toMatchObject({
      documentId: "document-private",
      documentType: "credits",
      incomingLeafRevisionCount: 8,
      maxRevisionHistoryDepth: 1000,
    });
    expect(storedText).not.toContain("document-private");
    expect(storedText).not.toContain("private document body");
    expect(getReplicationDiagnosticsSnapshot(false).expensiveBatches).toEqual([]);
    markReplicationBatchCheckpoint(token);
  });

  it("caps diagnostic history by entry count, bytes, and retention", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-11-27T12:00:00Z"));
    for (let index = 0; index < 24; index += 1) {
      const token = beginReplicationBatchDiagnostics(expensiveSummary(`private-${index}`), true, {
        databaseCategory: "content",
        replicationKind: "initial-pull",
        detailed: false,
      });
      finishReplicationBatchDiagnostics(token, token.summary, metrics(), "complete");
      markReplicationBatchCheckpoint(token);
    }

    const storedKey = historyStorageEntries()[0];
    const storedText = storedKey ? window.localStorage.getItem(storedKey) ?? "" : "";
    const entries = JSON.parse(storedText);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.length).toBeLessThanOrEqual(REPLICATION_DIAGNOSTIC_MAX_HISTORY_ENTRIES);
    expect((storedText.length + storedKey!.length) * 2)
      .toBeLessThanOrEqual(REPLICATION_DIAGNOSTIC_MAX_STORAGE_BYTES);
    expect(entries.every((entry: { expiresAt: number }) =>
      entry.expiresAt - Date.now() === REPLICATION_DIAGNOSTIC_RETENTION_MS)).toBe(true);

    const expiredEntry = { ...entries[0], expiresAt: Date.now() - 1 };
    entries[0] = expiredEntry;
    window.localStorage.setItem(storedKey!, JSON.stringify(entries));
    await configureReplicationDiagnosticScope(scopeA);
    expect(historyFor(storedKey!.split(":").at(-1)!)).toHaveLength(entries.length - 1);
  });

  it("treats stale pending writes as suspected interruptions once and respects other active tabs", async () => {
    const token = beginReplicationBatchDiagnostics(expensiveSummary(), true, {
      databaseCategory: "content",
      replicationKind: "initial-pull",
      detailed: false,
    });
    const historyKey = historyStorageEntries()[0];
    const sessionKey = Array.from(
      { length: window.localStorage.length },
      (_, index) => window.localStorage.key(index),
    ).find((key) => key?.includes(".sessions:"));
    const entries = JSON.parse(window.localStorage.getItem(historyKey) ?? "[]");
    entries[0].updatedAt = Date.now() - REPLICATION_DIAGNOSTIC_STALE_AFTER_MS - 1;
    window.localStorage.setItem(historyKey, JSON.stringify(entries));

    await configureReplicationDiagnosticScope(scopeA);
    expect(getReplicationDiagnosticsSnapshot(true).recoveredInterruptedBatches).toHaveLength(0);

    if (sessionKey) window.localStorage.removeItem(sessionKey);
    const { recoveredInterruptedBatches } = await configureReplicationDiagnosticScope(scopeA);
    expect(recoveredInterruptedBatches).toBe(1);
    expect(getReplicationDiagnosticsSnapshot(true).recoveredInterruptedBatches[0].status)
      .toBe("suspected-interruption");
    expect(await configureReplicationDiagnosticScope(scopeA)).toEqual({
      recoveredInterruptedBatches: 0,
    });

    markReplicationBatchCheckpoint(token, "cancelled");
  });

  it("rechecks an incomplete batch after startup until it can be classified", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-11-27T12:00:00Z"));
    const token = beginReplicationBatchDiagnostics(expensiveSummary(), true, {
      databaseCategory: "content",
      replicationKind: "initial-pull",
      detailed: false,
    });
    const historyKey = historyStorageEntries()[0];
    const sessionKey = Array.from(
      { length: window.localStorage.length },
      (_, index) => window.localStorage.key(index),
    ).find((key) => key?.includes(".sessions:"));
    const entries = JSON.parse(window.localStorage.getItem(historyKey) ?? "[]");
    entries[0].updatedAt = Date.now() - REPLICATION_DIAGNOSTIC_STALE_AFTER_MS + 1_500;
    window.localStorage.setItem(historyKey, JSON.stringify(entries));
    if (sessionKey) window.localStorage.removeItem(sessionKey);

    await configureReplicationDiagnosticScope(scopeA);
    expect(getReplicationDiagnosticsSnapshot(true).recoveredInterruptedBatches).toHaveLength(0);
    await jest.advanceTimersByTimeAsync(2_000);
    await Promise.resolve();

    expect(getReplicationDiagnosticsSnapshot(true).recoveredInterruptedBatches).toHaveLength(1);
    markReplicationBatchCheckpoint(token, "cancelled");
  });

  it("clears the prior church history and ignores a batch that finishes after a scope switch", async () => {
    const token = beginReplicationBatchDiagnostics(expensiveSummary(), true, {
      databaseCategory: "content",
      replicationKind: "initial-pull",
      detailed: true,
    });
    const oldHistoryKey = historyStorageEntries()[0];
    await configureReplicationDiagnosticScope({
      ...scopeA,
      churchId: "church-private-b",
      accountId: "account-private-b",
      databaseKey: "database-private-b",
    });

    finishReplicationBatchDiagnostics(token, token.summary, metrics(), "complete");
    markReplicationBatchCheckpoint(token);
    expect(window.localStorage.getItem(oldHistoryKey!)).toBeNull();
    expect(getReplicationDiagnosticsSnapshot(true).expensiveBatches).toEqual([]);
    expect(historyStorageEntries()).toHaveLength(0);
  });

  it("preserves another active tab's history when this tab changes churches", async () => {
    const token = beginReplicationBatchDiagnostics(expensiveSummary(), true, {
      databaseCategory: "content",
      replicationKind: "initial-pull",
      detailed: false,
    });
    const historyKey = historyStorageEntries()[0];
    const scopeHash = historyKey!.slice(historyKey!.lastIndexOf(":") + 1);
    const sessionsKey = `worshipsync.replication-diagnostics.sessions:${scopeHash}`;
    const sessions = JSON.parse(window.localStorage.getItem(sessionsKey) ?? "{}");
    sessions["another-active-tab"] = Date.now();
    window.localStorage.setItem(sessionsKey, JSON.stringify(sessions));

    await configureReplicationDiagnosticScope({
      ...scopeA,
      churchId: "church-private-b",
      accountId: "account-private-b",
      databaseKey: "database-private-b",
    });

    expect(window.localStorage.getItem(historyKey!)).not.toBeNull();
    expect(JSON.parse(window.localStorage.getItem(sessionsKey) ?? "{}"))
      .toHaveProperty("another-active-tab");
    expect(historyFor(scopeHash)[0].status).toBe("cancelled");
    markReplicationBatchCheckpoint(token);
  });

  it("accepts central heap samples and supports browsers without performance.memory", () => {
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    Object.defineProperty(performance, "memory", { configurable: true, value: undefined });
    const token = beginReplicationBatchDiagnostics(expensiveSummary(), true, {
      databaseCategory: "content",
      replicationKind: "initial-pull",
      detailed: true,
    });
    expect(token.heapBeforeMb).toBeNull();
    recordReplicationHeapSample(450);
    finishReplicationBatchDiagnostics(token, token.summary, metrics(), "complete");
    expect(token.snapshot?.highestSampledHeapMb).toBe(450);
    markReplicationBatchCheckpoint(token);
    Object.defineProperty(performance, "memory", { configurable: true, value: memory });
  });

  it("keeps startup warning thresholds separate from bounded-write activation", () => {
    expect(REPLICATION_DIAGNOSTIC_WARNING_STALL_MS).toBe(5_000);
    expect(REPLICATION_DIAGNOSTIC_WARNING_HEAP_DELTA_MB).toBe(100);
    expect(REPLICATION_DIAGNOSTIC_WARNING_MAX_LEAVES).toBe(25);
    expect(REPLICATION_DIAGNOSTIC_WARNING_HEAP_MB).toBe(400);
    expect(REPLICATION_DIAGNOSTIC_WARNING_COMPLEXITY).toBe(8_000);
    expect(REPLICATION_DIAGNOSTIC_WARNING_HISTORY_DEPTH).toBe(500);
  });

  it("keeps diagnostics resilient to local storage failures", () => {
    jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    const token = beginReplicationBatchDiagnostics(expensiveSummary(), true, {
      databaseCategory: "content",
      replicationKind: "initial-pull",
      detailed: true,
    });

    expect(() => finishReplicationBatchDiagnostics(token, token.summary, metrics(), "complete"))
      .not.toThrow();
    expect(getReplicationDiagnosticsSnapshot(true).expensiveBatches).toHaveLength(1);
    markReplicationBatchCheckpoint(token);
  });

  it("reports sanitized production warnings with deduplication and a per-session cap", () => {
    const previousEnvironment = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const capturedContexts: unknown[][] = [];
    (globalThis as typeof globalThis & { __replicationSentryContexts?: unknown[][] })
      .__replicationSentryContexts = capturedContexts;
    (Sentry.withScope as jest.Mock).mockClear();
    const capture = Sentry.captureMessage as jest.Mock;
    capture.mockClear();
    try {
      const failure = beginReplicationBatchDiagnostics(expensiveSummary(), true, {
        databaseCategory: "content",
        replicationKind: "initial-pull",
        detailed: true,
      });
      finishReplicationBatchDiagnostics(failure, failure.summary, metrics(), "failure");

      const first = beginReplicationBatchDiagnostics(expensiveSummary(), true, {
        databaseCategory: "content",
        replicationKind: "initial-pull",
        detailed: true,
      });
      finishReplicationBatchDiagnostics(first, first.summary, metrics({ processingDurationMs: 6000 }), "complete");
      markReplicationBatchCheckpoint(first);

      const duplicate = beginReplicationBatchDiagnostics(expensiveSummary(), true, {
        databaseCategory: "content",
        replicationKind: "initial-pull",
        detailed: true,
      });
      finishReplicationBatchDiagnostics(duplicate, duplicate.summary, metrics({ processingDurationMs: 6000 }), "complete");
      markReplicationBatchCheckpoint(duplicate);
      expect(capture).toHaveBeenCalledTimes(2);
      expect(capture).toHaveBeenCalledWith(
        "WorshipSync detected an expensive initial content replication batch",
        "warning",
      );
      expect(capture).toHaveBeenCalledWith(
        "WorshipSync initial content replication batch failed",
        "error",
      );

      for (let index = 0; index < 8; index += 1) {
        const token = beginReplicationBatchDiagnostics(expensiveSummary(), true, {
          databaseCategory: `content-${index}`,
          replicationKind: "initial-pull",
          detailed: true,
        });
        finishReplicationBatchDiagnostics(token, token.summary, metrics({ processingDurationMs: 6000 }), "complete");
        markReplicationBatchCheckpoint(token);
      }
      expect(capture).toHaveBeenCalledTimes(5);

      const contexts = capturedContexts.map(([, value]) => value);
      const serializedContexts = JSON.stringify(contexts);
      expect(serializedContexts).not.toContain("document-private");
      expect(serializedContexts).not.toContain("private document body");
      expect(serializedContexts).not.toContain("history-0");
      const runtime = contexts[0] as Record<string, unknown>;
      expect(runtime.applicationVersion).toBeTruthy();
      expect(runtime.churchIdentifierHash).not.toBe(scopeA.churchId);
      expect(runtime.deviceIdentifierHash).not.toBe(scopeA.deviceId);
      expect(runtime).toHaveProperty("availableDeviceMemoryGiB");
    } finally {
      delete (globalThis as typeof globalThis & { __replicationSentryContexts?: unknown[][] })
        .__replicationSentryContexts;
      process.env.NODE_ENV = previousEnvironment;
    }
  });
});
