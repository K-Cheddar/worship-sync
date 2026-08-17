import { useEffect, useMemo, useState } from "react";
import type { LocalVideoFileReference } from "../types";
import { getOrCreateDeviceId } from "../utils/authStorage";
import {
  normalizeLocalVideoFileReference,
  subscribeLocalVideoFileChanges,
} from "../utils/localVideoFileAssets";
import {
  acquireLocalVideoFileThumbnailUrl,
  acquireLocalVideoFileUrl,
  peekLocalVideoFileThumbnailUrl,
  peekLocalVideoFileUrl,
} from "../utils/localVideoFileUrlCache";

export type LocalVideoFileResolution = {
  isLocalVideoFile: boolean;
  isOwner: boolean;
  status: "not-local" | "loading" | "ready" | "unavailable";
  url?: string;
};

type KeyedLocalVideoFileResolution = {
  key: string;
  value: LocalVideoFileResolution;
};

type LocalVideoFileUrlPurpose = "display" | "thumbnail";

export const useLocalVideoFileUrl = (
  value: LocalVideoFileReference | undefined,
  purpose: LocalVideoFileUrlPurpose = "display",
): LocalVideoFileResolution => {
  const cloudUrl = value?.cloudUrl;
  const contentRevision = value?.contentRevision;
  const contentType = value?.contentType;
  const fileName = value?.fileName;
  const id = value?.id;
  const ownerDeviceId = value?.ownerDeviceId;
  const ownerLabel = value?.ownerLabel;
  const storagePolicy = value?.storagePolicy;
  const audioEnabled = value?.audioEnabled;
  const cloudMediaId = value?.cloudMediaId;
  const reference = useMemo(
    () =>
      normalizeLocalVideoFileReference(
        id && ownerDeviceId
          ? {
              id,
              contentRevision,
              ownerDeviceId,
              ownerLabel: ownerLabel ?? "",
              fileName: fileName ?? "",
              contentType: contentType ?? "",
              storagePolicy: storagePolicy ?? "local-only",
              audioEnabled,
              cloudUrl,
              cloudMediaId,
            }
          : undefined,
      ),
    [
      audioEnabled,
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
    purpose === "thumbnail"
      ? peekLocalVideoFileThumbnailUrl
      : peekLocalVideoFileUrl;
  const warmUrl =
    reference && isOwner
      ? peekLocalUrl(reference.id, reference.contentRevision)
      : undefined;
  const referenceKey = reference
    ? JSON.stringify([
        purpose,
        reference.id,
        reference.ownerDeviceId,
        reference.contentRevision ?? "legacy",
        isOwner || purpose === "thumbnail" ? "" : (reference.cloudUrl ?? ""),
      ])
    : "";
  const [assetRevision, setAssetRevision] = useState(0);
  const getImmediateResolution = (): LocalVideoFileResolution => {
    if (!reference) {
      return { isLocalVideoFile: false, isOwner: false, status: "not-local" };
    }
    if (isOwner) {
      return {
        isLocalVideoFile: true,
        isOwner: true,
        status: warmUrl ? "ready" : "loading",
        url: warmUrl,
      };
    }
    if (purpose === "thumbnail") {
      return {
        isLocalVideoFile: true,
        isOwner: false,
        status: "unavailable",
      };
    }
    return {
      isLocalVideoFile: true,
      isOwner: false,
      status: reference.cloudUrl ? "ready" : "unavailable",
      url: reference.cloudUrl,
    };
  };
  const [state, setState] = useState<KeyedLocalVideoFileResolution>(() => ({
    key: referenceKey,
    value: getImmediateResolution(),
  }));

  useEffect(() => {
    if (!reference) return;
    return subscribeLocalVideoFileChanges((assetId) => {
      if (assetId === reference.id) setAssetRevision((current) => current + 1);
    });
  }, [reference]);

  useEffect(() => {
    if (!reference) {
      setState({
        key: "",
        value: { isLocalVideoFile: false, isOwner: false, status: "not-local" },
      });
      return;
    }
    if (!isOwner) {
      if (purpose === "thumbnail") {
        setState({
          key: referenceKey,
          value: {
            isLocalVideoFile: true,
            isOwner: false,
            status: "unavailable",
          },
        });
        return;
      }
      setState({
        key: referenceKey,
        value: {
          isLocalVideoFile: true,
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
            value: {
              isLocalVideoFile: true,
              isOwner: true,
              status: "loading",
            },
          },
    );
    const lease =
      purpose === "thumbnail"
        ? acquireLocalVideoFileThumbnailUrl(
            reference.id,
            reference.contentRevision,
          )
        : acquireLocalVideoFileUrl(reference.id, reference.contentRevision);
    void lease.url.then((url) => {
      if (!active) return;
      setState({
        key: referenceKey,
        value: {
          isLocalVideoFile: true,
          isOwner: true,
          status: url ? "ready" : "unavailable",
          url,
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
