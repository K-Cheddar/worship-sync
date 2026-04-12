/**
 * Basic shape check before server/auth (local@domain with no spaces). Not a full RFC parser.
 */
export const EMAIL_FORMAT_REGEX = /^[^\s@]+@[^\s@]+$/;

export const INVALID_EMAIL_FORMAT_MESSAGE =
  "That email address does not look valid. Check it and try again.";

export const isValidEmailFormat = (value: string): boolean =>
  EMAIL_FORMAT_REGEX.test(value.trim());
