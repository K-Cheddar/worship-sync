import { test } from "./fixtures";
import {
  forceFreshAuthentication,
  getE2EAuthConfig,
  performRealPasswordSignIn,
  saveAuthenticatedSession,
  validateSavedSession,
  verifyAuthenticatedIdentity,
} from "./auth";

test("reuses a validated session or performs one real sign-in", async ({ browser, page }) => {
  const { baseURL, email } = await getE2EAuthConfig();
  let recoveryReason = "";

  if (forceFreshAuthentication) {
    console.info("Fresh authentication requested; signing in through WorshipSync.");
  } else {
    const session = await validateSavedSession(browser, baseURL, email);
    if (session.status === "valid") {
      console.info("Reusing existing authenticated WorshipSync session.");
      return;
    }
    if (session.status === "infrastructure-error") {
      throw new Error(session.reason);
    }
    recoveryReason = session.reason;
    console.info("Saved session missing or invalid; authenticating again.");
  }

  try {
    const signIn = await performRealPasswordSignIn(page, baseURL);
    const identity = await verifyAuthenticatedIdentity(
      page,
      signIn.email,
      signIn.tenantIdFingerprint,
    );
    await saveAuthenticatedSession(page, baseURL, identity);
    console.info(
      signIn.usedEmailVerification
        ? "Fresh sign-in completed with one MailSlurp verification code."
        : "Fresh sign-in completed without an email verification challenge.",
    );
    console.info("Authentication successful; session saved.");
  } catch (error) {
    const recoveryContext = recoveryReason
      ? `Saved session could not be reused (${recoveryReason}). `
      : "";
    const failure = error instanceof Error ? error.message : "Unknown authentication failure.";
    throw new Error(`${recoveryContext}Authentication failed: ${failure}`);
  }
});
