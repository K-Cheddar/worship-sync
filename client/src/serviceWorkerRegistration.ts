// This optional code is used to register a service worker.
// register() is not called by default.

// This lets the app load faster on subsequent visits in production, and gives
// it offline capabilities. However, it also means that developers (and users)
// will only see deployed updates on subsequent visits to a page, after all the
// existing tabs open on the page have been closed, since previously cached
// resources are updated in the background.

// To learn more about the benefits of this model and instructions on how to
// opt-in, read https://cra.link/PWA

import { isElectron } from "./utils/environment";

const frontEndHost = import.meta.env.DEV
  ? "local.worshipsync.net"
  : "localhost";

const isLocalhost = Boolean(
  window.location.hostname === frontEndHost ||
  // [::1] is the IPv6 localhost address.
  window.location.hostname === "[::1]" ||
  // 127.0.0.0/8 are considered localhost for IPv4.
  window.location.hostname.match(
    /^127(?:\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}$/,
  ),
);

type Config = {
  onSuccess?: (registration: ServiceWorkerRegistration) => void;
  onUpdate?: (registration: ServiceWorkerRegistration) => void;
};

export type UpdateCheckResult =
  | "updated"
  | "upToDate"
  | "restartRequired"
  | "unavailable";

export function reloadPage() {
  window.location.reload();
}

export function register(config?: Config) {
  // Don't register service worker in Electron
  if (isElectron()) {
    return;
  }

  if ("serviceWorker" in navigator) {
    // The URL constructor is available in all browsers that support SW.
    // Use BASE_URL from Vite, which defaults to '/' for root path
    const baseUrl = import.meta.env.BASE_URL || "";
    const publicUrl = new URL(baseUrl, window.location.href);
    if (publicUrl.origin !== window.location.origin) {
      // Our service worker won't work if BASE_URL is on a different origin
      // from what our page is served on. This might happen if a CDN is used to
      // serve assets; see https://github.com/facebook/create-react-app/issues/2374
      return;
    }

    window.addEventListener("load", () => {
      const swUrl = `${baseUrl}service-worker.js`;

      if (isLocalhost) {
        // This is running on localhost. Let's check if a service worker still exists or not.
        checkValidServiceWorker(swUrl, config);

        // Add some additional logging to localhost, pointing developers to the
        // service worker/PWA documentation.
        navigator.serviceWorker.ready.then(() => {
          console.log(
            "This web app is being served cache-first by a service " +
              "worker. To learn more, visit https://cra.link/PWA",
          );
        });
      } else {
        // Is not localhost. Just register service worker
        registerValidSW(swUrl, config, false);
      }
    });
  }
}

const SW_CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const VERSION_POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Polls /api/version and triggers an immediate SW update check when the
 * server version changes (i.e. a new deploy happened). Much faster than
 * waiting for the periodic SW check interval.
 */
function startVersionPolling(registration: ServiceWorkerRegistration) {
  let knownVersion: string | null = null;

  const check = async () => {
    try {
      const res = await fetch("/api/version", { cache: "no-store" });
      if (!res.ok) return;
      const { version } = await res.json();
      if (knownVersion === null) {
        knownVersion = version;
      } else if (version !== knownVersion) {
        knownVersion = version;
        // Server version changed — trigger immediate SW update check
        registration.update();
      }
    } catch {
      // Network error — skip this cycle
    }
  };

  check();
  setInterval(check, VERSION_POLL_INTERVAL_MS);
}

function registerValidSW(
  swUrl: string,
  config?: Config,
  isLocalhostEnv?: boolean,
) {
  navigator.serviceWorker
    .register(swUrl, { updateViaCache: "none" })
    .then((registration) => {
      // Periodically check for new service worker while app is open (skip on localhost)
      if (!isLocalhostEnv) {
        setInterval(() => registration.update(), SW_CHECK_INTERVAL_MS);
        startVersionPolling(registration);
      }
      registration.onupdatefound = () => {
        const installingWorker = registration.installing;
        if (installingWorker == null) {
          return;
        }
        installingWorker.onstatechange = () => {
          if (installingWorker.state === "installed") {
            if (navigator.serviceWorker.controller) {
              // New service worker installed (our SW calls skipWaiting(), so it
              // will activate soon). onUpdate lets the app reload once the new
              // SW takes control so the page runs the new code.
              if (config && config.onUpdate) {
                config.onUpdate(registration);
              }
            } else {
              // At this point, everything has been precached.
              // It's the perfect time to display a
              // "Content is cached for offline use." message.
              console.log("Content is cached for offline use.");

              // Execute callback
              if (config && config.onSuccess) {
                config.onSuccess(registration);
              }
            }
          }
        };
      };
    })
    .catch((error) => {
      console.error("Error during service worker registration:", error);
    });
}

function checkValidServiceWorker(swUrl: string, config?: Config) {
  // Check if the service worker can be found. If it can't reload the page.
  fetch(swUrl, {
    headers: { "Service-Worker": "script" },
  })
    .then((response) => {
      // Ensure service worker exists, and that we really are getting a JS file.
      const contentType = response.headers.get("content-type");
      if (
        response.status === 404 ||
        (contentType != null && contentType.indexOf("javascript") === -1)
      ) {
        // No service worker found. Probably a different app. Reload the page.
        navigator.serviceWorker.ready.then((registration) => {
          registration.unregister().then(() => {
            window.location.reload();
          });
        });
      } else {
        // Service worker found. Proceed as normal.
        registerValidSW(swUrl, config, true);
      }
    })
    .catch(() => {
      console.log(
        "No internet connection found. App is running in offline mode.",
      );
    });
}

/**
 * Trigger an immediate service worker update check (instead of waiting for the
 * periodic interval). If a new version is found, the SW installs and the app's
 * onUpdate callback in main.tsx will reload the page. Call this when the user
 * explicitly asks to get the latest version (e.g. "Get latest version" button).
 */
const UPDATE_ACTIVATION_TIMEOUT_MS = 8000;

function waitForControllerChange(
  timeoutMs: number,
  onActivated?: () => void,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        handleControllerChange,
      );
    };

    const settle = (value: boolean) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const handleControllerChange = () => {
      onActivated?.();
      settle(true);
    };

    const timeoutId = window.setTimeout(() => settle(false), timeoutMs);

    navigator.serviceWorker.addEventListener(
      "controllerchange",
      handleControllerChange,
    );
  });
}

function promptWaitingWorker(
  registration: ServiceWorkerRegistration,
): boolean {
  if (!registration.waiting) {
    return false;
  }

  registration.waiting.postMessage({ type: "SKIP_WAITING" });
  return true;
}

/**
 * Trigger an immediate service worker update check (instead of waiting for the
 * periodic interval). If a new version is found, the SW installs and activates
 * right away, then the app reloads once the updated worker takes control.
 */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  if (!("serviceWorker" in navigator)) return "unavailable";
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return "unavailable";

  const activationPromise = waitForControllerChange(
    UPDATE_ACTIVATION_TIMEOUT_MS,
    () => {
      reloadPage();
    },
  );

  if (promptWaitingWorker(registration)) {
    return (await activationPromise) ? "updated" : "restartRequired";
  }

  let sawUpdateCandidate = Boolean(registration.installing);
  let installResolved = false;

  const installPromise = new Promise<boolean>((resolve) => {
    let updateFoundHandler: (() => void) | null = null;

    const finish = (result: boolean) => {
      if (installResolved) {
        return;
      }
      installResolved = true;
      if (updateFoundHandler) {
        registration.removeEventListener("updatefound", updateFoundHandler);
      }
      resolve(result);
    };

    const watchInstallingWorker = (worker: ServiceWorker | null) => {
      if (!worker || installResolved) {
        return;
      }

      sawUpdateCandidate = true;

      const handleStateChange = () => {
        if (
          worker.state === "installed" ||
          worker.state === "activating" ||
          worker.state === "activated"
        ) {
          promptWaitingWorker(registration);
          worker.removeEventListener("statechange", handleStateChange);
          finish(true);
          return;
        }

        if (worker.state === "redundant") {
          worker.removeEventListener("statechange", handleStateChange);
          finish(false);
        }
      };

      worker.addEventListener("statechange", handleStateChange);
      handleStateChange();
    };

    const handleUpdateFound = () => {
      watchInstallingWorker(registration.installing);
    };

    updateFoundHandler = handleUpdateFound;
    registration.addEventListener("updatefound", handleUpdateFound);
    watchInstallingWorker(registration.installing);

    window.setTimeout(() => {
      finish(false);
    }, 1500);
  });

  await registration.update();

  if (promptWaitingWorker(registration)) {
    return (await activationPromise) ? "updated" : "restartRequired";
  }

  const installDetected = await installPromise;
  if (!sawUpdateCandidate && !installDetected) {
    return "upToDate";
  }

  return (await activationPromise) ? "updated" : "restartRequired";
}

export function unregister() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.ready
      .then((registration) => {
        registration.unregister();
      })
      .catch((error) => {
        console.error(error.message);
      });
  }
}
