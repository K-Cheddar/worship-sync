import { useEffect, useRef } from "react";
import { globalBroadcastRef } from "../context/controllerInfo";
import { globalHostId } from "../context/globalInfo";

export const useGlobalBroadcast = (
  callback: (data: any) => void,
  delay: number = 300,
) => {
  const callbackRef = useRef(callback);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Update the callback ref when the callback changes
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!globalBroadcastRef) return;
    const channel = globalBroadcastRef;
    const pending = new Map<string, unknown>();

    const handleMessage = (msg: MessageEvent) => {
      if (msg.data?.type !== "update") return;
      // Ignore our own messages (BroadcastChannel delivers to sender too)
      if (msg.data?.data?.hostId === globalHostId) return;
      const raw = msg.data?.data?.docs;
      const docs = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
      for (const doc of docs) pending.set(doc?._id ?? JSON.stringify(doc), doc);

      // Clear existing timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      // Set new timeout for debounced callback
      timeoutRef.current = setTimeout(() => {
        const detail = [...pending.values()];
        pending.clear();
        callbackRef.current({ detail });
      }, delay);
    };

    channel.addEventListener("message", handleMessage);

    return () => {
      channel.removeEventListener("message", handleMessage);
      // Clean up timeout on unmount
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [delay]);

  // Return a function to check if the broadcast channel is ready
  return {
    isReady: !!globalBroadcastRef,
  };
};
