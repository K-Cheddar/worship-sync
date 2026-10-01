import {
  dispatchAvailabilityNotificationBatch,
  prepareAvailabilityNotificationBatch,
} from "../../api/auth";
import type { NotificationBatch, NotificationIntentType } from "../../api/authTypes";

const requestKey = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** Shares the same idempotent prepare path between Forms and Messages. */
export const prepareAvailabilityBatchForMembers = async ({
  churchId,
  formId,
  intentType,
  memberIds,
}: {
  churchId: string;
  formId: string;
  intentType: Extract<NotificationIntentType, "availability_request" | "availability_reminder">;
  memberIds: string[];
}) => {
  const requestKeyStorageKey = `worshipsync:pending-notification-request:${churchId}:${formId}:${intentType}`;
  const memberSelection = [...new Set(memberIds)].sort();
  const selectionSignature = JSON.stringify(memberSelection);
  let storedRequest: { selectionSignature: string; requestKey: string } | null = null;
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(requestKeyStorageKey) || "null");
    if (parsed && typeof parsed === "object" && "selectionSignature" in parsed && "requestKey" in parsed && typeof parsed.selectionSignature === "string" && typeof parsed.requestKey === "string") {
      storedRequest = { selectionSignature: parsed.selectionSignature, requestKey: parsed.requestKey };
    }
  } catch {
    // Ignore older or malformed values and start a fresh idempotent request.
  }
  const batchRequestKey = storedRequest?.selectionSignature === selectionSignature
    ? storedRequest.requestKey
    : requestKey();
  window.localStorage.setItem(requestKeyStorageKey, JSON.stringify({ selectionSignature, requestKey: batchRequestKey }));
  const response = await prepareAvailabilityNotificationBatch(churchId, {
    intentType,
    formId,
    memberIds: memberSelection,
    requestKey: batchRequestKey,
  });
  window.localStorage.setItem(`worshipsync:last-notification-batch:${churchId}:${formId}`, response.batch.batchId);
  window.localStorage.removeItem(requestKeyStorageKey);
  return response.batch;
};

/** Dispatches only the exact reviewed batch and approval version. */
export const dispatchReviewedAvailabilityBatch = (
  churchId: string,
  batch: NotificationBatch,
) => dispatchAvailabilityNotificationBatch(churchId, batch.batchId, batch.approvalVersion);
