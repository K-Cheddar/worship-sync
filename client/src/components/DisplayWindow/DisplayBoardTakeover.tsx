import { useEffect, useState } from "react";
import MonitorBoardView from "./MonitorBoardView";
import { REFERENCE_HEIGHT } from "../../constants";

type DisplayBoardTakeoverProps = {
  aliasId: string;
  outputId: string;
};

/**
 * A discussion board shown in place of a display's presentation content.
 *
 * Shared by every full-frame surface that can host one — `/monitor`,
 * `/projector`, and `/projector-full`. Keeping it in one place is what stops a
 * route from quietly missing the swap: `/projector-full` is the route Electron
 * opens, so a board that only worked in the browser never reached the room.
 */
const DisplayBoardTakeover = ({
  aliasId,
  outputId,
}: DisplayBoardTakeoverProps) => {
  const [viewportHeight, setViewportHeight] = useState(() =>
    typeof window !== "undefined" ? window.innerHeight : REFERENCE_HEIGHT,
  );

  useEffect(() => {
    const onResize = () => setViewportHeight(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <div className="h-dvh w-dvw bg-black">
      <MonitorBoardView
        aliasId={aliasId}
        outputId={outputId}
        scale={viewportHeight / REFERENCE_HEIGHT}
        missingAliasTitle="No discussion board selected."
        missingAliasDescription="Choose a board in moderation, then turn it on for this display."
      />
    </div>
  );
};

export default DisplayBoardTakeover;
