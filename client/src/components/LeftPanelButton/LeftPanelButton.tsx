import Button from "../Button/Button";
import { FileQuestion } from "lucide-react";
import {
  forwardRef,
  FunctionComponent,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import cn from "classnames";
import { iconColorMap, svgMap } from "../../utils/itemTypeMaps";
import { formatTime } from "../DisplayWindow/TimerDisplay";
import { useCachedMediaUrl } from "../../hooks/useCachedMediaUrl";
import { useLocalImageUrl } from "../../hooks/useLocalImageUrl";
import { useLocalVideoFileUrl } from "../../hooks/useLocalVideoFileUrl";
import MultiSelectSubsetTick from "../MultiSelectSubsetTick/MultiSelectSubsetTick";
import type {
  LocalImageAssetReference,
  LocalVideoFileReference,
} from "../../types";
import { isLocalMediaReferenceUrl } from "../../utils/localMediaReferenceUrl";

type LeftPanelButtonProps = {
  isSelected: boolean;
  style?: React.CSSProperties | undefined;
  /**
   * Absolute route for this row. Callers build it from the controller they are
   * on — this used to prefix "/controller" itself, which threw operators on an
   * auxiliary controller onto the presentation controller.
   */
  to: string;
  title: string;
  subtitle?: string;
  type: string;
  id: string;
  onClick?: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  actions?: {
    action: (itemId: string) => void;
    svg: FunctionComponent<{}>;
    id: string;
    /** Accessible name for icon-only row actions. */
    label?: string;
  }[];
  image?: string;
  /** Local image metadata so `local-image://` backgrounds can resolve. */
  localImage?: LocalImageAssetReference;
  /** Local video metadata so outline rows can show a still without CSP hits. */
  localVideoFile?: LocalVideoFileReference;
  className?: string;
  displayId?: string;
  timerValue?: number;
  /** Preformatted timer label, or a leaf countdown element. */
  timerText?: ReactNode;
  isActive?: boolean;
  /** When provided, renders a multi-select tick badge on the left edge of the row. */
  multiSelectMode?: boolean;
  /** Whether this row is in the active multi-select subset. */
  isMultiSelected?: boolean;
};

const LeftPanelButton = forwardRef<HTMLLIElement, LeftPanelButtonProps>(
  (
    {
      isSelected,
      to,
      title,
      subtitle,
      type,
      actions,
      id,
      style,
      image,
      localImage,
      localVideoFile,
      className,
      displayId,
      timerValue,
      timerText,
      isActive,
      onClick,
      multiSelectMode,
      isMultiSelected,
      ...rest
    },
    ref
  ) => {
    const local = useLocalImageUrl(localImage, "thumbnail");
    const localVideo = useLocalVideoFileUrl(localVideoFile, "thumbnail");
    const preferLocal =
      local.isLocalImage &&
      (local.status === "ready" || local.status === "loading");
    const preferLocalVideo =
      localVideo.isLocalVideoFile &&
      (localVideo.status === "ready" || localVideo.status === "loading");
    const unresolvedLocalBackground =
      isLocalMediaReferenceUrl(image) &&
      !local.isLocalImage &&
      !localVideo.isLocalVideoFile;
    const imageForCache =
      preferLocal && local.url
        ? local.url
        : preferLocalVideo && localVideo.url
          ? localVideo.url
          : unresolvedLocalBackground
            ? undefined
            : image;
    const resolvedImage = useCachedMediaUrl(imageForCache);
    const [imageFailed, setImageFailed] = useState(false);

    useEffect(() => {
      setImageFailed(false);
    }, [imageForCache, resolvedImage, local.url, localVideo.url]);

    let thumbnailSrc: string | undefined;
    if (preferLocal && local.status === "loading") {
      thumbnailSrc = undefined;
    } else if (preferLocalVideo && localVideo.status === "loading") {
      thumbnailSrc = undefined;
    } else {
      thumbnailSrc = resolvedImage ?? imageForCache;
    }

    return (
      <li
        id={displayId}
        ref={ref}
        style={style}
        className={cn(
          "group relative flex min-h-8 min-w-0",
          isSelected && "ring-1 ring-inset ring-cyan-500/30",
          className
        )}
        {...rest}
      >
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 z-0 transition-colors duration-150 ease-out",
            isSelected
              ? "bg-cyan-500/12 group-hover:bg-cyan-500/18 group-active:bg-cyan-500/24"
              : "bg-transparent group-hover:bg-black/22 group-active:bg-black/32"
          )}
        />
        {multiSelectMode !== undefined && (
          <MultiSelectSubsetTick
            modeActive={multiSelectMode}
            isSelected={isMultiSelected ?? false}
            frameClassName="absolute left-1.5 top-1/2 -translate-y-1/2 z-20 size-5"
          />
        )}
        <Button
          variant="none"
          className="relative z-10 flex min-h-8 min-w-0 flex-1 shrink items-center self-stretch bg-transparent text-sm rounded-tl-none rounded-bl-none"
          iconSize="xs"
          wrap
          svg={svgMap.get(type) || FileQuestion}
          gap="gap-2"
          color={iconColorMap.get(type)}
          isSelected={isSelected}
          padding="py-1 px-2"
          component="link"
          to={to}
          onClick={onClick}
        >
          {thumbnailSrc && !isActive && !imageFailed && (
            <img
              src={thumbnailSrc}
              className="w-12 max-w-[20%] shrink-0"
              alt=""
              onError={() => setImageFailed(true)}
            />
          )}
          {isActive && (
            <span className="shrink-0 rounded-lg bg-black/55 px-2 py-1 text-xs font-semibold tabular-nums text-white">
              {timerText ?? formatTime(timerValue || 0, false, true)}
            </span>
          )}
          <div className="min-w-0 flex-1 pl-1">
            <p
              title={title}
              className="line-clamp-3 wrap-break-word text-left font-semibold text-white"
            >
              {title}
            </p>
            {subtitle && (
              <p className="truncate text-left text-xs font-normal text-white/55">
                {subtitle}
              </p>
            )}
          </div>
        </Button>
        {actions &&
          actions.map((action) => (
            <Button
              svg={action.svg}
              key={action.id}
              onClick={() => action.action(id)}
              variant="tertiary"
              aria-label={action.label}
              title={action.label}
              className="relative z-10 shrink-0 transition-colors duration-150 ease-out hover:bg-white/10 active:bg-white/15"
            />
          ))}
      </li>
    );
  }
);

export default LeftPanelButton;
