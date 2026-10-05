import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { readMediaPreparationPublicationStatus, useRemoteMediaPreparationManifest, useRemoteMediaPreparationReadinessReports } from "../../../hooks/useMediaPreparationManifest";
import type { MediaPreparationReadinessReport } from "../../../utils/mediaPreparationManifest";
import MediaSurfaceDiagnostics from "./MediaSurfaceDiagnostics";
import displayOutputsReducer from "../../../store/displayOutputsSlice";
import type { DisplayOutput } from "../../../utils/displayOutputs";
import { sanitizeForCopy } from "./MediaSurfaceDiagnostics";

jest.mock("../../../hooks/useMediaPreparationManifest", () => ({
  MEDIA_PREPARATION_PUBLISHER_SESSION_ID: "publisher-current",
  MEDIA_READINESS_STATUS_EVENT: "worship-sync-media-readiness-status",
  readMediaPreparationPublicationStatus: jest.fn(() => undefined),
  useRemoteMediaPreparationManifest: jest.fn(() => ({ manifest: undefined, cacheMap: {}, manifestReceivedAt: undefined })),
  useRemoteMediaPreparationReadinessReports: jest.fn(() => []),
}));

const mockUseReadinessReports = jest.mocked(useRemoteMediaPreparationReadinessReports);
const mockUseManifest = jest.mocked(useRemoteMediaPreparationManifest);
const mockReadPublication = jest.mocked(readMediaPreparationPublicationStatus);
const emptyReports: MediaPreparationReadinessReport[] = [];

const renderDiagnostics = () => {
  const list: DisplayOutput[] = [
    { id: "projector", type: "projector", name: "Main Projector", order: 0, enabled: true },
    { id: "lobby", type: "projector", name: "Lobby", order: 1, enabled: true },
  ];
  const store = configureStore({
    reducer: {
      displayOutputs: displayOutputsReducer,
      undoable: (
        state = {
          present: {
            itemLists: {
              selectedList: null,
              scope: "presentation",
              currentLists: [],
              selectedIdByScope: {},
            },
          },
        },
      ) => state,
    },
    preloadedState: {
      displayOutputs: {
        isLoaded: true,
        list,
      },
    },
  });
  return render(
    <Provider store={store}>
      <MediaSurfaceDiagnostics />
    </Provider>,
  );
};

beforeEach(() => {
  mockUseReadinessReports.mockReturnValue([]);
  mockUseManifest.mockReturnValue({ manifest: undefined, cacheMap: {}, manifestReceivedAt: undefined });
  mockReadPublication.mockReturnValue(undefined);
});

const publish = (outputId: string, readyCount: number, candidateCount: number) => {
  window.dispatchEvent(
    new CustomEvent("worship-sync-media-surface-diagnostics", {
      detail: {
        outputId,
        windowRole: "projector",
        candidateCount,
        surfaceCount: candidateCount,
        readyCount,
        preparingCount: candidateCount - readyCount,
        playingCount: 0,
        resettingCount: 0,
        errorCount: 0,
        evictions: [],
        surfaces: [],
      },
    }),
  );
};

describe("MediaSurfaceDiagnostics", () => {
  it("labels private RAM as the headline estimate and keeps per-process working sets available", () => {
    let receiveMetrics: ((value: unknown) => void) | undefined;
    let receivePolicy: ((value: unknown) => void) | undefined;
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {
        subscribePreparedVideoMetrics: jest.fn((listener: (value: unknown) => void) => { receiveMetrics = listener; return jest.fn(); }),
        subscribeResourceGovernorPolicy: jest.fn((listener: (value: unknown) => void) => { receivePolicy = listener; return jest.fn(); }),
      },
    });
    renderDiagnostics();
    act(() => publish("projector", 1, 1));
    fireEvent.click(screen.getByTestId("media-surface-diagnostics-trigger"));
    act(() => receiveMetrics?.({
      status: "available", timestamp: Date.now(),
      memory: { private: { status: "available", value: 80_000 }, workingSet: { status: "available", value: 120_000 } },
      cpu: { status: "available", value: 2 },
      total: {
        privateMemory: { status: "available", value: 918 * 1024 },
        workingSetMemory: { status: "available", value: 1400 * 1024 },
        cpu: { status: "available", value: 7.3 }, processCount: 2,
      },
      processes: [{
        pid: 41, processType: "Tab", labels: ["Projector renderer"],
        cpu: { status: "available", value: 1.2 },
        memory: { private: { status: "available", value: 80_000 }, workingSet: { status: "available", value: 120_000 } },
      }],
    }));
    act(() => receivePolicy?.({ mode: "auto", tier: 1, pressure: "elevated", metrics: "available" }));

    expect(screen.getByLabelText("Computer health")).toHaveTextContent("App CPU 7.3% · App RAM ≈918 MB");
    fireEvent.click(screen.getAllByText("Advanced diagnostics")[0]);
    expect(screen.getByText("Resource governor")).toBeInTheDocument();
    expect(screen.getByText("auto · Tier 1 · elevated · available metrics")).toBeInTheDocument();
    expect(screen.getByText("App private RAM")).toBeInTheDocument();
    expect(screen.getByText("Summed working sets")).toBeInTheDocument();
    expect(screen.getByText("Process count")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Electron process breakdown (1)"));
    expect(screen.getByText(/Private RAM ≈78 MB · Working set ≈117 MB/)).toBeInTheDocument();
    act(() => receiveMetrics?.({
      status: "available", timestamp: Date.now(),
      memory: { private: { status: "unsupported", reason: "private memory unavailable" }, workingSet: { status: "available", value: 120_000 } },
      cpu: { status: "available", value: 2 },
      total: {
        privateMemory: { status: "unsupported", reason: "private memory unavailable" },
        workingSetMemory: { status: "available", value: 1400 * 1024 },
        cpu: { status: "available", value: 7.3 }, processCount: 2,
      },
    }));
    expect(screen.getByLabelText("Computer health")).toHaveTextContent("App RAM (working set) ≈1400 MB");
    delete (window as { electronAPI?: unknown }).electronAPI;
  });

  it("renders readiness counts and keeps multiple displays separate", () => {
    renderDiagnostics();
    act(() => {
      publish("projector", 6, 8);
      publish("lobby", 2, 4);
    });

    expect(screen.getByTestId("media-surface-diagnostics-trigger")).toHaveTextContent(
      "Videos",
    );
    fireEvent.click(screen.getByTestId("media-surface-diagnostics-trigger"));

    expect(screen.getByText("Main Projector")).toBeInTheDocument();
    expect(screen.getByText("Lobby")).toBeInTheDocument();
    expect(screen.getAllByText("Distinct videos")).toHaveLength(2);
    expect(screen.getAllByText("Selected surfaces")).toHaveLength(2);
    expect(screen.getAllByText("Advanced diagnostics")).toHaveLength(2);
    expect(screen.getAllByText("0").length).toBeGreaterThanOrEqual(1);
  });

  it("shows operator video rows immediately and keeps raw records under Advanced diagnostics", () => {
    Object.defineProperty(window, "electronAPI", { configurable: true, value: undefined });
    renderDiagnostics();
    act(() => window.dispatchEvent(new CustomEvent("worship-sync-media-surface-diagnostics", {
      detail: {
        diagnosticId: "device-session-projector",
        outputId: "projector",
        windowRole: "projector",
        preparationSource: "local-pouchdb",
        candidateCount: 1,
        discoveredCount: 2,
        surfaceCount: 1,
        readyCount: 0,
        preparingCount: 0,
        playingCount: 0,
        resettingCount: 0,
        errorCount: 1,
        evictions: [],
        candidateDetails: [{ mediaKey: "remote:secret", originalSource: "https://cdn.example.test/Closing Video.mp4?token=private", resolvedSource: "media-cache://private-copy", itemName: "Closing item", status: "eligible", selected: true }],
        surfaces: [{ mediaKey: "remote:secret", source: "https://cdn.example.test/video.mp4?token=private", phase: "error", sourceKind: "remote", error: "decode failed" }],
        discovery: { renderer: "projector", itemCount: 2, items: [], uniqueVideoInventoryCount: 2, finitePlayableSourceCount: 1, pendingHlsCacheCount: 0, intentionallyExcludedVideoCount: 0, outlineLoadState: "error", outlineLoadError: "One item is missing" },
      },
    })));
    fireEvent.click(screen.getByTestId("media-surface-diagnostics-trigger"));

    expect(screen.getByLabelText("Computer health")).toHaveTextContent("Unavailable — Electron only");
    expect(screen.getByRole("alert")).toHaveTextContent("decode failed");
    expect(screen.getByRole("button", { name: "Retry preparation" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Video readiness list" })).toBeVisible();
    expect(screen.getByText("Closing Video.mp4")).toBeInTheDocument();
    expect(screen.getAllByText("Failed")).toHaveLength(2);
    expect(screen.getByText("Candidate details (1)")).not.toBeVisible();
    delete (window as { electronAPI?: unknown }).electronAPI;
  });

  it("shows a protected ready video without an inventory denominator", () => {
    renderDiagnostics();
    act(() => window.dispatchEvent(new CustomEvent("worship-sync-media-surface-diagnostics", {
      detail: {
        outputId: "projector", windowRole: "projector", candidateCount: 1, discoveredCount: 0,
        surfaceCount: 1, readyCount: 0, preparingCount: 0, playingCount: 1, resettingCount: 0,
        errorCount: 0, evictions: [],
        candidateDetails: [{ mediaKey: "protected:current", originalSource: "https://cdn.example.test/current.mp4", status: "eligible", selected: true }],
        surfaces: [{ mediaKey: "protected:current", source: "media-cache://current.mp4", phase: "playing", sourceKind: "cache" }],
        discovery: { renderer: "projector", itemCount: 0, items: [], uniqueVideoInventoryCount: 0, finitePlayableSourceCount: 0, pendingHlsCacheCount: 0, intentionallyExcludedVideoCount: 0, outlineLoadState: "loaded" },
      },
    })));
    expect(screen.getByTestId("media-surface-diagnostics-trigger")).toHaveTextContent("Videos · 1/1 ready");
    fireEvent.click(screen.getByTestId("media-surface-diagnostics-trigger"));
    expect(screen.getByText("current.mp4")).toBeVisible();
    expect(screen.getByText("Playing", { exact: true })).toBeVisible();
    expect(screen.getByText(/0 finite inventory · 1 selected finite · 1 ready/)).toBeVisible();
    expect(screen.queryByText(/1\/0/)).not.toBeInTheDocument();
  });

  it("keeps inventory, selection, readiness and deferral populations separate for a bounded pool", () => {
    const now = Date.now();
    const videos = Array.from({ length: 30 }, (_, index) => ({
      mediaKey: `finite:${index}`,
      name: `Video ${index + 1}.mp4`,
      status: index < 10 ? "ready" as const : index < 12 ? "preparing" as const : "deferred" as const,
    }));
    const boundedReport: MediaPreparationReadinessReport = {
      contract: "worshipsync.media-preparation-readiness", version: 1, outputId: "projector",
      deviceId: "device-bounded", sessionId: "window-bounded", reportedAt: now,
      manifestRevision: 3, manifestReceivedAt: now, source: "remote-manifest",
      candidateCount: 30, finiteCandidateCount: 30, pendingCacheCount: 0,
      selectedCandidateCount: 12, selectedFiniteCandidateCount: 12, selectedPendingCacheCount: 0, selectedExcludedCount: 0,
      selectedFiniteInventoryCount: 12, deferredFiniteCount: 18, mountedSurfaceCount: 12,
      readyCount: 10, preparingCount: 2, failedCount: 0, errors: [], videos,
    };
    const boundedReports = [boundedReport];
    mockUseReadinessReports.mockImplementation(({ outputId }) => outputId === "projector" ? boundedReports : emptyReports);
    mockUseManifest.mockReturnValue({ manifest: { revision: 3 } as never, cacheMap: {}, manifestReceivedAt: now });
    renderDiagnostics();
    fireEvent.click(screen.getByTestId("media-surface-diagnostics-trigger"));
    const card = screen.getByRole("group", { name: "Remote device 1" });
    expect(card).toHaveTextContent("30 finite inventory · 12 selected finite · 10 ready · 18 deferred");
    expect(card).not.toHaveTextContent("10/30");
    expect(within(card).getByText("Video 1.mp4")).toBeVisible();
  });

  it("shows each remote session’s own revision, readiness, error and connection age", () => {
    jest.useFakeTimers();
    const now = Date.now();
    const makeReport = (overrides: Partial<MediaPreparationReadinessReport>): MediaPreparationReadinessReport => ({
      contract: "worshipsync.media-preparation-readiness", version: 1, outputId: "projector",
      deviceId: "device-abc123", sessionId: "window-000001", reportedAt: now,
      manifestRevision: 3, manifestReceivedAt: now - 1000, source: "remote-manifest",
      candidateCount: 2, finiteCandidateCount: 2, pendingCacheCount: 0,
      selectedCandidateCount: 2, selectedFiniteCandidateCount: 2, selectedPendingCacheCount: 0, selectedExcludedCount: 0,
      selectedFiniteInventoryCount: 2, deferredFiniteCount: 0, mountedSurfaceCount: 2,
      readyCount: 2, preparingCount: 0, failedCount: 0, errors: [],
      ...overrides,
    });
    const reports = [
      makeReport({}),
      makeReport({
        sessionId: "window-000002", manifestRevision: 2, readyCount: 1, failedCount: 1, errors: ["decode failed"],
        videos: [
          { mediaKey: "remote:ready", name: "Welcome.mp4", status: "ready" },
          { mediaKey: "remote:playing", itemName: "Loop", status: "playing" },
          { mediaKey: "remote:preparing", itemName: "Song", status: "preparing" },
          { mediaKey: "remote:failed", itemName: "Closing", status: "failed", error: "decode failed" },
          { mediaKey: "remote:pending", itemName: "Intro", status: "pending-cache" },
          { mediaKey: "remote:deferred", itemName: "Outro", status: "deferred" },
          { mediaKey: "remote:excluded", itemName: "Invalid source", status: "excluded" },
        ],
      }),
      makeReport({ deviceId: "device-def456", sessionId: "window-000003", readyCount: 0, preparingCount: 2 }),
      makeReport({ deviceId: "device-old777", sessionId: "window-000004", reportedAt: now - 200_000 }),
    ];
    mockUseReadinessReports.mockImplementation(({ outputId }) => outputId === "projector" ? reports : []);
    mockUseManifest.mockReturnValue({ manifest: { revision: 3 } as never, cacheMap: {}, manifestReceivedAt: now - 20_000_000 });
    renderDiagnostics();
    fireEvent.click(screen.getByTestId("media-surface-diagnostics-trigger"));
    act(() => window.dispatchEvent(new CustomEvent("worship-sync-media-manifest-publish-status", {
      detail: { outputId: "projector", state: "published", desiredRevision: 3, publishedAt: now - 7 * 60 * 60_000, publisherSessionId: "publisher-current" },
    })));

    const card = (name: string) => screen.getByRole("group", { name });
    const healthy = card("Remote device 1, window 1");
    const failing = card("Remote device 1, window 2");
    const other = card("Remote device 2");
    const offline = card("Remote device 3");
    expect(healthy).toHaveTextContent("r3 · matches desired revision");
    expect(healthy).toHaveTextContent("selected 2/2 finite ready · 0 preparing · 0 failed");
    expect(healthy).toHaveTextContent("Ready");
    expect(healthy).toHaveTextContent("Per-video details unavailable from this device version");
    expect(failing).toHaveTextContent("desired r3 not confirmed");
    expect(failing).toHaveTextContent("decode failed");
    expect(failing).toHaveTextContent("Welcome.mp4");
    expect(failing).toHaveTextContent("Pending cache");
    expect(failing).toHaveTextContent("Deferred");
    expect(failing).toHaveTextContent("Playing");
    expect(failing).toHaveTextContent("Excluded");
    expect(other).toHaveTextContent("2 preparing");
    expect(offline).toHaveTextContent("Disconnected");
    act(() => { jest.advanceTimersByTime(50_000); });
    expect(card("Remote device 1")).toHaveTextContent("Stale");
    jest.useRealTimers();
  });

  it("keeps an unchanged publication current for hours and rejects stale prior-renderer status", () => {
    const now = Date.now();
    const report: MediaPreparationReadinessReport = {
      contract: "worshipsync.media-preparation-readiness", version: 1, outputId: "projector",
      deviceId: "device-long-running", sessionId: "window-current", reportedAt: now,
      manifestRevision: 8, manifestReceivedAt: now - 60_000, source: "remote-manifest",
      candidateCount: 1, finiteCandidateCount: 1, pendingCacheCount: 0, readyCount: 1,
      preparingCount: 0, failedCount: 0, selectedCandidateCount: 1, selectedFiniteCandidateCount: 1,
      selectedPendingCacheCount: 0, selectedExcludedCount: 0, selectedFiniteInventoryCount: 1,
      deferredFiniteCount: 0, mountedSurfaceCount: 1, errors: [],
    };
    mockUseReadinessReports.mockImplementation(({ outputId }) => outputId === "projector" ? [report] : []);
    mockUseManifest.mockReturnValue({ manifest: { revision: 8 } as never, cacheMap: {}, manifestReceivedAt: now - 10_000 });
    mockReadPublication.mockReturnValue({
      outputId: "projector", state: "published", desiredRevision: 8,
      publishedAt: now - 7 * 60 * 60_000, publisherSessionId: "publisher-current",
    });
    const { unmount } = renderDiagnostics();
    fireEvent.click(screen.getByTestId("media-surface-diagnostics-trigger"));
    const card = screen.getByRole("group", { name: "Remote device 1" });
    expect(card).toHaveTextContent("Ready");
    unmount();
    cleanup();

    mockReadPublication.mockReturnValue({
      outputId: "projector", state: "published", desiredRevision: 8,
      publishedAt: now, publisherSessionId: "previous-renderer-session",
    });
    renderDiagnostics();
    fireEvent.click(screen.getByTestId("media-surface-diagnostics-trigger"));
    expect(screen.getByRole("group", { name: "Remote device 1" })).not.toHaveTextContent("Ready");
    expect(screen.getAllByText("Firebase has r8; current publish result unavailable")).toHaveLength(2);
  });

  it("removes every signed URL query and nested credential from copied reports", async () => {
    const copied: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: jest.fn(async (value: string) => { copied.push(value); }) },
    });
    const dangerous = {
      candidate: {
        source: "https://video.example.test/path.mp4?sig=signature-value&token=token-value&key=key-value&X-Amz-Credential=aws-value",
        headers: { Authorization: "Bearer bearer-value", Cookie: "cookie-value" },
        authToken: "nested-auth-token",
        muxSignature: "mux-path-signature",
        localPath: "C:\\Users\\KPC\\Videos\\private.mp4",
        fileUrl: "file:///Users/KPC/Library/Application Support/video.mp4",
        mediaKey: "remote:diagnostic-identity",
        nested: [{ playbackUrl: "https://res.cloudinary.com/demo/video/upload/s--signed--/clip.mp4?auth_key=cloudinary-value" }],
      },
    };
    const sanitized = JSON.stringify(sanitizeForCopy(dangerous));
    expect(sanitized).toContain("https://video.example.test/path.mp4");
    expect(sanitized).toContain("https://res.cloudinary.com/demo/video/upload/s--[redacted]--/clip.mp4");
    ["signature-value", "token-value", "key-value", "aws-value", "bearer-value", "cookie-value", "cloudinary-value", "nested-auth-token", "mux-path-signature", "C:\\Users\\KPC", "/Users/KPC/Library"].forEach((secret) => {
      expect(sanitized).not.toContain(secret);
    });
    expect(sanitized).toContain("remote:diagnostic-identity");

    renderDiagnostics();
    act(() => window.dispatchEvent(new CustomEvent("worship-sync-media-surface-diagnostics", {
      detail: {
        outputId: "projector", windowRole: "projector", candidateCount: 1, discoveredCount: 1,
        surfaceCount: 1, readyCount: 0, preparingCount: 0, playingCount: 0, resettingCount: 0,
        errorCount: 1, evictions: [], candidateDetails: [dangerous.candidate], surfaces: [dangerous.candidate],
      },
    })));
    fireEvent.click(screen.getByTestId("media-surface-diagnostics-trigger"));
    fireEvent.click(screen.getByRole("button", { name: "Copy diagnostic report" }));
    await waitFor(() => expect(copied).toHaveLength(1));
    expect(copied[0]).toContain("https://video.example.test/path.mp4");
    expect(copied[0]).not.toContain("signature-value");
    expect(copied[0]).not.toContain("cloudinary-value");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  });
});
