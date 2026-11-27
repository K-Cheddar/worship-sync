import {
  BOUNDED_REVISION_MIN_LEAVES,
  BOUNDED_REVISION_MIN_METADATA_COMPLEXITY,
  BOUNDED_REVISION_WRITE_LIMIT,
  installBoundedRevisionWrites,
  planRevisionWrites,
  summarizeIncomingRevisions,
  type IncomingRevisionDocument,
} from "./revisionReplication";

type TestRevisionDocument = IncomingRevisionDocument & {
  _deleted?: boolean;
  _attachments?: Record<string, { stub?: boolean; digest?: string }>;
};

const revision = (
  documentId: string,
  hash: string,
  depth: number,
  extras: Record<string, unknown> = {},
): TestRevisionDocument => ({
  _id: documentId,
  _rev: `${depth}-${hash}`,
  _revisions: {
    start: depth,
    ids: Array.from({ length: depth }, (_, index) => `${hash}-${index}`),
  },
  ...extras,
}) as TestRevisionDocument;

describe("incoming revision complexity", () => {
  it("keeps ordinary documents together even when the batch contains many unique IDs", () => {
    const docs = Array.from({ length: 150 }, (_, index) => revision(`ordinary-${index}`, `hash-${index}`, 5));
    const plan = planRevisionWrites(docs);

    expect(plan.summary.uniqueDocumentCount).toBe(150);
    expect(plan.summary.incomingLeafRevisionCount).toBe(150);
    expect(plan.summary.maxLeafCountPerDocument).toBe(1);
    expect(plan.summary.maxRevisionHistoryDepth).toBe(5);
    expect(plan.summary.estimatedMetadataComplexity).toBe(750);
    expect(plan.boundedDocuments).toHaveLength(0);
    expect(plan.ordinaryDocuments).toHaveLength(150);
  });

  it("bounds one unusually revision-heavy document even when it is only one changes-feed row", () => {
    const docs = Array.from({ length: 175 }, (_, index) => revision("complex", `hash-${index}`, 1000));
    const plan = planRevisionWrites(docs);

    expect(plan.summary.uniqueDocumentCount).toBe(1);
    expect(plan.summary.incomingLeafRevisionCount).toBe(175);
    expect(plan.summary.maxLeafCountPerDocument).toBe(175);
    expect(plan.summary.maxRevisionHistoryDepth).toBe(1000);
    expect(plan.summary.estimatedMetadataComplexity).toBe(175_000);
    expect(plan.boundedDocuments).toHaveLength(1);
    expect(plan.boundedDocuments[0].documents).toHaveLength(175);
  });

  it("counts tombstones as incoming revisions and does not serialize document bodies", () => {
    const forbiddenBody = { toJSON: () => { throw new Error("body must not be serialized"); } };
    const docs = Array.from({ length: 8 }, (_, index) => revision(
      "complex",
      `hash-${index}`,
      1000,
      { ...(index === 7 ? { _deleted: true } : {}), body: forbiddenBody },
    ));

    expect(() => summarizeIncomingRevisions(docs)).not.toThrow();
    expect(planRevisionWrites(docs).summary.incomingLeafRevisionCount).toBe(8);
    expect(planRevisionWrites(docs).summary.estimatedMetadataComplexity).toBe(8_000);
  });

  it("requires both a leaf count and estimated history complexity before bounding", () => {
    const deepSingleLeaf = revision("deep", "one", 1000);
    const shallowConflictGroup = Array.from({ length: 25 }, (_, index) => revision("shallow", `hash-${index}`, 10));
    const docs = [deepSingleLeaf, ...shallowConflictGroup];
    const plan = planRevisionWrites(docs);

    expect(plan.boundedDocuments).toHaveLength(0);
    expect(BOUNDED_REVISION_MIN_LEAVES).toBeGreaterThan(1);
    expect(BOUNDED_REVISION_MIN_METADATA_COMPLEXITY).toBeGreaterThan(1000);
  });

  it("deduplicates repeated revision metadata when estimating complexity", () => {
    const doc = revision("same", "rev", 1000);
    const summary = summarizeIncomingRevisions([doc, { ...doc }]);

    expect(summary.incomingLeafRevisionCount).toBe(1);
    expect(summary.estimatedMetadataComplexity).toBe(1000);
    expect(summary.documentsById.get("same")).toHaveLength(2);
  });
});

describe("bounded incoming revision writes", () => {
  const createDatabase = () => {
    const bulkDocs = jest.fn(async (..._args: unknown[]): Promise<unknown[]> => []);
    return { database: { bulkDocs }, bulkDocs };
  };

  it("leaves ordinary replication batches on a single original bulk write", async () => {
    const { database, bulkDocs } = createDatabase();
    const docs = Array.from({ length: 150 }, (_, index) => revision(`ordinary-${index}`, `hash-${index}`, 5));
    const request = { docs, new_edits: false };
    const processor = installBoundedRevisionWrites(database, { writeLimit: 4 });

    await database.bulkDocs(request);

    expect(bulkDocs).toHaveBeenCalledTimes(1);
    expect(bulkDocs).toHaveBeenCalledWith(request);
    processor.restore();
    expect(bulkDocs).toHaveBeenCalledTimes(1);
  });

  it("chunks only the complex document while keeping ordinary documents in one write", async () => {
    const { database, bulkDocs } = createDatabase();
    const docs = [
      revision("complex", "a", 1000),
      revision("ordinary-1", "b", 5),
      revision("complex", "c", 1000),
      revision("ordinary-2", "d", 5),
      ...Array.from({ length: 7 }, (_, index) => revision("complex", `e-${index}`, 1000)),
    ];
    const onTransaction = jest.fn();
    const processor = installBoundedRevisionWrites(database, { writeLimit: 4, onTransaction });

    const response = await database.bulkDocs({ docs, new_edits: false });

    expect(bulkDocs).toHaveBeenCalledTimes(4);
    expect((bulkDocs.mock.calls[0][0] as { docs: Array<{ _id: string }> }).docs)
      .toHaveLength(2);
    expect(bulkDocs.mock.calls.slice(1).map(([request]) =>
      (request as { docs: unknown[] }).docs.length)).toEqual([4, 4, 1]);
    // PouchDB's local adapter returns only error rows for new_edits:false writes.
    expect(response).toEqual([]);
    expect(onTransaction).toHaveBeenCalledTimes(4);
    processor.restore();
  });

  it("does not reinterpret winning revisions or attachments while splitting tombstone revisions", async () => {
    const { database, bulkDocs } = createDatabase();
    const docs = Array.from({ length: 8 }, (_, index) => revision("complex", `hash-${index}`, 1000, {
      ...(index === 7 ? { _deleted: true } : {}),
      ...(index === 0 ? { _attachments: { file: { stub: true, digest: "md5-local" } } } : {}),
    }));
    const processor = installBoundedRevisionWrites(database, { writeLimit: 4 });

    await database.bulkDocs({ docs, new_edits: false });

    const writes = bulkDocs.mock.calls.map(([request]) => (request as { docs: typeof docs }).docs).flat();
    expect(writes).toEqual(docs);
    expect(writes.filter((doc) => doc._deleted)).toHaveLength(1);
    expect(writes[0]._attachments).toEqual({ file: { stub: true, digest: "md5-local" } });
    processor.restore();
  });

  it("rejects partial write failures so replication cannot advance its checkpoint", async () => {
    const { database, bulkDocs } = createDatabase();
    bulkDocs.mockImplementationOnce(async () => [
      { error: "conflict", status: 409 },
    ]);
    const onBatchFinish = jest.fn();
    const docs = Array.from({ length: 8 }, (_, index) => revision("complex", `hash-${index}`, 1000));
    const processor = installBoundedRevisionWrites(database, { writeLimit: 4, onBatchFinish });

    await expect(database.bulkDocs({ docs, new_edits: false })).rejects.toThrow(
      "A revision write transaction was rejected.",
    );

    expect(bulkDocs).toHaveBeenCalledTimes(1);
    expect(onBatchFinish.mock.calls[0][3]).toBe("failure");
    expect(onBatchFinish.mock.calls[0][2].writeTransactionCount).toBe(1);
    await expect(database.bulkDocs({ docs, new_edits: false })).resolves.toEqual([]);
    expect(bulkDocs).toHaveBeenCalledTimes(3);
    processor.restore();
  });

  it("returns permission denials to PouchDB after all bounded transactions finish", async () => {
    const { database, bulkDocs } = createDatabase();
    const denied = { id: "complex", error: "forbidden", name: "forbidden", status: 403 };
    bulkDocs.mockImplementationOnce(async () => [denied]);
    const onBatchFinish = jest.fn();
    const docs = Array.from({ length: 8 }, (_, index) => revision("complex", `hash-${index}`, 1000));
    const processor = installBoundedRevisionWrites(database, { writeLimit: 4, onBatchFinish });

    await expect(database.bulkDocs({ docs, new_edits: false })).resolves.toEqual([denied]);

    expect(bulkDocs).toHaveBeenCalledTimes(2);
    expect(onBatchFinish.mock.calls[0][3]).toBe("complete");
    processor.restore();
  });

  it("stops between transactions after cancellation", async () => {
    const { database, bulkDocs } = createDatabase();
    let cancelled = false;
    bulkDocs.mockImplementationOnce(async (...args) => {
      const request = args[0] as { docs: Array<{ _id: string; _rev: string }> };
      cancelled = true;
      expect(request.docs).toHaveLength(4);
      return [];
    });
    const onBatchFinish = jest.fn();
    const docs = Array.from({ length: 8 }, (_, index) => revision("complex", `hash-${index}`, 1000));
    const processor = installBoundedRevisionWrites(database, {
      writeLimit: 4,
      isCancelled: () => cancelled,
      onBatchFinish,
    });

    await expect(database.bulkDocs({ docs, new_edits: false })).rejects.toMatchObject({ name: "AbortError" });

    expect(bulkDocs).toHaveBeenCalledTimes(1);
    expect(onBatchFinish.mock.calls[0][3]).toBe("cancelled");
    processor.restore();
  });

  it("only wraps new_edits:false writes and can be cancelled explicitly", async () => {
    const { database, bulkDocs } = createDatabase();
    const docs = Array.from({ length: 8 }, (_, index) => revision("complex", `hash-${index}`, 1000));
    const processor = installBoundedRevisionWrites(database, { writeLimit: 4 });

    await database.bulkDocs({ docs, new_edits: true });
    processor.cancel();
    await expect(database.bulkDocs({ docs, new_edits: false })).rejects.toMatchObject({ name: "AbortError" });

    expect(bulkDocs).toHaveBeenCalledTimes(1);
    processor.restore();
  });

  it("keeps replication writes successful when diagnostic callbacks throw", async () => {
    const { database } = createDatabase();
    const docs = Array.from({ length: 8 }, (_, index) => revision("complex", `hash-${index}`, 1000));
    const processor = installBoundedRevisionWrites(database, {
      writeLimit: 4,
      onBatchStart: () => { throw new Error("diagnostic failure"); },
      onTransaction: () => { throw new Error("metric failure"); },
      onBatchFinish: () => { throw new Error("reporting failure"); },
    });

    await expect(database.bulkDocs({ docs, new_edits: false })).resolves.toEqual([]);
    processor.restore();
  });

  it("keeps the selected revision write limit at four", () => {
    expect(BOUNDED_REVISION_WRITE_LIMIT).toBe(4);
  });
});
