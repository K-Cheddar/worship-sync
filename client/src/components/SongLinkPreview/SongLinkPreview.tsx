import { ExternalLink, Music2, Play, Video } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  getRichLinkPreview,
  type RichLinkPreview,
} from "../../api/auth";
import type { SongLink, SongLinkSegment } from "../../types";
import { cn } from "../../utils/cnHelper";
import { getRichLinkReference } from "../../utils/richLinkPreview";
import {
  formatYouTubeTimestamp,
  getYouTubeVideoReference,
} from "../../utils/youtube";
import Button from "../Button/Button";
import Modal from "../Modal/Modal";

type SongLinkPreviewProps = {
  link: SongLink;
  compact?: boolean;
};

const PREVIEW_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_PREVIEW_CACHE_ENTRIES = 200;
const previewCache = new Map<
  string,
  { value: RichLinkPreview; expiresAt: number }
>();
const previewRequests = new Map<string, Promise<RichLinkPreview>>();

const getCachedPreview = (cacheKey: string) => {
  const cached = previewCache.get(cacheKey);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    previewCache.delete(cacheKey);
    return null;
  }
  return cached.value;
};

const cachePreview = (cacheKey: string, value: RichLinkPreview) => {
  while (previewCache.size >= MAX_PREVIEW_CACHE_ENTRIES) {
    const oldestKey = previewCache.keys().next().value;
    if (!oldestKey) break;
    previewCache.delete(oldestKey);
  }
  previewCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + PREVIEW_CACHE_TTL_MS,
  });
};

const loadRichLinkPreview = (cacheKey: string, url: string) => {
  const cached = getCachedPreview(cacheKey);
  if (cached) return Promise.resolve(cached);

  const pending = previewRequests.get(cacheKey);
  if (pending) return pending;

  const request = getRichLinkPreview(url)
    .then((preview) => {
      cachePreview(cacheKey, preview);
      return preview;
    })
    .finally(() => previewRequests.delete(cacheKey));
  previewRequests.set(cacheKey, request);
  return request;
};

const segmentTimeLabel = (segment: SongLinkSegment) => {
  const start = formatYouTubeTimestamp(segment.startSeconds);
  return segment.endSeconds === undefined
    ? `${start} onward`
    : `${start}–${formatYouTubeTimestamp(segment.endSeconds)}`;
};

const segmentDisplayLabel = (segment: SongLinkSegment) =>
  segment.label?.trim() || segmentTimeLabel(segment);

const segmentControlLabel = (segment: SongLinkSegment) => {
  const label = segment.label?.trim();
  return label ? `${label} · ${segmentTimeLabel(segment)}` : segmentTimeLabel(segment);
};

const buildYouTubePlayerUrl = (
  embedUrl: string,
  segment: SongLinkSegment | null,
  fallbackStartSeconds?: number,
) => {
  const url = new URL(embedUrl);
  url.searchParams.set("autoplay", "1");
  url.searchParams.set("rel", "0");
  const startSeconds = segment?.startSeconds ?? fallbackStartSeconds;
  if (startSeconds) url.searchParams.set("start", String(startSeconds));
  if (segment?.endSeconds !== undefined) {
    url.searchParams.set("end", String(segment.endSeconds));
  }
  return url.toString();
};

const SongLinkPreview = ({ link, compact = false }: SongLinkPreviewProps) => {
  const reference = useMemo(() => getRichLinkReference(link.url), [link.url]);
  const youtube = useMemo(() => getYouTubeVideoReference(link.url), [link.url]);
  const [preview, setPreview] = useState<RichLinkPreview | null>(() =>
    reference ? getCachedPreview(reference.cacheKey) : null,
  );
  const [previewFailed, setPreviewFailed] = useState(false);
  const [isPlayerOpen, setIsPlayerOpen] = useState(false);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);

  const segments = useMemo(
    () =>
      reference?.provider === "youtube"
        ? (link.segments ?? []).filter(
            (segment) =>
              Number.isSafeInteger(segment.startSeconds) &&
              segment.startSeconds >= 0 &&
              (segment.endSeconds === undefined ||
                (Number.isSafeInteger(segment.endSeconds) &&
                  segment.endSeconds > segment.startSeconds)),
          )
        : [],
    [link.segments, reference?.provider],
  );

  useEffect(() => {
    if (!reference) {
      setPreview(null);
      setPreviewFailed(false);
      setIsPlayerOpen(false);
      return;
    }

    let active = true;
    setPreview(getCachedPreview(reference.cacheKey));
    setPreviewFailed(false);
    setIsPlayerOpen(false);
    void loadRichLinkPreview(reference.cacheKey, link.url)
      .then((result) => {
        if (active) setPreview(result);
      })
      .catch(() => {
        if (active) setPreviewFailed(true);
      });

    return () => {
      active = false;
    };
  }, [link.url, reference]);

  if (!reference) {
    return (
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "inline-flex items-center gap-1 rounded-md border border-gray-600 bg-gray-800 text-cyan-200 hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400",
          compact ? "max-w-44 px-1.5 py-1 text-xs" : "px-2 py-1 text-sm",
        )}
      >
        <span className="truncate">{link.label || link.url}</span>
        <ExternalLink className="size-3.5 shrink-0" aria-hidden />
      </a>
    );
  }

  const isYouTube = reference.provider === "youtube";
  const providerName = isYouTube ? "YouTube" : "Spotify";
  const title = preview?.title || link.label || `${providerName} link`;
  const thumbnailUrl = preview?.thumbnailUrl || youtube?.thumbnailUrl;
  const canonicalUrl = preview?.canonicalUrl || youtube?.watchUrl || link.url;
  const embedUrl = preview?.embedUrl || youtube?.embedUrl;
  const selectedSegment =
    segments.find((segment) => segment.id === selectedSegmentId) ?? null;
  const fullVideoStart = segments.length ? undefined : youtube?.startSeconds;
  const playerUrl = embedUrl
    ? isYouTube
      ? buildYouTubePlayerUrl(embedUrl, selectedSegment, fullVideoStart)
      : embedUrl
    : "";
  const modalTitle = selectedSegment
    ? `${title} — ${segmentDisplayLabel(selectedSegment)}`
    : title;
  const openPlayer = (segmentId: string | null) => {
    if (!embedUrl) return;
    setSelectedSegmentId(segmentId);
    setIsPlayerOpen(true);
  };
  const ProviderIcon = isYouTube ? Video : Music2;
  const providerColor = isYouTube ? "text-red-300" : "text-emerald-300";

  return (
    <>
      {compact ? (
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          <Button
            type="button"
            variant="none"
            padding="p-0"
            className="group max-w-52 overflow-hidden rounded border border-gray-600 bg-gray-800 pr-1.5 hover:bg-gray-700 max-md:min-h-0"
            aria-label={`Play ${title} in WorshipSync`}
            disabled={!embedUrl}
            onClick={() => openPlayer(null)}
          >
            <span
              className={cn(
                "relative flex h-8 shrink-0 items-center justify-center overflow-hidden bg-black",
                isYouTube ? "w-12" : "w-8",
              )}
            >
              {thumbnailUrl ? (
                <img
                  src={thumbnailUrl}
                  alt=""
                  loading="lazy"
                  className={cn(
                    "h-full w-full",
                    isYouTube ? "object-cover" : "object-contain",
                  )}
                />
              ) : (
                <ProviderIcon className={cn("size-4", providerColor)} aria-hidden />
              )}
              {isYouTube && thumbnailUrl ? (
                <Play
                  className="absolute inset-0 m-auto size-3.5 fill-white text-white drop-shadow"
                  aria-hidden
                />
              ) : null}
            </span>
            <span className="truncate text-xs font-medium text-cyan-100">
              {title}
            </span>
          </Button>
          {segments.map((segment) => (
            <Button
              key={segment.id}
              type="button"
              variant="tertiary"
              padding="px-1.5 py-1"
              className="max-w-40 text-xs text-gray-200 max-md:min-h-0"
              aria-label={`Play ${title}, ${segmentControlLabel(segment)}`}
              onClick={() => openPlayer(segment.id)}
            >
              <span className="truncate">{segmentControlLabel(segment)}</span>
            </Button>
          ))}
        </div>
      ) : (
        <article className="overflow-hidden rounded-lg border border-gray-700 bg-gray-900/60 sm:flex">
          <Button
            type="button"
            variant="none"
            padding="p-0"
            className={cn(
              "group relative w-full shrink-0 overflow-hidden rounded-none bg-black max-md:min-h-0",
              isYouTube ? "aspect-video sm:w-56" : "aspect-square sm:w-40",
            )}
            aria-label={`Play ${title} in WorshipSync`}
            disabled={!embedUrl}
            onClick={() => openPlayer(null)}
          >
            {thumbnailUrl ? (
              <img
                src={thumbnailUrl}
                alt=""
                loading="lazy"
                className={cn(
                  "h-full w-full transition-opacity group-hover:opacity-80",
                  isYouTube ? "object-cover" : "object-contain",
                )}
              />
            ) : (
              <ProviderIcon className={cn("size-10", providerColor)} aria-hidden />
            )}
            {isYouTube ? (
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="rounded-full bg-red-600/95 p-2 shadow-lg">
                  <Play className="size-5 fill-white text-white" aria-hidden />
                </span>
              </span>
            ) : null}
          </Button>
          <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5 p-3">
            <div className={cn("flex items-center gap-1.5 text-xs font-medium", providerColor)}>
              <ProviderIcon className="size-4" aria-hidden />
              {providerName}
            </div>
            <p className="line-clamp-2 text-sm font-semibold text-white">{title}</p>
            {preview?.creator ? (
              <p className="truncate text-xs text-gray-400">{preview.creator}</p>
            ) : null}
            {!preview && !previewFailed ? (
              <p className="text-xs text-gray-400">Loading link details…</p>
            ) : null}
            {previewFailed ? (
              <p className="text-xs text-gray-400">
                Link details are unavailable. You can still open the original link.
              </p>
            ) : null}
            {!isYouTube && embedUrl ? (
              <Button
                type="button"
                variant="tertiary"
                padding="px-2 py-1"
                className="mt-0.5 w-fit text-xs max-md:min-h-0"
                onClick={() => openPlayer(null)}
              >
                Listen in WorshipSync
              </Button>
            ) : null}
            <a
              href={canonicalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-0.5 inline-flex w-fit items-center gap-1 text-xs text-cyan-200 hover:text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            >
              Open on {providerName}
              <ExternalLink className="size-3" aria-hidden />
            </a>
            {segments.length ? (
              <div className="mt-1 flex flex-wrap gap-1.5" aria-label="Reference segments">
                <Button
                  type="button"
                  variant="tertiary"
                  padding="px-2 py-1"
                  className="text-xs max-md:min-h-0"
                  onClick={() => openPlayer(null)}
                >
                  Play full video
                </Button>
                {segments.map((segment) => (
                  <Button
                    key={segment.id}
                    type="button"
                    variant="tertiary"
                    padding="px-2 py-1"
                    className="max-w-full text-xs max-md:min-h-0"
                    aria-label={`Play ${title}, ${segmentControlLabel(segment)}`}
                    onClick={() => openPlayer(segment.id)}
                  >
                    <span className="truncate">{segmentControlLabel(segment)}</span>
                  </Button>
                ))}
              </div>
            ) : null}
          </div>
        </article>
      )}

      <Modal
        isOpen={isPlayerOpen}
        onClose={() => setIsPlayerOpen(false)}
        title={modalTitle}
        description={`${providerName} player for ${modalTitle}`}
        size="lg"
        zIndexLevel={2}
        contentPadding="p-0"
      >
        {playerUrl ? (
          <div
            className={cn("w-full bg-black", isYouTube && "aspect-video min-h-[200px]")}
            style={
              isYouTube
                ? undefined
                : { height: `${preview?.embedHeight || 352}px`, minHeight: "152px" }
            }
          >
            <iframe
              key={playerUrl}
              src={playerUrl}
              title={modalTitle}
              className="h-full w-full border-0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; gyroscope; picture-in-picture; web-share"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
            />
          </div>
        ) : null}
        {segments.length ? (
          <div
            className="flex flex-wrap gap-1.5 border-t border-gray-700 px-3 py-2"
            aria-label="Choose a reference segment"
          >
            <Button
              type="button"
              variant="tertiary"
              padding="px-2 py-1"
              className="text-xs max-md:min-h-0"
              isSelected={!selectedSegment}
              onClick={() => setSelectedSegmentId(null)}
            >
              Full video
            </Button>
            {segments.map((segment) => (
              <Button
                key={segment.id}
                type="button"
                variant="tertiary"
                padding="px-2 py-1"
                className="max-w-full text-xs max-md:min-h-0"
                isSelected={selectedSegment?.id === segment.id}
                onClick={() => setSelectedSegmentId(segment.id)}
              >
                <span className="truncate">{segmentControlLabel(segment)}</span>
              </Button>
            ))}
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-3 p-3">
          <p className="min-w-0 truncate text-xs text-gray-400">
            {selectedSegment
              ? segmentTimeLabel(selectedSegment)
              : preview?.creator || link.label || providerName}
          </p>
          <a
            href={canonicalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-1 text-sm text-cyan-200 hover:text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
          >
            Open on {providerName}
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        </div>
      </Modal>
    </>
  );
};

export default SongLinkPreview;
