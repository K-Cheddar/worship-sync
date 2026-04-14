import Button from "../Button/Button";
import type { ConnectionStatus } from "../../context/controllerInfo";

export function DbStartupConnectionFailedPanel() {
  return (
    <>
      <p className="text-center">Unable to connect to the server</p>
      <p className="text-lg text-gray-300 text-center max-w-md">
        Check your network connection, then reload or try again.
      </p>
      <Button
        onClick={() => window.location.reload()}
        variant="cta"
        padding="px-4 py-2"
      >
        Try Again
      </Button>
    </>
  );
}

export function DbStartupLoadingDetails({
  dbProgress,
  connectionStatus,
}: {
  dbProgress: number;
  connectionStatus?: ConnectionStatus;
}) {
  const status = connectionStatus?.status ?? "unknown";
  const retries =
    connectionStatus?.retryCount !== undefined
      ? String(connectionStatus.retryCount)
      : "—";

  return (
    <details className="w-full max-w-md text-left text-base">
      <summary className="cursor-pointer text-gray-300 hover:text-white select-none list-none [&::-webkit-details-marker]:hidden">
        <span className="underline-offset-2 hover:underline">Show details</span>
      </summary>
      <div className="mt-2 space-y-1 rounded border border-gray-600 bg-black/20 px-3 py-2 text-sm text-gray-200">
        <p>
          Progress:{" "}
          <span className="text-orange-500" data-testid="startup-details-progress">
            {dbProgress}%
          </span>
        </p>
        <p data-testid="startup-details-connection">
          Connection:{" "}
          <span className="font-mono">
            {status} (retries: {retries})
          </span>
        </p>
      </div>
    </details>
  );
}

export function DbStartupStuckRecoveryPanel({
  dbProgress,
  connectionStatus,
}: {
  dbProgress: number;
  connectionStatus?: ConnectionStatus;
}) {
  return (
    <>
      <p className="max-w-lg px-4 text-center">
        Startup is taking longer than expected.
      </p>
      <p className="text-lg text-gray-300 text-center max-w-md px-4">
        Sync is still running in the background. If nothing changes, you can try
        reloading the page.
      </p>
      <Button
        onClick={() => window.location.reload()}
        variant="cta"
        padding="px-4 py-2"
      >
        Try Again
      </Button>
      <DbStartupLoadingDetails
        dbProgress={dbProgress}
        connectionStatus={connectionStatus}
      />
    </>
  );
}
