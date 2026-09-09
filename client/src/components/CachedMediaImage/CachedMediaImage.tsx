import React, { forwardRef } from "react";
import { useCachedMediaUrl } from "../../hooks/useCachedMediaUrl";
import { isLocalMediaReferenceUrl } from "../../utils/localMediaReferenceUrl";

type CachedMediaImageProps = React.ImgHTMLAttributes<HTMLImageElement> & {
  src: string | undefined;
};

/**
 * Renders an img using the media cache when available (Electron).
 * Use wherever a media-library or cacheable URL is displayed.
 */
const CachedMediaImage = forwardRef<HTMLImageElement, CachedMediaImageProps>(
  ({ src, alt = "", ...imgProps }, ref) => {
    const resolvedSrc = useCachedMediaUrl(src);
    const displaySrc = resolvedSrc ?? (isLocalMediaReferenceUrl(src) ? undefined : src);
    if (!displaySrc) return null;
    return (
      <img
        ref={ref}
        alt={alt}
        {...imgProps}
        src={displaySrc}
      />
    );
  }
);

CachedMediaImage.displayName = "CachedMediaImage";

export default CachedMediaImage;
