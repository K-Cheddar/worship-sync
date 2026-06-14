import { Ban, Eye, EyeOff } from "lucide-react";
import Button from "../../../components/Button/Button";
import {
  DisplayPairingForm,
  RecoveryEmailForm,
  WorkstationPairingForm,
} from "../../Controller/AccountFormSections";
import { useAccountPage } from "../AccountPageContext";
import { AccountSetupPageSkeleton } from "../accountPageSkeletons";
import {
  formatLastSeenLabel,
  formatSurfaceTypeLabel,
  formatTrustedDeviceTitle,
  getTrustedDeviceOwnerLabel,
} from "../accountUtils";
import { cn } from "@/utils/cnHelper";
import { alternatingAdminListRowBg } from "../../../utils/listRowStripes";
import { getPlatformDisplayLabel } from "../../../utils/deviceInfo";

const AccountSetupPage = () => {
  const accountPage = useAccountPage();
  const {
    churchId,
    context,
    loading,
    refresh,
    workstations,
    displayDevices,
    trustedDevices,
    visibleWorkstations,
    visibleDisplayDevices,
    visibleTrustedDevices,
    workstationPairingResetSignal,
    displayPairingResetSignal,
    showRevokedWorkstations,
    showRevokedDisplays,
    showRevokedDevices,
    destructiveConfirm,
    destructiveConfirmRunning,
    setShowRevokedWorkstations,
    setShowRevokedDisplays,
    setShowRevokedDevices,
    setWorkstationPairingResetSignal,
    setDisplayPairingResetSignal,
    setDestructiveConfirm,
  } = accountPage;

  if (loading) {
    return <AccountSetupPageSkeleton />;
  }

  return (
    <>
      <section className="rounded-xl border border-gray-700 bg-gray-950/50 p-4">
        <h3 className="text-lg font-semibold">Shared workstations</h3>
        <p className="mt-1 text-sm text-gray-400">
          For shared computers when no one is signed in personally.
        </p>
        <WorkstationPairingForm
          churchId={churchId}
          formsResetSignal={workstationPairingResetSignal}
          onGenerated={async () => {
            setDisplayPairingResetSignal((n) => n + 1);
            await refresh();
          }}
        />
        <div className="mt-6 space-y-2 border-t border-gray-700/60 pt-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Connected workstations
            </p>
            <Button
              variant="tertiary"
              svg={showRevokedWorkstations ? EyeOff : Eye}
              iconSize="sm"
              className="shrink-0 self-start sm:self-auto"
              onClick={() => setShowRevokedWorkstations((current) => !current)}
            >
              {showRevokedWorkstations
                ? "Hide revoked workstations"
                : "Show revoked workstations"}
            </Button>
          </div>
          {workstations.length === 0 && (
            <p className="text-sm text-gray-300">No shared workstations yet.</p>
          )}
          {workstations.length > 0 && visibleWorkstations.length === 0 && (
            <p className="text-sm text-gray-300">No workstations match this filter.</p>
          )}
          {visibleWorkstations.map((workstation, workstationIndex) => {
            const isThisRevokeLoading =
              destructiveConfirmRunning &&
              destructiveConfirm?.kind === "revokeWorkstation" &&
              destructiveConfirm.device.deviceId === workstation.deviceId;
            return (
              <div
                key={workstation.deviceId}
                className={cn(
                  "flex items-start justify-between gap-3 rounded-lg px-3 py-3 sm:items-center",
                  alternatingAdminListRowBg(workstationIndex),
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{workstation.label}</p>
                  <p className="text-sm text-gray-300">
                    {workstation.appAccess}
                    {workstation.lastOperatorName
                      ? ` | ${workstation.lastOperatorName}`
                      : ""}
                    {workstation.revokedAt ? " | revoked" : ""}
                  </p>
                </div>
                {!workstation.revokedAt && (
                  <Button
                    variant="destructive"
                    svg={Ban}
                    iconSize="sm"
                    className="shrink-0 self-start sm:self-auto"
                    isLoading={isThisRevokeLoading}
                    disabled={destructiveConfirmRunning}
                    onClick={() =>
                      setDestructiveConfirm({
                        kind: "revokeWorkstation",
                        device: workstation,
                      })
                    }
                  >
                    Revoke
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-xl border border-gray-700 bg-gray-950/50 p-4">
        <h3 className="text-lg font-semibold">Display screens</h3>
        <p className="mt-1 text-sm text-gray-400">
          Projector and other outputs you link without a personal sign-in.
        </p>
        <DisplayPairingForm
          churchId={churchId}
          formsResetSignal={displayPairingResetSignal}
          onGenerated={async () => {
            setWorkstationPairingResetSignal((n) => n + 1);
            await refresh();
          }}
        />
        <div className="mt-6 space-y-2 border-t border-gray-700/60 pt-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Connected displays
            </p>
            <Button
              variant="tertiary"
              svg={showRevokedDisplays ? EyeOff : Eye}
              iconSize="sm"
              className="shrink-0 self-start sm:self-auto"
              onClick={() => setShowRevokedDisplays((current) => !current)}
            >
              {showRevokedDisplays
                ? "Hide revoked displays"
                : "Show revoked displays"}
            </Button>
          </div>
          {displayDevices.length === 0 && (
            <p className="text-sm text-gray-300">No display screens yet.</p>
          )}
          {displayDevices.length > 0 && visibleDisplayDevices.length === 0 && (
            <p className="text-sm text-gray-300">No displays match this filter.</p>
          )}
          {visibleDisplayDevices.map((display, displayIndex) => {
            const isThisRevokeLoading =
              destructiveConfirmRunning &&
              destructiveConfirm?.kind === "revokeDisplay" &&
              destructiveConfirm.device.deviceId === display.deviceId;
            return (
              <div
                key={display.deviceId}
                className={cn(
                  "flex items-start justify-between gap-3 rounded-lg px-3 py-3 sm:items-center",
                  alternatingAdminListRowBg(displayIndex),
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{display.label}</p>
                  <p className="text-sm text-gray-300">
                    {formatSurfaceTypeLabel(display.surfaceType)}
                    {display.revokedAt ? " | revoked" : ""}
                  </p>
                </div>
                {!display.revokedAt && (
                  <Button
                    variant="destructive"
                    svg={Ban}
                    iconSize="sm"
                    className="shrink-0 self-start sm:self-auto"
                    isLoading={isThisRevokeLoading}
                    disabled={destructiveConfirmRunning}
                    onClick={() =>
                      setDestructiveConfirm({
                        kind: "revokeDisplay",
                        device: display,
                      })
                    }
                  >
                    Revoke
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-xl border border-gray-700 bg-gray-950/50 p-4">
        <h3 className="text-lg font-semibold">Trusted devices</h3>
        <p className="mt-1 text-sm text-gray-400">
          Trusted sign-in devices across this church. Admins can revoke access
          when needed.
        </p>
        <div className="mt-4 flex justify-end">
          <Button
            variant="tertiary"
            svg={showRevokedDevices ? EyeOff : Eye}
            iconSize="sm"
            onClick={() => setShowRevokedDevices((current) => !current)}
          >
            {showRevokedDevices ? "Hide revoked devices" : "Show revoked devices"}
          </Button>
        </div>
        <div className="mt-4 space-y-2">
          {visibleTrustedDevices.length === 0 && (
            <p className="text-sm text-gray-300">
              {trustedDevices.length === 0
                ? "No trusted devices yet."
                : "No devices match this filter."}
            </p>
          )}
          {visibleTrustedDevices.map((device, trustedIndex) => {
            const isThisRevokeLoading =
              destructiveConfirmRunning &&
              destructiveConfirm?.kind === "revokeTrusted" &&
              destructiveConfirm.device.deviceId === device.deviceId;
            return (
              <div
                key={device.deviceId}
                className={cn(
                  "flex items-start justify-between gap-3 rounded-lg px-3 py-3 sm:items-center",
                  alternatingAdminListRowBg(trustedIndex),
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{formatTrustedDeviceTitle(device)}</p>
                  <p className="text-sm text-gray-300">
                    {getTrustedDeviceOwnerLabel(device)} |{" "}
                    {getPlatformDisplayLabel(device.platformType)}
                    {device.revokedAt ? " | revoked" : ""}
                  </p>
                  <p className="text-sm text-gray-400">
                    {formatLastSeenLabel(device.lastSeenAt)}
                  </p>
                </div>
                {!device.revokedAt && (
                  <Button
                    variant="destructive"
                    svg={Ban}
                    iconSize="sm"
                    className="shrink-0 self-start sm:self-auto"
                    isLoading={isThisRevokeLoading}
                    disabled={destructiveConfirmRunning}
                    onClick={() =>
                      setDestructiveConfirm({
                        kind: "revokeTrusted",
                        device,
                      })
                    }
                  >
                    Revoke
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-xl border border-gray-700 bg-gray-950/50 p-4">
        <h3 className="text-lg font-semibold">Recovery email</h3>
        <p className="mt-1 text-sm text-gray-400">
          We send admin recovery requests here.
        </p>
        <RecoveryEmailForm
          churchId={churchId}
          recoveryEmailFromContext={context?.recoveryEmail}
        />
      </section>
    </>
  );
};

export default AccountSetupPage;
