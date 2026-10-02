import { useEffect, useRef, useState } from "react";
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

type PreparedMediaContextRequest = {
  type: "prepared-media-context-request";
  hostId?: string;
  controllerProfileId: string;
  outlineScope: string;
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

/** Ask the live controller renderer for its current selection on mount. */
export const requestPreparedMediaContext = (
  owner: Pick<PreparedMediaContext, "controllerProfileId" | "outlineScope">,
) => {
  const request: PreparedMediaContextRequest = {
    type: "prepared-media-context-request",
    hostId: globalHostId,
    controllerProfileId: owner.controllerProfileId,
    outlineScope: owner.outlineScope,
  };
  globalBroadcastRef?.postMessage(request);
};

/** Reply only to outputs asking for this exact controller source. */
export const subscribePreparedMediaContextRequests = (
  getContexts: () => PreparedMediaContext[],
) => {
  const channel = globalBroadcastRef;
  if (!channel) return () => undefined;

  const onRequest = (event: MessageEvent<PreparedMediaContextRequest>) => {
    const request = event.data;
    if (
      request?.type !== "prepared-media-context-request" ||
      request.hostId === globalHostId
    ) {
      return;
    }
    const context = getContexts().find(
      (candidate) =>
        candidate.controllerProfileId === request.controllerProfileId &&
        candidate.outlineScope === request.outlineScope,
    );
    if (context) {
      channel.postMessage({
        type: "prepared-media-context",
        hostId: globalHostId,
        data: context,
      } satisfies PreparedMediaContextEnvelope);
    }
  };
  channel.addEventListener("message", onRequest as EventListener);
  return () => channel.removeEventListener("message", onRequest as EventListener);
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
  subscriptionKey?: unknown,
): PreparedMediaContext => {
  const [runtimeContext, setRuntimeContext] = useState<PreparedMediaContext>();
  const previousSubscriptionKeyRef = useRef(subscriptionKey);

  useEffect(() => {
    const channel = globalBroadcastRef;
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
    channel?.addEventListener("message", onBroadcast);
    requestPreparedMediaContext(fallback);
    return () => {
      window.removeEventListener(PREPARED_MEDIA_CONTEXT_EVENT, onWindowContext);
      channel?.removeEventListener("message", onBroadcast);
    };
  }, [fallback, subscriptionKey]);

  useEffect(() => {
    const subscriptionChanged = previousSubscriptionKeyRef.current !== subscriptionKey;
    previousSubscriptionKeyRef.current = subscriptionKey;
    if (subscriptionChanged) {
      setRuntimeContext(fallback);
      return;
    }
    setRuntimeContext((current) =>
      current && sameContextOwner(current, fallback) ? current : undefined,
    );
  }, [fallback, subscriptionKey]);

  return runtimeContext ?? fallback;
};
