import twilio from "twilio";
import { normalizeSmsDeliveryStatus } from "./smsDeliveryAttempts.js";

export const TWILIO_STATUS_CALLBACK_PATH = "/api/webhooks/twilio/sms-status";

/**
 * Production must use one configured public URL for both Twilio sends and
 * signature validation. The app base is also used in development/test so the
 * send path and webhook path cannot silently derive different URLs behind a
 * proxy.
 */
export const resolveTwilioStatusCallbackUrl = ({
  env = process.env,
} = {}) => {
  const configured = String(env.TWILIO_STATUS_CALLBACK_URL || "").trim();
  if (configured) return configured;
  if (env.NODE_ENV === "production") {
    const error = new Error(
      "TWILIO_STATUS_CALLBACK_URL must be set in production.",
    );
    error.statusCode = 503;
    throw error;
  }
  const baseUrl = String(
    env.AUTH_APP_BASE_URL || "https://www.worshipsync.net",
  ).replace(/\/$/, "");
  return `${baseUrl}${TWILIO_STATUS_CALLBACK_PATH}`;
};

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
  parentAccountSid,
  authToken,
  messagingServiceId,
  senderPhoneNumber,
  clientFactory = twilio,
} = {}) => {
  const normalizedAccountSid = String(accountSid || "").trim();
  const normalizedParentAccountSid = String(
    parentAccountSid || accountSid || "",
  ).trim();
  const normalizedAuthToken = String(authToken || "").trim();
  const normalizedMessagingServiceId = String(messagingServiceId || "").trim();
  const normalizedSenderPhoneNumber = String(senderPhoneNumber || "").trim();
  if (
    !normalizedAccountSid ||
    !normalizedParentAccountSid ||
    !normalizedAuthToken ||
    (!normalizedMessagingServiceId && !normalizedSenderPhoneNumber)
  ) {
    const error = new Error("SMS messaging is not configured on this server.");
    error.statusCode = 503;
    throw error;
  }

  // Twilio's SDK accepts parent SID + parent token plus the target subaccount
  // SID as `{ accountSid }`. This keeps subaccount targeting at the provider
  // boundary; church/domain code never needs to know credential mechanics.
  const client = clientFactory(
    normalizedParentAccountSid,
    normalizedAuthToken,
    normalizedAccountSid !== normalizedParentAccountSid
      ? { accountSid: normalizedAccountSid }
      : undefined,
  );
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

export const resolveTwilioAccountConfiguration = ({
  config,
  env = process.env,
} = {}) => ({
  parentAccountSid: String(env.TWILIO_ACCOUNT_SID || "").trim(),
  targetAccountSid: String(
    config?.twilioAccountSid ||
      config?.providerAccountId ||
      env.TWILIO_ACCOUNT_SID ||
      "",
  ).trim(),
});

export const createSmsProviderForConfig = ({ config, env = process.env } = {}) => {
  const credentials = resolveTwilioAccountConfiguration({ config, env });
  return createTwilioSmsProvider({
    accountSid: credentials.targetAccountSid,
    parentAccountSid: credentials.parentAccountSid,
    authToken: env.TWILIO_AUTH_TOKEN,
    messagingServiceId:
      config?.messagingServiceId || env.TWILIO_MESSAGING_SERVICE_SID,
    senderPhoneNumber:
      config?.senderPhoneNumber ||
      env.TWILIO_SMS_FROM_NUMBER ||
      env.TWILIO_FROM_NUMBER ||
      env.TWILIO_PHONE_NUMBER,
  });
};

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
