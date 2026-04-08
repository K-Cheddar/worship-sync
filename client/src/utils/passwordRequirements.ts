/** Matches Firebase Auth default minimum password length. */
export const FIREBASE_PASSWORD_MIN_LENGTH = 6;

export const firebasePasswordRequirementsHint = `At least ${FIREBASE_PASSWORD_MIN_LENGTH} characters. For a stronger password, use a mix of letters, numbers, and symbols.`;

export const normalizeEmailForCompare = (value: string) =>
  value.trim().toLowerCase();
