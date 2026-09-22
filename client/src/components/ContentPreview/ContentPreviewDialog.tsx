import {
  AudioLines,
  Copy,
  ExternalLink,
  FileQuestion,
  FileText,
  Image,
  LoaderCircle,
  Video,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import Button from "../Button/Button";
import Modal from "../Modal/Modal";
import YouTubePlaylistPlayer from "../YouTubePlaylistPlayer/YouTubePlaylistPlayer";
import type { YouTubePlaylistEntry } from "../YouTubePlaylistPlayer/youtubePlaylist";
import { openExternalUrl } from "../../utils/openExternalUrl";
import {
  getContentPreviewMediaLabel,
  getSafeHttpUrl,
  getYouTubePreviewVideoId,
  resolveContentPreviewResource,
  resolveExternalContentPreviewSource,
  type ContentPreviewKind,
  type ContentPreviewResource,
  type ContentPreviewResolvedSource,
} from "./contentPreview";

type ContentPreviewDialogProps = {
  resource: ContentPreviewResource | null;
  onClose: () => void;
};

type RenderStatus = "loading" | "ready" | "error";

const EMBED_TIMEOUT_MS = 7000;

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

const LoadingState = ({ label }: { label: string }) => (
  <div className="flex min-h-48 items-center justify-center gap-2 p-6 text-sm text-gray-300" role="status">
    <LoaderCircle className="size-4 animate-spin text-cyan-300" aria-hidden />
    {label}
  </div>
);

const PreviewFallback = ({
  kind,
  message,
  providerLabel,
}: {
  kind: ContentPreviewKind;
  message: string;
  providerLabel?: string;
}) => (
  <div className="flex min-h-40 flex-col items-center justify-center gap-2 p-6 text-center">
    <FileQuestion className="size-8 text-gray-500" aria-hidden />
    <h3 className="text-sm font-semibold text-gray-100">Preview unavailable</h3>
    <p className="max-w-md text-sm text-gray-300">{message}</p>
    {providerLabel ? <p className="text-xs text-gray-500">{providerLabel}</p> : null}
    {kind === "web" ? (
      <p className="max-w-md text-xs text-gray-400">
        Some websites block embedded previews for security reasons.
      </p>
    ) : null}
  </div>
);

const PreviewKindIcon = ({ kind }: { kind: ContentPreviewKind }) => {
  const Icon = kind === "image"
    ? Image
    : kind === "audio"
      ? AudioLines
      : kind === "video" || kind === "youtube"
        ? Video
        : kind === "document" || kind === "text"
          ? FileText
          : FileQuestion;
  return <Icon className="size-5 shrink-0 text-cyan-300" aria-hidden />;
};

const ContentPreviewDialog = ({ resource, onClose }: ContentPreviewDialogProps) => {
  const [source, setSource] = useState<ContentPreviewResolvedSource | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState("");
  const [renderStatus, setRenderStatus] = useState<RenderStatus>("loading");
  const [actionError, setActionError] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  const resourceKey = resource
    ? `${resource.id}:${resource.url || ""}:${resource.mediaId || ""}:${resource.mimeType || ""}`
    : "";
  const resolution = useMemo(
    () => resource ? resolveContentPreviewResource(resource, source) : null,
    [resource, source],
  );
  const kind = resolution?.renderer || "unsupported";
  const sourceUrl = resolution?.resolvedUrl || "";
  const externalUrl = resolution?.originalUrl || "";
  const title = resolution?.title || "Content preview";
  const metadataLabel = resolution
    ? `${resolution.providerLabel} • ${getContentPreviewMediaLabel(resolution.mediaType)}`
    : "";
  const youtubeVideoId = resolution?.mediaId || (resource ? getYouTubePreviewVideoId(resource) : null);
  const canOpenExternally = Boolean(getSafeHttpUrl(externalUrl));

  useEffect(() => {
    if (!resource) return;

    let active = true;
    const directUrl = getSafeHttpUrl(resource.url);
    setResolving(false);
    setSource(directUrl ? { url: directUrl, mimeType: resource.mimeType, fileName: resource.fileName } : null);
    setResolveError("");
    setActionError("");
    setCopyState("idle");
    setRenderStatus("loading");

    if (!resource.resolveSource) {
      if (!directUrl && resource.textContent === undefined) {
        setResolveError("This resource does not contain a previewable link.");
      }
      if (directUrl) {
        void resolveExternalContentPreviewSource(resource)
          .then((resolved) => {
            if (!active || !resolved) return;
            setSource(resolved);
          })
          .catch(() => {
            // Keep the validated direct URL as a graceful fallback when the
            // authenticated metadata/proxy service is temporarily unavailable.
          });
      }
      return () => {
        active = false;
      };
    }

    setResolving(true);
    void resource.resolveSource()
      .then((resolved) => {
        if (!active) return;
        const safeUrl = getSafeHttpUrl(resolved.url);
        if (!safeUrl) {
          setResolveError("This resource returned an unsupported URL.");
          return;
        }
        setSource({ ...resolved, url: safeUrl });
      })
      .catch((error) => {
        if (active) setResolveError(errorMessage(error, "This resource could not be opened."));
      })
      .finally(() => {
        if (active) setResolving(false);
      });

    return () => {
      active = false;
    };
  }, [resource, resourceKey]);

  useEffect(() => {
    if (!resource || resolving || resolveError) return;
    if (kind === "text") {
      setRenderStatus("ready");
      return;
    }
    if (kind === "unsupported") {
      setRenderStatus("error");
      return;
    }
    setRenderStatus("loading");
  }, [kind, resolveError, resource, resolving, sourceUrl]);

  useEffect(() => {
    if (
      !sourceUrl ||
      !["web", "document", "youtube"].includes(kind) ||
      resolving ||
      resolveError ||
      renderStatus !== "loading"
    ) return;
    const timer = window.setTimeout(() => setRenderStatus("error"), EMBED_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [kind, renderStatus, resolveError, resolving, sourceUrl]);

  const handleOpenExternal = async () => {
    if (!externalUrl) return;
    setActionError("");
    const opened = await openExternalUrl(externalUrl, { allowArbitraryHttps: true });
    if (!opened) setActionError("The external browser could not be opened.");
  };

  const handleCopyLink = async () => {
    if (!externalUrl || !navigator.clipboard?.writeText) {
      setCopyState("error");
      return;
    }
    try {
      await navigator.clipboard.writeText(externalUrl);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  };

  const handleMediaError = () => setRenderStatus("error");
  const handleMediaReady = () => setRenderStatus("ready");
  const waitingForSource = Boolean(resource?.url && !source && !resolveError);
  const showFallback = Boolean(resolveError) || (
    !resolving && Boolean(resolution && !resolution.canPreview)
  ) || (!resolving && renderStatus === "error");
  const fallbackMessage = resolveError || (
    kind === "web"
      ? "This site doesn’t allow an embedded preview."
      : kind === "document"
        ? "This document can’t be previewed here."
        : "This resource can’t be previewed here."
  );

  const youtubeQueue: YouTubePlaylistEntry[] = youtubeVideoId
    ? [{
        entryKey: resource?.id || "preview",
        songId: resource?.id || "preview",
        title,
        artist: metadataLabel,
        videoId: youtubeVideoId,
      }]
    : [];

  const renderPreview = () => {
    if (!resource || resolving || waitingForSource) return <LoadingState label="Preparing preview…" />;
    if (showFallback) return <PreviewFallback kind={kind} message={fallbackMessage} providerLabel={metadataLabel} />;
    if (kind === "text") {
      return (
        <pre className="max-h-[min(65vh,42rem)] overflow-auto whitespace-pre-wrap p-4 text-left text-sm text-gray-200">
          {resource.textContent || ""}
        </pre>
      );
    }
    if (kind === "youtube" && youtubeQueue.length) {
      return (
        <div className="relative aspect-video w-full bg-black p-2">
          {renderStatus === "loading" ? <LoadingState label="Loading video player…" /> : null}
          <YouTubePlaylistPlayer
            queue={youtubeQueue}
            mode="preview"
            onPlayerReady={handleMediaReady}
            onVideoUnavailable={handleMediaError}
          />
        </div>
      );
    }
    if (!sourceUrl) return <PreviewFallback kind={kind} message={fallbackMessage} providerLabel={metadataLabel} />;
    if (kind === "image") {
      return (
        <div className="flex min-h-56 w-full items-center justify-center bg-black p-2">
          {renderStatus === "loading" ? <LoadingState label="Loading image…" /> : null}
          <img src={sourceUrl} alt={title} className="max-h-[min(65vh,42rem)] max-w-full object-contain" onLoad={handleMediaReady} onError={handleMediaError} />
        </div>
      );
    }
    if (kind === "audio") {
      return (
        <div className="flex min-h-48 items-center justify-center p-4">
          {renderStatus === "loading" ? <LoadingState label="Loading audio…" /> : null}
          <audio controls className="w-full max-w-2xl" src={sourceUrl} aria-label={title} onCanPlay={handleMediaReady} onError={handleMediaError} />
        </div>
      );
    }
    if (kind === "video") {
      return (
        <div className="flex min-h-56 w-full items-center justify-center bg-black p-2">
          {renderStatus === "loading" ? <LoadingState label="Loading video…" /> : null}
          <video controls playsInline className="aspect-video max-h-[min(65vh,42rem)] w-full max-w-5xl object-contain" src={sourceUrl} aria-label={title} onCanPlay={handleMediaReady} onError={handleMediaError} />
        </div>
      );
    }
    if (kind === "document" || kind === "web") {
      return (
        <div className="relative h-[min(65vh,42rem)] min-h-56 bg-white">
          {renderStatus === "loading" ? <LoadingState label={kind === "web" ? "Loading embedded page…" : "Loading document…"} /> : null}
          <iframe
            title={title}
            src={sourceUrl}
            className="h-full w-full border-0"
            sandbox={kind === "web" ? "allow-forms allow-modals allow-popups allow-presentation allow-scripts" : ""}
            referrerPolicy="no-referrer"
            onLoad={handleMediaReady}
            onError={handleMediaError}
          />
        </div>
      );
    }
    return <PreviewFallback kind={kind} message={fallbackMessage} providerLabel={metadataLabel} />;
  };

  return (
    <Modal
      isOpen={Boolean(resource)}
      onClose={onClose}
      title={(
        <span className="flex min-w-0 items-start gap-2">
          <PreviewKindIcon kind={kind} />
          <span className="min-w-0">
            <span className="block truncate" title={externalUrl || sourceUrl}>{title}</span>
            {metadataLabel ? <span className="mt-0.5 block truncate text-xs font-normal text-gray-400">{metadataLabel}</span> : null}
          </span>
        </span>
      )}
      titleClassName="min-w-0 flex-1"
      headerClassName="items-start gap-3"
      description={`Preview of ${title}`}
      size={showFallback ? "md" : "xl"}
      zIndexLevel={2}
      contentPadding="p-0"
      headerAction={(
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
          {canOpenExternally ? (
            <Button type="button" variant="secondary" svg={ExternalLink} className="max-md:min-h-0" onClick={() => void handleOpenExternal()}>
              Open in new tab
            </Button>
          ) : null}
          {canOpenExternally ? (
            <Button type="button" variant="tertiary" svg={Copy} aria-label="Copy link" className="max-md:min-h-0" onClick={() => void handleCopyLink()}>
              <span className="sr-only">Copy link</span>
              {copyState === "copied" ? "Copied" : "Copy"}
            </Button>
          ) : null}
        </div>
      )}
    >
      {actionError ? <p className="border-b border-amber-800/60 bg-amber-950/30 px-4 py-2 text-xs text-amber-200" role="alert">{actionError}</p> : null}
      {copyState === "error" ? <p className="border-b border-amber-800/60 bg-amber-950/30 px-4 py-2 text-xs text-amber-200" role="alert">The link could not be copied.</p> : null}
      {renderPreview()}
    </Modal>
  );
};

export default ContentPreviewDialog;
