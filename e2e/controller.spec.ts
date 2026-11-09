import { controllerTest as test } from "./controllerFixtures";
import { expect } from "./fixtures";
import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { assertControllerFirebaseTargetSupported, isLongPollingWritePacket } from "./controllerFirebaseIsolation";
import { installControllerAuthRequestGuard, installControllerRuntime, readControllerStartupSnapshot, resetLocalOutputs, waitForControllerDatabase } from "./controllerRuntime";
import { openHome } from "./smokeNavigation";
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
  requirePresentationControllerHomeLink,
  openSongFromOutline,
  openSongsLibrary,
  outlineSongRow,
  selectTestOutline,
  songLibraryRow,
  slideThumbnail,
  waitForControllerAutosave,
  waitForSongSearch,
} from "./controllerTestData";

// Run startup once before the controller workflow tests. A configuration/auth failure
// is therefore reported as one preflight failure, instead of restarting the
// worker and repeating the same setup error for every workflow.
test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  const baseURL = process.env.E2E_BASE_URL?.trim();
  if (!baseURL) throw new Error("E2E_BASE_URL is required for controller startup preflight.");
  const hostname = new URL(baseURL).hostname.toLowerCase();
  const context = await browser.newContext({
    baseURL,
    storageState: resolve("playwright/.auth/worshipsync-user.json"),
    serviceWorkers: "block",
    ignoreHTTPSErrors: ["localhost", "127.0.0.1", "::1", "local.worshipsync.net"].includes(hostname),
  });
  context.setDefaultTimeout(15_000);
  context.setDefaultNavigationTimeout(30_000);
  await installControllerAuthRequestGuard(context, baseURL);
  const isolation = await installControllerRuntime(context);
  const page = await context.newPage();
  try {
    const auth = await openHome(page);
    await requirePresentationControllerHomeLink(page, auth);
    const snapshot = await readControllerStartupSnapshot(page);
    assertControllerFirebaseTargetSupported(snapshot.firebase);
    if (!snapshot.firebase?.demoTenant) {
      throw new Error("Controller E2E is restricted to the approved demo tenant; refusing fixture mutations.");
    }
    await isolation.assertReady(page);
  } finally {
    await context.close();
  }
});

async function readFirebaseConfigurationFingerprint(page: import("@playwright/test").Page) {
  const configuration = await page.evaluate(async () => {
    const churchId = window.__controllerE2EFirebaseStatus?.().churchId;
    if (!churchId) throw new Error("Firebase church scope is unavailable for the read-only baseline check.");
    const root = `churches/${churchId}/data`;
    const [controllerProfiles, displayOutputs] = await Promise.all([
      window.__controllerE2E.readFirebasePath(`${root}/controllerProfiles`),
      window.__controllerE2E.readFirebasePath(`${root}/displayOutputs`),
    ]);
    return { controllerProfiles, displayOutputs };
  });
  const canonicalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, canonicalize(entry)]),
      );
    }
    return value;
  };
  return createHash("sha256").update(JSON.stringify(canonicalize(configuration))).digest("hex");
}

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

test("keeps Firebase configuration reads while blocking direct SDK writes across reload", async ({ page }) => {
  await waitForControllerDatabase(page);
  const startup = await readControllerStartupSnapshot(page);
  expect(startup.firebase?.connected).toBe(true);
  expect(startup.startup?.controllerProfiles).toMatchObject({ loaded: true, syncedToCurrentChurch: true });
  expect(startup.startup?.displayOutputs).toMatchObject({ loaded: true, syncedToCurrentChurch: true });
  const configurationBaseline = await readFirebaseConfigurationFingerprint(page);

  const probePath = await page.evaluate((probeId) => window.__controllerE2E.probePath(probeId), `e2e-controller-isolation-${randomUUID()}`);
  expect(await page.evaluate((path) => window.__controllerE2E.readFirebasePath(path), probePath)).toBeNull();
  const metricsBefore = await page.evaluate(() => window.__controllerE2EIsolationMetrics?.());
  if (!metricsBefore) throw new Error("Firebase write isolation metrics are unavailable; refusing the direct SDK probe.");
  expect(metricsBefore.blockedHttpWrites).toBe(0);
  expect(metricsBefore.blockedLongPollingWrites).toBe(0);
  expect(metricsBefore.suppressedSdkWrites.onDisconnect ?? 0).toBeGreaterThan(0);
  expect(metricsBefore.suppressedSdkWrites.set ?? 0).toBeGreaterThan(0);

  const transactionPath = await page.evaluate(() => {
    const churchId = window.__controllerE2EFirebaseStatus?.().churchId;
    if (!churchId) throw new Error("Firebase church scope is unavailable for the transaction read probe.");
    return `churches/${churchId}/data/controllerProfiles`;
  });
  const currentTransactionValue = await page.evaluate(
    (path) => window.__controllerE2E.readFirebasePath(path),
    transactionPath,
  );
  const transactionResult = await page.evaluate(
    (path) => window.__controllerE2ERunTransactionProbe?.(path),
    transactionPath,
  );
  expect(transactionResult).toEqual({
    committed: false,
    snapshotExists: currentTransactionValue !== null,
    snapshotValue: currentTransactionValue,
    mutationInvoked: false,
  });
  await expect.poll(async () =>
    (await page.evaluate(() => window.__controllerE2EIsolationMetrics?.()))
      ?.suppressedSdkWrites.runTransaction ?? 0,
  ).toBeGreaterThan(metricsBefore.suppressedSdkWrites.runTransaction ?? 0);

  const blockedLongPollWrite = page.waitForEvent("requestfailed", (request) => isLongPollingWritePacket(request.url()));
  await page.evaluate(({ path, marker }) => {
    void window.__controllerE2E.directFirebaseWrite(path, { e2eIsolationProbe: marker }).catch(() => undefined);
  }, { path: probePath, marker: randomUUID() });
  await blockedLongPollWrite;
  await expect.poll(async () => (await page.evaluate(() => window.__controllerE2EIsolationMetrics?.()))?.blockedLongPollingWrites ?? 0)
    .toBeGreaterThan(metricsBefore.blockedLongPollingWrites);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("controller-loading-overlay")).toBeHidden({ timeout: 90_000 });
  await expect(page.locator("#controller-main")).toBeVisible();
  await waitForControllerDatabase(page);
  expect(await page.evaluate((path) => window.__controllerE2E.readFirebasePath(path), probePath)).toBeNull();
  expect(await readFirebaseConfigurationFingerprint(page)).toBe(configurationBaseline);
});
