import Button from "../components/Button/Button";
import { GoogleMark, MicrosoftMark } from "../components/AuthProviderMarks";
import type { DesktopAuthProvider } from "../api/authTypes";

export type HostedDesktopBrowserFlowStatus = "idle" | "loading";

type HostedDesktopBrowserLoginProps = {
  provider: DesktopAuthProvider;
  flowStatus: HostedDesktopBrowserFlowStatus;
  isAuthServerOnline: boolean;
  onContinueWithProvider: () => void;
};

const providerLabel = (provider: DesktopAuthProvider) =>
  provider === "google" ? "Google" : "Microsoft";

const HostedDesktopBrowserLogin = ({
  provider,
  flowStatus,
  isAuthServerOnline,
  onContinueWithProvider,
}: HostedDesktopBrowserLoginProps) => {
  const isLoading = flowStatus === "loading";
  const primaryLabel = `Continue with ${providerLabel(provider)}`;

  return (
    <div className="mt-4 rounded-xl border border-gray-600 bg-white/5 p-4">
      <Button
        type="button"
        variant="primary"
        svg={provider === "google" ? GoogleMark : MicrosoftMark}
        iconSize="sm"
        gap="gap-2"
        className="w-full justify-center"
        disabled={!isAuthServerOnline || isLoading}
        isLoading={isLoading}
        onClick={onContinueWithProvider}
      >
        {primaryLabel}
      </Button>
    </div>
  );
};

export default HostedDesktopBrowserLogin;
