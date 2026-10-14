import { test } from "./fixtures";
import {
  getE2EAuthConfig,
  requireReusableSavedSession,
  validateSavedSession,
} from "./auth";

test("requires the saved WorshipSync session to be reusable", async ({ browser }) => {
  const { baseURL, email } = await getE2EAuthConfig();
  const session = await validateSavedSession(browser, baseURL, email);
  requireReusableSavedSession(session);
});
