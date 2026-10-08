const CACHE_TTL_MS = 30_000;
const timeZoneCache = new Map();

export const isValidChurchServiceTimeZone = (value) => {
  const timeZone = String(value || "").trim();
  if (!timeZone || timeZone.length > 100) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
    return true;
  } catch {
    return false;
  }
};

export const invalidateChurchServiceTimeZone = (churchId) => {
  timeZoneCache.delete(churchId);
};

export const readChurchServiceTimeZone = async ({ getFirestore, churchId }) => {
  const cached = timeZoneCache.get(churchId);
  if (cached && cached.expiresAt > Date.now()) return cached.timeZone;

  let timeZone = "UTC";
  const db = getFirestore?.();
  if (db) {
    const church = await db.collection("churches").doc(churchId).get();
    const configured = church.data()?.serviceTimeZone;
    if (isValidChurchServiceTimeZone(configured)) {
      timeZone = String(configured).trim();
    }
  }
  timeZoneCache.set(churchId, {
    timeZone,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
  return timeZone;
};
