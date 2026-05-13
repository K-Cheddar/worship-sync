import { useCallback, useMemo, useState } from "react";
import cn from "classnames";
import {
  MessageSquarePlus,
  Minus,
  Plus,
  RotateCcw,
} from "lucide-react";
import Button from "../components/Button/Button";
import DeleteModal from "../components/Modal/DeleteModal";
import Select from "../components/Select/Select";
import {
  hardResetBoardAlias,
  resetRestreamSession,
  softResetBoardAlias,
} from "./api";
import { BoardShareLinkGroup } from "./BoardShareLinkGroup";
import {
  BOARD_PRESENTATION_FONT_SCALE_STEP,
  DEFAULT_BOARD_PRESENTATION_FONT_SCALE,
  getBoardLabel,
  MAX_BOARD_PRESENTATION_FONT_SCALE,
  MIN_BOARD_PRESENTATION_FONT_SCALE,
} from "./boardUtils";
import type { DBBoard, DBBoardAlias, Option } from "../types";
import type { UseRestreamSessionResult } from "./useRestreamSession";

export type BoardToolsPanelBodyProps = {
  isMobileStack: boolean;
  churchId: string;
  restreamSession: UseRestreamSessionResult;
  handleCopy: (value: string, label: string) => Promise<void>;
  onOpenAttendeeLink: () => void;
  onOpenViewBoardLink: () => void;
  publicBoardUrl: string;
  publicPresentUrl: string;
  boardIdToView: string;
  setSelectedBoardId: (value: string) => void;
  selectedAlias: DBBoardAlias;
  boardsById: Record<string, DBBoard>;
  archiveOptions: string[];
  isViewingCurrent: boolean;
  presentationFontScale: number;
  onFontScaleChange: (scale: number) => void;
  runAction: (action: () => Promise<void>) => Promise<void>;
  isActing: boolean;
  showToast: (message: string, variant: "success" | "error") => void;
};

export const BoardToolsPanelBody = ({
  isMobileStack,
  churchId,
  restreamSession,
  handleCopy,
  onOpenAttendeeLink,
  onOpenViewBoardLink,
  publicBoardUrl,
  publicPresentUrl,
  boardIdToView,
  setSelectedBoardId,
  selectedAlias,
  boardsById,
  archiveOptions,
  isViewingCurrent,
  presentationFontScale,
  onFontScaleChange,
  runAction,
  isActing,
  showToast,
}: BoardToolsPanelBodyProps) => {
  const [restreamResetOpen, setRestreamResetOpen] = useState(false);
  const { session: restreamSessionState, reload: reloadRestream } =
    restreamSession;

  const handleRestreamResetConfirm = useCallback(async () => {
    if (!churchId) return;
    try {
      await resetRestreamSession(churchId);
      await reloadRestream();
      setRestreamResetOpen(false);
      showToast("Started a new Restream session.", "success");
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Could not start a new Restream session.",
        "error",
      );
    }
  }, [churchId, reloadRestream, showToast]);

  const historyOptions: Option[] = useMemo(
    () =>
      archiveOptions.map((boardId) => ({
        value: boardId,
        label: `${boardId === selectedAlias.currentBoardId ? "Current session" : "Earlier session"}: ${getBoardLabel(boardsById[boardId])}`,
      })),
    [archiveOptions, boardsById, selectedAlias.currentBoardId],
  );

  return (
    <>
      {restreamResetOpen ? (
        <DeleteModal
          isOpen
          onClose={() => setRestreamResetOpen(false)}
          onConfirm={() => void handleRestreamResetConfirm()}
          itemName="Restream session history"
          title="Start a new Restream session"
          message="Are you sure you want to clear"
          warningMessage="This only clears the current Restream session history. Discussion board posts stay the same."
          confirmText="Start new session"
          isConfirming={false}
        />
      ) : null}

      <div className="xl:hidden">
        <p className="text-sm font-semibold text-gray-100" id="board-tools-share-label">
          Share links
        </p>
        <p className="mt-1 text-xs text-gray-400">
          Copy or open the attendee page and the presentation screen. Links stay the same when you start a new session.
        </p>
        <div
          className="mt-3 flex flex-col items-start gap-3"
          role="group"
          aria-labelledby="board-tools-share-label"
        >
          <BoardShareLinkGroup
            heading="Attendee link"
            onCopy={() => handleCopy(publicBoardUrl, "Attendee link")}
            onView={onOpenAttendeeLink}
            disabled={!publicBoardUrl}
          />
          <BoardShareLinkGroup
            heading="Board link"
            onCopy={() => handleCopy(publicPresentUrl, "Board link")}
            onView={onOpenViewBoardLink}
            disabled={!publicPresentUrl}
          />
        </div>
      </div>

      <div
        className={cn(
          isMobileStack && "mt-6 border-t border-gray-600 pt-6",
        )}
      >
        <label
          className="text-sm font-semibold text-gray-100"
          htmlFor="board-history-select"
          id="board-tools-history-label"
        >
          Show posts from
        </label>
        <p className="mt-1 text-xs text-gray-400">
          Choose which session appears in the list of posts.
        </p>
        <Select
          className="mt-2 w-full"
          id="board-history-select"
          options={historyOptions}
          value={boardIdToView}
          onChange={(value) =>
            setSelectedBoardId(
              value === selectedAlias.currentBoardId ? "" : value,
            )
          }
          selectClassName="w-full max-xl:min-h-14"
        />
        {!isViewingCurrent && (
          <Button
            className="mt-3 w-full justify-center"
            variant="tertiary"
            onClick={() => setSelectedBoardId("")}
          >
            Return to current session
          </Button>
        )}
      </div>

      <div className="mt-6 border-t border-gray-600 pt-6">
        <p className="text-sm font-semibold text-gray-100" id="board-tools-presentation-label">
          Presentation text
        </p>
        <p className="mt-1 text-xs text-gray-400">
          Size on the presentation screen when posts are highlighted.
        </p>
        <div
          className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-gray-600 bg-gray-900/60 px-3 py-2"
          role="group"
          aria-labelledby="board-tools-presentation-label"
        >
          <Button
            variant="tertiary"
            svg={Minus}
            padding="p-2"
            className="min-h-0!"
            onClick={() =>
              onFontScaleChange(
                presentationFontScale - BOARD_PRESENTATION_FONT_SCALE_STEP,
              )
            }
            disabled={presentationFontScale <= MIN_BOARD_PRESENTATION_FONT_SCALE}
          />
          <span className="min-w-14 text-center text-sm font-semibold text-white">
            {Math.round(presentationFontScale * 100)}%
          </span>
          <Button
            variant="tertiary"
            padding="px-3 py-2"
            className="min-h-0!"
            aria-label="Reset presentation text size"
            onClick={() =>
              onFontScaleChange(
                DEFAULT_BOARD_PRESENTATION_FONT_SCALE,
              )
            }
            disabled={presentationFontScale === DEFAULT_BOARD_PRESENTATION_FONT_SCALE}
          >
            Reset
          </Button>
          <Button
            variant="tertiary"
            svg={Plus}
            padding="p-2"
            className="min-h-0!"
            onClick={() =>
              onFontScaleChange(
                presentationFontScale + BOARD_PRESENTATION_FONT_SCALE_STEP,
              )
            }
            disabled={presentationFontScale >= MAX_BOARD_PRESENTATION_FONT_SCALE}
          />
        </div>
      </div>

      <div className="mt-6 border-t border-gray-600 pt-6">
        <p className="text-sm font-semibold text-gray-100" id="board-tools-session-label">
          Session actions
        </p>
        <p className="mt-1 text-xs text-gray-400">
          Share links stay the same.
        </p>
        <div
          className="mt-3 flex flex-col gap-4"
          role="group"
          aria-labelledby="board-tools-session-label"
        >
          <div className="flex flex-col gap-1">
            <Button
              className="w-full justify-center"
              svg={RotateCcw}
              aria-describedby="board-session-clear-hint"
              onClick={() =>
                runAction(async () => {
                  await softResetBoardAlias(selectedAlias.aliasId);
                  showToast("All posts removed.", "success");
                })
              }
              disabled={isActing || !isViewingCurrent}
            >
              Clear all posts
            </Button>
            <p
              id="board-session-clear-hint"
              className="text-xs leading-snug text-gray-400"
            >
              Remove every post from this session. Share links stay the same.
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <Button
              variant="cta"
              className="w-full justify-center"
              svg={MessageSquarePlus}
              aria-describedby="board-session-new-hint"
              onClick={() =>
                runAction(async () => {
                  await hardResetBoardAlias(selectedAlias.aliasId);
                  setSelectedBoardId("");
                  showToast("New session started.", "success");
                })
              }
              disabled={isActing || !isViewingCurrent}
            >
              Start new session
            </Button>
            <p
              id="board-session-new-hint"
              className="text-xs leading-snug text-gray-400"
            >
              Start a new empty session with the same link. Earlier sessions and posts stay in the list above.
            </p>
          </div>
        </div>
        {!isViewingCurrent && (
          <p className="mt-3 text-xs text-amber-100/90">
            Switch to the current session to clear posts or start a new session.
          </p>
        )}
      </div>

      <div className="mt-6 border-t border-gray-600 pt-6">
        <p
          className="text-sm font-semibold text-gray-100"
          id="board-tools-restream-label"
        >
          Restream
        </p>
        <p className="mt-1 text-xs text-gray-400">
          Clears Restream chat history for moderation. Discussion board posts stay the same.
        </p>
        <div
          className="mt-3 flex flex-col gap-1"
          role="group"
          aria-labelledby="board-tools-restream-label"
        >
          <Button
            variant="primary"
            className="w-full justify-center"
            svg={RotateCcw}
            aria-describedby="board-tools-restream-hint"
            onClick={() => setRestreamResetOpen(true)}
            disabled={!churchId || !restreamSessionState?.enabled}
          >
            New Restream session
          </Button>
        </div>
      </div>
    </>
  );
};
