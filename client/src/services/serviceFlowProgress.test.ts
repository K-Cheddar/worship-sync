import { getServiceFlowProgress } from "./serviceFlowProgress";
import type { PublicServiceFlow } from "./serviceFlowTypes";

const service: PublicServiceFlow = {
  shareId: "u3x4q_9k2p8m1v7c5a6d0e4f",
  title: "Sunday Service",
  startsAt: "2026-07-26T14:00:00.000Z",
  timezone: "America/New_York",
  revision: 1,
  live: { mode: "schedule" },
  sections: [{
    id: "main",
    title: "Main",
    items: [
      { id: "welcome", title: "Welcome", durationSeconds: 300, notes: { blocks: [] } },
      { id: "song", title: "Opening Song", durationSeconds: 240, notes: { blocks: [] } },
    ],
  }],
};

describe("getServiceFlowProgress", () => {
  it("uses planned duration boundaries and completes after the final item", () => {
    const startsAt = Date.parse(service.startsAt);
    const before = getServiceFlowProgress(service, startsAt - 1);
    const first = getServiceFlowProgress(service, startsAt);
    const second = getServiceFlowProgress(service, startsAt + 300_000);
    const complete = getServiceFlowProgress(service, startsAt + 540_000);

    expect(before.state).toBe("upcoming");
    expect(before.current).toBeNull();
    expect(before.next?.item.id).toBe("welcome");
    expect(first.current?.item.id).toBe("welcome");
    expect(second.current?.item.id).toBe("song");
    expect(complete.state).toBe("complete");
    expect(complete.current).toBeNull();
  });

  it("starts the timeline at the first item, not the advertised service start", () => {
    // Regression: a plan whose first items run before the service start (a
    // 9:45 pre-service item on a 10:00 service) had every item pushed later by
    // that gap, so the public page disagreed with the plan editor.
    const withPreService: PublicServiceFlow = {
      ...service,
      timelineStartsAt: "2026-07-26T13:45:00.000Z",
    };
    const timelineStartsAt = Date.parse("2026-07-26T13:45:00.000Z");
    const [welcome, song] = getServiceFlowProgress(
      withPreService,
      timelineStartsAt,
    ).items;

    expect(welcome.startsAtMs).toBe(timelineStartsAt);
    expect(song.startsAtMs).toBe(timelineStartsAt + 300_000);
    expect(getServiceFlowProgress(withPreService, timelineStartsAt - 1).state)
      .toBe("upcoming");
    expect(getServiceFlowProgress(withPreService, timelineStartsAt).current?.item.id)
      .toBe("welcome");
  });

  it("stays live (not instantly complete) when no durations are set", () => {
    // Regression: plans often carry no durations at all — imports frequently
    // omit them — which made every item end the instant it started, so the
    // service read as "complete" the moment it began.
    const noDurations: PublicServiceFlow = {
      ...service,
      sections: [{
        id: "main",
        title: "Main",
        items: [
          { id: "welcome", title: "Welcome", durationSeconds: 0, notes: { blocks: [] } },
          { id: "song", title: "Opening Song", durationSeconds: 0, notes: { blocks: [] } },
        ],
      }],
    };
    const startsAt = Date.parse(service.startsAt);

    expect(getServiceFlowProgress(noDurations, startsAt - 1).state).toBe("upcoming");
    expect(getServiceFlowProgress(noDurations, startsAt + 1).state).toBe("live");
    expect(getServiceFlowProgress(noDurations, startsAt + 3_600_000).state).toBe("live");
  });

  it("keeps a manual current item active until the editor resumes schedule mode", () => {
    const startsAt = Date.parse(service.startsAt);
    const manual = getServiceFlowProgress(
      { ...service, live: { mode: "manual", currentItemId: "welcome" } },
      startsAt + 500_000,
    );
    const resumed = getServiceFlowProgress(service, startsAt + 500_000);

    expect(manual.isManual).toBe(true);
    expect(manual.current?.item.id).toBe("welcome");
    expect(resumed.isManual).toBe(false);
    expect(resumed.current?.item.id).toBe("song");
  });

  it("re-anchors the selected item and continues through following items automatically", () => {
    const adjusted: PublicServiceFlow = {
      ...service,
      sections: [{
        ...service.sections[0],
        items: [
          ...service.sections[0].items,
          { id: "closing", title: "Closing", durationSeconds: 120, notes: { blocks: [] } },
        ],
      }],
      live: {
        mode: "anchored",
        currentItemId: "song",
        startedAt: "2026-07-26T14:02:00.000Z",
      },
    };

    const duringSong = getServiceFlowProgress(
      adjusted,
      Date.parse("2026-07-26T14:04:00.000Z"),
    );
    const afterSong = getServiceFlowProgress(
      adjusted,
      Date.parse("2026-07-26T14:06:30.000Z"),
    );

    expect(duringSong.current?.item.id).toBe("song");
    expect(duringSong.items.find((item) => item.item.id === "song")?.startsAtMs).toBe(
      Date.parse("2026-07-26T14:02:00.000Z"),
    );
    expect(afterSong.current?.item.id).toBe("closing");
    expect(afterSong.isAdjusted).toBe(true);
    expect(afterSong.isManual).toBe(false);
  });

  it("uses an early anchor as the live timeline boundary and completes from it", () => {
    const earlyAnchor: PublicServiceFlow = {
      ...service,
      live: {
        mode: "anchored",
        currentItemId: "song",
        startedAt: "2026-07-26T13:00:00.000Z",
      },
    };

    const duringSong = getServiceFlowProgress(
      earlyAnchor,
      Date.parse("2026-07-26T13:02:00.000Z"),
    );
    const complete = getServiceFlowProgress(
      earlyAnchor,
      Date.parse("2026-07-26T13:04:00.000Z"),
    );

    expect(duringSong.state).toBe("live");
    expect(duringSong.current?.item.id).toBe("song");
    expect(complete.state).toBe("complete");
    expect(complete.current).toBeNull();
  });
});
