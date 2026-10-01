import { canNotifyMember } from "./unnotifiableMembers";
import type { TeamRosterMember } from "../../api/authTypes";

describe("canNotifyMember", () => {
  it("is true with an email", () => {
    expect(canNotifyMember({ email: "a@b.com" })).toBe(true);
  });

  it("is true with a linked account even without an email", () => {
    // The account carries the address; the roster record need not repeat it.
    expect(canNotifyMember({ userId: "user-1" })).toBe(true);
  });

  it("is false with neither", () => {
    expect(canNotifyMember({})).toBe(false);
  });

  it("does not treat a phone number alone as notification eligibility", () => {
    const phoneOnlyMember: TeamRosterMember = {
      memberId: "member-1",
      churchId: "church-1",
      firstName: "Rae",
      lastName: "Kim",
      phoneNumber: "+15555550123",
      positionIds: [],
      blockoutDates: [],
    };
    expect(canNotifyMember(phoneOnlyMember)).toBe(false);
  });

  it("treats a whitespace-only email as missing", () => {
    expect(canNotifyMember({ email: "   " })).toBe(false);
  });
});
