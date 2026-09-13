import type { AccessType } from "../../context/globalInfo";
import type { ItemType } from "../../types";
import type { ControllerProfileType } from "../../utils/controllerProfiles";
import {
  initialCreateItemState,
  type CreateItemState,
} from "../../store/createItemSlice";

export type CreateItemTypeOption = {
  type: ItemType;
  label: string;
  access?: AccessType[];
};

/**
 * Presentation (main) controller: songs first — that is the primary library.
 * Aux controllers: custom first — operators usually build their own slides there.
 */
const PRESENTATION_CREATE_ITEM_TYPES: CreateItemTypeOption[] = [
  {
    type: "song",
    label: "Song",
    access: ["full", "music"],
  },
  {
    type: "bible",
    label: "Bible",
    access: ["full"],
  },
  {
    type: "free",
    label: "Custom Item",
    access: ["full", "music"],
  },
  {
    type: "timer",
    label: "Timer",
    access: ["full"],
  },
];

const AUX_CREATE_ITEM_TYPES: CreateItemTypeOption[] = [
  {
    type: "free",
    label: "Custom Item",
    access: ["full", "music"],
  },
  {
    type: "song",
    label: "Song",
    access: ["full", "music"],
  },
  {
    type: "bible",
    label: "Bible",
    access: ["full"],
  },
  {
    type: "timer",
    label: "Timer",
    access: ["full"],
  },
];

export const getCreateItemTypeOptions = (
  controllerType: ControllerProfileType,
): CreateItemTypeOption[] =>
  controllerType === "aux-presentation"
    ? AUX_CREATE_ITEM_TYPES
    : PRESENTATION_CREATE_ITEM_TYPES;

export const getDefaultCreateItemType = (
  controllerType: ControllerProfileType,
): ItemType => (controllerType === "aux-presentation" ? "free" : "song");

/**
 * True when the Redux draft is still the global blank default (song, empty
 * fields). Used so aux can switch the default to Custom without wiping an
 * in-progress draft or an explicit type the operator already chose.
 */
export const isUnstartedCreateItemDraft = (draft: CreateItemState): boolean =>
  draft.name === initialCreateItemState.name &&
  draft.type === initialCreateItemState.type &&
  draft.text === initialCreateItemState.text &&
  draft.songArtist === initialCreateItemState.songArtist &&
  draft.songAlbum === initialCreateItemState.songAlbum &&
  draft.songMetadata === initialCreateItemState.songMetadata &&
  draft.hours === initialCreateItemState.hours &&
  draft.minutes === initialCreateItemState.minutes &&
  draft.seconds === initialCreateItemState.seconds &&
  draft.time === initialCreateItemState.time &&
  draft.timerType === initialCreateItemState.timerType &&
  draft.lyricsImportCandidates.length === 0 &&
  draft.lyricsImportError === initialCreateItemState.lyricsImportError;
