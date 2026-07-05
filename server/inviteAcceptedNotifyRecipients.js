const normalizeEmail = (email = "") => String(email).trim().toLowerCase();

export const selectInviteAcceptedAdminRecipients = (candidates = []) => {
  const recipients = new Set();
  for (const candidate of candidates) {
    if (!candidate?.isActiveAdmin || candidate.isAcceptedUser) {
      continue;
    }
    const email = normalizeEmail(candidate.email);
    if (!email) {
      continue;
    }
    recipients.add(email);
  }
  return Array.from(recipients.values());
};
