import { useMemo } from "react";
import { useChat } from "../chat/ChatContext";
import Spinner from "../components/Spinner/Spinner";
import { useSelector } from "../hooks";
import type { MyScheduleOccurrence, MySchedulePlan } from "../api/auth";
import { usePublicServiceFlow } from "../services/usePublicServiceFlow";
import { buildMyScheduleServiceFlowSnapshot } from "./buildMyScheduleServiceFlowSnapshot";
import { shareIdFromPublicServiceUrl } from "./shareIdFromPublicServiceUrl";
import ServicePublicView from "./ServicePublicView";

type MyScheduleServicePlanPanelProps = {
  occurrence: MyScheduleOccurrence;
  plan: MySchedulePlan | null;
  churchName?: string;
  churchLogoUrl?: string;
  timeZone?: string;
};

/**
 * Service plan tab on My Schedule. Always uses the detailed (team) public view:
 * live share snapshot when links are enabled, otherwise the same detailed chrome
 * from the stripped plan already on the assignment payload.
 */
const MyScheduleServicePlanPanel = ({
  occurrence,
  plan,
  churchName = "",
  churchLogoUrl = "",
  timeZone,
}: MyScheduleServicePlanPanelProps) => {
  const chat = useChat();
  const churchTimeZone = timeZone || chat?.context?.timeZone || "UTC";
  // Prefer the detailed/team public token — never the simple/general link.
  const scrollbarWidth = useSelector(
    (state) => state.undoable.present.preferences.scrollbarWidth,
  );
  const shareId = useMemo(() => {
    const teamUrl = plan?.publicUrls?.team || "";
    return plan?.published ? shareIdFromPublicServiceUrl(teamUrl) : "";
  }, [plan?.published, plan?.publicUrls?.team]);

  const { snapshot, error, loading, connection, refresh } =
    usePublicServiceFlow(shareId);

  const staticSnapshot = useMemo(() => {
    if (!plan) return null;
    return buildMyScheduleServiceFlowSnapshot({
      occurrence,
      plan,
      churchName,
      churchLogoUrl,
      timeZone: churchTimeZone,
    });
  }, [churchLogoUrl, churchName, churchTimeZone, occurrence, plan]);

  if (!plan) {
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
          scrollbarWidth={scrollbarWidth}
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

  return (
    <ServicePublicView
      scrollbarWidth={scrollbarWidth}
      snapshot={staticSnapshot}
      embedded
    />
  );
};

export default MyScheduleServicePlanPanel;
