import { useCallback, useEffect } from "react";
import BoardPresentationScreen from "../boards/BoardPresentationScreen";
import { useStoredBoardDisplayAlias } from "../boards/useStoredBoardDisplayAlias";
import { useCloseOnEscape } from "../hooks/useCloseOnEscape";

const BoardDisplay = () => {
  const aliasId = useStoredBoardDisplayAlias();

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
