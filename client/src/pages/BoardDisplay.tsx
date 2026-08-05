import { useCallback } from "react";
import BoardPresentationScreen from "../boards/BoardPresentationScreen";
import { useStoredBoardDisplayAlias } from "../boards/useStoredBoardDisplayAlias";
import { useCloseOnEscape } from "../hooks/useCloseOnEscape";
import { useWakeLock } from "../hooks/useWakeLock";

const BoardDisplay = () => {
  const aliasId = useStoredBoardDisplayAlias();

  useWakeLock();

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
