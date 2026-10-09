export const createSmsConsentCapabilities = () => {
  const challengeBytes = window.crypto.getRandomValues(new Uint8Array(16));
  const tokenBytes = window.crypto.getRandomValues(new Uint8Array(32));
  const challengeId = Array.from(challengeBytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const cancellationToken = window
    .btoa(String.fromCharCode(...tokenBytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return { challengeId, cancellationToken };
};
