import { useContext, useEffect, useMemo, useState } from "react";
import { ExternalLink, Image as ImageIcon, Link2, Search, Video } from "lucide-react";
import { useNavigate } from "react-router-dom";
import Button from "../../components/Button/Button";
import Checkbox from "../../components/Checkbox/Checkbox";
import Input from "../../components/Input/Input";
import Spinner from "../../components/Spinner/Spinner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../../components/ui/sheet";
import { GlobalInfoContext } from "../../context/globalInfo";
import { useToast } from "../../context/toastContext";
import {
  getCanvaStatus,
  getCanvaDesign,
  importCanvaDesign,
  listCanvaDesigns,
  type CanvaDesign,
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
import { parseCanvaDesignId } from "./canvaDesignUrl";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImageComplete: (info: mediaInfoType) => MediaType | void;
  onVideoComplete: (info: MuxUploadResult) => void;
  onImageRefresh: (info: mediaInfoType, mediaId: string) => void;
  onVideoRefresh: (info: MuxUploadResult, mediaId: string) => void;
  /** After a multi-page PNG import, optionally build one custom item with a slide per page. */
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
  const [isLoading, setIsLoading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState("");
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
    const designId = parseCanvaDesignId(designLink);
    if (!designId) {
      setError(
        "Paste a Canva design link or design id. Share the design with the church Canva account first.",
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

  const buildOrderedDeckPages = (
    deckPageByNumber: Map<number, MediaType>,
    revision: number | string,
  ): MediaType[] => {
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
    const designImportKeyPrefix = `canva:${selectedDesign.id}:`;
    const existingImportKeys = existingMedia
      .map((mediaItem) => mediaItem.canvaImportKey)
      .filter(
        (key): key is string =>
          Boolean(key) && key.startsWith(designImportKeyPrefix),
      );
    setIsImporting(true);
    setError("");
    try {
      const result = await importCanvaDesign(churchId, {
        designId: selectedDesign.id,
        pages: [...selectedPages].sort((a, b) => a - b),
        format,
        existingImportKeys,
      });
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
          createDeckItem && format === "png" && onCreateDeckItem
            ? buildOrderedDeckPages(new Map(), result.revision)
            : [];
        if (existingDeckPages.length > 1 && onCreateDeckItem) {
          showToast(
            `${existingDeckPages.length} selected pages were already in Media. Creating a multi-slide item.`,
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
      result.assets.forEach((asset) => {
        const refreshTarget = asset.data.canvaSource
          ? findRefreshTarget(asset.data.canvaSource)
          : undefined;
        if (asset.kind === "image") {
          if (refreshTarget) {
            onImageRefresh(asset.data, refreshTarget.id);
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
          onVideoRefresh(asset.data, refreshTarget.id);
          refreshedCount += 1;
        } else {
          onVideoComplete(asset.data);
          importedCount += 1;
        }
      });
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
      );
      if (
        createDeckItem &&
        format === "png" &&
        orderedDeckPages.length > 1 &&
        onCreateDeckItem
      ) {
        await onCreateDeckItem(orderedDeckPages, selectedDesign.title);
      }
    } catch (importError) {
      setError(
        importError instanceof Error
          ? importError.message
          : "Could not import that Canva design. Try again.",
      );
    } finally {
      setIsImporting(false);
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
  if (isImporting) submitLabel = "Working";
  else if (selectedFormatHasUpdate) submitLabel = "Refresh selected";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
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
                          onClick={() => void editCanvaDesign()}
                        >
                          Edit in Canva
                        </Button>
                      ) : null}
                      <Button variant="tertiary" onClick={changeDesign}>
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
                        return (
                          <button
                            key={pageNumber}
                            type="button"
                            aria-pressed={selected}
                            className={`overflow-hidden rounded-lg border text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 ${selected
                              ? "border-cyan-400 bg-cyan-400/10 ring-1 ring-cyan-400"
                              : "border-gray-600 bg-gray-900"
                              }`}
                            onClick={() => togglePage(pageNumber)}
                          >
                            <div className="aspect-video bg-gray-800">
                              {pageNumber === 1 && selectedDesign.thumbnailUrl ? (
                                <img src={selectedDesign.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                              ) : null}
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
                    <div className="mt-2 flex gap-2">
                      <Button
                        variant={format === "png" ? "secondary" : "tertiary"}
                        svg={ImageIcon}
                        onClick={() => setFormat("png")}
                      >
                        PNG images
                      </Button>
                      <Button
                        variant={format === "mp4" ? "secondary" : "tertiary"}
                        svg={Video}
                        onClick={() => setFormat("mp4")}
                      >
                        MP4 video
                      </Button>
                    </div>
                    <p className="mt-2 text-xs text-gray-400">
                      {format === "png"
                        ? "PNG pages are still images. Use Media screen share for live Canva Present animations."
                        : "MP4 bakes motion into one video. You advance in WorshipSync by playing the clip, not Canva Present."}
                    </p>
                    {format === "png" &&
                      onCreateDeckItem &&
                      selectedPages.size > 1 ? (
                      <div className="mt-3">
                        <Checkbox
                          id="canva-create-deck"
                          label="Create a custom item with one slide per page"
                          checked={createDeckItem}
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
          <div className="flex items-center justify-between gap-3 border-t border-gray-600 p-4">
            <p className="text-sm text-gray-300">
              {selectedPages.size} {selectedPages.size === 1 ? "page" : "pages"} selected
            </p>
            <Button
              variant="cta"
              disabled={selectedPages.size === 0 || isImporting}
              isLoading={isImporting}
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
