import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MediaType } from "../../types";
import {
  reportVideoPreviewState,
  resetVideoBackgroundPlaybackForTests,
  subscribeVideoPreviewCommands,
} from "../../utils/videoBackgroundPlayback";
import VideoBackgroundControls from "./VideoBackgroundControls";

const mockDispatch = jest.fn();
const mockSendModeChange = jest.fn();

jest.mock("../../hooks", () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: (state: unknown) => unknown) =>
    selector({
      presentation: {
        outputs: {
          projector: {
            isTransmitting: true,
            info: {
              videoPlayback: {
                mediaKey: "remote:video-1",
                positionSeconds: 12,
                paused: false,
                atServerMs: 1_000_000,
                generation: 3,
                applySeek: false,
              },
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
    mockDispatch.mockClear();
    mockSendModeChange.mockClear();
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
        onSendModeChange={mockSendModeChange}
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

  it("pauses the preview and syncs live outputs when configured", async () => {
    const user = userEvent.setup();
    const commands: string[] = [];
    const unsubscribe = subscribeVideoPreviewCommands((command) => {
      commands.push(command.type);
    });

    render(
      <VideoBackgroundControls
        media={media}
        mediaKey="remote:video-1"
        syncOutputIds={["projector"]}
        sendMode="continue"
        onSendModeChange={mockSendModeChange}
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
    const unsubscribe = subscribeVideoPreviewCommands((command) => {
      commands.push(command as { type: string; positionSeconds?: number });
    });

    render(
      <VideoBackgroundControls
        media={media}
        mediaKey="remote:video-1"
        sendMode="continue"
        onSendModeChange={mockSendModeChange}
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
        onSendModeChange={mockSendModeChange}
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
});
