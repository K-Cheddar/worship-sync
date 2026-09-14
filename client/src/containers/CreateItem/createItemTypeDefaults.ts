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

/** Canonical create-type definitions; order comes from the controller map below. */
const CREATE_ITEM_TYPE_OPTIONS: CreateItemTypeOption[] = [
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

const CREATE_ITEM_TYPE_BY_ID = new Map(
  CREATE_ITEM_TYPE_OPTIONS.map((option) => [option.type, option]),
);

/**
 * Presentation / overlay: songs first — primary library workflow.
 * Aux: custom first — operators usually build their own slides there.
 */
const CREATE_ITEM_TYPE_ORDER: Record<ControllerProfileType, ItemType[]> = {
  presentation: ["song", "bible", "free", "timer"],
  overlay: ["song", "bible", "free", "timer"],
  "aux-presentation": ["free", "song", "bible", "timer"],
};

export const getCreateItemTypeOptions = (
  controllerType: ControllerProfileType,
): CreateItemTypeOption[] =>
  CREATE_ITEM_TYPE_ORDER[controllerType].flatMap((type) => {
    const option = CREATE_ITEM_TYPE_BY_ID.get(type);
    return option ? [option] : [];
  });

export const getDefaultCreateItemType = (
  controllerType: ControllerProfileType,
): ItemType => (controllerType === "aux-presentation" ? "free" : "song");

/** Meta fields that do not count as operator-entered create content. */
const CREATE_ITEM_META_KEYS = new Set<keyof CreateItemState>([
  "type",
  "hasUserSelectedType",
]);

/**
 * True when the draft has no operator-entered content (name, lyrics, timer
 * values, import results, etc.). `type` and `hasUserSelectedType` are ignored
 * so a controller can adopt its preferred default for a blank form.
 *
 * New CreateItemState fields are included automatically via initialCreateItemState.
 */
export const isContentBlankCreateItemDraft = (
  draft: CreateItemState,
): boolean => {
  for (const key of Object.keys(
    initialCreateItemState,
  ) as (keyof CreateItemState)[]) {
    if (CREATE_ITEM_META_KEYS.has(key)) continue;

    const value = draft[key];
    const initial = initialCreateItemState[key];
    if (Array.isArray(value) && Array.isArray(initial)) {
      if (value.length !== 0) return false;
      continue;
    }
    if (value !== initial) return false;
  }
  return true;
};
