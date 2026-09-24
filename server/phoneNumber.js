/** Normalize the initial supported phone region (U.S.) to E.164. */
export const normalizeUsPhoneNumber = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (!/^\+?[\d\s().-]+$/.test(raw)) {
    throw new Error("Invalid U.S. phone number.");
  }

  const digits = raw.replace(/\D/g, "");
  const nationalDigits =
    digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (
    nationalDigits.length !== 10 ||
    !/^[2-9]\d{2}[2-9]\d{6}$/.test(nationalDigits)
  ) {
    throw new Error("Invalid U.S. phone number.");
  }
  if (raw.startsWith("+") && !digits.startsWith("1")) {
    throw new Error("Invalid U.S. phone number.");
  }
  return `+1${nationalDigits}`;
};

export const formatUsPhoneNumber = (value) => {
  const normalized = String(value ?? "").trim();
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(normalized);
  return match ? `(${match[1]}) ${match[2]}-${match[3]}` : normalized;
};
