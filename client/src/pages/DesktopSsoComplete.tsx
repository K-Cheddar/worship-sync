import { useMemo } from "react";
import {
  readDesktopSsoCompleteFlashOnce,
  type DesktopSsoCompleteFlashPayload,
} from "../utils/desktopSsoBrowserSession";

const providerLabel = (provider: DesktopSsoCompleteFlashPayload["provider"]) =>
  provider === "google" ? "Google" : "Microsoft";

const DesktopSsoComplete = () => {
  const flash = useMemo(() => readDesktopSsoCompleteFlashOnce(), []);
  const provider = flash?.provider;

  return (
    <main className="relative flex min-h-dvh items-center justify-center bg-homepage-canvas px-4 text-white">
      <div className="w-full max-w-md rounded-2xl border border-gray-500 bg-gray-800 p-6 text-center">
        <h1 className="text-2xl font-semibold">
          {provider ? `Signed in with ${providerLabel(provider)}` : "You are all set"}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-gray-200">
          {provider
            ? "Return to the WorshipSync desktop app. You can close this browser tab."
            : "This confirmation was already used, or you opened this page directly. You can close this browser tab."}
        </p>
      </div>
    </main>
  );
};

export default DesktopSsoComplete;
