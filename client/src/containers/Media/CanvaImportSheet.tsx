import { useContext, useEffect, useMemo, useRef, useState } from "react";
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
  type CanvaImportProgressEvent,
  type CanvaPageImportStatus,
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
  cleanupUnprocessedCanvaAssets,
  type CanvaImportedAsset,
} from "../../utils/canvaImportCleanup";

const pageStatusLabel = (status: CanvaPageImportStatus) => {
  switch (status) {
    case "waiting":
      return "Waiting…";
    case "exporting":
      return "Exporting…";
    case "processing":
      return "Processing…";
    case "saving":
      return "Saving…";
    case "ready":
      return "Ready ✓";
    case "error":
      return "Failed";
    default:
      return "";
  }
};

const statusTone = (status: CanvaPageImportStatus) => {
  switch (status) {
    case "ready":
      return "text-emerald-300";
    case "error":
      return "text-red-300";
    case "waiting":
      return "text-gray-400";
    default:
      return "text-cyan-200";
  }
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImageComplete: (info: mediaInfoType) => MediaType | void;
  onVideoComplete: (info: MuxUploadResult) => MediaType | void;
  onImageRefresh: (
    info: mediaInfoType,
    mediaId: string,
  ) => void | Promise<void>;
  onVideoRefresh: (
    info: MuxUploadResult,
    mediaId: string,
  ) => void | Promise<void>;
  onUnprocessedAssetCleanup?: (asset: CanvaImportedAsset) => Promise<boolean>;
  /** Optionally build a custom item from the imported Canva media. */
  onCreateDeckItem?: (
    pages: MediaType[],
    designTitle: string,
  ) => void | Promise<void>;
  existingMedia: readonly MediaType[];
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
  sourceMedia,
}: Props) => {
  const { churchId = "" } = useContext(GlobalInfoContext) || {};
  const { showToast } = useToast();
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
  const [isImporting, setIsImporting] = useState(false);
  const [pageProgress, setPageProgress] = useState<
    Map<number, { status: CanvaPageImportStatus; exported?: boolean; error?: string }>
  >(new Map());
  const [importPhase, setImportPhase] = useState("");
  const [error, setError] = useState("");
  const importControllerRef = useRef<AbortController | null>(null);
  const importCancelledRef = useRef(false);
  useEffect(
    () => () => {
      importCancelledRef.current = true;
      importControllerRef.current?.abort();
    },
    [],
  );
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
    setPageProgress(new Map());
    setImportPhase("");
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
    setPageProgress(new Map());
    setImportPhase("");
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
    setPageProgress(new Map());
    setImportPhase("");
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

  const findRefreshTarget = (
    source: NonNullable<mediaInfoType["canvaSource"]>,
  ) => {
    const candidates = mediaSources
      .filter(
        ({ source: existingSource }) =>
          canvaSourcesMatch(existingSource, source) &&
          existingSource.revision < source.revision,
      )
      .sort((left, right) => right.source.revision - left.source.revision);
    if (sourceMedia) {
      const preferred = candidates.find(
        ({ mediaItem }) => mediaItem.id === sourceMedia.id,
      );
      if (preferred) return preferred.mediaItem;
    }
    return candidates[0]?.mediaItem;
  };

  const togglePage = (pageNumber: number) => {
    if (isImporting) return;
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
    setPageProgress(new Map());
  };

  const toggleAllPages = () => {
    if (isImporting || pages.length > 25) return;
    setError("");
    setSelectedPages((current) => {
      const allSelected = pages.every((pageNumber) => current.has(pageNumber));
      return allSelected ? new Set() : new Set(pages);
    });
    setPageProgress(new Map());
  };

  const findCurrentPageMedia = (
    pageNumber: number,
    revision: number | string,
  ) => {
    if (!selectedDesign) return undefined;
    const candidates = mediaSources
      .filter(
        ({ source }) =>
          source.designId === selectedDesign.id &&
          source.format === format &&
          source.pageNumbers.length === 1 &&
          source.pageNumbers[0] === pageNumber &&
          isCanvaSourceCurrent(source, revision),
      )
      .sort((left, right) => right.source.revision - left.source.revision);
    return candidates[0]?.mediaItem;
  };

  const findCurrentCanvaVideo = (revision: number | string) => {
    if (!selectedDesign) return undefined;
    const requestedPageKey = [...selectedPages]
      .sort((left, right) => left - right)
      .join(",");
    const candidates = mediaSources
      .filter(
        ({ source }) =>
          source.designId === selectedDesign.id &&
          source.format === "mp4" &&
          [...source.pageNumbers].sort((left, right) => left - right).join(",") ===
            requestedPageKey &&
          isCanvaSourceCurrent(source, revision),
      )
      .sort((left, right) => right.source.revision - left.source.revision);
    return candidates[0]?.mediaItem;
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

  const buildOrderedDeckPages = (
    deckPageByNumber: Map<number, MediaType>,
    revision: number | string,
    deckMedia?: MediaType,
  ): MediaType[] => {
    if (format === "mp4" && mp4ImportMode === "combined") {
      const video = deckMedia ?? findCurrentCanvaVideo(revision);
      return video ? [video] : [];
    }
    const ordered: MediaType[] = [];
    for (const pageNumber of [...selectedPages].sort((a, b) => a - b)) {
      const pageMedia =
        deckPageByNumber.get(pageNumber) ??
        findCurrentPageMedia(pageNumber, revision);
      if (pageMedia) ordered.push(pageMedia);
    }
    return ordered;
  };

  const importSelected = async () => {
    if (!selectedDesign || selectedPages.size === 0) return;
    const importPages = [...selectedPages].sort((a, b) => a - b);
    const designImportKeyPrefix = `canva:${selectedDesign.id}:`;
    const existingImportKeys = existingMedia
      .map((mediaItem) => mediaItem.canvaImportKey)
      .filter(
        (key): key is string =>
          typeof key === "string" && key.startsWith(designImportKeyPrefix),
      );
    const replacementAssets = existingMedia.flatMap((mediaItem) => {
      const source = mediaItem.canvaSource;
      if (
        !source ||
        source.designId !== selectedDesign.id ||
        source.format !== format ||
        !source.pageNumbers?.length
      ) return [];
      const provider = mediaItem.providerStorage?.provider;
      const assetId = provider === "mux"
        ? mediaItem.providerStorage?.assetId || mediaItem.muxAssetId
        : provider === "cloudinary"
          ? mediaItem.providerStorage?.publicId || mediaItem.publicId
          : mediaItem.source === "mux"
            ? mediaItem.muxAssetId
            : mediaItem.source === "cloudinary"
              ? mediaItem.publicId
              : "";
      if (!assetId) return [];
      return [{
        provider: provider === "mux" || mediaItem.source === "mux" ? "muxMinutes" : "cloudinaryBytes",
        assetId,
        revision: source.revision,
        preferred: mediaItem.id === sourceMedia?.id,
        pageNumbers: [...source.pageNumbers].sort((a, b) => a - b),
      }];
    });
    setIsImporting(true);
    importCancelledRef.current = false;
    const importController = new AbortController();
    importControllerRef.current = importController;
    setError("");
    setImportPhase("");
    setPageProgress(
      new Map(importPages.map((page) => [page, { status: "waiting" as const }])),
    );
    let returnedAssets: CanvaImportedAsset[] = [];
    let processedAssetCount = 0;
    try {
      const importRequest = {
        designId: selectedDesign.id,
        pages: importPages,
        format,
        ...(format === "mp4" ? { mp4ImportMode } : {}),
        existingImportKeys,
        replacementAssets,
      };
      const handleProgress = (event: CanvaImportProgressEvent) => {
        if (importCancelledRef.current) return;
        if (event.type === "started") {
          setPageProgress(
            new Map(
              (event.pages || importPages).map((page) => [
                page,
                { status: "waiting" as const },
              ]),
            ),
          );
          return;
        }
        if (event.type === "page-progress") {
          setPageProgress((current) => {
            const next = new Map(current);
            next.set(event.page, {
              status: event.status,
              ...(event.exported ? { exported: true } : {}),
              ...(event.error ? { error: event.error } : {}),
            });
            return next;
          });
          return;
        }
        if (event.type === "finalizing") setImportPhase("Finishing import…");
      };
      const result =
        format === "mp4" && mp4ImportMode === "separate"
          ? await importCanvaDesign(
              churchId,
              importRequest,
              handleProgress,
              { signal: importController.signal },
            )
          : await importCanvaDesign(churchId, importRequest, undefined, {
              signal: importController.signal,
            });
      if (importCancelledRef.current) return;
      returnedAssets = result.assets;
      const recordDeckPages = (
        deckPageByNumber: Map<number, MediaType>,
        media: MediaType | void,
      ) => {
        if (!media?.canvaSource?.pageNumbers?.length) return;
        for (const pageNumber of media.canvaSource.pageNumbers) {
          deckPageByNumber.set(pageNumber, media);
        }
      };

      if (result.assets.length === 0) {
        const existingDeckPages =
          createDeckItem && onCreateDeckItem
            ? buildOrderedDeckPages(new Map(), result.revision)
            : [];
        if (existingDeckPages.length > 0 && onCreateDeckItem) {
          showToast(
            format === "png"
              ? `${existingDeckPages.length} selected ${existingDeckPages.length === 1 ? "page was" : "pages were"} already in Media. Creating a custom item.`
              : "The selected Canva video was already in Media. Creating a custom item.",
            "success",
          );
          onOpenChange(false);
          await onCreateDeckItem(existingDeckPages, selectedDesign.title);
          return;
        }
        setError(
          format === "png"
            ? "Those Canva pages are already in Media and have not changed. Select different pages or edit the design in Canva first."
            : "That Canva video is already in Media and has not changed. Change the selection or edit the design in Canva first.",
        );
        return;
      }
      let refreshedCount = 0;
      let importedCount = 0;
      const deckPageByNumber = new Map<number, MediaType>();
      let deckMedia: MediaType | undefined;
      for (const asset of result.assets) {
        const refreshTarget = asset.data.canvaSource
          ? findRefreshTarget(asset.data.canvaSource)
          : undefined;
        if (asset.kind === "image") {
          if (refreshTarget) {
            await onImageRefresh(asset.data, refreshTarget.id);
            refreshedCount += 1;
            recordDeckPages(
              deckPageByNumber,
              mediaFromRefreshedImage(refreshTarget, asset.data),
            );
          } else {
            const created = onImageComplete(asset.data);
            importedCount += 1;
            recordDeckPages(deckPageByNumber, created);
          }
        } else if (refreshTarget) {
          await onVideoRefresh(asset.data, refreshTarget.id);
          refreshedCount += 1;
          deckMedia = mediaFromRefreshedVideo(refreshTarget, asset.data);
          recordDeckPages(
            deckPageByNumber,
            deckMedia,
          );
        } else {
          const completed = onVideoComplete(asset.data);
          if (completed) deckMedia = completed;
          recordDeckPages(deckPageByNumber, completed);
          importedCount += 1;
        }
        processedAssetCount += 1;
      }
      const resultParts = [];
      if (refreshedCount) {
        resultParts.push(
          `${refreshedCount} Canva ${refreshedCount === 1 ? "asset" : "assets"} refreshed.`,
        );
      }
      if (importedCount) {
        resultParts.push(
          `${importedCount} Canva ${importedCount === 1 ? "asset" : "assets"} imported.`,
        );
      }
      const importedLabel = resultParts.join(" ");
      showToast(
        result.skippedCount > 0
          ? `${importedLabel} ${result.skippedCount} unchanged ${result.skippedCount === 1 ? "duplicate was" : "duplicates were"} skipped.`
          : importedLabel,
        "success",
      );
      onOpenChange(false);
      const orderedDeckPages = buildOrderedDeckPages(
        deckPageByNumber,
        result.revision,
        deckMedia,
      );
      if (
        createDeckItem &&
        orderedDeckPages.length > 0 &&
        onCreateDeckItem
      ) {
        await onCreateDeckItem(orderedDeckPages, selectedDesign.title);
      }
    } catch (importError) {
      if (importCancelledRef.current) return;
      setImportPhase("");
      const unprocessedAssets = returnedAssets.slice(processedAssetCount + 1);
      const cleanupFailures = onUnprocessedAssetCleanup
        ? await cleanupUnprocessedCanvaAssets(
            unprocessedAssets,
            onUnprocessedAssetCleanup,
          )
        : [];
      const importMessage =
        importError instanceof Error
          ? importError.message
          : "Could not import that Canva design. Try again.";
      setError(
        cleanupFailures.length > 0
          ? `${importMessage} Some unprocessed Canva assets could not be cleaned up and were retained for provider reconciliation.`
          : importMessage,
      );
    } finally {
      if (importControllerRef.current === importController) {
        importControllerRef.current = null;
      }
      setIsImporting(false);
    }
  };

  const cancelImport = () => {
    if (!isImporting) return;
    importCancelledRef.current = true;
    importControllerRef.current?.abort();
    importControllerRef.current = null;
    setIsImporting(false);
    setImportPhase("");
    onOpenChange(false);
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
  if (isImporting) submitLabel = "Working";
  else if (selectedFormatHasUpdate) submitLabel = "Refresh selected";
  const allPagesSelected =
    pages.length > 0 && pages.every((pageNumber) => selectedPages.has(pageNumber));
  const pageProgressEntries = [...selectedPages].map((page) => ({
    page,
    ...(pageProgress.get(page) || { status: "idle" as const }),
  }));
  const readyPageCount = pageProgressEntries.filter(
    ({ status }) => status === "ready",
  ).length;
  const exportedPageCount = pageProgressEntries.filter(
    ({ status, exported }) =>
      Boolean(exported) || status === "processing" || status === "ready",
  ).length;
  const waitingPageCount = pageProgressEntries.filter(
    ({ status }) => status === "waiting",
  ).length;
  const exportingPageCount = pageProgressEntries.filter(
    ({ status }) => status === "exporting",
  ).length;
  const processingPageCount = pageProgressEntries.filter(
    ({ status }) => status === "processing" || status === "saving",
  ).length;
  const failedPageCount = pageProgressEntries.filter(
    ({ status }) => status === "error",
  ).length;
  const progressTotal = selectedPages.size;
  const overallProgress =
    progressTotal === 0
      ? 0
      : format === "mp4" && mp4ImportMode === "separate"
        ? Math.round(
            ((exportedPageCount + readyPageCount) / (progressTotal * 2)) * 100,
          )
        : Math.round((readyPageCount / progressTotal) * 100);
  const progressSummary = [
    `${readyPageCount} of ${progressTotal} ready`,
    waitingPageCount ? `${waitingPageCount} waiting` : "",
    exportingPageCount ? `${exportingPageCount} exporting` : "",
    processingPageCount ? `${processingPageCount} processing` : "",
    failedPageCount ? `${failedPageCount} failed` : "",
  ].filter(Boolean).join(" · ");

  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (isImporting) cancelImport();
        else onOpenChange(nextOpen);
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
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
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
                          disabled={isImporting}
                          onClick={() => void editCanvaDesign()}
                        >
                          Edit in Canva
                        </Button>
                      ) : null}
                      <Button
                        variant="tertiary"
                        disabled={isImporting}
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
                            disabled={isImporting}
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
                              {selected && pageProgress.get(pageNumber) ? (
                                <p
                                  className={`mt-0.5 flex items-center gap-1 text-xs font-medium ${statusTone(pageProgress.get(pageNumber)?.status || "idle")}`}
                                >
                                  {pageProgress.get(pageNumber)?.status ===
                                  "ready" ? null : pageProgress.get(pageNumber)
                                      ?.status === "error" ? null : (
                                    <Spinner width="12px" borderWidth="2px" />
                                  )}
                                  {pageStatusLabel(
                                    pageProgress.get(pageNumber)?.status ||
                                      "idle",
                                  )}
                                </p>
                              ) : format === "png" && pageSources.length ? (
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
                          setPageProgress(new Map());
                          setImportPhase("");
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
                          disabled={isImporting}
                          className={lineTabsTriggerClassName}
                        >
                          <ImageIcon aria-hidden="true" />
                          PNG images
                        </TabsTrigger>
                        <TabsTrigger
                          value="mp4"
                          disabled={isImporting}
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
                            setPageProgress(new Map());
                            setImportPhase("");
                          }}
                          ariaLabel="MP4 import mode"
                          variant="muted"
                          fullWidth
                          disabled={isImporting}
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
                          disabled={isImporting}
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
          {selectedDesign && pageProgress.size > 0 ? (
            <div
              className="mt-5 rounded-lg border border-gray-600 bg-gray-900 p-3"
              aria-label="Canva import progress"
            >
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-gray-200">{progressSummary}</span>
                <span className="shrink-0 text-gray-400">{overallProgress}%</span>
              </div>
              {importPhase ? (
                <p className="mt-1 text-xs text-gray-400">{importPhase}</p>
              ) : null}
              <div
                className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-700"
                role="progressbar"
                aria-label="Canva import progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={overallProgress}
              >
                <div
                  className={`h-full rounded-full transition-all duration-300 ${failedPageCount ? "bg-amber-500" : "bg-cyan-500"}`}
                  style={{ width: `${overallProgress}%` }}
                />
              </div>
            </div>
          ) : null}
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
                disabled={isImporting || pages.length > 25}
              />
            </div>
            <Button
              variant="cta"
              disabled={selectedPages.size === 0 || isImporting}
              isLoading={isImporting}
              onClick={() => void importSelected()}
            >
              {submitLabel}
            </Button>
            {isImporting ? (
              <Button variant="secondary" onClick={cancelImport}>
                Cancel import
              </Button>
            ) : null}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
};

export default CanvaImportSheet;
