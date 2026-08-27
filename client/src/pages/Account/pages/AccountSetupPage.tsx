import { Ban, Eye, EyeOff, Info } from "lucide-react";
import Button from "../../../components/Button/Button";
import PopOver from "../../../components/PopOver/PopOver";
import {
  DisplayPairingForm,
  RecoveryEmailForm,
  WorkstationPairingForm,
} from "../../Controller/AccountFormSections";
import { useAccountPage } from "../AccountPageContext";
import { AccountSetupPageSkeleton } from "../accountPageSkeletons";
import {
  formatSurfaceTypeLabel,
  formatTrustedDeviceTitle,
  getTrustedDeviceOwnerLabel,
} from "../accountUtils";
import { cn } from "@/utils/cnHelper";
import { alternatingAdminListRowBg } from "../../../utils/listRowStripes";
import { getPlatformDisplayLabel } from "../../../utils/deviceInfo";

type DeviceDetail = {
  label: string;
  value: string;
};

const deviceTableHeaderClassName =
  "grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-2 px-2 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-gray-500 sm:grid-cols-[minmax(12rem,auto)_minmax(8rem,auto)_auto_minmax(2rem,1fr)_auto]";

const deviceTableRowClassName =
  "grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-2 gap-y-0 px-2 py-1.5 sm:grid-cols-[minmax(12rem,auto)_minmax(8rem,auto)_auto_minmax(2rem,1fr)_auto]";

const formatDeviceDate = (value?: string | null) => {
  if (!value) return "Unknown";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
};

const DeviceDetailsPopover = ({
  title,
  details,
}: {
  title: string;
  details: DeviceDetail[];
}) => (
  <PopOver
    TriggeringButton={
      <Button
        variant="tertiary"
        svg={Info}
        iconSize="sm"
        aria-label={`Show details for ${title}`}
        title="Show device details"
        className="min-h-0 min-w-0 shrink-0 self-center p-1 max-md:min-h-0"
      />
    }
    contentClassName="w-[min(22rem,calc(100vw-1rem))]"
  >
    <div className="space-y-3 text-sm">
      <h4 className="font-semibold text-gray-100">{title}</h4>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5">
        {details.map((detail) => (
          <div key={detail.label} className="contents">
            <dt className="text-gray-400">{detail.label}</dt>
            <dd className="min-w-0 break-words text-right text-gray-100">
              {detail.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  </PopOver>
);

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
    <div className="space-y-3">
      <section className="rounded-xl border border-gray-700 bg-gray-950/50 p-3">
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
        <div className="mt-4 space-y-0 border-t border-gray-700/60 pt-3">
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
          {visibleWorkstations.length > 0 && (
            <div className={deviceTableHeaderClassName}>
              <span>Device</span>
              <span className="col-span-2 sm:col-span-1 sm:col-start-2">Details</span>
              <span className="col-start-2 row-start-1 sm:col-start-3">Info</span>
              <span className="hidden sm:block sm:col-start-5">Actions</span>
            </div>
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
                  deviceTableRowClassName,
                  alternatingAdminListRowBg(workstationIndex),
                )}
              >
                <p className="min-w-0 text-sm font-semibold">{workstation.label}</p>
                <p className="col-span-2 min-w-0 text-sm text-gray-300 sm:col-span-1 sm:col-start-2">
                  {workstation.appAccess}
                  {workstation.lastOperatorName
                    ? ` | ${workstation.lastOperatorName}`
                    : ""}
                  {workstation.revokedAt ? " | revoked" : ""}
                </p>
                <div className="col-start-2 row-start-1 flex items-center justify-end sm:col-start-3">
                  <DeviceDetailsPopover
                    title={workstation.label}
                    details={[
                      { label: "Access", value: workstation.appAccess },
                      { label: "Status", value: workstation.status || "Unknown" },
                      { label: "Created", value: formatDeviceDate(workstation.createdAt) },
                      { label: "Last seen", value: formatDeviceDate(workstation.lastSeenAt) },
                      {
                        label: "Last operator",
                        value: workstation.lastOperatorName || "Unknown",
                      },
                    ]}
                  />
                </div>
                {!workstation.revokedAt && (
                  <div className="col-start-3 row-start-1 flex items-center justify-end sm:col-start-5 sm:justify-self-end">
                    <Button
                      variant="destructive"
                      svg={Ban}
                      iconSize="sm"
                      className="shrink-0"
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
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-xl border border-gray-700 bg-gray-950/50 p-3">
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
        <div className="mt-4 space-y-0 border-t border-gray-700/60 pt-3">
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
          {visibleDisplayDevices.length > 0 && (
            <div className={deviceTableHeaderClassName}>
              <span>Display</span>
              <span className="col-span-2 sm:col-span-1 sm:col-start-2">Surface</span>
              <span className="col-start-2 row-start-1 sm:col-start-3">Info</span>
              <span className="hidden sm:block sm:col-start-5">Actions</span>
            </div>
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
                  deviceTableRowClassName,
                  alternatingAdminListRowBg(displayIndex),
                )}
              >
                <p className="min-w-0 text-sm font-semibold">{display.label}</p>
                <p className="col-span-2 min-w-0 text-sm text-gray-300 sm:col-span-1 sm:col-start-2">
                  {formatSurfaceTypeLabel(display.surfaceType)}
                  {display.revokedAt ? " | revoked" : ""}
                </p>
                <div className="col-start-2 row-start-1 flex items-center justify-end sm:col-start-3">
                  <DeviceDetailsPopover
                    title={display.label}
                    details={[
                      { label: "Surface", value: formatSurfaceTypeLabel(display.surfaceType) },
                      { label: "Status", value: display.status || "Unknown" },
                      { label: "Created", value: formatDeviceDate(display.createdAt) },
                      { label: "Last seen", value: formatDeviceDate(display.lastSeenAt) },
                    ]}
                  />
                </div>
                {!display.revokedAt && (
                  <div className="col-start-3 row-start-1 flex items-center justify-end sm:col-start-5 sm:justify-self-end">
                    <Button
                      variant="destructive"
                      svg={Ban}
                      iconSize="sm"
                      className="shrink-0"
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
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-xl border border-gray-700 bg-gray-950/50 p-3">
        <h3 className="text-lg font-semibold">Trusted devices</h3>
        <p className="mt-1 text-sm text-gray-400">
          Trusted sign-in devices across this church. Admins can revoke access
          when needed.
        </p>
        <div className="mt-2 flex justify-end">
          <Button
            variant="tertiary"
            svg={showRevokedDevices ? EyeOff : Eye}
            iconSize="sm"
            onClick={() => setShowRevokedDevices((current) => !current)}
          >
            {showRevokedDevices ? "Hide revoked devices" : "Show revoked devices"}
          </Button>
        </div>
        <div className="mt-2 space-y-0">
          {visibleTrustedDevices.length === 0 && (
            <p className="text-sm text-gray-300">
              {trustedDevices.length === 0
                ? "No trusted devices yet."
                : "No devices match this filter."}
            </p>
          )}
          {visibleTrustedDevices.length > 0 && (
            <div className={deviceTableHeaderClassName}>
              <span>Device</span>
              <span className="col-span-2 sm:col-span-1 sm:col-start-2">Owner</span>
              <span className="col-start-2 row-start-1 sm:col-start-3">Info</span>
              <span className="col-start-3 row-start-1 text-right sm:col-start-5">Actions</span>
            </div>
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
                  deviceTableRowClassName,
                  alternatingAdminListRowBg(trustedIndex),
                )}
              >
                <p className="min-w-0 text-sm font-semibold">
                  {formatTrustedDeviceTitle(device)}
                </p>
                <div className="col-span-2 min-w-0 sm:col-span-1 sm:col-start-2">
                  <p className="min-w-0 text-sm text-gray-300">
                    {getTrustedDeviceOwnerLabel(device)}
                    {device.revokedAt ? " | revoked" : ""}
                  </p>
                </div>
                <div className="col-start-2 row-start-1 flex items-center justify-end sm:col-start-3">
                  <DeviceDetailsPopover
                    title={formatTrustedDeviceTitle(device)}
                    details={[
                      {
                        label: "Owner",
                        value: getTrustedDeviceOwnerLabel(device),
                      },
                      {
                        label: "Platform",
                        value: getPlatformDisplayLabel(device.platformType),
                      },
                      { label: "Status", value: device.revokedAt ? "Revoked" : "Active" },
                      { label: "Created", value: formatDeviceDate(device.createdAt) },
                      { label: "Last seen", value: formatDeviceDate(device.lastSeenAt) },
                    ]}
                  />
                </div>
                {!device.revokedAt && (
                  <div className="col-start-3 row-start-1 flex items-center justify-end sm:col-start-5 sm:justify-self-end">
                  <Button
                    variant="destructive"
                    svg={Ban}
                    iconSize="sm"
                    className="shrink-0"
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
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-xl border border-gray-700 bg-gray-950/50 p-3">
        <h3 className="text-lg font-semibold">Recovery email</h3>
        <p className="mt-1 text-sm text-gray-400">
          We send admin recovery requests here.
        </p>
        <RecoveryEmailForm
          churchId={churchId}
          recoveryEmailFromContext={context?.recoveryEmail}
        />
      </section>
    </div>
  );
};

export default AccountSetupPage;
