import { expect, type Locator, type Page } from "./fixtures";

export const TEST_OUTLINE_NAME = "E2E Presentation Controller";
const projectorEnabledByTests = new WeakSet<Page>();

export const SONG_A = {
  title: "E2E Presentation Controller Song A - Amber Harbor",
  sections: [
    "Amber Harbor dawn paints the shoreline\nAmber lanterns mark the way",
    "Amber Harbor carries the chorus\nAmber voices cross the bay",
    "Amber lights return to harbor\nAmber morning starts again",
  ],
} as const;

export const SONG_B = {
  title: "E2E Presentation Controller Song B - Violet Summit",
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

export const openPresentationController = async (page: Page) => {
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
  await expect(page.getByRole("link", { name: "Songs", exact: true })).toBeVisible();
  const editMode = page.getByRole("button", { name: "Edit", exact: true });
  await editMode.click();
};

export const openSongsLibrary = async (page: Page) => {
  if (!/\/controller\/songs(?:$|[?])/.test(new URL(page.url()).hash)) {
    await page.getByRole("link", { name: "Songs", exact: true }).click();
  }
  await expect(page).toHaveURL(/#\/controller\/songs(?:$|[?])/);
  await expect(page.getByRole("heading", { name: "Songs", exact: true })).toBeVisible();
};

export const songLibraryRow = (page: Page, title: string) =>
  page
    .getByTestId("filtered-items-results")
    .getByRole("button", {
      name: `View song details for ${title}`,
      exact: true,
    })
    .locator('xpath=ancestor::*[@role="listitem"]');

export const ensureSongExists = async (
  page: Page,
  song: { title: string; sections: readonly string[] },
) => {
  await openSongsLibrary(page);
  const search = page.getByRole("textbox", { name: "Search:", exact: true });
  await search.fill(song.title);
  const results = page.getByTestId("filtered-items-results");
  await expect(results).toHaveAttribute("aria-busy", "false");
  let row = songLibraryRow(page, song.title);
  const existingCount = await row.count();
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
    await openSongsLibrary(page);
    await page.getByRole("textbox", { name: "Search:", exact: true }).fill(song.title);
    await expect(results).toHaveAttribute("aria-busy", "false");
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
  const picker = page.getByTestId("controller-outline-picker");
  await picker.click();
  const outlineList = page.getByTestId("controller-outline-list");
  let fixtureOutline = outlineList.getByRole("button", {
    name: TEST_OUTLINE_NAME,
    exact: true,
  });
  let count = await fixtureOutline.count();
  if (count > 1) {
    throw new Error(`More than one outline is named ${TEST_OUTLINE_NAME}`);
  }

  if (count === 0) {
    const selectedOutlineId = await picker.getAttribute("data-outline-id");
    await page.getByRole("button", { name: "Add New Service", exact: true }).click();
    await expect(picker).not.toHaveAttribute(
      "data-outline-id",
      selectedOutlineId ?? "",
    );
    const newOutlineId = await picker.getAttribute("data-outline-id");
    const newOutlineName = (await picker.innerText()).trim();
    if (!newOutlineId || !newOutlineName) {
      throw new Error("The new test outline did not become the selected outline.");
    }
    await picker.click();
    const newOutlineRow = outlineList.locator(
      `li[data-outline-id="${newOutlineId}"]`,
    );
    await expect(newOutlineRow).toBeVisible();
    await newOutlineRow
      .getByRole("button", {
        name: `Rename outline ${newOutlineName}`,
        exact: true,
      })
      .click();
    const nameInput = newOutlineRow.getByRole("textbox");
    await expect(nameInput).toHaveCount(1);
    await expect(nameInput).toBeEnabled();
    await nameInput.fill(TEST_OUTLINE_NAME);
    await newOutlineRow
      .getByRole("button", { name: "Save outline name", exact: true })
      .click();
    await expect(
      newOutlineRow.getByRole("button", { name: TEST_OUTLINE_NAME, exact: true }),
    ).toBeVisible();
    await expect(picker).toContainText(TEST_OUTLINE_NAME);
    await picker.click();
    fixtureOutline = outlineList.getByRole("button", {
      name: TEST_OUTLINE_NAME,
      exact: true,
    });
    count = await fixtureOutline.count();
  }

  if (count !== 1) {
    throw new Error(`Expected one dedicated E2E outline; found ${count}`);
  }
  // Selecting an outline immediately closes the popover and detaches this row.
  // Force skips only the transition stability check; the real button handler runs.
  await fixtureOutline.click({ force: true });
  await expect(picker).toContainText(TEST_OUTLINE_NAME);
  const selectedOutlineId = await fixtureOutline
    .locator("xpath=ancestor::li[@data-outline-id]")
    .getAttribute("data-outline-id");
  if (!selectedOutlineId) {
    throw new Error("The dedicated E2E outline has no stable identity.");
  }
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
  return outlineRow;
};

export const addSongToOutline = async (page: Page, title: string) => {
  await openSongsLibrary(page);
  const search = page.getByRole("textbox", { name: "Search:", exact: true });
  await search.fill(title);
  const results = page.getByTestId("filtered-items-results");
  await expect(results).toHaveAttribute("aria-busy", "false");
  const libraryRow = songLibraryRow(page, title);
  await expect(libraryRow).toHaveCount(1);
  return addLibrarySongResultToOutline(page, title, libraryRow);
};

export const openSongFromOutline = async (page: Page, title: string) => {
  const row = outlineSongRow(page, title);
  await expect(row).toHaveCount(1);
  await row.getByRole("link", { name: title, exact: true }).click();
  await expect(page).toHaveURL(/#\/controller\/item\//);
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
    projectorEnabledByTests.add(page);
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
  if (!projectorEnabledByTests.has(page)) return;
  const preview = projectorPreview(page);
  if (!(await preview.count())) {
    projectorEnabledByTests.delete(page);
    return;
  }
  const liveSwitch = preview.getByRole("switch");
  if ((await liveSwitch.getAttribute("aria-checked")) === "true") {
    await liveSwitch.click();
    await expect(liveSwitch).toHaveAttribute("aria-checked", "false");
  }
  projectorEnabledByTests.delete(page);
};

export const assertExactOutlineOrder = async (page: Page, titles: string[]) => {
  await expect(outlineRows(page)).toHaveText(titles);
};
