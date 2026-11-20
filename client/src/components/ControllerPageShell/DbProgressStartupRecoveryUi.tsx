import Button from "../Button/Button";
import type { ConnectionStatus } from "../../context/controllerInfo";

export function DbStartupConnectionFailedPanel({
  message,
}: {
  message?: string;
}) {
  return (
    <div className="flex w-full flex-col items-center gap-3">
      <div role="alert" className="space-y-1 text-center">
        <p className="text-base font-semibold">
          Unable to connect to the server
        </p>
        <p className="text-sm leading-5 text-gray-300">
          {message || "Check your network connection, then try again."}
        </p>
      </div>
      <Button
        onClick={() => window.location.reload()}
        variant="cta"
        padding="px-4 py-2"
      >
        Try Again
      </Button>
    </div>
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
      <summary
        data-testid="startup-details-summary"
        className="cursor-pointer text-gray-300 hover:text-white select-none list-none [&::-webkit-details-marker]:hidden"
      >
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
    <div className="flex w-full flex-col items-center gap-3">
      <p
        role="status"
        aria-live="polite"
        className="max-w-lg text-center text-sm font-semibold"
      >
        Startup is taking longer than expected.
      </p>
      <p className="max-w-sm text-center text-sm leading-5 text-gray-300">
        Database progress has not changed recently. You can retry startup or
        review the details below.
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
    </div>
  );
}
