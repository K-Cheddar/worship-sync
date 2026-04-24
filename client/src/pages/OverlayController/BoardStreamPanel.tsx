import { useMemo, useState } from "react";
import { Airplay } from "lucide-react";
import Button from "../../components/Button/Button";
import DisplayWindow from "../../components/DisplayWindow/DisplayWindow";
import Input from "../../components/Input/Input";
import ColorField from "../../components/ColorField/ColorField";
import { useDispatch, useSelector } from "../../hooks";
import { updateBoardPostStreamInfo } from "../../store/presentationSlice";
import { useBoardData } from "../../boards/useBoardData";
import { useBoardEventStream } from "../../boards/useBoardEventStream";
import {
  filterHighlightedBoardPosts,
  getBoardAuthorNameColorClass,
  getBoardAuthorNameHexColor,
  getStoredBoardDisplayAliasId,
} from "../../boards/boardUtils";
import { cn } from "@/utils/cnHelper";
import { DBBoardPost } from "../../types";

const DEFAULT_BG_COLOR = "#32353bd9";
const DEFAULT_FONT_SIZE = 1.5;
const DEFAULT_DURATION = 15;

const FIELD_CLASS = "text-sm flex gap-2 items-center w-full";
const LABEL_CLASS = "w-24";

const BoardStreamPanel = () => {
  const dispatch = useDispatch();
  const isStreamTransmitting = useSelector(
    (state) => state.presentation.isStreamTransmitting,
  );

  const aliasId = getStoredBoardDisplayAliasId();

  const { posts, hasLoadedOnce, connectionStatus, loadPosts } =
    useBoardData(aliasId);

  useBoardEventStream(aliasId, (event) => {
    if (event.type === "connected") return;
    if (
      event.type === "post-created" ||
      event.type === "post-updated" ||
      event.type === "board-soft-reset"
    ) {
      void loadPosts();
    }
  });

  const highlightedPosts = useMemo(
    () => filterHighlightedBoardPosts(posts),
    [posts],
  );

  const [selectedPost, setSelectedPost] = useState<DBBoardPost | null>(null);
  const [backgroundColor, setBackgroundColor] = useState(DEFAULT_BG_COLOR);
  const [fontSize, setFontSize] = useState<number>(DEFAULT_FONT_SIZE);
  const [duration, setDuration] = useState<number>(DEFAULT_DURATION);

  const previewInfo =
    selectedPost != null
      ? {
        author: selectedPost.author,
        authorHexColor: getBoardAuthorNameHexColor(selectedPost),
        text: selectedPost.text,
        backgroundColor,
        fontSize,
        duration,
      }
      : undefined;

  const handleSend = (post: DBBoardPost) => {
    setSelectedPost(post);
    dispatch(
      updateBoardPostStreamInfo({
        author: post.author,
        authorHexColor: getBoardAuthorNameHexColor(post),
        text: post.text,
        backgroundColor,
        fontSize,
        duration,
      }),
    );
  };

  const renderList = () => {
    if (!aliasId) {
      return (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-slate-400">
          <p className="text-sm">
            No board configured. Set a board alias on the Board Display page.
          </p>
        </div>
      );
    }

    if (!hasLoadedOnce) {
      return (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-slate-400">
          <p className="text-sm">
            {connectionStatus.status === "retrying"
              ? "Reconnecting..."
              : "Connecting to board..."}
          </p>
        </div>
      );
    }

    if (highlightedPosts.length === 0) {
      return (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-slate-400">
          <p className="text-sm">
            No highlighted posts yet. Highlight posts in the board controls.
          </p>
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-1 overflow-y-auto p-2">
        {highlightedPosts.map((post) => {
          const isSelected = selectedPost?._id === post._id;
          return (
            <li
              key={post._id}
              className={cn(
                "flex w-full overflow-clip rounded-md leading-3 border-l-4 transition-colors border-t-1 border-r-1 border-b-1",
                isSelected
                  ? "border-cyan-400 bg-cyan-950/40"
                  : "border-transparent bg-black/50",
              )}
            >

              <Button
                variant="tertiary"
                wrap
                className="flex-col flex-1 h-full leading-4 items-start"
                padding="px-2 py-1.5"
                gap="gap-1"
                onClick={() => setSelectedPost(post)}
              >
                <p
                  className={cn(
                    "text-xs font-semibold",
                    getBoardAuthorNameColorClass(post),
                  )}
                >
                  {post.author}
                </p>
                <p className="mt-0.5 text-sm text-slate-200 whitespace-normal">
                  {post.text}
                </p>
              </Button>
              <Button
                svg={Airplay}
                variant="tertiary"
                color={isStreamTransmitting ? "#22c55e" : "gray"}
                className="shrink-0 text-xs"
                disabled={!isStreamTransmitting}
                title={
                  isStreamTransmitting ? "Send to stream" : "Stream is not live"
                }
                onClick={(e) => {
                  e.stopPropagation();
                  handleSend(post);
                }}
              >
                Send
              </Button>
            </li>
          );
        })}
      </div>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Left: highlighted post list */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-r border-gray-600">
          <p className="shrink-0 px-3 py-2 text-xs font-semibold uppercase tracking-widest text-slate-400">
            Highlighted Posts
          </p>
          {renderList()}
        </div>

        {/* Right: preview + settings */}
        <div className="scrollbar-variable flex w-[50%] min-w-[260px] shrink-0 flex-col overflow-y-auto">
          {/* Preview header */}
          <div className="relative flex bg-black/40 px-3 py-1.5">
            <h2 className="flex-1 text-center text-base font-semibold text-white">
              Preview
            </h2>
          </div>

          {/* Preview window */}
          <div className="bg-gray-500/35">
            <DisplayWindow
              showBorder
              displayType="stream"
              className="w-full"
              boardPostStreamInfo={previewInfo}
            />
          </div>

          {/* Post Settings */}
          <section className="scrollbar-variable flex min-w-0 w-full flex-col items-stretch gap-2 overflow-y-auto rounded-md border border-white/12 bg-transparent m-3 p-4" style={{ width: "calc(100% - 1.5rem)" }}>
            <ColorField
              label="Background"
              value={backgroundColor}
              onChange={setBackgroundColor}
              debounceParentCommitMs={80}
            />
            <Input
              label="Font size"
              value={Math.round(fontSize * 10)}
              type="number"
              min={5}
              max={30}
              step={1}
              onChange={(val) =>
                setFontSize(
                  Math.min(3, Math.max(0.5, (Number(val) || DEFAULT_FONT_SIZE * 10) / 10)),
                )
              }
              className={FIELD_CLASS}
              labelClassName={LABEL_CLASS}
              labelLayout="inline"
              inputClassName="flex-1"
            />
            <Input
              label="Duration (s)"
              value={duration}
              type="number"
              min={5}
              max={60}
              step={1}
              onChange={(val) =>
                setDuration(
                  Math.min(60, Math.max(5, Number(val) || DEFAULT_DURATION)),
                )
              }
              className={FIELD_CLASS}
              labelClassName={LABEL_CLASS}
              labelLayout="inline"
              inputClassName="flex-1"
            />
          </section>
        </div>
      </div>
    </div>
  );
};

export default BoardStreamPanel;
