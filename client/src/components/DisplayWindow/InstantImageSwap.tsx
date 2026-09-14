import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

type InstantImageSwapProps = {
  src?: string;
  alt: string;
  className?: string;
  style?: CSSProperties;
  /** Keep the current image while an asynchronous local URL is resolving. */
  holdWhileLoading?: boolean;
};

/**
 * An editor-only atomic image replacement. The next image is decoded in a
 * hidden DOM node, then replaces the visible node in one React commit. It does
 * not animate.
 */
const InstantImageSwap = ({
  src,
  alt,
  className,
  style,
  holdWhileLoading = false,
}: InstantImageSwapProps) => {
  const [visibleSrc, setVisibleSrc] = useState<string | null>(() => src ?? null);
  const [pendingSrc, setPendingSrc] = useState<string | null>(null);
  const pendingSrcRef = useRef(pendingSrc);
  pendingSrcRef.current = pendingSrc;

  useLayoutEffect(() => {
    if (!src) {
      if (!holdWhileLoading) {
        setVisibleSrc(null);
        setPendingSrc(null);
      }
      return;
    }

    if (visibleSrc === src) {
      setPendingSrc(null);
      return;
    }
    if (pendingSrc !== src) setPendingSrc(src);
  }, [holdWhileLoading, pendingSrc, src, visibleSrc]);

  const revealPending = useCallback(
    (image: HTMLImageElement, imageSrc: string) => {
      const reveal = () => {
        if (pendingSrcRef.current !== imageSrc) return;
        setVisibleSrc(imageSrc);
        setPendingSrc((current) => (current === imageSrc ? null : current));
      };

      if (typeof image.decode !== "function") {
        reveal();
        return;
      }
      void image.decode().then(reveal).catch(() => {
        if (image.complete && image.naturalWidth > 0) reveal();
      });
    },
    [],
  );

  return (
    <>
      {visibleSrc && (
        <img
          key={visibleSrc}
          className={className}
          style={style}
          src={visibleSrc}
          alt={alt}
          data-testid="instant-image-visible"
        />
      )}
      {pendingSrc && (
        <img
          key={pendingSrc}
          className={className}
          style={{ ...style, opacity: 0 }}
          src={pendingSrc}
          alt=""
          aria-hidden
          data-testid="instant-image-pending"
          onLoad={(event) => revealPending(event.currentTarget, pendingSrc)}
        />
      )}
    </>
  );
};

export default InstantImageSwap;
