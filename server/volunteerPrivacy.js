export const redactVolunteerSecrets = (value) => {
  const seen = new WeakSet();
  const redact = (item) => {
    if (typeof item === "string") return item
      .replace(/(?:vs_|v_)[A-Za-z0-9_-]{32}/g, "[personal-access-redacted]")
      .replace(/v[12]\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+/g, "[personal-access-redacted]");
    if (item && typeof item === "object") {
      if (seen.has(item)) return "[circular]";
      seen.add(item);
      if (Array.isArray(item)) return item.map(redact);
      return Object.fromEntries(Object.entries(item).map(([key, nested]) => [key, /credentialEnvelope|personalTokenEnvelope/i.test(key) ? "[personal-access-redacted]" : redact(nested)]));
    }
    return item;
  };
  return redact(value);
};

export const filterVolunteerTelemetry = (event) => {
  if (/\/api\/volunteer(?:\/|$)|\/personal-access(?:\/|$)/.test(String(event?.request?.url || ""))) return null;
  return redactVolunteerSecrets(event);
};
