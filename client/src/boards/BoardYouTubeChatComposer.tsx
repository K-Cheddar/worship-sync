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
};

export const BoardYouTubeChatComposer = ({
  churchId,
  accountLabel = "",
}: BoardYouTubeChatComposerProps) => {
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState("");
  const [liveVideoUrl, setLiveVideoUrl] = useState("");
  const [sendStatus, setSendStatus] = useState<SendStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const successTimerRef = useRef<number | null>(null);

  const isSending = sendStatus === "sending";
  const isSuccess = sendStatus === "success";
  const fieldsDisabled = isSending || isSuccess;

  useEffect(() => {
    if (!expanded || fieldsDisabled) return;
    textareaRef.current?.focus();
  }, [expanded, fieldsDisabled]);

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
    setExpanded(false);
    setSendStatus("idle");
    setErrorMessage("");
  }, [isSending]);

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
        textareaRef.current?.focus();
      }, SUCCESS_FLASH_MS);
    } catch (nextError) {
      setSendStatus("error");
      setErrorMessage(
        nextError instanceof Error
          ? nextError.message
          : "Could not post to YouTube live chat.",
      );
    }
  }, [churchId, isSending, isSuccess, liveVideoUrl, text]);

  if (!expanded) {
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
        "rounded-xl border bg-gray-900/95 p-3 shadow-[0_-12px_24px_-12px_rgba(0,0,0,0.45)] backdrop-blur-sm transition-[border-color,box-shadow,background-color] duration-300",
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
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-gray-200">
          Post to YouTube live chat
          {accountLabel ? ` · ${accountLabel}` : ""}
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
      {isSuccess ? (
        <div
          className="flex min-h-[4.5rem] items-center justify-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-950/50 px-3 py-2 text-sm font-medium text-emerald-100"
          role="status"
          aria-live="polite"
          aria-label="Sent to YouTube live chat"
        >
          <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
          Sent to YouTube live chat
        </div>
      ) : (
        <div className="space-y-2">
          <TextArea
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
            rows={2}
            maxLength={YOUTUBE_LIVE_CHAT_MAX_LENGTH}
            placeholder="Appears as the connected YouTube channel…"
            disabled={fieldsDisabled}
            textareaClassName={cn(
              "min-h-[4.5rem] resize-y rounded-lg border-gray-600 bg-gray-900/80 px-3 py-2 text-sm text-gray-100 shadow-none placeholder:text-gray-500",
              "focus-visible:border-cyan-500/40 focus-visible:ring-1 focus-visible:ring-cyan-500/30",
              isSending && "opacity-70",
            )}
          />
          <Input
            type="url"
            label="Live video URL (optional)"
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
            helperText="Leave blank to detect the active stream automatically."
            autoComplete="off"
            disabled={fieldsDisabled}
            inputClassName="border-gray-600 bg-gray-900/80 text-gray-100 placeholder:text-gray-500"
          />
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p
          className={cn(
            "text-xs",
            sendStatus === "error" ? "text-amber-200" : "text-gray-400",
          )}
          role={sendStatus === "error" ? "alert" : undefined}
        >
          {sendStatus === "error" && errorMessage}
          {sendStatus === "idle" &&
            `${text.length}/${YOUTUBE_LIVE_CHAT_MAX_LENGTH} · Enter to send`}
          {isSending && "Sending…"}
        </p>
        {!isSuccess ? (
          <Button
            variant="cta"
            svg={Send}
            isLoading={isSending}
            onClick={() => void handlePost()}
            disabled={fieldsDisabled || !text.trim() || !churchId}
          >
            {isSending ? "Sending…" : "Send to YouTube"}
          </Button>
        ) : null}
      </div>
    </div>
  );
};
