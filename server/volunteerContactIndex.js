import crypto from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { normalizeUsPhoneNumber } from "./smsConsent.js";

export const normalizeVolunteerContact = (channel, value) => channel === "sms"
  ? normalizeUsPhoneNumber(value) : String(value || "").trim().toLowerCase();
const keyedHash = (secret, value) => crypto.createHmac("sha256", secret)
  .update(`volunteer-contact-index/v1/${JSON.stringify(value)}`).digest("hex");
const keyId = (secret) => keyedHash(secret, ["key-id"]);
const contactKey = (secret, churchId, channel, address) =>
  keyedHash(secret, [churchId, channel, normalizeVolunteerContact(channel, address)]);

export const changesVolunteerContactOwnership = (fields) =>
  ["churchId", "archivedAt", "email", "phoneNumber"].some((field) => Object.hasOwn(fields, field));

// Derived fields live on the roster document: ownership and its lookup keys
// cannot drift across separate commits, and collisions remain separate rows.
export const volunteerContactIndexFields = (member, secret) => {
  if (!secret) return {};
  const keys = [];
  if (member.churchId && !member.archivedAt) {
    for (const [channel, value] of [["email", member.email], ["sms", member.phoneNumber]]) {
      const address = normalizeVolunteerContact(channel, value);
      if (address) keys.push(contactKey(secret, member.churchId, channel, address));
    }
  }
  return { volunteerContactKeys: keys, volunteerContactKeyId: keyId(secret) };
};

export const createVolunteerContactIndex = ({
  db, memberCollection, secret, coverageCollection = "volunteerContactIndexCoverage",
}) => {
  const roster = db.collection(memberCollection);
  const coverage = (churchId) => db.collection(coverageCollection).doc(keyedHash(secret, ["coverage", churchId]));
  const get = (query, transaction) => transaction ? transaction.get(query) : query.get();

  const hasUniqueOwner = async (identity, channel, address, transaction) => {
    const marker = await get(coverage(identity.churchId), transaction);
    if (marker.exists && marker.data().ready === true && marker.data().keyId === keyId(secret)) {
      const matches = await get(roster.where("volunteerContactKeys", "array-contains",
        contactKey(secret, identity.churchId, channel, address)).limit(2), transaction);
      if (matches.size !== 1 || matches.docs[0].id !== identity.memberId) return false;
      const member = matches.docs[0].data();
      return member.churchId === identity.churchId && !member.archivedAt
        && member.volunteerContactKeyId === keyId(secret)
        && normalizeVolunteerContact(channel, channel === "sms" ? member.phoneNumber : member.email) === address;
    }
    // Until coverage is audited, legacy representations remain authoritative.
    // Page without a roster-size ceiling and stop immediately on ambiguity.
    const query = roster.where("churchId", "==", identity.churchId).limit(500);
    let cursor; let owner;
    do {
      const page = await get(cursor ? query.startAfter(cursor) : query, transaction);
      for (const row of page.docs) {
        const member = row.data();
        if (member.archivedAt || normalizeVolunteerContact(channel, channel === "sms" ? member.phoneNumber : member.email) !== address) continue;
        if (owner) return false;
        owner = row.id;
      }
      cursor = page.size === 500 ? page.docs.at(-1) : null;
    } while (cursor);
    return owner === identity.memberId;
  };

  const pages = async (churchId, pageSize, visit) => {
    const query = roster.where("churchId", "==", churchId).limit(pageSize);
    let cursor;
    do {
      const page = await (cursor ? query.startAfter(cursor) : query).get();
      for (const row of page.docs) await visit(row);
      cursor = page.size === pageSize ? page.docs.at(-1) : null;
    } while (cursor);
  };

  const auditChurch = async (churchId, { pageSize = 500 } = {}) => {
    await coverage(churchId).set({ ready: false, keyId: keyId(secret) });
    let members = 0; let incomplete = 0;
    const owners = new Map();
    await pages(churchId, pageSize, async (row) => {
      members += 1;
      const member = row.data();
      const expected = volunteerContactIndexFields(member, secret);
      if (member.volunteerContactKeyId !== expected.volunteerContactKeyId
        || !isDeepStrictEqual(member.volunteerContactKeys, expected.volunteerContactKeys)) incomplete += 1;
      for (const key of expected.volunteerContactKeys) owners.set(key, (owners.get(key) || 0) + 1);
    });
    const collisions = [...owners.values()].filter((count) => count > 1).length;
    const complete = incomplete === 0;
    await coverage(churchId).set({ ready: complete, keyId: keyId(secret), members, incomplete, collisions });
    return { complete, members, incomplete, collisions };
  };

  const backfillChurch = async (churchId, { pageSize = 500 } = {}) => {
    await coverage(churchId).set({ ready: false, keyId: keyId(secret) });
    await pages(churchId, pageSize, (row) => db.runTransaction(async (transaction) => {
      const latest = await transaction.get(row.ref);
      if (!latest.exists || latest.data().churchId !== churchId) return;
      transaction.update(row.ref, volunteerContactIndexFields(latest.data(), secret));
    }));
    return auditChurch(churchId, { pageSize });
  };
  return { hasUniqueOwner, backfillChurch, auditChurch };
};
