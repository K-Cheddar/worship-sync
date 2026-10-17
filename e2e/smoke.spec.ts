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

test("Members opens an active member's details without saving changes", async ({ page }) => {
  await openTeamsAndServices(page);
  const membersLink = page.getByRole("link", { name: "Members", exact: true });
  await expect(
    membersLink,
    "The saved E2E account must have access to Teams and Services → Members.",
  ).toBeVisible();
  await membersLink.click();
  await expect(page).toHaveURL(/#\/teams-and-services\/members$/);

  // The workspace shows its loading shell until roster data is ready; the
  // Members heading belongs to the loaded manager, not the section nav.
  const membersHeading = page.getByRole("heading", { name: /^Members\s*\(/ });
  await expect(membersHeading).toBeVisible();
  const memberCount = (await membersHeading.innerText()).match(/\((\d+)\)/);
  if (!memberCount) throw new Error("The loaded Members list did not expose its record count.");
  if (Number(memberCount[1]) === 0) {
    throw new Error("The configured disposable test tenant must contain at least one active member for the details smoke test.");
  }

  const activeMemberAction = page.getByRole("button", { name: /^Edit .+/ }).first();
  if (await activeMemberAction.count() === 0) {
    throw new Error(
      "The saved E2E account must have permission to open active member details in the configured disposable test tenant.",
    );
  }

  const memberName = (await activeMemberAction.getAttribute("aria-label"))?.replace(/^Edit\s+/, "");
  if (!memberName) throw new Error("The active member row did not expose its accessible name.");
  await activeMemberAction.click();

  await expect(page.getByRole("heading", { name: "Edit member", exact: true })).toBeVisible();
  const firstName = page.getByRole("textbox", { name: "First name", exact: true });
  const lastName = page.getByRole("textbox", { name: "Last name", exact: true });
  await expect(firstName).toBeVisible();
  await expect(lastName).toBeVisible();
  await expect.poll(async () => `${await firstName.inputValue()} ${await lastName.inputValue()}`.trim()).toBe(memberName);
});

test("Equipment loads microphones and IEMs and returns to microphones", async ({ page }) => {
  await openTeamsAndServices(page);
  const equipmentLink = page.getByRole("link", { name: "Equipment", exact: true });
  await expect(
    equipmentLink,
    "The saved E2E account must have access to Services → Equipment.",
  ).toBeVisible();

  const microphoneLoad = page.waitForResponse((response) =>
    response.request().method() === "GET" && new URL(response.url()).pathname.endsWith("/service-plan-microphones"),
  );
  const iemLoad = page.waitForResponse((response) =>
    response.request().method() === "GET" && new URL(response.url()).pathname.endsWith("/service-equipment"),
  );
  await equipmentLink.click();
  await expect(page).toHaveURL(/#\/teams-and-services\/microphones$/);

  const [microphoneResponse, iemResponse] = await Promise.all([microphoneLoad, iemLoad]);
  for (const [label, response] of [["Microphones", microphoneResponse], ["IEMs", iemResponse]] as const) {
    expect(response.ok(), `${label} request should succeed, not display an empty state after an API error.`).toBeTruthy();
    const payload = await response.json() as { success?: boolean };
    expect(payload.success, `${label} response should report a successful load.`).toBe(true);
  }

  const categories = page.getByRole("tablist", { name: "Equipment categories" });
  const microphonesTab = categories.getByRole("tab", { name: "Microphones", exact: true });
  const iemsTab = categories.getByRole("tab", { name: "In-Ear Monitors (IEMs)", exact: true });
  const microphonePanel = page.getByRole("tabpanel", { name: "Microphones" });
  const iemPanel = page.getByRole("tabpanel", { name: "In-Ear Monitors (IEMs)" });

  await expect(microphonesTab).toHaveAttribute("data-state", "active");
  await expect(microphonePanel.getByText("No microphones yet", { exact: true }).or(
    microphonePanel.locator("div[aria-label]"),
  ).first()).toBeVisible();
  await expect(microphonePanel.getByRole("status")).toHaveCount(0);
  const microphoneRowsBefore = await microphonePanel.locator("div[aria-label]").count();

  await iemsTab.click();
  await expect(iemsTab).toHaveAttribute("data-state", "active");
  await expect(iemPanel.getByRole("status", { name: "Loading IEMs" })).toBeHidden();
  await expect(iemPanel.getByRole("alert")).toHaveCount(0);
  await expect(iemPanel.getByText("No IEMs yet", { exact: true }).or(
    iemPanel.locator("div[aria-label]"),
  ).first()).toBeVisible();

  await microphonesTab.click();
  await expect(microphonesTab).toHaveAttribute("data-state", "active");
  await expect(microphonePanel.getByText("No microphones yet", { exact: true }).or(
    microphonePanel.locator("div[aria-label]"),
  ).first()).toBeVisible();
  await expect(microphonePanel.locator("div[aria-label]")).toHaveCount(microphoneRowsBefore);
});

test("Service Templates opens and returns to a seeded template", async ({ page }) => {
  const templateLoad = page.waitForResponse((response) =>
    response.request().method() === "GET" && new URL(response.url()).pathname.endsWith("/service-plan-templates"),
  );
  await openTeamsAndServices(page);
  const templatesLink = page.getByRole("link", { name: "Templates", exact: true });
  await expect(
    templatesLink,
    "The saved E2E account must have access to Services → Templates.",
  ).toBeVisible();
  await templatesLink.click();
  await expect(page).toHaveURL(/#\/teams-and-services\/templates$/);
  const templateResponse = await templateLoad;
  expect(templateResponse.ok(), "Templates request should succeed before checking its list state.").toBeTruthy();
  const templatePayload = await templateResponse.json() as {
    success?: boolean;
    templates?: Array<{ name: string; sections: Array<{ name: string; elements: unknown[] }> }>;
  };
  expect(templatePayload.success, "Templates response should report a successful load.").toBe(true);
  await expect(page.getByText("Could not load templates", { exact: true })).toBeHidden();

  const templates = templatePayload.templates || [];
  if (templates.length === 0) {
    const emptyState = await page.locator("main").innerText();
    throw new Error(
      `The configured disposable test tenant must seed at least one service template with section structure for the editor-opening smoke assertion. Current Templates state: ${emptyState}`,
    );
  }
  const seededTemplate = templates.find((template) =>
    template.name.trim() && template.sections.length > 0
      && templates.filter((candidate) => candidate.name === template.name).length === 1,
  );
  if (!seededTemplate) {
    throw new Error("The configured disposable test tenant must seed a uniquely named service template with at least one section.");
  }
  const templateName = seededTemplate.name;
  const templateButton = page.getByRole("button", { name: `Edit ${templateName}`, exact: true }).or(
    page.getByRole("button", { name: `View ${templateName}`, exact: true }),
  );
  await expect(templateButton).toBeVisible();
  const templateRow = page.getByRole("article").filter({ has: templateButton });
  await expect(templateRow).toBeVisible();
  const expectedSections = seededTemplate.sections.length;
  const expectedItems = seededTemplate.sections.reduce((total, section) => total + section.elements.length, 0);

  await templateButton.click();
  await expect(page.getByRole("heading", { name: templateName, exact: true })).toBeVisible();
  await expect(page.getByText(new RegExp(`${expectedSections} sections? · ${expectedItems} items?$`))).toBeVisible();
  for (const section of seededTemplate.sections) {
    if (section.name.trim()) await expect(page.getByText(section.name, { exact: true })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "Back to Templates", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Back to Templates", exact: true }).click();
  await expect(templateButton).toBeVisible();
});
