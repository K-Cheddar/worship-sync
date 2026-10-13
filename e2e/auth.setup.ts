import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { expect, test } from "./fixtures";

const authFile = resolve("playwright/.auth/worshipsync-user.json");

const requiredEnv = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for real WorshipSync sign-in.`);
  }
  return value;
};

const fetchFreshSignInCode = async (since: string) => {
  const inboxId = requiredEnv("MAILSLURP_INBOX_ID");
  const apiKey = requiredEnv("MAILSLURP_API_KEY");
  const expectedEmail = requiredEnv("E2E_TEST_EMAIL").toLowerCase();
  const url = new URL("https://api.mailslurp.com/waitForLatestEmail");
  url.searchParams.set("inboxId", inboxId);
  url.searchParams.set("since", since);
  url.searchParams.set("sort", "ASC");
  url.searchParams.set("timeout", "90000");

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "x-api-key": apiKey },
      signal: AbortSignal.timeout(95_000),
    });
  } catch {
    throw new Error(
      "MailSlurp could not be reached while waiting for the new sign-in email.",
    );
  }
  if (!response.ok) {
    throw new Error(
      `MailSlurp did not return the new sign-in email (HTTP ${response.status}).`,
    );
  }

  const email = (await response.json()) as {
    subject?: string;
    to?: string[];
    body?: string;
  };
  if (email.subject !== "Your WorshipSync sign-in code") {
    throw new Error(
      "MailSlurp returned a new email, but it was not a WorshipSync sign-in code email.",
    );
  }
  if (!email.to?.some((recipient) => recipient.toLowerCase() === expectedEmail)) {
    throw new Error(
      "The new WorshipSync sign-in email was not addressed to E2E_TEST_EMAIL.",
    );
  }

  const body = String(email.body ?? "").replace(/<[^>]*>/g, " ");
  const codeMatches = [
    ...body.matchAll(
      /(?:sign-in code is\s*|[?&]code=|&amp;code=)(\d{6})/gi,
    ),
  ];
  const codes = [...new Set(codeMatches.map((match) => match[1]))];
  if (codes.length !== 1) {
    throw new Error(
      "The new WorshipSync email did not contain one unambiguous six-digit sign-in code.",
    );
  }
  return codes[0];
};

test("signs in through the real password and email verification flow", async ({ page }) => {
  const baseURL = requiredEnv("E2E_BASE_URL");
  const email = requiredEnv("E2E_TEST_EMAIL");
  const password = requiredEnv("E2E_TEST_PASSWORD");
  const loginUrl = new URL(baseURL);
  loginUrl.hash = "/login";

  await page.goto(loginUrl.toString(), { waitUntil: "domcontentloaded" });
  await expect(page.getByLabel("Email")).toBeVisible();
  const signInButton = page.getByRole("button", {
    name: "Sign in",
    exact: true,
  });
  await expect
    .poll(
      async () => {
        if (await signInButton.isEnabled().catch(() => false)) return "online";
        const status = await page
          .getByRole("status")
          .allTextContents()
          .catch(() => []);
        if (status.some((text) => /could not reach the sign-in service/i.test(text))) {
          return "offline";
        }
        return "checking";
      },
      {
        timeout: 30_000,
        message: "WorshipSync authentication service did not become available",
      },
    )
    .not.toBe("checking");

  if (!(await signInButton.isEnabled().catch(() => false))) {
    throw new Error(
      "Authentication infrastructure unavailable: WorshipSync reports that its sign-in service cannot be reached. No credentials were submitted.",
    );
  }

  await page.getByLabel("Email").fill(email);
  await page.getByRole("textbox", { name: "Password:" }).fill(password);

  const emailRequestedSince = new Date().toISOString();
  await signInButton.click();

  const codeHeading = page.getByRole("heading", {
    name: "Check your email",
    exact: true,
  });
  const homeHeading = page.getByRole("heading", {
    name: "Controllers",
    exact: true,
  });
  const authError = page.getByRole("alert").first();
  await expect
    .poll(
      async () => {
        if (await codeHeading.isVisible().catch(() => false)) return "code";
        if (await homeHeading.isVisible().catch(() => false)) return "signed-in";
        if (await authError.isVisible().catch(() => false)) return "error";
        const status = await page
          .getByRole("status")
          .allTextContents()
          .catch(() => []);
        if (status.some((text) => /could not reach the sign-in service/i.test(text))) {
          return "infrastructure";
        }
        return "pending";
      },
      {
        timeout: 60_000,
        message: "WorshipSync did not reach a sign-in result",
      },
    )
    .not.toBe("pending");

  const statusMessages = await page
    .getByRole("status")
    .allTextContents()
    .catch(() => []);
  if (statusMessages.some((text) => /could not reach the sign-in service/i.test(text))) {
    throw new Error(
      "Authentication infrastructure unavailable: WorshipSync reports that its sign-in service cannot be reached.",
    );
  }

  if (await authError.isVisible().catch(() => false)) {
    throw new Error(
      "WorshipSync rejected the configured test account (the visible alert text is omitted from the report).",
    );
  }

  if (await codeHeading.isVisible().catch(() => false)) {
    const code = await fetchFreshSignInCode(emailRequestedSince);
    await page.getByLabel("Digit 1 of 6").fill(code);
    await expect(homeHeading).toBeVisible({ timeout: 45_000 });
    test.info().annotations.push({
      type: "authentication",
      description: "Signed in with a fresh email verification code from MailSlurp.",
    });
  } else {
    test.info().annotations.push({
      type: "authentication",
      description: "The real sign-in flow did not require an email code.",
    });
  }

  await mkdir(dirname(authFile), { recursive: true });
  await page.context().storageState({ path: authFile });
});
