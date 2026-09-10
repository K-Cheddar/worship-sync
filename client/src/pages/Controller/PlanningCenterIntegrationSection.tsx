import { useEffect, useState } from "react";
import { Info, Unplug } from "lucide-react";
import Button from "../../components/Button/Button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/Popover";
import { useToast } from "../../context/toastContext";
import type { PlanningCenterIntegrationConfig } from "../../types/integrations";
import {
  disconnectPlanningCenter,
  getPlanningCenterConnectStatus,
  startPlanningCenterConnect,
  type PlanningCenterConnectResponse,
} from "../../api/planningCenter";
import { isElectron } from "../../utils/environment";

type Props = {
  churchId: string;
  planningCenter: PlanningCenterIntegrationConfig;
};

const openPlanningCenterAuthorization = async (url: string) => {
  if (isElectron() && window.electronAPI?.openExternalUrl) {
    await window.electronAPI.openExternalUrl(url);
    return;
  }
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) window.location.assign(url);
};

const PlanningCenterIntegrationSection = ({
  churchId,
  planningCenter,
}: Props) => {
  const { showToast } = useToast();
  const [pending, setPending] = useState<PlanningCenterConnectResponse | null>(
    null,
  );
  const [isActing, setIsActing] = useState(false);

  useEffect(() => {
    if (!pending) return;
    let stopped = false;
    const poll = async () => {
      try {
        const result = await getPlanningCenterConnectStatus(churchId, {
          connectRequestId: pending.connectRequestId,
          connectRequestSecret: pending.connectRequestSecret,
        });
        if (stopped || result.status === "pending") return;
        setPending(null);
        if (result.status === "completed") {
          showToast("Planning Center is connected.", "success");
        } else {
          showToast(
            result.errorMessage ||
            "The Planning Center connection did not finish. Try again.",
            "error",
          );
        }
      } catch (error) {
        if (!stopped) {
          setPending(null);
          showToast(
            error instanceof Error
              ? error.message
              : "Could not check the Planning Center connection. Try again.",
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
      const result = await startPlanningCenterConnect(churchId, {
        returnTo: "/account/integrations",
        desktop: isElectron(),
      });
      setPending(result);
      await openPlanningCenterAuthorization(result.authorizeUrl);
    } catch (error) {
      setPending(null);
      showToast(
        error instanceof Error
          ? error.message
          : "Could not start the Planning Center connection. Try again.",
        "error",
      );
    } finally {
      setIsActing(false);
    }
  };

  const disconnect = async () => {
    setIsActing(true);
    try {
      await disconnectPlanningCenter(churchId);
      setPending(null);
      showToast("Planning Center was disconnected.", "success");
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : "Could not disconnect Planning Center. Try again.",
        "error",
      );
    } finally {
      setIsActing(false);
    }
  };

  const isConnected = planningCenter.enabled && planningCenter.connected;

  return (
    <section className="rounded-xl border border-gray-700 bg-gray-950/50 p-3">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 sm:grid-cols-[minmax(7rem,1fr)_minmax(0,1fr)_auto_auto]">
        <h3 className="text-lg font-semibold">Planning Center</h3>
        <dl className="col-span-2 grid grid-cols-2 gap-x-3 text-sm sm:col-span-2 sm:col-start-2 sm:row-start-1 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div>
            <dt className="text-gray-400">Account</dt>
            <dd className="mt-0.5 truncate font-medium text-gray-100">
              {planningCenter.accountLabel || "No account"}
            </dd>
          </div>
          <div>
            <dt className="text-gray-400">Status</dt>
            <dd className="mt-0.5 font-medium text-gray-100">
              {isConnected ? "Connected" : "Not connected"}
            </dd>
          </div>
        </dl>
        <div className="col-start-2 row-start-1 sm:col-start-4">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="none"
                svg={Info}
                iconSize="sm"
                aria-label="Planning Center information"
                className="max-md:min-h-0 p-1 text-gray-300 hover:text-white"
              />
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-[min(24rem,calc(100vw-1rem))] border-gray-700 bg-gray-900 text-gray-100"
            >
              <h4 className="font-semibold">Planning Center</h4>
              <p className="mt-1 text-sm text-gray-400">
                Connect one Planning Center account for this church. Connected
                plans can be imported into a service plan from Teams and Services.
              </p>
              <div className="mt-4 space-y-3">
                {isConnected ? (
                  <Button
                    variant="destructive"
                    svg={Unplug}
                    iconSize="sm"
                    disabled={isActing}
                    isLoading={isActing}
                    onClick={() => void disconnect()}
                  >
                    Disconnect Planning Center
                  </Button>
                ) : (
                  <Button
                    variant="cta"
                    iconSize="sm"
                    disabled={isActing}
                    isLoading={isActing}
                    onClick={() => void connect()}
                  >
                    Connect Planning Center
                  </Button>
                )}
                {pending ? (
                  <p className="text-sm text-cyan-100">
                    Finish the connection in your browser.
                  </p>
                ) : null}
                {planningCenter.lastError ? (
                  <p className="text-sm text-amber-100/90">
                    {planningCenter.lastError}
                  </p>
                ) : null}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </section>
  );
};

export default PlanningCenterIntegrationSection;
