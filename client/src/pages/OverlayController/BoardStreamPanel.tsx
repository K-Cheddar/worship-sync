import { memo, useCallback, useContext, useMemo, useRef, useState, type CSSProperties } from "react";
import { Airplay, ChevronDown } from "lucide-react";
import Button from "../../components/Button/Button";
import DisplayWindow from "../../components/DisplayWindow/DisplayWindow";
import Input from "../../components/Input/Input";
import ColorField from "../../components/ColorField/ColorField";
import { useDispatch, useSelector } from "../../hooks";
import { updateBoardPostStreamInfo } from "../../store/presentationSlice";
import { useBoardData } from "../../boards/useBoardData";
import { useBoardEventStream } from "../../boards/useBoardEventStream";
import { useRestreamSession } from "../../boards/useRestreamSession";
import {
  filterHighlightedBoardPosts,
  getBoardAuthorNameColorClass,
  getBoardAuthorNameHexColor,
  getStoredBoardDisplayAliasId,
} from "../../boards/boardUtils";
import { GlobalInfoContext } from "../../context/globalInfo";
import { cn } from "@/utils/cnHelper";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/DropdownMenu";

type HighlightedPostItem = {
  id: string;
  author: string;
  authorId?: string;
  text: string;
  source: "board" | "restream";
  timestamp: number;
};

const DEFAULT_BG_COLOR = "#32353beb";
const DEFAULT_FONT_SIZE = 1.5;
const DEFAULT_DURATION = 15;

const FIELD_CLASS = "text-sm flex gap-2 items-center w-full";
const LABEL_CLASS = "w-24";

const MIN_FONT_SIZE_DISPLAY = 12;
const MAX_FONT_SIZE_DISPLAY = 32;
const DEFAULT_FONT_SIZE_DISPLAY = Math.round(DEFAULT_FONT_SIZE * 10);
const BOARD_FONT_SIZE_PRESETS: readonly number[] = Array.from(
  { length: MAX_FONT_SIZE_DISPLAY - MIN_FONT_SIZE_DISPLAY + 1 },
  (_, i) => MIN_FONT_SIZE_DISPLAY + i,
);

function nearestBoardFontPreset(displayVal: number): number {
  let best = BOARD_FONT_SIZE_PRESETS[0]!;
  let bestDist = Infinity;
  for (const p of BOARD_FONT_SIZE_PRESETS) {
    const d = Math.abs(p - displayVal);
    if (d < bestDist) { bestDist = d; best = p; }
  }
  return best;
}

type BoardStreamFontSizeFieldProps = {
  value: number;
  presetHighlight: number;
  fieldClass: string;
  labelClass: string;
  onChange: (displayVal: number) => void;
};

const BoardStreamFontSizeField = memo(function BoardStreamFontSizeField({
  value,
  presetHighlight,
  fieldClass,
  labelClass,
  onChange,
}: BoardStreamFontSizeFieldProps) {
  const presetListScrollRef = useRef<HTMLDivElement>(null);

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) return;
    requestAnimationFrame(() => {
      presetListScrollRef.current
        ?.querySelector<HTMLElement>('[data-preset-selected="true"]')
        ?.scrollIntoView({ block: "center", behavior: "auto" });
    });
  }, []);

  return (
    <Input
      label="Font size"
      value={value}
      type="number"
      min={MIN_FONT_SIZE_DISPLAY}
      max={MAX_FONT_SIZE_DISPLAY}
      step={1}
      onChange={(val) =>
        onChange(
          Math.min(
            MAX_FONT_SIZE_DISPLAY,
            Math.max(MIN_FONT_SIZE_DISPLAY, Number(val) || DEFAULT_FONT_SIZE_DISPLAY),
          ),
        )
      }
      className={fieldClass}
      labelClassName={labelClass}
      labelLayout="inline"
      inputClassName="flex-1"
      endAdornment={
        <DropdownMenu modal={false} onOpenChange={handleOpenChange}>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="tertiary"
              className="inline-flex h-7 w-7 min-h-0 shrink-0 items-center justify-center"
              padding="p-0.5"
              svg={ChevronDown}
              iconSize="sm"
              aria-label="Font size presets"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={0}
            className="box-border flex max-h-[min(18rem,55vh)] w-20 max-w-20 min-w-0 flex-col overflow-hidden rounded-b-md rounded-t-none border border-neutral-700 border-t-neutral-600 bg-neutral-900 p-0 text-neutral-100 shadow-none"
          >
            <div
              ref={presetListScrollRef}
              className="scrollbar-portal min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-1"
              style={{ "--scrollbar-width": "thin" } as CSSProperties}
            >
              {BOARD_FONT_SIZE_PRESETS.map((px) => {
                const isSelected = px === presetHighlight;
                return (
                  <DropdownMenuItem
                    key={px}
                    data-preset-selected={isSelected || undefined}
                    className={cn(
                      "justify-center px-1.5 py-1 text-xs tabular-nums",
                      isSelected
                        ? "bg-cyan-950/70 font-medium text-cyan-50 ring-1 ring-cyan-500/35 ring-inset hover:bg-cyan-950/80 focus:bg-cyan-950/80 data-highlighted:bg-cyan-950/80 data-highlighted:text-cyan-50"
                        : "text-neutral-100 hover:bg-neutral-800 hover:text-neutral-100 focus:bg-neutral-800 focus:text-neutral-100 data-highlighted:bg-neutral-800 data-highlighted:text-neutral-100",
                    )}
                    onSelect={() => onChange(px)}
                  >
                    {px}
                  </DropdownMenuItem>
                );
              })}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    />
  );
});

const BoardStreamPanel = () => {
  const dispatch = useDispatch();
  const isStreamTransmitting = useSelector(
    (state) => state.presentation.isStreamTransmitting,
  );

  const { churchId } = useContext(GlobalInfoContext) ?? {};
  const aliasId = getStoredBoardDisplayAliasId();

  const { posts, hasLoadedOnce, connectionStatus, loadBoard, loadPosts } =
    useBoardData(aliasId);

  const { messages: restreamMessages } = useRestreamSession(churchId ?? "");

  useBoardEventStream(aliasId, (event) => {
    if (event.type === "connected") return;
    if (event.type === "board-hard-reset") {
      void loadBoard();
    } else if (
      event.type === "post-created" ||
      event.type === "post-updated" ||
      event.type === "board-soft-reset"
    ) {
      void loadPosts();
    }
  });

  const highlightedItems = useMemo((): HighlightedPostItem[] => {
    const boardItems: HighlightedPostItem[] = filterHighlightedBoardPosts(posts).map((post) => ({
      id: post._id,
      author: post.author,
      authorId: post.authorId,
      text: post.text,
      source: "board",
      timestamp: post.timestamp,
    }));
    const restreamItems: HighlightedPostItem[] = restreamMessages
      .filter((m) => m.isHighlighted && !m.hidden && m.kind === "viewer_message")
      .map((m) => ({
        id: m.id,
        author: m.author,
        text: m.text,
        source: "restream",
        timestamp: m.postedAt ?? 0,
      }));
    return [...boardItems, ...restreamItems].sort((a, b) => {
      if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
      return a.id.localeCompare(b.id);
    });
  }, [posts, restreamMessages]);

  const [selectedPost, setSelectedPost] = useState<HighlightedPostItem | null>(null);
  const [backgroundColor, setBackgroundColor] = useState(DEFAULT_BG_COLOR);
  const [fontSize, setFontSize] = useState<number>(DEFAULT_FONT_SIZE);
  const [duration, setDuration] = useState<number>(DEFAULT_DURATION);
  const [showPreview, setShowPreview] = useState(false);

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

  const handleSend = (item: HighlightedPostItem) => {
    setSelectedPost(item);
    dispatch(
      updateBoardPostStreamInfo({
        author: item.author,
        authorHexColor: getBoardAuthorNameHexColor(item),
        text: item.text,
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

    if (highlightedItems.length === 0) {
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
        {highlightedItems.map((item) => {
          const isSelected = selectedPost?.id === item.id;
          return (
            <li
              key={item.id}
              className={cn(
                "flex w-full overflow-clip rounded-md leading-3 border-l-4 transition-colors border-t border-r border-b",
                isSelected
                  ? "border-cyan-400 bg-cyan-950/40"
                  : "border-transparent bg-black/50",
              )}
            >
              <Button
                variant="tertiary"
                wrap
                className="flex-col flex-1 h-full leading-4 items-start font-normal"
                padding="px-2 py-1.5"
                gap="gap-1"
                onClick={() => setSelectedPost(item)}
              >
                <div className="flex items-center gap-1.5">
                  <p
                    className={cn(
                      "text-xs font-semibold",
                      getBoardAuthorNameColorClass(item),
                    )}
                  >
                    {item.author}
                  </p>
                  {item.source === "restream" && (
                    <span className="rounded-full bg-cyan-500/15 px-1.5 py-0.5 text-xs font-semibold text-cyan-100">
                      Restream
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-sm text-slate-200 whitespace-normal">
                  {item.text}
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
                  handleSend(item);
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
      <div className="flex min-h-0 flex-1 overflow-hidden max-lg:flex-col">
        {/* Settings + preview — first in DOM so it's at top on mobile; lg:order-last keeps it on the right on desktop */}
        <div className="scrollbar-variable flex shrink-0 flex-col lg:w-[50%] lg:min-w-[260px] lg:order-last lg:overflow-y-auto max-lg:border-b max-lg:border-gray-600">
          {/* Show/Hide Preview — mobile only */}
          <Button
            className="lg:hidden justify-center text-sm m-2"
            variant="tertiary"
            onClick={() => setShowPreview(!showPreview)}
          >
            {showPreview ? "Hide" : "Show"} Preview
          </Button>

          {/* Preview — always visible on desktop, toggled on mobile */}
          <div className={cn("lg:block", !showPreview && "max-lg:hidden")}>
            <div className="relative flex bg-black/40 px-3 py-1.5">
              <h2 className="flex-1 text-center text-base font-semibold text-white">
                Preview
              </h2>
            </div>
            <div className="bg-gray-500/35">
              <DisplayWindow
                showBorder
                displayType="stream"
                className="w-full"
                boardPostStreamInfo={previewInfo}
              />
            </div>
          </div>

          {/* Post Settings */}
          <section className="scrollbar-variable flex min-w-0 w-full flex-col items-stretch gap-2 overflow-y-auto rounded-md border border-white/12 bg-transparent m-3 p-4" style={{ width: "calc(100% - 1.5rem)" }}>
            <ColorField
              label="Background"
              value={backgroundColor}
              onChange={setBackgroundColor}
              debounceParentCommitMs={80}
            />
            <BoardStreamFontSizeField
              value={Math.round(fontSize * 10)}
              presetHighlight={nearestBoardFontPreset(Math.round(fontSize * 10))}
              fieldClass={FIELD_CLASS}
              labelClass={LABEL_CLASS}
              onChange={(displayVal) => setFontSize(displayVal / 10)}
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

        {/* Post list — second in DOM so it's below settings on mobile; lg:order-first keeps it on the left on desktop */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:border-r lg:border-gray-600 lg:order-first">
          <p className="shrink-0 px-3 py-2 text-lg font-semibold text-slate-200 text-center">
            Highlighted Posts
          </p>
          {renderList()}
        </div>
      </div>
    </div>
  );
};

export default BoardStreamPanel;
