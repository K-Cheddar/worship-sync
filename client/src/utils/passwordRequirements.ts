/** Matches Firebase Auth default minimum password length (server-side). */
export const FIREBASE_PASSWORD_MIN_LENGTH = 6;

/** Stricter client policy for new passwords (invite signup, reset). */
export const PASSWORD_POLICY_MIN_LENGTH = 8;

/** Of uppercase, lowercase, number, symbol — at least this many must be present. */
export const PASSWORD_CHARACTER_TYPES_MIN = 3;

export const PASSWORD_CHARACTER_TYPES_TOTAL = 4;

const hasLowercase = (value: string) => /[a-z]/.test(value);
const hasUppercase = (value: string) => /[A-Z]/.test(value);
const hasDigit = (value: string) => /\d/.test(value);
const hasSpecial = (value: string) => /[^A-Za-z0-9]/.test(value);

/** How many of the four character types (lower, upper, digit, special) are present. */
export const countCharacterTypesMet = (password: string): number =>
  [
    hasLowercase(password),
    hasUppercase(password),
    hasDigit(password),
    hasSpecial(password),
  ].filter(Boolean).length;

export type PasswordRequirementId =
  | "length"
  | "lower"
  | "upper"
  | "digit"
  | "special";

export type PasswordRequirementCheck = {
  id: PasswordRequirementId;
  label: string;
  met: boolean;
};

/** Live checklist used for UI and validation. */
export const getPasswordRequirementChecks = (
  password: string,
): PasswordRequirementCheck[] => [
  {
    id: "length",
    label: `At least ${PASSWORD_POLICY_MIN_LENGTH} characters`,
    met: password.length >= PASSWORD_POLICY_MIN_LENGTH,
  },
  {
    id: "lower",
    label: "One lowercase letter",
    met: hasLowercase(password),
  },
  {
    id: "upper",
    label: "One uppercase letter",
    met: hasUppercase(password),
  },
  {
    id: "digit",
    label: "One number",
    met: hasDigit(password),
  },
  {
    id: "special",
    label: "One symbol (for example !@#$%)",
    met: hasSpecial(password),
  },
];

export const passwordMeetsPolicy = (password: string): boolean =>
  password.length >= PASSWORD_POLICY_MIN_LENGTH &&
  countCharacterTypesMet(password) >= PASSWORD_CHARACTER_TYPES_MIN;

export type PasswordStrengthLevel = "weak" | "fair" | "good" | "strong";

export const getPasswordPolicyValidationMessage = (
  password: string,
): string | null => {
  if (!password) {
    return "Enter your password.";
  }
  if (!passwordMeetsPolicy(password)) {
    return "Meet every password requirement below.";
  }
  return null;
};

export const normalizeEmailForCompare = (value: string) =>
  value.trim().toLowerCase();
