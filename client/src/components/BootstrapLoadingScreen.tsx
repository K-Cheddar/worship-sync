import WorshipSyncIcon from "../assets/WorshipSyncIconNoBg.png";

const BootstrapLoadingScreen = () => (
  <main
    className="flex h-dvh min-h-0 w-full flex-col items-center justify-center gap-6 bg-homepage-canvas px-4 text-center text-white"
    aria-busy="true"
  >
    <img
      src={WorshipSyncIcon}
      alt="WorshipSync"
      className="h-28 w-28 animate-pulse"
      width={112}
      height={112}
      loading="eager"
    />
    <span className="text-sm text-gray-200">Loading…</span>
  </main>
);

export default BootstrapLoadingScreen;
