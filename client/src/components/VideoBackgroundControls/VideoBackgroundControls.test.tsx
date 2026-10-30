import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MediaType, VideoBackgroundPlaybackCue } from "../../types";
import {
  reportVideoPreviewState,
  resetVideoBackgroundPlaybackForTests,
  subscribeVideoPreviewCommands,
} from "../../utils/videoBackgroundPlayback";
import VideoBackgroundControls from "./VideoBackgroundControls";

const mockDispatch = jest.fn();
const mockSendModeChange = jest.fn();
const mockLoopChange = jest.fn();
let mockLiveCue: VideoBackgroundPlaybackCue;

let mockServerTime = 1_006_000;
jest.mock("../../utils/serverTime", () => ({ serverNow: () => mockServerTime }));

jest.mock("../../hooks", () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: (state: unknown) => unknown) =>
    selector({
      presentation: {
        outputs: {
          projector: {
            isTransmitting: true,
            info: {
              videoPlayback: mockLiveCue,
            },
          },
        },
      },
    }),
}));

jest.mock("../../store/presentationSlice", () => ({
  updateVideoPlayback: jest.fn((payload: unknown) => ({
    type: "presentation/updateVideoPlayback",
    payload,
  })),
}));

const media: MediaType = {
  path: "",
  createdAt: "",
  updatedAt: "",
  format: "mp4",
  height: 1080,
  width: 1920,
  name: "Loop",
  publicId: "loop-1",
  type: "video",
  id: "video-1",
  background: "https://cdn.example/loop.mp4",
  thumbnail: "",
  duration: 40,
};

describe("VideoBackgroundControls", () => {
  beforeEach(() => {
    resetVideoBackgroundPlaybackForTests();
    mockServerTime = 1_006_000;
    mockLiveCue = { mediaKey: "remote:video-1", positionSeconds: 12, paused: false, atServerMs: 1_000_000, generation: 3, applySeek: false, loop: true };
    mockDispatch.mockClear();
    mockSendModeChange.mockClear();
    mockLoopChange.mockClear();
    reportVideoPreviewState({
      mediaKey: "remote:video-1",
      currentTime: 12,
      duration: 40,
      paused: false,
    });
  });

  it("shows play/pause, the current time, and send-mode choices", () => {
    render(
      <VideoBackgroundControls
        media={media}
        mediaKey="remote:video-1"
        sendMode="continue"
        onSendModeChange={mockSendModeChange} loop={true} onLoopChange={mockLoopChange}
      />,
    );

    expect(screen.getByTestId("video-background-controls")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pause video" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Restart video from the beginning" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop video" })).toBeInTheDocument();
    expect(screen.getByText("0:12")).toBeInTheDocument();
    expect(screen.getByText("0:40")).toBeInTheDocument();
    expect(screen.getByLabelText("Video timeline")).toBeInTheDocument();
    expect(screen.getByText("On send")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start over" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Sending this slide keeps the video playing from where it is now.",
      ),
    ).toBeInTheDocument();
  });

  it("opens the send behavior explanation and preserves send-mode selection", async () => {
    const user = userEvent.setup();
    render(<VideoBackgroundControls media={media} mediaKey="remote:video-1" sendMode="continue" onSendModeChange={mockSendModeChange} loop={true} onLoopChange={mockLoopChange} />);
    await user.click(screen.getByRole("button", { name: "About video send behavior" }));
    expect(screen.getAllByText("Sending this slide keeps the video playing from where it is now.")).toHaveLength(2);
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Start over" }));
    expect(mockSendModeChange).toHaveBeenCalledWith("restart");
  });

  it("can show transport controls without send-mode guidance", () => {
    render(
      <VideoBackgroundControls
        media={media}
        mediaKey="remote:video-1"
        sendMode="continue"
        onSendModeChange={mockSendModeChange} loop={true} onLoopChange={mockLoopChange}
        showSendMode={false}
      />,
    );

    expect(screen.getByRole("button", { name: "Pause video" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restart video from the beginning" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop video" })).toBeInTheDocument();
    expect(screen.getByLabelText("Video timeline")).toBeInTheDocument();
    expect(screen.queryByText("On send")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start over" })).not.toBeInTheDocument();
    expect(
      screen.queryByText("Sending this slide keeps the video playing from where it is now."),
    ).not.toBeInTheDocument();
  });

  it("keeps the selected video timeline isolated from other mounted previews", () => {
    // The element's measured duration wins over potentially stale metadata.
    const selectedMedia = { ...media, duration: 12 };
    reportVideoPreviewState({
      mediaKey: "media:A",
      currentTime: 3.5,
      duration: 10,
      paused: false,
    });
    const { rerender } = render(
      <VideoBackgroundControls
        media={selectedMedia}
        mediaKey="media:A"
        sendMode="continue"
        onSendModeChange={mockSendModeChange} loop={true} onLoopChange={mockLoopChange}
      />,
    );

    act(() => {
      reportVideoPreviewState({
        mediaKey: "media:B",
        currentTime: 37,
        duration: 59,
        paused: true,
      });
    });

    const slider = screen.getByRole("slider");
    expect(slider).toHaveAttribute("aria-valuemax", "10");
    expect(slider).toHaveAttribute("aria-valuenow", "3.5");
    expect(screen.getByText("0:10")).toBeInTheDocument();
    expect(screen.queryByText("0:59")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pause video" })).toBeInTheDocument();

    rerender(
      <VideoBackgroundControls
        media={{ ...media, duration: 59 }}
        mediaKey="media:B"
        sendMode="continue"
        onSendModeChange={mockSendModeChange} loop={true} onLoopChange={mockLoopChange}
      />,
    );
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuemax", "59");
    expect(screen.getByText("0:37")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play video" })).toBeInTheDocument();
  });

  it("pauses the preview and syncs live outputs when configured", async () => {
    const user = userEvent.setup();
    const commands: string[] = [];
    const unsubscribe = subscribeVideoPreviewCommands("remote:video-1", (command) => {
      commands.push(command.type);
    });

    render(
      <VideoBackgroundControls
        media={media}
        mediaKey="remote:video-1"
        syncOutputIds={["projector"]}
        sendMode="continue"
        onSendModeChange={mockSendModeChange} loop={true} onLoopChange={mockLoopChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Pause video" }));

    expect(commands).toEqual([]);
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "presentation/updateVideoPlayback",
        payload: expect.objectContaining({
          outputIds: ["projector"],
          videoPlayback: expect.objectContaining({
            mediaKey: "remote:video-1",
            paused: true,
            applySeek: false,
          }),
        }),
      }),
    );
    expect(
      screen.getByText(
        "Sending this slide keeps the video playing from where it is now. Controls update the preview and live outputs together.",
      ),
    ).toBeInTheDocument();
    unsubscribe();
  });

  it("restarts the preview from the beginning while keeping it playing", async () => {
    const user = userEvent.setup();
    const commands: { type: string; positionSeconds?: number }[] = [];
    const unsubscribe = subscribeVideoPreviewCommands("remote:video-1", (command) => {
      commands.push(command as { type: string; positionSeconds?: number });
    });

    render(
      <VideoBackgroundControls
        media={media}
        mediaKey="remote:video-1"
        sendMode="continue"
        onSendModeChange={mockSendModeChange} loop={true} onLoopChange={mockLoopChange}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Restart video from the beginning" }),
    );

    expect(commands).toEqual([
      expect.objectContaining({ type: "seek", positionSeconds: 0 }),
      expect.objectContaining({ type: "play" }),
    ]);
    expect(screen.getByRole("button", { name: "Pause video" })).toBeInTheDocument();
    unsubscribe();
  });

  it("stops live outputs at the beginning", async () => {
    const user = userEvent.setup();

    render(
      <VideoBackgroundControls
        media={media}
        mediaKey="remote:video-1"
        syncOutputIds={["projector"]}
        sendMode="continue"
        onSendModeChange={mockSendModeChange} loop={true} onLoopChange={mockLoopChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Stop video" }));

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "presentation/updateVideoPlayback",
        payload: expect.objectContaining({
          outputIds: ["projector"],
          videoPlayback: expect.objectContaining({
            mediaKey: "remote:video-1",
            positionSeconds: 0,
            paused: true,
            applySeek: true,
          }),
        }),
      }),
    );
  });

  it("toggles Loop independently and rebases all live outputs without seeking", async () => {
    const user = userEvent.setup();
    render(<VideoBackgroundControls media={media} mediaKey="remote:video-1" syncOutputIds={["projector", "monitor", "stream"]} sendMode="restart" onSendModeChange={mockSendModeChange} loop onLoopChange={mockLoopChange} />);
    await user.click(screen.getByRole("switch", { name: "Loop:", checked: true }));
    expect(mockLoopChange).toHaveBeenCalledWith(false);
    expect(mockSendModeChange).not.toHaveBeenCalled();
    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        outputIds: ["projector", "monitor", "stream"],
        videoPlayback: expect.objectContaining({ loop: false, applySeek: false, paused: false }),
      }),
    }));
  });

  it("keeps Loop available without send-mode guidance and does not send local transport commands", async () => {
    const user = userEvent.setup();
    const commands: string[] = [];
    const unsubscribe = subscribeVideoPreviewCommands("remote:video-1", (command) => commands.push(command.type));
    render(<VideoBackgroundControls media={media} mediaKey="remote:video-1" sendMode="continue" onSendModeChange={mockSendModeChange} loop={false} onLoopChange={mockLoopChange} showSendMode={false} />);
    await user.click(screen.getByRole("switch", { name: "Loop:", checked: false }));
    expect(mockLoopChange).toHaveBeenCalledWith(true);
    expect(commands).toEqual([]);
    expect(mockDispatch).not.toHaveBeenCalled();
    unsubscribe();
  });


  it("disabling a wrapped live loop preserves its actual position", async () => {
    mockLiveCue = { ...mockLiveCue, positionSeconds: 38 };
    const user = userEvent.setup();
    render(<VideoBackgroundControls media={media} mediaKey="remote:video-1" syncOutputIds={["projector"]} sendMode="continue" onSendModeChange={mockSendModeChange} loop onLoopChange={mockLoopChange} />);
    await user.click(screen.getByRole("switch", { name: "Loop:" }));
    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ videoPlayback: expect.objectContaining({ positionSeconds: 4, loop: false, paused: false, applySeek: false }) }) }));
  });

  it("keeps a finished live video held when enabling Loop and allows explicit replay", async () => {
    mockLiveCue = { ...mockLiveCue, positionSeconds: 39, loop: false };
    const user = userEvent.setup();
    render(<VideoBackgroundControls media={media} mediaKey="remote:video-1" syncOutputIds={["projector"]} sendMode="continue" onSendModeChange={mockSendModeChange} loop={false} onLoopChange={mockLoopChange} />);
    expect(screen.getByRole("button", { name: "Play video" })).toBeInTheDocument();
    await user.click(screen.getByRole("switch", { name: "Loop:" }));
    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ videoPlayback: expect.objectContaining({ positionSeconds: 40, loop: true, paused: true, applySeek: false }) }) }));
    await user.click(screen.getByRole("button", { name: "Restart video from the beginning" }));
    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ videoPlayback: expect.objectContaining({ positionSeconds: 0, paused: false, applySeek: true, loop: false }) }) }));
  });


  it("smooths ordinary preview samples while snapping pause, seeks, wraparound, and completion", async () => {
    const user = userEvent.setup();
    render(<VideoBackgroundControls media={media} mediaKey="remote:video-1" sendMode="continue" onSendModeChange={mockSendModeChange} loop={false} onLoopChange={mockLoopChange} />);
    const timeline = screen.getByLabelText("Video timeline");
    expect(timeline).toHaveAttribute("data-smooth-progress", "false");
    const report = (currentTime: number, paused = false) => {
      act(() => reportVideoPreviewState({ mediaKey: "remote:video-1", currentTime, duration: 40, paused }));
    };
    report(12.25);
    expect(timeline).toHaveAttribute("data-smooth-progress", "true");
    expect(mockDispatch).not.toHaveBeenCalled();
    report(12.5, true);
    expect(timeline).toHaveAttribute("data-smooth-progress", "false");
    report(12.75);
    expect(timeline).toHaveAttribute("data-smooth-progress", "true");
    await user.click(screen.getByRole("button", { name: "Restart video from the beginning" }));
    report(0.25);
    expect(timeline).toHaveAttribute("data-smooth-progress", "true");
    // A small keyboard seek must snap too, despite looking like a normal sample.
    const thumb = screen.getByRole("slider");
    act(() => thumb.focus());
    await user.keyboard("{ArrowRight}");
    expect(timeline).toHaveAttribute("data-smooth-progress", "false");
    report(20);
    expect(timeline).toHaveAttribute("data-smooth-progress", "false");
    report(20.25);
    expect(timeline).toHaveAttribute("data-smooth-progress", "true");
    report(0);
    expect(timeline).toHaveAttribute("data-smooth-progress", "false");
    report(40, true);
    expect(timeline).toHaveAttribute("data-smooth-progress", "false");
  });

  it("smooths the live clock without smoothing an explicit remote seek", () => {
    jest.useFakeTimers();
    mockLiveCue = { ...mockLiveCue, atServerMs: mockServerTime, positionSeconds: 12, applySeek: true };
    const tree = () => <VideoBackgroundControls media={media} mediaKey="remote:video-1" syncOutputIds={["projector"]} sendMode="continue" onSendModeChange={mockSendModeChange} loop onLoopChange={mockLoopChange} />;
    const { rerender, unmount } = render(tree());
    const timeline = screen.getByLabelText("Video timeline");
    expect(timeline).toHaveAttribute("data-smooth-progress", "false");
    mockServerTime += 250;
    act(() => { jest.advanceTimersByTime(250); });
    expect(timeline).toHaveAttribute("data-smooth-progress", "true");
    mockLiveCue = { ...mockLiveCue, atServerMs: mockServerTime, positionSeconds: 12.5, generation: 4 };
    rerender(tree());
    expect(timeline).toHaveAttribute("data-smooth-progress", "false");
    mockServerTime += 250;
    act(() => { jest.advanceTimersByTime(250); });
    expect(timeline).toHaveAttribute("data-smooth-progress", "true");
    expect(mockDispatch).not.toHaveBeenCalled();
    unmount();
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
  });

});
