import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import Button from "../components/Button/Button";
import { getChatImageUrl } from "./api";
import type { ChatImageAttachment as ChatImageAttachmentType } from "./types";

type ImageVariant = "full" | "thumbnail";

const urlCache = new Map<string, { url: string; expiresAt: number }>();
const MAX_CACHED_IMAGE_URLS = 200;

const cacheImageUrl = (key: string, value: { url: string; expiresAt: number }) => {
  const currentTime = Date.now();
  for (const [cachedKey, cached] of urlCache) {
    if (cached.expiresAt <= currentTime) urlCache.delete(cachedKey);
  }
  while (urlCache.size >= MAX_CACHED_IMAGE_URLS) {
    const oldestKey = urlCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    urlCache.delete(oldestKey);
  }
  urlCache.set(key, value);
};

const loadImageUrl = async (
  churchId: string,
  messageId: string,
  variant: ImageVariant,
) => {
  const key = `${churchId}:${messageId}:${variant}`;
  const cached = urlCache.get(key);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.url;
  const result = await getChatImageUrl(churchId, messageId, variant);
  cacheImageUrl(key, {
    url: result.url,
    expiresAt: Date.parse(result.expiresAt),
  });
  return result.url;
};

const invalidateImageUrl = (
  churchId: string,
  messageId: string,
  variant: ImageVariant,
) => urlCache.delete(`${churchId}:${messageId}:${variant}`);

const ChatImageAttachment = ({
  churchId,
  messageId,
  authorName,
  attachment,
}: {
  churchId: string;
  messageId: string;
  authorName: string;
  attachment: ChatImageAttachmentType;
}) => {
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [fullUrl, setFullUrl] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [retrySequence, setRetrySequence] = useState(0);
  const triggerRef = useRef<HTMLButtonElement | HTMLAnchorElement>(null);
  const closeRef = useRef<HTMLButtonElement | HTMLAnchorElement>(null);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setError("");
    void loadImageUrl(churchId, messageId, "thumbnail")
      .then((url) => {
        if (active) setThumbnailUrl(url);
      })
      .catch(() => {
        if (active) setError("Photo unavailable. Try again.");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [churchId, messageId, retrySequence]);

  const close = useCallback(() => {
    setIsOpen(false);
    queueMicrotask(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!isOpen) return undefined;
    queueMicrotask(() => closeRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if (event.key === "Tab") {
        event.preventDefault();
        closeRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [close, isOpen]);

  const openFullImage = async () => {
    setIsOpen(true);
    if (fullUrl) return;
    try {
      setFullUrl(await loadImageUrl(churchId, messageId, "full"));
    } catch {
      setError("Photo unavailable. Try again.");
      setIsOpen(false);
    }
  };

  return (
    <>
      <div
        className="mb-1.5 flex min-h-24 w-full min-w-48 items-center justify-center overflow-hidden rounded-xl bg-gray-950/40"
        style={{
          aspectRatio: `${attachment.thumbnailWidth} / ${attachment.thumbnailHeight}`,
        }}
      >
        {thumbnailUrl ? (
          <Button
            ref={triggerRef}
            variant="none"
            padding="p-0"
            className="size-full overflow-hidden rounded-xl"
            aria-label={`Open photo from ${authorName}`}
            onClick={() => void openFullImage()}
          >
            <img
              src={thumbnailUrl}
              alt={`Shared by ${authorName}`}
              className="size-full max-h-72 object-cover"
              width={attachment.thumbnailWidth}
              height={attachment.thumbnailHeight}
              loading="lazy"
              onError={() => {
                invalidateImageUrl(churchId, messageId, "thumbnail");
                setThumbnailUrl("");
                setError("Photo unavailable. Try again.");
              }}
            />
          </Button>
        ) : isLoading ? (
          <span className="text-xs text-gray-400" role="status">
            Loading photo…
          </span>
        ) : (
          <div className="flex flex-col items-center gap-1.5 p-3 text-center">
            <span className="text-xs text-gray-300" role="alert">
              {error}
            </span>
            <Button
              variant="tertiary"
              className="text-xs max-md:!min-h-9"
              onClick={() => setRetrySequence((current) => current + 1)}
            >
              Try again
            </Button>
          </div>
        )}
      </div>

      {isOpen
        ? createPortal(
            <div
              className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/90 p-4"
              role="dialog"
              aria-modal="true"
              aria-label={`Photo from ${authorName}`}
            >
              <Button
                ref={closeRef}
                variant="none"
                svg={X}
                color="#ffffff"
                iconSize="lg"
                className="absolute right-4 top-4 rounded-full bg-black/60 p-2 max-md:!min-h-11 max-md:!min-w-11"
                aria-label="Close photo"
                onClick={close}
              />
              {fullUrl ? (
                <img
                  src={fullUrl}
                  alt={`Shared by ${authorName}`}
                  className="max-h-full max-w-full rounded-lg object-contain"
                  width={attachment.width}
                  height={attachment.height}
                  onError={() => {
                    invalidateImageUrl(churchId, messageId, "full");
                    setFullUrl("");
                    setError("Photo unavailable. Try again.");
                    setIsOpen(false);
                  }}
                />
              ) : (
                <span className="text-sm text-gray-200" role="status">
                  Loading photo…
                </span>
              )}
            </div>,
            document.body,
          )
        : null}
    </>
  );
};

export default ChatImageAttachment;
