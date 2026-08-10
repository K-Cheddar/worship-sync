/* eslint-disable @typescript-eslint/no-explicit-any */
import { lazy, type ComponentType, type LazyExoticComponent } from "react";

/**
 * Route-level lazy loading that survives a deploy.
 *
 * A deploy replaces hashed chunk filenames. A session opened before the deploy
 * still references the old names, so navigating to a route whose chunk was not
 * already loaded can 404 — showing the error boundary, potentially mid-service.
 * Electron is immune (chunks load from disk); web and installed PWA are not.
 *
 * Recovery ladder, cheapest first:
 *   1. Retry the import once — clears transient network blips without disruption.
 *   2. Reload the page once — picks up the new asset manifest.
 *   3. Rethrow — let the error boundary handle a genuinely broken chunk.
 *
 * Step 3 is what stops a reload loop: the flag is only cleared after a load
 * succeeds, so a chunk that fails again immediately after reloading throws
 * instead of reloading forever.
 */

const RELOAD_FLAG = "worshipsync:chunk-reload";
const RETRY_DELAY_MS = 300;

type ModuleLoader<T> = () => Promise<{ default: T }>;

/** sessionStorage throws in some privacy modes; degrade to "no reload attempted". */
const hasReloaded = (): boolean => {
  try {
    return window.sessionStorage.getItem(RELOAD_FLAG) === "1";
  } catch {
    return false;
  }
};

const markReloaded = (): void => {
  try {
    window.sessionStorage.setItem(RELOAD_FLAG, "1");
  } catch {
    // Non-fatal: worst case we skip the reload guard.
  }
};

const clearReloaded = (): void => {
  try {
    window.sessionStorage.removeItem(RELOAD_FLAG);
  } catch {
    // Non-fatal.
  }
};

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const reloadPage = (): void => {
  window.location.reload();
};

export const loadChunk = async <T>(
  load: ModuleLoader<T>,
  /** Injectable so the reload path is testable; jsdom forbids stubbing location. */
  reload: () => void = reloadPage,
): Promise<{ default: T }> => {
  try {
    const loaded = await load();
    clearReloaded();
    return loaded;
  } catch {
    await wait(RETRY_DELAY_MS);
  }

  try {
    const loaded = await load();
    clearReloaded();
    return loaded;
  } catch (error) {
    if (hasReloaded()) {
      throw error;
    }
    markReloaded();
    reload();
    // Never settles: the reload replaces the document. Resolving or throwing
    // here would flash the error boundary in the moment before navigation.
    return new Promise<{ default: T }>(() => {});
  }
};

export const lazyRoute = <T extends ComponentType<any>>(
  load: ModuleLoader<T>,
): LazyExoticComponent<T> => lazy(() => loadChunk(load));
