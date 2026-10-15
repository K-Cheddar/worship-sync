import { test, expect } from "./smokeFixtures";

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

  const firstTeam = page.getByTestId("entity-row").first();
  if (await firstTeam.count() === 0) {
    throw new Error(
      "Teams loaded without an existing team. Provision at least one active team for the E2E account.",
    );
  }
  const teamName = (await firstTeam.innerText()).split("\n")[0]?.trim();
  if (!teamName) throw new Error("The first Teams row did not expose a team name.");

  const editTeam = page.getByRole("button", { name: `Edit ${teamName}`, exact: true });
  if (await editTeam.count() === 0) {
    throw new Error(
      `The saved E2E account can view ${teamName} but cannot open its team details. Grant edit access to one active team; smoke tests do not skip permission-gated coverage.`,
    );
  }
  await editTeam.click();

  await expect(page.getByRole("heading", { name: "Edit team", exact: true })).toBeVisible();
  await expect(page.getByText("Members", { exact: true })).toBeVisible();
  await expect(page.getByText("Positions", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit positions", exact: true })).toBeVisible();
});

test("Scheduling changes period and returns with schedule content ready", async ({ page }) => {
  await openTeamsAndServices(page);
  const schedulesLink = page.getByRole("link", { name: "Schedules", exact: true });
  await expect(schedulesLink).toBeVisible();
  await schedulesLink.click();
  await expect(page).toHaveURL(/#\/teams-and-services\/schedules$/);
  await expect(page.getByRole("status", { name: "Loading schedules" })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Choose a church time zone" })).toBeHidden();

  const range = page.locator('[aria-live="polite"]').filter({ hasText: /\d{4}/ }).first();
  await expect(range).toBeVisible();
  const initialRange = (await range.innerText()).trim();
  if (!initialRange) throw new Error("Schedule did not render its selected date range.");

  const scheduleControls = page.getByRole("group", { name: "Team schedule controls" });
  await expect(
    scheduleControls,
    "Scheduling requires an active team with a service occurrence and positions in the selected period.",
  ).toBeVisible();
  await expect(page.getByText(/Loading this schedule.s assignments/)).toBeHidden();
  await expect(page.getByRole("group", { name: "Schedule layout" })).toBeVisible();

  await page.getByRole("button", { name: "Next period" }).click();
  await expect.poll(async () => (await range.innerText()).trim()).not.toBe(initialRange);
  await expect(scheduleControls).toBeVisible();
  await expect(page.getByText(/Loading this schedule.s assignments/)).toBeHidden();

  await page.getByRole("button", { name: "Previous period" }).click();
  await expect.poll(async () => (await range.innerText()).trim()).toBe(initialRange);
  await expect(scheduleControls).toBeVisible();
  await expect(page.getByText(/Loading this schedule.s assignments/)).toBeHidden();
});
