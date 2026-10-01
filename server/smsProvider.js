import twilio from "twilio";
import { isIP } from "node:net";
import { normalizeSmsDeliveryStatus } from "./smsDeliveryAttempts.js";

export const TWILIO_STATUS_CALLBACK_PATH = "/api/webhooks/twilio/sms-status";

/**
 * Production must use one configured public URL for both Twilio sends and
 * signature validation. Local development omits callbacks unless a public
 * tunnel URL is explicitly configured.
 */
const isNonPublicIpv4 = (hostname) => {
  if (isIP(hostname) !== 4) return false;
  const octets = hostname.split(".").map(Number);
  const [first, second] = octets;
  return first === 0 || first === 10 || first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && (second === 0 || second === 168)) ||
    (first === 198 && (second === 18 || second === 19 || second === 51)) ||
    (first === 203 && second === 0) || first >= 224;
};

const isNonPublicIpv6 = (hostname) => {
  const normalized = hostname.toLowerCase();
  if (normalized === "::" || normalized === "::1" ||
      normalized.startsWith("fc") || normalized.startsWith("fd") ||
      normalized.startsWith("fe8") || normalized.startsWith("fe9") ||
      normalized.startsWith("fea") || normalized.startsWith("feb") ||
      normalized.startsWith("ff") || normalized.startsWith("2001:db8:")) return true;
  const mappedIpv4 = normalized.match(/^(?:::ffff:)(\d+\.\d+\.\d+\.\d+)$/);
  return Boolean(mappedIpv4 && isNonPublicIpv4(mappedIpv4[1]));
};

const isPublicTwilioStatusCallbackUrl = (value) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) return false;
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!hostname || !hostname.includes(".")) return false;
  if (isIP(hostname) === 4) return !isNonPublicIpv4(hostname);
  if (isIP(hostname) === 6) return !isNonPublicIpv6(hostname);
  return !/(?:^|\.)(?:localhost|local|internal|test|example|invalid|onion|home\.arpa)$/.test(hostname);
};

export const resolveTwilioStatusCallbackUrl = ({
  env = process.env,
} = {}) => {
  const configured = String(env.TWILIO_STATUS_CALLBACK_URL || "").trim();
  const production = env.NODE_ENV === "production";
  if (configured && isPublicTwilioStatusCallbackUrl(configured)) return configured;
  if (production) {
    const error = new Error(configured
      ? "TWILIO_STATUS_CALLBACK_URL must be a valid public HTTPS URL in production."
      : "TWILIO_STATUS_CALLBACK_URL must be set in production.");
    error.statusCode = 503;
    throw error;
  }
  return undefined;
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
    error.code = "sms_provider_not_configured";
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
