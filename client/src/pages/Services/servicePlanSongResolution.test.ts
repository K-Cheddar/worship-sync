import {
  resolveServicePlanSongRef,
  resolveServicePlanSongRefs,
} from "./servicePlanSongResolution";
import { plainTextToRichText } from "../../types/richText";
import type { ServicePlanSection } from "../../types/servicePlan";

const song = (id: string, name: string) => ({ _id: id, name });

describe("resolveServicePlanSongRef", () => {
  const library = [song("song-42", "How Great Is Our God")];

  it("links a pending song the library has gained since the import", () => {
    expect(
      resolveServicePlanSongRef(
        { kind: "pending", title: "How Great is Our God", lyricsText: "" },
        library,
      ),
    ).toEqual({
      kind: "library",
      songId: "song-42",
      songName: "How Great Is Our God",
    });
  });

  it("leaves a pending song alone while the library still lacks it", () => {
    const songRef = { kind: "pending" as const, title: "Way Maker", lyricsText: "" };
    expect(resolveServicePlanSongRef(songRef, library)).toBe(songRef);
  });

  it("holds the same confidence bar as the import", () => {
    // The words are all there but in the wrong order — not linkable then, not
    // linkable now.
    const songRef = { kind: "pending" as const, title: "Owe You Praise", lyricsText: "" };
    expect(resolveServicePlanSongRef(songRef, [song("s1", "Praise You")])).toBe(songRef);
  });

  it("keeps a pending song that carries its own lyrics", () => {
    // Those lyrics are content the library song would not show.
    const songRef = {
      kind: "pending" as const,
      title: "How Great is Our God",
      lyricsText: "Verse one",
    };
    expect(resolveServicePlanSongRef(songRef, library)).toBe(songRef);
  });

  it("leaves an already-linked song and an element with no song alone", () => {
    const linked = {
      kind: "library" as const,
      songId: "song-1",
      songName: "Living Hope",
    };
    expect(resolveServicePlanSongRef(linked, library)).toBe(linked);
    expect(resolveServicePlanSongRef(undefined, library)).toBeUndefined();
  });
});

describe("resolveServicePlanSongRefs", () => {
  const sections: ServicePlanSection[] = [
    {
      id: "section-1",
      name: "Praise",
      elements: [
        {
          id: "now-in-library",
          type: "song",
          title: plainTextToRichText("How Great is Our God (E)"),
          songRef: { kind: "pending", title: "How Great is Our God", lyricsText: "" },
        },
        {
          id: "still-missing",
          type: "song",
          title: plainTextToRichText("Way Maker"),
          songRef: { kind: "pending", title: "Way Maker", lyricsText: "" },
        },
        {
          id: "no-song",
          type: "free",
          title: plainTextToRichText("Announcements"),
        },
      ],
    },
  ];

  it("reports only the elements whose stored reference is now out of date", () => {
    const resolved = resolveServicePlanSongRefs(sections, [
      song("song-42", "How Great Is Our God"),
    ]);

    expect([...resolved.keys()]).toEqual(["now-in-library"]);
    // An element carries a list of song references, so the resolved entry is
    // the element's full list, not a single reference.
    expect(resolved.get("now-in-library")).toEqual([
      { kind: "library", songId: "song-42", songName: "How Great Is Our God" },
    ]);
  });

  it("resolves each song of a multi-song element and keeps the unmatched ones", () => {
    const medley: ServicePlanSection[] = [
      {
        id: "section-1",
        name: "Praise",
        elements: [
          {
            id: "medley",
            type: "song",
            title: plainTextToRichText("Medley"),
            songRefs: [
              { kind: "pending", title: "How Great is Our God", lyricsText: "" },
              { kind: "pending", title: "Way Maker", lyricsText: "" },
            ],
          },
        ],
      },
    ];

    const resolved = resolveServicePlanSongRefs(medley, [
      song("song-42", "How Great Is Our God"),
    ]);

    // Position is preserved: the still-missing song stays pending in place, so
    // callers can render the list without re-pairing it against the stored one.
    expect(resolved.get("medley")).toEqual([
      { kind: "library", songId: "song-42", songName: "How Great Is Our God" },
      { kind: "pending", title: "Way Maker", lyricsText: "" },
    ]);
  });

  it("is empty when the library has nothing new to offer", () => {
    expect(resolveServicePlanSongRefs(sections, []).size).toBe(0);
    expect(resolveServicePlanSongRefs(null, [song("s1", "Anything")]).size).toBe(0);
  });
});
