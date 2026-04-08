/**
 * Basic shape check before server/auth (local@domain with no spaces). Not a full RFC parser.
 */
export const EMAIL_FORMAT_REGEX = /^[^\s@]+@[^\s@]+$/;

export const isValidEmailFormat = (value: string): boolean =>
  EMAIL_FORMAT_REGEX.test(value.trim());
