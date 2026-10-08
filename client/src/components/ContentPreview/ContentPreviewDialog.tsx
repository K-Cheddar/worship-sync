import Spinner from "@/components/Spinner/Spinner";
import {
  AudioLines,
  Copy,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  FileQuestion,
  FileText,
  Image,
  Video,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import Button from "../Button/Button";
import Modal from "../Modal/Modal";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../ui/DropdownMenu";
import YouTubePlaylistPlayer from "../YouTubePlaylistPlayer/YouTubePlaylistPlayer";
import DocxPreview from "./DocxPreview";
import type { YouTubePlaylistEntry } from "../YouTubePlaylistPlayer/youtubePlaylist";
import ServiceFlowRichText from "../ServiceFlowRichText/ServiceFlowRichText";
import { isRichTextEmpty } from "../../types/richText";
import { openExternalUrl } from "../../utils/openExternalUrl";
import {
  getContentPreviewMediaLabel,
  getSafeHttpUrl,
  getYouTubePreviewVideoId,
  resolveContentPreviewResource,
  resolvePreviewSource,
  type ContentPreviewKind,
  type ContentPreviewResource,
  type ContentPreviewResolvedSource,
} from "./contentPreview";
import { createPreviewSourceCache, type PreviewSourceCache } from "./previewSourceCache";

export type ContentPreviewNavigation = {
  index: number;
  total: number;
  onPrevious?: () => void;
  onNext?: () => void;
};

type ContentPreviewDialogProps = {
  resource: ContentPreviewResource | null;
  onClose: () => void;
  dialogLabel?: string;
  metadata?: ReactNode;
  secondaryInfo?: ReactNode;
  menuActions?: ReactNode;
  navigation?: ContentPreviewNavigation;
  sourceCache?: PreviewSourceCache;
};

type RenderStatus = "loading" | "slow" | "ready" | "error";

const EMBED_TIMEOUT_MS = 7000;
const PREVIEW_FAILURE_TIMEOUT_MS = 30000;

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

const LoadingState = ({ label, slow = false }: { label: string; slow?: boolean }) => (
  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-gray-950/75 p-6 text-center text-sm text-gray-200" role="status">
    {slow ? null : (
      <Spinner size="sm" className="shrink-0 text-cyan-300" />
    )}
    {slow ? <span>This preview is taking longer than expected.</span> : <span>{label}</span>}
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
  <div className="flex h-full min-h-56 w-full flex-col items-center justify-center gap-2 p-6 text-center">
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
        : kind === "pdf" || kind === "docx" || kind === "text"
          ? FileText
          : FileQuestion;
  return <Icon className="size-5 shrink-0 text-cyan-300" aria-hidden />;
};

const ContentPreviewDialog = ({ resource, onClose, dialogLabel, metadata, secondaryInfo, menuActions, navigation, sourceCache }: ContentPreviewDialogProps) => {
  const [localCache] = useState(createPreviewSourceCache);
  const cache = sourceCache || localCache;
  const [sourceResourceKey, setSourceResourceKey] = useState("");
  const [source, setSource] = useState<ContentPreviewResolvedSource | null>(null);
  const [resolvedText, setResolvedText] = useState("");
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState("");
  const [renderStatus, setRenderStatus] = useState<RenderStatus>("loading");
  const [actionError, setActionError] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [openingExternal, setOpeningExternal] = useState(false);
  const [copyingLink, setCopyingLink] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const actionGenerationRef = useRef(0);

  const resourceKey = resource
    ? resource.cacheKey || `${resource.id}:${resource.url || ""}:${resource.mediaId || ""}:${resource.mimeType || ""}:${resource.fileName || ""}`
    : "";
  const currentResourceKey = useRef(resourceKey);
  currentResourceKey.current = resourceKey;
  const resolution = useMemo(
    () => resource ? resolveContentPreviewResource(resource, sourceResourceKey === resourceKey ? source : null) : null,
    [resource, source, sourceResourceKey, resourceKey],
  );
  const kind = resolution?.renderer || "unsupported";
  const sourceUrl = resolution?.resolvedUrl || "";
  const externalUrl = resolution?.originalUrl || "";
  const title = resolution?.title || "Content preview";
  const metadataLabel = resolution
    ? `${resolution.providerLabel} • ${getContentPreviewMediaLabel(resolution.renderer)}`
    : "";
  const youtubeVideoId = resolution?.mediaId || (resource ? getYouTubePreviewVideoId(resource) : null);
  const canOpenExternally = Boolean(getSafeHttpUrl(externalUrl));

  useEffect(() => {
    actionGenerationRef.current += 1;
    if (!resource) {
      setExpanded(false);
      setSourceResourceKey("");
      return;
    }

    let active = true;
    const controller = new AbortController();
    const resolutionTimer = window.setTimeout(() => {
      active = false;
      controller.abort();
      setResolving(false);
      setResolveError("The preview could not be prepared in time. Open or download the file to view it.");
    }, PREVIEW_FAILURE_TIMEOUT_MS);
    const directUrl = getSafeHttpUrl(resource.url);
    setResolving(Boolean(directUrl && !resource.resolveSource));
    setSource(null);
    setSourceResourceKey(resourceKey);
    setResolvedText("");
    setResolveError("");
    setActionError("");
    setCopyState("idle");
    setOpeningExternal(false);
    setCopyingLink(false);
    setRenderStatus("loading");

    if (!resource.resolveSource) {
      if (!directUrl) window.clearTimeout(resolutionTimer);
      if (!directUrl && resource.textContent === undefined) {
        setResolveError("This resource does not contain a previewable link.");
      }
      if (directUrl) {
        void resolvePreviewSource(resource, cache)
          .then((resolved) => {
            if (!active) return;
            if (!resolved) {
              setResolveError("This resource could not be resolved for preview.");
              return;
            }
            setSource(resolved);
            if (resolveContentPreviewResource(resource, resolved).renderer === "text" && resolved.url && resource.textContent === undefined) {
              return fetch(resolved.url, { credentials: "omit", referrerPolicy: "no-referrer", signal: controller.signal })
                .then((response) => {
                  if (!response.ok) throw new Error("This text file could not be opened.");
                  return response.text();
                })
                .then((content) => { if (active) setResolvedText(content); });
            }
          })
          .catch((error) => {
            if (active) {
              setResolveError(errorMessage(
                error,
                "This resource could not be resolved for preview.",
              ));
            }
          })
          .finally(() => {
            window.clearTimeout(resolutionTimer);
            if (active) setResolving(false);
          });
      }
      return () => {
        window.clearTimeout(resolutionTimer);
        active = false;
        controller.abort();
        actionGenerationRef.current += 1;
      };
    }

    setResolving(true);
    void resolvePreviewSource(resource, cache)
      .then((resolved) => {
        if (!active) return;
        if (!resolved) throw new Error("This resource could not be resolved for preview.");
        const safeUrl = getSafeHttpUrl(resolved.url);
        if (!safeUrl) {
          setResolveError("This resource returned an unsupported URL.");
          return;
        }
        setSource({ ...resolved, url: safeUrl });
        if (resolveContentPreviewResource(resource, resolved).renderer === "text" && resource.textContent === undefined) {
          return fetch(safeUrl, { credentials: "omit", referrerPolicy: "no-referrer", signal: controller.signal })
            .then((response) => {
              if (!response.ok) throw new Error("This text file could not be opened.");
              return response.text();
            })
            .then((content) => { if (active) setResolvedText(content); });
        }
      })
      .catch((error) => {
        if (active) setResolveError(errorMessage(error, "This resource could not be opened."));
      })
      .finally(() => {
        window.clearTimeout(resolutionTimer);
        if (active) setResolving(false);
      });

    return () => {
      window.clearTimeout(resolutionTimer);
      active = false;
      controller.abort();
      actionGenerationRef.current += 1;
    };
  }, [resource, resourceKey, cache]);

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
      !["web", "pdf", "docx", "youtube"].includes(kind) ||
      resolving ||
      resolveError ||
      (renderStatus !== "loading" && renderStatus !== "slow")
    ) return;
    const timer = window.setTimeout(
      () => setRenderStatus(renderStatus === "loading" ? "slow" : "error"),
      renderStatus === "loading" ? EMBED_TIMEOUT_MS : PREVIEW_FAILURE_TIMEOUT_MS - EMBED_TIMEOUT_MS,
    );
    return () => window.clearTimeout(timer);
  }, [kind, renderStatus, resolveError, resolving, sourceUrl]);

  const handleOpenExternal = async () => {
    if (!externalUrl || openingExternal) return;
    const actionGeneration = actionGenerationRef.current;
    setOpeningExternal(true);
    setActionError("");
    try {
      const opened = await openExternalUrl(externalUrl, { allowArbitraryHttps: true });
      if (actionGenerationRef.current === actionGeneration && !opened) {
        setActionError("The external browser could not be opened.");
      }
    } catch {
      if (actionGenerationRef.current === actionGeneration) {
        setActionError("The external browser could not be opened.");
      }
    } finally {
      if (actionGenerationRef.current === actionGeneration) setOpeningExternal(false);
    }
  };

  const handleCopyLink = async () => {
    if (copyingLink) return;
    const actionGeneration = actionGenerationRef.current;
    setCopyingLink(true);
    setCopyState("idle");
    if (!externalUrl || !navigator.clipboard?.writeText) {
      if (actionGenerationRef.current === actionGeneration) {
        setCopyState("error");
        setCopyingLink(false);
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(externalUrl);
      if (actionGenerationRef.current === actionGeneration) setCopyState("copied");
    } catch {
      if (actionGenerationRef.current === actionGeneration) setCopyState("error");
    } finally {
      if (actionGenerationRef.current === actionGeneration) setCopyingLink(false);
    }
  };

  const handleMediaError = useCallback(() => {
    if (currentResourceKey.current === resourceKey) setRenderStatus("error");
  }, [resourceKey]);
  const handleMediaReady = useCallback(() => {
    if (currentResourceKey.current === resourceKey) setRenderStatus((current) => current === "error" ? current : "ready");
  }, [resourceKey]);
  const switchingResource = sourceResourceKey !== resourceKey;
  const waitingForSource = switchingResource || Boolean(resource && !source && !resolveError && (resource.url || resource.resolveSource));
  const showFallback = Boolean(resolveError) || (
    !resolving && Boolean(resolution && kind === "unsupported")
  ) || (!resolving && renderStatus === "error");
  const fallbackMessage = resolveError || (
    resolution?.reason
      ? resolution.reason
      : kind === "web"
      ? "This site doesn’t allow an embedded preview."
      : kind === "pdf" || kind === "docx"
        ? "This document could not be loaded. Open or download the file to view it."
        : kind === "unsupported" && resolution?.fileName
          ? "This file format isn’t supported for preview."
        : "This resource can’t be previewed here."
  );

  const youtubeQueue: YouTubePlaylistEntry[] = youtubeVideoId
    ? [{
        entryKey: resource?.id || "preview",
        songId: resource?.id || "preview",
        title,
        artist: metadataLabel,
        videoId: youtubeVideoId,
        playbackRanges: [{}],
      }]
    : [];

  const renderPreviewContent = () => {
    if (!resource || resolving || waitingForSource) return null;
    if (showFallback) return <PreviewFallback kind={kind} message={fallbackMessage} providerLabel={metadataLabel} />;
    if (kind === "text") {
      if (resource.richTextContent && !isRichTextEmpty(resource.richTextContent)) {
        return (
          <div className="h-full w-full overflow-auto p-4">
            <ServiceFlowRichText
              document={resource.richTextContent}
              className="text-left text-neutral-100"
            />
          </div>
        );
      }
      return (
        <div className="h-full w-full overflow-auto whitespace-pre-wrap p-4 text-left text-sm text-neutral-100">
          {resource.textContent ?? resolvedText}
        </div>
      );
    }
    if (kind === "youtube" && youtubeQueue.length) {
      return (
        <div className="flex h-full w-full items-center justify-center bg-black p-2">
          <div className={`w-full max-w-5xl ${renderStatus === "ready" ? "" : "invisible"}`}>
            <YouTubePlaylistPlayer
              queue={youtubeQueue}
              mode="preview"
              onPlayerReady={handleMediaReady}
              onVideoUnavailable={handleMediaError}
            />
          </div>
        </div>
      );
    }
    if (!sourceUrl) return <PreviewFallback kind={kind} message={fallbackMessage} providerLabel={metadataLabel} />;
    if (kind === "image") {
      return (
        <div className="flex h-full w-full items-center justify-center bg-black p-2">
          <img src={sourceUrl} alt={title} className={`max-h-full max-w-full object-contain ${renderStatus === "ready" ? "" : "invisible"}`} onLoad={handleMediaReady} onError={handleMediaError} />
        </div>
      );
    }
    if (kind === "audio") {
      return (
        <div className="flex h-full w-full items-center justify-center p-4">
          <audio controls className={`w-full max-w-2xl ${renderStatus === "ready" ? "" : "invisible"}`} src={sourceUrl} aria-label={title} onCanPlay={handleMediaReady} onError={handleMediaError} />
        </div>
      );
    }
    if (kind === "video") {
      return (
        <div className="flex h-full w-full items-center justify-center bg-black p-2">
          <video controls playsInline className={`aspect-video max-h-full w-full max-w-5xl object-contain ${renderStatus === "ready" ? "" : "invisible"}`} src={sourceUrl} aria-label={title} onCanPlay={handleMediaReady} onError={handleMediaError} />
        </div>
      );
    }
    if (kind === "docx") {
      return (
        <div className={`h-full w-full ${renderStatus === "ready" ? "" : "invisible"}`}>
          <DocxPreview key={`${resourceKey}:${sourceUrl}`} url={sourceUrl} onReady={handleMediaReady} onError={handleMediaError} />
        </div>
      );
    }
    if (kind === "pdf" || kind === "web") {
      return (
        <div data-testid="document-preview-container" className="relative h-full min-h-0 w-full bg-white">
          <iframe
            title={title}
            src={sourceUrl}
            className={`h-full w-full border-0 ${renderStatus === "ready" ? "" : "invisible"}`}
            sandbox={kind === "web" ? "allow-forms allow-modals allow-popups allow-presentation allow-scripts" : undefined}
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
      title={<span className="flex min-w-0 items-center gap-2"><PreviewKindIcon kind={kind} /><span className="truncate">{title}</span></span>}
      titleClassName="min-w-0 truncate text-lg"
      headerClassName="gap-3 pb-0"
      description={`Preview of ${title}`}
      ariaLabel={dialogLabel}
      size={expanded ? "full" : "xl"}
      zIndexLevel={2}
      contentPadding="p-0"
      headerAction={(
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
          {navigation ? <div className="flex items-center gap-1" role="group" aria-label="Preview navigation">
            <Button type="button" variant="tertiary" svg={ChevronLeft} aria-label="Previous resource" disabled={navigation.index <= 0 || !navigation.onPrevious} onClick={navigation.onPrevious} />
            <span className="whitespace-nowrap text-xs text-gray-300" aria-live="polite">{navigation.index + 1} of {navigation.total}</span>
            <Button type="button" variant="tertiary" svg={ChevronRight} aria-label="Next resource" disabled={navigation.index >= navigation.total - 1 || !navigation.onNext} onClick={navigation.onNext} />
          </div> : null}
          <Button type="button" variant="tertiary" svg={expanded ? Minimize2 : Maximize2} aria-label={expanded ? "Exit expanded preview" : "Expand preview"} onClick={() => setExpanded((current) => !current)} />
          {canOpenExternally ? (
            <Button type="button" variant="tertiary" svg={ExternalLink} aria-label={openingExternal ? "Opening in new tab" : "Open in new tab"} title="Open in new tab" className="max-md:min-h-0" isLoading={openingExternal} disabled={openingExternal} onClick={() => void handleOpenExternal()} />
          ) : null}
          {(canOpenExternally || menuActions) ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="tertiary" svg={MoreHorizontal} aria-label="More preview actions" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                // Modal content uses z-55; keep its portaled menu above the modal surface.
                className="z-[60]"
              >
                {canOpenExternally ? (
                  <DropdownMenuItem disabled={copyingLink} onSelect={(event) => { event.preventDefault(); void handleCopyLink(); }}>
                    <Copy />{copyingLink ? "Copying link…" : copyState === "copied" ? "Link copied" : "Copy link"}
                  </DropdownMenuItem>
                ) : null}
                {menuActions ? <>{canOpenExternally ? <DropdownMenuSeparator /> : null}{menuActions}</> : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      )}
    >
      {actionError ? <p className="border-b border-amber-800/60 bg-amber-950/30 px-4 py-2 text-xs text-amber-200" role="alert">{actionError}</p> : null}
      {copyState === "error" ? <p className="border-b border-amber-800/60 bg-amber-950/30 px-4 py-2 text-xs text-amber-200" role="alert">The link could not be copied.</p> : null}
      <div className="flex min-h-8 w-full shrink-0 flex-wrap items-center gap-x-2 border-b border-gray-700 px-4 pb-1 pt-0 text-xs leading-5 text-gray-400">
        {metadataLabel ? <span>{metadataLabel}</span> : null}
        {metadata ? <span>· {metadata}</span> : null}
      </div>
      {secondaryInfo ? <div className="shrink-0 px-4 pb-2 text-xs text-gray-400">{secondaryInfo}</div> : null}
      <div key={resourceKey} data-testid="preview-stage" className={`relative flex min-h-56 w-full items-center justify-center overflow-hidden ${expanded ? "min-h-0 flex-1" : "h-[min(65vh,42rem)]"} ${kind === "text" ? "bg-gray-900" : "bg-gray-950"}`}>
        {renderPreviewContent()}
        {(resolving || waitingForSource || renderStatus === "loading" || renderStatus === "slow") && (switchingResource || !showFallback) ? (
          <LoadingState slow={renderStatus === "slow"} label={resolving || waitingForSource ? "Preparing preview…" : kind === "web" ? "Loading embedded page…" : kind === "pdf" || kind === "docx" ? "Loading document…" : kind === "youtube" ? "Loading video player…" : `Loading ${kind}…`} />
        ) : null}
      </div>
    </Modal>
  );
};

export default ContentPreviewDialog;
