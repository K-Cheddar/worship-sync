import {
  ItemDetailsModal,
  type ItemDetailsModalProps,
} from "../ItemDetailsModal/ItemDetailsModal";

export { ItemDetailsModal, type ItemDetailsModalProps };

/** @deprecated Use `ItemDetailsModal` with `itemType="song"`. */
export const SongItemMetadataModal = ItemDetailsModal;
