import { parsePlanningCenterPdfText } from "./planningCenterPdfParser";
import { buildServicePlanSectionsFromImport } from "./servicePlanFromImport";

const SAMPLE_PLANNING_CENTER_PDF = `Main Worship Service
September 5, 2026 - The Weight of Our
Witness // Pr. Guadalupe Montour
Length
in mins
SMC Worship Experience
15:00 SML
SML: Sabbath Morning Live.
Host: Charmers Malcolm
Co-Host: Kaydeem Wade
4:00 Opening Song: Come Before His Presence
Opening Song to begin the worship experience.
8:00 Song: Praise
1st song by Praise Team.
8:00 Song: Angus Dei (Medley)
2nd song by Praise Team.
10:00 Prayer
Elder Merrick Brown leads congregation in prayer.
9:00 Song: Ak Menn (Medley)
3rd song by Praise Team
40:00 Sermon:
Speaker: Pr. Guadalupe Montour
Scripture: Luke 11: 46-52
Appeal: The speaker calls for appeal as the praise team gets ready to lead the appeal song
3:00 Appeal Song
Usually decided during the sermon. Praise team leads song while people fill out Connect Cards and then speaker comes up
to pray for those who responded to appeal.
3:00 Call for Offering
Elder Merrick Brown calls for offering and prays.
Spotlight the fundraising for the Expansion Project
5:00 Offering Song
Usually the same song as the Appeal Song, just continued.
3:00 Closing Prayer
A good ending time is 1:30pm, 1:45pm the latest so parents can retrieve their kids from Children’s Church.
108:00`;

describe("parsePlanningCenterPdfText", () => {
  it("extracts section, durations, titles, assignees, songs, scripture, and notes", () => {
    const data = parsePlanningCenterPdfText(SAMPLE_PLANNING_CENTER_PDF);

    expect(data.planLabel).toContain("Main Worship Service");
    expect(data.sections).toHaveLength(1);
    expect(data.sections[0].sectionName).toBe("SMC Worship Experience");
    expect(data.sections[0].rows).toHaveLength(11);

    const [sml, openingSong, praise, angusDei, prayer, , sermon] =
      data.sections[0].rows;

    expect(sml).toMatchObject({
      title: "SML",
      durationMinutes: 15,
      assigneeNames: ["Host: Charmers Malcolm", "Co-Host: Kaydeem Wade"],
      note: "SML: Sabbath Morning Live.",
    });

    expect(openingSong).toMatchObject({
      title: "Opening Song: Come Before His Presence",
      durationMinutes: 4,
      songTitle: "Come Before His Presence",
      note: "Opening Song to begin the worship experience.",
    });

    expect(praise.songTitle).toBe("Praise");
    expect(angusDei.songTitle).toBe("Angus Dei (Medley)");
    expect(prayer.note).toContain("Elder Merrick Brown");

    expect(sermon).toMatchObject({
      title: "Sermon",
      durationMinutes: 40,
      assigneeNames: ["Speaker: Pr. Guadalupe Montour"],
    });
    expect(sermon.scriptureRefs?.[0]).toMatchObject({
      book: "Luke",
      chapter: "11",
      verseRange: "46-52",
    });
    expect(sermon.note).toContain("Appeal:");
  });

  it("still accepts a section title printed under the total duration", () => {
    const data = parsePlanningCenterPdfText(`Main Worship Service
Length
in mins
4:00 Opening Song: Praise
108:00
SMC Worship Experience`);
    expect(data.sections[0].sectionName).toBe("SMC Worship Experience");
    expect(data.sections[0].rows).toHaveLength(1);
  });

  it("throws when no timed items are present", () => {
    expect(() =>
      parsePlanningCenterPdfText("Just a title\nNo durations"),
    ).toThrow(/No Planning Center plan items found/i);
  });

  it("maps into service plan sections through the shared import builder", () => {
    const data = parsePlanningCenterPdfText(SAMPLE_PLANNING_CENTER_PDF);
    const sections = buildServicePlanSectionsFromImport(data, []);
    const elements = sections[0].elements;

    expect(sections[0].name).toBe("SMC Worship Experience");
    expect(elements[0].assignees?.map((assignee) => assignee.name)).toEqual([
      "Host: Charmers Malcolm",
      "Co-Host: Kaydeem Wade",
    ]);
    expect(elements[1].songRef).toEqual({
      kind: "pending",
      title: "Come Before His Presence",
      lyricsText: "",
    });
    expect(elements[6].scriptureRefs?.[0]).toMatchObject({
      book: "Luke",
      chapter: "11",
      verseRange: "46-52",
    });
    expect(elements[6].durationSeconds).toBe(40 * 60);
  });
});
