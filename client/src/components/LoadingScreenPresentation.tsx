import {
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type PropsWithChildren,
} from "react";
import WorshipSyncIcon from "../assets/WorshipSyncIconNoBg.png";

const MESSAGE_ROTATION_INTERVAL_MS = 4500;

export const BOOTSTRAP_LOADING_MESSAGES = [
  "Preparing your workspace…",
  "Getting everything in place…",
  "Making sure everything is ready…",
] as const;

const LOGO_REVEAL_DURATION_MS = 1500;
const LOGO_SWEEP_INTERVAL_MS = 3000;

let loadingStartedAt: number | undefined;

const getLoadingElapsedTime = () => {
  loadingStartedAt ??= Date.now();
  return Math.max(0, Date.now() - loadingStartedAt);
};

const getLoadingMessagePhase = () =>
  Math.floor(getLoadingElapsedTime() / MESSAGE_ROTATION_INTERVAL_MS);

const messageSubscribers = new Set<() => void>();
let firstTickTimeout: number | undefined;
let messageInterval: number | undefined;

const notifyMessageSubscribers = () => {
  messageSubscribers.forEach((subscriber) => subscriber());
};

const startMessageClock = () => {
  const elapsed = getLoadingElapsedTime();
  const firstTickDelay =
    MESSAGE_ROTATION_INTERVAL_MS - (elapsed % MESSAGE_ROTATION_INTERVAL_MS);

  firstTickTimeout = window.setTimeout(() => {
    firstTickTimeout = undefined;
    notifyMessageSubscribers();
    messageInterval = window.setInterval(
      notifyMessageSubscribers,
      MESSAGE_ROTATION_INTERVAL_MS,
    );
  }, firstTickDelay);
};

const stopMessageClock = () => {
  if (firstTickTimeout !== undefined) {
    window.clearTimeout(firstTickTimeout);
    firstTickTimeout = undefined;
  }
  if (messageInterval !== undefined) {
    window.clearInterval(messageInterval);
    messageInterval = undefined;
  }
};

const subscribeToMessageClock = (subscriber: () => void) => {
  messageSubscribers.add(subscriber);
  if (messageSubscribers.size === 1) startMessageClock();

  return () => {
    messageSubscribers.delete(subscriber);
    if (messageSubscribers.size === 0) stopMessageClock();
  };
};

export function RotatingLoadingMessage({
  messages = BOOTSTRAP_LOADING_MESSAGES,
}: {
  messages?: readonly [string, ...string[]];
}) {
  const phase = useSyncExternalStore(
    subscribeToMessageClock,
    getLoadingMessagePhase,
    getLoadingMessagePhase,
  );

  return (
    <p
      className="text-sm leading-5 text-gray-200"
      aria-live="polite"
      aria-atomic="true"
    >
      {messages[phase % messages.length]}
    </p>
  );
}

export function WorshipSyncLoadingLogo({
  alt = "WorshipSync",
}: {
  alt?: string;
}) {
  const [animationStyles] = useState(() => {
    const elapsed = getLoadingElapsedTime();
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
}

export function WorshipSyncLoadingContent({ children }: PropsWithChildren) {
  return (
    <>
      <WorshipSyncLoadingLogo />
      <div className="flex min-h-12 w-full max-w-sm flex-col items-center justify-center gap-1 text-center">
        <h1 className="text-base font-semibold">Getting WorshipSync ready</h1>
        {children}
      </div>
    </>
  );
}
