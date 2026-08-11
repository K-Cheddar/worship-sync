/**
 * Idempotency for notification sends.
 *
 * Every send is identified by **(recipient, event, subject, occurrence)**. Those
 * four are what make a notification "the same one":
 * - recipient — the address, so two people on one shared address each get theirs
 * - event     — `schedule.assigned` vs `schedule.changed` are different news
 * - subject   — the schedule, form, or plan the news is about
 * - occurrence— the specific service date, so being on four Sundays is four
 *               notifications and not one
 *
 * Without this, anything that retries double-sends. The reminder pass in
 * particular walks upcoming services on a timer: a restart mid-pass, or two
 * passes overlapping, would mail the same person the same reminder twice. Email
 * has no undo, and a volunteer who gets three copies of one reminder stops
 * reading them — which costs more than the reminder was worth.
 *
 * Key derivation is pure and lives here; the storage functions are a thin
 * wrapper the caller injects a store into, so this module stays testable
 * without Firestore.
 */

const part = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    // Keep the separator unambiguous: a value containing "|" must not be able
    // to impersonate a different key by shifting the field boundaries.
    .replace(/\|/g, "\\|");

/**
 * Stable identity for one notification. Same inputs, same key, forever — it is
 * persisted, so changing this function retroactively un-suppresses everything
 * already sent.
 * @param {{ recipient: string, event: string, subject?: string, occurrence?: string }} params
 * @returns {string}
 */
export const deliveryKey = ({ recipient, event, subject, occurrence }) =>
  [part(recipient), part(event), part(subject), part(occurrence)].join("|");

/**
 * Split a batch into what still needs sending and what is already done.
 *
 * Pure so the suppression rule can be tested without a store. Duplicates
 * *within* the batch collapse too — a member listed in two positions on one
 * service should hear about it once.
 * @param {Array<{ recipient: string, event: string, subject?: string, occurrence?: string }>} sends
 * @param {Set<string>} alreadyDeliveredKeys
 * @returns {{ pending: Array<object & { deliveryKey: string }>, suppressed: string[] }}
 */
export const partitionUndelivered = (sends, alreadyDeliveredKeys) => {
  const seen = new Set();
  const pending = [];
  const suppressed = [];
  for (const send of sends || []) {
    const key = deliveryKey(send);
    if (seen.has(key)) {
      suppressed.push(key);
      continue;
    }
    seen.add(key);
    if (alreadyDeliveredKeys?.has(key)) {
      suppressed.push(key);
      continue;
    }
    pending.push({ ...send, deliveryKey: key });
  }
  return { pending, suppressed };
};

/**
 * Ledger over an injected store.
 *
 * `record` is called **after** a successful send, never before. The two
 * orderings trade different failures: recording first risks silently dropping a
 * notification when the send fails, recording after risks a duplicate if the
 * process dies between send and record. A duplicate is recoverable — the reader
 * sees the same thing twice — while a drop is invisible to everyone, and this
 * whole system exists so people are not left uninformed.
 *
 * @param {{
 *   listKeys: (churchId: string, keys: string[]) => Promise<string[]>,
 *   saveKey: (churchId: string, entry: object) => Promise<unknown>,
 * }} store
 */
export const createNotificationLedger = (store) => ({
  /**
   * Which of these sends have not gone out yet.
   * @param {string} churchId
   * @param {Array<{ recipient: string, event: string, subject?: string, occurrence?: string }>} sends
   */
  async selectPending(churchId, sends) {
    const keyed = (sends || []).map((send) => ({
      ...send,
      deliveryKey: deliveryKey(send),
    }));
    if (keyed.length === 0) return { pending: [], suppressed: [] };
    const delivered = await store.listKeys(
      churchId,
      keyed.map((send) => send.deliveryKey),
    );
    return partitionUndelivered(sends, new Set(delivered || []));
  },

  /**
   * Mark one send as done. Failures are the caller's to log, not to retry —
   * a lost ledger write costs at most one duplicate later.
   */
  async record(churchId, send) {
    return store.saveKey(churchId, {
      deliveryKey: deliveryKey(send),
      recipient: send.recipient,
      event: send.event,
      subject: send.subject || "",
      occurrence: send.occurrence || "",
    });
  },
});
