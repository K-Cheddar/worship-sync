import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { useRemoteMediaPreparationReadinessReports } from "../../../hooks/useMediaPreparationManifest";
import type { MediaPreparationReadinessReport } from "../../../utils/mediaPreparationManifest";
import MediaSurfaceDiagnostics from "./MediaSurfaceDiagnostics";
import displayOutputsReducer from "../../../store/displayOutputsSlice";
import type { DisplayOutput } from "../../../utils/displayOutputs";
import { sanitizeForCopy } from "./MediaSurfaceDiagnostics";

jest.mock("../../../hooks/useMediaPreparationManifest", () => ({
  MEDIA_READINESS_STATUS_EVENT: "worship-sync-media-readiness-status",
  readMediaPreparationPublicationStatus: jest.fn(() => undefined),
  useRemoteMediaPreparationReadinessReports: jest.fn(() => []),
}));

const mockUseReadinessReports = jest.mocked(useRemoteMediaPreparationReadinessReports);

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

  it("keeps the operator view compact, exposes failures, and discloses detailed records only on demand", () => {
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
        candidateDetails: [{ mediaKey: "remote:secret", resolvedSource: "https://cdn.example.test/video.mp4?token=private" }],
        surfaces: [{ mediaKey: "remote:secret", source: "https://cdn.example.test/video.mp4?token=private", phase: "error", sourceKind: "remote", error: "decode failed" }],
        discovery: { renderer: "projector", itemCount: 2, items: [], uniqueVideoInventoryCount: 2, finitePlayableSourceCount: 1, pendingHlsCacheCount: 0, intentionallyExcludedVideoCount: 0, outlineLoadState: "error", outlineLoadError: "One item is missing" },
      },
    })));
    fireEvent.click(screen.getByTestId("media-surface-diagnostics-trigger"));

    expect(screen.getByLabelText("Computer health")).toHaveTextContent("Unavailable — Electron only");
    expect(screen.getByRole("alert")).toHaveTextContent("decode failed");
    expect(screen.getByRole("button", { name: "Retry preparation" })).toBeInTheDocument();
    expect(screen.getByText("Candidate details (1)")).not.toBeVisible();
    delete (window as { electronAPI?: unknown }).electronAPI;
  });

  it("shows each remote session’s own revision, readiness, error and connection age", () => {
    jest.useFakeTimers();
    const now = Date.now();
    const makeReport = (overrides: Partial<MediaPreparationReadinessReport>): MediaPreparationReadinessReport => ({
      contract: "worshipsync.media-preparation-readiness", version: 1, outputId: "projector",
      deviceId: "device-abc123", sessionId: "window-000001", reportedAt: now,
      manifestRevision: 3, manifestReceivedAt: now - 1000, source: "remote-manifest",
      candidateCount: 2, finiteCandidateCount: 2, pendingCacheCount: 0,
      readyCount: 2, preparingCount: 0, failedCount: 0, errors: [],
      ...overrides,
    });
    const reports = [
      makeReport({}),
      makeReport({ sessionId: "window-000002", manifestRevision: 2, readyCount: 1, failedCount: 1, errors: ["decode failed"] }),
      makeReport({ deviceId: "device-def456", sessionId: "window-000003", readyCount: 0, preparingCount: 2 }),
      makeReport({ deviceId: "device-old777", sessionId: "window-000004", reportedAt: now - 200_000 }),
    ];
    mockUseReadinessReports.mockImplementation(({ outputId }) => outputId === "projector" ? reports : []);
    renderDiagnostics();
    fireEvent.click(screen.getByTestId("media-surface-diagnostics-trigger"));
    act(() => window.dispatchEvent(new CustomEvent("worship-sync-media-manifest-publish-status", {
      detail: { outputId: "projector", state: "published", desiredRevision: 3, publishedAt: now },
    })));

    const card = (name: string) => screen.getByRole("group", { name });
    const healthy = card("Remote device 1, window 1");
    const failing = card("Remote device 1, window 2");
    const other = card("Remote device 2");
    const offline = card("Remote device 3");
    expect(healthy).toHaveTextContent("r3 · matches desired revision");
    expect(healthy).toHaveTextContent("2 videos: 2/2 finite ready · 0 preparing · 0 failed");
    expect(healthy).toHaveTextContent("Ready");
    expect(failing).toHaveTextContent("desired r3 not confirmed");
    expect(failing).toHaveTextContent("decode failed");
    expect(other).toHaveTextContent("2 preparing");
    expect(offline).toHaveTextContent("Disconnected");
    act(() => { jest.advanceTimersByTime(50_000); });
    expect(card("Remote device 1")).toHaveTextContent("Stale");
    jest.useRealTimers();
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
        mediaKey: "remote:diagnostic-identity",
        nested: [{ playbackUrl: "https://res.cloudinary.com/demo/video/upload/s--signed--/clip.mp4?auth_key=cloudinary-value" }],
      },
    };
    const sanitized = JSON.stringify(sanitizeForCopy(dangerous));
    expect(sanitized).toContain("https://video.example.test/path.mp4");
    expect(sanitized).toContain("https://res.cloudinary.com/demo/video/upload/s--[redacted]--/clip.mp4");
    ["signature-value", "token-value", "key-value", "aws-value", "bearer-value", "cookie-value", "cloudinary-value", "nested-auth-token", "mux-path-signature"].forEach((secret) => {
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
