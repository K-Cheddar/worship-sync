import {
  FilePlus2,
  Image,
  ImageOff,
  Images,
  Layers,
  MonitorPlay,
  Trash2,
} from "lucide-react";
import cn from "classnames";
import {
  MEDIA_LIBRARY_MEDIA_ACTION_CREATE_ICON_CLASS,
  MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE,
} from "./mediaLibraryMediaActionUi";
import type {
  ItemSlideType,
  ItemType,
  MediaType,
  QuickLinkType,
} from "../../types";
import type { AppDispatch } from "../../store/store";
import {
  clearSlideBackgroundsOnSubset,
  updateAllSlideBackgrounds,
  updateSlideBackground,
  updateSlideBackgroundsOnSubset,
} from "../../store/itemSlice";
import {
  filterExistingSlideIds,
  getAllMatchingSectionNameSlideIds,
  getAllMatchingTypeSlideIds,
  getThisSectionSlideIds,
  normalizeSongSlideSectionName,
  slideTypeLabelForMenu,
} from "../../utils/backgroundTargetResolution";
import { updateOverlay } from "../../store/overlaySlice";
import { updateOverlayInList } from "../../store/overlaysSlice";
import {
  setDefaultPreferences,
  setSelectedQuickLinkImage,
} from "../../store/preferencesSlice";
import type { OverlayInfo } from "../../types";
import type { ToastVariant } from "../../components/Toast/Toast";
import { truncatedMediaToastLabel } from "./mediaLibraryMeta";
import {
  isLocalVideoInputMedia,
  mediaHasSendableContent,
} from "../../utils/localVideoMediaLibrary";

/** Build apply/clear payloads so live inputs set mediaSource instead of a fake URL. */
const backgroundApplyArgs = (m: MediaType) => {
  if (isLocalVideoInputMedia(m)) {
    return {
      background: "",
      mediaSource: m.localVideoInput,
    };
  }
  return {
    background: m.background,
    mediaInfo: m,
  };
};

export type MediaActionRouteFlags = {
  itemSlides: boolean;
  overlayImage: boolean;
  preferenceBackground: boolean;
  quickLinkMedia: boolean;
};

export type MediaLibraryBarMenuEntry = {
  id: string;
  label: string;
  disabled?: boolean;
  onClick: () => void;
  /** Maps to slide-rail section colors (`itemSectionBgColorMap`). */
  sectionBadgeType?: string;
};

export type ControllerFromSelectedMediaActions = {
  isProjectorTransmitting: boolean;
  /**
   * What the send action is aimed at, named by the operator. The label used to
   * read "projector" everywhere, which is wrong on a controller whose only
   * screen is called something else.
   */
  sendTargetLabel: string;
  onSendToProjector: () => void;
  onCreateCustomItem: () => void | Promise<void>;
  onAddSlides?: () => void;
};

export type MediaLibraryBarAction = {
  id: string;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  variant?: "default" | "destructive";
} & (
    | { menuItems: MediaLibraryBarMenuEntry[]; onClick?: undefined }
    | { menuItems?: undefined; onClick: () => void }
  );

export function buildMediaActionRouteFlags(
  pathname: string,
  pageMode: "default" | "overlayController",
  selectedOverlay: OverlayInfo | null | undefined,
  selectedPreference: string | null | undefined,
  selectedQuickLink: QuickLinkType | null | undefined,
): MediaActionRouteFlags {
  return {
    itemSlides: pathname.includes("item"),
    overlayImage:
      (pathname.includes("overlays") || pageMode === "overlayController") &&
      selectedOverlay?.type === "image",
    preferenceBackground:
      pathname.includes("preferences") &&
      !pathname.includes("quick-links") &&
      !pathname.includes("monitor-settings") &&
      !pathname.includes("displays") &&
      Boolean(selectedPreference),
    quickLinkMedia:
      pathname.includes("quick-links") &&
      selectedQuickLink?.linkType === "media",
  };
}

export function buildMediaLibraryBarActions(args: {
  flags: MediaActionRouteFlags;
  db: unknown;
  isLoading: boolean;
  selectedPreference: string | null | undefined;
  selectedQuickLink: QuickLinkType | null | undefined;
  selectedOverlay: OverlayInfo | null | undefined;
  primaryMedia: MediaType;
  hasMultipleSelection: boolean;
  selectedCount: number;
  dispatch: AppDispatch;
  onDeleteSingle: () => void;
  onDeleteMultiple: () => void;
  /** When set (item route + slides), enables Apply to… / Clear… subset menus. */
  itemSlideContext?: {
    itemType: ItemType;
    slides: ItemSlideType[];
    selectedSlide: number;
    backgroundTargetSlideIds: string[];
  };
  /** Controller: send selected media live, or add a new custom (free-form) item that uses it. */
  controllerFromSelectedMedia?: ControllerFromSelectedMediaActions;
  /** Success / info toasts after actions complete (omit delete; those use the confirm modal). */
  notify?: (message: string, variant?: ToastVariant) => void;
  /** Item slide apply/clear: no toast — parent shows a brief check + disabled state on the action control. */
  onItemSlideBackgroundFeedback?: (feedbackId: string) => void;
}): MediaLibraryBarAction[] {
  const {
    flags,
    db,
    isLoading,
    selectedPreference,
    selectedQuickLink,
    selectedOverlay,
    primaryMedia,
    hasMultipleSelection,
    selectedCount,
    dispatch,
    onDeleteSingle,
    onDeleteMultiple,
    itemSlideContext,
    controllerFromSelectedMedia,
    notify,
    onItemSlideBackgroundFeedback,
  } = args;

  const toast = (message: string, variant: ToastVariant = "success") => {
    notify?.(message, variant);
  };

  const slideBgAck = (feedbackId: string) => {
    onItemSlideBackgroundFeedback?.(feedbackId);
  };

  const m = primaryMedia;
  const mediaLabel = truncatedMediaToastLabel(m);
  const out: MediaLibraryBarAction[] = [];

  if (flags.itemSlides && !hasMultipleSelection) {
    const manualIdsForSubset = itemSlideContext
      ? filterExistingSlideIds(
        itemSlideContext.slides,
        itemSlideContext.backgroundTargetSlideIds,
      )
      : [];
    const applyMultiManualSlideTargets = manualIdsForSubset.length > 1;

    const setAllSlidesAction: MediaLibraryBarAction = {
      id: "apply-all-slides",
      label: "Apply to all slides",
      icon: <Images className={MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE} />,
      disabled: isLoading || !mediaHasSendableContent(m),
      onClick: () => {
        if (mediaHasSendableContent(m) && db) {
          dispatch(updateAllSlideBackgrounds(backgroundApplyArgs(m)));
          slideBgAck("apply-all-slides");
        }
      },
    };

    out.push(
      {
        id: "apply-selected-slides",
        label: `Apply to selected slides (${manualIdsForSubset.length || 1})`,
        icon: <Image className={cn(MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE, "text-cyan-400")} />,
        disabled: isLoading || !mediaHasSendableContent(m) || !db,
        onClick: () => {
          if (!mediaHasSendableContent(m) || !db) return;
          if (manualIdsForSubset.length === 0) {
            dispatch(updateSlideBackground(backgroundApplyArgs(m)));
            slideBgAck("apply-selected-slides");
            return;
          }
          dispatch(
            updateSlideBackgroundsOnSubset({
              slideIds: manualIdsForSubset,
              ...backgroundApplyArgs(m),
            }),
          );
          slideBgAck("apply-selected-slides");
        },
      },
      setAllSlidesAction,
    );

    if (itemSlideContext) {
      const { itemType, slides, selectedSlide } = itemSlideContext;
      const sectionIds = getThisSectionSlideIds(
        slides,
        selectedSlide,
        itemType,
      );
      const allTypeIds = getAllMatchingTypeSlideIds(
        slides,
        selectedSlide,
        itemType,
      );
      const allNamedSectionIds = getAllMatchingSectionNameSlideIds(
        slides,
        selectedSlide,
        itemType,
      );
      const showAllNamedSectionOccurrences =
        itemType === "song" &&
        allNamedSectionIds.length > sectionIds.length;
      const namedSectionLabel =
        itemType === "song" && slides[selectedSlide]
          ? normalizeSongSlideSectionName(slides[selectedSlide].name) ||
          "this section"
          : "this section";
      const manualIds = manualIdsForSubset;
      const currentType = slides[selectedSlide]?.type;
      const typeLabel = currentType
        ? slideTypeLabelForMenu(currentType)
        : "slides";
      const sectionBadgeType = currentType ?? undefined;

      const applyDisabled = isLoading || !mediaHasSendableContent(m) || !db;
      const applyMenuItems: MediaLibraryBarMenuEntry[] = [
        {
          id: "apply-this-section",
          label: `This section (${sectionIds.length} slides)`,
          sectionBadgeType,
          disabled: applyDisabled || sectionIds.length === 0,
          onClick: () => {
            if (!mediaHasSendableContent(m) || !db || sectionIds.length === 0)
              return;
            dispatch(
              updateSlideBackgroundsOnSubset({
                slideIds: sectionIds,
                ...backgroundApplyArgs(m),
              }),
            );
            slideBgAck("apply-to-subset");
          },
        },
      ];
      if (showAllNamedSectionOccurrences) {
        applyMenuItems.push({
          id: "apply-all-named-section",
          label: `All ${namedSectionLabel} (${allNamedSectionIds.length} slides)`,
          sectionBadgeType,
          disabled: applyDisabled || allNamedSectionIds.length === 0,
          onClick: () => {
            if (
              !mediaHasSendableContent(m) ||
              !db ||
              allNamedSectionIds.length === 0
            )
              return;
            dispatch(
              updateSlideBackgroundsOnSubset({
                slideIds: allNamedSectionIds,
                ...backgroundApplyArgs(m),
              }),
            );
            slideBgAck("apply-to-subset");
          },
        });
      }
      if (itemType === "song") {
        applyMenuItems.push({
          id: "apply-all-type",
          label: `All ${typeLabel} (${allTypeIds.length} slides)`,
          sectionBadgeType,
          disabled: applyDisabled || allTypeIds.length === 0,
          onClick: () => {
            if (!mediaHasSendableContent(m) || !db || allTypeIds.length === 0)
              return;
            dispatch(
              updateSlideBackgroundsOnSubset({
                slideIds: allTypeIds,
                ...backgroundApplyArgs(m),
              }),
            );
            slideBgAck("apply-to-subset");
          },
        });
      }
      if (manualIds.length > 0 && !applyMultiManualSlideTargets) {
        applyMenuItems.push({
          id: "apply-manual",
          label: `Selected slides (${manualIds.length})`,
          sectionBadgeType,
          disabled: applyDisabled,
          onClick: () => {
            if (!mediaHasSendableContent(m) || !db) return;
            dispatch(
              updateSlideBackgroundsOnSubset({
                slideIds: manualIds,
                ...backgroundApplyArgs(m),
              }),
            );
            slideBgAck("apply-to-subset");
          },
        });
      }

      const clearMenuItems: MediaLibraryBarMenuEntry[] = [
        {
          id: "clear-this-section",
          label: `This section (${sectionIds.length} slides)`,
          sectionBadgeType,
          disabled: isLoading || !db || sectionIds.length === 0,
          onClick: () => {
            if (!db || sectionIds.length === 0) return;
            dispatch(clearSlideBackgroundsOnSubset({ slideIds: sectionIds }));
            slideBgAck("clear-background-subset");
          },
        },
      ];
      if (showAllNamedSectionOccurrences) {
        clearMenuItems.push({
          id: "clear-all-named-section",
          label: `All ${namedSectionLabel} (${allNamedSectionIds.length} slides)`,
          sectionBadgeType,
          disabled: isLoading || !db || allNamedSectionIds.length === 0,
          onClick: () => {
            if (!db || allNamedSectionIds.length === 0) return;
            dispatch(
              clearSlideBackgroundsOnSubset({ slideIds: allNamedSectionIds }),
            );
            slideBgAck("clear-background-subset");
          },
        });
      }
      if (itemType === "song") {
        clearMenuItems.push({
          id: "clear-all-type",
          label: `All ${typeLabel} (${allTypeIds.length} slides)`,
          sectionBadgeType,
          disabled: isLoading || !db || allTypeIds.length === 0,
          onClick: () => {
            if (!db || allTypeIds.length === 0) return;
            dispatch(clearSlideBackgroundsOnSubset({ slideIds: allTypeIds }));
            slideBgAck("clear-background-subset");
          },
        });
      }
      if (manualIds.length > 0) {
        clearMenuItems.push({
          id: "clear-manual",
          label: `Selected slides (${manualIds.length})`,
          sectionBadgeType,
          disabled: isLoading || !db,
          onClick: () => {
            if (!db) return;
            dispatch(clearSlideBackgroundsOnSubset({ slideIds: manualIds }));
            slideBgAck("clear-background-subset");
          },
        });
      }

      out.push(
        {
          id: "apply-to-subset",
          label: "Apply to…",
          icon: (
            <Layers
              className={cn(
                MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE,
                "text-cyan-400",
              )}
            />
          ),
          disabled: applyDisabled,
          menuItems: applyMenuItems,
        },
        {
          id: "clear-background-subset",
          label: "Clear…",
          icon: (
            <ImageOff
              className={cn(
                MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE,
                "text-cyan-400",
              )}
            />
          ),
          disabled: isLoading || !db,
          menuItems: clearMenuItems,
        },
      );
    }
  }

  if (flags.overlayImage) {
    out.push({
      id: "set-image-overlay",
      label: "Set Image Overlay",
      icon: <Image className={MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE} />,
      disabled:
        !m.background || !selectedOverlay || isLocalVideoInputMedia(m),
      onClick: () => {
        if (m.background && db && !isLocalVideoInputMedia(m)) {
          dispatch(
            updateOverlay({
              imageUrl: m.background,
              id: selectedOverlay?.id,
            }),
          );
          dispatch(
            updateOverlayInList({
              imageUrl: m.background,
              id: selectedOverlay?.id,
            }),
          );
          toast(`Set overlay image to "${mediaLabel}".`);
        }
      },
    });
  }

  if (flags.preferenceBackground && selectedPreference) {
    out.push({
      id: "set-pref-bg",
      label: "Set Background",
      icon: <Image className={MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE} />,
      disabled:
        !selectedPreference ||
        !m.background ||
        isLocalVideoInputMedia(m),
      onClick: () => {
        if (isLocalVideoInputMedia(m)) return;
        dispatch(
          setDefaultPreferences({
            [selectedPreference]: {
              background: m.background,
              mediaInfo: m,
            },
          }),
        );
        toast(`Saved "${mediaLabel}" as default background.`);
      },
    });
  }

  if (flags.quickLinkMedia) {
    out.push({
      id: "set-quick-link",
      label: "Set Quick Link Background",
      icon: <Image className={MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE} />,
      disabled:
        !selectedQuickLink ||
        selectedQuickLink?.linkType !== "media" ||
        isLocalVideoInputMedia(m),
      onClick: () => {
        if (isLocalVideoInputMedia(m)) return;
        dispatch(setSelectedQuickLinkImage(m));
        toast(`Set quick link background to "${mediaLabel}".`);
      },
    });
  }

  if (controllerFromSelectedMedia) {
    const {
      isProjectorTransmitting,
      sendTargetLabel,
      onSendToProjector,
      onCreateCustomItem,
      onAddSlides,
    } = controllerFromSelectedMedia;
    /** Do not use `isLoading` (item document) here — it stays true during unrelated item fetches and incorrectly disables send. */
    const sendDisabled =
      !mediaHasSendableContent(m) || !isProjectorTransmitting;
    const createLabel = hasMultipleSelection
      ? "Create custom item"
      : isLocalVideoInputMedia(m)
        ? "Create live input item"
        : "Create custom item";
    if (onAddSlides && flags.itemSlides) {
      out.push({
        id: "add-slides-from-media",
        label: hasMultipleSelection ? `Add ${selectedCount} slides` : "Add slide",
        icon: <FilePlus2 className={MEDIA_LIBRARY_MEDIA_ACTION_CREATE_ICON_CLASS} />,
        disabled: !db || !mediaHasSendableContent(m),
        onClick: onAddSlides,
      });
    }
    if (!hasMultipleSelection) {
      out.push({
        id: "send-media-to-projector",
        label: `Send to ${sendTargetLabel}`,
        icon: (
          <MonitorPlay
            className={cn(
              MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE,
              sendDisabled ? "text-gray-500" : "text-lime-500",
            )}
          />
        ),
        disabled: sendDisabled,
        onClick: onSendToProjector,
      });
    }
    out.push({
        id: "create-custom-item-from-media",
        label: createLabel,
        icon: <FilePlus2 className={MEDIA_LIBRARY_MEDIA_ACTION_CREATE_ICON_CLASS} />,
        disabled: !mediaHasSendableContent(m) || !db,
        onClick: () => {
          void Promise.resolve(onCreateCustomItem());
        },
    });
  }

  out.push({
    id: hasMultipleSelection ? "delete-multiple" : "delete",
    label: hasMultipleSelection ? `Delete ${selectedCount} items` : "Delete",
    icon: <Trash2 className={MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE} />,
    variant: "destructive",
    onClick: hasMultipleSelection ? onDeleteMultiple : onDeleteSingle,
  });

  return out;
}
