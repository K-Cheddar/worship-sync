/**
 * Public support contact helpers. Keep validation and email body building here so
 * authService stays a thin rate-limit + sendEmail wrapper.
 */

export const SUPPORT_INBOX_DEFAULT = "support@worshipsync.net";
export const SUPPORT_NAME_MAX = 100;
export const SUPPORT_CHURCH_MAX = 120;
export const SUPPORT_MESSAGE_MIN = 10;
export const SUPPORT_MESSAGE_MAX = 5000;

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** Silent bot trap: any filled honeypot field means "succeed" without mailing. */
export const isSupportHoneypotFilled = (body = {}) => {
  const traps = [body.company, body.website, body.url];
  return traps.some((value) => String(value || "").trim().length > 0);
};

/**
 * @returns {{
 *   ok: true,
 *   name: string,
 *   email: string,
 *   churchName: string,
 *   message: string,
 * } | {
 *   ok: false,
 *   errorMessage: string,
 * }}
 */
export const parseSupportContactBody = (body = {}, normalizeEmail) => {
  const name = String(body.name || "").trim();
  const email = normalizeEmail(String(body.email || ""));
  const churchName = String(body.churchName || "").trim();
  const message = String(body.message || "").trim();

  if (!name) {
    return { ok: false, errorMessage: "Enter your name." };
  }
  if (name.length > SUPPORT_NAME_MAX) {
    return {
      ok: false,
      errorMessage: `Keep your name under ${SUPPORT_NAME_MAX} characters.`,
    };
  }
  if (!email || !email.includes("@") || email.length > 320) {
    return { ok: false, errorMessage: "Enter a valid email address." };
  }
  if (churchName.length > SUPPORT_CHURCH_MAX) {
    return {
      ok: false,
      errorMessage: `Keep the church name under ${SUPPORT_CHURCH_MAX} characters.`,
    };
  }
  if (message.length < SUPPORT_MESSAGE_MIN) {
    return {
      ok: false,
      errorMessage: `Add a short description (at least ${SUPPORT_MESSAGE_MIN} characters).`,
    };
  }
  if (message.length > SUPPORT_MESSAGE_MAX) {
    return {
      ok: false,
      errorMessage: `Keep your message under ${SUPPORT_MESSAGE_MAX} characters.`,
    };
  }

  return { ok: true, name, email, churchName, message };
};

export const buildSupportContactEmail = ({
  name,
  email,
  churchName,
  message,
}) => {
  const churchLine = churchName || "(not provided)";
  const subjectName = name.length > 40 ? `${name.slice(0, 40)}…` : name;
  const subject = `WorshipSync support: ${subjectName}`;

  const textBody = [
    "New WorshipSync support request",
    "",
    `Name: ${name}`,
    `Reply-to: ${email}`,
    `Church: ${churchLine}`,
    "",
    "Message:",
    message,
  ].join("\n");

  const htmlBody = [
    "<p><strong>New WorshipSync support request</strong></p>",
    `<p><strong>Name:</strong> ${escapeHtml(name)}<br/>`,
    `<strong>Reply-to:</strong> ${escapeHtml(email)}<br/>`,
    `<strong>Church:</strong> ${escapeHtml(churchLine)}</p>`,
    `<p><strong>Message:</strong></p>`,
    `<p>${escapeHtml(message).replace(/\n/g, "<br/>")}</p>`,
  ].join("");

  return { subject, textBody, htmlBody };
};

export const resolveSupportInboxEmail = (
  envValue = process.env.SUPPORT_INBOX_EMAIL,
) => {
  const trimmed = String(envValue || "")
    .trim()
    .toLowerCase();
  if (trimmed && trimmed.includes("@")) {
    return trimmed;
  }
  return SUPPORT_INBOX_DEFAULT;
};
