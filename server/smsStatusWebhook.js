import { nextSmsDeliveryStatus } from "./smsDeliveryAttempts.js";

export const createSmsStatusWebhookHandler = ({
  queryDocs,
  setDoc,
  nowIso,
  validateSignature,
  normalizeStatus,
  getCallbackUrl,
  getAuthToken,
}) => async (req, res) => {
  try {
    const signature = String(req.headers["x-twilio-signature"] || "").trim();
    const callbackUrl = getCallbackUrl(req);
    const valid = validateSignature({
      authToken: getAuthToken(),
      signature,
      url: callbackUrl,
      params: req.body || {},
    });
    if (!valid) {
      return res.status(403).json({ success: false, errorMessage: "Invalid webhook signature." });
    }

    const providerMessageId = String(
      req.body?.MessageSid || req.body?.SmsSid || "",
    ).trim();
    if (!providerMessageId) {
      return res.status(400).json({ success: false, errorMessage: "Provider message ID is required." });
    }

    const [attempt] = await queryDocs(
      "smsDeliveryAttempts",
      [{ field: "providerMessageId", value: providerMessageId }],
      { limit: 1 },
    );
    // A valid callback for an old/deleted/unknown message is intentionally a
    // successful no-op so Twilio does not retry it forever.
    if (!attempt) return res.json({ success: true, ignored: true });

    const incomingStatus = normalizeStatus(req.body?.MessageStatus || req.body?.SmsStatus);
    const nextStatus = nextSmsDeliveryStatus(attempt.status, incomingStatus);
    if (nextStatus !== attempt.status) {
      await setDoc(
        "smsDeliveryAttempts",
        attempt.attemptId || attempt.id,
        {
          status: nextStatus,
          ...(req.body?.ErrorCode ? { failureCode: String(req.body.ErrorCode).slice(0, 80) } : {}),
          ...(req.body?.ErrorMessage ? { failureMessage: String(req.body.ErrorMessage).slice(0, 500) } : {}),
          updatedAt: nowIso(),
        },
        { merge: true },
      );
    }
    return res.json({ success: true, updated: nextStatus !== attempt.status });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      errorMessage: error.message || "Could not process the SMS status callback.",
    });
  }
};

