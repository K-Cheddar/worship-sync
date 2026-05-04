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
          },
        ],
      },
    ]);
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
});
