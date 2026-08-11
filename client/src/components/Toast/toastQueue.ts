import type { ToastData } from "./ToastContainer";

/** Soft cap so stacked toasts stay readable during live operation. */
export const MAX_VISIBLE_TOASTS = 3;

const defaultVariant = (toast: Pick<ToastData, "variant">) =>
  toast.variant ?? "info";

const defaultPosition = (toast: Pick<ToastData, "position">) =>
  toast.position ?? "top-center";

export const isDuplicateToast = (existing: ToastData, next: ToastData) => {
  if (!existing.message || !next.message) return false;
  return (
    existing.message === next.message &&
    defaultVariant(existing) === defaultVariant(next) &&
    defaultPosition(existing) === defaultPosition(next)
  );
};

/**
 * Prefer dropping older low-priority toasts first so errors and persistent
 * action toasts stay visible when the stack is full.
 */
export const findToastEvictionIndex = (toasts: ToastData[]): number => {
  if (toasts.length === 0) return -1;

  const softIdx = toasts.findIndex(
    (toast) => !toast.persist && toast.variant !== "error",
  );
  if (softIdx !== -1) return softIdx;

  const nonPersistIdx = toasts.findIndex((toast) => !toast.persist);
  if (nonPersistIdx !== -1) return nonPersistIdx;

  return 0;
};

export const appendToast = (
  prev: ToastData[],
  next: ToastData,
): ToastData[] => {
  let nextToasts = prev.filter((toast) => !isDuplicateToast(toast, next));

  while (nextToasts.length >= MAX_VISIBLE_TOASTS) {
    const evictIdx = findToastEvictionIndex(nextToasts);
    if (evictIdx < 0) break;
    nextToasts = nextToasts.filter((_, index) => index !== evictIdx);
  }

  return [...nextToasts, next];
};
