import { useEffect, useState } from "react";
import {
  BOARD_DISPLAY_ALIAS_CHANNEL_NAME,
  BOARD_DISPLAY_ALIAS_STORAGE_KEY,
  getStoredBoardDisplayAliasId,
} from "./boardUtils";

/**
 * Subscribe to the board display's selected alias id, which lives in
 * localStorage so it can be shared between the controller, the board display
 * window, and other tabs. Keeps in step with cross-tab `storage` events, the
 * board-alias BroadcastChannel, and window focus (covers same-tab writes that
 * `storage` does not fire for). Centralised here so the sync rules live in one
 * place rather than being reimplemented by every consumer.
 */
export const useStoredBoardDisplayAlias = (): string => {
  const [aliasId, setAliasId] = useState(() => getStoredBoardDisplayAliasId());

  useEffect(() => {
    const sync = () => {
      setAliasId(getStoredBoardDisplayAliasId());
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === BOARD_DISPLAY_ALIAS_STORAGE_KEY) {
        sync();
      }
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener("focus", sync);

    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(BOARD_DISPLAY_ALIAS_CHANNEL_NAME);
      channel.onmessage = () => {
        sync();
      };
    }

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("focus", sync);
      channel?.close();
    };
  }, []);

  return aliasId;
};
