import { useCallback, useEffect, useRef, useState } from "react";
import cn from "classnames";
import { Cast, Check, Send, X } from "lucide-react";
import Button from "../components/Button/Button";
import Input from "../components/Input/Input";
import TextArea from "../components/TextArea/TextArea";
import { sendYouTubeLiveChatMessage } from "./api";

export const YOUTUBE_LIVE_CHAT_MAX_LENGTH = 200;
const SUCCESS_FLASH_MS = 1400;

type SendStatus = "idle" | "sending" | "success" | "error";

export type BoardYouTubeChatComposerProps = {
  churchId: string;
  accountLabel?: string;
  dockMode?: boolean;
  dockOpen?: boolean;
  onDockClose?: () => void;
};

export const BoardYouTubeChatComposer = ({
  churchId,
  accountLabel = "",
  dockMode = false,
  dockOpen = false,
  onDockClose,
}: BoardYouTubeChatComposerProps) => {
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState("");
  const [liveVideoUrl, setLiveVideoUrl] = useState("");
  const [showLiveVideoUrl, setShowLiveVideoUrl] = useState(false);
  const [sendStatus, setSendStatus] = useState<SendStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const successTimerRef = useRef<number | null>(null);

  const isSending = sendStatus === "sending";
  const isSuccess = sendStatus === "success";
  const fieldsDisabled = isSending || isSuccess;

  useEffect(() => {
    if (!(dockMode ? dockOpen : expanded) || fieldsDisabled) return;
    textareaRef.current?.focus();
  }, [expanded, fieldsDisabled, dockMode, dockOpen]);

  useEffect(
    () => () => {
      if (successTimerRef.current !== null) {
        window.clearTimeout(successTimerRef.current);
      }
    },
    [],
  );

  const collapse = useCallback(() => {
    if (isSending) return;
    if (successTimerRef.current !== null) {
      window.clearTimeout(successTimerRef.current);
      successTimerRef.current = null;
    }
    if (dockMode) onDockClose?.();
    else setExpanded(false);
    setSendStatus("idle");
    setErrorMessage("");
  }, [isSending, dockMode, onDockClose]);

  const handlePost = useCallback(async () => {
    const trimmed = text.trim();
    const trimmedLiveVideoUrl = liveVideoUrl.trim();
    if (!trimmed || !churchId || isSending || isSuccess) return;
    if (trimmed.length > YOUTUBE_LIVE_CHAT_MAX_LENGTH) {
      setSendStatus("error");
      setErrorMessage(
        `Message is too long (max ${YOUTUBE_LIVE_CHAT_MAX_LENGTH} characters).`,
      );
      return;
    }

    setSendStatus("sending");
    setErrorMessage("");
    try {
      await sendYouTubeLiveChatMessage(churchId, {
        messageText: trimmed,
        ...(trimmedLiveVideoUrl ? { videoUrl: trimmedLiveVideoUrl } : {}),
      });
      setText("");
      setSendStatus("success");
      if (successTimerRef.current !== null) {
        window.clearTimeout(successTimerRef.current);
      }
      successTimerRef.current = window.setTimeout(() => {
        setSendStatus("idle");
        successTimerRef.current = null;
        if (dockMode) onDockClose?.();
        else textareaRef.current?.focus();
      }, SUCCESS_FLASH_MS);
    } catch (nextError) {
      setSendStatus("error");
      setErrorMessage(
        nextError instanceof Error
          ? nextError.message
          : "Could not post to YouTube live chat.",
      );
    }
  }, [churchId, isSending, isSuccess, liveVideoUrl, text, dockMode, onDockClose]);

  const isExpanded = dockMode ? dockOpen : expanded;

  if (!dockMode && !isExpanded) {
    return (
      <Button
        variant="tertiary"
        svg={Cast}
        className="w-full justify-start rounded-xl border border-gray-600 bg-gray-900/95 px-3 py-2.5 text-left shadow-[0_-12px_24px_-12px_rgba(0,0,0,0.45)] backdrop-blur-sm"
        onClick={() => setExpanded(true)}
        disabled={!churchId}
      >
        {text.trim() || liveVideoUrl.trim()
          ? "Continue YouTube draft…"
          : "Post to YouTube live chat"}
      </Button>
    );
  }

  return (
    <div
      className={cn(
        "rounded-lg border bg-gray-900/95 p-2 shadow-none transition-colors duration-200 motion-reduce:transition-none",
        isSuccess &&
        "border-emerald-500/70 bg-emerald-950/40 shadow-[0_0_0_1px_rgba(16,185,129,0.25)]",
        isSending && "border-cyan-500/50",
        sendStatus === "error" && "border-amber-500/60",
        sendStatus === "idle" && "border-gray-600",
      )}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          collapse();
        }
      }}
    >
      {!dockMode ? (
        <div className="mb-1 flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-gray-200">
            Post to YouTube live chat{accountLabel ? ` · ${accountLabel}` : ""}
          </p>
          <Button
            variant="tertiary"
            svg={X}
            padding="p-1.5"
            className="min-h-0!"
            aria-label="Close YouTube composer"
            onClick={collapse}
            disabled={isSending}
          />
        </div>
      ) : null}
      <div className="flex min-w-0 items-end gap-1.5">
        {isSuccess ? (
          <div
            className="flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-950/50 px-3 py-2 text-sm font-medium text-emerald-100"
            role="status"
            aria-live="polite"
            aria-label="Sent to YouTube live chat"
          >
            <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
            Sent to YouTube live chat
          </div>
        ) : (
          <TextArea
            className="min-w-0 flex-1"
            ref={textareaRef}
            label="YouTube live chat message"
            hideLabel
            value={text}
            onChange={(value) => {
              setText(String(value || "").replace(/\r?\n/g, " "));
              if (sendStatus === "error") {
                setSendStatus("idle");
                setErrorMessage("");
              }
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              if (event.nativeEvent.isComposing) return;
              void handlePost();
            }}
            rows={1}
            maxLength={YOUTUBE_LIVE_CHAT_MAX_LENGTH}
            placeholder="Write a message as the connected channel…"
            disabled={fieldsDisabled}
            autoResize
            textareaClassName={cn(
              "min-h-9 max-h-28 min-w-0 flex-1 resize-none overflow-y-auto rounded-lg border-gray-600 bg-gray-900/80 px-3 py-2 text-sm text-gray-100 shadow-none placeholder:text-gray-500",
              "focus-visible:border-cyan-500/40 focus-visible:ring-1 focus-visible:ring-cyan-500/30",
              isSending && "opacity-70",
            )}
          />
        )}
        {!isSuccess ? (
          <div className="flex shrink-0 flex-col items-center gap-1">
            <span className="whitespace-nowrap text-[10px] leading-3 text-gray-400">
              {text.length}/{YOUTUBE_LIVE_CHAT_MAX_LENGTH}
            </span>
            <Button
              variant="cta"
              svg={Send}
              iconSize="sm"
              aria-label={isSending ? "Sending to YouTube" : "Send to YouTube"}
              style={{ minHeight: 36 }}
              className="relative min-h-9 max-md:min-h-[36px] shrink-0 px-2 py-1 text-xs after:absolute after:-inset-y-1 after:content-['']"
              isLoading={isSending}
              onClick={() => void handlePost()}
              disabled={fieldsDisabled || !text.trim() || !churchId}
            >
              {isSending ? "Sending…" : "Send"}
            </Button>
          </div>
        ) : null}
      </div>
      {!isSuccess ? (
        <div className="mt-1 flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[11px] leading-4">
          <p className={cn("min-w-0", sendStatus === "error" ? "text-amber-200" : "text-gray-400")} role={sendStatus === "error" ? "alert" : undefined}>
            {sendStatus === "error"
              ? errorMessage
              : [accountLabel, "Enter to send"].filter(Boolean).join(" · ")}
          </p>
          {!showLiveVideoUrl && !liveVideoUrl && sendStatus === "error" && errorMessage.startsWith("No active YouTube live chat was found for the connected channel") ? (
            <Button
              variant="tertiary"
              className="min-h-0! shrink-0 px-1 py-0 text-[11px] underline"
              onClick={() => setShowLiveVideoUrl(true)}
            >
              Choose live stream
            </Button>
          ) : null}
        </div>
      ) : null}
      {showLiveVideoUrl ? (
        <div className="mt-2">
          <Input
            type="url"
            label="Live stream URL or video ID (optional)"
            labelStyle="compactLight"
            value={liveVideoUrl}
            onChange={(value) => {
              setLiveVideoUrl(String(value || ""));
              if (sendStatus === "error") {
                setSendStatus("idle");
                setErrorMessage("");
              }
            }}
            placeholder="https://youtube.com/watch?v=…"
            helperText="Use this only when automatic stream detection cannot find the live chat."
            autoComplete="off"
            disabled={fieldsDisabled}
            inputClassName="border-gray-600 bg-gray-900/80 text-gray-100 placeholder:text-gray-500"
          />
        </div>
      ) : null}
    </div>
  );
};
