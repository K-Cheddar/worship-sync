import zxcvbn from "zxcvbn";
import {
  FIREBASE_PASSWORD_MIN_LENGTH,
  PASSWORD_CHARACTER_TYPES_MIN,
  PASSWORD_POLICY_MIN_LENGTH,
  getPasswordPolicyValidationMessage,
  getPasswordRequirementChecks,
  normalizeEmailForCompare,
  passwordMeetsPolicy,
} from "./passwordRequirements";
import { mapZxcvbnResultToDisplay } from "./zxcvbnStrength";

describe("normalizeEmailForCompare", () => {
  it("trims and lowercases for invite email matching", () => {
    expect(normalizeEmailForCompare("  User@Example.COM ")).toBe(
      "user@example.com",
    );
  });
});

describe("FIREBASE_PASSWORD_MIN_LENGTH", () => {
  it("matches Firebase Auth default minimum", () => {
    expect(FIREBASE_PASSWORD_MIN_LENGTH).toBe(6);
  });
});

describe("password policy", () => {
  const strong = "Aa1!aaaa";

  it("requires minimum length and any PASSWORD_CHARACTER_TYPES_MIN of four character types", () => {
    expect(PASSWORD_POLICY_MIN_LENGTH).toBe(8);
    expect(PASSWORD_CHARACTER_TYPES_MIN).toBe(3);
    expect(passwordMeetsPolicy("password1")).toBe(false);
    expect(passwordMeetsPolicy("short1!a")).toBe(true);
    expect(passwordMeetsPolicy("Password12")).toBe(true);
    expect(passwordMeetsPolicy(strong)).toBe(true);
  });

  it("reports requirement checklist", () => {
    const checks = getPasswordRequirementChecks("a");
    expect(checks.find((c) => c.id === "lower")?.met).toBe(true);
    expect(checks.find((c) => c.id === "length")?.met).toBe(false);
  });

  it("getPasswordPolicyValidationMessage returns actionable messages", () => {
    expect(getPasswordPolicyValidationMessage("")).toBe("Enter your password.");
    expect(getPasswordPolicyValidationMessage("abc")).toContain("Meet every");
    expect(getPasswordPolicyValidationMessage(strong)).toBeNull();
  });

  it("mapZxcvbnResultToDisplay maps zxcvbn score to levels and bar", () => {
    const empty = mapZxcvbnResultToDisplay(zxcvbn(""));
    expect(empty.level).toBe("weak");
    expect(empty.barPercent).toBe(0);

    const passphrase = mapZxcvbnResultToDisplay(
      zxcvbn("correct horse battery staple"),
    );
    expect(passphrase.score).toBe(4);
    expect(passphrase.level).toBe("strong");
    expect(passphrase.barPercent).toBe(100);
  });
});
