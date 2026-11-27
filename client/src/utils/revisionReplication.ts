export type IncomingRevisionDocument = {
  _id?: unknown;
  _rev?: unknown;
  _deleted?: unknown;
  _revisions?: { ids?: unknown; start?: unknown } | null;
  type?: unknown;
  docType?: unknown;
};

export type RevisionDocumentComplexity = {
  documentId: string;
  documentType: string | null;
  incomingLeafRevisionCount: number;
  maxRevisionHistoryDepth: number;
  estimatedMetadataComplexity: number;
};

export type RevisionBatchComplexity = {
  uniqueDocumentCount: number;
  incomingLeafRevisionCount: number;
  maxLeafCountPerDocument: number;
  maxRevisionHistoryDepth: number;
  estimatedMetadataComplexity: number;
  likelyContributors: RevisionDocumentComplexity[];
  documentComplexities: RevisionDocumentComplexity[];
  documentsById: Map<string, IncomingRevisionDocument | IncomingRevisionDocument[]>;
};

export const BOUNDED_REVISION_WRITE_LIMIT = 4;
export const BOUNDED_REVISION_MIN_LEAVES = 8;
export const BOUNDED_REVISION_MIN_METADATA_COMPLEXITY = 8_000;

const getRevisionHistoryDepth = (document: IncomingRevisionDocument) => {
  const ids = document._revisions?.ids;
  if (Array.isArray(ids) && ids.length > 0) return ids.length;
  const generation = typeof document._rev === "string"
    ? Number(/^([0-9]+)-/.exec(document._rev)?.[1])
    : 0;
  return Number.isSafeInteger(generation) && generation > 0 ? generation : 0;
};

const getDocumentType = (document: IncomingRevisionDocument) => {
  const type = typeof document.type === "string" ? document.type : document.docType;
  return typeof type === "string" ? type.slice(0, 80) : null;
};

const isPermissionDeniedRow = (row: unknown) => {
  if (!row || typeof row !== "object") return false;
  const error = row as { error?: unknown; name?: unknown; status?: unknown };
  const errorName = String(error.name ?? error.error ?? "").toLowerCase();
  return errorName === "unauthorized" || errorName === "forbidden" ||
    error.status === 401 || error.status === 403;
};

/** Inspect revision metadata only; document bodies and attachment data are never serialized or walked. */
export const summarizeIncomingRevisions = (
  incomingDocuments: readonly IncomingRevisionDocument[],
): RevisionBatchComplexity => {
  const groupsById = new Map<string, {
    documents: IncomingRevisionDocument | IncomingRevisionDocument[];
    summary: RevisionDocumentComplexity;
    seenRevisionIds: string | Set<string> | null;
  }>();

  for (const document of incomingDocuments) {
    if (typeof document._id !== "string") continue;
    const documentId = document._id;
    const revisionId = typeof document._rev === "string" ? document._rev : null;
    let group = groupsById.get(documentId);
    if (!group) {
      group = {
        documents: document,
        summary: {
          documentId,
          documentType: getDocumentType(document),
          incomingLeafRevisionCount: 0,
          maxRevisionHistoryDepth: 0,
          estimatedMetadataComplexity: 0,
        },
        seenRevisionIds: revisionId,
      };
      groupsById.set(documentId, group);
    } else {
      if (Array.isArray(group.documents)) group.documents.push(document);
      else group.documents = [group.documents, document];

      if (revisionId) {
        if (group.seenRevisionIds === revisionId) continue;
        if (group.seenRevisionIds instanceof Set) {
          if (group.seenRevisionIds.has(revisionId)) continue;
          group.seenRevisionIds.add(revisionId);
        } else if (group.seenRevisionIds === null) {
          group.seenRevisionIds = revisionId;
        } else {
          group.seenRevisionIds = new Set([group.seenRevisionIds, revisionId]);
        }
      }
    }

    const historyDepth = getRevisionHistoryDepth(document);
    group.summary.incomingLeafRevisionCount += 1;
    group.summary.maxRevisionHistoryDepth = Math.max(group.summary.maxRevisionHistoryDepth, historyDepth);
    group.summary.estimatedMetadataComplexity += historyDepth;
    group.summary.documentType ??= getDocumentType(document);
  }

  const documentsById = new Map<string, IncomingRevisionDocument | IncomingRevisionDocument[]>();
  const documents = [...groupsById].map(([documentId, group]) => {
    documentsById.set(documentId, group.documents);
    return group.summary;
  });
  let maxLeafCountPerDocument = 0;
  let maxRevisionHistoryDepth = 0;
  let estimatedMetadataComplexity = 0;
  for (const document of documents) {
    maxLeafCountPerDocument = Math.max(maxLeafCountPerDocument, document.incomingLeafRevisionCount);
    maxRevisionHistoryDepth = Math.max(maxRevisionHistoryDepth, document.maxRevisionHistoryDepth);
    estimatedMetadataComplexity += document.estimatedMetadataComplexity;
  }
  const documentComplexities = documents.sort(
    (left, right) => right.estimatedMetadataComplexity - left.estimatedMetadataComplexity,
  );
  const likelyContributors = documentComplexities.slice(0, 3);

  return {
    uniqueDocumentCount: documentsById.size,
    incomingLeafRevisionCount: documents.reduce(
      (total, document) => total + document.incomingLeafRevisionCount,
      0,
    ),
    maxLeafCountPerDocument,
    maxRevisionHistoryDepth,
    estimatedMetadataComplexity,
    likelyContributors,
    documentComplexities,
    documentsById,
  };
};

export const shouldBoundRevisionWrites = (
  document: RevisionDocumentComplexity,
  options: { minLeaves?: number; minMetadataComplexity?: number } = {},
) => document.incomingLeafRevisionCount >= (options.minLeaves ?? BOUNDED_REVISION_MIN_LEAVES) &&
  document.estimatedMetadataComplexity >= (options.minMetadataComplexity ?? BOUNDED_REVISION_MIN_METADATA_COMPLEXITY);

export type RevisionWritePlan = {
  summary: RevisionBatchComplexity;
  ordinaryDocuments: IncomingRevisionDocument[];
  boundedDocuments: Array<{ summary: RevisionDocumentComplexity; documents: IncomingRevisionDocument[] }>;
};

export const planRevisionWrites = (
  incomingDocuments: readonly IncomingRevisionDocument[],
): RevisionWritePlan => {
  const summary = summarizeIncomingRevisions(incomingDocuments);
  const boundedIds = new Set<string>();
  const allBounded = summary.documentComplexities.flatMap((documentSummary) => {
    if (!shouldBoundRevisionWrites(documentSummary)) return [];
    boundedIds.add(documentSummary.documentId);
    const groupedDocuments = summary.documentsById.get(documentSummary.documentId);
    return [{
      summary: documentSummary,
      documents: groupedDocuments
        ? Array.isArray(groupedDocuments) ? groupedDocuments : [groupedDocuments]
        : [],
    }];
  });

  return {
    summary,
    ordinaryDocuments: incomingDocuments.filter(
      (document) => typeof document._id !== "string" || !boundedIds.has(document._id),
    ),
    boundedDocuments: allBounded,
  };
};

type BulkDocsDatabase = {
  bulkDocs: (...args: unknown[]) => Promise<unknown[]>;
};

export type RevisionWriteTransaction = {
  documentCount: number;
  durationMs: number;
  bounded: boolean;
};

export type RevisionWriteMetrics = {
  processingDurationMs: number;
  writeTransactionCount: number;
  boundedWriteTransactionCount: number;
  boundedRevisionWriteCount: number;
  maxWriteTransactionSize: number;
  totalWriteDurationMs: number;
  maxWriteDurationMs: number;
};

export type RevisionWriteOutcome = "complete" | "cancelled" | "failure";

export const installBoundedRevisionWrites = (
  database: BulkDocsDatabase,
  options: {
    onBatchStart?: (summary: RevisionBatchComplexity, bounded: boolean) => unknown;
    onTransaction?: (token: unknown, transaction: RevisionWriteTransaction) => void;
    onBatchFinish?: (
      token: unknown,
      summary: RevisionBatchComplexity,
      metrics: RevisionWriteMetrics,
      outcome: RevisionWriteOutcome,
    ) => void;
    isCancelled?: () => boolean;
    writeLimit?: number;
  } = {},
) => {
  const originalBulkDocs = database.bulkDocs;
  let cancelled = false;
  let restored = false;
  const writeLimit = Number.isSafeInteger(options.writeLimit) && (options.writeLimit ?? 0) > 0
    ? options.writeLimit!
    : BOUNDED_REVISION_WRITE_LIMIT;
  const isCancelled = () => cancelled || options.isCancelled?.() === true;
  const notify = (callback: (() => void) | undefined) => {
    try {
      callback?.();
    } catch {
      // Diagnostics and metrics callbacks must never affect replication writes.
    }
  };
  const cancelledError = () => Object.assign(
    new Error("Revision writes stopped because replication was cancelled."),
    { name: "AbortError" },
  );

  const wrappedBulkDocs = async (...args: unknown[]) => {
    const payload = args[0];
    const bulkOptions = args[1] as { new_edits?: unknown } | undefined;
    const bulkRequest = !Array.isArray(payload) && payload && typeof payload === "object"
      ? payload as { docs?: unknown; new_edits?: unknown }
      : null;
    const incomingDocuments = Array.isArray(payload)
      ? payload
      : Array.isArray(bulkRequest?.docs) ? bulkRequest.docs : null;
    const newEditsFalse = bulkRequest?.new_edits === false || bulkOptions?.new_edits === false;
    if (!newEditsFalse || !incomingDocuments) {
      return originalBulkDocs.apply(database, args);
    }

    const documents = incomingDocuments as IncomingRevisionDocument[];
    const startedAt = performance.now();
    const plan = planRevisionWrites(documents);
    const deniedRows: unknown[] = [];
    const metrics: RevisionWriteMetrics = {
      processingDurationMs: 0,
      writeTransactionCount: 0,
      boundedWriteTransactionCount: 0,
      boundedRevisionWriteCount: 0,
      maxWriteTransactionSize: 0,
      totalWriteDurationMs: 0,
      maxWriteDurationMs: 0,
    };
    const recordTransaction = (
      transactionStartedAt: number,
      writeDocuments: IncomingRevisionDocument[],
      bounded: boolean,
    ) => {
      const durationMs = Math.max(0, performance.now() - transactionStartedAt);
      metrics.writeTransactionCount += 1;
      metrics.boundedWriteTransactionCount += bounded ? 1 : 0;
      metrics.boundedRevisionWriteCount += bounded ? writeDocuments.length : 0;
      metrics.maxWriteTransactionSize = Math.max(metrics.maxWriteTransactionSize, writeDocuments.length);
      metrics.totalWriteDurationMs += durationMs;
      metrics.maxWriteDurationMs = Math.max(metrics.maxWriteDurationMs, durationMs);
      notify(() => options.onTransaction?.(token, {
        documentCount: writeDocuments.length,
        durationMs,
        bounded,
      }));
    };
    let token: unknown;
    try {
      token = options.onBatchStart?.(plan.summary, plan.boundedDocuments.length > 0);
    } catch {
      token = undefined;
    }

    const write = async (writeDocuments: IncomingRevisionDocument[], bounded: boolean) => {
      if (writeDocuments.length === 0) return;
      if (isCancelled()) throw cancelledError();

      const transactionStartedAt = performance.now();
      const request = Array.isArray(payload)
        ? writeDocuments
        : { ...bulkRequest, docs: writeDocuments };
      let rows: unknown[];
      try {
        rows = await originalBulkDocs.apply(database, [request, ...args.slice(1)]);
      } catch (error) {
        recordTransaction(transactionStartedAt, writeDocuments, bounded);
        throw error;
      }
      recordTransaction(transactionStartedAt, writeDocuments, bounded);

      const errors = rows.filter((row) => Boolean(
        row && typeof row === "object" && "error" in row && (row as { error?: unknown }).error,
      ));
      const retryableFailure = errors.find((row) => !isPermissionDeniedRow(row));
      if (retryableFailure) throw new Error("A revision write transaction was rejected.");
      deniedRows.push(...errors);
      if (isCancelled()) throw cancelledError();
    };

    try {
      if (plan.boundedDocuments.length === 0) {
        if (isCancelled()) throw cancelledError();
        const transactionStartedAt = performance.now();
        let rows: unknown[];
        try {
          rows = await originalBulkDocs.apply(database, args);
        } catch (error) {
          recordTransaction(transactionStartedAt, documents, false);
          throw error;
        }
        recordTransaction(transactionStartedAt, documents, false);
        metrics.processingDurationMs = Math.max(0, performance.now() - startedAt);
        if (isCancelled()) throw cancelledError();
        notify(() => options.onBatchFinish?.(token, plan.summary, metrics, "complete"));
        return rows;
      }

      await write(plan.ordinaryDocuments, false);
      for (const group of plan.boundedDocuments) {
        for (let index = 0; index < group.documents.length; index += writeLimit) {
          await write(group.documents.slice(index, index + writeLimit), true);
        }
      }
      metrics.processingDurationMs = Math.max(0, performance.now() - startedAt);
      notify(() => options.onBatchFinish?.(token, plan.summary, metrics, "complete"));
      // PouchDB filters successful `new_edits: false` results and handles permission denials.
      return deniedRows;
    } catch (error) {
      const outcome: RevisionWriteOutcome = isCancelled() || (error instanceof Error && error.name === "AbortError")
        ? "cancelled"
        : "failure";
      metrics.processingDurationMs = Math.max(0, performance.now() - startedAt);
      notify(() => options.onBatchFinish?.(token, plan.summary, metrics, outcome));
      throw error;
    }
  };

  database.bulkDocs = wrappedBulkDocs;
  return {
    cancel: () => { cancelled = true; },
    restore: () => {
      if (restored) return;
      restored = true;
      if (database.bulkDocs === wrappedBulkDocs) database.bulkDocs = originalBulkDocs;
    },
  };
};
