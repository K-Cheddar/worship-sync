import { useContext, useEffect, useState } from "react";
import { Image as ImageIcon, Search, Video } from "lucide-react";
import { useNavigate } from "react-router-dom";
import Button from "../../components/Button/Button";
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
  importCanvaDesign,
  listCanvaDesigns,
  type CanvaDesign,
} from "../../api/canva";
import type { mediaInfoType } from "./cloudinaryTypes";
import type { MuxUploadResult } from "./MediaUploadInput.types";
import type { MediaType } from "../../types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImageComplete: (info: mediaInfoType) => void;
  onVideoComplete: (info: MuxUploadResult) => void;
  existingMedia: readonly MediaType[];
};

const CanvaImportSheet = ({
  open,
  onOpenChange,
  onImageComplete,
  onVideoComplete,
  existingMedia,
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
  const [format, setFormat] = useState<"png" | "mp4">("png");
  const [isLoading, setIsLoading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState("");

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
    setError("");
    void getCanvaStatus(churchId)
      .then((status) => {
        if (!active) return;
        setConnected(status.connected);
        if (status.connected) void loadDesigns();
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

  const chooseDesign = (design: CanvaDesign) => {
    setSelectedDesign(design);
    setError("");
    const nextPages = Array.from(
      { length: Math.max(1, design.pageCount) },
      (_, index) => index + 1,
    );
    setPages(nextPages);
    setSelectedPages(new Set([1]));
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
      if (result.assets.length === 0) {
        setError(
          format === "png"
            ? "Those Canva pages are already in Media and have not changed. Select different pages or edit the design in Canva first."
            : "That Canva video is already in Media and has not changed. Change the selection or edit the design in Canva first.",
        );
        return;
      }
      result.assets.forEach((asset) => {
        if (asset.kind === "image") onImageComplete(asset.data);
        else onVideoComplete(asset.data);
      });
      const importedLabel = `${result.assets.length} Canva ${result.assets.length === 1 ? "asset" : "assets"} imported.`;
      showToast(
        result.skippedCount > 0
          ? `${importedLabel} ${result.skippedCount} unchanged ${result.skippedCount === 1 ? "duplicate was" : "duplicates were"} skipped.`
          : importedLabel,
        "success",
      );
      onOpenChange(false);
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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="max-w-xl">
        <SheetHeader>
          <SheetTitle>Import from Canva</SheetTitle>
          <SheetDescription>
            Choose design pages to copy into this church&apos;s Media library.
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
                      {designs.map((design) => (
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
                            <p className="truncate text-sm font-medium">{design.title}</p>
                            <p className="mt-0.5 text-xs text-gray-400">
                              {design.pageCount || 1} {design.pageCount === 1 ? "page" : "pages"}
                            </p>
                          </div>
                        </button>
                      ))}
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
                      <p className="text-xs text-gray-400">Select one or more pages.</p>
                    </div>
                    <Button variant="tertiary" onClick={() => setSelectedDesign(null)}>
                      Change design
                    </Button>
                  </div>
                  {isLoading ? (
                    <div className="flex justify-center py-12"><Spinner /></div>
                  ) : (
                    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {pages.map((pageNumber) => {
                        const selected = selectedPages.has(pageNumber);
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
                            <p className="p-2 text-sm">Page {pageNumber}</p>
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
              {isImporting ? "Importing" : "Import selected"}
            </Button>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
};

export default CanvaImportSheet;
