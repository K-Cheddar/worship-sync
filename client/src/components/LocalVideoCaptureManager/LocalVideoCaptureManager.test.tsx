import { act, render, waitFor } from "@testing-library/react";
import { getOrCreateDeviceId } from "../../utils/authStorage";
import {
  acquireWarmLocalVideoCapture,
  LocalVideoCaptureOwnedError,
  releaseWarmLocalVideoCapture,
} from "../../utils/localVideoCapturePool";
import { resolveLocalVideoInputBinding } from "../../utils/localVideoInput";
import { reportLocalVideoIssue } from "../../utils/localVideoIssues";
import LocalVideoCaptureManager from "./LocalVideoCaptureManager";

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

jest.mock("../../hooks", () => ({
  useSelector: (selector: (state: typeof mockState) => unknown) =>
    selector(mockState),
}));
jest.mock("../../utils/authStorage", () => ({
  getOrCreateDeviceId: jest.fn(),
}));
jest.mock("../../utils/localVideoCapturePool", () => ({
  acquireWarmLocalVideoCapture: jest.fn(),
  releaseWarmLocalVideoCapture: jest.fn(),
  LocalVideoCaptureOwnedError: class extends Error {},
}));
jest.mock("../../utils/localVideoInput", () => ({
  getVideoInputErrorMessage: jest.fn(() => "Check the video input."),
  resolveLocalVideoInputBinding: jest.fn(),
}));
jest.mock("../../utils/localVideoIssues", () => ({
  reportLocalVideoIssue: jest.fn(),
}));

const mockGetDeviceId = jest.mocked(getOrCreateDeviceId);
const mockAcquireCapture = jest.mocked(acquireWarmLocalVideoCapture);
const mockReleaseCapture = jest.mocked(releaseWarmLocalVideoCapture);
const mockResolveBinding = jest.mocked(resolveLocalVideoInputBinding);
const mockReportLocalVideoIssue = jest.mocked(reportLocalVideoIssue);

describe("LocalVideoCaptureManager", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetDeviceId.mockReturnValue("local-device");
    mockResolveBinding.mockReturnValue({
      sourceId: "source-1",
      deviceId: "capture-card-1",
      deviceLabel: "USB Capture",
    });
    mockAcquireCapture.mockResolvedValue({ stream: {} as MediaStream });
    mockReleaseCapture.mockResolvedValue();
    mockState.presentation.outputs.projector.info.localVideoInput =
      localVideoInput;
  });

  afterEach(() => {
    jest.useRealTimers();
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
    expect(mockResolveBinding).not.toHaveBeenCalled();
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
