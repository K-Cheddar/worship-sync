import { act, render, waitFor } from "@testing-library/react";
import { getOrCreateDeviceId } from "../../utils/authStorage";
import {
  acquireWarmLocalVideoCaptureWithBusyRetry,
  LocalVideoCaptureOwnedError,
  releaseWarmLocalVideoCapture,
} from "../../utils/localVideoCapturePool";
import { resolveLocalVideoInputBinding } from "../../utils/localVideoInput";
import { reportLocalVideoIssue } from "../../utils/localVideoIssues";
import {
  readLocalVideoWarmIntent,
  subscribeLocalVideoWarmIntent,
} from "../../utils/localVideoWarmIntent";
import LocalVideoCaptureManager from "./LocalVideoCaptureManager";
import { subscribeLocalVideoCaptureDemand } from "../../utils/localVideoCaptureQualityRelay";

const localVideoInput = {
  sourceId: "source-1",
  deviceLabel: "USB Capture",
  ownerDeviceId: "local-device",
  ownerLabel: "Booth",
};

type MockOutputSlot = {
  id: string;
  type: string;
  info: { localVideoInput?: typeof localVideoInput };
  prevInfo: Record<string, never>;
  isTransmitting: boolean;
  itemContentBlocked: boolean;
  boardAliasId: string;
};

const mockState: {
  presentation: { outputs: Record<string, MockOutputSlot> };
} = {
  presentation: {
    outputs: {
      projector: {
        id: "projector",
        type: "projector",
        info: {
          localVideoInput: localVideoInput as
            | typeof localVideoInput
            | undefined,
        },
        prevInfo: {},
        isTransmitting: true,
        itemContentBlocked: false,
        boardAliasId: "",
      },
    },
  },
};

let warmIntentListener:
  | ((intent: { sourceIds: string[]; updatedAt: number }) => void)
  | undefined;
let warmSourceIds: string[] = [];
let captureDemandListener: ((sourceId: string) => void) | undefined;
jest.mock("../../utils/localVideoCaptureQualityRelay", () => ({
  subscribeLocalVideoCaptureDemand: jest.fn((listener) => {
    captureDemandListener = listener;
    return () => { captureDemandListener = undefined; };
  }),
}));

jest.mock("../../hooks", () => ({
  useSelector: (selector: (state: typeof mockState) => unknown) =>
    selector(mockState),
}));
jest.mock("../../utils/authStorage", () => ({
  getOrCreateDeviceId: jest.fn(),
}));
jest.mock("../../utils/localVideoCapturePool", () => ({
  acquireWarmLocalVideoCaptureWithBusyRetry: jest.fn(),
  releaseWarmLocalVideoCapture: jest.fn(),
  LocalVideoCaptureOwnedError: class extends Error { },
}));
jest.mock("../../utils/localVideoInput", () => ({
  getLocalVideoSourceErrorMessage: jest.fn(() => "Check the video input."),
  isDesktopCaptureKind: jest.requireActual("../../utils/localVideoInput")
    .isDesktopCaptureKind,
  resolveLocalVideoInputBinding: jest.fn(),
}));
jest.mock("../../utils/localVideoIssues", () => ({
  reportLocalVideoIssue: jest.fn(),
}));
jest.mock("../../utils/localVideoWarmIntent", () => ({
  readLocalVideoWarmIntent: jest.fn(() => ({
    sourceIds: warmSourceIds,
    updatedAt: 0,
  })),
  subscribeLocalVideoWarmIntent: jest.fn((onIntent) => {
    warmIntentListener = onIntent;
    onIntent({ sourceIds: warmSourceIds, updatedAt: Date.now() });
    return () => {
      warmIntentListener = undefined;
    };
  }),
}));

const mockGetDeviceId = jest.mocked(getOrCreateDeviceId);
const mockAcquireCapture = jest.mocked(
  acquireWarmLocalVideoCaptureWithBusyRetry,
);
const mockReleaseCapture = jest.mocked(releaseWarmLocalVideoCapture);
const mockResolveBinding = jest.mocked(resolveLocalVideoInputBinding);
const mockReportLocalVideoIssue = jest.mocked(reportLocalVideoIssue);
const mockReadWarmIntent = jest.mocked(readLocalVideoWarmIntent);
const mockSubscribeWarmIntent = jest.mocked(subscribeLocalVideoWarmIntent);

describe("LocalVideoCaptureManager", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    warmSourceIds = [];
    warmIntentListener = undefined;
    mockGetDeviceId.mockReturnValue("local-device");
    mockResolveBinding.mockReturnValue({
      sourceId: "source-1",
      deviceId: "capture-card-1",
      deviceLabel: "USB Capture",
    });
    mockAcquireCapture.mockResolvedValue({ stream: {} as MediaStream });
    mockReleaseCapture.mockResolvedValue();
    mockReadWarmIntent.mockImplementation(() => ({
      sourceIds: warmSourceIds,
      updatedAt: 0,
    }));
    mockSubscribeWarmIntent.mockImplementation((onIntent) => {
      warmIntentListener = onIntent;
      onIntent({ sourceIds: warmSourceIds, updatedAt: Date.now() });
      return () => {
        warmIntentListener = undefined;
      };
    });
    mockState.presentation.outputs.projector.info.localVideoInput =
      localVideoInput;
  });

  afterEach(() => {
    delete window.__ELECTRON__;
    captureDemandListener = undefined;
    jest.useRealTimers();
  });

  it("warms a standalone Electron request and retires it after demand expires", async () => {
    jest.useFakeTimers();
    window.__ELECTRON__ = true;
    mockState.presentation.outputs.projector.info.localVideoInput = undefined;
    const view = render(<LocalVideoCaptureManager />);
    expect(subscribeLocalVideoCaptureDemand).toHaveBeenCalled();
    act(() => captureDemandListener?.("source-1"));
    await act(async () => { await Promise.resolve(); });
    expect(mockAcquireCapture).toHaveBeenCalledWith("source-1", expect.any(Object), true, "active-output-manager");
    await act(async () => { await jest.advanceTimersByTimeAsync(9_000); });
    act(() => captureDemandListener?.("source-1"));
    await act(async () => { await jest.advanceTimersByTimeAsync(9_000); });
    expect(mockReleaseCapture).not.toHaveBeenCalled();
    await act(async () => { await jest.advanceTimersByTimeAsync(3_000); });
    await act(async () => { await jest.advanceTimersByTimeAsync(5_000); });
    expect(mockReleaseCapture).toHaveBeenCalledWith("source-1", "active-output-manager");
    view.unmount();
    expect(captureDemandListener).toBeUndefined();
  });

  it("does not acquire missing or desktop sources from Electron camera demand", async () => {
    window.__ELECTRON__ = true;
    mockState.presentation.outputs.projector.info.localVideoInput = undefined;
    render(<LocalVideoCaptureManager />);
    mockResolveBinding.mockReturnValue(undefined);
    act(() => captureDemandListener?.("missing"));
    mockResolveBinding.mockReturnValue({ sourceId: "screen", deviceId: "screen:0", deviceLabel: "Screen", captureKind: "screen" });
    act(() => captureDemandListener?.("screen"));
    await act(async () => { await Promise.resolve(); });
    expect(mockAcquireCapture).not.toHaveBeenCalled();
  });

  it("restores and publishes a source already active on an output", async () => {
    render(<LocalVideoCaptureManager />);

    await waitFor(() =>
      expect(mockAcquireCapture).toHaveBeenCalledWith(
        "source-1",
        expect.objectContaining({ deviceId: "capture-card-1" }),
        true,
        "active-output-manager",
      ),
    );
  });

  it("warms a source present on the service list before it goes live", async () => {
    mockState.presentation.outputs.projector.info = {};
    warmSourceIds = ["source-1"];
    render(<LocalVideoCaptureManager />);

    await waitFor(() =>
      expect(mockAcquireCapture).toHaveBeenCalledWith(
        "source-1",
        expect.objectContaining({ deviceId: "capture-card-1" }),
        true,
        "active-output-manager",
      ),
    );
  });

  it("releases and restarts the active publisher when the manager remounts", async () => {
    const view = render(<LocalVideoCaptureManager />);
    await waitFor(() => expect(mockAcquireCapture).toHaveBeenCalledTimes(1));

    view.unmount();
    await waitFor(() =>
      expect(mockReleaseCapture).toHaveBeenCalledWith(
        "source-1",
        "active-output-manager",
      ),
    );
    render(<LocalVideoCaptureManager />);

    await waitFor(() => expect(mockAcquireCapture).toHaveBeenCalledTimes(2));
  });

  it("does not restart capture recovery for unrelated presentation changes", async () => {
    jest.useFakeTimers();
    const setIntervalSpy = jest.spyOn(window, "setInterval");
    const view = render(<LocalVideoCaptureManager />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const intervalCount = setIntervalSpy.mock.calls.length;
    const acquisitionCount = mockAcquireCapture.mock.calls.length;
    const output = mockState.presentation.outputs.projector;
    mockState.presentation.outputs = {
      projector: {
        ...output,
        prevInfo: output.prevInfo,
        itemContentBlocked: true,
      },
    };
    view.rerender(<LocalVideoCaptureManager />);

    expect(setIntervalSpy).toHaveBeenCalledTimes(intervalCount);
    expect(mockAcquireCapture).toHaveBeenCalledTimes(acquisitionCount);
    setIntervalSpy.mockRestore();
  });

  it("reconciles when the saved device binding changes", async () => {
    const view = render(<LocalVideoCaptureManager />);
    await waitFor(() => expect(mockAcquireCapture).toHaveBeenCalledTimes(1));

    mockResolveBinding.mockReturnValue({
      sourceId: "source-1",
      deviceId: "capture-card-2",
      deviceLabel: "USB Capture",
    });
    mockState.presentation.outputs = {
      projector: {
        ...mockState.presentation.outputs.projector,
        isTransmitting: false,
      },
    };
    view.rerender(<LocalVideoCaptureManager />);

    await waitFor(() => expect(mockAcquireCapture).toHaveBeenLastCalledWith(
      "source-1",
      expect.objectContaining({ deviceId: "capture-card-2" }),
      true,
      "active-output-manager",
    ));
  });

  it("releases the capture when no output is using the source", async () => {
    const view = render(<LocalVideoCaptureManager />);
    await waitFor(() => expect(mockAcquireCapture).toHaveBeenCalledTimes(1));
    jest.useFakeTimers();

    mockState.presentation.outputs = {
      projector: {
        ...mockState.presentation.outputs.projector,
        info: {},
      },
    };
    view.rerender(<LocalVideoCaptureManager />);

    act(() => jest.advanceTimersByTime(4_999));
    expect(mockReleaseCapture).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(mockReleaseCapture).toHaveBeenCalledWith(
      "source-1",
      "active-output-manager",
    );
  });

  it("cancels pending release when the video returns during the warm grace", async () => {
    const view = render(<LocalVideoCaptureManager />);
    await waitFor(() => expect(mockAcquireCapture).toHaveBeenCalledTimes(1));
    jest.useFakeTimers();

    mockState.presentation.outputs = {
      projector: {
        ...mockState.presentation.outputs.projector,
        info: {},
      },
    };
    view.rerender(<LocalVideoCaptureManager />);
    act(() => jest.advanceTimersByTime(2_500));

    mockState.presentation.outputs.projector.info.localVideoInput =
      localVideoInput;
    view.rerender(<LocalVideoCaptureManager />);
    act(() => jest.advanceTimersByTime(5_000));

    expect(mockReleaseCapture).not.toHaveBeenCalled();
    expect(mockAcquireCapture).toHaveBeenCalledTimes(1);
  });

  it("keeps list-warmed capture open after the live output clears", async () => {
    const view = render(<LocalVideoCaptureManager />);
    await waitFor(() => expect(mockAcquireCapture).toHaveBeenCalledTimes(1));
    jest.useFakeTimers();

    warmSourceIds = ["source-1"];
    act(() =>
      warmIntentListener?.({ sourceIds: warmSourceIds, updatedAt: Date.now() }),
    );

    mockState.presentation.outputs = {
      projector: {
        ...mockState.presentation.outputs.projector,
        info: {},
      },
    };
    view.rerender(<LocalVideoCaptureManager />);
    act(() => jest.advanceTimersByTime(5_000));

    expect(mockReleaseCapture).not.toHaveBeenCalled();
  });

  it("drops its consumer registration when another window owns capture", async () => {
    mockAcquireCapture.mockRejectedValue(new LocalVideoCaptureOwnedError());
    render(<LocalVideoCaptureManager />);

    await waitFor(() =>
      expect(mockReleaseCapture).toHaveBeenCalledWith(
        "source-1",
        "active-output-manager",
      ),
    );
  });

  it("does not open hardware owned by another workstation", async () => {
    mockGetDeviceId.mockReturnValue("remote-device");
    render(<LocalVideoCaptureManager />);

    await Promise.resolve();
    expect(mockAcquireCapture).not.toHaveBeenCalled();
  });

  it("reports a missing local binding as an actionable issue", async () => {
    mockResolveBinding.mockReturnValue(undefined);
    render(<LocalVideoCaptureManager />);

    await waitFor(() =>
      expect(mockReportLocalVideoIssue).toHaveBeenCalledWith(
        "source-1",
        "Relink USB Capture on this computer, then try again.",
      ),
    );
  });

  it("reports an actual capture failure", async () => {
    mockAcquireCapture.mockRejectedValue(
      new DOMException("Denied", "NotAllowedError"),
    );
    render(<LocalVideoCaptureManager />);

    await waitFor(() =>
      expect(mockReportLocalVideoIssue).toHaveBeenCalledWith(
        "source-1",
        "Check the video input.",
      ),
    );
  });
});
