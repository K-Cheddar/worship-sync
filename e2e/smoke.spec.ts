import { test, expect } from "./smokeFixtures";
import { openEditableTeam, checkSchedulingPeriodRoundTrip } from "./smokeNavigation";

const openHome = async (page: import("@playwright/test").Page) => {
  await page.goto("/#/home", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("main")).toBeVisible();
};

const openTeamsAndServices = async (page: import("@playwright/test").Page) => {
  await openHome(page);
  const workspaceLink = page.getByRole("link", {
    name: /^Teams and Services\b/,
  });
  await expect(
    workspaceLink,
    "The saved E2E account must have access to Teams and Services.",
  ).toBeVisible();
  await workspaceLink.click();
  await expect(page).toHaveURL(/#\/teams-and-services(?:\/|$)/);
  await expect(
    page.getByRole("navigation", { name: "Teams and Services sections" }),
  ).toBeVisible();
};

test("core navigation opens the controller and Teams and Services workspace", async ({ page }) => {
  await openHome(page);

  const presentationLink = page.getByRole("link", { name: /^Presentation\b/ });
  await expect(
    presentationLink,
    "The saved E2E account must have access to the Presentation controller.",
  ).toBeVisible();
  await presentationLink.click();
  await expect(page).toHaveURL(/#\/controller(?:\/|$)/);
  await expect(page.locator("#controller-main")).toBeVisible();
  await expect(page.getByRole("link", { name: "Songs", exact: true })).toBeVisible();
  await expect(page.getByTestId("controller-loading-overlay")).toBeHidden();

  await page.goBack();
  await expect(page).toHaveURL(/#\/home$/);
  await openTeamsAndServices(page);
  await expect(
    page.getByRole("heading", { name: "Teams and Services", exact: true }),
  ).toBeVisible();
});

test("Services loads an existing plan and its primary controls", async ({ page }) => {
  await openTeamsAndServices(page);
  const servicesLink = page.getByRole("link", { name: "Services", exact: true });
  await expect(servicesLink).toBeVisible();
  await servicesLink.click();
  await expect(page).toHaveURL(/#\/teams-and-services\/services$/);

  const results = page.getByRole("region", { name: "Service results" });
  await expect(page.getByRole("status", { name: "Loading plans" })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Choose a church time zone" })).toBeHidden();
  await expect(results).toBeVisible();
  await expect(
    results.getByRole("status", { name: "Loading plan status" }),
  ).toBeHidden();

  const existingPlan = results.getByRole("button", { name: /^Open plan for / }).first();
  if (await existingPlan.count() === 0) {
    const emptyState = await results.innerText();
    throw new Error(
      `Services loaded without an openable existing plan. Provision at least one dated service with a saved plan for the E2E account. Current Services state: ${emptyState}`,
    );
  }
  await existingPlan.click();

  await expect(page.getByRole("tablist", { name: "Plan view" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to Plans" })).toBeVisible();
  await expect(page.getByLabel("Service summary")).toBeVisible();
  await expect(page.getByRole("status", { name: "Loading service plan" })).toBeHidden();
});

test("Teams opens an existing team with its positions and member UI", async ({ page }) => {
  await openTeamsAndServices(page);
  const teamsLink = page.getByRole("link", { name: "Teams", exact: true });
  await expect(teamsLink).toBeVisible();
  await teamsLink.click();
  await expect(page).toHaveURL(/#\/teams-and-services\/groups$/);
  await expect(page.getByRole("status", { name: "Loading teams" })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Teams", exact: true })).toBeVisible();

  await openEditableTeam(page);
});

test("Scheduling changes period and returns with schedule content ready", async ({ page }) => {
  await openTeamsAndServices(page);
  const schedulesLink = page.getByRole("link", { name: "Schedules", exact: true });
  await expect(schedulesLink).toBeVisible();
  await schedulesLink.click();
  await expect(page).toHaveURL(/#\/teams-and-services\/schedules$/);
  await expect(page.getByRole("status", { name: "Loading schedules" })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Choose a church time zone" })).toBeHidden();

  await checkSchedulingPeriodRoundTrip(page);
});
