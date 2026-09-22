import { act, render, screen } from "@testing-library/react";
import type { Box } from "../../types";
import { useServiceVideoCandidates } from "../../hooks/useServiceVideoCandidates";
import type { MediaSurfaceStatus } from "../../utils/mediaSurfaceLifecycle";
import type { ElectronMediaSurfaceView } from "../../utils/electronMediaSurfacePool";
import type { ElectronMediaDiscovery } from "../../utils/electronMediaSurfaceDiagnostics";
import ElectronEditorPreparedMediaPreview from "./ElectronEditorPreparedMediaPreview";

jest.mock("../../hooks/useServiceVideoCandidates", () => ({
  useServiceVideoCandidates: jest.fn(),
}));

let latestPoolProps: {
  views: ElectronMediaSurfaceView[];
  onStatusChange: (status: MediaSurfaceStatus) => void;
} | undefined;

jest.mock("./ElectronMediaSurfacePool", () => ({
  __esModule: true,
  default: (props: typeof latestPoolProps) => {
    latestPoolProps = props;
    return <div data-testid="mock-editor-media-pool" />;
  },
}));

const mockedUseServiceVideoCandidates = jest.mocked(useServiceVideoCandidates);
const videoBox = {
  id: "video-box",
  words: "",
  width: 100,
  height: 100,
} as unknown as Box;
const currentMedia = {
  mediaKey: "remote:clip",
  source: "https://cdn.example.com/clip.mp4",
};
const preparedMediaContext = {
  controllerProfileId: "profile-a",
  controllerProfileName: "Profile A",
  outlineScope: "service",
  outlineId: "outline-a",
  outlineName: "Outline A",
  contextSource: "persisted ItemLists fallback",
} as const;

const makeStatus = (
  phase: MediaSurfaceStatus["phase"],
): MediaSurfaceStatus => ({
  mediaKey: currentMedia.mediaKey,
  sourceIdentity: currentMedia.source,
  route: "editor",
  role: "editor-preview",
  outlineId: preparedMediaContext.outlineId,
  generation: 1,
  phase,
  geometryReady: true,
  advancingFrame: phase === "active-playing",
  frame: phase === "active-playing" ? { mediaTime: 1, presentedFrames: 2 } : undefined,
  timestamp: 1,
});

describe("ElectronEditorPreparedMediaPreview", () => {
  beforeEach(() => {
    latestPoolProps = undefined;
    mockedUseServiceVideoCandidates.mockReturnValue({
      candidates: [currentMedia],
      diagnostics: [],
      discovery: {
        renderer: "editor",
        contextSource: "persisted ItemLists fallback",
        outlineScope: "service",
        outlineId: "outline-a",
        outlineName: "Outline A",
        controllerProfileId: "profile-a",
        controllerProfileName: "Profile A",
        loadedOutlineId: "outline-a",
        outlineLoadState: "loaded",
        outlineRetryAttempt: 0,
        itemCount: 0,
        uniqueFiniteVideoCount: 1,
        items: [],
      } satisfies ElectronMediaDiscovery,
      poolCapacity: 1,
    });
  });

  it("keeps the normal editor fallback visible until prepared playback is active", () => {
    const activeChanges: boolean[] = [];
    render(
      <ElectronEditorPreparedMediaPreview
        enabled
        currentItemId="item-a"
        currentMedia={currentMedia}
        preparedMediaContext={preparedMediaContext}
        videoBox={videoBox}
        onCurrentFrameReady={(active) => activeChanges.push(active)}
      />,
    );

    expect(screen.getByTestId("mock-editor-media-pool")).toBeInTheDocument();
    expect(latestPoolProps?.views[0]).toMatchObject({
      mediaKey: currentMedia.mediaKey,
      opacity: 0,
      shouldPlay: true,
    });
    expect(activeChanges.at(-1)).toBe(false);

    act(() => {
      latestPoolProps?.onStatusChange(makeStatus("ready-paused"));
    });
    expect(latestPoolProps?.views[0]?.opacity).toBe(0);
    expect(activeChanges.at(-1)).toBe(false);

    act(() => {
      latestPoolProps?.onStatusChange(makeStatus("active-playing"));
    });
    expect(latestPoolProps?.views[0]?.opacity).toBe(1);
    expect(activeChanges.at(-1)).toBe(true);
  });

  it("demotes a selected prepared surface back to ready-paused without losing the candidate", () => {
    render(
      <ElectronEditorPreparedMediaPreview
        enabled
        currentItemId="item-a"
        currentMedia={currentMedia}
        preparedMediaContext={preparedMediaContext}
        videoBox={videoBox}
        onCurrentFrameReady={jest.fn()}
      />,
    );

    act(() => {
      latestPoolProps?.onStatusChange(makeStatus("active-playing"));
    });
    expect(latestPoolProps?.views[0]?.opacity).toBe(1);

    act(() => {
      latestPoolProps?.onStatusChange(makeStatus("ready-paused"));
    });
    expect(latestPoolProps?.views[0]).toMatchObject({
      mediaKey: currentMedia.mediaKey,
      opacity: 0,
      shouldPlay: true,
    });
  });
});
