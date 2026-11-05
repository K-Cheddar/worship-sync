import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { GlobalInfoContext } from "../../context/globalInfo";
import type { DesktopVideoInspection } from "../../types/electron";
import DownloadVideoDialog from "./DownloadVideoDialog";

const mockStart = jest.fn();

jest.mock("../../components/DesktopVideoDownloadManager/DesktopVideoDownloadManager", () => ({
  useDesktopVideoDownload: () => ({ start: mockStart }),
}));

const makeInspection = (title: string, videoUrl: string): DesktopVideoInspection => ({
  inspectionId: `inspection-${title}`,
  videoUrl,
  title,
  thumbnail: "",
  duration: 60,
  heights: [720],
  defaultQuality: 720,
});

const Harness = () => {
  const [open, setOpen] = useState(true);
  return (
    <GlobalInfoContext.Provider value={{ churchId: "church-1" } as never}>
      <button type="button" onClick={() => setOpen(true)}>Reopen downloader</button>
      <DownloadVideoDialog
        open={open}
        onOpenChange={setOpen}
        isGuestSession={false}
        controllerProfileId="presentation"
        folderId={null}
        routePath="/controller"
      />
    </GlobalInfoContext.Provider>
  );
};

const settlePromises = async () => act(async () => {
  await Promise.resolve();
  await Promise.resolve();
});

const advanceInspectionDebounce = async () => act(async () => {
  jest.advanceTimersByTime(450);
  await Promise.resolve();
  await Promise.resolve();
});

describe("DownloadVideoDialog inspection lifecycle", () => {
  const originalElectronApi = window.electronAPI;
  const inspectVideoUrl = jest.fn();

  beforeEach(() => {
    jest.useFakeTimers();
    mockStart.mockReset();
    inspectVideoUrl.mockReset();
    window.electronAPI = { inspectVideoUrl } as unknown as typeof window.electronAPI;
  });

  afterEach(() => {
    jest.useRealTimers();
    window.electronAPI = originalElectronApi;
  });

  it("ignores an older result when the URL changes during inspection", async () => {
    let resolveFirst!: (value: DesktopVideoInspection) => void;
    let resolveSecond!: (value: DesktopVideoInspection) => void;
    inspectVideoUrl
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));
    render(<Harness />);

    fireEvent.change(screen.getByRole("textbox", { name: /video url/i }), {
      target: { value: "https://youtu.be/S9EUEdnJQDA?list=RDS9EUEdnJQDA" },
    });
    await advanceInspectionDebounce();
    expect(inspectVideoUrl).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByRole("textbox", { name: /video url/i }), {
      target: { value: "https://www.youtube.com/watch?v=hujbT5BXyrl" },
    });
    expect(screen.queryByText("Old video title")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /media name/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Download" })).toBeDisabled();

    await act(async () => {
      resolveFirst(makeInspection("Old video title", "https://www.youtube.com/watch?v=S9EUEdnJQDA"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByText("Old video title")).not.toBeInTheDocument();

    await advanceInspectionDebounce();
    expect(inspectVideoUrl).toHaveBeenCalledTimes(2);
    await act(async () => {
      resolveSecond(makeInspection("Current video title", "https://www.youtube.com/watch?v=hujbT5BXyrl"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText("Current video title")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /media name/i })).toHaveValue("Current video title");
  });

  it("clears previous metadata after a failed inspection and offers retry", async () => {
    inspectVideoUrl
      .mockResolvedValueOnce(makeInspection("First video", "https://www.youtube.com/watch?v=S9EUEdnJQDA"))
      .mockRejectedValueOnce(new Error("Error invoking remote method 'inspect-video-url': Error: This YouTube video is unavailable, private, or has been removed."))
      .mockResolvedValueOnce(makeInspection("Retried video", "https://www.youtube.com/watch?v=hujbT5BXyrl"));
    render(<Harness />);

    fireEvent.change(screen.getByRole("textbox", { name: /video url/i }), {
      target: { value: "https://www.youtube.com/watch?v=S9EUEdnJQDA" },
    });
    await advanceInspectionDebounce();
    expect(screen.getByText("First video")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: /video url/i }), {
      target: { value: "https://www.youtube.com/watch?v=hujbT5BXyrl" },
    });
    expect(screen.queryByText("First video")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /media name/i })).toBeDisabled();

    await advanceInspectionDebounce();
    await settlePromises();
    expect(screen.getByRole("alert")).toHaveTextContent(/unavailable, private, or has been removed/i);
    expect(screen.getByRole("alert")).not.toHaveTextContent(/Error invoking remote method/);
    expect(screen.queryByText("First video")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /media name/i })).toHaveValue("");
    expect(screen.getByRole("button", { name: "Download" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Retry inspection" }));
    await advanceInspectionDebounce();
    await settlePromises();
    expect(inspectVideoUrl).toHaveBeenCalledTimes(3);
    expect(screen.getByText("Retried video")).toBeInTheDocument();
  });

  it("clears inspection state when closed and reopened without stopping a started job", async () => {
    inspectVideoUrl.mockResolvedValueOnce(makeInspection(
      "Downloaded video title",
      "https://www.youtube.com/watch?v=S9EUEdnJQDA",
    ));
    mockStart.mockReturnValue("job-one");
    render(<Harness />);

    fireEvent.change(screen.getByRole("textbox", { name: /video url/i }), {
      target: { value: "https://www.youtube.com/watch?v=S9EUEdnJQDA" },
    });
    await advanceInspectionDebounce();
    await settlePromises();
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    await settlePromises();

    expect(mockStart).toHaveBeenCalledWith(expect.objectContaining({
      inspectedUrl: "https://www.youtube.com/watch?v=S9EUEdnJQDA",
    }));
    expect(screen.queryByText("Downloaded video title")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reopen downloader" }));
    expect(screen.queryByText("Downloaded video title")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /video url/i })).toHaveValue("");
    expect(inspectVideoUrl).toHaveBeenCalledTimes(1);
  });
});
