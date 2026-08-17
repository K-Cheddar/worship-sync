import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import {
  BibleDisplayInfo,
  BoardPostStreamInfo,
  FormattedTextDisplayInfo,
  ItemSlideType,
  LocalVideoInputPresentation,
  MediaType,
  OverlayInfo,
  Presentation,
} from "../types";
import generateRandomId from "../utils/generateRandomId";
import { serverNow } from "../utils/serverTime";
import {
  PushOutputType,
  isBuiltInOutputId,
  isPushOutputType,
  supportsBoardTakeover,
} from "../utils/displayOutputs";
import { normalizeLocalVideoInput } from "../utils/localVideoInput";
import type { LocalImageReferencePatch } from "../utils/localImageAssets";

/**
 * Per-output presentation as it is stored under `presentation/outputs/{id}`.
 *
 * Transmit state is intentionally absent: whether a controller is live has
 * always been local to that controller, and syncing it would let one operator
 * silently take another's outputs on air.
 */
/** A payload that may name the displays it applies to. */
export type Targeted<T> = T & { outputIds?: string[] };

export type RemoteOutputState = {
  type?: string;
  /** Slide half only; overlay lanes ride alongside as their own keys. */
  info?: Presentation;
  /** Lanes written beside `info` so each syncs on its own clock. */
  participantOverlayInfo?: Presentation["participantOverlayInfo"];
  stbOverlayInfo?: Presentation["stbOverlayInfo"];
  qrCodeOverlayInfo?: Presentation["qrCodeOverlayInfo"];
  imageOverlayInfo?: Presentation["imageOverlayInfo"];
  bibleDisplayInfo?: Presentation["bibleDisplayInfo"];
  formattedTextDisplayInfo?: Presentation["formattedTextDisplayInfo"];
  boardPostStreamInfo?: Presentation["boardPostStreamInfo"];
  itemContentBlockedTime?: number;
  /** Stream outputs only. */
  itemContentBlocked?: boolean;
  /** Monitor outputs only. */
  boardAliasId?: string;
};

const copySlideBox = (box: ItemSlideType["boxes"][number]) => ({
  ...box,
  ...(box.mediaInfo
    ? {
        mediaInfo: {
          ...box.mediaInfo,
          ...(box.mediaInfo.localImage
            ? { localImage: { ...box.mediaInfo.localImage } }
            : {}),
        },
      }
    : {}),
});

/** Copy slide so prev and current are independent snapshots for crossfades. */
const copyStreamSlide = (slide: ItemSlideType | null): ItemSlideType | null =>
  slide
    ? {
        ...slide,
        boxes: slide.boxes?.map(copySlideBox) ?? [],
        ...(slide.monitorCurrentBandBoxes
          ? {
              monitorCurrentBandBoxes:
                slide.monitorCurrentBandBoxes.map(copySlideBox),
            }
          : {}),
        ...(slide.monitorNextBandBoxes
          ? {
              monitorNextBandBoxes:
                slide.monitorNextBandBoxes.map(copySlideBox),
            }
          : {}),
      }
    : null;

/**
 * Live presentation state for one output.
 *
 * `itemContentBlocked` and `boardAliasId` are type-scoped: only stream slots
 * read the first, only monitor slots the second. They are stored flat rather
 * than in a discriminated union because Immer drafts of a union are painful to
 * mutate, and the reducers that touch them are already type-fenced by
 * {@link slotsOfType}.
 */
export type OutputSlot = {
  id: string;
  type: PushOutputType;
  info: Presentation;
  /** Outgoing state retained for crossfade/exit animation. */
  prevInfo: Presentation;
  isTransmitting: boolean;
  /** Stream slots only: operator hid the item layer under overlays. */
  itemContentBlocked: boolean;
  /** When overlay-only mode was last set, for ordering across controllers. */
  itemContentBlockedTime?: number;
  /**
   * Monitor slots only. Alias id of the discussion board this monitor should
   * show instead of presentation content; empty string = normal presentation.
   * Carries the alias (not just a flag) so the monitor resolves the right board
   * even on a separate machine where localStorage isn't shared with the
   * controller. This is the **live override**, distinct from a board output's
   * durable `source` binding in the display output registry.
   */
  boardAliasId: string;
};

export type PresentationState = {
  /** Keyed by display output id; see `utils/displayOutputs`. */
  outputs: Record<string, OutputSlot>;
};

/** Blank presentation for a surface. Stream carries its overlay lane slots. */
const createInfo = (type: PushOutputType): Presentation => {
  if (type === "projector") {
    return { type: "", name: "", slide: null, displayType: "projector" };
  }
  if (type === "monitor") {
    return {
      type: "",
      name: "",
      slide: null,
      nextSlide: null,
      displayType: "monitor",
    };
  }
  return {
    type: "",
    name: "",
    slide: null,
    displayType: "stream",
    participantOverlayInfo: {
      name: "",
      time: serverNow(),
      id: generateRandomId(),
    },
    stbOverlayInfo: {
      heading: "",
      time: serverNow(),
      id: generateRandomId(),
    },
    qrCodeOverlayInfo: {
      time: serverNow(),
      id: generateRandomId(),
    },
    imageOverlayInfo: {
      time: serverNow(),
      id: generateRandomId(),
    },
    formattedTextDisplayInfo: {
      text: "",
      time: serverNow(),
    },
    boardPostStreamInfo: {
      author: "",
      authorHexColor: "#e7e5e4",
      text: "",
      time: serverNow(),
    },
  };
};

/**
 * Blank *previous* presentation. Deliberately bare for stream: prev starts with
 * no overlay slots so the first send has nothing stale to animate out.
 */
const createPrevInfo = (type: PushOutputType): Presentation =>
  type === "stream"
    ? { type: "", name: "", slide: null, displayType: "stream" }
    : createInfo(type);

export const createOutputSlot = (
  id: string,
  type: PushOutputType,
): OutputSlot => ({
  id,
  type,
  info: createInfo(type),
  prevInfo: createPrevInfo(type),
  isTransmitting: false,
  itemContentBlocked: false,
  itemContentBlockedTime: 0,
  boardAliasId: "",
});

/**
 * Slots for every output of a surface type, in registry order.
 *
 * Reducers fan out across all outputs of a type rather than targeting one, so
 * behavior is identical to the single-surface era. Per-output targeting arrives
 * with the controller UI that can actually address them.
 */
const slotsOfType = (state: PresentationState, type: PushOutputType) =>
  Object.values(state.outputs).filter((slot) => slot.type === type);

/**
 * Slots an action should apply to.
 *
 * With no `outputIds` the action fans out to every output of the type, which is
 * how a controller mirrors one deck across screens. With `outputIds` it
 * addresses named outputs, which is how three projectors run different content.
 */
const targetSlots = (
  state: PresentationState,
  type: PushOutputType,
  outputIds?: string[],
) => {
  // Untargeted actions reach the built-in surface only. Displays of the same
  // kind exist precisely so they can differ, so fanning out by default would
  // defeat the point — a second projector receives content only when a caller
  // names it.
  if (!outputIds || outputIds.length === 0) return builtInSlots(state, type);
  const wanted = new Set(outputIds);
  return slotsOfType(state, type).filter((slot) => wanted.has(slot.id));
};

/**
 * Latest activity on an output, across the slide layer and every overlay lane.
 *
 * Overlay reducers bump the overlay's own timestamp, not `info.time`. Gating a
 * remote apply on `info.time` alone therefore drops overlay-only updates for
 * custom outputs, whose overlays travel inside `info` rather than in the flat
 * `stream_*` keys the built-in stream uses.
 */
/**
 * Overlay lanes that sync independently of the slide payload.
 *
 * Each carries its own time, so a slide send can never clear an overlay another
 * controller put up — the failure that made named streams riskier than the
 * built-in one for dual-controller work.
 */
export const STREAM_OVERLAY_LANES = [
  "participantOverlayInfo",
  "stbOverlayInfo",
  "qrCodeOverlayInfo",
  "imageOverlayInfo",
  "bibleDisplayInfo",
  "formattedTextDisplayInfo",
  "boardPostStreamInfo",
] as const;

export type StreamOverlayLane = (typeof STREAM_OVERLAY_LANES)[number];

/** The slide half of a presentation, with every overlay lane removed. */
export const omitOverlayLanes = (info: Presentation): Presentation => {
  const rest = { ...info };
  for (const lane of STREAM_OVERLAY_LANES) delete rest[lane];
  return rest;
};

/** Is an incoming lane payload newer than what this slot already shows? */
const isNewerLanePayload = (
  current: { time?: number; transitionSequence?: number } | undefined,
  incoming: { time?: number; transitionSequence?: number } | undefined,
) => {
  if (!incoming) return false;
  if (!current) return true;
  if (
    typeof incoming.transitionSequence === "number" &&
    typeof current.transitionSequence === "number" &&
    incoming.transitionSequence !== current.transitionSequence
  ) {
    return incoming.transitionSequence > current.transitionSequence;
  }
  return (incoming.time ?? 0) > (current.time ?? 0);
};

const getOutputActivityTime = (info: Presentation) =>
  Math.max(
    info.time ?? 0,
    info.participantOverlayInfo?.time ?? 0,
    info.stbOverlayInfo?.time ?? 0,
    info.qrCodeOverlayInfo?.time ?? 0,
    info.imageOverlayInfo?.time ?? 0,
    info.boardPostStreamInfo?.time ?? 0,
    info.bibleDisplayInfo?.time ?? 0,
    info.formattedTextDisplayInfo?.time ?? 0,
  );

const updateLocalImageMediaInPresentation = (
  info: Presentation,
  assetId: string,
  update: (media: MediaType) => void,
) => {
  let changed = false;
  for (const slide of [info.slide, info.nextSlide]) {
    if (!slide) continue;
    for (const boxes of [
      slide.boxes,
      slide.monitorCurrentBandBoxes,
      slide.monitorNextBandBoxes,
    ]) {
      for (const box of boxes ?? []) {
        const media = box.mediaInfo;
        if (media?.localImage?.id !== assetId) continue;
        update(media);
        changed = true;
      }
    }
  }
  return changed;
};

const slideHasDifferentLocalImageRevision = (
  slide: ItemSlideType | null,
  assetId: string,
  nextRevision: string,
) => {
  if (!slide) return false;
  for (const boxes of [
    slide.boxes,
    slide.monitorCurrentBandBoxes,
    slide.monitorNextBandBoxes,
  ]) {
    for (const box of boxes ?? []) {
      const reference = box.mediaInfo?.localImage;
      if (
        reference?.id === assetId &&
        reference.contentRevision !== nextRevision
      ) {
        return true;
      }
    }
  }
  return false;
};

const advancePresentationActivity = (info: Presentation) => {
  info.time = Math.max(serverNow(), getOutputActivityTime(info) + 1);
};

/**
 * The built-in slot for a surface type, as a list.
 *
 * The legacy flat Firebase keys (`projectorInfo`, `stream_*`, …) describe only
 * the original surfaces. Applying them to every slot of a type would let the
 * built-in deck overwrite independent custom outputs, with ordering against
 * `presentation/outputs` left to chance.
 */
const builtInSlots = (state: PresentationState, type: PushOutputType) => {
  const slot = state.outputs[type];
  return slot ? [slot] : [];
};

/**
 * Slots a board takeover can apply to.
 *
 * Only full-frame room surfaces qualify. With no `outputIds` this is the
 * built-in monitor, which is where the board went before it was addressable, so
 * existing controllers keep behaving exactly as they did.
 */
const boardTargetSlots = (state: PresentationState, outputIds?: string[]) => {
  const capable = Object.values(state.outputs).filter((slot) =>
    supportsBoardTakeover(slot.type),
  );
  if (!outputIds || outputIds.length === 0) {
    return capable.filter((slot) => slot.id === "monitor");
  }
  const wanted = new Set(outputIds);
  return capable.filter((slot) => wanted.has(slot.id));
};

/** Read optional targeting off any payload without constraining its shape. */
const outputIdsOf = (action: { payload?: unknown }): string[] | undefined => {
  const payload = action.payload as { outputIds?: unknown } | undefined;
  return Array.isArray(payload?.outputIds)
    ? (payload.outputIds as string[])
    : undefined;
};

/** Strip targeting before a payload is stored, so it never leaks into synced state. */
const withoutTargeting = <T extends object>(payload: T): T => {
  if (!payload || !("outputIds" in payload)) return payload;
  const { outputIds: _targeting, ...rest } = payload as T & {
    outputIds?: string[];
  };
  return rest as T;
};

const initialState: PresentationState = {
  outputs: {
    projector: createOutputSlot("projector", "projector"),
    monitor: createOutputSlot("monitor", "monitor"),
    stream: createOutputSlot("stream", "stream"),
  },
};

const hasActiveStreamOverlay = (s: Presentation) => {
  const p = s.participantOverlayInfo;
  const stb = s.stbOverlayInfo;
  const qr = s.qrCodeOverlayInfo;
  const img = s.imageOverlayInfo;
  return !!(
    p?.name ||
    p?.title ||
    p?.event ||
    stb?.heading ||
    stb?.subHeading ||
    qr?.url ||
    qr?.description ||
    img?.imageUrl ||
    s.boardPostStreamInfo?.text?.trim()
  );
};

const hasParticipantOverlayData = (overlay?: OverlayInfo) =>
  Boolean(overlay?.name || overlay?.title || overlay?.event);

const hasStbOverlayData = (overlay?: OverlayInfo) =>
  Boolean(overlay?.heading || overlay?.subHeading);

const hasQrOverlayData = (overlay?: OverlayInfo) =>
  Boolean(overlay?.url || overlay?.description);

const hasImageOverlayData = (overlay?: OverlayInfo) =>
  Boolean(overlay?.imageUrl);
/** Sync echo of the overlay already applied locally — skip to avoid double prev/current. */
const isSameImageOverlayEcho = (cur?: OverlayInfo, next?: OverlayInfo) =>
  Boolean(
    cur &&
    next &&
    hasImageOverlayData(cur) &&
    hasImageOverlayData(next) &&
    cur.time === next.time &&
    cur.transitionSequence === next.transitionSequence &&
    cur.id === next.id &&
    cur.imageUrl === next.imageUrl,
  );

const isSameParticipantOverlayEcho = (cur?: OverlayInfo, next?: OverlayInfo) =>
  Boolean(
    cur &&
    next &&
    hasParticipantOverlayData(cur) &&
    hasParticipantOverlayData(next) &&
    cur.time === next.time &&
    cur.transitionSequence === next.transitionSequence &&
    cur.id === next.id &&
    cur.name === next.name &&
    cur.title === next.title &&
    cur.event === next.event,
  );

const isSameStbOverlayEcho = (cur?: OverlayInfo, next?: OverlayInfo) =>
  Boolean(
    cur &&
    next &&
    hasStbOverlayData(cur) &&
    hasStbOverlayData(next) &&
    cur.time === next.time &&
    cur.transitionSequence === next.transitionSequence &&
    cur.id === next.id &&
    cur.heading === next.heading &&
    cur.subHeading === next.subHeading,
  );

const isSameQrOverlayEcho = (cur?: OverlayInfo, next?: OverlayInfo) =>
  Boolean(
    cur &&
    next &&
    hasQrOverlayData(cur) &&
    hasQrOverlayData(next) &&
    cur.time === next.time &&
    cur.transitionSequence === next.transitionSequence &&
    cur.id === next.id &&
    cur.url === next.url &&
    cur.description === next.description,
  );

const getNextTimestamp = (...times: Array<number | undefined>) => {
  const highestKnownTime = times.reduce<number>((highest, time) => {
    if (time == null || !Number.isFinite(time)) return highest;
    return Math.max(highest, time);
  }, 0);

  return Math.max(serverNow(), highestKnownTime + 1);
};

const getNextStreamOverlayTimestamp = (stream: OutputSlot) =>
  getNextTimestamp(
    stream.info.participantOverlayInfo?.time,
    stream.info.stbOverlayInfo?.time,
    stream.info.qrCodeOverlayInfo?.time,
    stream.info.imageOverlayInfo?.time,
    stream.info.boardPostStreamInfo?.time,
  );

const getNextStreamOverlayTransitionSequence = (stream: OutputSlot) =>
  [
    stream.info.participantOverlayInfo?.transitionSequence,
    stream.info.stbOverlayInfo?.transitionSequence,
    stream.info.qrCodeOverlayInfo?.transitionSequence,
    stream.info.imageOverlayInfo?.transitionSequence,
    stream.info.boardPostStreamInfo?.transitionSequence,
    stream.prevInfo.participantOverlayInfo?.transitionSequence,
    stream.prevInfo.stbOverlayInfo?.transitionSequence,
    stream.prevInfo.qrCodeOverlayInfo?.transitionSequence,
    stream.prevInfo.imageOverlayInfo?.transitionSequence,
    stream.prevInfo.boardPostStreamInfo?.transitionSequence,
  ].reduce<number>((highest, sequence) => {
    if (sequence == null || !Number.isFinite(sequence)) return highest;
    return Math.max(highest, sequence);
  }, 0) + 1;

const emptyParticipantOverlay = (
  t: number,
  transitionSequence?: number,
): OverlayInfo => ({
  name: "",
  time: t,
  transitionSequence,
  id: generateRandomId(),
});

const emptyStbOverlay = (
  t: number,
  transitionSequence?: number,
): OverlayInfo => ({
  heading: "",
  subHeading: "",
  time: t,
  transitionSequence,
  id: generateRandomId(),
});

const emptyQrOverlay = (
  t: number,
  transitionSequence?: number,
): OverlayInfo => ({
  description: "",
  time: t,
  transitionSequence,
  id: generateRandomId(),
});

const emptyImageOverlay = (
  t: number,
  transitionSequence?: number,
): OverlayInfo => ({
  name: "",
  imageUrl: "",
  time: t,
  transitionSequence,
  id: generateRandomId(),
});

const isEmptySlotFromSameTransition = (
  overlay: OverlayInfo | undefined,
  t: number,
  transitionSequence?: number,
) =>
  transitionSequence != null
    ? overlay?.transitionSequence != null &&
      overlay.transitionSequence === transitionSequence
    : Boolean(overlay?.time != null && overlay.time === t);

/**
 * Clears `prevStreamInfo` overlay slots other than `keep` before a live send.
 * After Clear, unrelated types can still sit in `prev` for exit; sending a new
 * overlay must not replay those. `preserveClearedStreamOverlaysForTransition`
 * immediately copies anything still live on `streamInfo` back into `prev`.
 */
const clearStalePrevStreamOverlaySlotsExcept = (
  stream: OutputSlot,
  keep: "participant" | "stb" | "qr" | "image" | "boardPost",
  t: number,
  transitionSequence?: number,
) => {
  const { info: streamInfo, prevInfo: prevStreamInfo } = stream;
  // Only clear a prev slot when stream has no live data for that type. Otherwise
  // we wipe the outgoing overlay before preserve can copy stream → prev (e.g.
  // participant still on air when sending an image). Keep `prev` when the slot
  // was just cleared at the same timestamp as the incoming live send; that is
  // the same cross-type transition arriving clear-first from sync.
  if (
    keep !== "participant" &&
    !hasParticipantOverlayData(streamInfo.participantOverlayInfo) &&
    !isEmptySlotFromSameTransition(
      streamInfo.participantOverlayInfo,
      t,
      transitionSequence,
    )
  ) {
    prevStreamInfo.participantOverlayInfo = emptyParticipantOverlay(
      t,
      transitionSequence,
    );
  }
  if (
    keep !== "stb" &&
    !hasStbOverlayData(streamInfo.stbOverlayInfo) &&
    !isEmptySlotFromSameTransition(
      streamInfo.stbOverlayInfo,
      t,
      transitionSequence,
    )
  ) {
    prevStreamInfo.stbOverlayInfo = emptyStbOverlay(t, transitionSequence);
  }
  if (
    keep !== "qr" &&
    !hasQrOverlayData(streamInfo.qrCodeOverlayInfo) &&
    !isEmptySlotFromSameTransition(
      streamInfo.qrCodeOverlayInfo,
      t,
      transitionSequence,
    )
  ) {
    prevStreamInfo.qrCodeOverlayInfo = emptyQrOverlay(t, transitionSequence);
  }
  if (
    keep !== "image" &&
    !hasImageOverlayData(streamInfo.imageOverlayInfo) &&
    !isEmptySlotFromSameTransition(
      streamInfo.imageOverlayInfo,
      t,
      transitionSequence,
    )
  ) {
    prevStreamInfo.imageOverlayInfo = emptyImageOverlay(t, transitionSequence);
  }
  if (
    keep !== "boardPost" &&
    !hasBoardPostData(streamInfo.boardPostStreamInfo)
  ) {
    prevStreamInfo.boardPostStreamInfo = emptyBoardPostStreamInfo(
      t,
      transitionSequence,
    );
  }
};

/** Empty every stream overlay except the one that was just set (single-layer when overlay-only off). */
const clearStreamOverlaysExcept = (
  si: Presentation,
  keep: "participant" | "stb" | "qr" | "image" | "boardPost",
  t: number,
  transitionSequence?: number,
) => {
  if (keep !== "participant")
    si.participantOverlayInfo = emptyParticipantOverlay(t, transitionSequence);
  if (keep !== "stb")
    si.stbOverlayInfo = emptyStbOverlay(t, transitionSequence);
  if (keep !== "qr")
    si.qrCodeOverlayInfo = emptyQrOverlay(t, transitionSequence);
  if (keep !== "image")
    si.imageOverlayInfo = emptyImageOverlay(t, transitionSequence);
  if (keep !== "boardPost")
    si.boardPostStreamInfo = emptyBoardPostStreamInfo(t, transitionSequence);
};

const emptyBoardPostStreamInfo = (
  t: number,
  transitionSequence?: number,
): BoardPostStreamInfo => ({
  author: "",
  authorHexColor: "#e7e5e4",
  text: "",
  time: t,
  transitionSequence,
});

const hasBoardPostData = (info?: BoardPostStreamInfo) =>
  Boolean(info?.text?.trim());

const clearAllStreamOverlays = (
  si: Presentation,
  t: number,
  transitionSequence?: number,
) => {
  si.participantOverlayInfo = emptyParticipantOverlay(t, transitionSequence);
  si.stbOverlayInfo = emptyStbOverlay(t, transitionSequence);
  si.qrCodeOverlayInfo = emptyQrOverlay(t, transitionSequence);
  si.imageOverlayInfo = emptyImageOverlay(t, transitionSequence);
  si.boardPostStreamInfo = emptyBoardPostStreamInfo(t, transitionSequence);
};

const preserveClearedStreamOverlaysForTransition = (
  stream: OutputSlot,
  keep: "participant" | "stb" | "qr" | "image" | "boardPost",
) => {
  const { info: streamInfo, prevInfo: prevStreamInfo } = stream;
  if (
    keep !== "participant" &&
    hasParticipantOverlayData(streamInfo.participantOverlayInfo)
  ) {
    prevStreamInfo.participantOverlayInfo = streamInfo.participantOverlayInfo;
  }
  if (keep !== "stb" && hasStbOverlayData(streamInfo.stbOverlayInfo)) {
    prevStreamInfo.stbOverlayInfo = streamInfo.stbOverlayInfo;
  }
  if (keep !== "qr" && hasQrOverlayData(streamInfo.qrCodeOverlayInfo)) {
    prevStreamInfo.qrCodeOverlayInfo = streamInfo.qrCodeOverlayInfo;
  }
  if (keep !== "image" && hasImageOverlayData(streamInfo.imageOverlayInfo)) {
    prevStreamInfo.imageOverlayInfo = streamInfo.imageOverlayInfo;
  }
  if (
    keep !== "boardPost" &&
    hasBoardPostData(streamInfo.boardPostStreamInfo)
  ) {
    prevStreamInfo.boardPostStreamInfo = streamInfo.boardPostStreamInfo;
  }
};

const clearStreamNonSlideItemData = (si: Presentation, t: number) => {
  si.bibleDisplayInfo = { title: "", text: "", time: t };
  si.formattedTextDisplayInfo = { text: "", time: t };
};

/**
 * Clear all stream overlays: only what is **live on stream** should move into
 * `prevStreamInfo` for exit animation. Stale cross-type data left in `prevStreamInfo`
 * (e.g. image preserved when switching to QR) must not fade out again on Clear.
 */
function clearAllStreamOverlaysForTransition(stream: OutputSlot) {
  const { info: streamInfo, prevInfo: prevStreamInfo } = stream;
  const t = getNextStreamOverlayTimestamp(stream);
  const transitionSequence = getNextStreamOverlayTransitionSequence(stream);

  const snapParticipant = streamInfo.participantOverlayInfo;
  const snapStb = streamInfo.stbOverlayInfo;
  const snapQr = streamInfo.qrCodeOverlayInfo;
  const snapImage = streamInfo.imageOverlayInfo;
  const snapBoardPost = streamInfo.boardPostStreamInfo;

  const liveParticipant = hasParticipantOverlayData(snapParticipant);
  const liveStb = hasStbOverlayData(snapStb);
  const liveQr = hasQrOverlayData(snapQr);
  const liveImage = hasImageOverlayData(snapImage);
  const liveBoardPost = hasBoardPostData(snapBoardPost);
  const prevParticipant = prevStreamInfo.participantOverlayInfo;
  const prevStb = prevStreamInfo.stbOverlayInfo;
  const prevQr = prevStreamInfo.qrCodeOverlayInfo;
  const prevImage = prevStreamInfo.imageOverlayInfo;

  prevStreamInfo.participantOverlayInfo = liveParticipant
    ? prevParticipant?.id && prevParticipant.id === snapParticipant?.id
      ? prevParticipant
      : {
          ...emptyParticipantOverlay(t, transitionSequence),
          ...snapParticipant,
        }
    : emptyParticipantOverlay(t, transitionSequence);

  prevStreamInfo.stbOverlayInfo = liveStb
    ? prevStb?.id && prevStb.id === snapStb?.id
      ? prevStb
      : { ...emptyStbOverlay(t, transitionSequence), ...snapStb }
    : emptyStbOverlay(t, transitionSequence);

  prevStreamInfo.qrCodeOverlayInfo = liveQr
    ? prevQr?.id && prevQr.id === snapQr?.id
      ? prevQr
      : { ...emptyQrOverlay(t, transitionSequence), ...snapQr }
    : emptyQrOverlay(t, transitionSequence);

  prevStreamInfo.boardPostStreamInfo = liveBoardPost
    ? snapBoardPost
    : emptyBoardPostStreamInfo(t, transitionSequence);

  prevStreamInfo.imageOverlayInfo = liveImage
    ? prevImage?.id && prevImage.id === snapImage?.id
      ? prevImage
      : { ...emptyImageOverlay(t, transitionSequence), ...snapImage }
    : emptyImageOverlay(t, transitionSequence);

  clearAllStreamOverlays(streamInfo, t, transitionSequence);
}

/**
 * Set overlay-only mode, stamped so remotes can order it.
 *
 * The flag rides in every presentation snapshot, so a machine that has not yet
 * applied a change republishes its stale value on the next slide send. With no
 * time to compare, the receiving side cannot tell that apart from a genuine
 * toggle, and Hide Content switched itself back off mid-service.
 */
const applyStreamOverlayOnlyToggle = (
  stream: OutputSlot,
  blocking: boolean,
  time = serverNow(),
) => {
  if (stream.itemContentBlocked === blocking) return;
  stream.itemContentBlocked = blocking;
  stream.itemContentBlockedTime = time;
};

/** Reject a blocked-flag payload older than what this slot already holds. */
const shouldApplyBlockedFromRemote = (stream: OutputSlot, time?: number) =>
  typeof time !== "number" || time >= (stream.itemContentBlockedTime ?? 0);

export const presentationSlice = createSlice({
  name: "presentation",
  initialState,
  reducers: {
    attachCloudCopyToLocalImageInPresentation: (
      state,
      action: PayloadAction<{
        itemId: string;
        assetId: string;
        mediaId: string;
        url: string;
      }>,
    ) => {
      const { assetId, mediaId, url } = action.payload;
      const updatedAt = new Date().toISOString();
      for (const slot of Object.values(state.outputs)) {
        const currentChanged = updateLocalImageMediaInPresentation(
          slot.info,
          assetId,
          (media) => {
            media.updatedAt = updatedAt;
            media.localImage!.storagePolicy = "local-and-cloud";
            media.localImage!.cloudMediaId = mediaId;
            media.localImage!.cloudUrl = url;
          },
        );
        updateLocalImageMediaInPresentation(slot.prevInfo, assetId, (media) => {
          media.updatedAt = updatedAt;
          media.localImage!.storagePolicy = "local-and-cloud";
          media.localImage!.cloudMediaId = mediaId;
          media.localImage!.cloudUrl = url;
        });
        if (currentChanged) advancePresentationActivity(slot.info);
      }
    },
    updateLocalImageReferenceInPresentation: (
      state,
      action: PayloadAction<{
        itemId: string;
        assetId: string;
        patch: LocalImageReferencePatch;
      }>,
    ) => {
      const { assetId, patch } = action.payload;
      const updatedAt = new Date().toISOString();
      const updateMedia = (media: MediaType) => {
        Object.assign(media, patch.media);
        Object.assign(media.localImage!, patch.reference, { id: assetId });
        media.updatedAt = updatedAt;
      };
      for (const slot of Object.values(state.outputs)) {
        const nextRevision = patch.reference?.contentRevision;
        const preserveCurrentFrame = Boolean(
          nextRevision &&
          slideHasDifferentLocalImageRevision(
            slot.info.slide,
            assetId,
            nextRevision,
          ),
        );
        if (preserveCurrentFrame) {
          slot.prevInfo.slide = copyStreamSlide(slot.info.slide);
          slot.prevInfo.name = slot.info.name;
          slot.prevInfo.type = slot.info.type;
          slot.prevInfo.time = slot.info.time;
          slot.prevInfo.timerId = slot.info.timerId;
          slot.prevInfo.localVideoInput = slot.info.localVideoInput;
        }
        const currentChanged = updateLocalImageMediaInPresentation(
          slot.info,
          assetId,
          updateMedia,
        );
        if (!preserveCurrentFrame) {
          updateLocalImageMediaInPresentation(
            slot.prevInfo,
            assetId,
            updateMedia,
          );
        }
        if (currentChanged) advancePresentationActivity(slot.info);
      }
    },
    updatePresentation: (
      state,
      action: PayloadAction<Targeted<Presentation>>,
    ) => {
      for (const projector of targetSlots(
        state,
        "projector",
        outputIdsOf(action),
      )) {
        if (!projector.isTransmitting) continue;
        projector.boardAliasId = "";
        // set previous info for cross animation
        projector.prevInfo.slide = projector.info.slide;
        projector.prevInfo.name = projector.info.name;
        projector.prevInfo.type = projector.info.type;
        projector.prevInfo.time = projector.info.time;
        projector.prevInfo.timerId = projector.info.timerId;
        projector.prevInfo.localVideoInput = projector.info.localVideoInput;

        projector.info.slide = action.payload.slide;
        projector.info.name = action.payload.name;
        projector.info.type = action.payload.type;
        projector.info.timerId = action.payload.timerId;
        projector.info.slideIndex = action.payload.slideIndex;
        projector.info.slideCount = action.payload.slideCount;
        projector.info.time = serverNow();
        projector.info.localVideoInput = normalizeLocalVideoInput(
          action.payload.localVideoInput,
        );
      }
      for (const monitor of targetSlots(
        state,
        "monitor",
        outputIdsOf(action),
      )) {
        if (!monitor.isTransmitting) continue;
        monitor.boardAliasId = "";
        // set previous info for cross animation
        monitor.prevInfo.slide = monitor.info.slide;
        monitor.prevInfo.name = monitor.info.name;
        monitor.prevInfo.type = monitor.info.type;
        monitor.prevInfo.time = monitor.info.time;
        monitor.prevInfo.timerId = monitor.info.timerId;
        monitor.prevInfo.itemId = monitor.info.itemId;
        monitor.prevInfo.nextSlide = monitor.info.nextSlide ?? null;
        monitor.prevInfo.localVideoInput = monitor.info.localVideoInput;

        monitor.info.slide = action.payload.slide;
        monitor.info.name = action.payload.name;
        monitor.info.type = action.payload.type;
        monitor.info.timerId = action.payload.timerId;
        monitor.info.itemId = action.payload.itemId;
        monitor.info.slideIndex = action.payload.slideIndex;
        monitor.info.slideCount = action.payload.slideCount;
        monitor.info.time = serverNow();
        monitor.info.nextSlide =
          action.payload.nextSlide !== undefined
            ? action.payload.nextSlide
            : null;
        monitor.info.localVideoInput = normalizeLocalVideoInput(
          action.payload.localVideoInput,
        );
      }
      for (const stream of targetSlots(state, "stream", outputIdsOf(action))) {
        if (!stream.isTransmitting) continue;
        // set previous info for cross animation (copy slide so boxes !== prevBoxes for crossfade)
        stream.prevInfo.slide = copyStreamSlide(stream.info.slide);
        stream.prevInfo.name = stream.info.name;
        stream.prevInfo.type = stream.info.type;
        stream.prevInfo.time = stream.info.time;
        stream.prevInfo.timerId = stream.info.timerId;
        stream.prevInfo.localVideoInput = stream.info.localVideoInput;
        if (action.payload.type !== "bible" && action.payload.type !== "free") {
          stream.info.slide = action.payload.slide;
        }

        stream.info.name = action.payload.name;
        stream.info.type = action.payload.type;
        stream.info.timerId = action.payload.timerId;
        stream.info.slideIndex = action.payload.slideIndex;
        stream.info.slideCount = action.payload.slideCount;
        stream.info.time = serverNow();
        stream.info.localVideoInput = normalizeLocalVideoInput(
          action.payload.localVideoInput,
        );
      }
    },
    toggleProjectorTransmitting: (state) => {
      for (const projector of slotsOfType(state, "projector")) {
        projector.isTransmitting = !projector.isTransmitting;
      }
    },
    toggleMonitorTransmitting: (state) => {
      for (const monitor of slotsOfType(state, "monitor")) {
        monitor.isTransmitting = !monitor.isTransmitting;
      }
    },
    toggleStreamTransmitting: (state) => {
      for (const stream of slotsOfType(state, "stream")) {
        stream.isTransmitting = !stream.isTransmitting;
      }
    },
    /**
     * Arm or disarm displays in bulk.
     *
     * Takes the ids the controller is showing. Arming every slot would put a
     * deliberately dark display on air, including ones hidden from this
     * controller entirely.
     */
    setTransmitToAll: (
      state,
      action: PayloadAction<boolean | { value: boolean; outputIds?: string[] }>,
    ) => {
      const value =
        typeof action.payload === "boolean"
          ? action.payload
          : action.payload.value;
      const outputIds =
        typeof action.payload === "boolean"
          ? undefined
          : action.payload.outputIds;
      const slots = outputIds
        ? outputIds.map((id) => state.outputs[id]).filter(Boolean)
        : Object.values(state.outputs);
      for (const slot of slots) {
        slot.isTransmitting = value;
      }
    },
    /** Take one named output live or off air, independent of its siblings. */
    toggleOutputTransmitting: (state, action: PayloadAction<string>) => {
      const slot = state.outputs[action.payload];
      if (!slot) return;
      slot.isTransmitting = !slot.isTransmitting;
    },
    setOutputTransmitting: (
      state,
      action: PayloadAction<{ outputId: string; value: boolean }>,
    ) => {
      const slot = state.outputs[action.payload.outputId];
      if (!slot) return;
      slot.isTransmitting = action.payload.value;
    },
    /**
     * Reconcile slots against the display output registry.
     *
     * Adds a slot for every push output and drops slots whose output was
     * deleted. Existing slots keep their live content, so adding an output
     * mid-service never disturbs what is already on screen.
     */
    syncOutputSlots: (
      state,
      action: PayloadAction<Array<{ id: string; type: PushOutputType }>>,
    ) => {
      const wanted = new Map(action.payload.map((o) => [o.id, o.type]));
      for (const [id, type] of wanted) {
        const existing = state.outputs[id];
        if (!existing) {
          state.outputs[id] = createOutputSlot(id, type);
        } else if (existing.type !== type) {
          // Type changed under us: restart the slot so its blank state matches
          // the new render profile rather than carrying stream overlay slots
          // onto a projector.
          state.outputs[id] = createOutputSlot(id, type);
        }
      }
      for (const id of Object.keys(state.outputs)) {
        // Built-ins keep their slot even when retired. They cannot be deleted,
        // their state still travels in the legacy Firebase keys, and dropping
        // the slot would blank the physical screen and publish empty
        // projectorInfo / monitorInfo / streamInfo church-wide.
        if (isBuiltInOutputId(id)) continue;
        if (!wanted.has(id)) delete state.outputs[id];
      }
    },
    /** Clear one named output, keeping its outgoing content for the fade-out. */
    clearOutput: (state, action: PayloadAction<string>) => {
      const slot = state.outputs[action.payload];
      if (!slot) return;
      const t = serverNow();
      if (slot.type === "stream") {
        slot.prevInfo.slide = copyStreamSlide(slot.info.slide);
        slot.prevInfo.name = slot.info.name;
        slot.prevInfo.type = slot.info.type;
        slot.prevInfo.time = slot.info.time;
        slot.prevInfo.timerId = slot.info.timerId;
        slot.prevInfo.localVideoInput = slot.info.localVideoInput;
        slot.prevInfo.participantOverlayInfo = slot.info.participantOverlayInfo;
        slot.prevInfo.stbOverlayInfo = slot.info.stbOverlayInfo;
        slot.prevInfo.bibleDisplayInfo = slot.info.bibleDisplayInfo;
        slot.prevInfo.qrCodeOverlayInfo = slot.info.qrCodeOverlayInfo;
        slot.prevInfo.imageOverlayInfo = slot.info.imageOverlayInfo;
        slot.prevInfo.formattedTextDisplayInfo =
          slot.info.formattedTextDisplayInfo;
        slot.prevInfo.boardPostStreamInfo = slot.info.boardPostStreamInfo;
        slot.info = {
          ...createInfo("stream"),
          time: t,
          bibleDisplayInfo: { title: "", text: "", time: t },
        };
        return;
      }
      if (supportsBoardTakeover(slot.type)) slot.boardAliasId = "";
      slot.prevInfo.slide = slot.info.slide;
      slot.prevInfo.name = slot.info.name;
      slot.prevInfo.type = slot.info.type;
      slot.prevInfo.time = slot.info.time;
      slot.prevInfo.timerId = slot.info.timerId;
      slot.prevInfo.localVideoInput = slot.info.localVideoInput;
      if (slot.type === "monitor") {
        slot.prevInfo.itemId = slot.info.itemId;
        slot.prevInfo.nextSlide = slot.info.nextSlide ?? null;
      }
      slot.info = { ...createInfo(slot.type), time: t };
    },
    /** Route one workstation's capture device to one projector output. */
    showLocalVideoInput: (
      state,
      action: PayloadAction<{
        outputId: string;
        input: LocalVideoInputPresentation;
      }>,
    ) => {
      const projector = state.outputs[action.payload.outputId];
      const input = normalizeLocalVideoInput(action.payload.input);
      if (
        !projector ||
        projector.type !== "projector" ||
        !projector.isTransmitting ||
        !input
      ) {
        return;
      }

      projector.prevInfo = { ...projector.info };
      projector.boardAliasId = "";
      projector.info = {
        ...createInfo("projector"),
        type: "local-video-input",
        name: input.deviceLabel,
        time: serverNow(),
        localVideoInput: input,
      };
    },
    setStreamItemContentBlocked: (
      state,
      action: PayloadAction<boolean | { value: boolean; outputIds?: string[] }>,
    ) => {
      const blocking =
        typeof action.payload === "boolean"
          ? action.payload
          : action.payload.value;
      for (const stream of targetSlots(state, "stream", outputIdsOf(action))) {
        applyStreamOverlayOnlyToggle(stream, blocking);
      }
    },
    setStreamItemContentBlockedFromRemote: (
      state,
      action: PayloadAction<boolean | { value: boolean; time?: number }>,
    ) => {
      const payload = action.payload;
      const value = typeof payload === "boolean" ? payload : payload.value;
      const time = typeof payload === "boolean" ? undefined : payload.time;
      for (const stream of builtInSlots(state, "stream")) {
        // An untimed payload comes from a client that predates the stamp;
        // accept it rather than stranding that controller.
        if (!shouldApplyBlockedFromRemote(stream, time)) continue;
        applyStreamOverlayOnlyToggle(stream, value, time);
      }
    },
    /**
     * Swap a display between presentation content and a discussion board.
     * Pass the board's alias id to show it, or "" to return to presentation.
     *
     * Untargeted calls reach the built-in monitor, which is where the board went
     * before it was addressable.
     */
    setDisplayBoardAliasId: (
      state,
      action: PayloadAction<{ aliasId: string; outputIds?: string[] }>,
    ) => {
      for (const slot of boardTargetSlots(state, action.payload.outputIds)) {
        slot.boardAliasId = action.payload.aliasId;
      }
    },
    setMonitorBoardAliasIdFromRemote: (
      state,
      action: PayloadAction<string>,
    ) => {
      for (const monitor of builtInSlots(state, "monitor")) {
        monitor.boardAliasId = action.payload;
      }
    },
    /**
     * The built-in projector cannot ride the outputs channel — that skips
     * built-ins by design — so its board state travels as its own flat legacy
     * key, exactly like the monitor's.
     */
    setProjectorBoardAliasIdFromRemote: (
      state,
      action: PayloadAction<string>,
    ) => {
      for (const projector of builtInSlots(state, "projector")) {
        projector.boardAliasId = action.payload;
      }
    },
    /** Overlay operator: remove all stream overlays; slide/bible/formatted unchanged. */
    clearStreamOverlaysOnly: (
      state,
      action: PayloadAction<{ outputIds?: string[] } | undefined>,
    ) => {
      // Named streams only. Clearing every stream would strip overlays from an
      // independent stream that was never on this overlay lane.
      for (const stream of targetSlots(
        state,
        "stream",
        action.payload?.outputIds,
      )) {
        if (!hasActiveStreamOverlay(stream.info)) continue;
        clearAllStreamOverlaysForTransition(stream);
      }
    },
    updateParticipantOverlayInfo: (
      state,
      action: PayloadAction<Targeted<OverlayInfo>>,
    ) => {
      for (const stream of targetSlots(state, "stream", outputIdsOf(action))) {
        if (!stream.isTransmitting) continue;
        const t = getNextStreamOverlayTimestamp(stream);
        const transitionSequence =
          getNextStreamOverlayTransitionSequence(stream);
        if (
          action.payload.name ||
          action.payload.title ||
          action.payload.event
        ) {
          clearStalePrevStreamOverlaySlotsExcept(
            stream,
            "participant",
            t,
            transitionSequence,
          );
        }
        stream.prevInfo.participantOverlayInfo =
          stream.info.participantOverlayInfo;
        stream.info.participantOverlayInfo = {
          ...withoutTargeting(action.payload),
          time: t,
          transitionSequence,
        };
        if (
          action.payload.name ||
          action.payload.title ||
          action.payload.event
        ) {
          preserveClearedStreamOverlaysForTransition(stream, "participant");
          clearStreamOverlaysExcept(
            stream.info,
            "participant",
            t,
            transitionSequence,
          );
        }
      }
    },
    updateStbOverlayInfo: (
      state,
      action: PayloadAction<Targeted<OverlayInfo>>,
    ) => {
      for (const stream of targetSlots(state, "stream", outputIdsOf(action))) {
        if (!stream.isTransmitting) continue;
        const t = getNextStreamOverlayTimestamp(stream);
        const transitionSequence =
          getNextStreamOverlayTransitionSequence(stream);
        if (action.payload.heading || action.payload.subHeading) {
          clearStalePrevStreamOverlaySlotsExcept(
            stream,
            "stb",
            t,
            transitionSequence,
          );
        }
        stream.prevInfo.stbOverlayInfo = stream.info.stbOverlayInfo;
        stream.info.stbOverlayInfo = {
          ...withoutTargeting(action.payload),
          time: t,
          transitionSequence,
        };
        if (action.payload.heading || action.payload.subHeading) {
          preserveClearedStreamOverlaysForTransition(stream, "stb");
          clearStreamOverlaysExcept(stream.info, "stb", t, transitionSequence);
        }
      }
    },
    updateQrCodeOverlayInfo: (
      state,
      action: PayloadAction<Targeted<OverlayInfo>>,
    ) => {
      for (const stream of targetSlots(state, "stream", outputIdsOf(action))) {
        if (!stream.isTransmitting) continue;
        const t = getNextStreamOverlayTimestamp(stream);
        const transitionSequence =
          getNextStreamOverlayTransitionSequence(stream);
        if (action.payload.url || action.payload.description) {
          clearStalePrevStreamOverlaySlotsExcept(
            stream,
            "qr",
            t,
            transitionSequence,
          );
        }
        stream.prevInfo.qrCodeOverlayInfo = stream.info.qrCodeOverlayInfo;
        stream.info.qrCodeOverlayInfo = {
          ...withoutTargeting(action.payload),
          time: t,
          transitionSequence,
        };
        if (action.payload.url || action.payload.description) {
          preserveClearedStreamOverlaysForTransition(stream, "qr");
          clearStreamOverlaysExcept(stream.info, "qr", t, transitionSequence);
        }
      }
    },
    updateImageOverlayInfo: (
      state,
      action: PayloadAction<Targeted<OverlayInfo>>,
    ) => {
      for (const stream of targetSlots(state, "stream", outputIdsOf(action))) {
        if (!stream.isTransmitting) continue;
        const t = getNextStreamOverlayTimestamp(stream);
        const transitionSequence =
          getNextStreamOverlayTransitionSequence(stream);
        if (action.payload.imageUrl) {
          clearStalePrevStreamOverlaySlotsExcept(
            stream,
            "image",
            t,
            transitionSequence,
          );
        }
        stream.prevInfo.imageOverlayInfo = stream.info.imageOverlayInfo;
        stream.info.imageOverlayInfo = {
          ...withoutTargeting(action.payload),
          time: t,
          transitionSequence,
        };
        if (action.payload.imageUrl) {
          preserveClearedStreamOverlaysForTransition(stream, "image");
          clearStreamOverlaysExcept(
            stream.info,
            "image",
            t,
            transitionSequence,
          );
        }
      }
    },
    updateImageOverlayInfoFromRemote: (
      state,
      action: PayloadAction<OverlayInfo>,
    ) => {
      for (const stream of builtInSlots(state, "stream")) {
        const next = action.payload;
        const t = next.time ?? serverNow();
        const transitionSequence = next.transitionSequence;
        const cur = stream.info.imageOverlayInfo;

        if (isSameImageOverlayEcho(cur, next)) {
          continue;
        }

        if (next.imageUrl) {
          clearStalePrevStreamOverlaySlotsExcept(
            stream,
            "image",
            t,
            transitionSequence,
          );
        }

        if (hasImageOverlayData(cur) || next.imageUrl) {
          stream.prevInfo.imageOverlayInfo = cur;
        } else if (!isEmptySlotFromSameTransition(cur, t, transitionSequence)) {
          stream.prevInfo.imageOverlayInfo = emptyImageOverlay(
            t,
            transitionSequence,
          );
        }

        stream.info.imageOverlayInfo = {
          ...next,
          time: t,
          transitionSequence,
        };
        if (!next.imageUrl) continue;
        preserveClearedStreamOverlaysForTransition(stream, "image");
        clearStreamOverlaysExcept(stream.info, "image", t, transitionSequence);
      }
    },
    updateParticipantOverlayInfoFromRemote: (
      state,
      action: PayloadAction<OverlayInfo>,
    ) => {
      for (const stream of builtInSlots(state, "stream")) {
        const next = action.payload;
        const t = next.time ?? serverNow();
        const transitionSequence = next.transitionSequence;
        const cur = stream.info.participantOverlayInfo;

        if (isSameParticipantOverlayEcho(cur, next)) {
          continue;
        }

        const nextHasLines = Boolean(next.name || next.title || next.event);
        if (nextHasLines) {
          clearStalePrevStreamOverlaySlotsExcept(
            stream,
            "participant",
            t,
            transitionSequence,
          );
        }
        if (hasParticipantOverlayData(cur) || nextHasLines) {
          stream.prevInfo.participantOverlayInfo = cur;
        } else if (!isEmptySlotFromSameTransition(cur, t, transitionSequence)) {
          // Later empty received after a cross-type switch: prev data is stale, clear it.
          stream.prevInfo.participantOverlayInfo = emptyParticipantOverlay(
            t,
            transitionSequence,
          );
        }

        stream.info.participantOverlayInfo = {
          ...next,
          time: t,
          transitionSequence,
        };
        if (!nextHasLines) continue;
        preserveClearedStreamOverlaysForTransition(stream, "participant");
        clearStreamOverlaysExcept(
          stream.info,
          "participant",
          t,
          transitionSequence,
        );
      }
    },
    updateStbOverlayInfoFromRemote: (
      state,
      action: PayloadAction<OverlayInfo>,
    ) => {
      for (const stream of builtInSlots(state, "stream")) {
        const next = action.payload;
        const t = next.time ?? serverNow();
        const transitionSequence = next.transitionSequence;
        const cur = stream.info.stbOverlayInfo;

        if (isSameStbOverlayEcho(cur, next)) {
          continue;
        }

        const nextHasStb = Boolean(next.heading || next.subHeading);
        if (nextHasStb) {
          clearStalePrevStreamOverlaySlotsExcept(
            stream,
            "stb",
            t,
            transitionSequence,
          );
        }
        if (hasStbOverlayData(cur) || nextHasStb) {
          stream.prevInfo.stbOverlayInfo = cur;
        } else if (!isEmptySlotFromSameTransition(cur, t, transitionSequence)) {
          stream.prevInfo.stbOverlayInfo = emptyStbOverlay(
            t,
            transitionSequence,
          );
        }

        stream.info.stbOverlayInfo = {
          ...next,
          time: t,
          transitionSequence,
        };
        if (!nextHasStb) continue;
        preserveClearedStreamOverlaysForTransition(stream, "stb");
        clearStreamOverlaysExcept(stream.info, "stb", t, transitionSequence);
      }
    },
    updateQrCodeOverlayInfoFromRemote: (
      state,
      action: PayloadAction<OverlayInfo>,
    ) => {
      for (const stream of builtInSlots(state, "stream")) {
        const next = action.payload;
        const t = next.time ?? serverNow();
        const transitionSequence = next.transitionSequence;
        const cur = stream.info.qrCodeOverlayInfo;

        if (isSameQrOverlayEcho(cur, next)) {
          continue;
        }

        const nextHasQr = Boolean(next.url || next.description);
        if (nextHasQr) {
          clearStalePrevStreamOverlaySlotsExcept(
            stream,
            "qr",
            t,
            transitionSequence,
          );
        }
        if (hasQrOverlayData(cur) || nextHasQr) {
          stream.prevInfo.qrCodeOverlayInfo = cur;
        } else if (!isEmptySlotFromSameTransition(cur, t, transitionSequence)) {
          stream.prevInfo.qrCodeOverlayInfo = emptyQrOverlay(
            t,
            transitionSequence,
          );
        }

        stream.info.qrCodeOverlayInfo = {
          ...next,
          time: t,
          transitionSequence,
        };
        if (!nextHasQr) continue;
        preserveClearedStreamOverlaysForTransition(stream, "qr");
        clearStreamOverlaysExcept(stream.info, "qr", t, transitionSequence);
      }
    },
    updateBibleDisplayInfo: (
      state,
      action: PayloadAction<Targeted<BibleDisplayInfo>>,
    ) => {
      for (const stream of targetSlots(state, "stream", outputIdsOf(action))) {
        if (!stream.isTransmitting) continue;
        const t = serverNow();
        stream.prevInfo.bibleDisplayInfo = stream.info.bibleDisplayInfo;
        const ft = stream.info.formattedTextDisplayInfo;
        stream.prevInfo.formattedTextDisplayInfo = ft?.text?.trim()
          ? ft
          : { ...ft, text: "", time: t };
        stream.info.formattedTextDisplayInfo = {
          ...ft,
          text: "",
          time: t,
        };
        stream.info.bibleDisplayInfo = {
          ...withoutTargeting(action.payload),
          time: t,
        };
        stream.info.type = "bible";
        stream.info.slide = null;
        stream.info.time = t;
      }
    },
    updateBibleDisplayInfoFromRemote: (
      state,
      action: PayloadAction<BibleDisplayInfo>,
    ) => {
      for (const stream of builtInSlots(state, "stream")) {
        const t = action.payload.time ?? serverNow();
        const cur = stream.info.bibleDisplayInfo;
        const curHasData = Boolean(cur?.title?.trim() || cur?.text?.trim());
        const nextHasData = Boolean(
          action.payload.title?.trim() || action.payload.text?.trim(),
        );
        // Per-key sync: a cleared bible can arrive right after a sibling stream clear
        // (updateStreamFromRemote) already moved the outgoing verse into prevStreamInfo
        // for its fade-out. With nothing live to hand off, re-running the handoff would
        // overwrite prev with an empty slot and kill the exit animation — nothing to do.
        if (!curHasData && !nextHasData) continue;
        stream.prevInfo.bibleDisplayInfo = cur;
        const ft = stream.info.formattedTextDisplayInfo;
        stream.prevInfo.formattedTextDisplayInfo = ft?.text?.trim()
          ? ft
          : { ...ft, text: "", time: t };
        stream.info.formattedTextDisplayInfo = {
          ...ft,
          text: "",
          time: t,
        };
        stream.info.bibleDisplayInfo = { ...withoutTargeting(action.payload) };
        stream.info.type = "bible";
      }
    },
    updateFormattedTextDisplayInfo: (
      state,
      action: PayloadAction<Targeted<FormattedTextDisplayInfo>>,
    ) => {
      for (const stream of targetSlots(state, "stream", outputIdsOf(action))) {
        if (!stream.isTransmitting) continue;
        // After bible runs, ItemSlides / Firebase may still emit formatted { text: "" }.
        // Applying that as a full handoff would clear the live bible (see FromRemote guard).
        if (!action.payload.text?.trim() && stream.info.type === "bible") {
          continue;
        }
        const t = serverNow();
        stream.prevInfo.formattedTextDisplayInfo =
          stream.info.formattedTextDisplayInfo;
        const bible = stream.info.bibleDisplayInfo;
        const hadLiveBible =
          Boolean(bible?.title?.trim()) || Boolean(bible?.text?.trim());
        const prevBible = stream.prevInfo.bibleDisplayInfo;
        const prevHasBible =
          Boolean(prevBible?.title?.trim()) || Boolean(prevBible?.text?.trim());
        const nextHasFormatted = Boolean(action.payload.text?.trim());
        if (hadLiveBible) {
          stream.prevInfo.bibleDisplayInfo = bible;
        } else if (
          nextHasFormatted &&
          prevHasBible &&
          stream.info.type === "bible"
        ) {
          // ItemSlides clears bible then sends formatted in the same tick; scripture
          // is already in prev from updateBibleDisplayInfo — do not overwrite with empty.
        } else {
          stream.prevInfo.bibleDisplayInfo = {
            ...(bible ?? { title: "", text: "" }),
            title: "",
            text: "",
            time: t,
          };
        }
        stream.info.bibleDisplayInfo = {
          ...(bible ?? { title: "", text: "" }),
          title: "",
          text: "",
          time: t,
        };
        stream.info.formattedTextDisplayInfo = {
          ...withoutTargeting(action.payload),
          time: t,
        };
        stream.info.type = "free";
        stream.info.slide = null;
        stream.info.time = t;
      }
    },
    updateFormattedTextDisplayInfoFromRemote: (
      state,
      action: PayloadAction<FormattedTextDisplayInfo>,
    ) => {
      for (const stream of builtInSlots(state, "stream")) {
        // Per-key Firebase: cleared formatted arrives after bible; do not treat as
        // "switch to formatted" or we wipe scripture from streamInfo.
        if (!action.payload.text?.trim() && stream.info.type === "bible") {
          continue;
        }
        // Same race as bible: a cleared formatted update can land after a sibling stream
        // clear already preserved the outgoing text in prev for its exit. Nothing live to
        // hand off → don't clobber prev with an empty slot and kill the fade-out.
        if (
          !action.payload.text?.trim() &&
          !stream.info.formattedTextDisplayInfo?.text?.trim()
        ) {
          continue;
        }
        const t = action.payload.time ?? serverNow();
        stream.prevInfo.formattedTextDisplayInfo =
          stream.info.formattedTextDisplayInfo;
        const bible = stream.info.bibleDisplayInfo;
        const hadLiveBible =
          Boolean(bible?.title?.trim()) || Boolean(bible?.text?.trim());
        const prevBible = stream.prevInfo.bibleDisplayInfo;
        const prevHasBible =
          Boolean(prevBible?.title?.trim()) || Boolean(prevBible?.text?.trim());
        const nextHasFormatted = Boolean(action.payload.text?.trim());
        if (hadLiveBible) {
          stream.prevInfo.bibleDisplayInfo = bible;
        } else if (
          nextHasFormatted &&
          prevHasBible &&
          stream.info.type === "bible"
        ) {
          // Same-tick bible clear then formatted on remotes (per-key ordering differs).
        } else {
          stream.prevInfo.bibleDisplayInfo = {
            ...(bible ?? { title: "", text: "" }),
            title: "",
            text: "",
            time: t,
          };
        }
        stream.info.bibleDisplayInfo = {
          ...(bible ?? { title: "", text: "" }),
          title: "",
          text: "",
          time: t,
        };
        stream.info.formattedTextDisplayInfo = {
          ...withoutTargeting(action.payload),
          time: action.payload.time,
        };
        stream.info.type = "free";
      }
    },
    updateBoardPostStreamInfo: (
      state,
      action: PayloadAction<Targeted<BoardPostStreamInfo>>,
    ) => {
      for (const stream of targetSlots(state, "stream", outputIdsOf(action))) {
        if (!stream.isTransmitting) continue;
        const t = getNextStreamOverlayTimestamp(stream);
        const transitionSequence =
          getNextStreamOverlayTransitionSequence(stream);
        if (action.payload.text) {
          clearStalePrevStreamOverlaySlotsExcept(
            stream,
            "boardPost",
            t,
            transitionSequence,
          );
        }
        stream.prevInfo.boardPostStreamInfo = stream.info.boardPostStreamInfo;
        stream.info.boardPostStreamInfo = {
          ...withoutTargeting(action.payload),
          time: t,
          transitionSequence,
        };
        if (action.payload.text) {
          preserveClearedStreamOverlaysForTransition(stream, "boardPost");
          clearStreamOverlaysExcept(
            stream.info,
            "boardPost",
            t,
            transitionSequence,
          );
        }
      }
    },
    updateBoardPostStreamInfoFromRemote: (
      state,
      action: PayloadAction<BoardPostStreamInfo>,
    ) => {
      for (const stream of builtInSlots(state, "stream")) {
        const t = action.payload.time ?? serverNow();
        stream.prevInfo.boardPostStreamInfo = stream.info.boardPostStreamInfo;
        stream.info.boardPostStreamInfo = {
          ...withoutTargeting(action.payload),
          time: t,
          transitionSequence: action.payload.transitionSequence,
        };
      }
    },
    clearProjector: (state) => {
      for (const projector of slotsOfType(state, "projector")) {
        // A projector can host a discussion board, so clearing it has to leave
        // board mode too. Otherwise Clear All blanks the slides and the board
        // stays up on the room screen.
        projector.boardAliasId = "";
        // set previous info for fading out
        projector.prevInfo.slide = projector.info.slide;
        projector.prevInfo.name = projector.info.name;
        projector.prevInfo.type = projector.info.type;
        projector.prevInfo.time = projector.info.time;
        projector.prevInfo.timerId = projector.info.timerId;
        projector.prevInfo.localVideoInput = projector.info.localVideoInput;

        projector.info = {
          ...createInfo("projector"),
          time: serverNow(),
        };
      }
    },
    clearMonitor: (state) => {
      for (const monitor of slotsOfType(state, "monitor")) {
        // Clearing the monitor returns it to a blank presentation surface, so leave
        // discussion-board mode too.
        monitor.boardAliasId = "";
        // set previous info for fading out
        monitor.prevInfo.slide = monitor.info.slide;
        monitor.prevInfo.name = monitor.info.name;
        monitor.prevInfo.type = monitor.info.type;
        monitor.prevInfo.time = monitor.info.time;
        monitor.prevInfo.timerId = monitor.info.timerId;
        monitor.prevInfo.itemId = monitor.info.itemId;
        monitor.prevInfo.nextSlide = monitor.info.nextSlide ?? null;
        monitor.prevInfo.localVideoInput = monitor.info.localVideoInput;

        monitor.info = {
          ...createInfo("monitor"),
          time: serverNow(),
        };
      }
    },
    /**
     * Blank streams. Untargeted it clears every stream, which is what the main
     * controller's Clear All means; the overlay controller names its stream so
     * it cannot blank a stream another operator is running.
     */
    clearStream: (
      state,
      action: PayloadAction<{ outputIds?: string[] } | undefined>,
    ) => {
      // Type-wide when untargeted, like clearProjector and clearMonitor — a
      // clear is not a send, so it does not use the non-mirroring default.
      const wanted = action?.payload?.outputIds;
      const streams = slotsOfType(state, "stream").filter(
        (slot) => !wanted?.length || wanted.includes(slot.id),
      );
      for (const stream of streams) {
        // `itemContentBlocked` deliberately survives a clear. It is a stated
        // operator intent — overlay-only mode — not slide state, so clearing
        // the slides must not quietly put item content back on a live stream.
        // set previous info for fading out (copy so boxes/prevBoxes stay distinct for crossfade)
        stream.prevInfo.slide = copyStreamSlide(stream.info.slide);
        stream.prevInfo.name = stream.info.name;
        stream.prevInfo.type = stream.info.type;
        stream.prevInfo.time = stream.info.time;
        stream.prevInfo.timerId = stream.info.timerId;
        stream.prevInfo.localVideoInput = stream.info.localVideoInput;
        stream.prevInfo.participantOverlayInfo =
          stream.info.participantOverlayInfo;
        stream.prevInfo.stbOverlayInfo = stream.info.stbOverlayInfo;
        stream.prevInfo.bibleDisplayInfo = stream.info.bibleDisplayInfo;
        stream.prevInfo.qrCodeOverlayInfo = stream.info.qrCodeOverlayInfo;
        stream.prevInfo.imageOverlayInfo = stream.info.imageOverlayInfo;
        stream.prevInfo.formattedTextDisplayInfo =
          stream.info.formattedTextDisplayInfo;
        stream.prevInfo.boardPostStreamInfo = stream.info.boardPostStreamInfo;

        stream.info = {
          ...createInfo("stream"),
          time: serverNow(),
          bibleDisplayInfo: { title: "", text: "", time: serverNow() },
          participantOverlayInfo: {
            name: "",
            time: serverNow(),
            id: generateRandomId(),
          },
          stbOverlayInfo: {
            heading: "",
            time: serverNow(),
            id: generateRandomId(),
          },
          qrCodeOverlayInfo: {
            description: "",
            time: serverNow(),
            id: generateRandomId(),
          },
          imageOverlayInfo: {
            name: "",
            imageUrl: "",
            time: serverNow(),
            id: generateRandomId(),
          },
          formattedTextDisplayInfo: {
            text: "",
            time: serverNow(),
          },
          boardPostStreamInfo: {
            author: "",
            authorHexColor: "#e7e5e4",
            text: "",
            time: serverNow(),
          },
        };
      }
    },
    /**
     * Blank every push surface. Untargeted it clears all of them; with
     * `outputIds` it clears only those, which is how the controller keeps a
     * disabled display out of it — a clear is still a write, and a display the
     * operator has turned off should not be written to.
     */
    clearAll: (
      state,
      action: PayloadAction<{ outputIds?: string[] } | undefined>,
    ) => {
      const wanted = action?.payload?.outputIds;
      const inScope = (slot: OutputSlot) =>
        !wanted?.length || wanted.includes(slot.id);
      // set previous info for fading out
      for (const projector of slotsOfType(state, "projector").filter(inScope)) {
        // Board mode goes with it — see clearProjector.
        projector.boardAliasId = "";
        projector.prevInfo.slide = projector.info.slide;
        projector.prevInfo.name = projector.info.name;
        projector.prevInfo.type = projector.info.type;
        projector.prevInfo.time = projector.info.time;
        projector.prevInfo.timerId = projector.info.timerId;
        projector.prevInfo.localVideoInput = projector.info.localVideoInput;

        projector.info = {
          ...createInfo("projector"),
          time: serverNow(),
        };
      }
      for (const monitor of slotsOfType(state, "monitor").filter(inScope)) {
        monitor.boardAliasId = "";
        monitor.prevInfo.slide = monitor.info.slide;
        monitor.prevInfo.name = monitor.info.name;
        monitor.prevInfo.type = monitor.info.type;
        monitor.prevInfo.time = monitor.info.time;
        monitor.prevInfo.timerId = monitor.info.timerId;
        monitor.prevInfo.itemId = monitor.info.itemId;
        monitor.prevInfo.localVideoInput = monitor.info.localVideoInput;

        monitor.info = {
          ...createInfo("monitor"),
          time: serverNow(),
        };
      }
      for (const stream of slotsOfType(state, "stream").filter(inScope)) {
        stream.prevInfo.slide = copyStreamSlide(stream.info.slide);
        stream.prevInfo.name = stream.info.name;
        stream.prevInfo.type = stream.info.type;
        stream.prevInfo.time = stream.info.time;
        stream.prevInfo.timerId = stream.info.timerId;
        stream.prevInfo.localVideoInput = stream.info.localVideoInput;
        stream.prevInfo.participantOverlayInfo =
          stream.info.participantOverlayInfo;
        stream.prevInfo.stbOverlayInfo = stream.info.stbOverlayInfo;
        stream.prevInfo.bibleDisplayInfo = stream.info.bibleDisplayInfo;
        stream.prevInfo.qrCodeOverlayInfo = stream.info.qrCodeOverlayInfo;
        stream.prevInfo.imageOverlayInfo = stream.info.imageOverlayInfo;
        stream.prevInfo.formattedTextDisplayInfo =
          stream.info.formattedTextDisplayInfo;
        stream.prevInfo.boardPostStreamInfo = stream.info.boardPostStreamInfo;

        stream.info = {
          ...createInfo("stream"),
          time: serverNow(),
          bibleDisplayInfo: { title: "", text: "", time: serverNow() },
          participantOverlayInfo: {
            name: "",
            time: serverNow(),
            id: generateRandomId(),
          },
          stbOverlayInfo: {
            heading: "",
            time: serverNow(),
            id: generateRandomId(),
          },
          qrCodeOverlayInfo: {
            description: "",
            time: serverNow(),
            id: generateRandomId(),
          },
          imageOverlayInfo: {
            name: "",
            imageUrl: "",
            time: serverNow(),
            id: generateRandomId(),
          },
          formattedTextDisplayInfo: {
            text: "",
            time: serverNow(),
          },
          boardPostStreamInfo: {
            author: "",
            authorHexColor: "#e7e5e4",
            text: "",
            time: serverNow(),
          },
        };
      }
    },
    /**
     * Apply the `presentation/outputs` node from Firebase.
     *
     * Built-in ids are skipped on purpose: their state still travels in the flat
     * legacy keys so clients on older builds stay live during rollout, and
     * applying both would double-run the prev/current handoff and break
     * crossfades. Outputs created after the registry are owned solely by
     * this node.
     */
    updateOutputsFromRemote: (
      state,
      action: PayloadAction<
        Record<string, RemoteOutputState> | null | undefined
      >,
    ) => {
      const remote = action.payload;
      if (!remote || typeof remote !== "object") return;

      for (const [id, data] of Object.entries(remote)) {
        if (isBuiltInOutputId(id)) continue;
        if (!data) continue;

        // Create the slot on demand rather than waiting for the registry. These
        // updates are one-shot, so dropping one because the registry has not
        // landed yet would strand that screen until an operator re-sends.
        let slot = state.outputs[id];
        if (!slot) {
          if (!isPushOutputType(data.type as PushOutputType)) continue;
          state.outputs[id] = createOutputSlot(id, data.type as PushOutputType);
          slot = state.outputs[id];
        }

        const info = data.info;
        if (info) {
          // Gated on the slide's own time, not the max across every lane. The
          // old max meant a newer slide from a machine missing the live overlay
          // outranked — and replaced — the whole payload.
          const incoming = info.time ?? 0;
          const current = slot.info.time ?? 0;
          // Apply only genuinely newer content. An incoming payload with no
          // timestamp is bookkeeping (e.g. a freshly reconciled blank slot) and
          // must never clear what is live.
          if (incoming > 0 && (current === 0 || incoming > current)) {
            slot.prevInfo.slide =
              slot.type === "stream"
                ? copyStreamSlide(slot.info.slide)
                : slot.info.slide;
            slot.prevInfo.name = slot.info.name;
            slot.prevInfo.type = slot.info.type;
            slot.prevInfo.time = slot.info.time;
            slot.prevInfo.timerId = slot.info.timerId;
            slot.prevInfo.localVideoInput = slot.info.localVideoInput;
            if (slot.type === "monitor") {
              slot.prevInfo.itemId = slot.info.itemId;
              slot.prevInfo.nextSlide = slot.info.nextSlide ?? null;
            }
            // Merge the slide half over what is here, keeping the overlay lanes
            // this slot already holds — they arrive on their own keys below.
            slot.info = {
              ...slot.info,
              ...omitOverlayLanes(info),
              localVideoInput: normalizeLocalVideoInput(info.localVideoInput),
            };
          }
        }

        // Each overlay lane applies on its own clock, exactly as the built-in
        // stream's per-lane keys do. Lanes nested inside `info` come from a
        // client written before the split, so accept either position.
        if (slot.type === "stream") {
          const applyLane = <K extends StreamOverlayLane>(lane: K) => {
            const incomingLane = (data[lane] ?? info?.[lane]) as
              | Presentation[K]
              | undefined;
            if (!incomingLane) return;
            const currentLane = slot.info[lane] as Presentation[K] | undefined;
            if (!isNewerLanePayload(currentLane, incomingLane)) return;
            slot.prevInfo[lane] = currentLane;
            slot.info[lane] = incomingLane;
          };
          for (const lane of STREAM_OVERLAY_LANES) applyLane(lane);
        }

        if (
          slot.type === "stream" &&
          typeof data.itemContentBlocked === "boolean"
        ) {
          slot.itemContentBlocked = data.itemContentBlocked;
        }
        if (
          supportsBoardTakeover(slot.type) &&
          typeof data.boardAliasId === "string"
        ) {
          slot.boardAliasId = data.boardAliasId;
        }
      }
    },
    updateProjector: (
      state,
      action: PayloadAction<
        Targeted<Presentation> & { skipTransmissionCheck?: boolean }
      >,
    ) => {
      for (const projector of targetSlots(
        state,
        "projector",
        outputIdsOf(action),
      )) {
        // set previous info for cross animation
        if (projector.isTransmitting || action.payload.skipTransmissionCheck) {
          projector.boardAliasId = "";
          projector.prevInfo.slide = projector.info.slide;
          projector.prevInfo.name = projector.info.name;
          projector.prevInfo.type = projector.info.type;
          projector.prevInfo.time = projector.info.time;
          projector.prevInfo.timerId = projector.info.timerId;
          projector.prevInfo.localVideoInput = projector.info.localVideoInput;

          projector.info.slide = action.payload.slide;
          projector.info.type = action.payload.type;
          projector.info.name = action.payload.name;
          projector.info.timerId = action.payload.timerId;
          projector.info.slideIndex = action.payload.slideIndex;
          projector.info.slideCount = action.payload.slideCount;
          projector.info.time = serverNow();
          projector.info.localVideoInput = normalizeLocalVideoInput(
            action.payload.localVideoInput,
          );
        }
      }
    },
    updateProjectorFromRemote: (state, action: PayloadAction<Presentation>) => {
      for (const projector of builtInSlots(state, "projector")) {
        projector.boardAliasId = "";
        // set previous info for cross animation
        projector.prevInfo.slide = projector.info.slide;
        projector.prevInfo.name = projector.info.name;
        projector.prevInfo.type = projector.info.type;
        projector.prevInfo.time = projector.info.time;
        projector.prevInfo.timerId = projector.info.timerId;
        projector.prevInfo.localVideoInput = projector.info.localVideoInput;

        projector.info.slide = action.payload.slide;
        projector.info.name = action.payload.name;
        projector.info.type = action.payload.type;
        projector.info.time = action.payload.time;
        projector.info.timerId = action.payload.timerId;
        projector.info.slideIndex = action.payload.slideIndex;
        projector.info.slideCount = action.payload.slideCount;
        projector.info.localVideoInput = normalizeLocalVideoInput(
          action.payload.localVideoInput,
        );
      }
    },
    updateMonitor: (
      state,
      action: PayloadAction<
        Targeted<Presentation> & { skipTransmissionCheck?: boolean }
      >,
    ) => {
      for (const monitor of targetSlots(
        state,
        "monitor",
        outputIdsOf(action),
      )) {
        // set previous info for cross animation
        if (monitor.isTransmitting || action.payload.skipTransmissionCheck) {
          monitor.boardAliasId = "";
          monitor.prevInfo.slide = monitor.info.slide;
          monitor.prevInfo.name = monitor.info.name;
          monitor.prevInfo.type = monitor.info.type;
          monitor.prevInfo.time = monitor.info.time;
          monitor.prevInfo.timerId = monitor.info.timerId;
          monitor.prevInfo.itemId = monitor.info.itemId;
          monitor.prevInfo.nextSlide = monitor.info.nextSlide ?? null;
          monitor.prevInfo.bibleInfoBox = monitor.info.bibleInfoBox;
          monitor.prevInfo.localVideoInput = monitor.info.localVideoInput;

          monitor.info.slide = action.payload.slide;
          monitor.info.name = action.payload.name;
          monitor.info.type = action.payload.type;
          monitor.info.timerId = action.payload.timerId;
          monitor.info.itemId = action.payload.itemId;
          monitor.info.slideIndex = action.payload.slideIndex;
          monitor.info.slideCount = action.payload.slideCount;
          monitor.info.time = serverNow();
          monitor.info.nextSlide =
            action.payload.nextSlide !== undefined
              ? action.payload.nextSlide
              : null;
          monitor.info.transitionDirection = action.payload.transitionDirection;
          monitor.info.bibleInfoBox = action.payload.bibleInfoBox;
          monitor.info.localVideoInput = normalizeLocalVideoInput(
            action.payload.localVideoInput,
          );
        }
      }
    },
    updateMonitorFromRemote: (state, action: PayloadAction<Presentation>) => {
      for (const monitor of builtInSlots(state, "monitor")) {
        monitor.boardAliasId = "";
        // set previous info for cross animation
        monitor.prevInfo.slide = monitor.info.slide;
        monitor.prevInfo.name = monitor.info.name;
        monitor.prevInfo.type = monitor.info.type;
        monitor.prevInfo.time = monitor.info.time;
        monitor.prevInfo.timerId = monitor.info.timerId;
        monitor.prevInfo.itemId = monitor.info.itemId;
        monitor.prevInfo.nextSlide = monitor.info.nextSlide ?? null;
        monitor.prevInfo.bibleInfoBox = monitor.info.bibleInfoBox;
        monitor.prevInfo.localVideoInput = monitor.info.localVideoInput;

        monitor.info.slide = action.payload.slide;
        monitor.info.name = action.payload.name;
        monitor.info.type = action.payload.type;
        monitor.info.time = action.payload.time;
        monitor.info.timerId = action.payload.timerId;
        monitor.info.itemId = action.payload.itemId;
        monitor.info.slideIndex = action.payload.slideIndex;
        monitor.info.slideCount = action.payload.slideCount;
        monitor.info.nextSlide =
          action.payload.nextSlide !== undefined
            ? action.payload.nextSlide
            : null;
        monitor.info.transitionDirection = action.payload.transitionDirection;
        monitor.info.bibleInfoBox = action.payload.bibleInfoBox;
        monitor.info.localVideoInput = normalizeLocalVideoInput(
          action.payload.localVideoInput,
        );
      }
    },
    updateStream: (
      state,
      action: PayloadAction<
        Targeted<Presentation> & { skipTransmissionCheck?: boolean }
      >,
    ) => {
      for (const stream of targetSlots(state, "stream", outputIdsOf(action))) {
        if (stream.isTransmitting || action.payload.skipTransmissionCheck) {
          const t = serverNow();
          const isStreamSlideType =
            Boolean(action.payload.localVideoInput) ||
            (action.payload.type !== "bible" && action.payload.type !== "free");
          stream.prevInfo.slide = copyStreamSlide(stream.info.slide);
          stream.prevInfo.name = stream.info.name;
          stream.prevInfo.type = stream.info.type;
          stream.prevInfo.time = stream.info.time;
          stream.prevInfo.timerId = stream.info.timerId;
          stream.prevInfo.localVideoInput = stream.info.localVideoInput;
          if (isStreamSlideType) {
            const bible = stream.info.bibleDisplayInfo;
            if (bible?.title?.trim() || bible?.text?.trim()) {
              stream.prevInfo.bibleDisplayInfo = bible;
            }
            const ft = stream.info.formattedTextDisplayInfo;
            if (ft?.text?.trim()) {
              stream.prevInfo.formattedTextDisplayInfo = ft;
            }
            stream.info.slide = action.payload.slide;
            clearStreamNonSlideItemData(stream.info, t);
          } else {
            stream.info.slide = null;
          }

          stream.info.name = action.payload.name;
          stream.info.type = action.payload.type;
          stream.info.timerId = action.payload.timerId;
          stream.info.slideIndex = action.payload.slideIndex;
          stream.info.slideCount = action.payload.slideCount;
          stream.info.time = t;
          stream.info.localVideoInput = normalizeLocalVideoInput(
            action.payload.localVideoInput,
          );
        }
      }
    },
    updateStreamFromRemote: (state, action: PayloadAction<Presentation>) => {
      for (const stream of builtInSlots(state, "stream")) {
        const t = action.payload.time || serverNow();
        const isStreamSlideType =
          Boolean(action.payload.localVideoInput) ||
          (action.payload.type !== "bible" && action.payload.type !== "free");
        stream.prevInfo.slide = copyStreamSlide(stream.info.slide);
        stream.prevInfo.name = stream.info.name;
        stream.prevInfo.type = stream.info.type;
        stream.prevInfo.time = stream.info.time;
        stream.prevInfo.timerId = stream.info.timerId;
        stream.prevInfo.localVideoInput = stream.info.localVideoInput;

        if (isStreamSlideType) {
          const bible = stream.info.bibleDisplayInfo;
          if (bible?.title?.trim() || bible?.text?.trim()) {
            stream.prevInfo.bibleDisplayInfo = bible;
          }
          const ft = stream.info.formattedTextDisplayInfo;
          if (ft?.text?.trim()) {
            stream.prevInfo.formattedTextDisplayInfo = ft;
          }
          stream.info.slide = action.payload.slide;
          clearStreamNonSlideItemData(stream.info, t);
        } else {
          stream.info.slide = null;
        }

        if (action.payload.name !== undefined)
          stream.info.name = action.payload.name;
        if (action.payload.type !== undefined)
          stream.info.type = action.payload.type;
        stream.info.time = action.payload.time;
        stream.info.timerId = action.payload.timerId;
        stream.info.slideIndex = action.payload.slideIndex;
        stream.info.slideCount = action.payload.slideCount;
        stream.info.localVideoInput = normalizeLocalVideoInput(
          action.payload.localVideoInput,
        );
      }
    },
  },
});

export const {
  attachCloudCopyToLocalImageInPresentation,
  updateLocalImageReferenceInPresentation,
  updatePresentation,
  toggleProjectorTransmitting,
  toggleMonitorTransmitting,
  toggleStreamTransmitting,
  setTransmitToAll,
  setStreamItemContentBlocked,
  setStreamItemContentBlockedFromRemote,
  setDisplayBoardAliasId,
  setMonitorBoardAliasIdFromRemote,
  setProjectorBoardAliasIdFromRemote,
  clearStreamOverlaysOnly,
  updateParticipantOverlayInfo,
  updateStbOverlayInfo,
  updateQrCodeOverlayInfo,
  updateBibleDisplayInfo,
  updateImageOverlayInfo,
  clearProjector,
  clearMonitor,
  clearStream,
  clearAll,
  updateProjector,
  updateMonitor,
  updateStream,
  updateProjectorFromRemote,
  updateMonitorFromRemote,
  updateStreamFromRemote,
  updateBibleDisplayInfoFromRemote,
  updateParticipantOverlayInfoFromRemote,
  updateStbOverlayInfoFromRemote,
  updateQrCodeOverlayInfoFromRemote,
  updateImageOverlayInfoFromRemote,
  updateFormattedTextDisplayInfoFromRemote,
  updateFormattedTextDisplayInfo,
  updateBoardPostStreamInfo,
  updateBoardPostStreamInfoFromRemote,
  toggleOutputTransmitting,
  setOutputTransmitting,
  syncOutputSlots,
  clearOutput,
  updateOutputsFromRemote,
  showLocalVideoInput,
} = presentationSlice.actions;

/**
 * The flat shape presentation state had before outputs existed, and still has in
 * Firebase and localStorage.
 *
 * This is the rollout bridge: new clients keep writing it so paired screens and
 * controllers on older builds stay live during migration, and keep reading it so
 * a church whose registry has never been written still hydrates.
 */
export type LegacyPresentationShape = {
  isProjectorTransmitting: boolean;
  isMonitorTransmitting: boolean;
  isStreamTransmitting: boolean;
  streamItemContentBlocked: boolean;
  streamItemContentBlockedTime: number;
  monitorBoardAliasId: string;
  projectorBoardAliasId: string;
  prevProjectorInfo: Presentation;
  prevMonitorInfo: Presentation;
  prevStreamInfo: Presentation;
  projectorInfo: Presentation;
  monitorInfo: Presentation;
  streamInfo: Presentation;
};

/**
 * Project the built-in outputs back onto the legacy field names.
 *
 * Returns live references rather than clones so reference-identity checks (which
 * the overlay handoff relies on) still hold through the projection.
 */
export const toLegacyPresentationShape = (
  state: PresentationState,
): LegacyPresentationShape => {
  const projector =
    state.outputs.projector ?? createOutputSlot("projector", "projector");
  const monitor =
    state.outputs.monitor ?? createOutputSlot("monitor", "monitor");
  const stream = state.outputs.stream ?? createOutputSlot("stream", "stream");
  return {
    isProjectorTransmitting: projector.isTransmitting,
    isMonitorTransmitting: monitor.isTransmitting,
    isStreamTransmitting: stream.isTransmitting,
    streamItemContentBlocked: stream.itemContentBlocked,
    streamItemContentBlockedTime: stream.itemContentBlockedTime ?? 0,
    monitorBoardAliasId: monitor.boardAliasId,
    projectorBoardAliasId: projector.boardAliasId,
    prevProjectorInfo: projector.prevInfo,
    prevMonitorInfo: monitor.prevInfo,
    prevStreamInfo: stream.prevInfo,
    projectorInfo: projector.info,
    monitorInfo: monitor.info,
    streamInfo: stream.info,
  };
};

/**
 * Hydrate from the legacy flat shape (Firebase, localStorage, or a persisted
 * store). Missing fields fall back to a blank slot, so a partial payload can
 * never leave an output without presentation state.
 */
export const fromLegacyPresentationShape = (
  legacy: Partial<LegacyPresentationShape> | null | undefined,
): PresentationState => {
  const state: PresentationState = {
    outputs: {
      projector: createOutputSlot("projector", "projector"),
      monitor: createOutputSlot("monitor", "monitor"),
      stream: createOutputSlot("stream", "stream"),
    },
  };
  if (!legacy) return state;
  const { projector, monitor, stream } = state.outputs;

  projector.isTransmitting = Boolean(legacy.isProjectorTransmitting);
  monitor.isTransmitting = Boolean(legacy.isMonitorTransmitting);
  stream.isTransmitting = Boolean(legacy.isStreamTransmitting);
  stream.itemContentBlocked = Boolean(legacy.streamItemContentBlocked);
  stream.itemContentBlockedTime = legacy.streamItemContentBlockedTime ?? 0;
  monitor.boardAliasId = legacy.monitorBoardAliasId ?? "";
  projector.boardAliasId = legacy.projectorBoardAliasId ?? "";

  if (legacy.projectorInfo) projector.info = legacy.projectorInfo;
  if (legacy.prevProjectorInfo) projector.prevInfo = legacy.prevProjectorInfo;
  if (legacy.monitorInfo) monitor.info = legacy.monitorInfo;
  if (legacy.prevMonitorInfo) monitor.prevInfo = legacy.prevMonitorInfo;
  if (legacy.streamInfo) stream.info = legacy.streamInfo;
  if (legacy.prevStreamInfo) stream.prevInfo = legacy.prevStreamInfo;

  return state;
};

type WithPresentation = { presentation: PresentationState };

/**
 * Slot for an output, or a blank one when it does not exist yet.
 *
 * Returning a blank slot rather than undefined keeps display surfaces rendering
 * during the window between a controller creating an output and the registry
 * reaching this device.
 */
const EMPTY_SLOTS: Record<PushOutputType, OutputSlot> = {
  projector: createOutputSlot("projector", "projector"),
  monitor: createOutputSlot("monitor", "monitor"),
  stream: createOutputSlot("stream", "stream"),
};

export const selectOutputSlot = (
  state: WithPresentation,
  outputId: string,
  fallbackType: PushOutputType = "projector",
): OutputSlot =>
  state?.presentation?.outputs?.[outputId] ?? EMPTY_SLOTS[fallbackType];

export const selectOutputSlots = (state: WithPresentation) =>
  state?.presentation?.outputs ?? {};

/** Slots of one render profile, for surfaces that still address a type. */
export const selectSlotsOfType = (
  state: WithPresentation,
  type: PushOutputType,
) => (state?.presentation ? slotsOfType(state.presentation, type) : []);

/** True when any output of the type is live — drives type-level chrome. */
export const selectIsTypeTransmitting = (
  state: WithPresentation,
  type: PushOutputType,
) =>
  state?.presentation
    ? slotsOfType(state.presentation, type).some((slot) => slot.isTransmitting)
    : false;

/** Ensure a slot exists for every push output in the registry. */
export const ensureOutputSlots = (
  state: PresentationState,
  outputs: Array<{ id: string; type: PushOutputType }>,
) => {
  for (const output of outputs) {
    if (!state.outputs[output.id]) {
      state.outputs[output.id] = createOutputSlot(output.id, output.type);
    }
  }
  return state;
};

export default presentationSlice.reducer;
