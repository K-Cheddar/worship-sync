type BootstrapRecoveryScreenProps = {
  onReload: () => void;
};

const BootstrapRecoveryScreen = ({ onReload }: BootstrapRecoveryScreenProps) => (
  <main
    className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-neutral-950 px-6 text-center text-neutral-100"
    role="alert"
  >
    <h1 className="text-lg font-semibold">WorshipSync couldn’t finish loading.</h1>
    <p className="text-sm text-neutral-300">Check your connection and try again.</p>
    <button
      type="button"
      onClick={onReload}
      className="mt-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300"
    >
      Reload page
    </button>
  </main>
);

export default BootstrapRecoveryScreen;
