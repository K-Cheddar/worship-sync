import {
  buildServicePlanSectionsFromImport,
  buildServicePlanSourceImport,
  guessServicePlanElementType,
} from "./servicePlanFromImport";
import { richTextToPlainText } from "../../types/richText";
import type { ServicePlanningImportData } from "../../containers/Overlays/eventParser";

describe("guessServicePlanElementType", () => {
  it.each([
    ["Song", "Great Are You Lord", "song"],
    ["Worship", "10,000 Reasons", "song"],
    ["Video", "Baptism testimony", "video"],
    ["Media", "Welcome slide", "image"],
    ["Scripture Reading", "John 3:16", "bible"],
    ["Announcements", "", "announcement"],
    ["Header", "Response", "heading"],
    ["Sermon", "The Good Shepherd", "free"],
  ] as const)("classifies %s / %s as %s", (elementType, title, expected) => {
    expect(guessServicePlanElementType(elementType, title)).toBe(expected);
  });
});

describe("buildServicePlanSectionsFromImport", () => {
  const data: ServicePlanningImportData = {
    planLabel: "Sunday, Jan 1",
    sections: [
      {
        sectionName: "Call to Worship",
        rows: [
          { elementType: "Song", title: "Great Are You Lord", ledBy: "Jane Doe" },
          { elementType: "Song", title: "Unmatched New Song", ledBy: "" },
        ],
      },
      {
        sectionName: "Message",
        rows: [{ elementType: "Message", title: "The Good Shepherd", ledBy: "Pastor Sam" }],
      },
    ],
    teamAssignments: [],
  };
  const songs = [{ _id: "song-1", name: "Great Are You Lord" }];

  it("maps each Service Planning section 1:1 onto a ServicePlanSection", () => {
    const sections = buildServicePlanSectionsFromImport(data, songs);
    expect(sections).toHaveLength(2);
    expect(sections[0].name).toBe("Call to Worship");
    expect(sections[1].name).toBe("Message");
    expect(sections[0].elements).toHaveLength(2);
    expect(sections[1].elements).toHaveLength(1);
  });

  it("matches a song row against the library and captures ledBy as the assignment", () => {
    const [section] = buildServicePlanSectionsFromImport(data, songs);
    const [matched] = section.elements;
    expect(matched.type).toBe("song");
    expect(matched.songRef).toEqual({
      kind: "library",
      songId: "song-1",
      songName: "Great Are You Lord",
    });
    expect(matched.assignedName).toBe("Jane Doe");
    expect(matched.sourceLedByRaw).toBe("Jane Doe");
    expect(richTextToPlainText(matched.title)).toBe("Great Are You Lord");
  });

  it("captures an unmatched song as a pending song reference", () => {
    const [section] = buildServicePlanSectionsFromImport(data, songs);
    const [, unmatched] = section.elements;
    expect(unmatched.songRef).toEqual({
      kind: "pending",
      title: "Unmatched New Song",
      lyricsText: "",
    });
  });

  it("leaves non-song rows without a songRef", () => {
    const [, messageSection] = buildServicePlanSectionsFromImport(data, songs);
    expect(messageSection.elements[0].songRef).toBeUndefined();
    expect(messageSection.elements[0].assignedName).toBe("Pastor Sam");
  });

  it("keeps imported timing plus shared and team-scoped notes", () => {
    const [section] = buildServicePlanSectionsFromImport({
      ...data,
      sections: [{
        sectionName: "Welcome",
        rows: [{
          elementType: "Welcome Song",
          title: "There's a Welcome Here",
          ledBy: "Praise Team",
          startTime: "11:11",
          durationMinutes: 1.5,
          note: "Invite everyone to sing.",
          teamNotes: [
            { teamName: "Media Team", note: "Capture the greetings." },
            { teamName: "Praise Team", note: "Walk around and greet people." },
          ],
        }],
      }],
    }, songs);

    const [element] = section.elements;
    expect(element.startTime).toBe("11:11");
    expect(element.durationMinutes).toBe(1.5);
    expect(element.durationSeconds).toBe(90);
    expect(richTextToPlainText(element.notes)).toBe("Invite everyone to sing.");
    expect(element.teamNotes?.map(({ label, note }) => ({
      label,
      note: richTextToPlainText(note),
    }))).toEqual([
      { label: "Media Team", note: "Capture the greetings." },
      { label: "Praise Team", note: "Walk around and greet people." },
    ]);
  });

  it("falls back to 'Section' for a blank section name", () => {
    const [sections] = [
      buildServicePlanSectionsFromImport(
        { ...data, sections: [{ sectionName: "", rows: [] }] },
        songs,
      ),
    ];
    expect(sections[0].name).toBe("Section");
  });
});

describe("buildServicePlanSourceImport", () => {
  it("captures provenance for traceability", () => {
    const result = buildServicePlanSourceImport(
      { planLabel: "Sunday, Jan 1", sections: [], teamAssignments: [] },
      "https://services.planningcenteronline.com/plans/123",
    );
    expect(result).toEqual({
      source: "servicePlanning",
      sourceUrl: "https://services.planningcenteronline.com/plans/123",
      loadedAt: expect.any(String),
      planLabel: "Sunday, Jan 1",
    });
  });
});
