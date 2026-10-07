import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { FloatingWindowZIndexProvider } from "../FloatingWindow/FloatingWindowZIndexContext";
import { useRehearsalPlayback } from "./RehearsalPlaybackContext";
import RehearsalPlayerWindow from "./RehearsalPlayerWindow";

jest.mock("./RehearsalPlaybackContext", () => ({ useRehearsalPlayback: jest.fn() }));

const entry = { entryKey: "song-1", title: "Song One", source: { kind: "youtube" } };
const togglePlayback = jest.fn();
const next = jest.fn();
const stop = jest.fn();
const closeRequested = jest.fn();

const setPlayback = (overrides = {}) => {
  jest.mocked(useRehearsalPlayback).mockReturnValue({
    currentEntry: entry, queue: [entry, { ...entry, entryKey: "song-2" }],
    currentTime: 20, duration: 180, isPlaying: true, isLoading: false,
    volume: 0.5, togglePlayback, next, stop, closeRequested,
    ...overrides,
  } as unknown as ReturnType<typeof useRehearsalPlayback>);
};

const player = () => (
  <FloatingWindowZIndexProvider>
    <RehearsalPlayerWindow youtubeEngine={<div data-testid="media-engine" />} />
  </FloatingWindowZIndexProvider>
);

describe("minimized rehearsal controls", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setPlayback();
  });

  it("pauses, resumes, and skips without restoring or remounting the media engine", async () => {
    const user = userEvent.setup();
    const { rerender } = render(player());
    const engine = screen.getByTestId("media-engine");
    await user.click(screen.getByRole("button", { name: "Minimize window" }));
    await screen.findByRole("button", { name: "Restore window" });
    expect(screen.getByTestId("floating-window")).toHaveStyle({ width: "300px" });
    expect(screen.queryByRole("slider", { name: "Rehearsal progress" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Pause rehearsal" }));
    expect(togglePlayback).toHaveBeenCalledTimes(1);
    setPlayback({ isPlaying: false });
    rerender(player());
    await user.tab();
    expect(screen.getByRole("button", { name: "Next song" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(next).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Play rehearsal" }));
    expect(togglePlayback).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Restore window" })).toBeInTheDocument();
    expect(screen.getByTestId("media-engine")).toBe(engine);
    expect(stop).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Restore window" }));
    expect(await screen.findByRole("slider", { name: "Rehearsal progress" })).toBeInTheDocument();
    expect(screen.getByTestId("media-engine")).toBe(engine);
  });

  it("keeps loading and single-song restrictions in the minimized bar", async () => {
    setPlayback({ isLoading: true, queue: [entry] });
    const user = userEvent.setup();
    render(player());
    await user.click(screen.getByRole("button", { name: "Minimize window" }));
    await screen.findByRole("button", { name: "Restore window" });
    expect(screen.getByRole("button", { name: "Loading rehearsal" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next song" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Close window" }));
    expect(closeRequested).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
  });
});
