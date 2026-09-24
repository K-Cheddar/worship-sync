import type {
  ItemSlideType,
  MediaType,
  VideoBackgroundSendMode,
} from "../types";
import { serverNow } from "./serverTime";
import {
  buildVideoPlaybackCueForSend,
  createVideoPreviewReporter,
  formatVideoClock,
  getSlideVideoBackgroundMedia,
  getVideoBackgroundMediaKey,
  getVideoPreviewSnapshot,
  isFileVideoBackground,
  applyVideoBackgroundTransport,
  reportVideoPreviewState,
  resetVideoBackgroundPlaybackForTests,
  resolveVideoCueCorrection,
  resolveEditorPreviewVideoPlayback,
  resolveSyncedVideoPlayback,
  resolveVideoCueDrift,
  resolveVideoPlaybackPosition,
  seekVideoPreview,
  subscribeVideoPreviewCommands,
  subscribeVideoPreviewSnapshot,
} from "./videoBackgroundPlayback";

jest.mock("./serverTime", () => ({
  serverNow: jest.fn(() => 1_000_000),
}));

const videoMedia = (overrides: Partial<MediaType> = {}): MediaType => ({
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
  ...overrides,
});

const slideWithVideo = (
  media: MediaType,
  videoBackgroundSendMode?: VideoBackgroundSendMode,
): ItemSlideType => ({
  id: "slide-1",
  ...(videoBackgroundSendMode ? { videoBackgroundSendMode } : {}),
  type: "Section",
  name: "Verse",
  boxes: [
    {
      id: "bg",
      width: 100,
      height: 100,
      background: media.background,
      mediaInfo: media,
    },
  ],
});

describe("videoBackgroundPlayback", () => {
  beforeEach(() => {
    resetVideoBackgroundPlaybackForTests();
    (serverNow as jest.Mock).mockReturnValue(1_000_000);
  });

  it("identifies file video backgrounds and skips live camera inputs", () => {
    expect(isFileVideoBackground(videoMedia())).toBe(true);
    expect(
      isFileVideoBackground(
        videoMedia({ background: "local-video-input://cam-1" }),
      ),
    ).toBe(false);
    expect(
      getVideoBackgroundMediaKey(
        videoMedia({
          localVideoFile: {
            id: "file-1",
            ownerDeviceId: "d1",
            ownerLabel: "Booth",
            fileName: "loop.mp4",
            contentType: "video/mp4",
            storagePolicy: "local-only",
            contentRevision: "rev-2",
          },
        }),
      ),
    ).toBe("local-video:file-1:rev-2");
    expect(getSlideVideoBackgroundMedia(slideWithVideo(videoMedia()))?.id).toBe(
      "video-1",
    );
  });

  it("uses one cloud identity when a local source is not playable", () => {
    expect(
      getVideoBackgroundMediaKey(
        videoMedia({
          muxPlaybackId: "mux-playback-1",
          localVideoFile: {
            id: "file-1",
            ownerDeviceId: "d1",
            ownerLabel: "Booth",
            fileName: "camera.mov",
            contentType: "video/quicktime",
            storagePolicy: "local-and-cloud",
            preferCloudPlayback: true,
          },
        }),
      ),
    ).toBe("remote:mux-playback-1");
  });

  it("formats a compact video clock", () => {
    expect(formatVideoClock(0)).toBe("0:00");
    expect(formatVideoClock(12.9)).toBe("0:12");
    expect(formatVideoClock(75)).toBe("1:15");
    expect(formatVideoClock(3661)).toBe("1:01:01");
    expect(formatVideoClock(Number.NaN)).toBe("0:00");
  });

  it("advances a playing cue by elapsed server time and wraps duration", () => {
    expect(
      resolveVideoPlaybackPosition(
        { positionSeconds: 10, paused: false, atServerMs: 1_000_000 },
        60,
        1_002_500,
      ),
    ).toBe(12.5);
    expect(
      resolveVideoPlaybackPosition(
        { positionSeconds: 10, paused: true, atServerMs: 1_000_000 },
        60,
        1_002_500,
      ),
    ).toBe(10);
    expect(
      resolveVideoPlaybackPosition(
        { positionSeconds: 58, paused: false, atServerMs: 1_000_000 },
        60,
        1_005_000,
      ),
    ).toBe(3);
  });

  it("restarts the preview and sends a zero cue in restart mode", () => {
    reportVideoPreviewState({
      mediaKey: "remote:video-1",
      currentTime: 14,
      duration: 40,
      paused: false,
    });
    const commands: string[] = [];
    const unsubscribe = subscribeVideoPreviewCommands("remote:video-1", (command) => {
      commands.push(command.type);
    });

    const cue = buildVideoPlaybackCueForSend(
      slideWithVideo(videoMedia(), "restart"),
    );

    expect(commands).toEqual(["restart"]);
    expect(cue).toMatchObject({
      mediaKey: "remote:video-1",
      positionSeconds: 0,
      paused: false,
      applySeek: true,
    });
    unsubscribe();
  });

  it("continues from the preview playhead only after the operator changes it", () => {
    reportVideoPreviewState({
      mediaKey: "remote:video-1",
      currentTime: 18.25,
      duration: 40,
      paused: true,
    });

    const first = buildVideoPlaybackCueForSend(slideWithVideo(videoMedia()));
    expect(first).toMatchObject({
      positionSeconds: 18.25,
      // Sending always plays, even though the preview was left paused here.
      paused: false,
      applySeek: false,
    });

    seekVideoPreview("remote:video-1", 22);
    const afterSeek = buildVideoPlaybackCueForSend(
      slideWithVideo(videoMedia()),
    );
    expect(afterSeek).toMatchObject({
      applySeek: true,
    });
  });

  it("starts a different video from the beginning in continue mode", () => {
    reportVideoPreviewState({
      mediaKey: "remote:other",
      currentTime: 9,
      duration: 20,
      paused: false,
    });

    const cue = buildVideoPlaybackCueForSend(slideWithVideo(videoMedia()));
    expect(cue).toMatchObject({
      mediaKey: "remote:video-1",
      positionSeconds: 0,
      paused: false,
      applySeek: true,
    });
  });

  /**
   * The song case the per-slide setting exists for: one looping background
   * shared across an item, restarting on the opener and continuing over every
   * lyric advance after it.
   */
  it("reads the send mode from the slide being sent, not a global setting", () => {
    reportVideoPreviewState({
      mediaKey: "remote:video-1",
      currentTime: 21,
      duration: 40,
      paused: false,
    });

    const opener = buildVideoPlaybackCueForSend(
      slideWithVideo(videoMedia(), "restart"),
    );
    expect(opener).toMatchObject({ positionSeconds: 0, applySeek: true });

    reportVideoPreviewState({
      mediaKey: "remote:video-1",
      currentTime: 21,
      duration: 40,
      paused: false,
    });
    const advance = buildVideoPlaybackCueForSend(
      slideWithVideo(videoMedia(), "continue"),
    );
    expect(advance).toMatchObject({ positionSeconds: 21, applySeek: false });
  });

  it("starts a paused preview playing when the slide is sent", () => {
    reportVideoPreviewState({
      mediaKey: "remote:video-1",
      currentTime: 30,
      duration: 40,
      paused: true,
    });

    expect(
      buildVideoPlaybackCueForSend(slideWithVideo(videoMedia())),
    ).toMatchObject({ positionSeconds: 30, paused: false });
  });

  /**
   * A controller that just joined has no preview snapshot for a video the
   * projector is already playing. Without deferring to the live cue it would
   * send position zero and visibly restart the output.
   */
  it("continues from the live output when this controller has no preview state", () => {
    (serverNow as jest.Mock).mockReturnValue(1_006_000);

    const cue = buildVideoPlaybackCueForSend(slideWithVideo(videoMedia()), {
      liveCue: {
        mediaKey: "remote:video-1",
        positionSeconds: 12,
        paused: false,
        atServerMs: 1_000_000,
        generation: 5,
        applySeek: false,
      },
    });

    // 12s at the cue stamp, six seconds ago.
    expect(cue).toMatchObject({
      mediaKey: "remote:video-1",
      positionSeconds: 18,
      paused: false,
      applySeek: false,
    });
  });

  it("resumes a paused live output from where it was held", () => {
    (serverNow as jest.Mock).mockReturnValue(1_009_000);

    expect(
      buildVideoPlaybackCueForSend(slideWithVideo(videoMedia()), {
        liveCue: {
          mediaKey: "remote:video-1",
          positionSeconds: 4.5,
          paused: true,
          atServerMs: 1_000_000,
          generation: 5,
          applySeek: false,
        },
      }),
    ).toMatchObject({ positionSeconds: 4.5, paused: false, applySeek: false });
  });

  it("ignores a live cue belonging to a different video", () => {
    reportVideoPreviewState({
      mediaKey: "remote:video-1",
      currentTime: 3,
      duration: 40,
      paused: false,
    });

    expect(
      buildVideoPlaybackCueForSend(slideWithVideo(videoMedia()), {
        liveCue: {
          mediaKey: "remote:something-else",
          positionSeconds: 99,
          paused: false,
          atServerMs: 1_000_000,
          generation: 5,
          applySeek: false,
        },
      }),
    ).toMatchObject({ positionSeconds: 3 });
  });

  it("lets the operator's own scrub win over the live playhead", () => {
    reportVideoPreviewState({
      mediaKey: "remote:video-1",
      currentTime: 3,
      duration: 40,
      paused: false,
    });
    seekVideoPreview("remote:video-1", 27);

    expect(
      buildVideoPlaybackCueForSend(slideWithVideo(videoMedia()), {
        liveCue: {
          mediaKey: "remote:video-1",
          positionSeconds: 12,
          paused: false,
          atServerMs: 1_000_000,
          generation: 5,
          applySeek: false,
        },
      }),
    ).toMatchObject({ applySeek: true });
  });

  it("treats a slide with no stored send mode as continue", () => {
    reportVideoPreviewState({
      mediaKey: "remote:video-1",
      currentTime: 8.5,
      duration: 40,
      paused: false,
    });

    expect(
      buildVideoPlaybackCueForSend(slideWithVideo(videoMedia())),
    ).toMatchObject({ positionSeconds: 8.5, applySeek: false });
  });

  it("marks the preview dirty on play and pause commands", () => {
    reportVideoPreviewState({
      mediaKey: "remote:video-1",
      currentTime: 4,
      duration: 40,
      paused: false,
    });
    buildVideoPlaybackCueForSend(slideWithVideo(videoMedia()));

    applyVideoBackgroundTransport({
      mediaKey: "remote:video-1",
      positionSeconds: 4,
      paused: true,
      applySeek: true,
    });
    const cue = buildVideoPlaybackCueForSend(slideWithVideo(videoMedia()));
    expect(cue?.applySeek).toBe(true);
    expect(getVideoPreviewSnapshot("remote:video-1").mediaKey).toBe("remote:video-1");
    expect(getVideoPreviewSnapshot("remote:video-1").paused).toBe(true);
  });

  it("does not let transport on one clip force another clip to restart", () => {
    reportVideoPreviewState({
      mediaKey: "remote:other",
      currentTime: 6,
      duration: 30,
      paused: false,
    });
    applyVideoBackgroundTransport({
      mediaKey: "remote:other",
      positionSeconds: 6,
      paused: true,
      applySeek: true,
    });

    // The operator paused a different clip; sending this one should still
    // continue from its own preview playhead rather than seeking to 0.
    reportVideoPreviewState({
      mediaKey: "remote:video-1",
      currentTime: 11,
      duration: 40,
      paused: false,
    });
    const cue = buildVideoPlaybackCueForSend(slideWithVideo(videoMedia()));

    expect(cue).toMatchObject({
      mediaKey: "remote:video-1",
      positionSeconds: 11,
      applySeek: false,
    });
  });

  it("skips snapshot notifications that would not change the transport UI", () => {
    const seen: number[] = [];
    const unsubscribe = subscribeVideoPreviewSnapshot("remote:video-1", (next) =>
      seen.push(next.currentTime),
    );

    reportVideoPreviewState({
      mediaKey: "remote:video-1",
      currentTime: 12,
      duration: 40,
      paused: false,
    });
    // `timeupdate` fires several times a second; sub-frame moves are noise.
    reportVideoPreviewState({
      mediaKey: "remote:video-1",
      currentTime: 12.01,
      duration: 40,
      paused: false,
    });
    reportVideoPreviewState({
      mediaKey: "remote:video-1",
      currentTime: 12.5,
      duration: 40,
      paused: false,
    });

    expect(seen).toEqual([12, 12.5]);
    unsubscribe();
  });

  it("keeps snapshots and subscriptions isolated by media key", () => {
    const seenA: number[] = [];
    const unsubscribe = subscribeVideoPreviewSnapshot("media:A", (next) =>
      seenA.push(next.currentTime),
    );
    reportVideoPreviewState({
      mediaKey: "media:A",
      currentTime: 4,
      duration: 10,
      paused: false,
    });
    reportVideoPreviewState({
      mediaKey: "media:B",
      currentTime: 37,
      duration: 59,
      paused: true,
    });

    expect(getVideoPreviewSnapshot("media:A")).toMatchObject({
      currentTime: 4,
      duration: 10,
      paused: false,
    });
    expect(seenA).toEqual([4]);
    unsubscribe();
  });

  it("ignores reports and cleanup from a superseded media reporter", () => {
    const oldPreparedOwner = createVideoPreviewReporter("media:A");
    oldPreparedOwner.report({
      mediaKey: "media:A",
      currentTime: 8,
      duration: 10,
      paused: false,
    });
    const newFallbackOwner = createVideoPreviewReporter("media:A");
    newFallbackOwner.report({
      mediaKey: "media:A",
      currentTime: 2,
      duration: 10,
      paused: true,
    });

    oldPreparedOwner.clear();
    oldPreparedOwner.report({
      mediaKey: "media:A",
      currentTime: 9,
      duration: 59,
      paused: false,
    });

    expect(getVideoPreviewSnapshot("media:A")).toMatchObject({
      currentTime: 2,
      duration: 10,
      paused: true,
    });
    newFallbackOwner.clear();
    expect(getVideoPreviewSnapshot("media:A")).toMatchObject({
      currentTime: 0,
      duration: 0,
      paused: true,
    });
  });

  it("stamps generations from server time so a restart cannot look stale", () => {
    // Outputs keep the last generation they received, and that outlives the
    // session. A counter restarting at 1 would be rejected as older than what
    // a live output already holds, freezing transport for the whole service.
    reportVideoPreviewState({
      mediaKey: "remote:video-1",
      currentTime: 3,
      duration: 40,
      paused: false,
    });

    const first = buildVideoPlaybackCueForSend(slideWithVideo(videoMedia()));
    expect(first?.generation).toBeGreaterThanOrEqual(1_000_000);

    const second = applyVideoBackgroundTransport({
      mediaKey: "remote:video-1",
      positionSeconds: 3,
      paused: true,
      applySeek: false,
    });
    expect(second.generation).toBeGreaterThan(first!.generation);
  });

  describe("resolveEditorPreviewVideoPlayback", () => {
    const liveCue = {
      mediaKey: "remote:video-1",
      positionSeconds: 8,
      paused: false,
      atServerMs: 1_000_000,
      generation: 4,
      applySeek: false,
    };

    it("returns the live cue when the selected slide is transmitting", () => {
      const slide = slideWithVideo(videoMedia());
      expect(
        resolveEditorPreviewVideoPlayback(
          {
            projector: {
              isTransmitting: true,
              info: { slide, videoPlayback: liveCue },
            },
          },
          slide,
        ),
      ).toEqual(liveCue);
    });

    it("starts a local preview cue when the selected slide is not on air", () => {
      const selected = slideWithVideo(videoMedia());
      const other = { ...selected, id: "slide-2" };
      expect(
        resolveEditorPreviewVideoPlayback(
          {
            projector: {
              isTransmitting: true,
              info: { slide: other, videoPlayback: liveCue },
            },
          },
          selected,
        ),
      ).toEqual(
        expect.objectContaining({
          mediaKey: "remote:video-1",
          positionSeconds: 0,
          paused: false,
          generation: 0,
        }),
      );
    });

    it("picks the newest matching cue across transmitting outputs", () => {
      const slide = slideWithVideo(videoMedia());
      expect(
        resolveSyncedVideoPlayback(
          {
            projector: {
              isTransmitting: true,
              info: { videoPlayback: { ...liveCue, generation: 2 } },
            },
            stream: {
              isTransmitting: true,
              info: { videoPlayback: { ...liveCue, generation: 7 } },
            },
          },
          "remote:video-1",
        )?.generation,
      ).toBe(7);
      expect(
        resolveEditorPreviewVideoPlayback(
          {
            projector: {
              isTransmitting: true,
              info: {
                slide,
                videoPlayback: { ...liveCue, generation: 2 },
              },
            },
            stream: {
              isTransmitting: true,
              info: {
                slide,
                videoPlayback: { ...liveCue, generation: 7 },
              },
            },
          },
          slide,
        )?.generation,
      ).toBe(7);
    });
  });

  describe("resolveVideoCueDrift", () => {
    const playingCue = {
      positionSeconds: 10,
      paused: false,
      atServerMs: 1_000_000,
    };

    it("reports how far a surface trails the cue clock", () => {
      (serverNow as jest.Mock).mockReturnValue(1_002_000);
      expect(resolveVideoCueDrift(playingCue, 11, 40)).toBeCloseTo(1, 3);
      expect(resolveVideoCueDrift(playingCue, 13, 40)).toBeCloseTo(-1, 3);
    });

    it("folds the loop wrap so a just-looped surface reads as barely ahead", () => {
      // Cue clock is at 39.5s of a 40s loop; the surface already wrapped to 0.2s.
      (serverNow as jest.Mock).mockReturnValue(1_029_500);
      expect(resolveVideoCueDrift(playingCue, 0.2, 40)).toBeCloseTo(-0.7, 3);
    });
  });

  describe("resolveVideoCueCorrection", () => {
    it("leaves small drift alone and restores a corrected rate in tolerance", () => {
      expect(resolveVideoCueCorrection(0.2, 1)).toEqual({
        correction: "none",
        playbackRate: 1,
        shouldSeek: false,
      });
      expect(resolveVideoCueCorrection(0.2, 1.02)).toEqual({
        correction: "return to 1x",
        playbackRate: 1,
        shouldSeek: false,
      });
    });

    it("uses bounded rate convergence for moderate drift", () => {
      expect(resolveVideoCueCorrection(0.7, 1)).toEqual({
        correction: "speed up",
        playbackRate: 1.014,
        shouldSeek: false,
      });
      expect(resolveVideoCueCorrection(-0.7, 1)).toEqual({
        correction: "slow down",
        playbackRate: 0.986,
        shouldSeek: false,
      });
      expect(resolveVideoCueCorrection(1.4, 1)).toEqual({
        correction: "speed up",
        playbackRate: 1.02,
        shouldSeek: false,
      });
      expect(resolveVideoCueCorrection(-1.4, 1)).toEqual({
        correction: "slow down",
        playbackRate: 0.98,
        shouldSeek: false,
      });
    });

    it("uses a hard seek for large or invalid drift", () => {
      expect(resolveVideoCueCorrection(1.5, 1.02)).toEqual({
        correction: "hard seek",
        playbackRate: 1,
        shouldSeek: true,
      });
      expect(resolveVideoCueCorrection(Number.NaN, 1.02)).toEqual({
        correction: "hard seek",
        playbackRate: 1,
        shouldSeek: true,
      });
    });
  });
});
