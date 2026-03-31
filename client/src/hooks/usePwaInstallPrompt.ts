import { useCallback, useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * Survives SPA route changes: Chromium fires `beforeinstallprompt` at most once per
 * page load; if we only kept the event in component state, leaving Home would drop it
 * and the option would not return when navigating back without a full reload.
 */
let cachedBeforeInstallPrompt: BeforeInstallPromptEvent | null = null;

const isStandaloneDisplayMode = (): boolean => {
  if (typeof window === "undefined") return false;
  if (typeof window.matchMedia === "function") {
    if (window.matchMedia("(display-mode: standalone)").matches) {
      return true;
    }
  }
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
};

/** Safari < 14 use addListener/removeListener; modern browsers use addEventListener. */
const subscribeMediaQueryChange = (
  mq: MediaQueryList,
  onChange: () => void
): (() => void) => {
  if (typeof mq.addEventListener === "function") {
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }
  if (typeof mq.addListener === "function") {
    mq.addListener(onChange);
    return () => mq.removeListener(onChange);
  }
  return () => {};
};

/**
 * Captures Chromium's beforeinstallprompt for adding the site as an installed PWA.
 * iOS Safari does not fire this event; users add to the home screen from the share menu.
 */
export const usePwaInstallPrompt = () => {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(
      () => cachedBeforeInstallPrompt,
    );
  const [isStandalone, setIsStandalone] = useState(isStandaloneDisplayMode);

  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      const event = e as BeforeInstallPromptEvent;
      cachedBeforeInstallPrompt = event;
      setDeferredPrompt(event);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    if (cachedBeforeInstallPrompt) {
      setDeferredPrompt(cachedBeforeInstallPrompt);
    }
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(display-mode: standalone)");
    const onChange = () => setIsStandalone(isStandaloneDisplayMode());
    return subscribeMediaQueryChange(mq, onChange);
  }, []);

  const installPwa = useCallback(async () => {
    const prompt = cachedBeforeInstallPrompt;
    if (!prompt) return;
    await prompt.prompt();
    await prompt.userChoice;
    cachedBeforeInstallPrompt = null;
    setDeferredPrompt(null);
  }, []);

  const canShowInstall = !isStandalone && deferredPrompt !== null;

  return { canShowInstall, installPwa };
};
