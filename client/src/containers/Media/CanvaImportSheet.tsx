import { useContext, useEffect, useMemo, useState } from "react";
import { ExternalLink, Image as ImageIcon, Link2, Search, Video } from "lucide-react";
import { useNavigate } from "react-router-dom";
import Button from "../../components/Button/Button";
import Checkbox from "../../components/Checkbox/Checkbox";
import Input from "../../components/Input/Input";
import MultiSelectSubsetTick from "../../components/MultiSelectSubsetTick/MultiSelectSubsetTick";
import SelectAllButton from "../../components/SelectAllButton";
import SegmentedControl from "../../components/SegmentedControl/SegmentedControl";
import Spinner from "../../components/Spinner/Spinner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../../components/ui/sheet";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  lineTabsListShellClassName,
  lineTabsTriggerClassName,
} from "../../components/ui/tabs";
import { GlobalInfoContext } from "../../context/globalInfo";
import { useToast } from "../../context/toastContext";
import {
  getCanvaStatus,
  getCanvaDesign,
  importCanvaDesign,
  listCanvaDesigns,
  resolveCanvaDesignLink,
  type CanvaDesign,
  type CanvaMp4ImportMode,
} from "../../api/canva";
import type { mediaInfoType } from "./cloudinaryTypes";
import type { MuxUploadResult } from "./MediaUploadInput.types";
import type { MediaType } from "../../types";
import { isElectron } from "../../utils/environment";
import {
  canvaSourcesMatch,
  getCanvaMediaSource,
  isCanvaSourceCurrent,
} from "./canvaMediaSource";
import { isCanvaShortLink, parseCanvaDesignId } from "./canvaDesignUrl";
import {
  cleanupCanvaAssetsByLifecycle,
  type CanvaAssetLifecycle,
  type CanvaImportedAsset,
} from "../../utils/canvaImportCleanup";
import { formatCanvaImportError } from "../../utils/canvaImportError";
import { useTransfers } from "../../context/transferContext";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImageComplete: (info: mediaInfoType) => MediaType | void | Promise<MediaType | void>;
  onVideoComplete: (info: MuxUploadResult) => MediaType | void | Promise<MediaType | void>;
  onImageRefresh: (info: mediaInfoType, mediaId: string) => void | boolean | Promise<void | boolean>;
  onVideoRefresh: (
    info: MuxUploadResult,
    mediaId: string,
  ) => void | boolean | Promise<void | boolean>;
  onUnprocessedAssetCleanup?: (asset: CanvaImportedAsset) => Promise<boolean>;
  /** Optionally build a custom item from the imported Canva media. */
  onCreateDeckItem?: (
    pages: MediaType[],
    designTitle: string,
    options?: { navigateToItem?: boolean; idempotencyKey?: string },
  ) => string | void | Promise<string | void>;
  existingMedia: readonly MediaType[];
  getCurrentMedia?: () => readonly MediaType[];
  sourceMedia?: MediaType | null;
};

const openCanvaDesign = async (url: string) => {
  if (isElectron() && window.electronAPI?.openExternalUrl) {
    await window.electronAPI.openExternalUrl(url);
    return true;
  }
  return Boolean(window.open(url, "_blank", "noopener,noreferrer"));
};

const CanvaImportSheet = ({
  open,
  onOpenChange,
  onImageComplete,
  onVideoComplete,
  onImageRefresh,
  onVideoRefresh,
  onUnprocessedAssetCleanup,
  onCreateDeckItem,
  existingMedia,
  getCurrentMedia,
  sourceMedia,
}: Props) => {
  const { churchId = "" } = useContext(GlobalInfoContext) || {};
  const { showToast } = useToast();
  const { startCanvaTransfer } = useTransfers();
  const navigate = useNavigate();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [designs, setDesigns] = useState<CanvaDesign[]>([]);
  const [selectedDesign, setSelectedDesign] = useState<CanvaDesign | null>(null);
  const [pages, setPages] = useState<number[]>([]);
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState("");
  const [designLink, setDesignLink] = useState("");
  const [isOpeningLink, setIsOpeningLink] = useState(false);
  const [createDeckItem, setCreateDeckItem] = useState(true);
  const [format, setFormat] = useState<"png" | "mp4">("png");
  const [mp4ImportMode, setMp4ImportMode] =
    useState<CanvaMp4ImportMode>("combined");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const isImportPending = false;
  const requestedSource = useMemo(
    () => (sourceMedia ? getCanvaMediaSource(sourceMedia) : null),
    [sourceMedia],
  );
  const mediaSources = useMemo(
    () =>
      existingMedia.flatMap((mediaItem) => {
        const source = getCanvaMediaSource(mediaItem);
        return source ? [{ mediaItem, source }] : [];
      }),
    [existingMedia],
  );

  const loadDesigns = async (search = "") => {
    if (!churchId) return;
    setIsLoading(true);
    setError("");
    try {
      const result = await listCanvaDesigns(churchId, search);
      setDesigns(result.items);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load Canva designs. Try again.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!open || !churchId) return;
    let active = true;
    setConnected(null);
    setSelectedDesign(null);
    setPages([]);
    setSelectedPages(new Set());
    setFormat("png");
    setCreateDeckItem(true);
    setDesignLink("");
    setError("");
    void getCanvaStatus(churchId)
      .then((status) => {
        if (!active) return;
        setConnected(status.connected);
        if (!status.connected) return;
        if (requestedSource) {
          void listCanvaDesigns(churchId)
            .then((result) => {
              if (active) setDesigns(result.items);
            })
            .catch(() => {
              // Keep the source workflow available. Change design retries visibly.
            });
          setIsLoading(true);
          void getCanvaDesign(churchId, requestedSource.designId)
            .then((design) => {
              if (!active) return;
              chooseDesign(design, requestedSource);
            })
            .catch((loadError) => {
              if (!active) return;
              setError(
                loadError instanceof Error
                  ? loadError.message
                  : "Could not load that Canva design. Choose another design or try again.",
              );
            })
            .finally(() => {
              if (active) setIsLoading(false);
            });
        } else {
          void loadDesigns();
        }
      })
      .catch((statusError) => {
        if (!active) return;
        setConnected(false);
        setError(
          statusError instanceof Error
            ? statusError.message
            : "Could not check the Canva connection. Try again.",
        );
      });
    return () => {
      active = false;
    };
    // loadDesigns intentionally starts only after the status request resolves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, churchId]);

  const chooseDesign = (
    design: CanvaDesign,
    initialSource = requestedSource,
  ) => {
    setSelectedDesign(design);
    setError("");
    const nextPages = Array.from(
      { length: Math.max(1, design.pageCount) },
      (_, index) => index + 1,
    );
    setPages(nextPages);
    const sourceMatchesDesign = initialSource?.designId === design.id;
    setSelectedPages(
      new Set(
        sourceMatchesDesign && initialSource.pageNumbers.length
          ? initialSource.pageNumbers
          : [1],
      ),
    );
    if (sourceMatchesDesign) setFormat(initialSource.format);
  };

  const openDesignFromLink = async () => {
    if (!churchId) return;
    let designId = parseCanvaDesignId(designLink);
    if (!designId && isCanvaShortLink(designLink)) {
      try {
        const resolved = await resolveCanvaDesignLink(churchId, designLink);
        designId = parseCanvaDesignId(resolved.designId);
      } catch (resolveError) {
        setError(
          resolveError instanceof Error
            ? resolveError.message
            : "That Canva short link could not be resolved.",
        );
        return;
      }
    }
    if (!designId) {
      setError(
        "Paste a Canva design link or design id.",
      );
      return;
    }
    setIsOpeningLink(true);
    setError("");
    try {
      const design = await getCanvaDesign(churchId, designId);
      chooseDesign(design);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not open that Canva design. Share it with the church account, then try again.",
      );
    } finally {
      setIsOpeningLink(false);
    }
  };

  const changeDesign = () => {
    setSelectedDesign(null);
    if (!designs.length) void loadDesigns(query);
  };

  const editCanvaDesign = async () => {
    if (!selectedDesign?.editUrl) return;
    try {
      const opened = await openCanvaDesign(selectedDesign.editUrl);
      if (opened) return;
      showToast(
        "Canva did not open. Allow pop-ups for WorshipSync, then try again.",
        "error",
      );
    } catch {
      showToast(
        "Canva did not open. Check your connection, then try again.",
        "error",
      );
    }
  };

  const togglePage = (pageNumber: number) => {
    if (isImportPending) return;
    if (!selectedPages.has(pageNumber) && selectedPages.size >= 25) {
      setError("Import up to 25 pages at a time. Clear a page before adding another.");
      return;
    }
    setError("");
    setSelectedPages((current) => {
      const next = new Set(current);
      if (next.has(pageNumber)) next.delete(pageNumber);
      else next.add(pageNumber);
      return next;
    });
  };

  const toggleAllPages = () => {
    if (isImportPending || pages.length > 25) return;
    setError("");
    setSelectedPages((current) => {
      const allSelected = pages.every((pageNumber) => current.has(pageNumber));
      return allSelected ? new Set() : new Set(pages);
    });
  };

  const mediaFromRefreshedImage = (
    refreshTarget: MediaType,
    data: mediaInfoType,
  ): MediaType => ({
    ...refreshTarget,
    updatedAt: new Date().toISOString(),
    format: data.format || refreshTarget.format,
    height: data.height ?? refreshTarget.height,
    width: data.width ?? refreshTarget.width,
    publicId: data.public_id || refreshTarget.publicId,
    background: data.secure_url || refreshTarget.background,
    thumbnail:
      data.thumbnail_url || data.secure_url || refreshTarget.thumbnail,
    placeholderImage: "",
    source: "cloudinary",
    canvaImportKey: data.canvaImportKey,
    canvaSource: data.canvaSource,
  });

  const mediaFromRefreshedVideo = (
    refreshTarget: MediaType,
    data: MuxUploadResult,
  ): MediaType => ({
    ...refreshTarget,
    updatedAt: new Date().toISOString(),
    format: "m3u8",
    publicId: data.playbackId,
    background: data.playbackUrl,
    thumbnail: data.thumbnailUrl,
    placeholderImage: data.thumbnailUrl,
    source: "mux",
    muxPlaybackId: data.playbackId,
    muxAssetId: data.assetId,
    canvaImportKey: data.canvaImportKey,
    canvaSource: data.canvaSource,
  });

  const importSelected = async () => {
    if (isImportPending || !selectedDesign || selectedPages.size === 0) return;
    const design = selectedDesign;
    const importPages = [...selectedPages].sort((a, b) => a - b);
    const importFormat = format;
    const importMode = mp4ImportMode;
    const includeCustomItem = createDeckItem;
    let customItemPages: MediaType[] = [];
    let mediaAtExecution: readonly MediaType[] = [];
    let cleanupRetryAssets: CanvaImportedAsset[] = [];
    let cleanupRetryLifecycle: CanvaAssetLifecycle[] = [];
    const retryCanvaCleanup = async () => {
      if (!onUnprocessedAssetCleanup || cleanupRetryAssets.length === 0) return;
      const failures = await cleanupCanvaAssetsByLifecycle(
        cleanupRetryAssets,
        cleanupRetryLifecycle,
        onUnprocessedAssetCleanup,
      );
      cleanupRetryAssets = failures;
      cleanupRetryLifecycle = failures.map(() => "cleanup-pending");
      if (failures.length) {
        throw new Error(`${failures.length} Canva asset${failures.length === 1 ? " could" : "s could"} not be removed. Try cleanup again.`);
      }
    };
    const transferId = `canva-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const customItemIdempotencyKey = `canva-custom-${transferId}`;
    const getLatestMedia = () => getCurrentMedia?.() || existingMedia;
    const createImportRequest = () => {
      const latestMedia = getLatestMedia();
      const designImportKeyPrefix = `canva:${design.id}:`;
      const existingImportKeys = latestMedia
        .map((item) => item.canvaImportKey)
        .filter((key): key is string => typeof key === "string" && key.startsWith(designImportKeyPrefix));
      const replacementAssets = latestMedia.flatMap((mediaItem) => {
        const source = getCanvaMediaSource(mediaItem);
        if (!source || source.designId !== design.id || source.format !== importFormat || !source.pageNumbers?.length) return [];
        const provider = mediaItem.providerStorage?.provider;
        const assetId = provider === "mux" ? mediaItem.providerStorage?.assetId || mediaItem.muxAssetId
          : provider === "cloudinary" ? mediaItem.providerStorage?.publicId || mediaItem.publicId
            : mediaItem.source === "mux" ? mediaItem.muxAssetId
              : mediaItem.source === "cloudinary" ? mediaItem.publicId : "";
        if (!assetId) return [];
        return [{ provider: provider === "mux" || mediaItem.source === "mux" ? "muxMinutes" as const : "cloudinaryBytes" as const, assetId, revision: source.revision, preferred: mediaItem.id === sourceMedia?.id, pageNumbers: [...source.pageNumbers].sort((a, b) => a - b) }];
      });
      return { designId: design.id, pages: importPages, format: importFormat, ...(importFormat === "mp4" ? { mp4ImportMode: importMode } : {}), existingImportKeys, ...(replacementAssets.length ? { replacementAssets } : {}) };
    };
    setError("");
    try {
      startCanvaTransfer({
        id: transferId,
        title: design.title,
        format: importFormat,
        pages: importPages,
        dedupeKey: JSON.stringify([churchId, design.id, importFormat, importFormat === "mp4" ? importMode : "", importPages]),
        run: (signal, onProgress) => {
          mediaAtExecution = getLatestMedia();
          return importCanvaDesign(churchId, createImportRequest(), onProgress, { signal });
        },
        customItemRetry: async () => {
          if (!onCreateDeckItem || !customItemPages.length) throw new Error("Imported media is no longer available. Refresh Media and try again.");
          const latestById = new Map(getLatestMedia().map((mediaItem) => [mediaItem.id, mediaItem]));
          const currentPages = customItemPages.map((page) => latestById.get(page.id)).filter((page): page is MediaType => Boolean(page));
          if (currentPages.length !== customItemPages.length) throw new Error("One or more imported pages are no longer in Media.");
          const viewPath = await onCreateDeckItem(currentPages, design.title, { navigateToItem: false, idempotencyKey: customItemIdempotencyKey });
          return viewPath;
        },
        ...(onUnprocessedAssetCleanup ? { cleanupRetry: retryCanvaCleanup } : {}),
        finalize: async (result, signal, onPagesPersisted) => {
          const pageMap = new Map<number, MediaType>();
          let importedCount = 0;
          let deckMedia: MediaType | undefined;
          customItemPages = [];
          const assetLifecycle: CanvaAssetLifecycle[] = result.assets.map(() => "unprocessed");
          cleanupRetryAssets = result.assets;
          cleanupRetryLifecycle = assetLifecycle;
          const persistedPages = new Set<number>();
          const markPagesPersisted = (pages: number[]) => {
            pages.forEach((page) => persistedPages.add(page));
            onPagesPersisted(pages);
          };
          const recordDeckPages = (media: MediaType | void) => {
            if (media?.canvaSource?.pageNumbers) for (const page of media.canvaSource.pageNumbers) pageMap.set(page, media);
          };
          const latestMediaForDesign = () => getLatestMedia().flatMap((mediaItem) => {
            const source = getCanvaMediaSource(mediaItem);
            return source ? [{ mediaItem, source }] : [];
          });
          const findCurrentPage = (pageNumber: number) => latestMediaForDesign()
            .filter(({ source }) => source.designId === design.id && source.format === importFormat && source.pageNumbers.length === 1 && source.pageNumbers[0] === pageNumber && isCanvaSourceCurrent(source, result.revision))
            .sort((left, right) => Number(right.source.revision) - Number(left.source.revision))[0]?.mediaItem;
          const findCurrentVideo = () => latestMediaForDesign()
            .filter(({ source }) => source.designId === design.id && source.format === "mp4" && [...source.pageNumbers].sort((a, b) => a - b).join(",") === importPages.join(",") && isCanvaSourceCurrent(source, result.revision))
            .sort((left, right) => Number(right.source.revision) - Number(left.source.revision))[0]?.mediaItem;
          const orderedPages = () => {
            if (importFormat === "mp4" && importMode === "combined") {
              const video = deckMedia ?? findCurrentVideo();
              return video ? [video] : [];
            }
            return importPages.flatMap((page) => {
              const mediaItem = pageMap.get(page) ?? findCurrentPage(page);
              return mediaItem ? [mediaItem] : [];
            });
          };
          const createDeckIfRequested = async (pagesToUse: MediaType[]): Promise<{ viewPath?: string; customItemError?: string }> => {
            if (signal.aborted) throw new Error("Canva import cancelled.");
            if (!includeCustomItem) return {};
            if (!pagesToUse.length || !onCreateDeckItem) return { customItemError: "No saved media is available to create the custom item." };
            customItemPages = pagesToUse;
            try {
              const viewPath = await onCreateDeckItem(pagesToUse, design.title, { navigateToItem: false, idempotencyKey: customItemIdempotencyKey });
              return typeof viewPath === "string" ? { viewPath } : {};
            } catch (customError) {
              return { customItemError: customError instanceof Error ? customError.message : "Try again." };
            }
          };
          try {
            if (signal.aborted) throw new Error("Canva import cancelled.");
            if (!result.assets.length) {
              const currentPages = importPages.filter((page) => findCurrentPage(page));
              const pagesAlreadyCurrent = importFormat === "mp4" && importMode === "combined"
                ? findCurrentVideo() ? importPages : []
                : currentPages;
              markPagesPersisted(pagesAlreadyCurrent.filter((page) => !result.failedPages?.some((failure) => failure.page === page)));
              const pagesToUse = includeCustomItem ? orderedPages() : [];
              const customResult = await createDeckIfRequested(pagesToUse);
              return { importedCount: 0, ...customResult, ...(result.failedPages?.length ? { failedPages: result.failedPages } : {}) };
            }
            for (let index = 0; index < result.assets.length; index += 1) {
              const asset = result.assets[index];
              if (signal.aborted) throw new Error("Canva import cancelled.");
              assetLifecycle[index] = "processing";
              const currentMedia = getLatestMedia();
              const source = asset.data.canvaSource;
              const matchingTargets = source ? currentMedia
                .filter((mediaItem) => {
                  const currentSource = getCanvaMediaSource(mediaItem);
                  return currentSource && canvaSourcesMatch(currentSource, source);
                })
                .sort((left, right) => Number(getCanvaMediaSource(right)?.revision || 0) - Number(getCanvaMediaSource(left)?.revision || 0)) : [];
              const newestTarget = matchingTargets[0];
              const target = newestTarget && Number(getCanvaMediaSource(newestTarget)?.revision) < Number(source?.revision) ? newestTarget : undefined;
              const expectedRefresh = Boolean(source && mediaAtExecution.some((mediaItem) => {
                const originalSource = getCanvaMediaSource(mediaItem);
                return originalSource && canvaSourcesMatch(originalSource, source) && Number(originalSource.revision) < Number(source.revision);
              }));
              if (source && !target && (expectedRefresh || (newestTarget && Number(getCanvaMediaSource(newestTarget)?.revision) >= Number(source.revision)))) {
                throw new Error(`${newestTarget ? "A newer Media version already exists" : "The Canva refresh target is no longer in Media"}.`);
              }
              if (asset.kind === "image") {
                if (target) {
                  const refreshed = await onImageRefresh(asset.data, target.id);
                  if (refreshed === false) throw new Error("The Canva image refresh was not saved.");
                  recordDeckPages(mediaFromRefreshedImage(target, asset.data));
                  importedCount += 1;
                }
                else {
                  const created = await onImageComplete(asset.data);
                  if (!created) throw new Error("A Canva page could not be added to Media. Refresh Media and try again.");
                  recordDeckPages(created);
                  importedCount += 1;
                }
              } else if (target) {
                const refreshed = await onVideoRefresh(asset.data, target.id);
                if (refreshed === false) throw new Error("The Canva video refresh was not saved.");
                deckMedia = mediaFromRefreshedVideo(target, asset.data);
                recordDeckPages(deckMedia);
                importedCount += 1;
              } else {
                const created = await onVideoComplete(asset.data);
                if (!created) throw new Error("The Canva video could not be added to Media. Refresh Media and try again.");
                deckMedia = created;
                recordDeckPages(created);
                importedCount += 1;
              }
              assetLifecycle[index] = "committed";
              markPagesPersisted(asset.data.canvaSource?.pageNumbers || []);
            }
            const pagesToUse = orderedPages();
            const customResult = await createDeckIfRequested(pagesToUse);
            return { importedCount: includeCustomItem ? pagesToUse.length : importedCount, ...customResult, ...(result.failedPages?.length ? { failedPages: result.failedPages } : {}) };
          } catch (error) {
            assetLifecycle.forEach((state, index) => {
              if (state === "processing") assetLifecycle[index] = "failed";
            });
            let cleanupFailures = result.assets.filter((_, index) =>
              assetLifecycle[index] !== "committed" && assetLifecycle[index] !== "cleaned",
            );
            if (onUnprocessedAssetCleanup) {
              cleanupFailures = await cleanupCanvaAssetsByLifecycle(
                result.assets,
                assetLifecycle,
                onUnprocessedAssetCleanup,
              );
            }
            cleanupRetryAssets = cleanupFailures;
            cleanupRetryLifecycle = cleanupFailures.map(() => "cleanup-pending");
            if (cleanupFailures.length) {
              const originalMessage = error instanceof Error ? error.message : "Canva import could not finish.";
              throw new Error(`${originalMessage} ${cleanupFailures.length} Canva asset${cleanupFailures.length === 1 ? " could" : "s could"} not be removed.`);
            }
            throw error;
          }
        },
      });
      onOpenChange(false);
    } catch (startError) {
      setError(formatCanvaImportError(startError, format));
    }
  };
  let selectedDesignStatus = "Select one or more pages.";
  if (selectedDesign && requestedSource?.designId === selectedDesign.id) {
    selectedDesignStatus = isCanvaSourceCurrent(
      requestedSource,
      selectedDesign.updatedAt,
    )
      ? "This Media asset is up to date."
      : "A newer Canva revision is available.";
  }
  const selectedFormatHasUpdate = Boolean(
    selectedDesign &&
    mediaSources.some(
      ({ source }) =>
        source.designId === selectedDesign.id &&
        source.format === format &&
        !isCanvaSourceCurrent(source, selectedDesign.updatedAt),
    ),
  );
  let submitLabel = "Import selected";
  if (selectedFormatHasUpdate) submitLabel = "Refresh selected";
  const allPagesSelected =
    pages.length > 0 && pages.every((pageNumber) => selectedPages.has(pageNumber));
  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
      }}
    >
      <SheetContent className="max-w-xl">
        <SheetHeader>
          <SheetTitle>Import from Canva</SheetTitle>
          <SheetDescription>
            Copy design pages into Media. Animations become still images or a
            baked MP4. For live Canva Present motion, share that window from
            Media instead.
          </SheetDescription>
        </SheetHeader>
        <div className="scrollbar-portal min-h-0 flex-1 overflow-y-auto p-5">
          {connected === null ? (
            <div className="flex justify-center py-12" aria-label="Checking Canva connection">
              <Spinner />
            </div>
          ) : !connected ? (
            <div className="rounded-xl border border-gray-600 bg-gray-900 p-4">
              <p className="font-medium">Canva is not connected.</p>
              <p className="mt-1 text-sm text-gray-300">
                Ask a church admin to connect the church Canva account in Integrations.
              </p>
              <Button
                className="mt-4"
                variant="secondary"
                onClick={() => {
                  onOpenChange(false);
                  navigate("/account/integrations");
                }}
              >
                Open Integrations
              </Button>
            </div>
          ) : (
            <>
              {!selectedDesign ? (
                <>
                  <form
                    className="flex items-end gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void openDesignFromLink();
                    }}
                  >
                    <Input
                      type="text"
                      label="Open by link"
                      value={designLink}
                      onChange={(value) => setDesignLink(String(value))}
                      placeholder="Paste a Canva design link or id"
                      inputWidth="w-full"
                      className="min-w-0 flex-1"
                    />
                    <Button
                      type="submit"
                      variant="secondary"
                      svg={Link2}
                      isLoading={isOpeningLink}
                      disabled={isOpeningLink || !designLink.trim()}
                    >
                      Open
                    </Button>
                  </form>
                  <p className="mt-2 text-xs text-gray-400">
                    The design must be shared with the church Canva account
                    connected in Integrations.
                  </p>
                  <form
                    className="mt-5 flex items-end gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void loadDesigns(query);
                    }}
                  >
                    <Input
                      type="text"
                      label="Search Canva"
                      value={query}
                      onChange={(value) => setQuery(String(value))}
                      placeholder="Design name"
                      inputWidth="w-full"
                      className="min-w-0 flex-1"
                    />
                    <Button type="submit" variant="secondary" svg={Search}>
                      Search
                    </Button>
                  </form>
                  {isLoading ? (
                    <div className="flex justify-center py-12">
                      <Spinner />
                    </div>
                  ) : designs.length ? (
                    <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {designs.map((design) => {
                        const existingSources = mediaSources.filter(
                          ({ source }) => source.designId === design.id,
                        );
                        const hasUpdate = existingSources.some(
                          ({ source }) =>
                            !isCanvaSourceCurrent(source, design.updatedAt),
                        );
                        return (
                          <button
                            key={design.id}
                            type="button"
                            className="overflow-hidden rounded-lg border border-gray-600 bg-gray-900 text-left transition hover:border-cyan-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
                            onClick={() => chooseDesign(design)}
                          >
                            <div className="aspect-video bg-gray-800">
                              {design.thumbnailUrl ? (
                                <img
                                  src={design.thumbnailUrl}
                                  alt=""
                                  className="h-full w-full object-cover"
                                />
                              ) : null}
                            </div>
                            <div className="p-2">
                              <p className="truncate text-sm font-medium">
                                {design.title}
                              </p>
                              <p className="mt-0.5 text-xs text-gray-400">
                                {design.pageCount || 1}{" "}
                                {design.pageCount === 1 ? "page" : "pages"}
                              </p>
                              {existingSources.length ? (
                                <p
                                  className={`mt-1 text-xs font-medium ${hasUpdate ? "text-amber-300" : "text-emerald-300"}`}
                                >
                                  {hasUpdate ? "Update available" : "Imported"}
                                </p>
                              ) : null}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="py-12 text-center text-sm text-gray-400">
                      No Canva designs found. Try another search.
                    </p>
                  )}
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{selectedDesign.title}</p>
                      <p className="text-xs text-gray-400">
                        {selectedDesignStatus}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      {selectedDesign.editUrl ? (
                        <Button
                          variant="secondary"
                          svg={ExternalLink}
                          disabled={isImportPending}
                          onClick={() => void editCanvaDesign()}
                        >
                          Edit in Canva
                        </Button>
                      ) : null}
                      <Button
                        variant="tertiary"
                        disabled={isImportPending}
                        onClick={changeDesign}
                      >
                        Change design
                      </Button>
                    </div>
                  </div>
                  {isLoading ? (
                    <div className="flex justify-center py-12"><Spinner /></div>
                  ) : (
                    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {pages.map((pageNumber) => {
                        const selected = selectedPages.has(pageNumber);
                        const pageSources = mediaSources.filter(
                          ({ source }) =>
                            source.designId === selectedDesign.id &&
                            source.format === "png" &&
                            source.pageNumbers.length === 1 &&
                            source.pageNumbers[0] === pageNumber,
                        );
                        const pageHasUpdate = pageSources.some(
                          ({ source }) =>
                            !isCanvaSourceCurrent(source, selectedDesign.updatedAt),
                        );
                        const currentPageMedia = pageSources
                          .filter(({ source }) =>
                            isCanvaSourceCurrent(
                              source,
                              selectedDesign.updatedAt,
                            ),
                          )
                          .sort(
                            (left, right) =>
                              right.source.revision - left.source.revision,
                          )[0]?.mediaItem;
                        const previewUrl =
                          currentPageMedia?.thumbnail ||
                          (pageNumber === 1
                            ? selectedDesign.thumbnailUrl
                            : "");
                        return (
                          <button
                            key={pageNumber}
                            type="button"
                            aria-pressed={selected}
                            disabled={isImportPending}
                            className={`overflow-hidden rounded-lg border text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 ${selected
                              ? "border-cyan-400 bg-cyan-400/10 ring-1 ring-cyan-400"
                              : "border-gray-600 bg-gray-900"
                              }`}
                            onClick={() => togglePage(pageNumber)}
                          >
                            <div className="relative aspect-video bg-gray-800">
                              <MultiSelectSubsetTick
                                modeActive
                                isSelected={selected}
                                frameClassName="absolute left-1.5 top-1.5 z-10 size-5"
                              />
                              {previewUrl ? (
                                <img
                                  src={previewUrl}
                                  alt=""
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <div
                                  role="img"
                                  aria-label={`Page ${pageNumber} preview placeholder`}
                                  className="flex h-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-gray-800 to-gray-900 text-gray-400"
                                >
                                  <ImageIcon
                                    aria-hidden="true"
                                    className="h-7 w-7 opacity-70"
                                  />
                                  <span className="text-sm font-medium">
                                    Page {pageNumber}
                                  </span>
                                </div>
                              )}
                            </div>
                            <div className="p-2">
                              <p className="text-sm">Page {pageNumber}</p>
                              {format === "png" && pageSources.length ? (
                                <p className={`mt-0.5 text-xs ${pageHasUpdate ? "text-amber-300" : "text-emerald-300"}`}>
                                  {pageHasUpdate ? "Update available" : "In Media"}
                                </p>
                              ) : null}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div className="mt-5 rounded-lg border border-gray-600 bg-gray-900 p-3">
                    <p className="text-sm font-medium">Import format</p>
                    <Tabs
                      value={format}
                      onValueChange={(value) => {
                        if (value === "png" || value === "mp4") {
                          setFormat(value);
                        }
                      }}
                      className="mt-2 w-full"
                    >
                      <TabsList
                        variant="line"
                        className={lineTabsListShellClassName}
                        aria-label="Import format"
                      >
                        <TabsTrigger
                          value="png"
                          disabled={isImportPending}
                          className={lineTabsTriggerClassName}
                        >
                          <ImageIcon aria-hidden="true" />
                          PNG images
                        </TabsTrigger>
                        <TabsTrigger
                          value="mp4"
                          disabled={isImportPending}
                          className={lineTabsTriggerClassName}
                        >
                          <Video aria-hidden="true" />
                          MP4 video
                        </TabsTrigger>
                      </TabsList>
                    </Tabs>
                    <p className="mt-2 text-xs text-gray-400">
                      {format === "png"
                        ? "PNG pages are still images. Use Media screen share for live Canva Present animations."
                        : "MP4 bakes motion into one video. You advance in WorshipSync by playing the clip, not Canva Present."}
                    </p>
                    {format === "mp4" ? (
                      <div className="mt-3">
                        <p className="text-xs font-medium text-gray-300">
                          MP4 import
                        </p>
                        <SegmentedControl
                          value={mp4ImportMode}
                          onChange={(value) => {
                            setMp4ImportMode(value);
                          }}
                          ariaLabel="MP4 import mode"
                          variant="muted"
                          fullWidth
                          disabled={isImportPending}
                          className="mt-1"
                          options={[
                            {
                              value: "combined",
                              label: "One combined video",
                            },
                            {
                              value: "separate",
                              label: "Separate video per page",
                            },
                          ]}
                        />
                        <p className="mt-1 text-xs text-gray-400">
                          {mp4ImportMode === "combined"
                            ? "Best for looping the whole presentation as one video."
                            : "Import each page separately so you can choose when to show it."}
                        </p>
                      </div>
                    ) : null}
                    {onCreateDeckItem ? (
                      <div className="mt-3">
                        <Checkbox
                          id="canva-create-deck"
                          label={
                            format === "png" || mp4ImportMode === "separate"
                              ? "Create a custom item with one slide per page"
                              : "Create a custom item with the imported video"
                          }
                          checked={createDeckItem}
                          disabled={isImportPending}
                          onCheckedChange={(checked) =>
                            setCreateDeckItem(checked === true)
                          }
                        />
                      </div>
                    ) : null}
                  </div>
                </>
              )}
            </>
          )}
          {error ? (
            <p role="alert" className="mt-4 rounded-lg border border-amber-700/60 bg-amber-950/30 p-3 text-sm text-amber-100">
              {error}
            </p>
          ) : null}
        </div>
        {connected && selectedDesign ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-600 p-4">
            <div className="flex items-center gap-3">
              <p className="text-sm text-gray-300">
                {selectedPages.size} {selectedPages.size === 1 ? "page" : "pages"} selected
              </p>
              <SelectAllButton
                allSelected={allPagesSelected}
                onClick={toggleAllPages}
                disabled={isImportPending || pages.length > 25}
              />
            </div>
            <Button
              variant="cta"
              disabled={selectedPages.size === 0 || isImportPending}
              isLoading={isImportPending}
              onClick={() => void importSelected()}
            >
              {submitLabel}
            </Button>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
};

export default CanvaImportSheet;
