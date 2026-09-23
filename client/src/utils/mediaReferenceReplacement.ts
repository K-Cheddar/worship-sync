import type {
  Arrangment,
  Box,
  ItemSlideType,
  MediaType,
  OverlayInfo,
  PreferenceBackground,
  Presentation,
  QuickLinkType,
} from "../types";

export type MediaReferenceReplacement = {
  oldMedia: MediaType;
  newMedia: MediaType;
};

const stripUrlQuery = (url: string) => {
  const queryIndex = url.indexOf("?");
  return queryIndex === -1 ? url : url.slice(0, queryIndex);
};

const mediaUrls = (media: MediaType) =>
  new Set(
    [media.background, media.thumbnail, media.placeholderImage]
      .filter((url): url is string => Boolean(url))
      .map(stripUrlQuery),
  );

export const mediaReferenceMatches = (
  media: MediaType,
  mediaInfo?: MediaType,
  backgroundUrl?: string,
) => {
  if (mediaInfo?.id === media.id) return true;
  return Boolean(
    backgroundUrl && mediaUrls(media).has(stripUrlQuery(backgroundUrl)),
  );
};

const replaceBox = (box: Box, replacement: MediaReferenceReplacement) => {
  if (
    !mediaReferenceMatches(
      replacement.oldMedia,
      box.mediaInfo,
      box.background,
    )
  ) {
    return box;
  }
  return {
    ...box,
    background: replacement.newMedia.background,
    mediaInfo: replacement.newMedia,
  };
};

const replaceBoxes = (
  boxes: Box[] | undefined,
  replacement: MediaReferenceReplacement,
) => {
  if (!boxes) return boxes;
  let changed = false;
  const next = boxes.map((box) => {
    const replaced = replaceBox(box, replacement);
    changed ||= replaced !== box;
    return replaced;
  });
  return changed ? next : boxes;
};

export const replaceMediaReferencesInSlide = (
  slide: ItemSlideType,
  replacement: MediaReferenceReplacement,
) => {
  const boxes = replaceBoxes(slide.boxes, replacement) as Box[];
  const monitorCurrentBandBoxes = replaceBoxes(
    slide.monitorCurrentBandBoxes,
    replacement,
  );
  const monitorNextBandBoxes = replaceBoxes(
    slide.monitorNextBandBoxes,
    replacement,
  );
  if (
    boxes === slide.boxes &&
    monitorCurrentBandBoxes === slide.monitorCurrentBandBoxes &&
    monitorNextBandBoxes === slide.monitorNextBandBoxes
  ) {
    return slide;
  }
  return {
    ...slide,
    boxes,
    monitorCurrentBandBoxes,
    monitorNextBandBoxes,
  };
};

const replaceSlides = (
  slides: ItemSlideType[] | undefined,
  replacement: MediaReferenceReplacement,
) => {
  if (!slides) return slides;
  let changed = false;
  const next = slides.map((slide) => {
    const replaced = replaceMediaReferencesInSlide(slide, replacement);
    changed ||= replaced !== slide;
    return replaced;
  });
  return changed ? next : slides;
};

const replaceArrangementSlides = (
  arrangements: Arrangment[] | undefined,
  replacement: MediaReferenceReplacement,
) => {
  if (!arrangements) return arrangements;
  let changed = false;
  const next = arrangements.map((arrangement) => {
    const slides = replaceSlides(arrangement.slides, replacement);
    changed ||= slides !== arrangement.slides;
    return slides === arrangement.slides ? arrangement : { ...arrangement, slides };
  });
  return changed ? next : arrangements;
};

export const replaceMediaReferencesInItem = <T extends {
  background?: string;
  slides?: ItemSlideType[];
  arrangements?: Arrangment[];
}>(item: T, replacement: MediaReferenceReplacement): T => {
  const background = mediaReferenceMatches(
    replacement.oldMedia,
    undefined,
    item.background,
  )
    ? replacement.newMedia.background
    : item.background;
  const slides = replaceSlides(item.slides, replacement);
  const arrangements = replaceArrangementSlides(item.arrangements, replacement);
  if (
    background === item.background &&
    slides === item.slides &&
    arrangements === item.arrangements
  ) {
    return item;
  }
  return { ...item, background, slides, arrangements };
};

const replaceOverlayInfo = (
  info: OverlayInfo | undefined,
  replacement: MediaReferenceReplacement,
) => {
  if (
    !info ||
    info.type !== "image" ||
    !mediaReferenceMatches(replacement.oldMedia, undefined, info.imageUrl)
  ) {
    return info;
  }
  return { ...info, imageUrl: replacement.newMedia.background };
};

export const replaceMediaReferencesInPresentation = (
  presentation: Presentation | undefined,
  replacement: MediaReferenceReplacement,
) => {
  if (!presentation) return presentation;
  const slide = presentation.slide
    ? replaceMediaReferencesInSlide(presentation.slide, replacement)
    : presentation.slide;
  const nextSlide = presentation.nextSlide
    ? replaceMediaReferencesInSlide(presentation.nextSlide, replacement)
    : presentation.nextSlide;
  const bibleInfoBox = presentation.bibleInfoBox
    ? replaceBox(presentation.bibleInfoBox, replacement)
    : presentation.bibleInfoBox;
  const participantOverlayInfo = replaceOverlayInfo(
    presentation.participantOverlayInfo,
    replacement,
  );
  const stbOverlayInfo = replaceOverlayInfo(
    presentation.stbOverlayInfo,
    replacement,
  );
  const qrCodeOverlayInfo = replaceOverlayInfo(
    presentation.qrCodeOverlayInfo,
    replacement,
  );
  const imageOverlayInfo = replaceOverlayInfo(
    presentation.imageOverlayInfo,
    replacement,
  );
  if (
    slide === presentation.slide &&
    nextSlide === presentation.nextSlide &&
    bibleInfoBox === presentation.bibleInfoBox &&
    participantOverlayInfo === presentation.participantOverlayInfo &&
    stbOverlayInfo === presentation.stbOverlayInfo &&
    qrCodeOverlayInfo === presentation.qrCodeOverlayInfo &&
    imageOverlayInfo === presentation.imageOverlayInfo
  ) {
    return presentation;
  }
  return {
    ...presentation,
    slide,
    nextSlide,
    bibleInfoBox,
    participantOverlayInfo,
    stbOverlayInfo,
    qrCodeOverlayInfo,
    imageOverlayInfo,
  };
};

export function replaceMediaReferencesInPreference(
  preference: PreferenceBackground,
  replacement: MediaReferenceReplacement,
): PreferenceBackground;
export function replaceMediaReferencesInPreference(
  preference: PreferenceBackground | undefined,
  replacement: MediaReferenceReplacement,
): PreferenceBackground | undefined;
export function replaceMediaReferencesInPreference(
  preference: PreferenceBackground | undefined,
  replacement: MediaReferenceReplacement,
) {
  if (!preference) return preference;
  if (
    !mediaReferenceMatches(
      replacement.oldMedia,
      preference.mediaInfo,
      preference.background,
    )
  ) {
    return preference;
  }
  return {
    ...preference,
    background: replacement.newMedia.background,
    mediaInfo: replacement.newMedia,
  };
}

export const replaceMediaReferencesInQuickLinks = (
  quickLinks: QuickLinkType[],
  replacement: MediaReferenceReplacement,
) => {
  let changed = false;
  const next = quickLinks.map((quickLink) => {
    const presentationInfo = replaceMediaReferencesInPresentation(
      quickLink.presentationInfo,
      replacement,
    );
    changed ||= presentationInfo !== quickLink.presentationInfo;
    return presentationInfo === quickLink.presentationInfo
      ? quickLink
      : { ...quickLink, presentationInfo };
  });
  return changed ? next : quickLinks;
};
