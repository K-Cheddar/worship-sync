import { useCallback, useEffect, useRef, useState } from "react";
import { getBoardAlias, updateBoardPresentationFontScale } from "./api";
import {
  DEFAULT_BOARD_PRESENTATION_FONT_SCALE,
  normalizeBoardPresentationFontScale,
} from "./boardUtils";
import { useBoardEventStream } from "./useBoardEventStream";

type UseBoardPresentationFontScaleOptions = {
  /**
   * Gate the fetch and event stream so a hidden/collapsed panel opens no board
   * connection — mirrors how the board preview only connects when its panel is
   * open. Defaults to true.
   */
  enabled?: boolean;
};

/**
 * Read and adjust a board alias's presentation font scale from a control that
 * lives outside the board presentation screen (e.g. the transmit panel's board
 * tile). Loads the current scale once, stays in step with the board event
 * stream's `board-presentation-updated` broadcasts, and applies changes
 * optimistically with rollback on failure so the readout never lags the button.
 */
export const useBoardPresentationFontScale = (
  aliasId: string,
  { enabled = true }: UseBoardPresentationFontScaleOptions = {},
) => {
  const [fontScale, setFontScale] = useState(
    DEFAULT_BOARD_PRESENTATION_FONT_SCALE,
  );
  const [isReady, setIsReady] = useState(false);
  const fontScaleRef = useRef(fontScale);
  fontScaleRef.current = fontScale;

  const active = enabled && Boolean(aliasId);

  useEffect(() => {
    if (!active) {
      setIsReady(false);
      return;
    }

    let cancelled = false;
    setIsReady(false);
    void getBoardAlias(aliasId)
      .then((response) => {
        if (cancelled) return;
        setFontScale(
          normalizeBoardPresentationFontScale(
            response.alias.presentationFontScale,
          ),
        );
        setIsReady(true);
      })
      .catch(() => {
        // Leave the default in place; a later stream event or reopen corrects it.
        if (!cancelled) setIsReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [aliasId, active]);

  useBoardEventStream(active ? aliasId : null, (event) => {
    if (
      event.type === "board-presentation-updated" &&
      typeof event.presentationFontScale === "number"
    ) {
      setFontScale(
        normalizeBoardPresentationFontScale(event.presentationFontScale),
      );
    }
  });

  const changeFontScale = useCallback(
    (nextScale: number) => {
      if (!aliasId) return;
      const normalized = normalizeBoardPresentationFontScale(nextScale);
      const prevScale = fontScaleRef.current;
      if (normalized === prevScale) return;

      // Optimistic: reflect the new size immediately, roll back if the write fails.
      setFontScale(normalized);
      void updateBoardPresentationFontScale(aliasId, normalized).catch(() => {
        setFontScale(prevScale);
      });
    },
    [aliasId],
  );

  return { fontScale, changeFontScale, isReady };
};
