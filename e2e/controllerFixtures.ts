import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { type BrowserContext } from "@playwright/test";
import { test as diagnosticTest, expect } from "./fixtures";
import { allowedE2EAuthOrigins } from "./authOrigins";
import { FIXTURE_OWNER } from "./controllerFixtureCleanup";
import { installControllerRuntime, readDocument, resetLocalOutputs, waitForControllerDatabase } from "./controllerRuntime";
import { SONG_A, SONG_B, TEST_OUTLINE_ID, TEST_OUTLINE_NAME, cleanFixtureOutline, ensureSongExists, openPresentationController, selectTestOutline } from "./controllerTestData";

export const controllerTest = diagnosticTest.extend<{}, { controllerContext: BrowserContext }>({
  controllerContext: [async ({ browser }, use, workerInfo) => {
    const options = workerInfo.project.use;
    const context = await browser.newContext({
      baseURL: options.baseURL,
      storageState: options.storageState,
      ignoreHTTPSErrors: options.ignoreHTTPSErrors,
      viewport: options.viewport,
      serviceWorkers: "block",
    });
    context.setDefaultTimeout(options.actionTimeout ?? 15_000);
    context.setDefaultNavigationTimeout(options.navigationTimeout ?? 30_000);
    const ids = new Set<string>();
    const manifestPath = resolve("playwright/.fixtures", `${TEST_OUTLINE_ID}-${randomUUID()}.json`);
    await mkdir(resolve("playwright/.fixtures"), { recursive: true });
    let unsafeAuthRequests = 0;
    let bulkDownloads = 0;
    const downloadsByPage = new Map<unknown, { requests: number; documents: number }>();
    const startupDurations: number[] = [];
    context.on("page", page => downloadsByPage.set(page, { requests: 0, documents: 0 }));
    const trustedOrigins = allowedE2EAuthOrigins(options.baseURL!);
    await context.route(/\/api\/auth(?:\/|$)|mailslurp\.com/i, async route => {
      const request = route.request();
      const url = new URL(request.url());
      let renewal = false;
      try { renewal = url.pathname === "/api/auth/session" && request.postDataJSON()?.requestNewCode === false; } catch { /* fail closed */ }
      if (/mailslurp\.com/i.test(url.hostname) || !trustedOrigins.has(url.origin) || (request.method() === "POST" && !renewal)) {
        unsafeAuthRequests++;
        await route.abort("blockedbyclient");
      } else await route.continue();
    });
    context.on("request", request => {
      const pathname = new URL(request.url()).pathname;
      if (!pathname.endsWith("/_bulk_get") || pathname.includes("/worship-sync-bibles/")) return;
      bulkDownloads++;
      const page = request.frame().page();
      const counts = downloadsByPage.get(page) ?? { requests: 0, documents: 0 };
      counts.requests++;
      counts.documents += request.postDataJSON()?.docs?.length ?? 0;
      downloadsByPage.set(page, counts);
    });
    await installControllerRuntime(context);
    let baselineSelection: Record<string, string> = {};
    let database = "";
    let cleanupDiagnostic: unknown = null;
    const persistManifest = async (status: string) => writeFile(manifestPath, JSON.stringify({
      owner: FIXTURE_OWNER, outlineId: TEST_OUTLINE_ID, database, ids: [...ids], baselineSelection, status, cleanupDiagnostic, bulkDownloads, downloadsByPage: [...downloadsByPage.values()], startupDurationsMs: startupDurations, unsafeAuthRequests,
    }, null, 2));
    await context.exposeBinding("controllerE2ERecord", async (_source, id: string) => {
      ids.add(id);
      // Record ownership intent before the Pouch write, including lost responses.
      await persistManifest("active");
    });
    await context.exposeBinding("controllerE2EReady", async (_source, duration: number) => {
      startupDurations.push(duration);
    });
    const setupPage = await context.newPage();
    try {
      await openPresentationController(setupPage);
      await waitForControllerDatabase(setupPage);
      const baseline = await readDocument(setupPage, "ItemLists");
      baselineSelection = baseline?.selectedIdByScope ?? {};
      database = await setupPage.evaluate(() => window.__controllerE2E.database().name);
      await persistManifest("active");
      await setupPage.evaluate(({ owner, names }) => {
        const db = window.__controllerE2E.database();
        const originalPut = db.put.bind(db);
        db.put = async (doc: any, ...args: any[]) => {
          if (names.includes(doc.name) && doc.type === "song") {
            doc = { ...doc, e2eFixture: { owner, outlineId: names[2] } };
            await (window as any).controllerE2ERecord(doc._id);
          }
          return originalPut(doc, ...args);
        };
      }, { owner: FIXTURE_OWNER, names: [SONG_A.title, SONG_B.title, TEST_OUTLINE_ID] });
      ids.add(TEST_OUTLINE_ID);
      await persistManifest("active");
      await setupPage.evaluate(async ({ id, name, owner }) => {
        const db = window.__controllerE2E.database();
        await db.put({ _id: id, name, items: [], overlays: [], docType: "itemListDetails", e2eFixture: { owner, outlineId: id } });
        const registry = await db.get("ItemLists");
        registry.itemLists.push({ _id: id, name });
        await db.put(registry);
        window.__controllerE2EStore.dispatch({ type: "itemLists/updateItemListsFromRemote", payload: { itemLists: registry.itemLists, activeListId: registry.activeList?._id } });
      }, { id: TEST_OUTLINE_ID, name: TEST_OUTLINE_NAME, owner: FIXTURE_OWNER });
      await selectTestOutline(setupPage);
      await ensureSongExists(setupPage, SONG_A);
      await ensureSongExists(setupPage, SONG_B);
      await cleanFixtureOutline(setupPage);
      await resetLocalOutputs(setupPage);
      await setupPage.close();
      await use(context);
    } finally {
      const cleanupPage = setupPage.isClosed() ? await context.newPage() : setupPage;
      try {
        if (setupPage.isClosed()) await openPresentationController(cleanupPage);
        if (ids.size) {
          await waitForControllerDatabase(cleanupPage);
          await cleanupPage.evaluate(async ({ ids, owner, outlineId, baselineSelection, database }) => {
            const db = window.__controllerE2E.database();
            if (db.name !== database) throw new Error(`Database changed; refusing cleanup for ${database}`);
            const docs = (await db.allDocs({ include_docs: true })).rows.map((row: any) => row.doc).filter(Boolean);
            const owned = docs.filter((doc: any) => ids.includes(doc._id));
            const unowned = owned.filter((doc: any) => doc.e2eFixture?.owner !== owner || doc.e2eFixture?.outlineId !== outlineId);
            const references = docs.filter((doc: any) => !ids.includes(doc._id) && !["allItems", "ItemLists"].includes(doc._id) && ids.some((id: string) => JSON.stringify(doc).includes(id)));
            if (unowned.length || references.length) throw new Error(`Cleanup refused: ownership ${unowned.map((d: any) => d._id)}; references ${references.map((d: any) => d._id)}; fixture IDs ${ids}`);
            const registry = await db.get("ItemLists");
            if (ids.includes(registry.activeList?._id)) throw new Error(`Fixture became the active operator outline: ${outlineId}`);
            registry.itemLists = registry.itemLists.filter((entry: any) => !ids.includes(entry._id));
            for (const [scope, selected] of Object.entries(registry.selectedIdByScope ?? {})) {
              if (selected === outlineId) {
                if (baselineSelection[scope]) registry.selectedIdByScope[scope] = baselineSelection[scope];
                else delete registry.selectedIdByScope[scope];
              }
            }
            await db.put(registry);
            const library = await db.get("allItems");
            library.items = library.items.filter((entry: any) => !ids.includes(entry._id));
            await db.put(library);
            for (const doc of owned) await db.remove(doc);
            const remote = window.__controllerE2E.remote(database);
            try {
              await db.replicate.to(remote, { doc_ids: [...ids, "allItems", "ItemLists"] });
              for (const id of ids) {
                try { await remote.get(id); throw new Error(`Remote fixture remains: ${id}`); }
                catch (error: any) { if (error.status !== 404) throw error; }
              }
              for (const [key, field] of [["allItems", "items"], ["ItemLists", "itemLists"]]) {
                const doc = await remote.get(key);
                if (doc[field].some((entry: any) => ids.includes(entry._id))) throw new Error(`Remote registry still references fixture IDs: ${ids}`);
              }
            } finally { await remote.close(); }
          }, { ids: [...ids], owner: FIXTURE_OWNER, outlineId: TEST_OUTLINE_ID, baselineSelection, database });
        }
        await persistManifest("cleaned");
        console.log(`Controller worker: ${bulkDownloads} bulk download request(s), ${unsafeAuthRequests} unsafe auth requests; removed fixture IDs ${[...ids].join(", ")}`);
        expect(unsafeAuthRequests).toBe(0);
      } catch (error) {
        try {
          cleanupDiagnostic = await cleanupPage.evaluate(async ({ ids, database }) => {
            const local = window.__controllerE2E.database();
            const remote = window.__controllerE2E.remote(database);
            const remaining: Record<string, string[]> = { local: [], remote: [], unverified: [] };
            try {
              for (const [label, db] of [["local", local], ["remote", remote]] as const) {
                for (const id of ids) {
                  try {
                    if (!db || (label === "local" && db.name !== database)) throw new Error("Database unavailable");
                    await db.get(id); remaining[label].push(id);
                  } catch (failure: any) { if (failure.status !== 404) remaining.unverified.push(`${label}:${id}`); }
                }
              }
              return remaining;
            } finally { await remote.close(); }
          }, { ids: [...ids], database });
        } catch { cleanupDiagnostic = { unverified: [...ids], reason: "Cleanup browser unavailable" }; }
        await persistManifest("cleanup-failed");
        throw new Error(`Controller cleanup failed; inspect ${manifestPath}. Affected fixture IDs: ${[...ids].join(", ")}. Remaining: ${JSON.stringify(cleanupDiagnostic)}. ${error}`);
      } finally { await context.close(); }
    }
  }, { scope: "worker", timeout: 240_000 }],
  context: async ({ controllerContext }, use) => {
    try { await use(controllerContext); }
    finally {
      // The built-in page fixture relies on context disposal. Our context
      // survives this test, so retire every page/replication owner explicitly.
      for (const page of controllerContext.pages()) await page.close();
    }
  },
});
