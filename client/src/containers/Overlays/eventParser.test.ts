import { parseServicePlanningImportFromHtml } from "./eventParser";

describe("parseServicePlanningImportFromHtml", () => {
  it("extracts the import plan label from the printout header", () => {
    const parsed = parseServicePlanningImportFromHtml(`
      <body>
        <table class="service-info-table-printout">
          <tr class="datetime">
            <td class="right">Date:</td>
            <th class="left">May&nbsp;2,&nbsp;2026 - 10 AM</th>
          </tr>
        </table>
        <table>
          <tr class="divider-1"><td colspan="6">Welcome</td></tr>
          <tr class="main-row">
            <td>10</td>
            <td>5m</td>
            <td>Welcome</td>
            <td>Welcome Song</td>
            <td>Praise Team</td>
            <td></td>
          </tr>
        </table>
      </body>
    `);

    expect(parsed.planLabel).toBe("May 2, 2026 - 10 AM");
    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0].rows[0]).toEqual({
      elementType: "Welcome",
      title: "Welcome Song",
      ledBy: "Praise Team",
      startTime: "10:00",
      durationMinutes: 5,
    });
  });

  it("parses share-link accordion rows with section dividers and inline titles", () => {
    const parsed = parseServicePlanningImportFromHtml(`
      <body>
        <div id="weekend-service">
          <h3>Sat,&nbsp;May&nbsp;2 - 10 AM</h3>
        </div>
        <table class="table">
          <tr class="divider-1053771">
            <td colspan="3">Teaching &amp; Mission</td>
          </tr>
          <tr class="accordion-toggle" data-toggle="collapse">
            <td>10:50&nbsp;<span>(5m)</span></td>
            <td>
              Mission Story<br>
              Adventist.org
            </td>
            <td>Media Team</td>
          </tr>
          <tr class="divider-1053773">
            <td colspan="3">The Word</td>
          </tr>
          <tr class="accordion-toggle" data-toggle="collapse">
            <td>11:46&nbsp;<span>(45m)</span></td>
            <td>
              Sermon<br>
              -
              Developing The Inner Algorithm
            </td>
            <td>Chadwick Anderson</td>
          </tr>
        </table>
      </body>
    `);

    expect(parsed.planLabel).toBe("Sat, May 2 - 10 AM");
    expect(parsed.sections).toEqual([
      {
        sectionName: "Teaching & Mission",
        rows: [
          {
            elementType: "Mission Story",
            title: "Adventist.org",
            ledBy: "Media Team",
            startTime: "10:50",
            durationMinutes: 5,
          },
        ],
      },
      {
        sectionName: "The Word",
        rows: [
          {
            elementType: "Sermon",
            title: "Developing The Inner Algorithm",
            ledBy: "Chadwick Anderson",
            startTime: "11:46",
            durationMinutes: 45,
          },
        ],
      },
    ]);
  });

  it("parses general and team notes from accordion detail panels", () => {
    const parsed = parseServicePlanningImportFromHtml(`
      <body>
        <table class="table">
          <tr><th>Start Time</th><th>Element</th><th>Led By</th></tr>
          <tr class="divider-1053771"><td colspan="3">Teaching &amp; Mission</td></tr>
          <tr class="accordion-toggle" data-toggle="collapse" data-target="#collapse11282024" data-id="11282024">
            <td>10:00&nbsp;<span>(50<span class="text-muted">m</span>)</span></td>
            <td>Sabbath School Lesson Study<br> - Javar Baldeo</td>
            <td>Greg Baldeo</td>
          </tr>
          <tr>
            <td colspan="3">
              <div id="collapse11282024" class="collapse in">
                <br />&nbsp;<br />General Notes:<br /> Panel Discussion<br/>
                <br />&nbsp;<br />Specific Notes:
                <table>
                  <tbody>
                    <tr><td>Media Team </td><td>3 or 4 headsets</td></tr>
                    <tr><td>Coordinators</td><td></td></tr>
                    <tr><td>Sabbath School Panel (g)</td><td>Begin after the countdown.</td></tr>
                  </tbody>
                </table>
                <br />
              </div>
            </td>
          </tr>
          <tr class="accordion-toggle" data-toggle="collapse" data-target="#collapse11282036" data-id="11282036">
            <td>11:16&nbsp;<span>(<span class="text-muted">none</span>)</span></td>
            <td>Song of Praise<br> <b>How Great is Our God</b> (E)</td>
            <td>Praise Team</td>
          </tr>
          <tr>
            <td colspan="3">
              <div id="collapse11282036" class="collapse in">
                <a href="https://planning.myamplify.io/dashboard.cfm">Log in for more song info.</a> <br />
                <br />&nbsp;<br />Specific Notes:
                <table>
                  <tbody>
                    <tr><td>Band</td><td>Follow the Worship Leader</td></tr>
                    <tr><td>Media Team </td><td></td></tr>
                  </tbody>
                </table>
                <br />
              </div>
            </td>
          </tr>
        </table>
      </body>
    `);

    expect(parsed.sections).toEqual([
      {
        sectionName: "Teaching & Mission",
        rows: [
          {
            elementType: "Sabbath School Lesson Study",
            title: "Javar Baldeo",
            ledBy: "Greg Baldeo",
            startTime: "10:00",
            durationMinutes: 50,
            note: "Panel Discussion",
            teamNotes: [
              { teamName: "Media Team", note: "3 or 4 headsets" },
              { teamName: "Sabbath School Panel (g)", note: "Begin after the countdown." },
            ],
          },
          {
            elementType: "Song of Praise",
            title: "How Great is Our God (E)",
            ledBy: "Praise Team",
            startTime: "11:16",
            teamNotes: [{ teamName: "Band", note: "Follow the Worship Leader" }],
          },
        ],
      },
    ]);
  });

  it("keeps note line breaks and drops the unassigned Led By placeholder", () => {
    const parsed = parseServicePlanningImportFromHtml(`
      <body>
        <table class="table">
          <tr class="accordion-toggle" data-toggle="collapse" data-target="#collapse1" data-id="1">
            <td>11:12&nbsp;<span>(2m)</span></td>
            <td>Call to Praise<br></td>
            <td><span>[Not Specified]</span></td>
          </tr>
          <tr>
            <td colspan="3">
              <div id="collapse1" class="collapse in">
                <br />&nbsp;<br />General Notes:<br /> Set the tone<br />Then hand over<br/>
                <br />&nbsp;<br />Specific Notes:
                <table><tbody>
                  <tr><td>Media Team</td><td>3 or 4 headsets:

- Host: Gray
- Co-Host: Blue</td></tr>
                </tbody></table>
              </div>
            </td>
          </tr>
        </table>
      </body>
    `);

    expect(parsed.sections[0].rows[0]).toEqual({
      elementType: "Call to Praise",
      title: "",
      ledBy: "",
      startTime: "11:12",
      durationMinutes: 2,
      note: "Set the tone\nThen hand over",
      teamNotes: [
        {
          teamName: "Media Team",
          note: "3 or 4 headsets:\n- Host: Gray\n- Co-Host: Blue",
        },
      ],
    });
  });

  it("keeps note line breaks in custom-column printouts", () => {
    const parsed = parseServicePlanningImportFromHtml(`
      <table class="custom-printout">
        <thead><tr>
          <th>Start Time</th><th>Duration</th><th>Element Type</th><th>Title</th>
          <th>Led by</th><th>Note</th><th>Media Team</th>
        </tr></thead>
        <tbody>
          <tr>
            <td>11:11a</td><td>1m</td><td>Welcome Song</td><td>There's a Welcome Here</td>
            <td></td><td>Line one
Line two</td><td>Mics:

- Lead: Gray
- Backup: Blue</td>
          </tr>
        </tbody>
      </table>
    `);

    expect(parsed.sections[0].rows[0]).toEqual({
      startTime: "11:11",
      durationMinutes: 1,
      elementType: "Welcome Song",
      title: "There's a Welcome Here",
      ledBy: "",
      note: "Line one\nLine two",
      teamNotes: [
        { teamName: "Media Team", note: "Mics:\n- Lead: Gray\n- Backup: Blue" },
      ],
    });
  });

  it("parses worship-flow rows and ignores team role tables", () => {
    const parsed = parseServicePlanningImportFromHtml(`
      <body>
        <span style="font-size: 14px;">| May&nbsp;2,&nbsp;2026 - 10 AM</span>
        <table class="worship-flow-table">
          <thead>
            <tr>
              <td>Start Time (Duration)</td>
              <td>Activity</td>
              <td>Title</td>
              <td>Led by</td>
              <td>Note</td>
            </tr>
          </thead>
          <tbody>
            <tr class="divider-1033223">
              <td colspan="5">Welcome &amp; Connection</td>
            </tr>
            <tr style="background-color: #E7E7E7;">
              <td>11 (10m)</td>
              <td>Pastoral Greetings / Announcements</td>
              <td>Chadwick Anderson</td>
              <td>Pastoral Team</td>
              <td>All announcements/promotions</td>
            </tr>
            <tr class="divider-1053773">
              <td colspan="5">The Word</td>
            </tr>
            <tr style="background-color: transparent;">
              <td>11:46:30 (45m)</td>
              <td>Sermon</td>
              <td>Developing The Inner Algorithm</td>
              <td>Chadwick Anderson</td>
              <td></td>
            </tr>
          </tbody>
        </table>
        <div id="teams">
          <div class="teamContainer">
            <table class="stdTable">
              <tbody>
                <tr><th colspan="3">Praise Team</th></tr>
                <tr>
                  <td align="right">Worship Leader</td>
                  <td><span class="wp-icons wp-icons-assignment-status-5"></span></td>
                  <td><span>Kailyn Reid</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </body>
    `);

    expect(parsed.planLabel).toBe("May 2, 2026 - 10 AM");
    expect(parsed.sections).toEqual([
      {
        sectionName: "Welcome & Connection",
        rows: [
          {
            elementType: "Pastoral Greetings / Announcements",
            title: "Chadwick Anderson",
            ledBy: "Pastoral Team",
            startTime: "11:00",
            durationMinutes: 10,
            note: "All announcements/promotions",
          },
        ],
      },
      {
        sectionName: "The Word",
        rows: [
          {
            elementType: "Sermon",
            title: "Developing The Inner Algorithm",
            ledBy: "Chadwick Anderson",
            startTime: "11:46",
            durationMinutes: 45,
          },
        ],
      },
    ]);
    expect(parsed.teamAssignments).toEqual([
      {
        teamName: "Praise Team",
        role: "Worship Leader",
        name: "Kailyn Reid",
      },
    ]);
  });

  it("parses custom-column printouts with timing, a shared note, and team notes", () => {
    const parsed = parseServicePlanningImportFromHtml(`
      <table class="custom-printout">
        <thead><tr>
          <th>Start Time</th><th>Duration</th><th>Element Type</th><th>Title</th>
          <th>Led by</th><th>Note</th><th>Coordinators</th><th>Media Team</th><th>Praise Team</th>
        </tr></thead>
        <tbody>
          <tr class="divider-1"><td colspan="9">Welcome</td></tr>
          <tr>
            <td>11:11a</td><td>1m 30s</td><td>Welcome Song</td><td>There's a Welcome Here (C)</td>
            <td>Praise Team</td><td>Invite everyone to sing.</td><td>Ready the platform.</td>
            <td>Capture the greetings.</td><td>Walk around and greet people.</td>
          </tr>
        </tbody>
      </table>
    `);

    expect(parsed.sections).toEqual([{ sectionName: "Welcome", rows: [{
      startTime: "11:11",
      durationMinutes: 1.5,
      elementType: "Welcome Song",
      title: "There's a Welcome Here (C)",
      ledBy: "Praise Team",
      note: "Invite everyone to sing.",
      teamNotes: [
        { teamName: "Coordinators", note: "Ready the platform." },
        { teamName: "Media Team", note: "Capture the greetings." },
        { teamName: "Praise Team", note: "Walk around and greet people." },
      ],
    }] }]);
  });

  it("preserves separators between multiple people in a Led by cell", () => {
    const parsed = parseServicePlanningImportFromHtml(`
      <table class="custom-printout">
        <thead><tr>
          <th>Start Time</th><th>Duration</th><th>Element Type</th><th>Title</th>
          <th>Led by</th><th>Note</th>
        </tr></thead>
        <tbody>
          <tr>
            <td>11:11a</td><td>2m</td><td>Welcome</td><td>Host team</td>
            <td>Jamie Rivera<br>Morgan Lee<br>Taylor Smith</td><td></td>
          </tr>
        </tbody>
      </table>
    `);

    expect(parsed.sections[0].rows[0].ledBy).toBe(
      "Jamie Rivera, Morgan Lee, Taylor Smith",
    );
  });

  it("reads the song from the source's music marker on a share link", () => {
    const parsed = parseServicePlanningImportFromHtml(`
      <body>
        <table class="table">
          <tr class="divider-1"><td colspan="3">Praise &amp; Prayer</td></tr>
          <tr class="accordion-toggle" data-toggle="collapse">
            <td>11:11&nbsp;<span>(1m30s)</span></td>
            <td>
              Welcome Song<br>
              <span class="fa fa-music text-grey"></span>&nbsp;<b>There's a Welcome Here</b>
              (C)
            </td>
            <td>Praise Team</td>
          </tr>
          <tr class="accordion-toggle" data-toggle="collapse">
            <td>11:12&nbsp;<span>(2m)</span></td>
            <td>
              Call to Praise<br>
            </td>
            <td><span>[Not Specified]</span></td>
          </tr>
        </table>
      </body>
    `);

    expect(parsed.sections[0].rows).toEqual([
      {
        startTime: "11:11",
        durationMinutes: 1.5,
        elementType: "Welcome Song",
        title: "There's a Welcome Here (C)",
        ledBy: "Praise Team",
        songTitle: "There's a Welcome Here (C)",
      },
      // No marker: the source is not calling this a song, however it reads.
      {
        startTime: "11:12",
        durationMinutes: 2,
        elementType: "Call to Praise",
        title: "",
        ledBy: "",
      },
    ]);
  });

  it("reads the song from the music marker in a custom-columns printout", () => {
    const parsed = parseServicePlanningImportFromHtml(`
      <table class="custom-printout">
        <thead><tr>
          <th>Start Time</th><th>Duration</th><th>Element Type</th><th>Title</th>
          <th>Led by</th><th>Note</th>
        </tr></thead>
        <tbody>
          <tr>
            <td>11:40a</td><td>4m</td><td>Congregational Hymn</td>
            <td><span class="fa fa-music"></span> He Hideth My Soul #520 (Bb)</td>
            <td>Praise Team</td><td></td>
          </tr>
          <tr>
            <td>11:44a</td><td>2m</td><td>Scripture Reading</td>
            <td>Psalm 89: 26 - 52 NIV</td>
            <td>Javar Baldeo</td><td></td>
          </tr>
        </tbody>
      </table>
    `);

    expect(parsed.sections[0].rows[0]).toMatchObject({
      elementType: "Congregational Hymn",
      title: "He Hideth My Soul #520 (Bb)",
      songTitle: "He Hideth My Soul #520 (Bb)",
    });
    expect(parsed.sections[0].rows[1].songTitle).toBeUndefined();
  });

  it("stops a marked song title at the next song in a medley cell", () => {
    const parsed = parseServicePlanningImportFromHtml(`
      <table class="custom-printout">
        <thead><tr>
          <th>Start Time</th><th>Duration</th><th>Element Type</th><th>Title</th>
          <th>Led by</th><th>Note</th>
        </tr></thead>
        <tbody>
          <tr>
            <td>11:20a</td><td>6m</td><td>Song of Praise</td>
            <td>
              <span class="fa fa-music"></span> Shall Not Want (Eb)
              <span class="fa fa-music"></span> Bless Me (C#)
            </td>
            <td>Praise Team</td><td></td>
          </tr>
        </tbody>
      </table>
    `);

    expect(parsed.sections[0].rows[0].songTitle).toBe("Shall Not Want (Eb)");
  });
});
