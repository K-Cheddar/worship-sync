/**
 * Where a notification for a roster member actually goes.
 *
 * The rule, decided when member/account linking was built: **one effective
 * address per person, never two.**
 *
 * - Linked to an account -> the account's email. They control it. An
 *   admin-typed copy on the roster record goes stale while still looking
 *   authoritative, so once an account exists it wins outright.
 * - Not linked -> `member.email`, the contact address an admin or intake form
 *   supplied.
 * - Neither -> nobody is reachable, and the caller must be able to tell.
 *
 * Sending to both is the tempting mistake. It means two inboxes to check, two
 * copies of every reminder, and no answer to "which one do I reply to". Reaching
 * an *additional* person — a parent for a teen volunteer — is a real need, but
 * it belongs in a deliberate household/additional-recipients feature, not in an
 * ambiguous second field.
 *
 * Pure: the caller supplies the account lookup, because resolving it differs
 * between a single send and a batch.
 */

const cleanEmail = (value) => String(value ?? "").trim();

/**
 * @typedef {Object} MemberAddress
 * @property {string} email        Empty when unreachable.
 * @property {"account" | "member" | "none"} source
 * @property {boolean} reachable
 */

/**
 * Effective address for one roster member.
 * @param {{ userId?: string, email?: string } | null | undefined} member
 * @param {(userId: string) => ({ email?: string } | null | undefined)} lookupAccount
 * @returns {MemberAddress}
 */
export const resolveMemberAddress = (member, lookupAccount = () => null) => {
  const unreachable = { email: "", source: "none", reachable: false };
  if (!member) return unreachable;

  if (member.userId) {
    const account = lookupAccount(member.userId);
    const accountEmail = cleanEmail(account?.email);
    if (accountEmail) {
      return { email: accountEmail, source: "account", reachable: true };
    }
    // Linked but the account carries no address. Fall through rather than give
    // up: the roster address is stale-prone, but a stale address beats silence,
    // and this only happens for accounts created without one.
  }

  const memberEmail = cleanEmail(member.email);
  if (memberEmail) {
    return { email: memberEmail, source: "member", reachable: true };
  }
  return unreachable;
};

/**
 * Members who cannot be reached at all.
 *
 * Surfaced rather than silently skipped: the dangerous failure is not the
 * missing email, it is an owner believing one went out. Mirrors
 * `canNotifyMember` on the client, which drives the roster warnings.
 * @param {Array<{ memberId?: string, userId?: string, email?: string }>} members
 * @param {(userId: string) => ({ email?: string } | null | undefined)} lookupAccount
 * @returns {string[]} memberIds
 */
export const findUnreachableMemberIds = (members, lookupAccount) =>
  (members || [])
    .filter((member) => !resolveMemberAddress(member, lookupAccount).reachable)
    .map((member) => String(member?.memberId || ""))
    .filter(Boolean);
