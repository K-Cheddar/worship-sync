import { useCallback, useEffect, useState } from "react";
import BoardPresentationScreen from "../boards/BoardPresentationScreen";
import {
  BOARD_DISPLAY_ALIAS_CHANNEL_NAME,
  BOARD_DISPLAY_ALIAS_STORAGE_KEY,
  getStoredBoardDisplayAliasId,
} from "../boards/boardUtils";
import { useCloseOnEscape } from "../hooks/useCloseOnEscape";

const BoardDisplay = () => {
  const [aliasId, setAliasId] = useState(() => getStoredBoardDisplayAliasId());

  useEffect(() => {
    const syncAliasId = () => {
      setAliasId(getStoredBoardDisplayAliasId());
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === BOARD_DISPLAY_ALIAS_STORAGE_KEY) {
        syncAliasId();
      }
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener("focus", syncAliasId);

    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(BOARD_DISPLAY_ALIAS_CHANNEL_NAME);
      channel.onmessage = () => {
        syncAliasId();
      };
    }

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("focus", syncAliasId);
      channel?.close();
    };
  }, []);

  useEffect(() => {
    const keepScreenOn = async () => {
      if (!navigator.wakeLock?.request) {
        return;
      }

      try {
        await navigator.wakeLock.request("screen");
      } catch (err) {
        console.error("Error acquiring wake lock:", err);
      }
    };

    void keepScreenOn();
  }, []);

  const closeWindow = useCallback(async () => {
    if (window.electronAPI) {
      await window.electronAPI.closeWindow("board");
    }
  }, []);

  useCloseOnEscape(closeWindow);

  return (
    <BoardPresentationScreen
      aliasId={aliasId}
      missingAliasTitle="No discussion board selected."
      missingAliasDescription="Select a discussion board in moderation, then choose Open Board."
    />
  );
};

export default BoardDisplay;
