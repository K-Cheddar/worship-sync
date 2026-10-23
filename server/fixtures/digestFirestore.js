const clone = (value) => structuredClone(value);
const mergeFirestore = (current, update) => {
  const result = { ...(current || {}) };
  for (const [key, value] of Object.entries(update)) {
    result[key] =
      value && typeof value === "object" && !Array.isArray(value)
        ? mergeFirestore(result[key], value)
        : value;
  }
  return result;
};

export const createDigestFirestore = (seed = {}) => {
  const stores = new Map(
    Object.entries(seed).map(([name, docs]) => [
      name,
      new Map(Object.entries(docs).map(([id, value]) => [id, clone(value)])),
    ]),
  );
  const getStore = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name);
  };
  let database;
  const snapshot = (id, data, ref) => ({
    id,
    ref,
    exists: Boolean(data),
    data: () => (data ? clone(data) : undefined),
  });
  const collection = (name) => {
    const store = getStore(name);
    const doc = (id) => {
      const ref = {
        id,
        collection: name,
        async get() {
          return snapshot(id, store.get(id), ref);
        },
        async set(data, options = {}) {
          await database.beforeSet?.(name, id, data);
          store.set(
            id,
            options.merge ? mergeFirestore(store.get(id), data) : clone(data),
          );
        },
        async update(data) {
          const current = store.get(id);
          if (!current) throw new Error("document does not exist");
          store.set(id, { ...current, ...clone(data) });
        },
      };
      return ref;
    };
    return {
      doc,
      where(field, op, value) {
        const filters = [{ field, op, value }];
        let limit = Infinity;
        let cursorArgs = null;
        let orderField = "pendingDigestSince";
        const query = {
          where(nextField, nextOp, nextValue) {
            filters.push({ field: nextField, op: nextOp, value: nextValue });
            return query;
          },
          orderBy(field) {
            if (typeof field === "string") orderField = field;
            return query;
          },
          startAfter(...args) {
            cursorArgs = args;
            return query;
          },
          limit(count) {
            limit = count;
            return query;
          },
          async get() {
            await database.beforeQuery?.(name, filters);
            let docs = [...store.entries()]
              .filter(([id, value]) =>
                filters.every((filter) => {
                  const actual =
                    filter.field === "__name__" ? id : value[filter.field];
                  if (filter.op === "==") return actual === filter.value;
                  if (filter.op === ">") return actual > filter.value;
                  return false;
                }),
              )
              .sort(
                ([idA, a], [idB, b]) =>
                  String(a[orderField] || "").localeCompare(
                    String(b[orderField] || ""),
                  ) || idA.localeCompare(idB),
              );
            if (cursorArgs) {
              if (cursorArgs.length === 1 && cursorArgs[0]?.id) {
                docs = docs.filter(([docId]) => docId > cursorArgs[0].id);
              } else {
                const [since, id] = cursorArgs;
                docs = docs.filter(
                  ([docId, value]) =>
                    value[orderField] > since ||
                    (value[orderField] === since && docId > id),
                );
              }
            }
            docs = docs.slice(0, limit).map(([id, value]) => ({
              id,
              ref: doc(id),
              data: () => clone(value),
              get: (field) => clone(value[field]),
            }));
            return { docs, size: docs.length };
          },
        };
        return query;
      },
    };
  };

  let transactionTail = Promise.resolve();
  database = {
    collection,
    async runTransaction(callback) {
      if (database.beforeTransaction) await database.beforeTransaction();
      let release;
      const previous = transactionTail;
      transactionTail = new Promise((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        const run = async () => {
          const writes = [];
          const result = await callback({
            async get(ref) {
              if (writes.length > 0) throw new Error("Firestore reads must precede writes");
              if (typeof ref.get === "function") return ref.get();
              throw new Error("Unsupported transaction query");
            },
            set(ref, data, options) {
              writes.push({ type: "set", ref, data, options });
            },
            update(ref, data) {
              writes.push({ type: "update", ref, data });
            },
          });
          return { result, writes };
        };
        let pending = await run();
        if (database.retryTransactions > 0) {
          database.retryTransactions -= 1;
          database.transactionCallbackRuns += 1;
          pending = await run();
        }
        const { result, writes } = pending;
        for (const write of writes) {
          const store = getStore(write.ref.collection);
          if (write.type === "update") {
            store.set(write.ref.id, {
              ...store.get(write.ref.id),
              ...clone(write.data),
            });
          } else {
            const next = write.options?.merge
              ? mergeFirestore(store.get(write.ref.id), write.data)
              : clone(write.data);
            store.set(write.ref.id, next);
          }
        }
        return result;
      } finally {
        release();
      }
    },
    read(name, id) {
      return clone(getStore(name).get(id));
    },
    retryTransactions: 0,
    transactionCallbackRuns: 0,
  };
  return database;
};
