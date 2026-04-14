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

    const handleMessage = (msg: MessageEvent) => {
      if (msg.data?.type !== "update") return;
      // Ignore our own messages (BroadcastChannel delivers to sender too)
      if (msg.data?.data?.hostId === globalHostId) return;

      // Clear existing timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      // Set new timeout for debounced callback
      timeoutRef.current = setTimeout(() => {
        console.log("Updating from local machine", msg.data);

        const raw = msg.data?.data?.docs;
        const detail = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
        callbackRef.current({ detail });
      }, delay);
    };

    globalBroadcastRef.addEventListener("message", handleMessage);

    return () => {
      if (globalBroadcastRef) {
        globalBroadcastRef.removeEventListener("message", handleMessage);
      }
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
