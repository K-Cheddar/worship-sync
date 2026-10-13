import { test } from "./fixtures";
import {
  getE2EAuthConfig,
  performRealPasswordSignIn,
  verifyAuthenticatedIdentity,
} from "./auth";

test("performs fresh real password and email verification sign-in", async ({ page }) => {
  const { baseURL, email } = await getE2EAuthConfig();
  const signIn = await performRealPasswordSignIn(page, baseURL);
  await verifyAuthenticatedIdentity(
    page,
    signIn.email || email,
    signIn.tenantIdFingerprint,
  );

  test.info().annotations.push({
    type: "authentication",
    description: signIn.usedEmailVerification
      ? "Fresh WorshipSync sign-in completed with email verification."
      : "Fresh WorshipSync sign-in completed without an email verification challenge.",
  });
});
