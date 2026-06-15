import { useEffect, useRef } from "react";
import { getApiBasePath } from "../../../utils/environment";
import type { TeamSchedule } from "../../../api/authTypes";

export type TeamsStreamEvent =
  | { type: "connected"; churchId?: string }
  | { type: "schedule-updated"; schedule: TeamSchedule }
  | { type: "schedule-removed"; scheduleId: string }
  | { type: string; [key: string]: unknown };

/**
 * Subscribes to the church's Teams live channel (SSE). The server pushes
 * schedule mutations made by other admins so the scheduling grid collaborates
 * in real time. Mirrors `useBoardEventStream` — see server/teamsSse.js for the
 * emitter and server.js for the `/api/churches/:churchId/teams/stream` route.
 */
export const useTeamsLiveSync = (
  churchId: string | null | undefined,
  onMessage: (event: TeamsStreamEvent) => void,
) => {
  const onMessageRef = useRef(onMessage);

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    if (!churchId) return;
    // EventSource is absent in some runtimes (jsdom/tests, older webviews). The
    // page still works via background polling, so just skip the live channel.
    if (typeof EventSource === "undefined") return;

    const source = new EventSource(
      `${getApiBasePath()}api/churches/${encodeURIComponent(churchId)}/teams/stream`,
      { withCredentials: true },
    );

    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as TeamsStreamEvent;
        onMessageRef.current(data);
      } catch {
        onMessageRef.current({ type: "unknown" });
      }
    };

    return () => {
      source.close();
    };
  }, [churchId]);
};
