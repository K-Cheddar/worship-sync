import { useEffect, useState } from "react";
import { Unplug } from "lucide-react";
import Button from "../../components/Button/Button";
import { useToast } from "../../context/toastContext";
import type { CanvaIntegrationConfig } from "../../types/integrations";
import {
  disconnectCanva,
  getCanvaConnectStatus,
  startCanvaConnect,
  type CanvaConnectResponse,
} from "../../api/canva";
import { isElectron } from "../../utils/environment";

type Props = {
  churchId: string;
  canva: CanvaIntegrationConfig;
};

const openCanvaAuthorization = async (url: string) => {
  if (isElectron() && window.electronAPI?.openExternalUrl) {
    await window.electronAPI.openExternalUrl(url);
    return;
  }
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) window.location.assign(url);
};

const CanvaIntegrationSection = ({ churchId, canva }: Props) => {
  const { showToast } = useToast();
  const [pending, setPending] = useState<CanvaConnectResponse | null>(null);
  const [isActing, setIsActing] = useState(false);

  useEffect(() => {
    if (!pending) return;
    let stopped = false;
    const poll = async () => {
      try {
        const result = await getCanvaConnectStatus(churchId, {
          connectRequestId: pending.connectRequestId,
          connectRequestSecret: pending.connectRequestSecret,
        });
        if (stopped || result.status === "pending") return;
        setPending(null);
        if (result.status === "completed") {
          showToast("Canva is connected.", "success");
        } else {
          showToast(
            result.errorMessage || "The Canva connection did not finish. Try again.",
            "error",
          );
        }
      } catch (error) {
        if (!stopped) {
          setPending(null);
          showToast(
            error instanceof Error
              ? error.message
              : "Could not check the Canva connection. Try again.",
            "error",
          );
        }
      }
    };
    void poll();
    const timer = window.setInterval(
      () => void poll(),
      Math.max(1000, pending.pollIntervalMs || 1500),
    );
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [churchId, pending, showToast]);

  const connect = async () => {
    setIsActing(true);
    try {
      const result = await startCanvaConnect(churchId, {
        returnTo: "/account/integrations",
        desktop: isElectron(),
      });
      setPending(result);
      await openCanvaAuthorization(result.authorizeUrl);
    } catch (error) {
      setPending(null);
      showToast(
        error instanceof Error
          ? error.message
          : "Could not start the Canva connection. Try again.",
        "error",
      );
    } finally {
      setIsActing(false);
    }
  };

  const disconnect = async () => {
    setIsActing(true);
    try {
      await disconnectCanva(churchId);
      setPending(null);
      showToast("Canva was disconnected.", "success");
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : "Could not disconnect Canva. Try again.",
        "error",
      );
    } finally {
      setIsActing(false);
    }
  };

  const isConnected = canva.enabled && canva.connected;

  return (
    <section className="rounded-xl border border-gray-700 bg-gray-950/50 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold">Canva</h3>
          <p className="mt-1 max-w-2xl text-sm text-gray-400">
            Connect a church-owned Canva account so your team can import designs
            into the Media library. Imported files are saved in WorshipSync.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isConnected ? (
            <Button
              variant="destructive"
              svg={Unplug}
              iconSize="sm"
              disabled={isActing}
              isLoading={isActing}
              onClick={() => void disconnect()}
            >
              Disconnect Canva
            </Button>
          ) : (
            <Button
              variant="cta"
              iconSize="sm"
              disabled={isActing}
              isLoading={isActing}
              onClick={() => void connect()}
            >
              Connect Canva
            </Button>
          )}
        </div>
      </div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-gray-400">Status</dt>
          <dd className="mt-0.5 font-medium text-gray-100">
            {isConnected ? "Connected" : "Not connected"}
          </dd>
        </div>
        <div>
          <dt className="text-gray-400">Account</dt>
          <dd className="mt-0.5 font-medium text-gray-100">
            {canva.accountLabel || "No Canva account connected"}
          </dd>
        </div>
      </dl>
      {pending ? (
        <div className="mt-3 rounded-lg border border-cyan-800/70 bg-cyan-950/30 p-3">
          <p className="text-sm font-medium text-cyan-100">
            Finish the Canva connection in your browser.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => void openCanvaAuthorization(pending.authorizeUrl)}
            >
              Reopen browser
            </Button>
            <Button variant="tertiary" onClick={() => setPending(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      {canva.lastImportedAt ? (
        <p className="mt-2 text-xs text-gray-400">
          Last import {new Date(canva.lastImportedAt).toLocaleString()}.
        </p>
      ) : null}
      {canva.lastError ? (
        <p className="mt-3 text-sm text-amber-100/90">{canva.lastError}</p>
      ) : null}
    </section>
  );
};

export default CanvaIntegrationSection;
