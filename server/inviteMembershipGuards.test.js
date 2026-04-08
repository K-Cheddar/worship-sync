import test from "node:test";
import assert from "node:assert/strict";
import { getInviteMembershipConflict } from "./inviteMembershipGuards.js";

test("returns null when there are no active memberships", () => {
  assert.equal(
    getInviteMembershipConflict({
      userId: "u1",
      invitedChurchId: "c1",
      activeMemberships: [],
    }),
    null,
  );
});

test("returns 409 when user already belongs to a different church", () => {
  const conflict = getInviteMembershipConflict({
    userId: "u1",
    invitedChurchId: "c2",
    activeMemberships: [{ userId: "u1", churchId: "c1", status: "active" }],
  });
  assert.equal(conflict?.statusCode, 409);
  assert.match(conflict?.message || "", /already belongs to a church/i);
});

test("returns 400 when user is already an active member of the invited church", () => {
  const conflict = getInviteMembershipConflict({
    userId: "u1",
    invitedChurchId: "c1",
    activeMemberships: [{ userId: "u1", churchId: "c1", status: "active" }],
  });
  assert.equal(conflict?.statusCode, 400);
  assert.match(conflict?.message || "", /already a member of this church/i);
});

test("ignores inactive or other-user rows", () => {
  assert.equal(
    getInviteMembershipConflict({
      userId: "u1",
      invitedChurchId: "c2",
      activeMemberships: [
        { userId: "u1", churchId: "c1", status: "removed" },
        { userId: "u2", churchId: "c1", status: "active" },
      ],
    }),
    null,
  );
});
