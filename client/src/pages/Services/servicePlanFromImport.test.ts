import {
  buildServicePlanSectionsFromImport,
  buildServicePlanSourceImport,
  guessServicePlanElementType,
} from "./servicePlanFromImport";
import { servicePlanToImportData } from "../../integrations/servicePlanning/servicePlanToImportData";
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
    ["Song of Praise", "How Great is Our God (E)", "song"],
    ["Welcome Song", "There's a Welcome Here (C)", "song"],
    // "Praise" alone doesn't make a row a song — these are spoken moments, and
    // the song that follows each one is its own row in the source.
    ["Call to Praise", "Call to Praise", "free"],
    ["Call to Worship", "", "free"],
    ["Praise Report", "Testimony", "free"],
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
          {
            elementType: "Song",
            title: "Great Are You Lord",
            ledBy: "Jane Doe",
          },
          { elementType: "Song", title: "Unmatched New Song", ledBy: "" },
        ],
      },
      {
        sectionName: "Message",
        rows: [
          {
            elementType: "Message",
            title: "The Good Shepherd",
            ledBy: "Pastor Sam",
          },
        ],
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
    expect(matched.assignees?.[0].name).toBe("Jane Doe");
    expect(matched.sourceLedByRaw).toBe("Jane Doe");
    expect(richTextToPlainText(matched.title)).toBe("Great Are You Lord");
  });

  it("imports multiple Led by names as separate assignees", () => {
    const [section] = buildServicePlanSectionsFromImport(
      {
        ...data,
        sections: [
          {
            sectionName: "Welcome",
            rows: [
              {
                elementType: "Welcome",
                title: "Host team",
                ledBy: "Jamie Rivera, Morgan Lee & Taylor Smith",
              },
            ],
          },
        ],
      },
      songs,
    );

    expect(section.elements[0].assignees?.map(({ name }) => name)).toEqual([
      "Jamie Rivera",
      "Morgan Lee",
      "Taylor Smith",
    ]);
    expect(section.elements[0].sourceLedByRaw).toBe(
      "Jamie Rivera, Morgan Lee & Taylor Smith",
    );
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

  it("takes songs from the source's own markers, not from how rows are worded", () => {
    const [section] = buildServicePlanSectionsFromImport(
      {
        ...data,
        sections: [
          {
            sectionName: "Praise & Prayer",
            rows: [
              {
                elementType: "Welcome Song",
                title: "There's a Welcome Here (C)",
                ledBy: "Praise Team",
                songTitle: "There's a Welcome Here (C)",
              },
              // Reads like a song and isn't one. The plan marks its songs, so
              // this row's wording must not add one.
              {
                elementType: "Call to Praise",
                title: "Call to Praise",
                ledBy: "",
              },
              { elementType: "Appeal Song", title: "Appeal Song", ledBy: "" },
            ],
          },
        ],
      },
      songs,
    );

    expect(section.elements.map((element) => element.type)).toEqual([
      "song",
      "free",
      "free",
    ]);
    // The marker names the song by itself, so the key and the element type
    // printed alongside it stay out of the library lookup.
    expect(section.elements[0].songRef).toEqual({
      kind: "pending",
      title: "There's a Welcome Here",
      lyricsText: "",
      key: "C",
    });
  });

  it("recognizes a keyed song title when its source music marker is missing", () => {
    const [section] = buildServicePlanSectionsFromImport(
      {
        ...data,
        sections: [
          {
            sectionName: "Praise & Worship",
            rows: [
              {
                elementType: "Welcome",
                title: "How Great Is Our God (E)",
                ledBy: "",
              },
              {
                elementType: "Song",
                title: "Marked Song",
                ledBy: "",
                songTitle: "Marked Song",
              },
            ],
          },
        ],
      },
      songs,
    );

    expect(section.elements[0].type).toBe("song");
    expect(section.elements[0].songRef).toEqual({
      kind: "pending",
      title: "How Great Is Our God",
      lyricsText: "",
      key: "E",
    });
  });

  it("matches a marked song against the library on the marked title alone", () => {
    const [section] = buildServicePlanSectionsFromImport(
      {
        ...data,
        sections: [
          {
            sectionName: "Congregational Hymn",
            rows: [
              {
                elementType: "Congregational Hymn",
                title: "Great Are You Lord #520 (Bb)",
                ledBy: "",
                songTitle: "Great Are You Lord #520 (Bb)",
              },
            ],
          },
        ],
      },
      songs,
    );

    expect(section.elements[0].songRef).toEqual({
      kind: "library",
      songId: "song-1",
      songName: "Great Are You Lord",
      key: "Bb",
    });
  });

  it("still guesses songs from wording when the source marks none", () => {
    const [section] = buildServicePlanSectionsFromImport(
      {
        ...data,
        sections: [
          {
            sectionName: "Worship",
            rows: [
              { elementType: "Song", title: "Great Are You Lord", ledBy: "" },
            ],
          },
        ],
      },
      songs,
    );

    expect(section.elements[0].type).toBe("song");
  });

  it("leaves a spoken 'Call to Praise' row as a plain item with no song", () => {
    const [section] = buildServicePlanSectionsFromImport(
      {
        ...data,
        sections: [
          {
            sectionName: "Praise & Prayer",
            rows: [
              {
                elementType: "Call to Praise",
                title: "Call to Praise",
                ledBy: "",
              },
            ],
          },
        ],
      },
      songs,
    );

    expect(section.elements[0].type).toBe("free");
    expect(section.elements[0].songRef).toBeUndefined();
  });

  it("leaves non-song rows without a songRef", () => {
    const [, messageSection] = buildServicePlanSectionsFromImport(data, songs);
    expect(messageSection.elements[0].songRef).toBeUndefined();
    expect(messageSection.elements[0].assignees?.[0].name).toBe("Pastor Sam");
  });

  it("keeps imported timing plus shared and team-scoped notes", () => {
    const [section] = buildServicePlanSectionsFromImport(
      {
        ...data,
        sections: [
          {
            sectionName: "Welcome",
            rows: [
              {
                elementType: "Welcome Song",
                title: "There's a Welcome Here",
                ledBy: "Praise Team",
                startTime: "11:11",
                durationMinutes: 1.5,
                note: "Invite everyone to sing.",
                teamNotes: [
                  { teamName: "Media Team", note: "Capture the greetings." },
                  {
                    teamName: "Praise Team",
                    note: "Walk around and greet people.",
                  },
                ],
              },
            ],
          },
        ],
      },
      songs,
    );

    const [element] = section.elements;
    expect(element.startTime).toBe("11:11");
    expect(element.durationMinutes).toBe(1.5);
    expect(element.durationSeconds).toBe(90);
    expect(richTextToPlainText(element.notes)).toBe("Invite everyone to sing.");
    expect(
      element.teamNotes?.map(({ label, note }) => ({
        label,
        note: richTextToPlainText(note),
      })),
    ).toEqual([
      { label: "Media Team", note: "Capture the greetings." },
      { label: "Praise Team", note: "Walk around and greet people." },
    ]);
  });

  it("keeps a multi-line note's line structure as blocks and list items", () => {
    const [section] = buildServicePlanSectionsFromImport(
      {
        ...data,
        sections: [
          {
            sectionName: "Welcome",
            rows: [
              {
                elementType: "Welcome Song",
                title: "There's a Welcome Here",
                ledBy: "Praise Team",
                teamNotes: [
                  {
                    teamName: "Media Team",
                    note: "3 or 4 headsets:\n- Host: Gray\n- Co-Host: Blue",
                  },
                ],
              },
            ],
          },
        ],
      },
      songs,
    );

    // One block per line, so the public view and the editor both render the
    // list the author typed rather than a single run-on paragraph.
    expect(section.elements[0].teamNotes?.[0].note.blocks).toEqual([
      { type: "paragraph", spans: [{ text: "3 or 4 headsets:" }] },
      { type: "list-item", spans: [{ text: "Host: Gray" }] },
      { type: "list-item", spans: [{ text: "Co-Host: Blue" }] },
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

  it.each([
    ["Special Music", "Trust and Obey", "Special Music"],
    ["Song", "Trust and Obey", "Trust and Obey"],
    ["Hymn", "Amazing Grace", "Amazing Grace"],
    ["Opening Song", "Trust and Obey", "Opening Song"],
    ["Closing Song", "Trust and Obey", "Closing Song"],
    ["Offering Song", "Trust and Obey", "Offering Song"],
    ["Appeal Song", "Trust and Obey", "Appeal Song"],
  ] as const)(
    "keeps the service moment separate from generic song labels (%s | %s)",
    (elementType, contentTitle, expectedTitle) => {
      const [section] = buildServicePlanSectionsFromImport(
        {
          ...data,
          sections: [
            {
              sectionName: "Music",
              rows: [
                {
                  elementType,
                  title: contentTitle,
                  contentTitle,
                  songTitle: contentTitle,
                  ledBy: "Youth Choir",
                },
              ],
            },
          ],
        },
        [{ _id: "trust", name: "Trust and Obey" }],
      );

      expect(richTextToPlainText(section.elements[0].title)).toBe(
        expectedTitle,
      );
      expect(section.elements[0].sourceContentTitleRaw).toBe(contentTitle);
      expect(section.elements[0].songRef).toBeDefined();
      expect(section.elements[0].assignees?.map(({ name }) => name)).toEqual([
        "Youth Choir",
      ]);
    },
  );

  it("parses scripture from content independently of the service moment", () => {
    const [section] = buildServicePlanSectionsFromImport(
      {
        ...data,
        sections: [
          {
            sectionName: "Message",
            rows: [
              {
                elementType: "Scripture Reading",
                title: "John 3:16-18",
                contentTitle: "John 3:16-18",
                ledBy: "Reader",
              },
            ],
          },
        ],
      },
      [],
    );

    expect(richTextToPlainText(section.elements[0].title)).toBe(
      "Scripture Reading",
    );
    expect(section.elements[0].scriptureRef).toMatchObject({
      book: "John",
      chapter: "3",
      verseRange: "16-18",
    });
  });

  it("uses content when Element is blank and falls back to a generic item", () => {
    const [section] = buildServicePlanSectionsFromImport(
      {
        ...data,
        sections: [
          {
            sectionName: "Service",
            rows: [
              { elementType: "", title: "Welcome Video", contentTitle: "Welcome Video", ledBy: "" },
              { elementType: "Item", title: "", ledBy: "" },
            ],
          },
        ],
      },
      [],
    );

    expect(richTextToPlainText(section.elements[0].title)).toBe(
      "Welcome Video",
    );
    expect(richTextToPlainText(section.elements[1].title)).toBe("Item");
  });

  it("keeps explicit timing while using the Element as the title", () => {
    const [section] = buildServicePlanSectionsFromImport(
      {
        ...data,
        sections: [
          {
            sectionName: "Service",
            rows: [
              {
                elementType: "Special Music",
                title: "Trust and Obey",
                contentTitle: "Trust and Obey",
                songTitle: "Trust and Obey",
                ledBy: "Choir A, Choir B",
                startTime: "10:15",
                durationMinutes: 2.5,
              },
            ],
          },
        ],
      },
      [],
    );

    const [element] = section.elements;
    expect(richTextToPlainText(element.title)).toBe("Special Music");
    expect(element.startTime).toBe("10:15");
    expect(element.durationSeconds).toBe(150);
    expect(element.assignees?.map(({ name }) => name)).toEqual([
      "Choir A",
      "Choir B",
    ]);
  });

  it("matches a Planning Center song by content while preserving its key", () => {
    const [section] = buildServicePlanSectionsFromImport(
      {
        ...data,
        sections: [
          {
            sectionName: "Worship",
            rows: [
              {
                elementType: "Song",
                title: "Great Are You Lord â€” Acoustic (G)",
                contentTitle: "Great Are You Lord â€” Acoustic (G)",
                songTitle: "Great Are You Lord",
                ledBy: "Jane Doe",
              },
            ],
          },
        ],
      },
      [{ _id: "song-1", name: "Great Are You Lord" }],
    );

    expect(section.elements[0].songRef).toEqual({
      kind: "library",
      songId: "song-1",
      songName: "Great Are You Lord",
      key: "G",
    });
    expect(richTextToPlainText(section.elements[0].title)).toBe(
      "Great Are You Lord â€” Acoustic (G)",
    );
  });

  it("keeps Planning Center positions as provenance instead of people", () => {
    const [section] = buildServicePlanSectionsFromImport(
      {
        ...data,
        sections: [
          {
            sectionName: "Welcome",
            rows: [
              {
                elementType: "Welcome",
                title: "Welcome",
                ledBy: "Jane Doe, Host",
                ledByAssignments: [
                  { kind: "person", id: "p1", name: "Jane Doe" },
                  { kind: "teamPosition", id: "tp1", name: "Host" },
                ],
              },
            ],
          },
        ],
      },
      [],
    );

    expect(section.elements[0].assignees?.map(({ name }) => name)).toEqual([
      "Jane Doe",
    ]);
    expect(section.elements[0].sourceLedByAssignments).toEqual([
      { kind: "person", id: "p1", name: "Jane Doe" },
      { kind: "teamPosition", id: "tp1", name: "Host" },
    ]);
  });

  it("keeps a TeamPosition-only Led by value through a plan round trip", () => {
    const [section] = buildServicePlanSectionsFromImport(
      {
        ...data,
        sections: [
          {
            sectionName: "Welcome",
            rows: [
              {
                elementType: "Welcome",
                title: "Welcome",
                ledBy: "Host",
                ledByAssignments: [
                  { kind: "teamPosition", id: "tp1", name: "Host" },
                ],
              },
            ],
          },
        ],
      },
      [],
    );

    const [element] = section.elements;
    expect(element.assignees).toBeUndefined();
    expect(element.sourceLedByRaw).toBe("Host");
    expect(element.sourceLedByAssignments).toEqual([
      { kind: "teamPosition", id: "tp1", name: "Host" },
    ]);

    const [roundTrippedRow] = servicePlanToImportData({
      name: "Sunday Gathering",
      sections: [section],
    }).sections[0].rows;
    expect(roundTrippedRow).toMatchObject({
      ledBy: "Host",
      sourceLedByRaw: "Host",
      ledByAssignments: [
        { kind: "teamPosition", id: "tp1", name: "Host" },
      ],
    });
    expect(roundTrippedRow.assigneeNames).toBeUndefined();
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

  it("records Planning Center PDF paste provenance", () => {
    const result = buildServicePlanSourceImport(
      {
        planLabel: "SMC Worship Experience",
        sections: [],
        teamAssignments: [],
      },
      "",
      "planningCenterPdf",
    );
    expect(result).toEqual({
      source: "planningCenterPdf",
      sourceUrl: "",
      loadedAt: expect.any(String),
      planLabel: "SMC Worship Experience",
    });
  });
});
