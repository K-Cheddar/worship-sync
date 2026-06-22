import { useEffect, useRef, useState } from "react";
import MonitorBoardView from "../components/DisplayWindow/MonitorBoardView";
import { REFERENCE_HEIGHT } from "../constants";

// The monitor board view is authored for a full screen, so render it at a fixed
// 16:9 stage and scale that stage down to whatever width it's placed in. Scaling
// the whole stage (rather than its contents) keeps everything proportional in a
// small preview. The stage is a 1080p monitor shrunk to 720, so the band uses
// STAGE_HEIGHT / REFERENCE_HEIGHT — the same reference scale the full page uses.
const STAGE_WIDTH = 1280;
const STAGE_HEIGHT = 720;

type ScaledBoardPreviewProps = {
  aliasId: string;
  missingAliasTitle?: string;
  missingAliasDescription?: string;
};

/**
 * The monitor's discussion-board view (board + clock/timer band) rendered into a
 * contained, width-responsive 16:9 box — a true mirror of the monitor page.
 */
const ScaledBoardPreview = ({
  aliasId,
  missingAliasTitle,
  missingAliasDescription,
}: ScaledBoardPreviewProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [stageScale, setStageScale] = useState(0.25);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setStageScale(el.clientWidth / STAGE_WIDTH);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-hidden rounded bg-black"
      style={{ aspectRatio: `${STAGE_WIDTH} / ${STAGE_HEIGHT}` }}
    >
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{
          width: STAGE_WIDTH,
          height: STAGE_HEIGHT,
          transform: `scale(${stageScale})`,
        }}
      >
        <MonitorBoardView
          aliasId={aliasId}
          scale={STAGE_HEIGHT / REFERENCE_HEIGHT}
          missingAliasTitle={missingAliasTitle}
          missingAliasDescription={missingAliasDescription}
        />
      </div>
    </div>
  );
};

export default ScaledBoardPreview;
