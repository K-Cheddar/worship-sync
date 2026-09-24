const formatNumber = (value: number, maximumFractionDigits = 1) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(value);

export const formatStorageBytes = (bytes: number) => {
  const safeBytes = Math.max(0, bytes);
  if (safeBytes < 1024) return `${formatNumber(safeBytes, 0)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let amount = safeBytes / 1024;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  return `${formatNumber(amount)} ${units[unitIndex]}`;
};

export const formatStorageMinutes = (minutes: number) =>
  `${formatNumber(Math.max(0, minutes))} min`;

export const getQuotaProgress = (used: number, limit: number) =>
  limit > 0 ? Math.min(100, Math.max(0, (used / limit) * 100)) : 100;

export const getQuotaRemainingLabel = (used: number, limit: number) => {
  if (used > limit) return "Over limit";
  if (used >= limit) return "Storage full";
  return null;
};
