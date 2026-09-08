import { useEffect, useMemo, useState } from "react";
import type { LocalImageAssetReference } from "../types";
import { getOrCreateDeviceId } from "../utils/authStorage";
import {
  normalizeLocalImageReference,
  subscribeLocalImageChanges,
} from "../utils/localImageAssets";
import {
  acquireLocalImageThumbnailUrl,
  acquireLocalImageUrl,
  peekLocalImageThumbnailUrl,
  peekLocalImageUrl,
} from "../utils/localImageUrlCache";

export type LocalImageResolution = {
  isLocalImage: boolean;
  isOwner: boolean;
  status: "not-local" | "loading" | "ready" | "unavailable";
  url?: string;
};

type KeyedLocalImageResolution = {
  key: string;
  value: LocalImageResolution;
};

type LocalImageUrlPurpose = "display" | "thumbnail";

/** Resolve a saved local image independently in every preview/display window. */
export const useLocalImageUrl = (
  value: LocalImageAssetReference | undefined,
  purpose: LocalImageUrlPurpose = "display",
): LocalImageResolution => {
  const cloudMediaId = value?.cloudMediaId;
  const cloudUrl = value?.cloudUrl;
  const contentRevision = value?.contentRevision;
  const contentType = value?.contentType;
  const fileName = value?.fileName;
  const id = value?.id;
  const ownerDeviceId = value?.ownerDeviceId;
  const ownerLabel = value?.ownerLabel;
  const storagePolicy = value?.storagePolicy;
  const reference = useMemo(
    () =>
      normalizeLocalImageReference(
        id && ownerDeviceId
          ? {
              id,
              contentRevision,
              ownerDeviceId,
              ownerLabel: ownerLabel ?? "",
              fileName: fileName ?? "",
              contentType: contentType ?? "",
              storagePolicy: storagePolicy ?? "local-only",
              cloudUrl,
              cloudMediaId,
            }
          : undefined,
      ),
    [
      cloudMediaId,
      cloudUrl,
      contentRevision,
      contentType,
      fileName,
      id,
      ownerDeviceId,
      ownerLabel,
      storagePolicy,
    ],
  );
  const isOwner = Boolean(
    reference && reference.ownerDeviceId === getOrCreateDeviceId(),
  );
  const peekLocalUrl =
    purpose === "thumbnail" ? peekLocalImageThumbnailUrl : peekLocalImageUrl;
  const warmLocalUrl =
    reference && isOwner
      ? peekLocalUrl(reference.id, reference.contentRevision)
      : undefined;
  const referenceKey = reference
    ? JSON.stringify([
        purpose,
        reference.id,
        reference.ownerDeviceId,
        reference.contentRevision ?? "legacy",
        // Cloud attachment changes remote availability, not the owner's local
        // bytes. Keep the live local URL stable while that metadata syncs.
        isOwner ? "" : (reference.cloudUrl ?? ""),
      ])
    : "";
  const [assetRevision, setAssetRevision] = useState(0);
  const getImmediateResolution = (): LocalImageResolution => {
    if (!reference) {
      return { isLocalImage: false, isOwner: false, status: "not-local" };
    }
    if (isOwner) {
      return {
        isLocalImage: true,
        isOwner: true,
        status: warmLocalUrl ? "ready" : "loading",
        url: warmLocalUrl,
      };
    }
    return {
      isLocalImage: true,
      isOwner: false,
      status: reference.cloudUrl ? "ready" : "unavailable",
      url: reference.cloudUrl,
    };
  };
  const [state, setState] = useState<KeyedLocalImageResolution>(() => ({
    key: referenceKey,
    value: getImmediateResolution(),
  }));

  useEffect(() => {
    if (!reference) return;
    return subscribeLocalImageChanges((assetId) => {
      if (assetId === reference.id) setAssetRevision((value) => value + 1);
    });
  }, [reference]);

  useEffect(() => {
    if (!reference) {
      setState({
        key: "",
        value: { isLocalImage: false, isOwner: false, status: "not-local" },
      });
      return;
    }
    if (!isOwner) {
      setState({
        key: referenceKey,
        value: {
          isLocalImage: true,
          isOwner: false,
          status: reference.cloudUrl ? "ready" : "unavailable",
          url: reference.cloudUrl,
        },
      });
      return;
    }

    let active = true;
    setState((current) =>
      current.key === referenceKey && current.value.status === "ready"
        ? current
        : {
            key: referenceKey,
            value: { isLocalImage: true, isOwner: true, status: "loading" },
          },
    );
    const lease =
      purpose === "thumbnail"
        ? acquireLocalImageThumbnailUrl(reference.id, reference.contentRevision)
        : acquireLocalImageUrl(reference.id, reference.contentRevision);
    void lease.url
      .then((localUrl) => {
        if (!active) return;
        if (localUrl) {
          setState({
            key: referenceKey,
            value: {
              isLocalImage: true,
              isOwner,
              status: "ready",
              url: localUrl,
            },
          });
          return;
        }
        setState({
          key: referenceKey,
          value: {
            isLocalImage: true,
            isOwner,
            status: reference.cloudUrl ? "ready" : "unavailable",
            url: reference.cloudUrl,
          },
        });
      })
      .catch(() => {
        if (!active) return;
        setState({
          key: referenceKey,
          value: {
            isLocalImage: true,
            isOwner,
            status: reference.cloudUrl ? "ready" : "unavailable",
            url: reference.cloudUrl,
          },
        });
      });

    return () => {
      active = false;
      lease.release();
    };
  }, [assetRevision, isOwner, purpose, reference, referenceKey]);

  return state.key === referenceKey ? state.value : getImmediateResolution();
};
