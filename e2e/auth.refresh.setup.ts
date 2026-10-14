import { test } from "./fixtures";
import {
  getE2EAuthConfig,
  performRealPasswordSignIn,
  saveAuthenticatedSession,
  verifyAuthenticatedIdentity,
} from "./auth";

test("explicitly refreshes the saved WorshipSync session once", async ({ page }) => {
  const { baseURL, email } = await getE2EAuthConfig();
  console.info("Explicit authentication refresh requested; making one sign-in attempt.");

  const signIn = await performRealPasswordSignIn(page, baseURL);
  const identity = await verifyAuthenticatedIdentity(
    page,
    signIn.email || email,
    signIn.tenantIdFingerprint,
  );
  await saveAuthenticatedSession(page, baseURL, identity);

  console.info(
    signIn.usedEmailVerification
      ? "Authentication refresh completed using one MailSlurp verification code."
      : "Authentication refresh completed without an email verification challenge.",
  );
  console.info("Authenticated session saved with private file permissions.");
});
