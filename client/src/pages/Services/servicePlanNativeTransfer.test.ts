import type { ServicePlanSection } from "../../types/servicePlan";
import {
  exportWorshipSyncPlan,
  importWorshipSyncPlan,
  publicServiceFlowToSections,
  WORSHIPSYNC_PLAN_FORMAT,
} from "./servicePlanNativeTransfer";

const sourceSections: ServicePlanSection[] = [{
  id: "section-stale",
  name: "Music",
  sourcePlanningManaged: true,
  elements: [{
    id: "item-stale",
    type: "song",
    title: { blocks: [{ type: "paragraph", spans: [{ text: "Welcome", bold: true }] }] },
    notes: { blocks: [{ type: "paragraph", spans: [{ text: "Read first" }] }] },
    durationSeconds: 120,
    songRefs: [{ id: "song-occurrence-stale", kind: "library", songId: "song-1", songName: "Welcome Song" }],
    resources: [
      { id: "resource-2", type: "url", title: "Second", url: "https://example.test/2" },
      { id: "resource-1", type: "url", title: "First", url: "https://example.test/1" },
    ],
    contentOrder: ["song-occurrence-stale", "resource-2", "resource-1"],
    pushedOutlineListId: "outline-stale",
    pushedOutlineListIds: ["outline-stale"],
    sourceOccurrenceId: "external-stale",
    sourcePlanningManaged: true,
  }],
}];

describe("native WorshipSync plan transfer", () => {
  it("exports and reimports editable content with attachments ordered and identities refreshed", () => {
    const file = exportWorshipSyncPlan(sourceSections, "church-1");
    expect(file.format).toBe(WORSHIPSYNC_PLAN_FORMAT);
    expect(JSON.stringify(file)).not.toContain("outline-stale");
    expect(JSON.stringify(file)).not.toContain("sourceOccurrenceId");
    const sections = importWorshipSyncPlan(file, { targetChurchId: "church-1" });
    expect(sections[0].name).toBe("Music");
    expect(sections[0].elements[0].title).toEqual(sourceSections[0].elements[0].title);
    expect(sections[0].elements[0].notes).toEqual(sourceSections[0].elements[0].notes);
    expect(sections[0].elements[0].durationSeconds).toBe(120);
    expect(sections[0].elements[0].songRefs?.[0]).toMatchObject({ kind: "library", songId: "song-1" });
    expect(sections[0].elements[0].resources?.map(({ title }) => title)).toEqual(["Second", "First"]);
    expect(sections[0].elements[0].contentOrder).toHaveLength(3);
    expect(sections[0].id).not.toBe("section-stale");
    expect(sections[0].elements[0].id).not.toBe("item-stale");
    expect(sections[0].elements[0].pushedOutlineListIds).toBeUndefined();
    expect(sections[0].elements[0].sourceOccurrenceId).toBeUndefined();
  });

  it("keeps repeated items and makes unmatched foreign song references visible", () => {
    const file = exportWorshipSyncPlan([{ ...sourceSections[0], elements: [sourceSections[0].elements[0], sourceSections[0].elements[0]] }], "church-1");
    const sections = importWorshipSyncPlan(file, { targetChurchId: "church-2" });
    expect(sections[0].elements).toHaveLength(2);
    expect(sections[0].elements[0].id).not.toBe(sections[0].elements[1].id);
    expect(sections[0].elements[0].songRefs?.[0]).toMatchObject({ kind: "pending", title: "Welcome Song" });
  });

  it("rejects invalid formats and versions", () => {
    expect(() => importWorshipSyncPlan({ format: "other", version: 1, sections: [] })).toThrow();
    expect(() => importWorshipSyncPlan({ format: WORSHIPSYNC_PLAN_FORMAT, version: 2, sections: [] })).toThrow();
    expect(() => importWorshipSyncPlan({ format: WORSHIPSYNC_PLAN_FORMAT, version: 1, sections: [{ name: "bad" }] })).toThrow();
  });

  it("converts a public plan into editable sections and resources", () => {
    const sections = publicServiceFlowToSections({
      shareId: "share", title: "Public", startsAt: "2026-10-25T10:00:00Z", timezone: "UTC", revision: 4,
      sections: [{ id: "source", title: "Gathering", items: [{
        id: "public-item", title: "Opening", durationSeconds: 90, songs: ["Known Song"],
        scriptureRefs: ["John 3:16"], notes: { blocks: [{ type: "paragraph", spans: [{ text: "Welcome" }] }] },
        resources: [{ type: "url", title: "Guide", url: "https://example.test" }], creditName: "Alex",
      }] }],
      live: { mode: "schedule" },
    }, [{ _id: "song-2", name: "Known Song" }]);
    expect(sections[0].elements[0]).toMatchObject({ durationSeconds: 90, assignees: [{ name: "Alex" }] });
    expect(sections[0].elements[0].songRefs?.[0]).toMatchObject({ kind: "library", songId: "song-2" });
    expect(sections[0].elements[0].scriptureRefs?.[0].book).toBe("John");
    expect(sections[0].elements[0].resources?.[0].url).toBe("https://example.test");
  });
});
