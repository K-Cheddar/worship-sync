import { useContext, useEffect, useMemo } from "react";
import { useSelector } from "../../hooks";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import { useActiveControllerProfile } from "../../context/activeController";
import { selectDisplayOutputs } from "../../store/displayOutputsSlice";
import { selectControllerProfiles } from "../../store/controllerProfilesSlice";
import { selectOutputSlots } from "../../store/presentationSlice";
import {
  getControllerOutputs,
  getOwningControllerProfile,
  type ControllerProfile,
} from "../../utils/controllerProfiles";
import { resolveOutlineForScope } from "../../utils/outlineScope";
import { useServiceVideoCandidates } from "../../hooks/useServiceVideoCandidates";
import { usePublishMediaPreparationManifest } from "../../hooks/useMediaPreparationManifest";
import ControllerLocalMediaPreparationHost from "./ControllerLocalMediaPreparationHost";
import type { DisplayOutput } from "../../utils/displayOutputs";
import type { ElectronMediaDiscovery } from "../../utils/electronMediaSurfaceDiagnostics";
import {
  publishPreparedMediaContext,
  subscribePreparedMediaContextRequests,
  type PreparedMediaContext,
} from "../../utils/preparedMediaContext";

const prefetchPosterUrls = (posterUrls: string[]) => {
  if (window.electronAPI || posterUrls.length === 0) return undefined;
  const probes = posterUrls.map((url) => {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    return image;
  });
  return () => {
    probes.forEach((image) => {
      image.onload = null;
      image.onerror = null;
      image.src = "";
    });
  };
};

type SourceGroup = {
  identity: string;
  controllerProfile: ControllerProfile;
  outlineId: string | null;
  outlineName?: string;
  destinations: DisplayOutput[];
};

const getFallbackSourceId = (output: DisplayOutput) => {
  if (output.type === "monitor") return "monitor";
  if (output.type === "stream") return "stream";
  return "projector";
};

const SourceGroupPublisher = ({
  group,
  isLocalPreparationSource,
  currentItemId,
}: {
  group: SourceGroup;
  isLocalPreparationSource: boolean;
  currentItemId?: string;
}) => {
  const { controllerProfile, outlineId, outlineName, destinations } = group;
  const { db } = useContext(ControllerInfoContext) || {};
  useEffect(() => {
    publishPreparedMediaContext({
      controllerProfileId: controllerProfile.id,
      controllerProfileName: controllerProfile.name,
      outlineScope: controllerProfile.outlineScope,
      outlineId,
      outlineName,
      contextSource: "local runtime selection",
    });
  }, [
    controllerProfile.id,
    controllerProfile.name,
    controllerProfile.outlineScope,
    db,
    outlineId,
    outlineName,
  ]);

  const discoveryResult = useServiceVideoCandidates({
    enabled: true,
    cacheMedia: false,
    // Discovery belongs to a controller source, not an arbitrary destination.
    outlineId,
    renderer: "projector",
    controllerProfileId: controllerProfile.id,
    controllerProfileName: controllerProfile.name,
    outlineScope: controllerProfile.outlineScope,
    outlineName,
  });

  useEffect(
    () => prefetchPosterUrls(discoveryResult.posterUrls),
    [discoveryResult.posterUrls],
  );

  return (
    <>
      {isLocalPreparationSource && (
        <ControllerLocalMediaPreparationHost
          currentItemId={currentItemId}
          discoveryResult={discoveryResult}
        />
      )}
      {destinations.map((output) => (
        <DestinationManifestPublisher
          key={output.id}
          outputId={output.id}
          discovery={discoveryResult.discovery}
        />
      ))}
    </>
  );
};

const DestinationManifestPublisher = ({
  outputId,
  discovery,
}: {
  outputId: string;
  discovery: ElectronMediaDiscovery;
}) => {
  usePublishMediaPreparationManifest({
    enabled: true,
    discovery,
    outputId,
  });
  return null;
};

/**
 * Controller-owned preparation lifecycle. This stays mounted with the
 * controller route, so publication does not depend on an output window,
 * preview role, editor, selected slide, or Electron being available.
 */
const ControllerMediaPreparationPublisher = ({
  currentItemId,
}: {
  currentItemId?: string;
}) => {
  const controllerProfile = useActiveControllerProfile();
  const displayOutputs = useSelector(selectDisplayOutputs);
  const controllerProfiles = useSelector(selectControllerProfiles);
  const outputSlots = useSelector(selectOutputSlots);
  const outlines = useSelector(
    (state) => state.undoable?.present?.itemLists?.currentLists ?? [],
  );
  const selectedIdByScope = useSelector(
    (state) => state.undoable?.present?.itemLists?.selectedIdByScope ?? {},
  );
  const { sessionKind } = useContext(GlobalInfoContext) || {};
  const { db } = useContext(ControllerInfoContext) || {};

  const groups = useMemo(() => {
    const outputs = getControllerOutputs(controllerProfile, displayOutputs);
    const grouped = new Map<string, SourceGroup>();

    outputs.forEach((output) => {
      const ownSlot = outputSlots[output.id];
      const followedSlot = ownSlot?.followingOutputId
        ? outputSlots[ownSlot.followingOutputId]
        : undefined;
      const resolvedSlot =
        followedSlot &&
        followedSlot.id !== ownSlot?.id &&
        followedSlot.type === ownSlot?.type
          ? followedSlot
          : ownSlot;
      const sourceProfile =
        getOwningControllerProfile(
          controllerProfiles,
          resolvedSlot?.id ?? getFallbackSourceId(output),
        ) ??
        controllerProfile;
      const sourceOutline = resolveOutlineForScope(
        outlines,
        sourceProfile.outlineScope,
        selectedIdByScope[sourceProfile.outlineScope],
      );
      const outlineId = sourceOutline?._id ?? null;
      const identity = JSON.stringify([
        sourceProfile.id,
        sourceProfile.outlineScope,
        outlineId,
      ]);
      const existing = grouped.get(identity);
      if (existing) {
        existing.destinations.push(output);
      } else {
        grouped.set(identity, {
          identity,
          controllerProfile: sourceProfile,
          outlineId,
          outlineName: sourceOutline?.name,
          destinations: [output],
        });
      }
    });

    // Local editor preparation follows this controller's own outline even
    // when all of its displays mirror another controller or no display is
    // currently assigned. If it is also a display source, reuse that group.
    if (controllerProfile.enabled) {
      const activeOutline = resolveOutlineForScope(
        outlines,
        controllerProfile.outlineScope,
        selectedIdByScope[controllerProfile.outlineScope],
      );
      const activeIdentity = JSON.stringify([
        controllerProfile.id,
        controllerProfile.outlineScope,
        activeOutline?._id ?? null,
      ]);
      if (!grouped.has(activeIdentity)) {
        grouped.set(activeIdentity, {
          identity: activeIdentity,
          controllerProfile,
          outlineId: activeOutline?._id ?? null,
          outlineName: activeOutline?.name,
          destinations: [],
        });
      }
    }

    return [...grouped.values()];
  }, [
    controllerProfile,
    controllerProfiles,
    displayOutputs,
    outputSlots,
    outlines,
    selectedIdByScope,
  ]);

  useEffect(() => {
    const contexts: PreparedMediaContext[] =
      sessionKind === "display"
        ? []
        : groups.map((group) => ({
            controllerProfileId: group.controllerProfile.id,
            controllerProfileName: group.controllerProfile.name,
            outlineScope: group.controllerProfile.outlineScope,
            outlineId: group.outlineId,
            outlineName: group.outlineName,
            contextSource: "local runtime selection",
          }));
    return subscribePreparedMediaContextRequests(() => contexts);
  }, [db, groups, sessionKind]);

  if (sessionKind === "display" || groups.length === 0) return null;

  return (
    <>
      {groups.map((group) => (
        <SourceGroupPublisher
          key={group.identity}
          group={group}
          isLocalPreparationSource={
            group.controllerProfile.id === controllerProfile.id
          }
          currentItemId={currentItemId}
        />
      ))}
    </>
  );
};

export default ControllerMediaPreparationPublisher;
