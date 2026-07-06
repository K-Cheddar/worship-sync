import test from "node:test";
import assert from "node:assert/strict";
import { selectInviteAcceptedAdminRecipients } from "./inviteAcceptedNotifyRecipients.js";

test("selectInviteAcceptedAdminRecipients returns unique active admin emails", () => {
  assert.deepEqual(
    selectInviteAcceptedAdminRecipients([
      { isActiveAdmin: true, email: " Admin@example.com " },
      { isActiveAdmin: true, email: "admin@example.com" },
      { isActiveAdmin: false, email: "member@example.com" },
      { isActiveAdmin: true, email: "" },
      { isActiveAdmin: true, email: "other-admin@example.com" },
    ]),
    ["admin@example.com", "other-admin@example.com"],
  );
});

test("selectInviteAcceptedAdminRecipients excludes the accepted user", () => {
  assert.deepEqual(
    selectInviteAcceptedAdminRecipients([
      {
        isActiveAdmin: true,
        isAcceptedUser: true,
        email: "new-admin@example.com",
      },
      { isActiveAdmin: true, email: "existing-admin@example.com" },
    ]),
    ["existing-admin@example.com"],
  );
});
