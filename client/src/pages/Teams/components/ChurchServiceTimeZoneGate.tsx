import type { ReactNode } from "react";
import Button from "../../../components/Button/Button";
import { useChurchServiceTimeZone } from "../../../context/churchServiceTimeZone";

type Props = {
  children: ReactNode;
  area: string;
};

export const ChurchServiceTimeZoneNotice = ({ area }: Pick<Props, "area">) => {
  const { status, timeZone, isConfigured, refreshIssue, refresh } = useChurchServiceTimeZone();
  const hasConfirmedValue = Boolean(isConfigured && timeZone);
  const issueKind = refreshIssue?.kind;
  const showCachedRefreshIssue = hasConfirmedValue && Boolean(issueKind && issueKind !== "unavailable");
  const loading = status === "loading";
  const needsConfiguration = status === "ready" && !isConfigured;

  if (hasConfirmedValue && !showCachedRefreshIssue) return null;

  let heading = "Church time zone unavailable";
  let message = `Date-based ${area} actions are unavailable until the church time zone loads. Check your connection and try again.`;
  if (showCachedRefreshIssue && issueKind === "authentication") {
    heading = "Church time zone needs a session refresh";
    message = "The confirmed church time zone is still available for this session, but the latest refresh needs a valid sign-in.";
  } else if (showCachedRefreshIssue && issueKind === "permission") {
    heading = "Church time zone access needs attention";
    message = "The confirmed church time zone is still available. Your current access could not be checked; ask a church administrator to review it.";
  } else if (showCachedRefreshIssue && issueKind === "configuration") {
    heading = "Church time zone could not be refreshed";
    message = "The confirmed church time zone is still available, but the latest church settings could not be read. Contact a church administrator.";
  } else if (needsConfiguration) {
    heading = "Choose a church time zone";
    message = `Choose a church time zone in Service setup before using date-based ${area} actions.`;
  } else if (loading) {
    heading = "Loading the church time zone";
    message = `Date-based ${area} actions will be available when the church time zone loads. Existing content remains accessible where it does not need date calculations.`;
  } else if (issueKind === "authentication") {
    message = `Date-based ${area} actions are unavailable. Sign in again, then retry.`;
  } else if (issueKind === "permission") {
    message = `Date-based ${area} actions are unavailable because you cannot access this church's time zone. Ask a church administrator to check your access.`;
  } else if (issueKind === "configuration") {
    message = `Date-based ${area} actions are unavailable because the church time-zone settings could not be read. Contact a church administrator.`;
  }
  const canRetry = (status === "error" || showCachedRefreshIssue) &&
    (issueKind === "unavailable" || issueKind === "authentication" || issueKind === "permission");

  return (
    <section
      className="m-2 flex flex-col items-start gap-2 rounded-md border border-amber-700/50 bg-amber-950/20 px-3 py-2 text-sm text-amber-100"
      role={loading || needsConfiguration || showCachedRefreshIssue ? "status" : "alert"}
      aria-live="polite"
    >
      <div className="min-w-0 space-y-0.5">
        <h2 className="font-medium">{heading}</h2>
        <p className="text-xs leading-5">{message}</p>
      </div>
      {canRetry || needsConfiguration ? (
        <div className="flex flex-wrap gap-2">
          {canRetry ? (
            <Button type="button" variant="secondary" onClick={() => void refresh().catch(() => undefined)}>
              Retry
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
      ) : null}
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
