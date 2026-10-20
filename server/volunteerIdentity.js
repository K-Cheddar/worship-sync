import { createHash } from "node:crypto";

const conflictMessage =
  "Your account is linked to more than one team member here. Ask a church administrator to correct the links before using My Schedule.";

export const volunteerIdentityClaimId = (churchId, userId) =>
  `volunteer_identity_${createHash("sha256")
    .update(`${String(churchId || "").trim()}\u0000${String(userId || "").trim()}`)
    .digest("hex")}`;

export const resolveSignedInVolunteerMember = ({
  members,
  churchId,
  userId,
  httpError = (statusCode, message) =>
    Object.assign(new Error(message), { statusCode }),
}) => {
  const linked = (members || []).filter(
    (member) =>
      member?.churchId === churchId &&
      member?.userId === userId &&
      Boolean(userId),
  );
  const active = linked.filter((member) => !member.archivedAt);

  // A single archived-only link keeps the existing not-linked state. Any
  // duplicate set is ambiguous, including active links mixed with archived
  // history, so the server must not guess which identity is current.
  if (linked.length > 1) throw httpError(409, conflictMessage);
  if (active.length === 0) return null;
  return active[0];
};

const accountLockKey = (churchId, userId) =>
  `account:${String(churchId || "").trim()}:${String(userId || "").trim()}`;
const memberLockKey = (churchId, memberId) =>
  `member:${String(churchId || "").trim()}:${String(memberId || "").trim()}`;
const mutationTails = new Map();

/** Serialize the in-memory fallback by both account and roster member. */
export const withVolunteerIdentityMutationLocks = async (
  keys,
  operation,
) => {
  const orderedKeys = [...new Set((keys || []).filter(Boolean))].sort();
  const releases = [];

  for (const key of orderedKeys) {
    const previous = mutationTails.get(key) || Promise.resolve();
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => gate);
    mutationTails.set(key, tail);
    await previous;
    releases.push(() => {
      release();
      if (mutationTails.get(key) === tail) mutationTails.delete(key);
    });
  }

  try {
    return await operation();
  } finally {
    releases.reverse().forEach((release) => release());
  }
};

export const volunteerAccountLockKeys = (churchId, userId, memberId) => [
  userId ? accountLockKey(churchId, userId) : "",
  memberId ? memberLockKey(churchId, memberId) : "",
];

const readSnapshotData = (snapshot) =>
  snapshot?.exists
    ? { id: snapshot.id, ...snapshot.data() }
    : null;

export const createVolunteerIdentityOperations = ({
  COLLECTIONS,
  requireFirestore,
  getDoc,
  queryDocs,
  setDoc,
  deleteDoc,
  nowIso,
  httpError,
}) => {
  const error = httpError || ((statusCode, message) =>
    Object.assign(new Error(message), { statusCode }));
  const linkConflict = (message = conflictMessage) =>
    error(409, message, "VOLUNTEER_IDENTITY_CONFLICT");

  const identityClaimRef = (db, churchId, userId) =>
    db
      .collection(COLLECTIONS.teamVolunteerIdentityClaims)
      .doc(volunteerIdentityClaimId(churchId, userId));

  const linkedMemberQuery = (db, churchId, userId) =>
    db
      .collection(COLLECTIONS.teamRosterMembers)
      .where("churchId", "==", churchId)
      .where("userId", "==", userId);

  const prepareRosterMemberLink = async ({
    churchId,
    memberId,
    userId,
    actorUid,
    source,
    membershipIsBeingCreated = false,
    db = requireFirestore(),
    transaction = null,
  }) => {
    const normalizedChurchId = String(churchId || "").trim();
    const normalizedMemberId = String(memberId || "").trim();
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedChurchId || !normalizedMemberId || !normalizedUserId) {
      throw error(400, "Church, roster member, and account are required.");
    }
    if (transaction && !db) {
      throw new Error("A Firestore transaction requires Firestore.");
    }

    const memberRef = db
      ?.collection(COLLECTIONS.teamRosterMembers)
      .doc(normalizedMemberId);
    const membershipRef = db
      ?.collection(COLLECTIONS.memberships)
      .doc(`${normalizedChurchId}_${normalizedUserId}`);
    const claimRef = db
      ? identityClaimRef(db, normalizedChurchId, normalizedUserId)
      : null;
    const rosterQuery = db
      ? linkedMemberQuery(db, normalizedChurchId, normalizedUserId)
      : null;

    let member;
    let membership;
    let claim;
    let linkedMembers;
    if (transaction) {
      const [memberSnapshot, membershipSnapshot, claimSnapshot, rosterSnapshot] =
        await Promise.all([
          transaction.get(memberRef),
          transaction.get(membershipRef),
          transaction.get(claimRef),
          transaction.get(rosterQuery),
        ]);
      member = readSnapshotData(memberSnapshot);
      membership = readSnapshotData(membershipSnapshot);
      claim = readSnapshotData(claimSnapshot);
      linkedMembers = rosterSnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
    } else {
      const reads = [
        getDoc(COLLECTIONS.teamRosterMembers, normalizedMemberId),
        getDoc(COLLECTIONS.memberships, `${normalizedChurchId}_${normalizedUserId}`),
        getDoc(
          COLLECTIONS.teamVolunteerIdentityClaims,
          volunteerIdentityClaimId(normalizedChurchId, normalizedUserId),
        ),
        queryDocs(
          COLLECTIONS.teamRosterMembers,
          [
            { field: "churchId", value: normalizedChurchId },
            { field: "userId", value: normalizedUserId },
          ],
          { limit: 0 },
        ),
      ];
      [member, membership, claim, linkedMembers] = await Promise.all(reads);
    }

    if (!member || member.churchId !== normalizedChurchId) {
      throw error(404, "Member not found.");
    }
    if (
      !membershipIsBeingCreated &&
      (!membership ||
        membership.churchId !== normalizedChurchId ||
        membership.userId !== normalizedUserId ||
        membership.status !== "active")
    ) {
      throw error(404, "That account is not an active member of this church.");
    }

    const claimMemberId = String(claim?.memberId || "");
    if (
      claim &&
      (claim.churchId !== normalizedChurchId ||
        claim.userId !== normalizedUserId ||
        claimMemberId !== normalizedMemberId)
    ) {
      throw linkConflict();
    }
    const linkedElsewhere = (linkedMembers || []).some((row) => {
      const linkedId = String(row?.memberId || row?.id || "");
      return linkedId && linkedId !== normalizedMemberId;
    });
    if (linkedElsewhere) throw linkConflict();
    if (member.userId && member.userId !== normalizedUserId) {
      throw linkConflict(
        "That roster member is linked to another account. Ask a church administrator to unlink or correct it first.",
      );
    }

    const alreadyLinked = member.userId === normalizedUserId;
    const linkedAt = alreadyLinked ? member.linkedAt || nowIso() : nowIso();
    const patch = {
      userId: normalizedUserId,
      linkedAt,
      updatedAt: nowIso(),
      ...(actorUid ? { updatedByUid: actorUid } : {}),
    };
    const claimData = {
      churchId: normalizedChurchId,
      userId: normalizedUserId,
      memberId: normalizedMemberId,
      source: String(source || "admin"),
      updatedAt: nowIso(),
    };

    return {
      member: { ...member, ...patch },
      changed: !alreadyLinked,
      applyToTransaction: (tx = transaction) => {
        if (!tx) throw new Error("A Firestore transaction is required.");
        if (!alreadyLinked) tx.update(memberRef, patch);
        tx.set(claimRef, claimData, { merge: false });
      },
      applyToStore: async () => {
        if (!alreadyLinked) {
          await setDoc(COLLECTIONS.teamRosterMembers, normalizedMemberId, patch, {
            merge: true,
          });
        }
        await setDoc(
          COLLECTIONS.teamVolunteerIdentityClaims,
          volunteerIdentityClaimId(normalizedChurchId, normalizedUserId),
          claimData,
          { merge: false },
        );
      },
    };
  };

  const linkRosterMember = async (args) => {
    const db = requireFirestore();
    if (db) {
      return db.runTransaction(async (transaction) => {
        const plan = await prepareRosterMemberLink({
          ...args,
          db,
          transaction,
        });
        plan.applyToTransaction(transaction);
        return plan;
      });
    }

    const normalizedChurchId = String(args.churchId || "").trim();
    const normalizedUserId = String(args.userId || "").trim();
    const normalizedMemberId = String(args.memberId || "").trim();
    return withVolunteerIdentityMutationLocks(
      volunteerAccountLockKeys(
        normalizedChurchId,
        normalizedUserId,
        normalizedMemberId,
      ),
      async () => {
        const plan = await prepareRosterMemberLink({
          ...args,
          db: null,
          transaction: null,
        });
        await plan.applyToStore();
        return plan;
      },
    );
  };

  const unlinkRosterMember = async ({
    churchId,
    memberId,
    actorUid,
    allowUnlinkOtherAccount = false,
  }) => {
    const normalizedChurchId = String(churchId || "").trim();
    const normalizedMemberId = String(memberId || "").trim();
    const db = requireFirestore();

    const mutate = async (transaction) => {
      const memberRef = db
        ?.collection(COLLECTIONS.teamRosterMembers)
        .doc(normalizedMemberId);
      const memberSnapshot = transaction
        ? await transaction.get(memberRef)
        : null;
      const member = transaction
        ? readSnapshotData(memberSnapshot)
        : await getDoc(COLLECTIONS.teamRosterMembers, normalizedMemberId);
      if (!member || member.churchId !== normalizedChurchId) {
        throw error(404, "Member not found.");
      }
      const previousUserId = String(member.userId || "");
      if (!previousUserId) return { member, previousUserId: "" };
      if (previousUserId !== actorUid && !allowUnlinkOtherAccount) {
        throw error(
          403,
          "A church administrator must unlink another account from this roster member.",
        );
      }

      const claimRef = db
        ? identityClaimRef(db, normalizedChurchId, previousUserId)
        : null;
      const claim = transaction
        ? readSnapshotData(await transaction.get(claimRef))
        : await getDoc(
            COLLECTIONS.teamVolunteerIdentityClaims,
            volunteerIdentityClaimId(normalizedChurchId, previousUserId),
          );
      const updatedAt = nowIso();
      const patch = {
        userId: "",
        linkedAt: "",
        invitedAt: "",
        updatedAt,
        ...(actorUid ? { updatedByUid: actorUid } : {}),
      };
      if (transaction) {
        transaction.update(memberRef, patch);
        if (claim?.memberId === normalizedMemberId) {
          transaction.delete(claimRef);
        }
      } else {
        await setDoc(COLLECTIONS.teamRosterMembers, normalizedMemberId, patch, {
          merge: true,
        });
        if (claim?.memberId === normalizedMemberId) {
          await deleteDoc(
            COLLECTIONS.teamVolunteerIdentityClaims,
            volunteerIdentityClaimId(normalizedChurchId, previousUserId),
          );
        }
      }
      return {
        member: { ...member, ...patch },
        previousUserId,
      };
    };

    if (db) {
      return db.runTransaction((transaction) => mutate(transaction));
    }

    // The old link identifies the account lock. Re-read under both locks in
    // case a relink completed between the initial read and lock acquisition.
    for (;;) {
      const initial = await getDoc(
        COLLECTIONS.teamRosterMembers,
        normalizedMemberId,
      );
      const previousUserId = String(initial?.userId || "");
      const result = await withVolunteerIdentityMutationLocks(
        volunteerAccountLockKeys(
          normalizedChurchId,
          previousUserId,
          normalizedMemberId,
        ),
        async () => {
          const current = await getDoc(
            COLLECTIONS.teamRosterMembers,
            normalizedMemberId,
          );
          if (String(current?.userId || "") !== previousUserId) return null;
          return mutate(null);
        },
      );
      if (result) return result;
    }
  };

  const clearChurchAccountLinks = async ({
    churchId,
    userId,
    actorUid,
    transaction = null,
  }) => {
    const normalizedChurchId = String(churchId || "").trim();
    const normalizedUserId = String(userId || "").trim();
    const db = requireFirestore();
    const identityId = volunteerIdentityClaimId(
      normalizedChurchId,
      normalizedUserId,
    );
    const claimRef = db
      ?.collection(COLLECTIONS.teamVolunteerIdentityClaims)
      .doc(identityId);
    const query = db
      ?.collection(COLLECTIONS.teamRosterMembers)
      .where("churchId", "==", normalizedChurchId)
      .where("userId", "==", normalizedUserId);

    let linkedMembers;
    let claim;
    if (transaction) {
      const [claimSnapshot, rosterSnapshot] = await Promise.all([
        transaction.get(claimRef),
        transaction.get(query),
      ]);
      claim = readSnapshotData(claimSnapshot);
      linkedMembers = rosterSnapshot.docs.map((doc) => ({
        id: doc.id,
        ref: doc.ref,
        ...doc.data(),
      }));
    } else {
      [claim, linkedMembers] = await Promise.all([
        getDoc(COLLECTIONS.teamVolunteerIdentityClaims, identityId),
        queryDocs(
          COLLECTIONS.teamRosterMembers,
          [
            { field: "churchId", value: normalizedChurchId },
            { field: "userId", value: normalizedUserId },
          ],
          { limit: 0 },
        ),
      ]);
    }

    // Firestore transactions allow at most 500 writes. The removal also writes
    // the membership, church summary, and deterministic identity claim.
    if ((linkedMembers || []).length > 497) {
      throw error(
        409,
        "This account has too many linked roster records to remove in one safe operation. Contact support for help.",
      );
    }
    const updatedAt = nowIso();
    const patch = {
      userId: "",
      linkedAt: "",
      invitedAt: "",
      updatedAt,
      ...(actorUid ? { updatedByUid: actorUid } : {}),
    };
    if (transaction) {
      linkedMembers.forEach((member) => transaction.update(member.ref, patch));
      // Write this deterministic lock even when no claim exists. Link creation
      // reads and writes it, which serializes a concurrent removal with a link.
      transaction.delete(claimRef);
    } else {
      for (const member of linkedMembers) {
        const memberId = String(member.memberId || member.id || "");
        await setDoc(COLLECTIONS.teamRosterMembers, memberId, patch, {
          merge: true,
        });
      }
      await deleteDoc(COLLECTIONS.teamVolunteerIdentityClaims, identityId);
    }
    return {
      memberIds: (linkedMembers || []).map((member) =>
        String(member.memberId || member.id || ""),
      ),
      previousClaim: claim,
    };
  };

  return {
    clearChurchAccountLinks,
    linkRosterMember,
    prepareRosterMemberLink,
    unlinkRosterMember,
  };
};
