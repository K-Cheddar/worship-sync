import { test, expect } from "./smokeFixtures";
import {
  beginSmokeTemplateNavigation,
  homeNavigationDiagnostics,
  openEditableTeam,
  openHome,
  teamsAndServicesHomeLink,
  type E2EAuthFlags,
} from "./smokeNavigation";
import { E2E_CHURCH_ID } from "./testChurch";
import { requirePresentationControllerHomeLink } from "./controllerTestData";
import { waitForControllerStartup } from "./controllerRuntime";
import {
  findSeededSmokeTemplate,
  requireSmokePrerequisite,
  smokePrerequisiteFailure,
} from "./smokePrerequisites";

type SmokeWorkspaceRequirement =
  | "teams-access"
  | "team-edit"
  | "global-teams-edit"
  | "services-access";

const openTeamsAndServices = async (
  page: import("@playwright/test").Page,
  requirement: SmokeWorkspaceRequirement = "teams-access",
) => {
  const auth = await openHome(page);
  const missingAccess = smokePrerequisiteFailure({ kind: requirement, auth });
  if (missingAccess) {
    throw new Error(await homeNavigationDiagnostics(page, auth, missingAccess));
  }
  const workspaceLink = teamsAndServicesHomeLink(page);
  if (auth.bootstrapStatus === 200 && auth.authenticated && (auth.canViewTeams || auth.canViewServices)) {
    try {
      await expect(workspaceLink).toBeVisible({ timeout: 15_000 });
    } catch {
      // Keep the failure classification below, with the loaded auth flags and
      // current Home snapshot, rather than treating a late render as denial.
    }
  }
  if ((await workspaceLink.count()) !== 1) {
    const reason =
      auth.bootstrapStatus !== 200 || auth.authenticated !== true
        ? "The saved session is not authenticated in the Home application; Teams navigation cannot be evaluated."
        : auth.sessionKind !== "human" || auth.churchId !== E2E_CHURCH_ID
          ? `The E2E account must be a human session for church ${E2E_CHURCH_ID}; the Home link may be absent because this is the wrong identity.`
          : !auth.canViewTeams && !auth.canViewServices
            ? "The Home link is correctly hidden: the account has neither Teams access nor Services: View/Edit. Grant the permission required by the intended smoke workflow through WorshipSync's existing account permissions interface."
            : "The authenticated permission response allows Teams or Services, but Home did not render its Teams and Services route link after loading. This indicates an application loading or homepage navigation regression.";
    throw new Error(await homeNavigationDiagnostics(page, auth, reason));
  }
  await expect(workspaceLink).toBeVisible();
  await workspaceLink.click();
  await expect(page).toHaveURL(/#\/teams-and-services(?:\/|$)/);
  await expect(
    page.getByRole("navigation", { name: "Teams and Services sections" }),
  ).toBeVisible();
  return auth;
};

const requireWorkspaceLink = async (
  page: import("@playwright/test").Page,
  label: string,
  auth: E2EAuthFlags,
  requirement: SmokeWorkspaceRequirement,
) => {
  const link = page.getByRole("link", { name: label, exact: true });
  try {
    await expect(link).toBeVisible({ timeout: 5_000 });
  } catch {
    const missingAccess = smokePrerequisiteFailure({ kind: requirement, auth });
    const reason = missingAccess ??
      `The saved account's effective ${requirement} permission is present, but the ${label} navigation link did not render. This indicates a Teams and Services navigation regression.`;
    throw new Error(await homeNavigationDiagnostics(page, auth, reason));
  }
  return link;
};

test("core navigation opens the controller and Teams and Services workspace", async ({ page }, testInfo) => {
  // Controller startup may use the same bounded 90-second readiness window as
  // the dedicated controller suite. The test also verifies replication and
  // outline readiness before it treats the navigation as usable.
  testInfo.setTimeout(180_000);
  const auth = await openHome(page);
  const presentationLink = await requirePresentationControllerHomeLink(page, auth);
  await presentationLink.click();
  await expect(page).toHaveURL(/#\/controller(?:\/|$)/);
  await waitForControllerStartup(page);
  await expect(page.locator("#controller-main")).toBeVisible();
  await expect(page.getByRole("link", { name: "Songs", exact: true })).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/#\/home$/);
  await openTeamsAndServices(page, "teams-access");
  await expect(
    page.getByRole("heading", { name: "Teams and Services", exact: true }),
  ).toBeVisible();
});

test("Services loads an existing plan and its primary controls", async ({ page }) => {
  const auth = await openTeamsAndServices(page, "services-access");
  const servicesLink = await requireWorkspaceLink(page, "Services", auth, "services-access");
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
  const planCount = await existingPlan.count();
  if (planCount === 0) {
    const emptyState = await results.innerText();
    requireSmokePrerequisite({ kind: "seeded-service-plan", count: planCount, currentState: emptyState });
  }
  await existingPlan.click();

  await expect(page.getByRole("tablist", { name: "Plan view" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to Plans" })).toBeVisible();
  await expect(page.getByLabel("Service summary")).toBeVisible();
  await expect(page.getByRole("status", { name: "Loading service plan" })).toBeHidden();
});

test("Teams opens an existing team with its positions and member UI", async ({ page }) => {
  const auth = await openTeamsAndServices(page, "team-edit");
  const teamsLink = await requireWorkspaceLink(page, "Teams", auth, "team-edit");
  await teamsLink.click();
  await expect(page).toHaveURL(/#\/teams-and-services\/groups$/);
  await expect(page.getByRole("status", { name: "Loading teams" })).toBeHidden();
  await expect(page.getByTestId("teams-create-panel-list").getByRole("heading", { name: "Teams", exact: true })).toBeVisible();

  await openEditableTeam(page);
});

test("Members opens an active member's details without saving changes", async ({ page }) => {
  const auth = await openTeamsAndServices(page, "global-teams-edit");
  const membersLink = await requireWorkspaceLink(page, "Members", auth, "global-teams-edit");
  await membersLink.click();
  await expect(page).toHaveURL(/#\/teams-and-services\/members$/);

  // The workspace shows its loading shell until roster data is ready; the
  // Members heading belongs to the loaded manager, not the section nav.
  const membersHeading = page.getByRole("heading", { name: /^Members\s*\(/ });
  await expect(membersHeading).toBeVisible();
  const memberCount = (await membersHeading.innerText()).match(/\((\d+)\)/);
  if (!memberCount) throw new Error("The loaded Members list did not expose its record count.");
  if (Number(memberCount[1]) === 0) {
    requireSmokePrerequisite({ kind: "active-member", count: Number(memberCount[1]) });
  }

  const activeMemberAction = page.getByRole("button", { name: /^Edit .+/ }).first();
  if (await activeMemberAction.count() === 0) {
    throw new Error(
      "The saved E2E account must have permission to open active member details in the configured demo church.",
    );
  }

  const memberName = (await activeMemberAction.getAttribute("aria-label"))?.replace(/^Edit\s+/, "");
  if (!memberName) throw new Error("The active member row did not expose its accessible name.");
  await activeMemberAction.click();

  try {
    await expect(page.getByRole("heading", { name: "Edit member", exact: true })).toBeVisible({ timeout: 5_000 });
  } catch {
    const scopedEditorVisible = await page.getByRole("heading", { name: memberName, exact: true }).isVisible().catch(() => false);
    throw new Error(await homeNavigationDiagnostics(
      page,
      auth,
      scopedEditorVisible
        ? "Global Teams: Edit is present, but opening a member rendered the scoped team-profile editor instead of the full member editor. This indicates an application permission-normalization or editor-selection regression."
        : "Global Teams: Edit is present, but opening a member did not render the full member editor.",
    ));
  }
  const firstName = page.getByRole("textbox", { name: "First name", exact: true });
  const lastName = page.getByRole("textbox", { name: "Last name", exact: true });
  await expect(firstName).toBeVisible();
  await expect(lastName).toBeVisible();
  await expect.poll(async () => `${await firstName.inputValue()} ${await lastName.inputValue()}`.trim()).toBe(memberName);
});

test("Equipment loads microphones and IEMs and returns to microphones", async ({ page }) => {
  const auth = await openTeamsAndServices(page, "services-access");
  const equipmentLink = await requireWorkspaceLink(page, "Equipment", auth, "services-access");

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
  const auth = await openTeamsAndServices(page, "services-access");
  const templatesLink = await requireWorkspaceLink(page, "Templates", auth, "services-access");
  const { templateResponse: templateLoad, navigation } = beginSmokeTemplateNavigation(
    page,
    () => templatesLink.click(),
  );
  await navigation;
  await expect(page).toHaveURL(/#\/teams-and-services\/templates$/);
  const templateResponse = await templateLoad;
  expect(templateResponse.ok(), "Templates request should succeed before checking its list state.").toBeTruthy();
  const templatePayload = await templateResponse.json() as {
    success?: boolean;
    templates?: unknown;
  };
  expect(templatePayload.success, "Templates response should report a successful load.").toBe(true);
  await expect(page.getByText("Could not load templates", { exact: true })).toBeHidden();

  const seededTemplate = findSeededSmokeTemplate(templatePayload.templates);
  requireSmokePrerequisite({ kind: "seeded-template", templates: templatePayload.templates });
  if (!seededTemplate) throw new Error("Seeded template prerequisite check returned an inconsistent result.");
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
