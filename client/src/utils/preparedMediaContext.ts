import { useEffect, useState } from "react";
import { globalBroadcastRef } from "../context/controllerInfo";
import { globalHostId } from "../context/globalInfo";

export type PreparedMediaContext = {
  controllerProfileId: string;
  controllerProfileName?: string;
  outlineScope: string;
  outlineId: string | null;
  outlineName?: string;
  contextSource:
    | "local runtime selection"
    | "persisted ItemLists fallback"
    | "effective mirrored output source";
};

const PREPARED_MEDIA_CONTEXT_EVENT = "worshipsync-prepared-media-context";

type PreparedMediaContextEnvelope = {
  type: "prepared-media-context";
  hostId?: string;
  data: PreparedMediaContext;
};

export const publishPreparedMediaContext = (
  context: PreparedMediaContext,
) => {
  const envelope: PreparedMediaContextEnvelope = {
    type: "prepared-media-context",
    hostId: globalHostId,
    data: context,
  };
  window.dispatchEvent(
    new CustomEvent(PREPARED_MEDIA_CONTEXT_EVENT, { detail: context }),
  );
  globalBroadcastRef?.postMessage(envelope);
};

const sameContextOwner = (
  left: PreparedMediaContext,
  right: PreparedMediaContext,
) =>
  left.controllerProfileId === right.controllerProfileId &&
  left.outlineScope === right.outlineScope;

/**
 * Runtime-only selection handoff between Electron renderers. The persisted
 * ItemLists selection remains the reload/recovery source of truth.
 */
export const usePreparedMediaContext = (
  fallback: PreparedMediaContext,
): PreparedMediaContext => {
  const [runtimeContext, setRuntimeContext] = useState<PreparedMediaContext>();

  useEffect(() => {
    const onWindowContext = (event: Event) => {
      const context = (event as CustomEvent<PreparedMediaContext>).detail;
      if (context && sameContextOwner(context, fallback)) {
        setRuntimeContext(context);
      }
    };
    const onBroadcast = (event: MessageEvent<PreparedMediaContextEnvelope>) => {
      const message = event.data;
      if (
        message?.type === "prepared-media-context" &&
        message.hostId !== globalHostId &&
        sameContextOwner(message.data, fallback)
      ) {
        setRuntimeContext(message.data);
      }
    };
    window.addEventListener(PREPARED_MEDIA_CONTEXT_EVENT, onWindowContext);
    globalBroadcastRef?.addEventListener("message", onBroadcast);
    return () => {
      window.removeEventListener(PREPARED_MEDIA_CONTEXT_EVENT, onWindowContext);
      globalBroadcastRef?.removeEventListener("message", onBroadcast);
    };
  }, [fallback]);

  useEffect(() => {
    setRuntimeContext((current) =>
      current && sameContextOwner(current, fallback) ? current : undefined,
    );
  }, [fallback]);

  return runtimeContext ?? fallback;
};
