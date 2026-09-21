/** Display the normalized U.S. number stored on a roster member. */
export const formatUsPhoneNumber = (value: string | null | undefined) => {
  const normalized = String(value || "").trim();
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(normalized);
  return match ? `(${match[1]}) ${match[2]}-${match[3]}` : normalized;
};
