import { expect, type Locator, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readDocument, resetLocalOutputs, waitForControllerDatabase } from "./controllerRuntime";
import {
  hasControllerOperatorAccess,
  homeNavigationDiagnostics,
  openHome,
  type E2EAuthFlags,
} from "./smokeNavigation";

// A failed test restarts its worker. A fresh identity prevents that worker
// from reusing a deleted document or adopting an interrupted worker's records.
const runId = randomUUID();
export const TEST_OUTLINE_ID = `e2e-controller-outline-${runId}`;
export const TEST_OUTLINE_NAME = `E2E Presentation Controller [${runId}]`;
const songIds = new Map<string, string>();

export const SONG_A = {
  title: `E2E Presentation Controller Song A - Amber Harbor [${runId}]`,
  sections: [
    "Amber Harbor dawn paints the shoreline\nAmber lanterns mark the way",
    "Amber Harbor carries the chorus\nAmber voices cross the bay",
    "Amber lights return to harbor\nAmber morning starts again",
  ],
} as const;

export const SONG_B = {
  title: `E2E Presentation Controller Song B - Violet Summit [${runId}]`,
  sections: [
    "Violet Summit wakes above the valley\nViolet clouds reveal the trail",
    "Violet Summit answers the morning\nViolet echoes cross the ridge",
  ],
} as const;

const songLyrics = (sections: readonly string[]) =>
  sections
    .map((words, index) => `${index === 1 ? "Chorus" : index === 2 ? "Bridge" : "Verse 1"}\n${words}`)
    .join("\n\n");

export const expectSongSections = async (
  page: Page,
  song: { title: string; sections: readonly string[] },
) => {
  const details = page.getByRole("dialog");
  const sectionRows = details.getByRole("listitem");
  await expect(sectionRows).toHaveCount(song.sections.length);
  const renderedLyrics = await sectionRows.evaluateAll((rows) =>
    rows.flatMap((row) =>
      Array.from(row.querySelectorAll("p")).map((paragraph) =>
        (paragraph as HTMLParagraphElement).innerText
          .normalize("NFC")
          .replace(/\s+/g, " ")
          .trim(),
      ),
    ),
  );
  for (const section of song.sections) {
    const expectedLyrics = section
      .normalize("NFC")
      .replace(/\s+/g, " ")
      .trim();
    expect(renderedLyrics).toContain(expectedLyrics);
  }
};

export const presentationControllerHomeLink = (page: Page) =>
  page.getByRole("link").and(page.locator('main a[href="#/controller"]'));

export const requirePresentationControllerHomeLink = async (
  page: Page,
  auth: E2EAuthFlags,
) => {
  if (!hasControllerOperatorAccess(auth)) {
    throw new Error(
      await homeNavigationDiagnostics(
        page,
        auth,
        "The saved account lacks operator-controller access (Controller access must be View, Music, or Full).",
      ),
    );
  }

  const controllersRegion = page.getByRole("region", {
    name: "Controllers",
    exact: true,
  });
  try {
    await expect(controllersRegion).toBeVisible({ timeout: 15_000 });
    await expect(controllersRegion).not.toHaveAttribute("aria-busy", "true", {
      timeout: 60_000,
    });
  } catch {
    throw new Error(
      await homeNavigationDiagnostics(
        page,
        auth,
        "The account has operator-controller access, but Home did not finish rendering and loading its Controllers section; no controller link was assumed available.",
      ),
    );
  }

  const controllerLink = presentationControllerHomeLink(page);
  if ((await controllerLink.count()) !== 1) {
    throw new Error(
      await homeNavigationDiagnostics(
        page,
        auth,
        "Controller access is present and profile loading completed, but Home has no unique link to #/controller. The Presentation Controller profile may be disabled or missing.",
      ),
    );
  }
  await expect(controllerLink).toBeVisible();
  return controllerLink;
};

export const openPresentationController = async (page: Page) => {
  const started = Date.now();
  const auth = await openHome(page);
  const homeSnapshot = await homeNavigationDiagnostics(
    page,
    auth,
    "Home navigation before opening Presentation Controller.",
  );
  const controllerLink = await requirePresentationControllerHomeLink(page, auth);
  await controllerLink.click();
  try {
    await expect(page).toHaveURL(/#\/controller(?:\/|$)/, { timeout: 15_000 });
  } catch {
    throw new Error(
      `Clicking the #/controller Home link opened an unexpected route (${new URL(page.url()).hash || "unknown"}).\n${homeSnapshot}`,
    );
  }
  const startupOverlay = page.getByTestId("controller-loading-overlay");
  try {
    await expect(startupOverlay).toBeHidden({ timeout: 90_000 });
  } catch {
    throw new Error(
      `Presentation Controller startup did not resolve; current route is ${new URL(page.url()).hash || "unknown"} and the startup overlay is still visible.\n${homeSnapshot}`,
    );
  }
  await expect(page.locator("#controller-main")).toBeVisible();
  await waitForControllerDatabase(page);
  await expect(page.getByRole("link", { name: "Songs", exact: true })).toBeVisible();
  const editMode = page.getByRole("button", { name: "Edit", exact: true });
  await editMode.click();
  await page.evaluate(async (duration) => {
    await (window as any).controllerE2EReady?.(duration);
  }, Date.now() - started);
};

export const openSongsLibrary = async (page: Page) => {
  if (!/\/controller\/songs(?:$|[?])/.test(new URL(page.url()).hash)) {
    await page.getByRole("link", { name: "Songs", exact: true }).click();
  }
  await expect(page).toHaveURL(/#\/controller\/songs(?:$|[?])/);
  await expect(page.getByRole("heading", { name: "Songs", exact: true })).toBeVisible();
};

export const songLibraryRow = (page: Page, title: string) => {
  const ownedId = songIds.get(title);
  if (ownedId) return page.getByTestId("filtered-items-results").locator(`[role="listitem"][data-item-id="${ownedId}"]`);
  return page
    .getByTestId("filtered-items-results")
    .getByRole("button", {
      name: `View song details for ${title}`,
      exact: true,
    })
    .locator('xpath=ancestor::*[@role="listitem"]');
};

export const waitForSongSearch = async (page: Page, title: string) => {
  const results = page.getByTestId("filtered-items-results");
  await expect(results).toHaveAttribute("data-search-query", title);
  await expect(results).toHaveAttribute("aria-busy", "false");
};

export const ensureSongExists = async (
  page: Page,
  song: { title: string; sections: readonly string[] },
) => {
  await waitForControllerDatabase(page);
  await openSongsLibrary(page);
  const search = page.getByRole("textbox", { name: "Search:", exact: true });
  await search.fill(song.title);
  await waitForSongSearch(page, song.title);
  let row = songLibraryRow(page, song.title);
  // Creation decisions come from the fully hydrated durable library, never
  // from a temporarily empty virtualized/search result list.
  const matchingIds: string[] = await page.evaluate((name) => window.__controllerE2EStore.getState().allDocs.allSongDocs
    .filter((doc: any) => doc.name === name)
    .map((doc: any) => doc._id), song.title);
  const existingDocuments = await Promise.all(matchingIds.map((id) => readDocument(page, id)));
  for (const document of existingDocuments) {
    expect(document?.e2eFixture?.outlineId).toBe(TEST_OUTLINE_ID);
    expect(document?.e2eFixture?.owner).toBe("presentation-controller-v1");
  }
  const existingCount = existingDocuments.length;
  if (existingCount === 1) songIds.set(song.title, existingDocuments[0]!._id);
  if (existingCount > 1) {
    throw new Error(`More than one library song has the E2E fixture title: ${song.title}`);
  }

  if (existingCount === 0) {
    await page.getByRole("link", { name: "Create a new song", exact: true }).click();
    await expect(page.getByLabel("Song name:", { exact: true })).toBeVisible();
    await page.getByLabel("Song name:", { exact: true }).fill(song.title);
    await page.getByLabel("Lyrics:", { exact: true }).fill(songLyrics(song.sections));
    await page.getByRole("button", { name: "Create Song", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: song.title, exact: true }),
    ).toBeVisible();
    const createdId = await page.evaluate(() => window.__controllerE2EStore.getState().undoable.present.item._id);
    const created = await readDocument(page, createdId);
    expect(created?.name).toBe(song.title);
    expect(created?.e2eFixture?.outlineId).toBe(TEST_OUTLINE_ID);
    songIds.set(song.title, createdId);
    await waitForControllerAutosave(page);
    await openSongsLibrary(page);
    await page.getByRole("textbox", { name: "Search:", exact: true }).fill(song.title);
    await waitForSongSearch(page, song.title);
    row = songLibraryRow(page, song.title);
  }

  await expect(row).toHaveCount(1);
  await expect(
    row.getByRole("button", {
      name: `View song details for ${song.title}`,
      exact: true,
    }),
  ).toBeVisible();
  await row
    .getByRole("button", {
      name: `View song details for ${song.title}`,
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: `Song details — ${song.title}`, exact: true }),
  ).toBeVisible();
  await expectSongSections(page, song);
  await page.getByRole("button", { name: "Close drawer", exact: true }).click();
};

export const selectTestOutline = async (page: Page) => {
  const document = await readDocument(page, TEST_OUTLINE_ID);
  expect(document?.e2eFixture?.outlineId).toBe(TEST_OUTLINE_ID);
  const picker = page.getByTestId("controller-outline-picker");
  await picker.click();
  const outlineList = page.getByTestId("controller-outline-list");
  const fixtureOutline = outlineList.locator(`li[data-outline-id="${TEST_OUTLINE_ID}"]`).getByRole("button", {
    name: TEST_OUTLINE_NAME,
    exact: true,
  });
  await expect(fixtureOutline).toHaveCount(1);
  // Selecting an outline immediately closes the popover and detaches this row.
  // Force skips only the transition stability check; the real button handler runs.
  const selectedOutlineId = await fixtureOutline
    .locator("xpath=ancestor::li[@data-outline-id]")
    .getAttribute("data-outline-id");
  if (!selectedOutlineId) {
    throw new Error("The dedicated E2E outline has no stable identity.");
  }
  await fixtureOutline.click({ force: true });
  await expect(picker).toContainText(TEST_OUTLINE_NAME);
  await expect(picker).toHaveAttribute("data-outline-id", selectedOutlineId);
  await expect(page.locator("#service-items-list")).toHaveAttribute(
    "data-outline-id",
    selectedOutlineId,
  );
};

const outlineRows = (page: Page) =>
  page.locator("#service-items-list > li[data-list-id]");

export const waitForControllerAutosave = async (page: Page) => {
  // The account button's status reflects the same Redux autosave selector that
  // tracks the outline's debounced Pouch write, including its 1.5s debounce.
  await expect(
    page
      .getByRole("button", { name: /^Account:/ })
      .getByText("Synced", { exact: true }),
  ).toBeVisible({ timeout: 30_000 });
};

export const outlineSongRow = (page: Page, title: string) =>
  page
    .locator("#service-items-list")
    .getByRole("link", { name: title, exact: true })
    .locator('xpath=ancestor::li[@data-list-id]');

export const cleanFixtureOutline = async (page: Page) => {
  await selectTestOutline(page);
  for (const title of [SONG_A.title, SONG_B.title]) {
    const row = outlineSongRow(page, title);
    if (await row.count()) {
      await row.getByRole("button", { name: `Delete ${title}`, exact: true }).click();
      await expect(row).toHaveCount(0, { timeout: 15_000 });
    }
  }
  await expect(outlineRows(page)).toHaveCount(0);
  await waitForControllerAutosave(page);
  await expect.poll(async () => (await readDocument(page, TEST_OUTLINE_ID))?.items).toEqual([]);
};

export const addLibrarySongResultToOutline = async (
  page: Page,
  title: string,
  libraryRow: Locator,
) => {
  const outlineRow = outlineSongRow(page, title);
  await expect(outlineRow).toHaveCount(0);

  let clickFailure: unknown;
  try {
    await libraryRow
      .getByRole("button", { name: "Add to outline", exact: true })
      .click();
  } catch (error) {
    // The add action can refresh the filtered library and detach its result
    // button during click completion. Accept that only if the exact new outline
    // entry is present; never retry the add action and risk creating a duplicate.
    clickFailure = error;
  }

  if (clickFailure) {
    try {
      await expect(outlineRow).toHaveCount(1);
    } catch {
      throw clickFailure;
    }
  }

  await expect(outlineRow).toHaveCount(1);
  await waitForControllerAutosave(page);
  await expect.poll(async () => (await readDocument(page, TEST_OUTLINE_ID))?.items
    .filter((entry: any) => entry._id === songIds.get(title)).length).toBe(1);
  return outlineRow;
};

export const addSongToOutline = async (page: Page, title: string) => {
  await openSongsLibrary(page);
  const search = page.getByRole("textbox", { name: "Search:", exact: true });
  await search.fill(title);
  await waitForSongSearch(page, title);
  const libraryRow = songLibraryRow(page, title);
  await expect(libraryRow).toHaveCount(1);
  return addLibrarySongResultToOutline(page, title, libraryRow);
};

export const openSongFromOutline = async (page: Page, title: string) => {
  const row = outlineSongRow(page, title);
  await expect(row).toHaveCount(1);
  await row.getByRole("link", { name: title, exact: true }).click();
  await expect(page).toHaveURL(/#\/controller\/?$/);
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await expect(page.locator("#item-slides-container")).toBeVisible();
  const listId = await row.getAttribute("data-list-id");
  if (!listId) throw new Error(`Outline row for ${title} has no stable list id`);
  return listId;
};

export const slideThumbnail = (page: Page, _outlineEntryId: string, index: number) =>
  page.locator(`[id="item-slide-${index}"]`);

export const editorContent = (page: Page) =>
  page.locator("#display-editor-box-1");

export const projectorPreview = (page: Page) =>
  page
    .getByRole("heading", { name: /^Projector\b/ })
    .locator("xpath=ancestor::section[1]");

export const ensureProjectorLive = async (page: Page) => {
  const preview = projectorPreview(page);
  const liveSwitch = preview.getByRole("switch");
  await expect(liveSwitch).toBeVisible();
  if ((await liveSwitch.getAttribute("aria-checked")) !== "true") {
    await liveSwitch.click();
    await expect(liveSwitch).toHaveAttribute("aria-checked", "true");
  }
  return preview;
};

export const expectProjectorContent = async (
  preview: ReturnType<typeof projectorPreview>,
  content: string,
  absentContent?: string,
) => {
  const displayStage = preview
    .getByTestId("content-hidden-preview-stage")
    .getByTestId("display-box-transition-stage");
  await expect(displayStage).toBeVisible();
  const activeOutputLane = displayStage.locator(
    '[data-testid^="display-box-transition-content-"][data-lane-role="active"]',
  );
  await expect(activeOutputLane).toHaveCount(1);
  await expect(activeOutputLane).toContainText(content);
  if (absentContent) await expect(activeOutputLane).not.toContainText(absentContent);
};

export const cleanProjectorOutput = async (page: Page) => {
  await resetLocalOutputs(page);
};

export const assertExactOutlineOrder = async (page: Page, titles: string[]) => {
  await expect(outlineRows(page)).toHaveText(titles);
};
