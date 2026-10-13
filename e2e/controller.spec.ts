import { test, expect } from "./fixtures";

test("opens a song from the Presentation Controller library", async ({ page }) => {
  await page.goto("/#/home", { waitUntil: "domcontentloaded" });

  await expect(
    page.getByRole("heading", { name: "Controllers", exact: true }),
  ).toBeVisible();

  await page.getByRole("link", { name: /^Presentation\b/ }).click();
  await expect(page).toHaveURL(/#\/controller(?:\/|$)/);
  const startupOverlay = page.getByTestId("controller-loading-overlay");
  await expect(startupOverlay).toBeVisible();
  await expect(startupOverlay).toBeHidden({
    timeout: 90_000,
  });
  await expect(page.locator("#controller-main")).toBeVisible();

  await page.getByRole("link", { name: "Songs", exact: true }).click();
  await expect(page).toHaveURL(/#\/controller\/songs(?:$|[?])/);
  await expect(
    page.getByRole("heading", { name: "Songs", exact: true }),
  ).toBeVisible();

  const songDetailsButton = page
    .getByRole("button", { name: /^View song details for / })
    .first();
  await expect(songDetailsButton).toBeVisible();
  await songDetailsButton.click();

  await expect(
    page.getByRole("heading", { name: /^Song details/ }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "Song resources" })).toBeVisible();
});
