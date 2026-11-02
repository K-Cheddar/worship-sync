import { useEffect, useState, type CSSProperties } from "react";
import WorshipSyncIcon from "../assets/WorshipSyncIconNoBg.png";

const MESSAGE_ROTATION_INTERVAL_MS = 4500;
const LOGO_REVEAL_DURATION_MS = 1500;
const LOGO_SWEEP_INTERVAL_MS = 3000;
const LOADING_MESSAGES = [
  "Preparing your workspace…",
  "Getting everything in place…",
  "Making sure everything is ready…",
];

// Keep the rotation and logo animation in phase when the entry screen hands
// off to the app's bootstrap or route fallback component.
let loadingStartedAt: number | undefined;

const getLoadingStartedAt = () => {
  loadingStartedAt ??= Date.now();
  return loadingStartedAt;
};

const getElapsedLoadingTime = () =>
  Math.max(0, Date.now() - getLoadingStartedAt());

const getCurrentMessageIndex = () =>
  Math.floor(getElapsedLoadingTime() / MESSAGE_ROTATION_INTERVAL_MS) %
  LOADING_MESSAGES.length;

export const WorshipSyncLoadingLogo = ({
  alt = "WorshipSync",
}: {
  alt?: string;
}) => {
  const [animationStyles] = useState(() => {
    const elapsed = getElapsedLoadingTime();
    return {
      "--loading-logo-reveal-delay": `-${Math.min(elapsed, LOGO_REVEAL_DURATION_MS)}ms`,
      "--loading-logo-sweep-delay": `-${elapsed % LOGO_SWEEP_INTERVAL_MS}ms`,
      "--loading-logo-mask": `url("${WorshipSyncIcon}")`,
    } as CSSProperties;
  });

  return (
    <span
      className="loading-logo relative block h-28 w-28 shrink-0"
      data-testid="loading-logo"
      style={animationStyles}
    >
      <img
        src={WorshipSyncIcon}
        alt={alt}
        className="loading-logo__image absolute inset-0 h-full w-full"
        width={112}
        height={112}
        loading="eager"
      />
      <span
        aria-hidden="true"
        className="loading-logo__reveal-edge pointer-events-none absolute inset-0"
      />
      <span
        aria-hidden="true"
        className="loading-logo__sweep pointer-events-none absolute inset-0"
      />
    </span>
  );
};

const BootstrapLoadingScreen = () => {
  const [messageIndex, setMessageIndex] = useState(getCurrentMessageIndex);

  useEffect(() => {
    const elapsed = getElapsedLoadingTime();
    const firstTickDelay =
      MESSAGE_ROTATION_INTERVAL_MS - (elapsed % MESSAGE_ROTATION_INTERVAL_MS);
    let intervalId: number | undefined;
    const timeoutId = window.setTimeout(() => {
      setMessageIndex(getCurrentMessageIndex());
      intervalId = window.setInterval(
        () => setMessageIndex(getCurrentMessageIndex()),
        MESSAGE_ROTATION_INTERVAL_MS,
      );
    }, firstTickDelay);

    return () => {
      window.clearTimeout(timeoutId);
      if (intervalId !== undefined) window.clearInterval(intervalId);
    };
  }, []);

  return (
    <main
      className="flex h-dvh min-h-0 w-full flex-col items-center justify-center gap-6 bg-homepage-canvas px-4 text-center text-white"
      aria-busy="true"
    >
      <WorshipSyncLoadingLogo />
      <div className="flex min-h-12 w-full max-w-sm flex-col justify-center gap-1">
        <p className="text-base font-semibold">Getting WorshipSync ready</p>
        <p
          className="text-sm leading-5 text-gray-200"
          aria-live="polite"
          aria-atomic="true"
        >
          {LOADING_MESSAGES[messageIndex]}
        </p>
      </div>
    </main>
  );
};

export default BootstrapLoadingScreen;
