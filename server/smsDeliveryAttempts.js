export const SMS_DELIVERY_STATUSES = [
  "pending",
  "accepted",
  "sent",
  "delivered",
  "undelivered",
  "failed",
];

const STATUS_RANK = new Map([
  ["pending", 0],
  ["accepted", 1],
  ["sent", 2],
  ["delivered", 3],
  ["undelivered", 3],
  ["failed", 3],
]);

const FINAL_STATUSES = new Set(["delivered", "undelivered", "failed"]);

export const normalizeSmsDeliveryStatus = (value, fallback = "accepted") => {
  const status = String(value || "").trim().toLowerCase();
  return SMS_DELIVERY_STATUSES.includes(status) ? status : fallback;
};

/** Keep final provider callbacks from being regressed by delayed callbacks. */
export const nextSmsDeliveryStatus = (current, incoming) => {
  const currentStatus = normalizeSmsDeliveryStatus(current, "pending");
  const incomingStatus = normalizeSmsDeliveryStatus(incoming, currentStatus);
  if (currentStatus === incomingStatus) return currentStatus;
  if (FINAL_STATUSES.has(currentStatus)) return currentStatus;
  if ((STATUS_RANK.get(incomingStatus) || 0) < (STATUS_RANK.get(currentStatus) || 0)) {
    return currentStatus;
  }
  return incomingStatus;
};

