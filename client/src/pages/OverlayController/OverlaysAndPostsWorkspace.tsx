import { useState } from "react";
import Overlays from "../../containers/Overlays/Overlays";
import BoardStreamPanel from "./BoardStreamPanel";

type DetailSource = "overlay" | "boardPost";

const OverlaysAndPostsWorkspace = () => {
  const [detailTarget, setDetailTarget] = useState<HTMLDivElement | null>(null);
  const [detailSource, setDetailSource] = useState<DetailSource>("overlay");

  return (
    <div className="grid h-full min-h-0 w-full grid-cols-3 overflow-hidden">
      {detailTarget ? (
        <>
          <div className="min-h-0 min-w-0 overflow-hidden border-r border-gray-600">
            <Overlays
              detailTarget={detailTarget}
              isDetailActive={detailSource === "overlay"}
              onDetailRequested={() => setDetailSource("overlay")}
            />
          </div>
          <div className="min-h-0 min-w-0 overflow-hidden border-r border-gray-600">
            <BoardStreamPanel
              detailTarget={detailTarget}
              isDetailActive={detailSource === "boardPost"}
              onDetailRequested={() => setDetailSource("boardPost")}
            />
          </div>
        </>
      ) : (
        <>
          <div className="min-h-0 border-r border-gray-600" />
          <div className="min-h-0 border-r border-gray-600" />
        </>
      )}
      <div
        ref={setDetailTarget}
        className="relative min-h-0 min-w-0 overflow-hidden bg-homepage-canvas"
      />
    </div>
  );
};

export default OverlaysAndPostsWorkspace;
