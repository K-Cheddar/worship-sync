/**
 * Strip server-only hash fields from objects returned to browsers.
 * Keeps credential/token preimage handling on the server only.
 */

export const sanitizeWorkstationDeviceForClient = (device) => {
  if (!device || typeof device !== "object") return device;
  const { credentialHash, tokenHash, ...rest } = device;
  return rest;
};

export const sanitizeDisplayDeviceForClient = (device) => {
  if (!device || typeof device !== "object") return device;
  const { credentialHash, tokenHash, ...rest } = device;
  return rest;
};

export const sanitizeInviteForClient = (invite) => {
  if (!invite || typeof invite !== "object") return invite;
  const { tokenHash, ...rest } = invite;
  return rest;
};

/** Pairing responses include a one-time `token`; stored `tokenHash` must not be exposed. */
export const sanitizePairingForClient = (pairing) => {
  if (!pairing || typeof pairing !== "object") return pairing;
  const { tokenHash, ...rest } = pairing;
  return rest;
};
