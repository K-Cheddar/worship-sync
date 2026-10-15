import type { ReactNode } from "react";
import Button from "../../../components/Button/Button";
import { useChurchServiceTimeZone } from "../../../context/churchServiceTimeZone";

type Props = {
  children: ReactNode;
  area: string;
};

export const ChurchServiceTimeZoneNotice = ({ area }: Pick<Props, "area">) => {
  const { status, timeZone, isConfigured, refresh } = useChurchServiceTimeZone();
  const hasConfirmedValue = Boolean(isConfigured && timeZone);
  if (status === "ready" && hasConfirmedValue) return null;
  const loading = status === "loading";
  const needsConfiguration = status === "ready" && !isConfigured;
  const heading = needsConfiguration
    ? "Choose a church time zone"
    : loading
      ? hasConfirmedValue
        ? "Refreshing the church time zone"
        : "Loading the church time zone"
      : hasConfirmedValue
        ? "Could not refresh the church time zone"
        : "Could not load the church time zone";
  const message = needsConfiguration
    ? `Choose a church time zone in Service setup before using date-based ${area} actions.`
    : hasConfirmedValue
      ? `Using this church's last confirmed time zone while the refresh is unavailable. Try again to check for updates.`
      : loading
        ? `Date-based ${area} actions will be available when the church time zone loads. Existing content remains accessible where it does not need date calculations.`
        : `Date-based ${area} actions are unavailable until the church time zone loads. Try again or check your connection.`;

  return (
    <section
      className="m-4 flex flex-col items-start gap-3 rounded-lg border border-amber-700/60 bg-amber-950/30 p-5 text-sm text-amber-100"
      role={loading ? "status" : "alert"}
      aria-live={loading ? "polite" : "assertive"}
    >
      <div className="space-y-1">
        <h2 className="font-semibold">{heading}</h2>
        <p>{message}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {status === "error" ? (
          <Button type="button" variant="secondary" onClick={() => void refresh().catch(() => undefined)}>
            Try again
          </Button>
        ) : null}
        {needsConfiguration ? (
          <Button
            component="link"
            to="/teams-and-services/service-setup"
            variant="tertiary"
          >
            Open Service setup
          </Button>
        ) : null}
      </div>
    </section>
  );
};

const ChurchServiceTimeZoneGate = ({ children, area }: Props) => {
  const { timeZone, isConfigured } = useChurchServiceTimeZone();
  const hasConfirmedValue = Boolean(isConfigured && timeZone);

  if (!hasConfirmedValue) return <ChurchServiceTimeZoneNotice area={area} />;

  return (
    <>
      <ChurchServiceTimeZoneNotice area={area} />
      {children}
    </>
  );
};

export default ChurchServiceTimeZoneGate;
