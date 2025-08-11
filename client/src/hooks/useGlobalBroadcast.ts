import { useEffect, useRef } from "react";
import { globalBroadcastRef } from "../context/controllerInfo";

export const useGlobalBroadcast = (
  callback: (data: any) => void,
  delay: number = 300
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
      if (msg.data.type === "update") {
        console.log("message", msg.data);
        // Clear existing timeout
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }

        // Set new timeout for debounced callback
        timeoutRef.current = setTimeout(() => {
          callbackRef.current({ detail: [msg.data.data.docs] });
        }, delay);
      }
    };

    globalBroadcastRef.addEventListener("message", handleMessage);

    return () => {
      globalBroadcastRef.removeEventListener("message", handleMessage);
      // Clean up timeout on unmount
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [delay]);
};
