import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import {
  BibleDisplayInfo,
  FormattedTextDisplayInfo,
  ItemSlideType,
  OverlayInfo,
  Presentation,
} from "../types";
import generateRandomId from "../utils/generateRandomId";

/** Copy slide so prev and current are different refs for crossfade (boxes/prevBoxes differ). */
const copyStreamSlide = (slide: ItemSlideType | null): ItemSlideType | null =>
  slide
    ? {
        ...slide,
        boxes: slide.boxes?.map((b) => ({ ...b })) ?? [],
      }
    : null;

type PresentationState = {
  isProjectorTransmitting: boolean;
  isMonitorTransmitting: boolean;
  isStreamTransmitting: boolean;
  streamItemContentBlocked: boolean;
  prevProjectorInfo: Presentation;
  prevMonitorInfo: Presentation;
  prevStreamInfo: Presentation;
  projectorInfo: Presentation;
  monitorInfo: Presentation;
  streamInfo: Presentation;
};

const initialState: PresentationState = {
  isProjectorTransmitting: false,
  isMonitorTransmitting: false,
  isStreamTransmitting: false,
  streamItemContentBlocked: false,
  prevProjectorInfo: {
    type: "",
    name: "",
    slide: null,
    displayType: "projector",
  },
  prevMonitorInfo: {
    type: "",
    name: "",
    slide: null,
    nextSlide: null,
    displayType: "monitor",
  },
  prevStreamInfo: { type: "", name: "", slide: null, displayType: "stream" },
  projectorInfo: { type: "", name: "", slide: null, displayType: "projector" },
  monitorInfo: {
    type: "",
    name: "",
    slide: null,
    nextSlide: null,
    displayType: "monitor",
  },
  streamInfo: {
    type: "",
    name: "",
    slide: null,
    displayType: "stream",
    participantOverlayInfo: {
      name: "",
      time: Date.now(),
      id: generateRandomId(),
    },
    stbOverlayInfo: { heading: "", time: Date.now(), id: generateRandomId() },
    qrCodeOverlayInfo: { time: Date.now(), id: generateRandomId() },
    imageOverlayInfo: { time: Date.now(), id: generateRandomId() },
    formattedTextDisplayInfo: {
      text: "",
      time: Date.now(),
    },
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
    img?.imageUrl
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
    cur.id === next.id &&
    cur.imageUrl === next.imageUrl,
  );

const isSameParticipantOverlayEcho = (cur?: OverlayInfo, next?: OverlayInfo) =>
  Boolean(
    cur &&
    next &&
    hasParticipantOverlayData(cur) &&
    hasParticipantOverlayData(next) &&
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
    cur.id === next.id &&
    cur.url === next.url &&
    cur.description === next.description,
  );

const getNextTimestamp = (...times: Array<number | undefined>) => {
  const highestKnownTime = times.reduce<number>((highest, time) => {
    if (time == null || !Number.isFinite(time)) return highest;
    return Math.max(highest, time);
  }, 0);

  return Math.max(Date.now(), highestKnownTime + 1);
};

const getNextStreamOverlayTimestamp = (state: PresentationState) =>
  getNextTimestamp(
    state.streamInfo.participantOverlayInfo?.time,
    state.streamInfo.stbOverlayInfo?.time,
    state.streamInfo.qrCodeOverlayInfo?.time,
    state.streamInfo.imageOverlayInfo?.time,
  );

const emptyParticipantOverlay = (t: number): OverlayInfo => ({
  name: "",
  time: t,
  id: generateRandomId(),
});

const emptyStbOverlay = (t: number): OverlayInfo => ({
  heading: "",
  subHeading: "",
  time: t,
  id: generateRandomId(),
});

const emptyQrOverlay = (t: number): OverlayInfo => ({
  description: "",
  time: t,
  id: generateRandomId(),
});

const emptyImageOverlay = (t: number): OverlayInfo => ({
  name: "",
  imageUrl: "",
  time: t,
  id: generateRandomId(),
});

/**
 * Clears `prevStreamInfo` overlay slots other than `keep` before a live send.
 * After Clear, unrelated types can still sit in `prev` for exit; sending a new
 * overlay must not replay those. `preserveClearedStreamOverlaysForTransition`
 * immediately copies anything still live on `streamInfo` back into `prev`.
 */
const clearStalePrevStreamOverlaySlotsExcept = (
  state: PresentationState,
  keep: "participant" | "stb" | "qr" | "image",
  t: number,
) => {
  const { streamInfo, prevStreamInfo } = state;
  // Only clear a prev slot when stream has no live data for that type. Otherwise
  // we wipe the outgoing overlay before preserve can copy stream → prev (e.g.
  // participant still on air when sending an image).
  if (
    keep !== "participant" &&
    !hasParticipantOverlayData(streamInfo.participantOverlayInfo)
  ) {
    prevStreamInfo.participantOverlayInfo = emptyParticipantOverlay(t);
  }
  if (keep !== "stb" && !hasStbOverlayData(streamInfo.stbOverlayInfo)) {
    prevStreamInfo.stbOverlayInfo = emptyStbOverlay(t);
  }
  if (keep !== "qr" && !hasQrOverlayData(streamInfo.qrCodeOverlayInfo)) {
    prevStreamInfo.qrCodeOverlayInfo = emptyQrOverlay(t);
  }
  if (keep !== "image" && !hasImageOverlayData(streamInfo.imageOverlayInfo)) {
    prevStreamInfo.imageOverlayInfo = emptyImageOverlay(t);
  }
};

/** Empty every stream overlay except the one that was just set (single-layer when overlay-only off). */
const clearStreamOverlaysExcept = (
  si: Presentation,
  keep: "participant" | "stb" | "qr" | "image",
  t: number,
) => {
  if (keep !== "participant")
    si.participantOverlayInfo = emptyParticipantOverlay(t);
  if (keep !== "stb") si.stbOverlayInfo = emptyStbOverlay(t);
  if (keep !== "qr") si.qrCodeOverlayInfo = emptyQrOverlay(t);
  if (keep !== "image") si.imageOverlayInfo = emptyImageOverlay(t);
};

const clearAllStreamOverlays = (si: Presentation, t: number) => {
  si.participantOverlayInfo = emptyParticipantOverlay(t);
  si.stbOverlayInfo = emptyStbOverlay(t);
  si.qrCodeOverlayInfo = emptyQrOverlay(t);
  si.imageOverlayInfo = emptyImageOverlay(t);
};

const preserveClearedStreamOverlaysForTransition = (
  state: PresentationState,
  keep: "participant" | "stb" | "qr" | "image",
) => {
  const { streamInfo, prevStreamInfo } = state;
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
function clearAllStreamOverlaysForTransition(state: PresentationState) {
  const { streamInfo, prevStreamInfo } = state;
  const t = getNextStreamOverlayTimestamp(state);

  const snapParticipant = streamInfo.participantOverlayInfo;
  const snapStb = streamInfo.stbOverlayInfo;
  const snapQr = streamInfo.qrCodeOverlayInfo;
  const snapImage = streamInfo.imageOverlayInfo;

  const liveParticipant = hasParticipantOverlayData(snapParticipant);
  const liveStb = hasStbOverlayData(snapStb);
  const liveQr = hasQrOverlayData(snapQr);
  const liveImage = hasImageOverlayData(snapImage);
  const prevParticipant = prevStreamInfo.participantOverlayInfo;
  const prevStb = prevStreamInfo.stbOverlayInfo;
  const prevQr = prevStreamInfo.qrCodeOverlayInfo;
  const prevImage = prevStreamInfo.imageOverlayInfo;

  prevStreamInfo.participantOverlayInfo = liveParticipant
    ? prevParticipant?.id && prevParticipant.id === snapParticipant?.id
      ? prevParticipant
      : { ...emptyParticipantOverlay(t), ...snapParticipant }
    : emptyParticipantOverlay(t);

  prevStreamInfo.stbOverlayInfo = liveStb
    ? prevStb?.id && prevStb.id === snapStb?.id
      ? prevStb
      : { ...emptyStbOverlay(t), ...snapStb }
    : emptyStbOverlay(t);

  prevStreamInfo.qrCodeOverlayInfo = liveQr
    ? prevQr?.id && prevQr.id === snapQr?.id
      ? prevQr
      : { ...emptyQrOverlay(t), ...snapQr }
    : emptyQrOverlay(t);

  prevStreamInfo.imageOverlayInfo = liveImage
    ? prevImage?.id && prevImage.id === snapImage?.id
      ? prevImage
      : { ...emptyImageOverlay(t), ...snapImage }
    : emptyImageOverlay(t);

  clearAllStreamOverlays(streamInfo, t);
}

const applyStreamOverlayOnlyToggle = (
  state: PresentationState,
  blocking: boolean,
) => {
  if (state.streamItemContentBlocked === blocking) return;
  state.streamItemContentBlocked = blocking;
};

export const presentationSlice = createSlice({
  name: "presentation",
  initialState,
  reducers: {
    updatePresentation: (state, action: PayloadAction<Presentation>) => {
      if (state.isProjectorTransmitting) {
        // set previous info for cross animation
        state.prevProjectorInfo.slide = state.projectorInfo.slide;
        state.prevProjectorInfo.name = state.projectorInfo.name;
        state.prevProjectorInfo.type = state.projectorInfo.type;
        state.prevProjectorInfo.time = state.projectorInfo.time;
        state.prevProjectorInfo.timerId = state.projectorInfo.timerId;

        state.projectorInfo.slide = action.payload.slide;
        state.projectorInfo.name = action.payload.name;
        state.projectorInfo.type = action.payload.type;
        state.projectorInfo.timerId = action.payload.timerId;
        state.projectorInfo.time = Date.now();
      }
      if (state.isMonitorTransmitting) {
        // set previous info for cross animation
        state.prevMonitorInfo.slide = state.monitorInfo.slide;
        state.prevMonitorInfo.name = state.monitorInfo.name;
        state.prevMonitorInfo.type = state.monitorInfo.type;
        state.prevMonitorInfo.time = state.monitorInfo.time;
        state.prevMonitorInfo.timerId = state.monitorInfo.timerId;
        state.prevMonitorInfo.itemId = state.monitorInfo.itemId;
        state.prevMonitorInfo.nextSlide = state.monitorInfo.nextSlide ?? null;

        state.monitorInfo.slide = action.payload.slide;
        state.monitorInfo.name = action.payload.name;
        state.monitorInfo.type = action.payload.type;
        state.monitorInfo.timerId = action.payload.timerId;
        state.monitorInfo.itemId = action.payload.itemId;
        state.monitorInfo.time = Date.now();
        state.monitorInfo.nextSlide =
          action.payload.nextSlide !== undefined
            ? action.payload.nextSlide
            : null;
      }
      if (state.isStreamTransmitting) {
        // set previous info for cross animation (copy slide so boxes !== prevBoxes for crossfade)
        state.prevStreamInfo.slide = copyStreamSlide(state.streamInfo.slide);
        state.prevStreamInfo.name = state.streamInfo.name;
        state.prevStreamInfo.type = state.streamInfo.type;
        state.prevStreamInfo.time = state.streamInfo.time;
        state.prevStreamInfo.timerId = state.streamInfo.timerId;
        if (action.payload.type !== "bible" && action.payload.type !== "free") {
          state.streamInfo.slide = action.payload.slide;
        }

        state.streamInfo.name = action.payload.name;
        state.streamInfo.type = action.payload.type;
        state.streamInfo.timerId = action.payload.timerId;
        state.streamInfo.time = Date.now();
      }
    },
    toggleProjectorTransmitting: (state) => {
      state.isProjectorTransmitting = !state.isProjectorTransmitting;
    },
    toggleMonitorTransmitting: (state) => {
      state.isMonitorTransmitting = !state.isMonitorTransmitting;
    },
    toggleStreamTransmitting: (state) => {
      state.isStreamTransmitting = !state.isStreamTransmitting;
    },
    setTransmitToAll: (state, action: PayloadAction<boolean>) => {
      state.isProjectorTransmitting = action.payload;
      state.isMonitorTransmitting = action.payload;
      state.isStreamTransmitting = action.payload;
    },
    setStreamItemContentBlocked: (state, action: PayloadAction<boolean>) => {
      applyStreamOverlayOnlyToggle(state, action.payload);
    },
    setStreamItemContentBlockedFromRemote: (
      state,
      action: PayloadAction<boolean>,
    ) => {
      applyStreamOverlayOnlyToggle(state, action.payload);
    },
    /** Overlay operator: remove all stream overlays; slide/bible/formatted unchanged. */
    clearStreamOverlaysOnly: (state) => {
      if (!state.isStreamTransmitting) return;
      if (!hasActiveStreamOverlay(state.streamInfo)) return;
      clearAllStreamOverlaysForTransition(state);
    },
    updateParticipantOverlayInfo: (
      state,
      action: PayloadAction<OverlayInfo>,
    ) => {
      if (!state.isStreamTransmitting) return;
      const t = getNextStreamOverlayTimestamp(state);
      state.prevStreamInfo.participantOverlayInfo =
        state.streamInfo.participantOverlayInfo;
      state.streamInfo.participantOverlayInfo = {
        ...action.payload,
        time: t,
      };
      if (action.payload.name || action.payload.title || action.payload.event) {
        preserveClearedStreamOverlaysForTransition(state, "participant");
        clearStreamOverlaysExcept(state.streamInfo, "participant", t);
      }
    },
    updateStbOverlayInfo: (state, action: PayloadAction<OverlayInfo>) => {
      if (!state.isStreamTransmitting) return;
      const t = getNextStreamOverlayTimestamp(state);
      state.prevStreamInfo.stbOverlayInfo = state.streamInfo.stbOverlayInfo;
      state.streamInfo.stbOverlayInfo = { ...action.payload, time: t };
      if (action.payload.heading || action.payload.subHeading) {
        preserveClearedStreamOverlaysForTransition(state, "stb");
        clearStreamOverlaysExcept(state.streamInfo, "stb", t);
      }
    },
    updateQrCodeOverlayInfo: (state, action: PayloadAction<OverlayInfo>) => {
      if (!state.isStreamTransmitting) return;
      const t = getNextStreamOverlayTimestamp(state);
      state.prevStreamInfo.qrCodeOverlayInfo =
        state.streamInfo.qrCodeOverlayInfo;
      state.streamInfo.qrCodeOverlayInfo = { ...action.payload, time: t };
      if (action.payload.url || action.payload.description) {
        preserveClearedStreamOverlaysForTransition(state, "qr");
        clearStreamOverlaysExcept(state.streamInfo, "qr", t);
      }
    },
    updateImageOverlayInfo: (state, action: PayloadAction<OverlayInfo>) => {
      if (!state.isStreamTransmitting) return;
      const t = getNextStreamOverlayTimestamp(state);
      if (action.payload.imageUrl) {
        clearStalePrevStreamOverlaySlotsExcept(state, "image", t);
      }
      state.prevStreamInfo.imageOverlayInfo = state.streamInfo.imageOverlayInfo;
      state.streamInfo.imageOverlayInfo = { ...action.payload, time: t };
      if (action.payload.imageUrl) {
        preserveClearedStreamOverlaysForTransition(state, "image");
        clearStreamOverlaysExcept(state.streamInfo, "image", t);
      }
    },
    updateImageOverlayInfoFromRemote: (
      state,
      action: PayloadAction<OverlayInfo>,
    ) => {
      const next = action.payload;
      const t = next.time ?? Date.now();
      const cur = state.streamInfo.imageOverlayInfo;

      if (isSameImageOverlayEcho(cur, next)) {
        return;
      }

      if (next.imageUrl) {
        clearStalePrevStreamOverlaySlotsExcept(state, "image", t);
      }

      if (hasImageOverlayData(cur) || next.imageUrl) {
        state.prevStreamInfo.imageOverlayInfo = cur;
      } else if (!next.imageUrl) {
        state.prevStreamInfo.imageOverlayInfo = emptyImageOverlay(t);
      }

      state.streamInfo.imageOverlayInfo = {
        ...next,
        time: t,
      };
      if (!next.imageUrl) return;
      preserveClearedStreamOverlaysForTransition(state, "image");
      clearStreamOverlaysExcept(state.streamInfo, "image", t);
    },
    updateParticipantOverlayInfoFromRemote: (
      state,
      action: PayloadAction<OverlayInfo>,
    ) => {
      const next = action.payload;
      const t = next.time ?? Date.now();
      const cur = state.streamInfo.participantOverlayInfo;

      if (isSameParticipantOverlayEcho(cur, next)) {
        return;
      }

      const nextHasLines = Boolean(next.name || next.title || next.event);
      if (hasParticipantOverlayData(cur) || nextHasLines) {
        state.prevStreamInfo.participantOverlayInfo = cur;
      } else if (
        !nextHasLines &&
        !hasParticipantOverlayData(state.prevStreamInfo.participantOverlayInfo)
      ) {
        state.prevStreamInfo.participantOverlayInfo =
          emptyParticipantOverlay(t);
      }

      state.streamInfo.participantOverlayInfo = {
        ...next,
        time: t,
      };
      if (!nextHasLines) return;
      preserveClearedStreamOverlaysForTransition(state, "participant");
      clearStreamOverlaysExcept(state.streamInfo, "participant", t);
    },
    updateStbOverlayInfoFromRemote: (
      state,
      action: PayloadAction<OverlayInfo>,
    ) => {
      const next = action.payload;
      const t = next.time ?? Date.now();
      const cur = state.streamInfo.stbOverlayInfo;

      if (isSameStbOverlayEcho(cur, next)) {
        return;
      }

      const nextHasStb = Boolean(next.heading || next.subHeading);
      if (hasStbOverlayData(cur) || nextHasStb) {
        state.prevStreamInfo.stbOverlayInfo = cur;
      } else if (!nextHasStb) {
        state.prevStreamInfo.stbOverlayInfo = emptyStbOverlay(t);
      }

      state.streamInfo.stbOverlayInfo = {
        ...next,
        time: t,
      };
      if (!nextHasStb) return;
      preserveClearedStreamOverlaysForTransition(state, "stb");
      clearStreamOverlaysExcept(state.streamInfo, "stb", t);
    },
    updateQrCodeOverlayInfoFromRemote: (
      state,
      action: PayloadAction<OverlayInfo>,
    ) => {
      const next = action.payload;
      const t = next.time ?? Date.now();
      const cur = state.streamInfo.qrCodeOverlayInfo;

      if (isSameQrOverlayEcho(cur, next)) {
        return;
      }

      const nextHasQr = Boolean(next.url || next.description);
      if (hasQrOverlayData(cur) || nextHasQr) {
        state.prevStreamInfo.qrCodeOverlayInfo = cur;
      } else if (!nextHasQr) {
        state.prevStreamInfo.qrCodeOverlayInfo = emptyQrOverlay(t);
      }

      state.streamInfo.qrCodeOverlayInfo = {
        ...next,
        time: t,
      };
      if (!nextHasQr) return;
      preserveClearedStreamOverlaysForTransition(state, "qr");
      clearStreamOverlaysExcept(state.streamInfo, "qr", t);
    },
    updateBibleDisplayInfo: (
      state,
      action: PayloadAction<BibleDisplayInfo>,
    ) => {
      if (!state.isStreamTransmitting) return;
      const t = Date.now();
      state.prevStreamInfo.bibleDisplayInfo = state.streamInfo.bibleDisplayInfo;
      const ft = state.streamInfo.formattedTextDisplayInfo;
      state.prevStreamInfo.formattedTextDisplayInfo = ft?.text?.trim()
        ? ft
        : { ...ft, text: "", time: t };
      state.streamInfo.formattedTextDisplayInfo = {
        ...ft,
        text: "",
        time: t,
      };
      state.streamInfo.bibleDisplayInfo = { ...action.payload, time: t };
      state.streamInfo.type = "bible";
      state.streamInfo.slide = null;
      state.streamInfo.time = t;
    },
    updateBibleDisplayInfoFromRemote: (
      state,
      action: PayloadAction<BibleDisplayInfo>,
    ) => {
      const t = action.payload.time ?? Date.now();
      state.prevStreamInfo.bibleDisplayInfo = state.streamInfo.bibleDisplayInfo;
      const ft = state.streamInfo.formattedTextDisplayInfo;
      state.prevStreamInfo.formattedTextDisplayInfo = ft?.text?.trim()
        ? ft
        : { ...ft, text: "", time: t };
      state.streamInfo.formattedTextDisplayInfo = {
        ...ft,
        text: "",
        time: t,
      };
      state.streamInfo.bibleDisplayInfo = { ...action.payload };
      state.streamInfo.type = "bible";
    },
    updateFormattedTextDisplayInfo: (
      state,
      action: PayloadAction<FormattedTextDisplayInfo>,
    ) => {
      if (!state.isStreamTransmitting) return;
      // After bible runs, ItemSlides / Firebase may still emit formatted { text: "" }.
      // Applying that as a full handoff would clear the live bible (see FromRemote guard).
      if (!action.payload.text?.trim() && state.streamInfo.type === "bible") {
        return;
      }
      const t = Date.now();
      state.prevStreamInfo.formattedTextDisplayInfo =
        state.streamInfo.formattedTextDisplayInfo;
      const bible = state.streamInfo.bibleDisplayInfo;
      const hadLiveBible =
        Boolean(bible?.title?.trim()) || Boolean(bible?.text?.trim());
      const prevBible = state.prevStreamInfo.bibleDisplayInfo;
      const prevHasBible =
        Boolean(prevBible?.title?.trim()) || Boolean(prevBible?.text?.trim());
      const nextHasFormatted = Boolean(action.payload.text?.trim());
      if (hadLiveBible) {
        state.prevStreamInfo.bibleDisplayInfo = bible;
      } else if (
        nextHasFormatted &&
        prevHasBible &&
        state.streamInfo.type === "bible"
      ) {
        // ItemSlides clears bible then sends formatted in the same tick; scripture
        // is already in prev from updateBibleDisplayInfo — do not overwrite with empty.
      } else {
        state.prevStreamInfo.bibleDisplayInfo = {
          ...(bible ?? { title: "", text: "" }),
          title: "",
          text: "",
          time: t,
        };
      }
      state.streamInfo.bibleDisplayInfo = {
        ...(bible ?? { title: "", text: "" }),
        title: "",
        text: "",
        time: t,
      };
      state.streamInfo.formattedTextDisplayInfo = {
        ...action.payload,
        time: t,
      };
      state.streamInfo.type = "free";
      state.streamInfo.slide = null;
      state.streamInfo.time = t;
    },
    updateFormattedTextDisplayInfoFromRemote: (
      state,
      action: PayloadAction<FormattedTextDisplayInfo>,
    ) => {
      // Per-key Firebase: cleared formatted arrives after bible; do not treat as
      // "switch to formatted" or we wipe scripture from streamInfo.
      if (!action.payload.text?.trim() && state.streamInfo.type === "bible") {
        return;
      }
      const t = action.payload.time ?? Date.now();
      state.prevStreamInfo.formattedTextDisplayInfo =
        state.streamInfo.formattedTextDisplayInfo;
      const bible = state.streamInfo.bibleDisplayInfo;
      const hadLiveBible =
        Boolean(bible?.title?.trim()) || Boolean(bible?.text?.trim());
      const prevBible = state.prevStreamInfo.bibleDisplayInfo;
      const prevHasBible =
        Boolean(prevBible?.title?.trim()) || Boolean(prevBible?.text?.trim());
      const nextHasFormatted = Boolean(action.payload.text?.trim());
      if (hadLiveBible) {
        state.prevStreamInfo.bibleDisplayInfo = bible;
      } else if (
        nextHasFormatted &&
        prevHasBible &&
        state.streamInfo.type === "bible"
      ) {
        // Same-tick bible clear then formatted on remotes (per-key ordering differs).
      } else {
        state.prevStreamInfo.bibleDisplayInfo = {
          ...(bible ?? { title: "", text: "" }),
          title: "",
          text: "",
          time: t,
        };
      }
      state.streamInfo.bibleDisplayInfo = {
        ...(bible ?? { title: "", text: "" }),
        title: "",
        text: "",
        time: t,
      };
      state.streamInfo.formattedTextDisplayInfo = {
        ...action.payload,
        time: action.payload.time,
      };
      state.streamInfo.type = "free";
    },
    clearProjector: (state) => {
      // set previous info for fading out
      state.prevProjectorInfo.slide = state.projectorInfo.slide;
      state.prevProjectorInfo.name = state.projectorInfo.name;
      state.prevProjectorInfo.type = state.projectorInfo.type;
      state.prevProjectorInfo.time = state.projectorInfo.time;
      state.prevProjectorInfo.timerId = state.projectorInfo.timerId;

      state.projectorInfo = {
        ...initialState.projectorInfo,
        time: Date.now(),
      };
    },
    clearMonitor: (state) => {
      // set previous info for fading out
      state.prevMonitorInfo.slide = state.monitorInfo.slide;
      state.prevMonitorInfo.name = state.monitorInfo.name;
      state.prevMonitorInfo.type = state.monitorInfo.type;
      state.prevMonitorInfo.time = state.monitorInfo.time;
      state.prevMonitorInfo.timerId = state.monitorInfo.timerId;
      state.prevMonitorInfo.itemId = state.monitorInfo.itemId;
      state.prevMonitorInfo.nextSlide = state.monitorInfo.nextSlide ?? null;

      state.monitorInfo = {
        ...initialState.monitorInfo,
        time: Date.now(),
      };
    },
    clearStream: (state) => {
      state.streamItemContentBlocked = false;
      // set previous info for fading out (copy so boxes/prevBoxes stay distinct for crossfade)
      state.prevStreamInfo.slide = copyStreamSlide(state.streamInfo.slide);
      state.prevStreamInfo.name = state.streamInfo.name;
      state.prevStreamInfo.type = state.streamInfo.type;
      state.prevStreamInfo.time = state.streamInfo.time;
      state.prevStreamInfo.timerId = state.streamInfo.timerId;
      state.prevStreamInfo.participantOverlayInfo =
        state.streamInfo.participantOverlayInfo;
      state.prevStreamInfo.stbOverlayInfo = state.streamInfo.stbOverlayInfo;
      state.prevStreamInfo.bibleDisplayInfo = state.streamInfo.bibleDisplayInfo;
      state.prevStreamInfo.qrCodeOverlayInfo =
        state.streamInfo.qrCodeOverlayInfo;
      state.prevStreamInfo.imageOverlayInfo = state.streamInfo.imageOverlayInfo;
      state.prevStreamInfo.formattedTextDisplayInfo =
        state.streamInfo.formattedTextDisplayInfo;

      state.streamInfo = {
        ...initialState.streamInfo,
        time: Date.now(),
        bibleDisplayInfo: { title: "", text: "", time: Date.now() },
        participantOverlayInfo: {
          name: "",
          time: Date.now(),
          id: generateRandomId(),
        },
        stbOverlayInfo: {
          heading: "",
          time: Date.now(),
          id: generateRandomId(),
        },
        qrCodeOverlayInfo: {
          description: "",
          time: Date.now(),
          id: generateRandomId(),
        },
        imageOverlayInfo: {
          name: "",
          imageUrl: "",
          time: Date.now(),
          id: generateRandomId(),
        },
        formattedTextDisplayInfo: {
          text: "",
          time: Date.now(),
        },
      };
    },
    clearAll: (state) => {
      state.streamItemContentBlocked = false;
      // set previous info for fading out
      state.prevProjectorInfo.slide = state.projectorInfo.slide;
      state.prevProjectorInfo.name = state.projectorInfo.name;
      state.prevProjectorInfo.type = state.projectorInfo.type;
      state.prevProjectorInfo.time = state.projectorInfo.time;
      state.prevProjectorInfo.timerId = state.projectorInfo.timerId;

      state.prevMonitorInfo.slide = state.monitorInfo.slide;
      state.prevMonitorInfo.name = state.monitorInfo.name;
      state.prevMonitorInfo.type = state.monitorInfo.type;
      state.prevMonitorInfo.time = state.monitorInfo.time;
      state.prevMonitorInfo.timerId = state.monitorInfo.timerId;
      state.prevMonitorInfo.itemId = state.monitorInfo.itemId;

      state.prevStreamInfo.slide = copyStreamSlide(state.streamInfo.slide);
      state.prevStreamInfo.name = state.streamInfo.name;
      state.prevStreamInfo.type = state.streamInfo.type;
      state.prevStreamInfo.time = state.streamInfo.time;
      state.prevStreamInfo.timerId = state.streamInfo.timerId;
      state.prevStreamInfo.participantOverlayInfo =
        state.streamInfo.participantOverlayInfo;
      state.prevStreamInfo.stbOverlayInfo = state.streamInfo.stbOverlayInfo;
      state.prevStreamInfo.bibleDisplayInfo = state.streamInfo.bibleDisplayInfo;
      state.prevStreamInfo.qrCodeOverlayInfo =
        state.streamInfo.qrCodeOverlayInfo;
      state.prevStreamInfo.imageOverlayInfo = state.streamInfo.imageOverlayInfo;
      state.prevStreamInfo.formattedTextDisplayInfo =
        state.streamInfo.formattedTextDisplayInfo;

      state.projectorInfo = {
        ...initialState.projectorInfo,
        time: Date.now(),
      };
      state.monitorInfo = {
        ...initialState.monitorInfo,
        time: Date.now(),
      };
      state.streamInfo = {
        ...initialState.streamInfo,
        time: Date.now(),
        bibleDisplayInfo: { title: "", text: "", time: Date.now() },
        participantOverlayInfo: {
          name: "",
          time: Date.now(),
          id: generateRandomId(),
        },
        stbOverlayInfo: {
          heading: "",
          time: Date.now(),
          id: generateRandomId(),
        },
        qrCodeOverlayInfo: {
          description: "",
          time: Date.now(),
          id: generateRandomId(),
        },
        imageOverlayInfo: {
          name: "",
          imageUrl: "",
          time: Date.now(),
          id: generateRandomId(),
        },
        formattedTextDisplayInfo: {
          text: "",
          time: Date.now(),
        },
      };
    },
    updateProjector: (
      state,
      action: PayloadAction<Presentation & { skipTransmissionCheck?: boolean }>,
    ) => {
      // set previous info for cross animation
      if (
        state.isProjectorTransmitting ||
        action.payload.skipTransmissionCheck
      ) {
        state.prevProjectorInfo.slide = state.projectorInfo.slide;
        state.prevProjectorInfo.name = state.projectorInfo.name;
        state.prevProjectorInfo.type = state.projectorInfo.type;
        state.prevProjectorInfo.time = state.projectorInfo.time;
        state.prevProjectorInfo.timerId = state.projectorInfo.timerId;

        state.projectorInfo.slide = action.payload.slide;
        state.projectorInfo.type = action.payload.type;
        state.projectorInfo.name = action.payload.name;
        state.projectorInfo.timerId = action.payload.timerId;
        state.projectorInfo.time = Date.now();
      }
    },
    updateProjectorFromRemote: (state, action: PayloadAction<Presentation>) => {
      // set previous info for cross animation
      state.prevProjectorInfo.slide = state.projectorInfo.slide;
      state.prevProjectorInfo.name = state.projectorInfo.name;
      state.prevProjectorInfo.type = state.projectorInfo.type;
      state.prevProjectorInfo.time = state.projectorInfo.time;
      state.prevProjectorInfo.timerId = state.projectorInfo.timerId;

      state.projectorInfo.slide = action.payload.slide;
      state.projectorInfo.name = action.payload.name;
      state.projectorInfo.type = action.payload.type;
      state.projectorInfo.time = action.payload.time;
      state.projectorInfo.timerId = action.payload.timerId;
    },
    updateMonitor: (
      state,
      action: PayloadAction<Presentation & { skipTransmissionCheck?: boolean }>,
    ) => {
      // set previous info for cross animation
      if (state.isMonitorTransmitting || action.payload.skipTransmissionCheck) {
        state.prevMonitorInfo.slide = state.monitorInfo.slide;
        state.prevMonitorInfo.name = state.monitorInfo.name;
        state.prevMonitorInfo.type = state.monitorInfo.type;
        state.prevMonitorInfo.time = state.monitorInfo.time;
        state.prevMonitorInfo.timerId = state.monitorInfo.timerId;
        state.prevMonitorInfo.itemId = state.monitorInfo.itemId;
        state.prevMonitorInfo.nextSlide = state.monitorInfo.nextSlide ?? null;
        state.prevMonitorInfo.bibleInfoBox = state.monitorInfo.bibleInfoBox;

        state.monitorInfo.slide = action.payload.slide;
        state.monitorInfo.name = action.payload.name;
        state.monitorInfo.type = action.payload.type;
        state.monitorInfo.timerId = action.payload.timerId;
        state.monitorInfo.itemId = action.payload.itemId;
        state.monitorInfo.time = Date.now();
        state.monitorInfo.nextSlide =
          action.payload.nextSlide !== undefined
            ? action.payload.nextSlide
            : null;
        state.monitorInfo.transitionDirection =
          action.payload.transitionDirection;
        state.monitorInfo.bibleInfoBox = action.payload.bibleInfoBox;
      }
    },
    updateMonitorFromRemote: (state, action: PayloadAction<Presentation>) => {
      // set previous info for cross animation
      state.prevMonitorInfo.slide = state.monitorInfo.slide;
      state.prevMonitorInfo.name = state.monitorInfo.name;
      state.prevMonitorInfo.type = state.monitorInfo.type;
      state.prevMonitorInfo.time = state.monitorInfo.time;
      state.prevMonitorInfo.timerId = state.monitorInfo.timerId;
      state.prevMonitorInfo.itemId = state.monitorInfo.itemId;
      state.prevMonitorInfo.nextSlide = state.monitorInfo.nextSlide ?? null;
      state.prevMonitorInfo.bibleInfoBox = state.monitorInfo.bibleInfoBox;

      state.monitorInfo.slide = action.payload.slide;
      state.monitorInfo.name = action.payload.name;
      state.monitorInfo.type = action.payload.type;
      state.monitorInfo.time = action.payload.time;
      state.monitorInfo.timerId = action.payload.timerId;
      state.monitorInfo.itemId = action.payload.itemId;
      state.monitorInfo.nextSlide =
        action.payload.nextSlide !== undefined
          ? action.payload.nextSlide
          : null;
      state.monitorInfo.transitionDirection =
        action.payload.transitionDirection;
      state.monitorInfo.bibleInfoBox = action.payload.bibleInfoBox;
    },
    updateStream: (
      state,
      action: PayloadAction<Presentation & { skipTransmissionCheck?: boolean }>,
    ) => {
      if (state.isStreamTransmitting || action.payload.skipTransmissionCheck) {
        const t = Date.now();
        const isStreamSlideType =
          action.payload.type !== "bible" && action.payload.type !== "free";
        state.prevStreamInfo.slide = copyStreamSlide(state.streamInfo.slide);
        state.prevStreamInfo.name = state.streamInfo.name;
        state.prevStreamInfo.type = state.streamInfo.type;
        state.prevStreamInfo.time = state.streamInfo.time;
        state.prevStreamInfo.timerId = state.streamInfo.timerId;
        if (isStreamSlideType) {
          const bible = state.streamInfo.bibleDisplayInfo;
          if (bible?.title?.trim() || bible?.text?.trim()) {
            state.prevStreamInfo.bibleDisplayInfo = bible;
          }
          const ft = state.streamInfo.formattedTextDisplayInfo;
          if (ft?.text?.trim()) {
            state.prevStreamInfo.formattedTextDisplayInfo = ft;
          }
          state.streamInfo.slide = action.payload.slide;
          clearStreamNonSlideItemData(state.streamInfo, t);
        } else {
          state.streamInfo.slide = null;
        }

        state.streamInfo.name = action.payload.name;
        state.streamInfo.type = action.payload.type;
        state.streamInfo.timerId = action.payload.timerId;
        state.streamInfo.time = t;
      }
    },
    updateStreamFromRemote: (state, action: PayloadAction<Presentation>) => {
      const t = action.payload.time || Date.now();
      const isStreamSlideType =
        action.payload.type !== "bible" && action.payload.type !== "free";
      state.prevStreamInfo.slide = copyStreamSlide(state.streamInfo.slide);
      state.prevStreamInfo.name = state.streamInfo.name;
      state.prevStreamInfo.type = state.streamInfo.type;
      state.prevStreamInfo.time = state.streamInfo.time;
      state.prevStreamInfo.timerId = state.streamInfo.timerId;

      if (isStreamSlideType) {
        const bible = state.streamInfo.bibleDisplayInfo;
        if (bible?.title?.trim() || bible?.text?.trim()) {
          state.prevStreamInfo.bibleDisplayInfo = bible;
        }
        const ft = state.streamInfo.formattedTextDisplayInfo;
        if (ft?.text?.trim()) {
          state.prevStreamInfo.formattedTextDisplayInfo = ft;
        }
        state.streamInfo.slide = action.payload.slide;
        clearStreamNonSlideItemData(state.streamInfo, t);
      } else {
        state.streamInfo.slide = null;
      }

      if (action.payload.name !== undefined)
        state.streamInfo.name = action.payload.name;
      if (action.payload.type !== undefined)
        state.streamInfo.type = action.payload.type;
      state.streamInfo.time = action.payload.time;
      state.streamInfo.timerId = action.payload.timerId;
    },
  },
});

export const {
  updatePresentation,
  toggleProjectorTransmitting,
  toggleMonitorTransmitting,
  toggleStreamTransmitting,
  setTransmitToAll,
  setStreamItemContentBlocked,
  setStreamItemContentBlockedFromRemote,
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
} = presentationSlice.actions;

export default presentationSlice.reducer;
