import Button from "../../components/Button/Button";
import Input from "../../components/Input/Input";
import DeleteModal from "../../components/Modal/DeleteModal";
import {
  ChevronDown,
  ChevronUp,
  LayoutGrid,
  Maximize,
  ImageUp,
  HardDrive,
  Plus,
  Upload,
  Video,
  X,
} from "lucide-react";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "../../hooks";
import MediaUploadInput from "./MediaUploadInput";
import { setIsMediaExpanded } from "../../store/preferencesSlice";
import {
  MEDIA_LIBRARY_ROOT_VIEW,
  moveMediaToFolder,
} from "../../utils/mediaFolderMutations";
import {
  MediaLibraryFolderModals,
  MediaLibraryNewFolderForm,
  MediaLibraryRenameFolderForm,
  MediaLibraryRenameMediaForm,
} from "./MediaLibraryFolderModals";
import MediaLibraryActionBar from "./MediaLibraryActionBar";
import cn from "classnames";
import Toggle from "../../components/Toggle/Toggle";
import MediaOriginFilter from "./MediaOriginFilter";
import ErrorBoundary from "../../components/ErrorBoundary/ErrorBoundary";
import MediaModal from "./MediaModal";
import MediaProviderRetryModal from "./MediaProviderRetryModal";
import MediaLibraryGrid from "./MediaLibraryGrid";
import { useMediaLibraryController } from "./useMediaLibraryController";
import type { MediaFolder, MediaType } from "../../types";
import FloatingWindow, {
  FloatingWindowHandle,
} from "../../components/FloatingWindow/FloatingWindow";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/DropdownMenu";
import CanvaImportSheet from "./CanvaImportSheet";
import { getCanvaStatus } from "../../api/canva";
import { GlobalInfoContext } from "../../context/globalInfo";
import LocalMediaImportSheet from "./LocalMediaImportSheet";
import LocalVideoInputPicker from "../../components/LocalVideoInputPicker/LocalVideoInputPicker";
import {
  addItemToMediaList,
  updateMediaItemFields,
} from "../../store/mediaSlice";
import type { LocalVideoInputMediaSource } from "../../types";
import type { RootState } from "../../store/store";

const MEDIA_LIBRARY_FORM_POPOVER_CLASS =
  "w-72 border border-gray-600 bg-gray-900 p-3 text-white";

type MediaProps = {
  /** Stacked with TransmitHandler: collapsed bar at bottom; expanded fills column above hidden transmit. */
  variant?: "default" | "panel";
  pageMode?: "default" | "overlayController";
};

const Media = ({ variant = "default", pageMode = "default" }: MediaProps) => {
  const dispatch = useDispatch();
  const { churchId = "" } = useContext(GlobalInfoContext) || {};
  const [isCanvaImportOpen, setIsCanvaImportOpen] = useState(false);
  const [canvaSourceMedia, setCanvaSourceMedia] = useState<MediaType | null>(
    null,
  );
  const [canvaOauthConfigured, setCanvaOauthConfigured] = useState(false);
  const [isLocalImportOpen, setIsLocalImportOpen] = useState(false);
  const [isVideoInputOpen, setIsVideoInputOpen] = useState(false);
  const [videoInputToEdit, setVideoInputToEdit] =
    useState<LocalVideoInputMediaSource>();
  const activeItemId = useSelector(
    (state: RootState) => state.undoable.present.item._id,
  );
  const openCanva = useCallback((sourceMedia?: MediaType) => {
    setCanvaSourceMedia(sourceMedia || null);
    setIsCanvaImportOpen(true);
  }, []);
  const relinkVideoInput = useCallback((media: MediaType) => {
    setVideoInputToEdit(media.localVideoInput);
    setIsVideoInputOpen(true);
  }, []);
  const c = useMediaLibraryController({
    variant,
    pageMode,
    onManageCanvaSource: canvaOauthConfigured ? openCanva : undefined,
    onRelinkVideoInput: relinkVideoInput,
  });
  const { showAll, navigateToFolder } = c;

  useEffect(() => {
    if (!churchId) {
      setCanvaOauthConfigured(false);
      return;
    }
    let active = true;
    void getCanvaStatus(churchId)
      .then((status) => {
        if (active) setCanvaOauthConfigured(Boolean(status.oauthConfigured));
      })
      .catch(() => {
        if (active) setCanvaOauthConfigured(false);
      });
    return () => {
      active = false;
    };
  }, [churchId]);

  const selectedCount = c.selectedMediaIds.size;
  const mediaRenameWindowRef = useRef<FloatingWindowHandle>(null);
  const [mediaRenamePosition, setMediaRenamePosition] = useState({
    x: Math.max(window.innerWidth - 340, 0),
    y: 80,
  });

  const handleNewFolderCreated = useCallback(
    (nf: MediaFolder) => {
      if (!showAll) return;
      navigateToFolder(nf.parentId ?? MEDIA_LIBRARY_ROOT_VIEW);
    },
    [showAll, navigateToFolder],
  );

  const handleMediaRenameOpenChange = useCallback(
    (open: boolean) => {
      if (open && c.mediaRenameOpen) {
        mediaRenameWindowRef.current?.restore();
        return;
      }
      if (open) {
        const trigger = document.activeElement;
        if (trigger instanceof HTMLElement) {
          const rect = trigger.getBoundingClientRect();
          setMediaRenamePosition({
            x: Math.min(
              Math.max(rect.left, 8),
              Math.max(window.innerWidth - 340, 0),
            ),
            y: Math.min(rect.bottom + 8, Math.max(window.innerHeight - 240, 8)),
          });
        }
      }
      c.handleActionBarMediaRenameOpenChange(open);
    },
    [c],
  );

  let toolbarAddMediaTitle = "Add Media";
  if (c.uploadProgress.isUploading) {
    toolbarAddMediaTitle = `Uploading... ${Math.round(c.uploadProgress.progress)}%`;
  } else if (c.isGuestSession) {
    toolbarAddMediaTitle = "Guest mode: sample media only. Sign in to upload.";
  }

  const addLocalMedia = useCallback(
    (media: MediaType) => {
      const existing = c.list.find((item) => item.id === media.id);
      if (existing) {
        dispatch(updateMediaItemFields({ id: existing.id, patch: media }));
        return;
      }
      dispatch(addItemToMediaList(media));
    },
    [c.list, dispatch],
  );

  const addVideoInput = useCallback(
    (source: LocalVideoInputMediaSource) => {
      const now = new Date().toISOString();
      const id = `local_input_${source.sourceId}`;
      addLocalMedia({
        path: "",
        createdAt: now,
        updatedAt: now,
        format: "live",
        height: 1080,
        width: 1920,
        name: source.label,
        publicId: id,
        type: "video",
        id,
        background: `local-video-input://${encodeURIComponent(source.sourceId)}`,
        thumbnail: "",
        placeholderImage: "",
        source: "local",
        localVideoInput: source,
      });
    },
    [addLocalMedia],
  );

  return (
    <ErrorBoundary>
      <div
        className={cn(
          c.isPanelVariant && "flex flex-col min-h-0 w-full",
          c.isPanelVariant &&
          (c.isMediaExpanded ? "flex-1" : "shrink-0 mt-auto"),
          !c.isPanelVariant && "contents",
        )}
      >
        <div
          className={cn(
            "mx-2 flex items-center border-b border-gray-500 bg-black/60 text-sm relative z-10 transition-all px-2",
            c.isMediaExpanded ? "py-1 rounded-t-md" : "rounded-b-md py-0.5",
            "rounded-t-md mt-2",
          )}
        >
          <h2 className="font-semibold">Media</h2>
          <div className="flex-1 flex items-center justify-center">
            <Button
              variant="tertiary"
              svg={c.isMediaExpanded ? ChevronDown : ChevronUp}
              onClick={() => {
                dispatch(setIsMediaExpanded(!c.isMediaExpanded));
                if (c.isMediaExpanded) {
                  c.setSearchTerm("");
                }
              }}
            />
          </div>
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="tertiary"
                  svg={Plus}
                  title={toolbarAddMediaTitle}
                  aria-label="Add media"
                  disabled={c.uploadProgress.isUploading || c.isMediaReadOnly}
                >
                  {c.uploadProgress.isUploading
                    ? `${Math.round(c.uploadProgress.progress)}%`
                    : ""}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void c.requestMediaUpload()}>
                  <Upload /> Upload files
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setIsLocalImportOpen(true)}>
                  <HardDrive /> Import local files
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    setVideoInputToEdit(undefined);
                    setIsVideoInputOpen(true);
                  }}
                >
                  <Video /> Add video input
                </DropdownMenuItem>
                {canvaOauthConfigured ? (
                  <DropdownMenuItem
                    disabled={c.isGuestSession || c.isMediaReadOnly}
                    onSelect={() => openCanva()}
                  >
                    <ImageUp /> Import from Canva
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="tertiary"
              svg={Maximize}
              onClick={() => c.setIsFullscreen(true)}
              title="Fullscreen"
              disabled={c.isMediaReadOnly}
            />
          </div>
        </div>
        <MediaUploadInput
          ref={c.mediaUploadInputRef}
          onImageComplete={c.addNewBackground}
          onVideoComplete={c.addMuxVideo}
          showButton={false}
          uploadPreset="bpqu4ma5"
          cloudName="portable-media"
          onUploadActiveChange={c.handleUploadActiveChange}
          uploadDisabled={c.isGuestSession || c.isMediaReadOnly}
        />
        {isLocalImportOpen ? (
          <LocalMediaImportSheet
            open
            onOpenChange={setIsLocalImportOpen}
            activeItemId={activeItemId}
            onImported={addLocalMedia}
          />
        ) : null}
        {isVideoInputOpen ? (
          <LocalVideoInputPicker
            hideTrigger
            open
            source={videoInputToEdit}
            onOpenChange={(open) => {
              setIsVideoInputOpen(open);
              if (!open) setVideoInputToEdit(undefined);
            }}
            onLinked={addVideoInput}
          />
        ) : null}
        {!c.isMediaReadOnly && c.isMediaExpanded && (
          <>
            <div className="w-full min-w-0">
              <div className="mx-2 flex flex-wrap items-center gap-2 border-b border-gray-500 bg-black/60 px-4 py-2">
                <Input
                  type="text"
                  label="Search"
                  hideLabel
                  value={c.searchTerm}
                  onChange={(value) => c.setSearchTerm(String(value))}
                  placeholder="Search..."
                  aria-label="Search"
                  className="flex min-w-48 flex-1 gap-4 items-center"
                  inputWidth="w-full"
                  inputTextSize="text-sm"
                  svg={c.searchTerm ? X : undefined}
                  svgAction={() => c.setSearchTerm("")}
                  svgActionAriaLabel="Clear search"
                />
                <Toggle
                  label="Show all"
                  icon={LayoutGrid}
                  value={c.showAll}
                  onChange={c.handleShowAllChange}
                />
                <MediaOriginFilter
                  value={c.originFilter}
                  onChange={c.setOriginFilter}
                  className="w-40 shrink-0"
                />
              </div>
              <div className="w-full">
                <MediaLibraryActionBar
                  detailsRow={c.actionBarDetails}
                  showFolderActions={selectedCount === 0}
                  showNewFolderAction={selectedCount > 0}
                  folderNew={{
                    open: c.newFolderOpen,
                    onOpenChange: c.setNewFolderOpen,
                    content: (
                      <MediaLibraryNewFolderForm
                        folders={c.folders}
                        list={c.list}
                        parentForNewFolder={c.parentForNewFolder}
                        onUpdateFoldersAndList={c.applyFoldersAndList}
                        onFolderCreated={handleNewFolderCreated}
                        onClose={() => c.setNewFolderOpen(false)}
                      />
                    ),
                    contentClassName: MEDIA_LIBRARY_FORM_POPOVER_CLASS,
                  }}
                  folderRename={
                    c.selectedRealFolder
                      ? {
                        open: c.folderRenameOpen,
                        onOpenChange: c.setFolderRenameOpen,
                        content: (
                          <MediaLibraryRenameFolderForm
                            folders={c.folders}
                            list={c.list}
                            folder={c.selectedRealFolder}
                            onUpdateFoldersAndList={c.applyFoldersAndList}
                            onClose={() => c.setFolderRenameOpen(false)}
                          />
                        ),
                        contentClassName: MEDIA_LIBRARY_FORM_POPOVER_CLASS,
                      }
                      : null
                  }
                  onDeleteFolder={c.handleRequestFolderDelete}
                  showFolderRenameDelete={Boolean(c.selectedRealFolder)}
                  showMediaRename={selectedCount === 1}
                  mediaRenameOpen={c.mediaRenameOpen}
                  onMediaRenameOpenChange={handleMediaRenameOpenChange}
                  renameMediaContent={null}
                  mediaActions={selectedCount > 0 ? c.mediaBarActions : []}
                  slideBackgroundFeedbackId={c.slideBackgroundFeedbackId}
                  showMoveSelect={selectedCount > 0}
                  moveSelectOptions={c.moveSelectOptions}
                  onMoveTo={c.handleMoveTo}
                  moveSelectResetKey={c.moveSelectKey}
                  moveToNewFolderOpen={c.moveToNewFolderOpen}
                  onMoveToNewFolderOpenChange={
                    c.handleActionBarMoveToNewFolderOpenChange
                  }
                  showMultiSelectDone={c.mediaMultiSelectMode}
                  onMultiSelectDone={c.clearSelection}
                  moveToNewFolderContent={
                    selectedCount > 0 ? (
                      <MediaLibraryNewFolderForm
                        folders={c.folders}
                        list={c.list}
                        parentForNewFolder={c.parentForNewFolder}
                        onUpdateFoldersAndList={c.applyFoldersAndList}
                        onFolderCreated={handleNewFolderCreated}
                        adjustListAfterCreate={(nf, _nextFolders, listBefore) =>
                          moveMediaToFolder(
                            c.selectedMediaIds,
                            nf.id,
                            listBefore,
                          )
                        }
                        onClose={() => {
                          c.closeMoveToNewFolderPopover();
                          c.setMoveSelectKey((k: number) => k + 1);
                          c.clearSelection();
                        }}
                      />
                    ) : null
                  }
                />
              </div>
            </div>
            <MediaLibraryFolderModals
              selectedLibraryFilter={c.selectedLibraryFilter}
              onSelectLibraryFilter={c.navigateToFolder}
              folders={c.folders}
              list={c.list}
              onUpdateFoldersAndList={c.applyFoldersAndList}
              onDeleteFolderSubtree={c.handleDeleteFolderSubtree}
              onDeleteFolderKeepContents={c.handleDeleteFolderKeepContents}
              folderDeleteOpen={c.folderDeleteOpen}
              onFolderDeleteOpenChange={c.setFolderDeleteOpen}
            />
          </>
        )}
        <MediaLibraryGrid
          isPanelVariant={c.isPanelVariant}
          isMediaExpanded={c.isMediaExpanded}
          isMediaLoading={c.isMediaLoading}
          hasMediaLoadError={c.hasMediaLoadError}
          mediaItemsPerRow={c.mediaItemsPerRow}
          mediaListRef={c.mediaListRef}
          mediaGridRef={c.mediaGridRef}
          filteredList={c.filteredList}
          showAll={c.showAll}
          showNamesInPanelGrid={c.showNamesInPanelGrid}
          searchTerm={c.searchTerm}
          childFolders={c.childFolders}
          canGoUp={c.canGoUp}
          currentFolderName={c.selectedRealFolder?.name}
          onGoUp={c.handleGoUp}
          onOpenFolder={c.navigateToFolder}
          selectedMedia={c.selectedMedia}
          selectedMediaIds={c.selectedMediaIds}
          mediaMultiSelectMode={c.mediaMultiSelectMode}
          onMediaTileClick={c.handleMediaClick}
          onEnterMediaMultiSelectMode={c.enterMediaMultiSelectMode}
        />

        <DeleteModal
          isOpen={c.showDeleteModal}
          onClose={c.handleCancelDelete}
          onConfirm={c.handleConfirmDelete}
          isConfirming={c.isDeleteInProgress}
          itemName={c.isDeletingMultiple ? undefined : c.mediaToDelete?.name}
          title="Delete Media"
          message={
            c.isDeletingMultiple
              ? `Are you sure you want to delete ${selectedCount} items`
              : "Are you sure you want to delete"
          }
          imageUrl={
            c.isDeletingMultiple ? undefined : c.mediaToDelete?.thumbnail
          }
        />

        <MediaProviderRetryModal
          isOpen={c.showProviderRetryModal}
          failedCount={c.providerRetryRows.length}
          isRetrying={c.providerRetryBusy}
          onRetry={c.handleProviderRetry}
          onDismiss={c.handleDismissProviderRetry}
        />

        <MediaModal
          isOpen={c.isFullscreen}
          onClose={() => c.setIsFullscreen(false)}
          mediaList={c.filteredList}
          routeKey={c.routeKey}
          pageMode={c.pageMode}
          selectedLibraryFilter={c.selectedLibraryFilter}
          onSelectLibraryFilter={c.navigateToFolder}
          folders={c.folders}
          fullList={c.list}
          onUpdateFoldersAndList={c.applyFoldersAndList}
          onDeleteFolderKeepContents={c.handleDeleteFolderKeepContents}
          onDeleteFolderSubtree={c.handleDeleteFolderSubtree}
          selectedMedia={c.selectedMedia}
          selectedMediaIds={c.selectedMediaIds}
          previewMedia={c.previewMedia}
          searchTerm={c.searchTerm}
          showName={c.showName}
          typeFilter={c.typeFilter}
          onTypeFilterChange={c.setTypeFilter}
          originFilter={c.originFilter}
          onOriginFilterChange={c.setOriginFilter}
          onMediaClick={c.handleMediaClick}
          onSearchChange={(value) => c.setSearchTerm(value)}
          onShowNameToggle={() => c.setShowName(!c.showName)}
          onDeleteClick={(mediaItem) => {
            c.setMediaToDelete(mediaItem);
            c.setShowDeleteModal(true);
          }}
          onDeleteMultipleClick={c.openMultiDeleteModal}
          onPreviewChange={c.setPreviewMedia}
          mediaUploadInputRef={c.mediaUploadInputRef}
          uploadProgress={c.uploadProgress}
          onAddMediaClick={c.requestMediaUpload}
          onImportLocalMedia={() => setIsLocalImportOpen(true)}
          onAddVideoInput={() => {
            setVideoInputToEdit(undefined);
            setIsVideoInputOpen(true);
          }}
          onRelinkVideoInput={relinkVideoInput}
          onImportFromCanva={canvaOauthConfigured ? openCanva : undefined}
          mediaUploadDisabled={c.isGuestSession || c.isMediaReadOnly}
        />
        {canvaOauthConfigured ? (
          <CanvaImportSheet
            open={isCanvaImportOpen}
            onOpenChange={(open) => {
              setIsCanvaImportOpen(open);
              if (!open) setCanvaSourceMedia(null);
            }}
            onImageComplete={c.addNewBackground}
            onVideoComplete={c.addMuxVideo}
            onImageRefresh={c.refreshCanvaImage}
            onVideoRefresh={c.refreshCanvaVideo}
            existingMedia={c.list}
            sourceMedia={canvaSourceMedia}
          />
        ) : null}
        {selectedCount === 1 && c.mediaRenameOpen ? (
          <FloatingWindow
            ref={mediaRenameWindowRef}
            title="Rename media"
            onClose={c.closeMediaRenamePopover}
            defaultWidth={320}
            defaultHeight={220}
            defaultPosition={mediaRenamePosition}
            autoHeight
          >
            <MediaLibraryRenameMediaForm
              media={c.selectedMedia}
              onSave={c.handleRenameMediaSave}
              onClose={c.closeMediaRenamePopover}
            />
          </FloatingWindow>
        ) : null}
      </div>
    </ErrorBoundary>
  );
};

export default Media;
