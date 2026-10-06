import { render, screen } from "@testing-library/react";
import type { ServiceVideoCandidateResult } from "../../hooks/useServiceVideoCandidates";
import type { ElectronMediaSurfaceCandidate } from "../../utils/electronMediaSurfacePool";
import type { ElectronMediaSurfacePoolDiagnostics } from "../../utils/electronMediaSurfaceDiagnostics";
import ControllerLocalMediaPreparationHost from "./ControllerLocalMediaPreparationHost";

type MockPoolProps = {
  candidates: ElectronMediaSurfaceCandidate[];
  discovery: ElectronMediaSurfacePoolDiagnostics["discovery"];
  windowRole?: string;
};

let mockPoolProps: MockPoolProps | undefined;
let mockPoolMounts = 0;
let mockPoolUnmounts = 0;

jest.mock("../../components/DisplayWindow/ElectronMediaSurfacePool", () => {
  const React = require("react") as typeof import("react");
  return {
    __esModule: true,
    default: function MockElectronMediaSurfacePool(props: MockPoolProps) {
      mockPoolProps = props;
      React.useEffect(() => {
        mockPoolMounts += 1;
        return () => {
          mockPoolUnmounts += 1;
        };
      }, []);
      return <div data-testid="controller-local-pool" />;
    },
  };
});

const candidates = Array.from({ length: 30 }, (_, index) => ({
  mediaKey: `video:${index}`,
  source: `https://cdn.example.com/video-${index}.mp4`,
  itemId: `item-${index}`,
  itemName: `Item ${index}`,
  itemIndex: index,
}));

const candidateResult: ServiceVideoCandidateResult = {
  allCandidates: candidates,
  candidates,
  diagnostics: candidates.map((candidate) => ({
    mediaKey: candidate.mediaKey,
    originalSource: candidate.source,
    sourceKind: "remote",
    status: "eligible",
    cacheStatus: "not-required",
    eligible: true,
    reason: "finite video source",
    itemId: candidate.itemId,
    itemName: candidate.itemName,
    itemIndex: candidate.itemIndex,
  })),
  discovery: {
    renderer: "projector",
    controllerProfileId: "presentation",
    controllerProfileName: "Presentation",
    outlineScope: "presentation",
    outlineId: "outline-a",
    targetOutlineId: "outline-a",
    loadedOutlineId: "outline-a",
    outlineLoadState: "loaded",
    itemCount: 30,
    uniqueVideoInventoryCount: 30,
    finitePlayableSourceCount: 30,
    uniqueFiniteVideoCount: 30,
    items: [],
  },
  poolCapacity: 12,
  performanceClass: "normal",
  posterUrls: [],
};

describe("ControllerLocalMediaPreparationHost", () => {
  beforeEach(() => {
    mockPoolProps = undefined;
    mockPoolMounts = 0;
    mockPoolUnmounts = 0;
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {},
    });
  });

  afterEach(() => {
    delete (window as { electronAPI?: unknown }).electronAPI;
  });

  it("starts from service discovery without an item and keeps selection within budget", () => {
    render(
      <ControllerLocalMediaPreparationHost discoveryResult={candidateResult} />,
    );

    expect(screen.getByTestId("controller-local-pool")).toBeInTheDocument();
    expect(mockPoolProps).toMatchObject({
      windowRole: "local-preparation",
      discovery: {
        targetOutlineId: "outline-a",
        currentItemId: undefined,
        renderer: "editor",
      },
    });
    expect(mockPoolProps?.candidates).toHaveLength(12);
    expect(mockPoolProps?.candidates.map((candidate) => candidate.mediaKey)).toEqual(
      Array.from({ length: 12 }, (_, index) => `video:${index}`),
    );
  });

  it("reprioritizes the mounted pool when an item is selected", () => {
    const view = render(
      <ControllerLocalMediaPreparationHost discoveryResult={candidateResult} />,
    );
    const originalKeys = new Set(
      mockPoolProps?.candidates.map((candidate) => candidate.mediaKey),
    );

    view.rerender(
      <ControllerLocalMediaPreparationHost
        currentItemId="item-5"
        discoveryResult={candidateResult}
      />,
    );

    const reprioritized = mockPoolProps?.candidates ?? [];
    expect(reprioritized).toHaveLength(12);
    expect(reprioritized[0]).toMatchObject({
      mediaKey: "video:5",
      itemId: "item-5",
    });
    expect(reprioritized.some((candidate) => originalKeys.has(candidate.mediaKey))).toBe(true);
    expect(mockPoolMounts).toBe(1);
    expect(mockPoolUnmounts).toBe(0);
  });

  it("keeps an empty diagnostic pool for a loaded state with no selected service", () => {
    const noServiceResult: ServiceVideoCandidateResult = {
      ...candidateResult,
      allCandidates: [],
      candidates: [],
      diagnostics: [],
      discovery: {
        ...candidateResult.discovery,
        outlineId: null,
        targetOutlineId: null,
        loadedOutlineId: undefined,
        outlineLoadState: "loaded",
        itemCount: 0,
        uniqueVideoInventoryCount: 0,
        finitePlayableSourceCount: 0,
        uniqueFiniteVideoCount: 0,
        items: [],
      },
    };

    render(
      <ControllerLocalMediaPreparationHost discoveryResult={noServiceResult} />,
    );

    expect(screen.getByTestId("controller-local-pool")).toBeInTheDocument();
    expect(mockPoolProps?.candidates).toEqual([]);
    expect(mockPoolProps?.discovery?.targetOutlineId).toBeNull();
  });
});
