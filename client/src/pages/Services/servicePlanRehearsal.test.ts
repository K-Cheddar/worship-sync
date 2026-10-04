import type { DBItem } from "../../types";
import type { ServicePlanSection, ServicePlanSongReference } from "../../types/servicePlan";
import { buildServicePlanRehearsalEntries } from "./servicePlanRehearsal";

const makeSong = (id: string, name: string, key = "") =>
  ({
    _id: id,
    name,
    type: "song",
    songMetadata: { key },
  }) as DBItem;

const libraryRef = (
  songId: string,
  songName: string,
  key?: string,
): ServicePlanSongReference => ({ kind: "library", songId, songName, ...(key ? { key } : {}) });

const sectionsFor = (songRefs: ServicePlanSongReference[]) => [{
  id: "section-1",
  name: "Worship",
  elements: songRefs.map((songRef, index) => ({
    id: `element-${index}`,
    type: "song" as const,
    title: { ops: [] },
    songRefs: [songRef],
  })),
}] as unknown as ServicePlanSection[];

describe("buildServicePlanRehearsalEntries", () => {
  it("groups repeated library song IDs by effective key and leaves Plan occurrences untouched", () => {
    const ref = libraryRef("song-1", "Song", "  D ");
    const sections = sectionsFor([ref, ref, ref]);
    const originalOccurrences = sections[0].elements.map((element) => element.songRefs?.[0]);

    const entries = buildServicePlanRehearsalEntries(
      sections,
      [makeSong("song-1", "Song", "E")],
      new Map(),
    );

    expect(entries).toHaveLength(1);
    expect(entries[0].usageCount).toBe(3);
    expect(entries[0].occurrenceNumbers).toEqual([1, 2, 3]);
    expect(entries[0].songRef.key).toBe("  D ");
    expect(sections[0].elements).toHaveLength(3);
    expect(sections[0].elements.map((element) => element.songRefs?.[0])).toEqual(originalOccurrences);
  });

  it("uses library key fallback and keeps different effective keys separate", () => {
    const entries = buildServicePlanRehearsalEntries(
      sectionsFor([
        libraryRef("song-1", "Song"),
        libraryRef("song-1", "Song", "D"),
        libraryRef("song-1", "Song", "E"),
      ]),
      [makeSong("song-1", "Song", "D")],
      new Map(),
    );

    expect(entries).toHaveLength(2);
    expect(entries.map(({ usageCount }) => usageCount)).toEqual([2, 1]);
  });

  it("dedupes pending references only when they share an explicit reference ID", () => {
    const pending: ServicePlanSongReference = {
      kind: "pending",
      id: "pending-1",
      title: "New song",
      lyricsText: "lyrics",
    };
    const entries = buildServicePlanRehearsalEntries(
      sectionsFor([
        pending,
        { ...pending },
        { kind: "pending", title: "New song", lyricsText: "other lyrics" },
      ]),
      [],
      new Map(),
    );

    expect(entries).toHaveLength(2);
    expect(entries.map(({ usageCount }) => usageCount)).toEqual([2, 1]);
  });
});
