import type { ReactNode } from "react";
import Button from "../../../components/Button/Button";
import { useChurchServiceTimeZone } from "../../../context/churchServiceTimeZone";

type Props = {
  children: ReactNode;
  area: string;
};

const ChurchServiceTimeZoneGate = ({ children, area }: Props) => {
  const { status, timeZone, isConfigured, refresh } = useChurchServiceTimeZone();

  if (status === "ready" && isConfigured && timeZone) return children;

  const loading = status === "loading";
  const needsConfiguration = status === "ready" && !isConfigured;
  let heading = "Could not load the church time zone";
  let message = `${area} dates are unavailable until the time zone loads. Try again or check your connection.`;
  if (loading) {
    heading = "Loading the church time zone";
    message = `The ${area} dates will be available when the time zone loads. You can open another section while you wait.`;
  } else if (needsConfiguration) {
    heading = "Choose a church time zone";
    message = `Choose a church time zone in Service setup before using ${area}.`;
  }

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
        <Button
          component="link"
          to="/teams-and-services/service-setup"
          variant="tertiary"
        >
          Open Service setup
        </Button>
      </div>
    </section>
  );
};

export default ChurchServiceTimeZoneGate;
