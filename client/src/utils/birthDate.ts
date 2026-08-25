import type { BirthDate } from "../api/authTypes";

export const isCompleteBirthDate = (birthDate?: BirthDate | null) =>
  Number.isInteger(birthDate?.year);

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
