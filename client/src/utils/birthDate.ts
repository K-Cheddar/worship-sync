import type { BirthDate } from "../api/authTypes";

export const isCompleteBirthDate = (birthDate?: BirthDate | null) =>
  Number.isInteger(birthDate?.year);

/**
 * Client-side feedback for an in-progress birthday. The server performs the
 * same validation authoritatively when a form is submitted.
 */
export const getBirthDateValidationError = (birthDate?: BirthDate | null) => {
  if (!birthDate) return null;

  const month = Number(birthDate.month);
  const day = Number(birthDate.day);
  const year = birthDate.year;
  if (
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12 ||
    !Number.isInteger(day) ||
    day < 1 ||
    day > 31
  ) {
    return "Birthday needs a valid month and day.";
  }

  const currentYear = new Date().getFullYear();
  if (year !== undefined && (!Number.isInteger(year) || year < 1 || year > currentYear)) {
    return "Birthday needs a valid year.";
  }

  const validationYear = year ?? 2000;
  const date = new Date(Date.UTC(validationYear, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return "Birthday needs a valid month and day.";
  }

  return null;
};

export const formatBirthDate = (birthDate?: BirthDate | null) => {
  if (!birthDate) return "";
  const date = new Date(birthDate.year || 2000, birthDate.month - 1, birthDate.day);
  if (date.getMonth() !== birthDate.month - 1 || date.getDate() !== birthDate.day) {
    return "";
  }
  return date.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    ...(birthDate.year ? { year: "numeric" } : {}),
  });
};
