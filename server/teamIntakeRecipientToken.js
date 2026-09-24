import crypto from "node:crypto";

export const TEAM_INTAKE_RECIPIENT_TOKEN_ENV =
  "AUTH_TEAM_INTAKE_RECIPIENT_TOKEN_SECRET";

const TOKEN_DOMAIN = "worshipsync/team-intake-recipient-token/v1";

export const resolveTeamIntakeRecipientTokenSecret = (env = process.env) => {
  const configured = String(env[TEAM_INTAKE_RECIPIENT_TOKEN_ENV] || "").trim();
  if (env.NODE_ENV === "production" && !configured) {
    throw new Error(
      `${TEAM_INTAKE_RECIPIENT_TOKEN_ENV} must be set in production.`,
    );
  }
  if (configured) return configured;

  // Development and tests may reuse the session secret as input, but the
  // domain-separated derivation prevents the two token classes from sharing
  // signing material directly.
  const developmentBase = env.AUTH_SESSION_SECRET || "dev-auth-secret";
  return crypto
    .createHmac("sha256", developmentBase)
    .update(TOKEN_DOMAIN)
    .digest("hex");
};

export const createTeamIntakeRecipientToken = () =>
  `r_${crypto.randomBytes(18).toString("base64url")}`;

export const hashTeamIntakeRecipientToken = (
  token,
  secret = resolveTeamIntakeRecipientTokenSecret(),
) =>
  crypto
    .createHmac("sha256", secret)
    .update(String(token || ""))
    .digest("hex");

const encryptionKeyForSecret = (secret) =>
  crypto
    .createHash("sha256")
    .update(`${TOKEN_DOMAIN}:at-rest:${secret}`)
    .digest();

export const encryptTeamIntakeRecipientToken = (
  token,
  secret = resolveTeamIntakeRecipientTokenSecret(),
) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    encryptionKeyForSecret(secret),
    iv,
  );
  const encrypted = Buffer.concat([
    cipher.update(String(token), "utf8"),
    cipher.final(),
  ]);
  return `v1.${iv.toString("base64url")}.${cipher
    .getAuthTag()
    .toString("base64url")}.${encrypted.toString("base64url")}`;
};

export const decryptTeamIntakeRecipientToken = (
  value,
  secret = resolveTeamIntakeRecipientTokenSecret(),
) => {
  const [version, iv, tag, encrypted] = String(value || "").split(".");
  if (version !== "v1" || !iv || !tag || !encrypted) return null;
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      encryptionKeyForSecret(secret),
      Buffer.from(iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
};

export const looksLikeTeamIntakeRecipientToken = (token) =>
  /^r_[A-Za-z0-9_-]{24}$/.test(String(token || ""));
