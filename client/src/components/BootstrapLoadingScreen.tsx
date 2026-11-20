import {
  BOOTSTRAP_LOADING_MESSAGES,
  RotatingLoadingMessage,
  WorshipSyncLoadingContent,
} from "./LoadingScreenPresentation";

export { WorshipSyncLoadingLogo } from "./LoadingScreenPresentation";

const BootstrapLoadingScreen = () => (
  <main
    className="flex h-dvh min-h-0 w-full flex-col items-center justify-center gap-6 bg-homepage-canvas px-4 text-center text-white"
    aria-busy="true"
  >
    <WorshipSyncLoadingContent>
      <RotatingLoadingMessage messages={BOOTSTRAP_LOADING_MESSAGES} />
    </WorshipSyncLoadingContent>
  </main>
);

export default BootstrapLoadingScreen;
