import type {
  DBItem, FormattedLyrics, SongV2ArrangementDocument, SongV2RootDocument, SongV2SlideDocument,
} from "../types";
import {
  buildSongV2ConflictDiffModel,
  buildSongV2SongDiffModel,
  type SongV2ConflictComparisonContext,
} from "./buildSongV2ConflictDiffModel";

const lyrics = (id: string, name: string, words: string): FormattedLyrics => ({
  id, name, words, type: name.split(" ")[0], slideSpan: 1,
});

const arrangement = (
  sections: FormattedLyrics[],
  overrides: Partial<SongV2ArrangementDocument> = {},
): SongV2ArrangementDocument => ({
  _id: "song-v2:arrangement:song:arrangement-1",
  _rev: "1-current",
  docType: "song-v2-arrangement",
  songId: "song-1",
  arrangementId: "arrangement-1",
  name: "Full Band",
  formattedLyrics: sections,
  songOrder: sections.map(section => ({ id: section.id, name: section.name })),
  slideIds: [],
  ...overrides,
});

const root = (overrides: Partial<SongV2RootDocument> = {}): SongV2RootDocument => ({
  _id: "song-v2:root:song-1",
  _rev: "1-current",
  docType: "song-v2-root",
  songId: "song-1",
  songSchemaVersion: 2,
  name: "Better",
  selectedArrangement: 0,
  shouldSendTo: { projector: true, monitor: true, stream: true },
  arrangementIds: ["arrangement-1"],
  ...overrides,
});

const slide = (
  id: string,
  name: string,
  words: string,
  overrides: Partial<SongV2SlideDocument> = {},
): SongV2SlideDocument => ({
  _id: `song-v2:slide:song-1:arrangement-1:${id}`,
  _rev: "1-current",
  docType: "song-v2-slide",
  songId: "song-1",
  arrangementId: "arrangement-1",
  id,
  type: "Verse",
  name,
  boxes: [{ id: `box-${id}`, width: 100, height: 100, words }],
  ...overrides,
});

const text = (segments: { text: string }[]) => segments.map(segment => segment.text).join("");
const summaries = (model: ReturnType<typeof buildSongV2ConflictDiffModel>) => model.changes.map(item => item.summary);
const context = (
  currentArrangements: SongV2ArrangementDocument[],
  currentSlides: SongV2SlideDocument[],
  alternativeArrangements = currentArrangements,
  alternativeSlides = currentSlides,
  missingCurrentSlideIds: string[] = [],
  missingAlternativeSlideIds: string[] = [],
): SongV2ConflictComparisonContext => ({
  current: { arrangements: currentArrangements, slides: currentSlides, missingSlideIds: missingCurrentSlideIds },
  alternative: { arrangements: alternativeArrangements, slides: alternativeSlides, missingSlideIds: missingAlternativeSlideIds },
});

const song = (sections: FormattedLyrics[], slides: SongV2SlideDocument[], order = sections) => ({
  _id: "song-1",
  type: "song",
  name: "Better",
  selectedArrangement: 0,
  shouldSendTo: { projector: true, monitor: true, stream: true },
  arrangements: [{
    id: "arrangement-1",
    name: "Full Band",
    formattedLyrics: sections,
    songOrder: order.map(section => ({ id: section.id, name: section.name })),
    slides: slides.map(({ _id, _rev, docType: _docType, songId: _songId, arrangementId: _arrangementId, ...slideDocument }) => slideDocument),
  }],
  slides: [],
} as DBItem);

describe("buildSongV2ConflictDiffModel", () => {
  it("identifies both sections in an adjacent swap by name and old/new position", () => {
    const sections = [
      lyrics("verse-1", "Verse 1", "First verse"),
      lyrics("verse-2", "Verse 2", "Second verse"),
      lyrics("chorus-1", "Chorus 1", "Chorus"),
    ];
    const current = arrangement(sections);
    const alternative = arrangement(sections, {
      songOrder: [sections[0], sections[2], sections[1]].map(section => ({ id: section.id, name: section.name })),
    });
    const model = buildSongV2ConflictDiffModel(current, alternative);

    expect(summaries(model)).toContain("Section “Chorus 1” moved from position 3 to position 2.");
    expect(summaries(model)).toContain("Section “Verse 2” moved from position 2 to position 3.");
    expect(model.lyricsIdentical).toBe(true);
  });

  it("does not report later sections as moved when a section is inserted", () => {
    const currentSections = [
      lyrics("verse-1", "Verse 1", "First"),
      lyrics("chorus", "Chorus", "Sing"),
      lyrics("bridge", "Bridge", "Build"),
    ];
    const alternativeSections = [lyrics("intro", "Intro", "Begin"), ...currentSections];
    const current = arrangement(currentSections);
    const alternative = arrangement(alternativeSections);
    const model = buildSongV2ConflictDiffModel(current, alternative);

    expect(summaries(model)).toContain("Section “Intro” added at position 1.");
    expect(summaries(model).filter(summary => summary.includes("moved"))).toEqual([]);
  });

  it("reports a removed section and its previous position", () => {
    const currentSections = [lyrics("verse-1", "Verse 1", "First"), lyrics("bridge", "Bridge", "Build")];
    const model = buildSongV2ConflictDiffModel(
      arrangement(currentSections),
      arrangement([currentSections[0]]),
    );

    expect(model.sections.map(section => [section.id, section.status])).toEqual([["bridge", "removed"]]);
    expect(summaries(model)).toContain("Section “Bridge” removed from position 2.");
  });

  it("uses stable section IDs to distinguish repeated names and reports their actual moves", () => {
    const currentSections = [
      lyrics("verse-a", "Verse", "First repeated verse"),
      lyrics("verse-b", "Verse", "Second repeated verse"),
      lyrics("chorus", "Chorus", "Same words"),
    ];
    const alternativeSections = [currentSections[1], currentSections[0], currentSections[2]];
    const model = buildSongV2ConflictDiffModel(
      arrangement(currentSections),
      arrangement(alternativeSections),
    );

    expect(model.sections).toEqual([]);
    expect(summaries(model)).toContain("Section “Verse (1)” moved from position 1 to position 2.");
    expect(summaries(model)).toContain("Section “Verse (2)” moved from position 2 to position 1.");
  });

  it("highlights exact lyric additions and deletions while preserving whitespace", () => {
    const before = "  It will get better!\n\nKeep singing.\tAmen";
    const after = "  It will get much better!\n\nKeep singing.\tAMEN";
    const model = buildSongV2ConflictDiffModel(
      arrangement([lyrics("verse-1", "Verse 1", before)]),
      arrangement([lyrics("verse-1", "Verse 1", after)]),
    );
    const section = model.sections[0];

    expect(text(section.current.full)).toBe(before);
    expect(text(section.alternative.full)).toBe(after);
    expect(section.alternative.full).toContainEqual({ kind: "added", text: "much " });
    expect(section.current.full.some(segment => segment.kind === "removed")).toBe(true);
  });

  it("calls out identical lyrics when only section structure changes", () => {
    const sections = [lyrics("verse", "Verse 1", "First"), lyrics("chorus", "Chorus", "Sing")];
    const model = buildSongV2ConflictDiffModel(
      arrangement(sections),
      arrangement(sections, { songOrder: [...sections].reverse().map(({ id, name }) => ({ id, name })) }),
    );

    expect(model.lyricsIdentical).toBe(true);
    expect(model.summary).toBe("Lyrics are identical.");
    expect(model.sections).toEqual([]);
    expect(model.changes.some(item => item.summary.includes("moved from position"))).toBe(true);
  });

  it("ignores revision metadata when authored content is identical", () => {
    const current = arrangement([lyrics("verse-1", "Verse 1", "Same words")], {
      _rev: "3-current", _revisions: { start: 3, ids: ["current", "ancestor"] },
      updatedAt: "2026-10-27T10:00:00Z", updatedBy: "operator-a",
    } as Partial<SongV2ArrangementDocument>);
    const alternative = arrangement([lyrics("verse-1", "Verse 1", "Same words")], {
      _rev: "3-branch", _revisions: { start: 3, ids: ["branch", "ancestor"] },
      _conflicts: ["3-current"], updatedAt: "2026-10-27T11:00:00Z", updatedBy: "operator-b",
    } as Partial<SongV2ArrangementDocument>);
    const model = buildSongV2ConflictDiffModel(current, alternative);

    expect(model.identicalContent).toBe(true);
    expect(model.summary).toBe("Lyrics are identical.");
    expect(model.changes).toEqual([]);
  });

  it("compares slide references by readable names and positions", () => {
    const lyric = lyrics("verse-1", "Verse 1", "Same words");
    const current = arrangement([lyric], { slideIds: ["verse-a", "verse-b", "chorus"] });
    const alternative = arrangement([lyric], { slideIds: ["chorus", "verse-a", "new-slide"] });
    const currentSlides = [
      slide("verse-a", "Verse 1A", "Line A"),
      slide("verse-b", "Verse 1B", "Line B"),
      slide("chorus", "Chorus 1", "Chorus"),
    ];
    const alternativeSlides = [
      currentSlides[2],
      currentSlides[0],
      slide("new-slide", "Outro", "Goodnight"),
    ];
    const model = buildSongV2ConflictDiffModel(current, alternative, context(
      [current], currentSlides, [alternative], alternativeSlides,
    ));

    expect(summaries(model)).toContain("Slide “Chorus 1” moved from position 3 to position 1.");
    expect(summaries(model)).toContain("Slide “Verse 1A” moved from position 1 to position 2.");
    expect(summaries(model)).toContain("Slide “Verse 1B” (position 2) removed; its lyrics are not present on the remaining slides.");
    expect(summaries(model)).toContain("Slide “Outro” (position 3) added.");
  });

  it("recognizes regenerated slide IDs when authored slide content is equivalent", () => {
    const current = arrangement([lyrics("verse-1", "Verse 1", "Keep singing")], { slideIds: ["old-slide"] });
    const alternative = arrangement([lyrics("verse-1", "Verse 1", "Keep singing")], { slideIds: ["new-slide"] });
    const model = buildSongV2ConflictDiffModel(
      current,
      alternative,
      context([current], [slide("old-slide", "Verse 1A", "Keep singing")],
        [alternative], [slide("new-slide", "Verse 1A", "Keep singing")]),
    );

    expect(summaries(model)).toContain("Slide identity regenerated for “Verse 1A”; authored content is unchanged.");
    expect(summaries(model).some(summary => summary.includes("removed"))).toBe(false);
    expect(summaries(model).some(summary => summary.includes("added"))).toBe(false);
  });

  it("reports actual slide text removal when no selected slide contains the old words", () => {
    const current = arrangement([lyrics("verse-1", "Verse 1", "Keep singing")], { slideIds: ["old-slide", "remaining"] });
    const alternative = arrangement([lyrics("verse-1", "Verse 1", "Keep singing")], { slideIds: ["remaining"] });
    const currentSlides = [slide("old-slide", "Verse 1B", "A line that is gone"), slide("remaining", "Chorus 1", "Other lyrics")];
    const model = buildSongV2ConflictDiffModel(
      current,
      alternative,
      context([current], currentSlides, [alternative], currentSlides.slice(1)),
    );

    expect(summaries(model)).toContain("Slide “Verse 1B” (position 1) removed; its lyrics are not present on the remaining slides.");
    expect(summaries(model).some(summary => summary.includes("uncertain"))).toBe(false);
  });

  it("identifies lyric reflow across multiple pages when the canonical lyrics remain", () => {
    const section = lyrics("verse-1", "Verse 1", "Bless the Lord");
    const current = arrangement([section], { slideIds: ["old-page"] });
    const alternative = arrangement([section], { slideIds: ["page-a", "page-b"] });
    const model = buildSongV2ConflictDiffModel(
      current,
      alternative,
      context([current], [slide("old-page", "Verse 1A", "Bless the Lord")], [alternative], [
        slide("page-a", "Verse 1A", "Bless the"),
        slide("page-b", "Verse 1B", "Lord"),
      ]),
    );

    expect(model.lyricsIdentical).toBe(true);
    expect(summaries(model)).toContain("Lyrics were reflowed across slides; the canonical section lyrics are unchanged.");
  });

  it("marks missing slide details as uncertain rather than claiming lyric loss", () => {
    const current = arrangement([lyrics("verse-1", "Verse 1", "Same words")], { slideIds: ["missing-page"] });
    const alternative = arrangement([lyrics("verse-1", "Verse 1", "Same words")], { slideIds: [] });
    const model = buildSongV2ConflictDiffModel(
      current,
      alternative,
      context([current], [], [alternative], [], [], ["arrangement-1:other-page"]),
    );

    expect(summaries(model)).toContain("Could not verify “Slide” (position 1); the slide may have been removed or regenerated.");
    expect(summaries(model).some(summary => summary.includes("lyrics are not present"))).toBe(false);
  });

  it("distinguishes a regenerated ID from a material layout or media change", () => {
    const current = arrangement([lyrics("verse-1", "Verse 1", "Same words")], { slideIds: ["old-page"] });
    const alternative = arrangement([lyrics("verse-1", "Verse 1", "Same words")], { slideIds: ["new-page"] });
    const model = buildSongV2ConflictDiffModel(
      current,
      alternative,
      context([current], [slide("old-page", "Verse 1A", "Same words")], [alternative], [
        slide("new-page", "Verse 1A", "Same words", { boxes: [{ id: "box-new-page", width: 90, height: 100, words: "Same words" }] }),
      ]),
    );

    expect(summaries(model).some(summary => summary.includes("identity regenerated"))).toBe(false);
    expect(summaries(model)).toContain("Text box position or size changed.");
    expect(summaries(model).some(summary => summary.includes("lyrics are not present"))).toBe(false);
  });

  it("shows exact formatting values and meaningful media changes", () => {
    const current = slide("slide-1", "Verse 1A", "Same", {
      boxes: [{ id: "box-1", width: 100, height: 100, words: "Same", fontSize: 100, align: "center", background: "old" }],
    });
    const alternative = slide("slide-1", "Verse 1A", "Same", {
      boxes: [{ id: "box-1", width: 100, height: 100, words: "Same", fontSize: 120, align: "left", background: "new" }],
    });
    const model = buildSongV2ConflictDiffModel(current, alternative);

    expect(summaries(model)).toContain("Text box font size: 100 → 120.");
    expect(summaries(model)).toContain("Text box text alignment: Center → Left.");
    expect(summaries(model)).toContain("Text box background changed.");
  });

  it("reports song title, arrangement, and background changes without raw field names", () => {
    const model = buildSongV2ConflictDiffModel(
      root(),
      root({ name: "Better (Live)", background: "blue", shouldSkipTitle: true }),
    );

    expect(summaries(model)).toContain("Song title: Better → Better (Live).");
    expect(summaries(model)).toContain("Song background changed.");
    expect(summaries(model)).toContain("Title slide: shown → skipped.");
    expect(summaries(model).some(summary => summary.includes("shouldSkipTitle"))).toBe(false);
  });

  it("carries verified slide lyric loss into the full selected-song impact model", () => {
    const lyric = lyrics("verse-1", "Verse 1", "Canonical lyric text");
    const currentSlides = [slide("page-a", "Verse 1A", "Canonical lyric text"), slide("page-b", "Verse 1B", "Lost displayed line")];
    const model = buildSongV2SongDiffModel(
      song([lyric], currentSlides),
      song([lyric], [currentSlides[0]]),
    );

    expect(model.lyricsIdentical).toBe(false);
    expect(summaries(model).some(summary => summary.includes("Verse 1B") && summary.includes("lyrics are not present"))).toBe(true);
  });

  it("reports the actual selected hydrated song's section order and changed lyrics", () => {
    const currentSections = [lyrics("verse-1", "Verse 1", "Sing today"), lyrics("chorus", "Chorus", "You are good")];
    const selectedSections = [lyrics("chorus", "Chorus", "You are so good"), currentSections[0]];
    const currentSlides = [slide("verse", "Verse 1A", "Sing today"), slide("chorus", "Chorus 1", "You are good")];
    const selectedSlides = [slide("chorus", "Chorus 1", "You are so good"), currentSlides[0]];
    const model = buildSongV2SongDiffModel(
      song(currentSections, currentSlides),
      song(selectedSections, selectedSlides),
    );

    expect(model.lyricsIdentical).toBe(false);
    expect(model.sections.some(section => section.name.includes("Chorus") && section.status === "changed")).toBe(true);
    expect(summaries(model)).toContain("Section “Chorus” moved from position 2 to position 1.");
    expect(summaries(model)).toContain("Slide “Chorus 1” moved from position 2 to position 1.");
  });
});
