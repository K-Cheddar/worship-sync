import { controllerTest as test } from "./controllerFixtures";
import { expect } from "./fixtures";
import { resetLocalOutputs, waitForControllerDatabase } from "./controllerRuntime";
import {
  SONG_A,
  SONG_B,
  TEST_OUTLINE_NAME,
  addLibrarySongResultToOutline,
  addSongToOutline,
  assertExactOutlineOrder,
  cleanFixtureOutline,
  cleanProjectorOutput,
  editorContent,
  expectSongSections,
  ensureProjectorLive,
  expectProjectorContent,
  openPresentationController,
  openSongFromOutline,
  openSongsLibrary,
  outlineSongRow,
  selectTestOutline,
  songLibraryRow,
  slideThumbnail,
  waitForControllerAutosave,
  waitForSongSearch,
} from "./controllerTestData";

test.beforeEach(async ({ page }) => {
  await openPresentationController(page);
  await cleanFixtureOutline(page);
  await resetLocalOutputs(page);
});

test.afterEach(async ({ page }, testInfo) => {
  try {
    await cleanFixtureOutline(page);
    await cleanProjectorOutput(page);
  } catch (error) {
    await testInfo.attach("controller-cleanup-diagnostic.txt", {
      body: Buffer.from(
        `Controller cleanup failed for ${TEST_OUTLINE_NAME}: ${String(error)}. Worker teardown will attempt exact-ID cleanup.`,
      ),
      contentType: "text/plain",
    });
    throw error;
  }
});

test("searches for a known song, adds it once, and opens that outline entry", async ({ page }) => {
  await openSongsLibrary(page);
  const search = page.getByRole("textbox", { name: "Search:", exact: true });
  await search.fill(SONG_A.title);
  await waitForSongSearch(page, SONG_A.title);

  const libraryRow = songLibraryRow(page, SONG_A.title);
  await expect(libraryRow).toHaveCount(1);
  await expect(
    libraryRow.getByRole("button", {
      name: `View song details for ${SONG_A.title}`,
      exact: true,
    }),
  ).toBeVisible();
  const outlineRow = await addLibrarySongResultToOutline(
    page,
    SONG_A.title,
    libraryRow,
  );
  await expect(
    songLibraryRow(page, SONG_A.title),
  ).toHaveCount(1);

  const listId = await openSongFromOutline(page, SONG_A.title);
  await slideThumbnail(page, listId, 1).click();
  await expect(editorContent(page)).toHaveValue(SONG_A.sections[0]);
  await expect(page.getByRole("heading", { name: SONG_A.title, exact: true })).toBeVisible();
  await expect(outlineSongRow(page, SONG_A.title)).toHaveCount(1);
});

test("opens exact known song details without changing the outline", async ({ page }) => {
  await selectTestOutline(page);
  const picker = page.getByTestId("controller-outline-picker");
  const outlineId = await picker.getAttribute("data-outline-id");
  if (!outlineId) throw new Error("The dedicated E2E outline has no stable identity.");
  const testOutline = page.locator(
    `#service-items-list[data-outline-id="${outlineId}"]`,
  );
  const testOutlineRows = testOutline.locator(":scope > li[data-list-id]");
  await expect(testOutline).toHaveCount(1);
  await expect(testOutlineRows).toHaveCount(0);

  await openSongsLibrary(page);
  await page.getByRole("textbox", { name: "Search:", exact: true }).fill(SONG_A.title);
  await waitForSongSearch(page, SONG_A.title);
  const row = songLibraryRow(page, SONG_A.title);
  await expect(row).toHaveCount(1);
  await expect(
    row.getByRole("button", {
      name: `View song details for ${SONG_A.title}`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(picker).toHaveAttribute("data-outline-id", outlineId);
  await expect(testOutlineRows).toHaveCount(0);
  await row
    .getByRole("button", {
      name: `View song details for ${SONG_A.title}`,
      exact: true,
    })
    .click();

  await expect(
    page.getByRole("heading", { name: `Song details — ${SONG_A.title}`, exact: true }),
  ).toBeVisible();
  await expectSongSections(page, SONG_A);
  await expect(picker).toHaveAttribute("data-outline-id", outlineId);
  await expect(testOutlineRows).toHaveCount(0);
  await page.getByRole("button", { name: "Close drawer", exact: true }).click();
});

test("navigates song slides and verifies the active projector output", async ({ page }) => {
  await addSongToOutline(page, SONG_A.title);
  const listId = await openSongFromOutline(page, SONG_A.title);
  const preview = await ensureProjectorLive(page);

  await slideThumbnail(page, listId, 0).click();
  await expect(editorContent(page)).toHaveValue(SONG_A.title);
  await expectProjectorContent(preview, SONG_A.title);

  await slideThumbnail(page, listId, 2).click();
  await expect(editorContent(page)).toHaveValue(SONG_A.sections[1]);
  await expectProjectorContent(preview, SONG_A.sections[1], SONG_A.sections[0]);

  await slideThumbnail(page, listId, 1).click();
  await expect(editorContent(page)).toHaveValue(SONG_A.sections[0]);
  await expectProjectorContent(preview, SONG_A.sections[0], SONG_A.sections[1]);

  await page.keyboard.press("Space");
  await expect(editorContent(page)).toHaveValue(SONG_A.sections[1]);
  await expectProjectorContent(preview, SONG_A.sections[1], SONG_A.sections[0]);

  await page.keyboard.press("Shift+Space");
  await expect(editorContent(page)).toHaveValue(SONG_A.sections[0]);
  await expectProjectorContent(preview, SONG_A.sections[0], SONG_A.sections[1]);
});

test("switches rapidly between known songs without stale editor, slides, or output", async ({ page }) => {
  await addSongToOutline(page, SONG_A.title);
  await addSongToOutline(page, SONG_B.title);

  const songAListId = await openSongFromOutline(page, SONG_A.title);
  const preview = await ensureProjectorLive(page);
  await slideThumbnail(page, songAListId, 1).click();
  await expect(editorContent(page)).toHaveValue(SONG_A.sections[0]);
  await expectProjectorContent(preview, SONG_A.sections[0]);

  const songBListId = await openSongFromOutline(page, SONG_B.title);
  await slideThumbnail(page, songBListId, 2).click();
  await expect(editorContent(page)).toHaveValue(SONG_B.sections[1]);
  await expectProjectorContent(preview, SONG_B.sections[1], SONG_A.sections[0]);

  await openSongFromOutline(page, SONG_A.title);
  await expect(page.getByRole("heading", { name: SONG_A.title, exact: true })).toBeVisible();
  await expect(slideThumbnail(page, songAListId, 1)).toContainText(SONG_A.sections[0]);
  await expect(slideThumbnail(page, songAListId, 2)).toContainText(SONG_A.sections[1]);
  await expect(slideThumbnail(page, songAListId, 3)).toContainText(SONG_A.sections[2]);
  await expect(slideThumbnail(page, songAListId, 2)).not.toContainText(SONG_B.sections[1]);
  const currentEditorText = await editorContent(page).inputValue();
  expect([SONG_A.title, ...SONG_A.sections]).toContain(currentEditorText);

  await slideThumbnail(page, songAListId, 1).click();
  await expect(editorContent(page)).toHaveValue(SONG_A.sections[0]);
  await expectProjectorContent(preview, SONG_A.sections[0], SONG_B.sections[1]);
});

test("persists the dedicated outline order across a browser reload", async ({ page }) => {
  await addSongToOutline(page, SONG_A.title);
  await addSongToOutline(page, SONG_B.title);
  await assertExactOutlineOrder(page, [SONG_A.title, SONG_B.title]);

  await waitForControllerAutosave(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("controller-loading-overlay")).toBeHidden({
    timeout: 90_000,
  });
  await expect(page.locator("#controller-main")).toBeVisible();
  await waitForControllerDatabase(page);
  await resetLocalOutputs(page);
  await selectTestOutline(page);
  await expect(page.getByTestId("controller-outline-picker")).toContainText(TEST_OUTLINE_NAME);
  await assertExactOutlineOrder(page, [SONG_A.title, SONG_B.title]);
  await expect(outlineSongRow(page, SONG_A.title)).toHaveCount(1);
  await expect(outlineSongRow(page, SONG_B.title)).toHaveCount(1);

  const listId = await openSongFromOutline(page, SONG_A.title);
  await expect(slideThumbnail(page, listId, 1)).toContainText(SONG_A.sections[0]);
  await slideThumbnail(page, listId, 1).click();
  await expect(editorContent(page)).toHaveValue(SONG_A.sections[0]);
  await expect(page.getByRole("heading", { name: SONG_A.title, exact: true })).toBeVisible();
});
