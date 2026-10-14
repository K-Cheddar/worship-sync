import { expect, type BrowserContext, type Page } from "@playwright/test";

// This suite exercises the local Vite renderer. Expose the *loaded* modules,
// including HMR URLs; importing a second module URL creates a second provider.
// Keep this instrumentation in Playwright, never in the production application.
export async function installControllerRuntime(context: BrowserContext) {
  await context.route(/\/src\/(context\/(controllerInfo|globalInfo)|store\/store)\.tsx?(?:\?|$)/, async (route) => {
    const response = await route.fetch();
    let source = await response.text();
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith("/controllerInfo.tsx")) {
      source += `\nwindow.__controllerE2E = {
        database: () => globalDb,
        remote: (databaseName = globalDb.name) => new PouchDB(import.meta.env.VITE_COUCHDB_HOST + '/' + databaseName, {
          fetch: (url, options) => fetch(url, { ...options, credentials: 'include' })
        })
      };`;
    } else if (pathname.endsWith("/store.ts")) {
      source += `\nwindow.__controllerE2EStore = store;
        window.__controllerE2ESongLibraryHydrated = false;
        const controllerE2EDispatch = store.dispatch;
        store.dispatch = (action) => {
          const result = controllerE2EDispatch(action);
          if (action.type === 'allDocs/updateAllSongDocs') window.__controllerE2ESongLibraryHydrated = true;
          return result;
        };`;
    } else {
      const firebaseModule = source.match(/from\s+["']([^"']*firebase_database[^"']*)["']/)?.[1];
      if (!firebaseModule) throw new Error("Controller E2E requires the local Vite Firebase module; output isolation was not installed.");
      source = `import { goOffline as controllerE2EGoOffline } from ${JSON.stringify(firebaseModule)};\n${source}`;
      source += `\nObject.defineProperties(globalFireDbInfo, {
        canWriteSharedData: { get: () => false, set: () => {} },
        db: { get: () => undefined, set: (db) => { if (db) controllerE2EGoOffline(db); } }
      }); window.__controllerE2EOutputsIsolated = true;`;
    }
    await route.fulfill({ response, body: source });
  });
}

// Browser-side types are intentionally kept here; the app has no E2E globals.
export type FixtureDocument = Record<string, any> & { _id: string; _rev?: string };
declare global {
  interface Window {
    __controllerE2E: { database: () => any; remote: (databaseName?: string) => any };
    __controllerE2EStore: { getState: () => any; dispatch: (action: any) => void };
    __controllerE2EOutputsIsolated: boolean;
    __controllerE2ESongLibraryHydrated: boolean;
  }
}

export async function waitForControllerDatabase(page: Page) {
  await expect.poll(() => page.evaluate(() => Boolean(
    window.__controllerE2EOutputsIsolated && window.__controllerE2E?.database(),
  )), { timeout: 120_000, message: "Initial PouchDB replication must complete, with isolated outputs" }).toBe(true);
  await expect.poll(() => page.evaluate(() => {
    const state = window.__controllerE2EStore?.getState();
    return Boolean(window.__controllerE2ESongLibraryHydrated && state?.allItems.isInitialized && !state.allItems.isAllItemsLoading &&
      state.undoable.present.itemLists.isInitialized && state.undoable.present.itemList.isInitialized);
  }), { timeout: 30_000, message: "Controller library and outline hydration must complete" }).toBe(true);
}

export async function readDocument(page: Page, id: string): Promise<FixtureDocument | null> {
  return page.evaluate(async (id) => {
    try { return await window.__controllerE2E.database().get(id); }
    catch (error: any) { if (error.status === 404) return null; throw error; }
  }, id);
}

export async function resetLocalOutputs(page: Page) {
  expect(await page.evaluate(() => window.__controllerE2EOutputsIsolated)).toBe(true);
  await page.evaluate(() => {
    window.__controllerE2EStore.dispatch({ type: "presentation/clearAll" });
    window.__controllerE2EStore.dispatch({ type: "presentation/setTransmitToAll", payload: false });
  });
}
