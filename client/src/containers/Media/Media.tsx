import Button from "../../components/Button/Button";
import Input from "../../components/Input/Input";
import DeleteModal from "../../components/Modal/DeleteModal";
import {
  ChevronDown,
  ChevronUp,
  LayoutGrid,
  Maximize,
  Plus,
  X,
} from "lucide-react";
import { useCallback } from "react";
import { useDispatch } from "../../hooks";
import MediaUploadInput from "./MediaUploadInput";
import {
  setIsMediaExpanded,
} from "../../store/preferencesSlice";
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
import ErrorBoundary from "../../components/ErrorBoundary/ErrorBoundary";
import MediaModal from "./MediaModal";
import MediaProviderRetryModal from "./MediaProviderRetryModal";
import MediaLibraryGrid from "./MediaLibraryGrid";
import { useMediaLibraryController } from "./useMediaLibraryController";
import type { MediaFolder } from "../../types";

const MEDIA_LIBRARY_FORM_POPOVER_CLASS =
  "w-72 border border-gray-600 bg-gray-900 p-3 text-white";

type MediaProps = {
  /** Stacked with TransmitHandler: collapsed bar at bottom; expanded fills column above hidden transmit. */
  variant?: "default" | "panel";
  pageMode?: "default" | "overlayController";
};

const Media = ({ variant = "default", pageMode = "default" }: MediaProps) => {
  const dispatch = useDispatch();
  const c = useMediaLibraryController({ variant, pageMode });
  const { showAll, navigateToFolder } = c;
  const selectedCount = c.selectedMediaIds.size;

  const handleNewFolderCreated = useCallback(
    (nf: MediaFolder) => {
      if (!showAll) return;
      navigateToFolder(nf.parentId ?? MEDIA_LIBRARY_ROOT_VIEW);
    },
    [showAll, navigateToFolder],
  );

  let toolbarAddMediaTitle = "Add Media";
  if (c.uploadProgress.isUploading) {
    toolbarAddMediaTitle = `Uploading... ${Math.round(c.uploadProgress.progress)}%`;
  } else if (c.isGuestSession) {
    toolbarAddMediaTitle = "Guest mode: sample media only. Sign in to upload.";
  }

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
            <Button
              variant="tertiary"
              svg={Plus}
              onClick={() => void c.requestMediaUpload()}
              title={toolbarAddMediaTitle}
              disabled={c.uploadProgress.isUploading}
            >
              {c.uploadProgress.isUploading
                ? `${Math.round(c.uploadProgress.progress)}%`
                : ""}
            </Button>
            <Button
              variant="tertiary"
              svg={Maximize}
              onClick={() => c.setIsFullscreen(true)}
              title="Fullscreen"
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
          uploadDisabled={c.isGuestSession}
        />
        {!c.isMediaLoading && c.isMediaExpanded && (
          <>
            <div className="w-full min-w-0">
              <div className="mx-2 flex items-center gap-2 border-b border-gray-500 bg-black/60 px-4 py-2">
                <Input
                  type="text"
                  label="Search"
                  hideLabel
                  value={c.searchTerm}
                  onChange={(value) => c.setSearchTerm(String(value))}
                  placeholder="Search..."
                  aria-label="Search"
                  className="flex gap-4 items-center flex-1"
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
                  onMediaRenameOpenChange={c.handleActionBarMediaRenameOpenChange}
                  renameMediaContent={
                    selectedCount === 1 ? (
                      <MediaLibraryRenameMediaForm
                        media={c.selectedMedia}
                        onSave={c.handleRenameMediaSave}
                        onClose={c.closeMediaRenamePopover}
                      />
                    ) : null
                  }
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
          mediaItemsPerRow={c.mediaItemsPerRow}
          mediaListRef={c.mediaListRef}
          filteredList={c.filteredList}
          visibleMediaItems={c.visibleFilteredList}
          isMediaGridFullyLoaded={c.isMediaGridFullyLoaded}
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
          itemName={
            c.isDeletingMultiple ? undefined : c.mediaToDelete?.name
          }
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
          mediaUploadDisabled={c.isGuestSession}
        />
      </div>
    </ErrorBoundary>
  );
};

export default Media;
