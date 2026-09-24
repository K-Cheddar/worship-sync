import { useContext, useEffect, useMemo } from "react";
import { useSelector } from "../../hooks";
import { GlobalInfoContext } from "../../context/globalInfo";
import { useActiveControllerProfile } from "../../context/activeController";
import { selectDisplayOutputs } from "../../store/displayOutputsSlice";
import { selectControllerProfiles } from "../../store/controllerProfilesSlice";
import { selectResolvedOutputSlot } from "../../store/presentationSlice";
import {
  getControllerOutputs,
  getOwningControllerProfile,
} from "../../utils/controllerProfiles";
import { resolveOutlineForScope } from "../../utils/outlineScope";
import { useServiceVideoCandidates } from "../../hooks/useServiceVideoCandidates";
import { usePublishMediaPreparationManifest } from "../../hooks/useMediaPreparationManifest";
import type { DisplayOutput } from "../../utils/displayOutputs";
import type { ItemList } from "../../types";

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

const OutputManifestPublisher = ({
  output,
  controllerProfile,
  outlineId,
  outlineName,
  isMirrored,
}: {
  output: DisplayOutput;
  controllerProfile: ReturnType<typeof useActiveControllerProfile>;
  outlineId: string | null;
  outlineName?: string;
  isMirrored: boolean;
}) => {
  const discoveryResult = useServiceVideoCandidates({
    enabled: true,
    // The controller publisher discovers portable media but does not own an
    // audience renderer. Output windows keep ownership of local warming.
    cacheMedia: false,
    outputId: output.id,
    outlineId,
    renderer: "projector",
    controllerProfileId: controllerProfile.id,
    controllerProfileName: controllerProfile.name,
    outlineScope: controllerProfile.outlineScope,
    outlineName,
    contextSource: isMirrored
      ? "effective mirrored output source"
      : "local runtime selection",
  });

  useEffect(
    () => prefetchPosterUrls(discoveryResult.posterUrls),
    [discoveryResult.posterUrls],
  );

  usePublishMediaPreparationManifest({
    enabled: true,
    discovery: discoveryResult.discovery,
    outputId: output.id,
  });

  return null;
};

/**
 * Controller-owned preparation lifecycle. This stays mounted with the
 * controller route, so publication does not depend on an output window,
 * preview role, editor, selected slide, or Electron being available.
 */
const ControllerMediaPreparationPublisher = () => {
  const controllerProfile = useActiveControllerProfile();
  const displayOutputs = useSelector(selectDisplayOutputs);
  const controllerProfiles = useSelector(selectControllerProfiles);
  const outlines = useSelector(
    (state) => state.undoable?.present?.itemLists?.currentLists ?? [],
  );
  const selectedIdByScope = useSelector(
    (state) => state.undoable?.present?.itemLists?.selectedIdByScope ?? {},
  );
  const { sessionKind } = useContext(GlobalInfoContext) || {};
  const outputs = useMemo(
    () => getControllerOutputs(controllerProfile, displayOutputs),
    [controllerProfile, displayOutputs],
  );

  if (sessionKind === "display" || outputs.length === 0) return null;

  return (
    <>
      {outputs.map((output) => (
        <OutputManifestPublisherForResolvedSource
          key={output.id}
          output={output}
          activeControllerProfile={controllerProfile}
          controllerProfiles={controllerProfiles}
          outlines={outlines}
          selectedIdByScope={selectedIdByScope}
        />
      ))}
    </>
  );
};

const OutputManifestPublisherForResolvedSource = ({
  output,
  activeControllerProfile,
  controllerProfiles,
  outlines,
  selectedIdByScope,
}: {
  output: DisplayOutput;
  activeControllerProfile: ReturnType<typeof useActiveControllerProfile>;
  controllerProfiles: ReturnType<typeof selectControllerProfiles>;
  outlines: ItemList[];
  selectedIdByScope: Record<string, string>;
}) => {
  const resolvedSource = useSelector((state) =>
    selectResolvedOutputSlot(
      state,
      output.id,
      output.type === "monitor" || output.type === "stream"
        ? output.type
        : "projector",
    ),
  );
  const sourceProfile =
    getOwningControllerProfile(controllerProfiles, resolvedSource.id) ??
    activeControllerProfile;
  const sourceOutline = resolveOutlineForScope(
    outlines,
    sourceProfile.outlineScope,
    selectedIdByScope[sourceProfile.outlineScope],
  );

  return (
    <OutputManifestPublisher
      output={output}
      controllerProfile={sourceProfile}
      outlineId={sourceOutline?._id ?? null}
      outlineName={sourceOutline?.name}
      isMirrored={resolvedSource.id !== output.id}
    />
  );
};

export default ControllerMediaPreparationPublisher;
