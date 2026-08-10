import { Download, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { SongAudio } from "../../types";
import Button from "../Button/Button";
import { cn } from "../../utils/cnHelper";

type SongAudioPlayerProps = {
  audio: SongAudio;
  onGetUrl: (disposition: "inline" | "attachment") => Promise<string>;
  className?: string;
  showFileDetails?: boolean;
  showDownload?: boolean;
  compact?: boolean;
};

export const formatSongAudioBytes = (bytes: number) => {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const getMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

/**
 * Resolves private R2 URLs only when the operator asks to play or download.
 * The native audio element keeps seeking and mobile WebView playback behavior
 * in the browser instead of introducing a second playback state machine.
 */
const SongAudioPlayer = ({
  audio,
  onGetUrl,
  className,
  showFileDetails = true,
  showDownload = true,
  compact = false,
}: SongAudioPlayerProps) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [playRequest, setPlayRequest] = useState(0);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setAudioUrl(null);
    setError("");
    audioRef.current?.pause();
  }, [audio.id]);

  useEffect(() => {
    if (!audioUrl || playRequest === 0) return;
    void audioRef.current?.play().catch(() => {
      // Some browsers require one more direct interaction after async URL resolution.
    });
  }, [audioUrl, playRequest]);

  const handlePlay = async () => {
    setError("");
    setIsLoadingAudio(true);
    try {
      setAudioUrl(await onGetUrl("inline"));
      setPlayRequest((request) => request + 1);
    } catch (playError) {
      setError(getMessage(playError, "The MP3 could not be played. Try again."));
    } finally {
      setIsLoadingAudio(false);
    }
  };

  const handleDownload = async () => {
    setError("");
    setIsDownloading(true);
    try {
      const url = await onGetUrl("attachment");
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = audio.fileName || "song-reference.mp3";
      anchor.rel = "noreferrer";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch (downloadError) {
      setError(
        getMessage(downloadError, "The MP3 could not be downloaded. Try again."),
      );
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className={cn("rounded-md border border-gray-700 bg-gray-800/80 p-2", className)}>
      {showFileDetails ? (
        <div className="mb-2 min-w-0">
          <p className="truncate text-sm text-gray-100">{audio.fileName}</p>
          <p className="text-xs text-gray-400">
            {formatSongAudioBytes(audio.sizeBytes)}
          </p>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="tertiary"
          className={cn("text-sm", compact && "max-md:min-h-0")}
          svg={Play}
          disabled={isLoadingAudio}
          isLoading={isLoadingAudio}
          onClick={() => void handlePlay()}
        >
          Play
        </Button>
        {showDownload ? (
          <Button
            type="button"
            variant="tertiary"
            className={cn("text-sm", compact && "max-md:min-h-0")}
            svg={Download}
            disabled={isDownloading}
            isLoading={isDownloading}
            onClick={() => void handleDownload()}
          >
            Download
          </Button>
        ) : null}
      </div>
      {audioUrl ? (
        <audio
          ref={audioRef}
          className="mt-2 w-full"
          controls
          preload="metadata"
          src={audioUrl}
          aria-label={`Play ${audio.fileName}`}
        />
      ) : null}
      {error ? (
        <p className="mt-2 text-sm text-red-400" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
};

export default SongAudioPlayer;
