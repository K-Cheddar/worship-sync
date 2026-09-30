/** Persist an approved import create key and entity atomically in Firestore. */
export const persistPortableCreate = async ({
  db, entityCollection, entityId, entity, ledgerCollection, ledgerId, ledger,
  enqueue, getDoc, setDoc, conflict,
}) => {
  if (db) {
    const entityRef = db.collection(entityCollection).doc(entityId);
    const ledgerRef = db.collection(ledgerCollection).doc(ledgerId);
    return db.runTransaction(async (transaction) => {
      const ledgerSnapshot = await transaction.get(ledgerRef);
      if (ledgerSnapshot.exists) {
        const prior = ledgerSnapshot.data();
        if (!matchesClaim(prior, ledger, entityId, entityCollection)) throw conflict();
        const entitySnapshot = await transaction.get(entityRef);
        if (entitySnapshot.exists) {
          const current = entitySnapshot.data();
          if (!matchesEntity(current, entity, ledger.createKey)) throw conflict();
          return current;
        }
        transaction.set(entityRef, entity, { merge: false });
        return entity;
      }
      const entitySnapshot = await transaction.get(entityRef);
      if (entitySnapshot.exists) {
        const current = entitySnapshot.data();
        if (!matchesEntity(current, entity, ledger.createKey)) throw conflict();
        transaction.set(ledgerRef, ledger, { merge: false });
        return current;
      }
      transaction.create(entityRef, entity);
      transaction.create(ledgerRef, ledger);
      return entity;
    });
  }

  return enqueue(ledgerId, async () => {
    const prior = await getDoc(ledgerCollection, ledgerId);
    if (prior && !matchesClaim(prior, ledger, entityId, entityCollection)) throw conflict();
    const current = await getDoc(entityCollection, entityId);
    if (current && !matchesEntity(current, entity, ledger.createKey)) throw conflict();
    if (!current) await setDoc(entityCollection, entityId, entity, { merge: false });
    if (!prior) await setDoc(ledgerCollection, ledgerId, ledger, { merge: false });
    return current || entity;
  });
};

const matchesClaim = (prior, ledger, entityId, entityCollection) =>
  prior.churchId === ledger.churchId
  && prior.kind === ledger.kind
  && prior.createKey === ledger.createKey
  && prior.entityId === entityId
  && prior.entityCollection === entityCollection;

const matchesEntity = (current, entity, createKey) =>
  current.churchId === entity.churchId
  && current._portableCreateKey === createKey;
