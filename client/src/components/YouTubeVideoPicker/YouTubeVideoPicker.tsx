import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Play, Search } from "lucide-react";

import { AuthApiError, searchYouTubeVideos, type YouTubeSearchResult } from "../../api/auth";
import Button from "../Button/Button";
import Input from "../Input/Input";
import Modal from "../Modal/Modal";
import YouTubePlaylistPlayer, {
  type YouTubePlaylistPlayerHandle,
} from "../YouTubePlaylistPlayer/YouTubePlaylistPlayer";
import type { YouTubePlaylistEntry } from "../YouTubePlaylistPlayer/youtubePlaylist";
import { buildYouTubeSearchQuery, formatYouTubeDuration } from "../../utils/youtubeSearch";

type YouTubeVideoPickerProps = {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  artist?: string;
  album?: string;
  onSelect: (result: YouTubeSearchResult) => void | Promise<void>;
};

const getErrorMessage = (error: unknown) => {
  if (error instanceof AuthApiError && error.message) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return "YouTube search could not be completed. Try again.";
};

const YouTubeVideoPicker = ({
  isOpen,
  onClose,
  title,
  artist,
  album,
  onSelect,
}: YouTubeVideoPickerProps) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<YouTubeSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectingVideoId, setSelectingVideoId] = useState<string | null>(null);
  const [previewResult, setPreviewResult] = useState<YouTubeSearchResult | null>(null);
  const [previewError, setPreviewError] = useState("");
  const previewPlayerRef = useRef<YouTubePlaylistPlayerHandle>(null);
  const requestIdRef = useRef(0);

  const runSearch = useCallback(
    async (nextQuery: string, forceRefresh = false) => {
      const requestId = ++requestIdRef.current;
      setIsLoading(true);
      setError("");
      try {
        const response = await searchYouTubeVideos({
          title,
          artist,
          album,
          query: nextQuery,
          forceRefresh,
        });
        if (requestId !== requestIdRef.current) return;
        setResults(response.results);
      } catch (searchError) {
        if (requestId !== requestIdRef.current) return;
        setResults([]);
        setError(getErrorMessage(searchError));
      } finally {
        if (requestId === requestIdRef.current) setIsLoading(false);
      }
    },
    [album, artist, title],
  );

  useEffect(() => {
    if (!isOpen) return;
    const generatedQuery = buildYouTubeSearchQuery({ title, artist, album });
    setQuery(generatedQuery);
    setResults([]);
    setSelectingVideoId(null);
    setPreviewResult(null);
    setPreviewError("");
    void runSearch(generatedQuery);
  }, [album, artist, isOpen, runSearch, title]);

  const previewQueue = useMemo<YouTubePlaylistEntry[]>(
    () =>
      previewResult
        ? [
            {
              entryKey: previewResult.videoId,
              songId: "youtube-preview",
              title: previewResult.title,
              artist: previewResult.channelName,
              videoId: previewResult.videoId,
              ...(previewResult.durationSeconds === undefined
                ? {}
                : { durationSeconds: previewResult.durationSeconds }),
            },
          ]
        : [],
    [previewResult],
  );

  const handleSubmit = () => {
    const nextQuery = query.trim();
    if (!nextQuery) {
      setError("Enter a search query first.");
      return;
    }
    void runSearch(nextQuery);
  };

  const handlePreview = (result: YouTubeSearchResult) => {
    setPreviewError("");
    if (previewResult?.videoId === result.videoId) {
      previewPlayerRef.current?.playEntry(result.videoId);
      return;
    }
    setPreviewResult(result);
  };

  const handleClose = () => {
    requestIdRef.current += 1;
    setIsLoading(false);
    setPreviewResult(null);
    setPreviewError("");
    onClose();
  };

  const handleSelect = async (result: YouTubeSearchResult) => {
    setSelectingVideoId(result.videoId);
    setError("");
    try {
      await onSelect(result);
      handleClose();
    } catch (selectionError) {
      setError(getErrorMessage(selectionError));
    } finally {
      setSelectingVideoId(null);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Find YouTube video"
      description="Search YouTube and link a video to this song."
      size="xl"
      zIndexLevel={2}
      contentPadding="p-0"
    >
      <div className="flex min-h-0 flex-col">
        <div className="border-b border-gray-700 p-4">
          <div className="flex items-end">
            <Input
              label="Search YouTube"
              labelClassName="text-gray-200"
              value={query}
              onChange={(value) => setQuery(String(value))}
              className="min-w-0 flex-1"
              endAdornment={
                <Button
                  type="button"
                  variant="secondary"
                  svg={Search}
                  padding="p-1"
                  iconSize="sm"
                  className="h-7 w-7 min-h-0 items-center justify-center"
                  aria-label="Search"
                  disabled={isLoading || !query.trim()}
                  isLoading={isLoading}
                  onClick={handleSubmit}
                />
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleSubmit();
                }
              }}
            />
          </div>
          {error ? <p className="mt-2 text-sm text-red-300" role="alert">{error}</p> : null}
        </div>

        <div className="scrollbar-variable max-h-[60vh] overflow-y-auto p-4">
          {isOpen && previewQueue.length ? (
            <YouTubePlaylistPlayer
              ref={previewPlayerRef}
              mode="preview"
              queue={previewQueue}
              autoPlayEntryKey={previewResult?.videoId}
              onVideoUnavailable={() => setPreviewError("This video is unavailable or cannot be embedded.")}
              previewAction={
                previewResult ? (
                  <Button
                    type="button"
                    variant="primary"
                    svg={Link}
                    padding="px-2 py-1"
                    className="text-xs max-md:min-h-0"
                    disabled={selectingVideoId !== null}
                    isLoading={selectingVideoId === previewResult.videoId}
                    onClick={() => void handleSelect(previewResult)}
                  >
                    Link video
                  </Button>
                ) : null
              }
            />
          ) : null}
          {previewError ? (
            <p className="mt-2 text-sm text-amber-200" role="status">
              {previewError}
            </p>
          ) : null}
          {isLoading && !results.length ? (
            <p className="py-8 text-center text-sm text-gray-300" role="status">
              Searching YouTube…
            </p>
          ) : null}
          {!isLoading && !error && !results.length ? (
            <p className="py-8 text-center text-sm text-gray-400">
              No videos found. Try a more specific query.
            </p>
          ) : null}
          <div className="grid gap-3 md:grid-cols-2">
            {results.map((result) => {
              const duration = formatYouTubeDuration(result.durationSeconds);
              return (
                <article
                  key={result.videoId}
                  className="flex min-w-0 gap-3 rounded-lg border border-gray-700 bg-gray-900/70 p-2"
                >
                  <img
                    src={result.thumbnail}
                    alt=""
                    loading="lazy"
                    className="h-20 w-32 shrink-0 rounded object-cover"
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <p className="line-clamp-2 text-sm font-semibold text-white" title={result.title}>
                      {result.title}
                    </p>
                    <p className="truncate text-xs text-gray-400">{result.channelName}</p>
                    {duration ? <p className="text-xs tabular-nums text-gray-400">{duration}</p> : null}
                    <div className="mt-auto flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        svg={Play}
                        variant="secondary"
                        padding="px-2 py-1"
                        className="text-xs max-md:min-h-0"
                        disabled={selectingVideoId !== null}
                        title={
                          result.embeddable === false
                            ? "This video cannot be previewed here"
                            : undefined
                        }
                        onClick={() => {
                          if (result.embeddable === false) {
                            setPreviewError("This video cannot be previewed here.");
                            return;
                          }
                          handlePreview(result);
                        }}
                      >
                        Preview
                      </Button>
                      <Button
                        type="button"
                        variant="primary"
                        svg={Link}
                        padding="px-2 py-1"
                        className="text-xs max-md:min-h-0"
                        disabled={selectingVideoId !== null || result.embeddable === false}
                        isLoading={selectingVideoId === result.videoId}
                        onClick={() => void handleSelect(result)}
                      >
                        Link video
                      </Button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default YouTubeVideoPicker;
