import type { TeamRosterMember } from "../../api/authTypes";
import { hasMemberContactInfo } from "./memberContactInfo";

const rosterMember = (
  overrides: Partial<TeamRosterMember> = {},
): TeamRosterMember => ({
  memberId: "member-1",
  churchId: "church-1",
  firstName: "Rae",
  lastName: "Kim",
  positionIds: [],
  blockoutDates: [],
  ...overrides,
});

describe("hasMemberContactInfo", () => {
  it("returns true with email only", () => {
    expect(hasMemberContactInfo(rosterMember({ email: "a@example.com" }))).toBe(
      true,
    );
  });

  it("returns true with phone only", () => {
    expect(hasMemberContactInfo(rosterMember({ phoneNumber: "+15555550123" }))).toBe(
      true,
    );
  });

  it("returns true with both email and phone", () => {
    expect(
      hasMemberContactInfo(
        rosterMember({ email: "a@example.com", phoneNumber: "+15555550123" }),
      ),
    ).toBe(true);
  });

  it("returns false when neither email nor phone is present", () => {
    expect(hasMemberContactInfo(rosterMember())).toBe(false);
  });

  it("does not treat a linked account as roster contact information", () => {
    expect(hasMemberContactInfo(rosterMember({ userId: "user-1" }))).toBe(false);
  });

  it("treats whitespace-only contact fields as missing", () => {
    expect(
      hasMemberContactInfo(rosterMember({ email: "  ", phoneNumber: "  " })),
    ).toBe(false);
  });
});
