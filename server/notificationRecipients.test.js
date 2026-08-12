import test from "node:test";
import assert from "node:assert/strict";

import {
  findUnreachableMemberIds,
  resolveMemberAddress,
} from "./notificationRecipients.js";

const accounts = {
  "user-1": { email: "kevin@account.test" },
  "user-blank": { email: "  " },
};
const lookup = (userId) => accounts[userId] || null;

test("a linked account's address wins over the roster copy", () => {
  // The admin-typed roster address goes stale while still looking
  // authoritative; the account address is the one that person controls.
  const address = resolveMemberAddress(
    { userId: "user-1", email: "old-typo@roster.test" },
    lookup,
  );

  assert.deepEqual(address, {
    email: "kevin@account.test",
    source: "account",
    reachable: true,
  });
});

test("an unlinked member uses the roster address", () => {
  const address = resolveMemberAddress({ email: " Vol@roster.test " }, lookup);

  assert.deepEqual(address, {
    email: "Vol@roster.test",
    source: "member",
    reachable: true,
  });
});

test("a link to an account with no address falls back rather than going silent", () => {
  const address = resolveMemberAddress(
    { userId: "user-blank", email: "vol@roster.test" },
    lookup,
  );

  assert.equal(address.email, "vol@roster.test");
  assert.equal(address.source, "member");
});

test("a member with neither is unreachable, not empty-string addressed", () => {
  assert.deepEqual(resolveMemberAddress({ email: "   " }, lookup), {
    email: "",
    source: "none",
    reachable: false,
  });
  assert.equal(resolveMemberAddress(null, lookup).reachable, false);
  assert.equal(resolveMemberAddress(undefined).reachable, false);
});

test("unreachable members are reported, not silently dropped", () => {
  // The dangerous failure is not the missing email — it is an owner assuming
  // one went out.
  const unreachable = findUnreachableMemberIds(
    [
      { memberId: "m1", email: "" },
      { memberId: "m2", userId: "user-1" },
      { memberId: "m3", email: "vol@roster.test" },
      { memberId: "m4", userId: "user-missing" },
    ],
    lookup,
  );

  assert.deepEqual(unreachable, ["m1", "m4"]);
});
