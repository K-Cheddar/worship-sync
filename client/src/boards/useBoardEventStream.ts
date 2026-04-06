import { useEffect, useRef } from "react";
import { getApiBasePath } from "../utils/environment";

export type BoardStreamEvent = {
  type: string;
  aliasId?: string;
  timestamp?: number;
  presentationFontScale?: number;
};

export const useBoardEventStream = (
  aliasId: string | null | undefined,
  onMessage: (event: BoardStreamEvent) => void,
) => {
  const onMessageRef = useRef(onMessage);

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    if (!aliasId) return;

    const source = new EventSource(
      `${getApiBasePath()}api/boards/stream/${encodeURIComponent(aliasId)}`,
    );

    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as BoardStreamEvent;
        onMessageRef.current(data);
      } catch {
        onMessageRef.current({ type: "unknown" });
      }
    };

    return () => {
      source.close();
    };
  }, [aliasId]);
};
