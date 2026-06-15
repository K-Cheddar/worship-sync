/** Parse `yyyy-MM-dd` into a local Date without UTC drift. */
export const parsePlainDate = (value: string): Date | undefined => {
  const [year, month, day] = (value || "")
    .split("-")
    .map((part) => Number(part));
  if (!year || !month || !day) return undefined;
  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return undefined;
  }
  return parsed;
};

export const formatPlainDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

/** Auto-insert `/` separators while typing an MM/DD/YYYY date. */
export const formatDateInputValue = (raw: string): string => {
  // Preserve alternate typed formats (ISO, month names).
  if (/[a-zA-Z]/.test(raw) || /^\d{4}-\d{1,2}-\d{1,2}/.test(raw.trim())) {
    return raw;
  }

  const digits = raw.replace(/\D/g, "").slice(0, 8);
  if (!digits) return "";

  let formatted = digits.slice(0, 2);
  if (digits.length >= 2) formatted += "/";
  if (digits.length >= 3) {
    formatted += digits.slice(2, 4);
    if (digits.length >= 4) formatted += "/";
  }
  if (digits.length >= 5) {
    formatted += digits.slice(4);
  }
  return formatted;
};
