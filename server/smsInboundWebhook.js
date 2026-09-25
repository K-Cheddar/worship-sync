import crypto from "node:crypto";
import { normalizeUsPhoneNumber, smsConsentIdForChurchPhone } from "./smsConsent.js";

export const TWILIO_INBOUND_PATH = "/api/webhooks/twilio/sms-inbound";

export const resolveTwilioInboundCallbackUrl = ({ env = process.env } = {}) => {
  const configured = String(env.TWILIO_INBOUND_CALLBACK_URL || "").trim();
  if (configured) return configured;
  if (env.NODE_ENV === "production") {
    const error = new Error("TWILIO_INBOUND_CALLBACK_URL must be set in production.");
    error.statusCode = 503;
    throw error;
  }
  const baseUrl = String(env.AUTH_APP_BASE_URL || "https://www.worshipsync.net").replace(/\/$/, "");
  return `${baseUrl}${TWILIO_INBOUND_PATH}`;
};

export const normalizeTwilioSmsKeyword = (body = "") => {
  const keyword = String(body).trim().toUpperCase().split(/\s+/)[0] || "";
  if (["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"].includes(keyword)) return "STOP";
  if (["START", "UNSTOP"].includes(keyword)) return "START";
  if (["HELP", "INFO"].includes(keyword)) return "HELP";
  return "OTHER";
};

const asTwiml = (res) => {
  res.type("text/xml");
  return res.status(200).send("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response/>");
};

/**
 * Signed Twilio inbound command handler. It never sends an SMS reply: all
 * scheduling and volunteer messages remain manual-send only. Sender-number
 * mapping must resolve to exactly one church before a consent record is read
 * or changed.
 */
export const createSmsInboundWebhookHandler = ({
  COLLECTIONS,
  getDoc,
  hashValue = (value) => crypto.createHash("sha256").update(String(value)).digest("hex"),
  nowIso,
  queryDocs,
  requireFirestore,
  setDoc,
  validateSignature,
  getAuthToken,
  getCallbackUrl,
}) => async (req, res) => {
  try {
    const valid = validateSignature({
      authToken: getAuthToken(),
      signature: String(req.headers?.["x-twilio-signature"] || "").trim(),
      url: getCallbackUrl(req),
      params: req.body || {},
    });
    if (!valid) return res.status(403).type("text/plain").send("Invalid webhook signature.");

    const to = normalizeUsPhoneNumber(req.body?.To);
    const from = normalizeUsPhoneNumber(req.body?.From);
    const messageSid = String(req.body?.MessageSid || req.body?.SmsSid || "").trim();
    if (!to || !from || !messageSid) return res.status(400).type("text/plain").send("Invalid inbound message.");
    const matches = await queryDocs(
      COLLECTIONS.churchMessagingConfigs,
      [{ field: "senderPhoneNumber", value: to }],
      { limit: 2 },
    );
    if (matches.length !== 1) return asTwiml(res);

    const config = matches[0];
    const churchId = String(config.id || "").trim();
    if (!churchId || config.churchId !== churchId || normalizeUsPhoneNumber(config.senderPhoneNumber) !== to) return asTwiml(res);
    const commandId = hashValue(`${churchId}|${messageSid}`);
    const consentId = smsConsentIdForChurchPhone(churchId, from);
    if (!consentId) return asTwiml(res);
    const keyword = normalizeTwilioSmsKeyword(req.body?.Body);
    const db = requireFirestore();
    const now = nowIso();

    if (db) {
      await db.runTransaction(async (transaction) => {
        const commandRef = db.collection(COLLECTIONS.smsInboundCommands).doc(commandId);
        const consentRef = db.collection(COLLECTIONS.smsConsents).doc(consentId);
        const [commandSnap, consentSnap] = await Promise.all([
          transaction.get(commandRef), transaction.get(consentRef),
        ]);
        if (commandSnap.exists) return;
        const existing = consentSnap.exists ? consentSnap.data() : null;
        let update = null;
        if (keyword === "STOP") {
          update = {
            consentId, churchId, phoneNumber: from, phoneHash: hashValue(from),
            status: "opted_out", optedOut: true, optedOutAt: now,
            optOutSource: "twilio_inbound", updatedAt: now,
            createdAt: existing?.createdAt || now,
          };
        } else if (
          keyword === "START" && existing?.status === "opted_out" &&
          existing.consentedAt && existing.verifiedAt
        ) {
          update = {
            status: "opted_in", optedOut: false, optedOutAt: null,
            optedInAgainAt: now, optInAgainSource: "twilio_inbound", updatedAt: now,
          };
        }
        if (update) transaction.set(consentRef, update, { merge: true });
        transaction.create(commandRef, {
          commandId, churchId, messageSid,
          fromHash: hashValue(from), toHash: hashValue(to), keyword,
          result: update ? "applied" : "recorded", createdAt: now,
        });
      });
    } else {
      const existingCommand = await getDoc(COLLECTIONS.smsInboundCommands, commandId);
      if (!existingCommand) {
        const existing = await getDoc(COLLECTIONS.smsConsents, consentId);
        if (keyword === "STOP") {
          await setDoc(COLLECTIONS.smsConsents, consentId, {
            consentId, churchId, phoneNumber: from, phoneHash: hashValue(from),
            status: "opted_out", optedOut: true, optedOutAt: now,
            optOutSource: "twilio_inbound", updatedAt: now, createdAt: existing?.createdAt || now,
          }, { merge: true });
        } else if (keyword === "START" && existing?.status === "opted_out" && existing.consentedAt && existing.verifiedAt) {
          await setDoc(COLLECTIONS.smsConsents, consentId, {
            status: "opted_in", optedOut: false, optedOutAt: null,
            optedInAgainAt: now, optInAgainSource: "twilio_inbound", updatedAt: now,
          }, { merge: true });
        }
        await setDoc(COLLECTIONS.smsInboundCommands, commandId, {
          commandId, churchId, messageSid,
          fromHash: hashValue(from), toHash: hashValue(to), keyword,
          result: keyword === "STOP" || keyword === "START" ? "applied" : "recorded",
          createdAt: now,
        }, { merge: false });
      }
    }
    return asTwiml(res);
  } catch (error) {
    return res.status(error.statusCode || 500).type("text/plain").send("Could not process inbound message.");
  }
};
