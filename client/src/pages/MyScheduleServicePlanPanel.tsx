import { useMemo } from "react";
import Spinner from "../components/Spinner/Spinner";
import type { MyScheduleOccurrence } from "../api/auth";
import { usePublicServiceFlow } from "../services/usePublicServiceFlow";
import { buildMyScheduleServiceFlowSnapshot } from "./buildMyScheduleServiceFlowSnapshot";
import { shareIdFromPublicServiceUrl } from "./shareIdFromPublicServiceUrl";
import ServicePublicView from "./ServicePublicView";

type MyScheduleServicePlanPanelProps = {
  occurrence: MyScheduleOccurrence;
  churchName?: string;
  churchLogoUrl?: string;
};

/**
 * Service plan tab on My Schedule. Always uses the detailed (team) public view:
 * live share snapshot when links are enabled, otherwise the same detailed chrome
 * from the stripped plan already on the assignment payload.
 */
const MyScheduleServicePlanPanel = ({
  occurrence,
  churchName = "",
  churchLogoUrl = "",
}: MyScheduleServicePlanPanelProps) => {
  // Prefer the detailed/team public token — never the simple/general link.
  const shareId = useMemo(() => {
    const teamUrl = occurrence.plan?.publicUrls?.team || "";
    return occurrence.plan?.published ? shareIdFromPublicServiceUrl(teamUrl) : "";
  }, [occurrence.plan?.published, occurrence.plan?.publicUrls?.team]);

  const { snapshot, error, loading, connection, refresh } =
    usePublicServiceFlow(shareId);

  const staticSnapshot = useMemo(() => {
    if (!occurrence.plan) return null;
    return buildMyScheduleServiceFlowSnapshot({
      occurrence,
      plan: occurrence.plan,
      churchName,
      churchLogoUrl,
    });
  }, [churchLogoUrl, churchName, occurrence]);

  if (!occurrence.plan) {
    return (
      <p className="text-sm text-gray-400">
        No order of service is set for this date yet.
      </p>
    );
  }

  if (shareId) {
    if (loading && !snapshot) {
      return (
        <div className="flex items-center gap-3 py-8 text-sm text-neutral-300" aria-live="polite">
          <Spinner width="20px" borderWidth="3px" /> Loading service plan…
        </div>
      );
    }
    if (snapshot) {
      return (
        <ServicePublicView
          snapshot={snapshot}
          connection={connection}
          error={error}
          embedded
          onRefresh={() => void refresh()}
        />
      );
    }
    // Published link failed — fall through to the static assignment plan.
  }

  if (!staticSnapshot) {
    return (
      <p className="text-sm text-gray-400">
        No order of service is set for this date yet.
      </p>
    );
  }

  return <ServicePublicView snapshot={staticSnapshot} embedded />;
};

export default MyScheduleServicePlanPanel;
