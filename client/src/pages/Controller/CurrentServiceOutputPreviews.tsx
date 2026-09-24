import { useMemo } from "react";
import ProjectorPresentationPreview from "../../containers/TransmitHandler/ProjectorPresentationPreview";
import MonitorPresentationPreview from "../../containers/TransmitHandler/MonitorPresentationPreview";
import StreamPresentationPreview from "../../containers/TransmitHandler/StreamPresentationPreview";
import { useSelector } from "../../hooks";
import type { DisplayOutput } from "../../utils/displayOutputs";

const NOOP = () => undefined;

const OutputPreview = ({
  output,
  isVisible,
}: {
  output: DisplayOutput;
  isVisible: boolean;
}) => {
  const followingOutputId = useSelector(
    (state) => state.presentation.outputs[output.id]?.followingOutputId ?? "",
  );
  const sourceName = useSelector((state) =>
    followingOutputId
      ? state.displayOutputs?.list.find((candidate) => candidate.id === followingOutputId)?.name
      : undefined,
  );
  const footer = followingOutputId ? (
    <span className="text-xs text-gray-300">
      Mirroring {sourceName || followingOutputId}
    </span>
  ) : undefined;

  if (output.type === "projector") {
    return (
      <ProjectorPresentationPreview
        outputId={output.id}
        name={output.name}
        quickLinks={[]}
        readOnly
        isVisible={isVisible}
        toggleIsTransmitting={NOOP}
        fillWidth
        footer={footer}
      />
    );
  }
  if (output.type === "monitor") {
    return (
      <MonitorPresentationPreview
        outputId={output.id}
        name={output.name}
        quickLinks={[]}
        readOnly
        isVisible={isVisible}
        toggleIsTransmitting={NOOP}
        fillWidth
        footer={footer}
      />
    );
  }
  if (output.type === "stream") {
    return (
      <StreamPresentationPreview
        outputId={output.id}
        name={output.name}
        quickLinks={[]}
        readOnly
        isVisible={isVisible}
        toggleIsTransmitting={NOOP}
        fillWidth
        footer={footer}
        variant="default"
        showFocusedStreamControls={false}
      />
    );
  }
  return null;
};

/** Registry-selected, church-wide read-only previews; no controller ownership path. */
const CurrentServiceOutputPreviews = ({
  outputs,
  selectedOutputIds,
  isVisible,
}: {
  outputs: DisplayOutput[];
  selectedOutputIds: string[];
  isVisible: boolean;
}) => {
  const visibleOutputs = useMemo(() => {
    const selected = new Set(selectedOutputIds);
    return outputs.filter((output) => output.enabled && selected.has(output.id));
  }, [outputs, selectedOutputIds]);

  if (visibleOutputs.length === 0) {
    return (
      <p className="rounded-lg border border-gray-700 p-3 text-sm text-gray-400">
        No output previews are selected. Choose outputs in workspace settings.
      </p>
    );
  }

  return (
    <div
      role="group"
      aria-label="Selected output previews"
      className="grid min-h-0 grid-cols-2 gap-3"
    >
      {visibleOutputs.map((output) => (
        <section
          key={output.id}
          className="min-w-0 overflow-hidden rounded-lg border border-gray-700 bg-gray-950/30 p-2"
          aria-label={`${output.name} output preview`}
        >
          <div className="aspect-video min-w-0">
            <OutputPreview output={output} isVisible={isVisible} />
          </div>
        </section>
      ))}
    </div>
  );
};

export default CurrentServiceOutputPreviews;
