import {
  FIREBASE_PASSWORD_MIN_LENGTH,
  normalizeEmailForCompare,
} from "./passwordRequirements";

describe("normalizeEmailForCompare", () => {
  it("trims and lowercases for invite email matching", () => {
    expect(normalizeEmailForCompare("  User@Example.COM ")).toBe("user@example.com");
  });
});

describe("FIREBASE_PASSWORD_MIN_LENGTH", () => {
  it("matches Firebase Auth default minimum", () => {
    expect(FIREBASE_PASSWORD_MIN_LENGTH).toBe(6);
  });
});
