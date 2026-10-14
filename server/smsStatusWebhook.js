import { createSmsDeliveryReconciler } from "./smsDeliveryAttempts.js";

export const createSmsStatusWebhookHandler = ({
  queryDocs,
  getDoc,
  requireFirestore,
  COLLECTIONS,
  setDoc,
  nowIso,
  validateSignature,
  normalizeStatus,
  getCallbackUrl,
  getAuthToken,
}) => {
  const reconcile = createSmsDeliveryReconciler({ COLLECTIONS, getDoc, setDoc, requireFirestore, nowIso });
  return async (req, res) => {
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

      // The configured origin/path is authoritative, and Twilio signs the exact
      // query string (including correlation). Never use a caller-supplied host.
      const url = new URL(callbackUrl);
      const ids = url.searchParams.getAll("attempt");
      const tokens = url.searchParams.getAll("correlation");
      let attempt;
      let callbackToken;
      if (ids.length || tokens.length) {
        if (ids.length !== 1 || tokens.length !== 1 || !/^[A-Za-z0-9_-]{1,200}$/.test(ids[0]) || !/^[a-f0-9]{64}$/.test(tokens[0])) {
          return res.json({ success: true, ignored: true });
        }
        attempt = await getDoc(COLLECTIONS?.smsDeliveryAttempts || "smsDeliveryAttempts", ids[0]);
        callbackToken = tokens[0];
      } else {
        const matches = await queryDocs(COLLECTIONS?.smsDeliveryAttempts || "smsDeliveryAttempts",
          [{ field: "providerMessageId", value: providerMessageId }], { limit: 2 });
        if (matches.length !== 1) return res.json({ success: true, ignored: true });
        [attempt] = matches;
      }
      if (!attempt) return res.json({ success: true, ignored: true });
      const incomingStatus = normalizeStatus(req.body?.MessageStatus || req.body?.SmsStatus);
      if (!["accepted", "sent", "delivered", "undelivered", "failed"].includes(incomingStatus)) return res.json({ success: true, ignored: true });
      const result = await reconcile({
        attemptId: ids[0] || attempt.id || attempt.attemptId, callbackToken,
        requireProviderMessageId: callbackToken === undefined,
        callbackPhone: String(req.body?.To || "").trim(),
        callbackAccount: String(req.body?.AccountSid || "").trim(),
        update: {
          providerMessageId, status: incomingStatus, outcome: "confirmed",
          ...(req.body?.ErrorCode ? { failureCode: String(req.body.ErrorCode).slice(0, 80) } : {}),
        },
      });
      return res.json({ success: true, ...(result.ignored ? { ignored: true } : { updated: result.updated }) });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        errorMessage: "Could not process the SMS status callback.",
      });
    }
  };
};
