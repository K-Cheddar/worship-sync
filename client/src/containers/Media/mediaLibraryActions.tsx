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
  onSendToProjector: () => void;
  onCreateCustomItem: () => void | Promise<void>;
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
  } = args;

  const toast = (message: string, variant: ToastVariant = "success") => {
    notify?.(message, variant);
  };

  if (hasMultipleSelection) {
    return [
      {
        id: "delete-multiple",
        label: `Delete ${selectedCount} items`,
        icon: <Trash2 className={MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE} />,
        variant: "destructive",
        onClick: onDeleteMultiple,
      },
    ];
  }

  const m = primaryMedia;
  const mediaLabel = truncatedMediaToastLabel(m);
  const out: MediaLibraryBarAction[] = [];

  if (flags.itemSlides) {
    out.push(
      {
        id: "set-all-slides",
        label: "Set All Slides",
        icon: <Images className={MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE} />,
        disabled: isLoading || !m.background,
        onClick: () => {
          if (m.background && db) {
            dispatch(
              updateAllSlideBackgrounds({
                background: m.background,
                mediaInfo: m,
              }),
            );
            toast("Applied this media to all slides.");
          }
        },
      },
      {
        id: "set-selected-slide",
        label: "Set Selected Slide",
        icon: <Image className={MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE} />,
        disabled: isLoading || !m.background,
        onClick: () => {
          if (m.background && db) {
            dispatch(
              updateSlideBackground({
                background: m.background,
                mediaInfo: m,
              }),
            );
            toast(`Applied "${mediaLabel}" to the selected slide.`);
          }
        },
      },
    );

    if (itemSlideContext) {
      const {
        itemType,
        slides,
        selectedSlide,
        backgroundTargetSlideIds,
      } = itemSlideContext;
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
      const manualIds = filterExistingSlideIds(
        slides,
        backgroundTargetSlideIds,
      );
      const currentType = slides[selectedSlide]?.type;
      const typeLabel = currentType
        ? slideTypeLabelForMenu(currentType)
        : "slides";
      const sectionBadgeType = currentType ?? undefined;

      const applyDisabled = isLoading || !m.background || !db;
      const applyMenuItems: MediaLibraryBarMenuEntry[] = [
        {
          id: "apply-this-section",
          label: `This section (${sectionIds.length} slides)`,
          sectionBadgeType,
          disabled: applyDisabled || sectionIds.length === 0,
          onClick: () => {
            if (!m.background || !db || sectionIds.length === 0) return;
            dispatch(
              updateSlideBackgroundsOnSubset({
                slideIds: sectionIds,
                background: m.background,
                mediaInfo: m,
              }),
            );
            toast(`Applied "${mediaLabel}" to the section.`);
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
            if (!m.background || !db || allNamedSectionIds.length === 0) return;
            dispatch(
              updateSlideBackgroundsOnSubset({
                slideIds: allNamedSectionIds,
                background: m.background,
                mediaInfo: m,
              }),
            );
            toast(`Applied "${mediaLabel}" to matching slides.`);
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
            if (!m.background || !db || allTypeIds.length === 0) return;
            dispatch(
              updateSlideBackgroundsOnSubset({
                slideIds: allTypeIds,
                background: m.background,
                mediaInfo: m,
              }),
            );
            toast(`Applied "${mediaLabel}" to all ${typeLabel}.`);
          },
        });
      }
      if (manualIds.length > 0) {
        applyMenuItems.push({
          id: "apply-manual",
          label: `Selected slides (${manualIds.length})`,
          sectionBadgeType,
          disabled: applyDisabled,
          onClick: () => {
            if (!m.background || !db) return;
            dispatch(
              updateSlideBackgroundsOnSubset({
                slideIds: manualIds,
                background: m.background,
                mediaInfo: m,
              }),
            );
            toast(`Applied "${mediaLabel}" to the selected slides.`);
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
            toast("Cleared backgrounds for the section.");
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
            toast("Cleared backgrounds for matching slides.");
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
            toast(`Cleared backgrounds for all ${typeLabel}.`);
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
            toast("Cleared backgrounds for the selected slides.");
          },
        });
      }

      out.push(
        {
          id: "apply-to-subset",
          label: "Apply to…",
          icon: <Layers className={MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE} />,
          disabled: applyDisabled,
          menuItems: applyMenuItems,
        },
        {
          id: "clear-background-subset",
          label: "Clear…",
          icon: <ImageOff className={MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE} />,
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
      disabled: !m.background || !selectedOverlay,
      onClick: () => {
        if (m.background && db) {
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
      disabled: !selectedPreference || !m.background,
      onClick: () => {
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
        !selectedQuickLink || selectedQuickLink?.linkType !== "media",
      onClick: () => {
        dispatch(setSelectedQuickLinkImage(m));
        toast(`Set quick link background to "${mediaLabel}".`);
      },
    });
  }

  if (controllerFromSelectedMedia) {
    const {
      isProjectorTransmitting,
      onSendToProjector,
      onCreateCustomItem,
    } = controllerFromSelectedMedia;
    /** Do not use `isLoading` (item document) here — it stays true during unrelated item fetches and incorrectly disables send. */
    const sendDisabled = !m.background || !isProjectorTransmitting;
    out.push(
      {
        id: "send-media-to-projector",
        label: "Send to projector",
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
      },
      {
        id: "create-custom-item-from-media",
        label: "Create custom item",
        icon: <FilePlus2 className={MEDIA_LIBRARY_MEDIA_ACTION_CREATE_ICON_CLASS} />,
        disabled: !m.background || !db,
        onClick: () => {
          void Promise.resolve(onCreateCustomItem());
        },
      },
    );
  }

  out.push({
    id: "delete",
    label: "Delete",
    icon: <Trash2 className={MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE} />,
    variant: "destructive",
    onClick: onDeleteSingle,
  });

  return out;
}
