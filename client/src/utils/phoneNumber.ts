/** Display the normalized U.S. number stored on a roster member. */
export const formatUsPhoneNumber = (value: string | null | undefined) => {
  const normalized = String(value || "").trim();
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(normalized);
  return match ? `(${match[1]}) ${match[2]}-${match[3]}` : normalized;
};

/** Format a U.S. phone number as it is entered in a form. */
export const formatUsPhoneInput = (value: string) => {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("1")) digits = digits.slice(1);
  digits = digits.slice(0, 10);

  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
};
