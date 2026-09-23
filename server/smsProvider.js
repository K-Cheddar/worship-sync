import twilio from "twilio";
import { normalizeSmsDeliveryStatus } from "./smsDeliveryAttempts.js";

const TWILIO_STATUS_MAP = new Map([
  ["queued", "accepted"],
  ["accepted", "accepted"],
  ["sending", "accepted"],
  ["sent", "sent"],
  ["delivered", "delivered"],
  ["undelivered", "undelivered"],
  ["failed", "failed"],
  ["canceled", "failed"],
]);

export const normalizeTwilioStatus = (value) =>
  TWILIO_STATUS_MAP.get(String(value || "").trim().toLowerCase()) || "accepted";

export const validateTwilioWebhookSignature = ({
  authToken,
  signature,
  url,
  params,
}) =>
  Boolean(
    authToken &&
      signature &&
      url &&
      twilio.validateRequest(authToken, signature, url, params || {}),
  );

export const createTwilioSmsProvider = ({
  accountSid,
  authToken,
  messagingServiceId,
  senderPhoneNumber,
  clientFactory = twilio,
} = {}) => {
  const normalizedAccountSid = String(accountSid || "").trim();
  const normalizedAuthToken = String(authToken || "").trim();
  const normalizedMessagingServiceId = String(messagingServiceId || "").trim();
  const normalizedSenderPhoneNumber = String(senderPhoneNumber || "").trim();
  if (
    !normalizedAccountSid ||
    !normalizedAuthToken ||
    (!normalizedMessagingServiceId && !normalizedSenderPhoneNumber)
  ) {
    const error = new Error("SMS messaging is not configured on this server.");
    error.statusCode = 503;
    throw error;
  }

  const client = clientFactory(normalizedAccountSid, normalizedAuthToken);
  return {
    provider: "twilio",
    async sendMessage({ to, body, statusCallbackUrl } = {}) {
      const message = await client.messages.create({
        to,
        body,
        ...(statusCallbackUrl ? { statusCallback: statusCallbackUrl } : {}),
        ...(normalizedMessagingServiceId
          ? { messagingServiceSid: normalizedMessagingServiceId }
          : { from: normalizedSenderPhoneNumber }),
      });
      if (!message?.sid) {
        throw new Error("The SMS provider did not return a message ID.");
      }
      return {
        providerMessageId: String(message.sid),
        status: normalizeSmsDeliveryStatus(normalizeTwilioStatus(message.status)),
      };
    },
  };
};

export const createSmsProviderForConfig = ({ config, env = process.env } = {}) =>
  createTwilioSmsProvider({
    accountSid: config?.providerAccountId || env.TWILIO_ACCOUNT_SID,
    authToken: env.TWILIO_AUTH_TOKEN,
    messagingServiceId:
      config?.messagingServiceId || env.TWILIO_MESSAGING_SERVICE_SID,
    senderPhoneNumber:
      config?.senderPhoneNumber ||
      env.TWILIO_SMS_FROM_NUMBER ||
      env.TWILIO_FROM_NUMBER ||
      env.TWILIO_PHONE_NUMBER,
  });

export const createFakeSmsProvider = ({
  response = { providerMessageId: "fake_sms_message", status: "accepted" },
  sendMessage,
} = {}) => {
  const calls = [];
  return {
    provider: "fake",
    calls,
    async sendMessage(input) {
      calls.push(input);
      if (sendMessage) return sendMessage(input);
      return { ...response };
    },
  };
};

let smsProviderForServerTests = null;

export const setSmsProviderForServerTests = (provider) => {
  smsProviderForServerTests = provider || null;
};

export const getSmsProviderForConfig = (options) =>
  smsProviderForServerTests || createSmsProviderForConfig(options);

