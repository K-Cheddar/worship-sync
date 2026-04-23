import type { EventData } from "../../containers/Overlays/eventParser";
import type { ChurchIntegrations } from "../../types/integrations";
import type { OverlayInfo } from "../../types";
import {
  effectiveRuleEventLabel,
  findBestMatchingElementRule,
  mapServicePlanningRows,
  normalizeEventSuffixList,
  resolveEventSuffixForSplitIndex,
  ruleAppliesToOverlaySync,
  ruleMatchesElementType,
} from "./mapServicePlanningToOverlays";
import { findOverlayForServicePlanningCandidate } from "./findBestOverlayMatch";

const pastoralRow: EventData = {
  elementType: "Pastoral Greetings / Announcements",
  title: "Greg Baldeo, Javar Baldeo",
  ledBy: "Pastoral Team",
};

const sabbathRow: EventData = {
  elementType: "Sabbath School Lesson Study",
  title: "Co-Host-Desmond Dunkley, Kameal Anderson, Gillian Cornwall",
  ledBy: "",
};

describe("normalizeEventSuffixList", () => {
  it("reads numeric-key objects from RTDB-style payloads in index order", () => {
    expect(normalizeEventSuffixList({ "1": "Co-Host", "0": "Host" })).toEqual([
      "Host",
      "Co-Host",
    ]);
  });

  it("preserves arrays including empty strings", () => {
    expect(normalizeEventSuffixList(["Host", "Co-Host"])).toEqual([
      "Host",
      "Co-Host",
    ]);
  });
});

describe("resolveEventSuffixForSplitIndex", () => {
  it("returns index suffix or undefined when overflow without repeat", () => {
    expect(resolveEventSuffixForSplitIndex([" A", " B"], 0, false)).toBe(" A");
    expect(
      resolveEventSuffixForSplitIndex([" A", " B"], 2, false),
    ).toBeUndefined();
  });

  it("repeats last suffix when repeatLastForOverflow is true", () => {
    expect(resolveEventSuffixForSplitIndex([" Host"], 2, true)).toBe(" Host");
    expect(
      resolveEventSuffixForSplitIndex([" Co-Host", " Host"], 4, true),
    ).toBe(" Host");
  });
});

describe("effectiveRuleEventLabel", () => {
  it("uses trimmed display name when non-empty", () => {
    expect(
      effectiveRuleEventLabel({
        id: "1",
        matchElementType: "Hello",
        matchMode: "contains",
        displayName: "  Custom  ",
        nameSources: ["title"],
        multiOverlay: { mode: "single" },
      }),
    ).toBe("Custom");
  });

  it("falls back to match element type when display is blank", () => {
    expect(
      effectiveRuleEventLabel({
        id: "1",
        matchElementType: "Sabbath School",
        matchMode: "contains",
        displayName: "",
        nameSources: ["title"],
        multiOverlay: { mode: "single" },
      }),
    ).toBe("Sabbath School");
  });
});

describe("ruleMatchesElementType", () => {
  it("matches contains mode", () => {
    expect(
      ruleMatchesElementType("Foo Bar Baz", {
        id: "1",
        matchElementType: "Bar",
        matchMode: "contains",
        displayName: "X",
        nameSources: ["title"],
        multiOverlay: { mode: "single" },
      }),
    ).toBe(true);
  });
});

describe("ruleAppliesToOverlaySync", () => {
  it("defaults missing overlaySyncEnabled to true", () => {
    expect(
      ruleAppliesToOverlaySync({
        id: "1",
        matchElementType: "Song",
        matchMode: "contains",
        displayName: "",
        nameSources: ["title"],
        multiOverlay: { mode: "single" },
      }),
    ).toBe(true);
  });

  it("returns false when overlaySyncEnabled is false", () => {
    expect(
      ruleAppliesToOverlaySync({
        id: "1",
        matchElementType: "Song",
        matchMode: "contains",
        overlaySyncEnabled: false,
        displayName: "",
        nameSources: ["title"],
        multiOverlay: { mode: "single" },
      }),
    ).toBe(false);
  });
});

describe("mapServicePlanningRows", () => {
  const integrationsPastoral: ChurchIntegrations["servicePlanning"] = {
    enabled: true,
    elementRules: [
      {
        id: "pastoral",
        matchElementType: "Pastoral",
        matchMode: "contains",
        displayName: "Welcome and Announcements",
        nameSources: ["title", "ledBy"],
        multiOverlay: { mode: "single" },
        fieldTemplates: {
          event: "{{displayName}}",
        },
      },
    ],
    people: [
      {
        id: "greg",
        names: ["Greg Baldeo"],
        displayName: "Dr. Greg Baldeo",
        title: "Lead Pastor",
      },
      {
        id: "javar",
        names: ["Javar Baldeo"],
        displayName: "Javar Baldeo",
        title: "Pastoral Intern",
      },
    ],
  };

  it("single mode: blank display name falls back to match element type string", () => {
    const config: ChurchIntegrations["servicePlanning"] = {
      enabled: true,
      elementRules: [
        {
          id: "pastoral",
          matchElementType: "Pastoral",
          matchMode: "contains",
          displayName: "",
          nameSources: ["title", "ledBy"],
          multiOverlay: { mode: "single" },
        },
      ],
      people: integrationsPastoral.people,
    };
    const mapped = mapServicePlanningRows([pastoralRow], config);
    expect(mapped).toHaveLength(1);
    expect(mapped[0].candidates[0].patch.event).toBe("Pastoral");
  });

  it("pastoral row: single overlay with combined names and titles", () => {
    const mapped = mapServicePlanningRows([pastoralRow], integrationsPastoral);
    expect(mapped).toHaveLength(1);
    expect(mapped[0].candidates).toHaveLength(1);
    const patch = mapped[0].candidates[0].patch;
    expect(patch.name).toContain("Dr. Greg Baldeo");
    expect(patch.name).toContain("Javar Baldeo");
    expect(patch.title).toContain("Lead Pastor");
    expect(patch.event).toBe("Welcome and Announcements");
  });

  it("skips overlay mapping for rules with overlay sync turned off", () => {
    const config: ChurchIntegrations["servicePlanning"] = {
      enabled: true,
      elementRules: [
        {
          id: "song-outline-only",
          matchElementType: "Song of Praise",
          matchMode: "contains",
          overlaySyncEnabled: false,
          displayName: "",
          nameSources: ["title"],
          multiOverlay: { mode: "single" },
          outlineSync: {
            enabled: true,
            itemType: "song",
          },
        },
      ],
      people: [],
    };
    const row: EventData = {
      elementType: "Song of Praise",
      title: "Amazing Grace",
      ledBy: "",
    };
    expect(mapServicePlanningRows([row], config)).toEqual([]);
  });

  it("lets a more specific outline-only rule override a broader overlay rule", () => {
    const config: ChurchIntegrations["servicePlanning"] = {
      enabled: true,
      elementRules: [
        {
          id: "generic-song",
          matchElementType: "Song",
          matchMode: "contains",
          displayName: "Song",
          nameSources: ["ledBy"],
          multiOverlay: { mode: "single" },
        },
        {
          id: "song-of-praise-outline-only",
          matchElementType: "Song of Praise",
          matchMode: "contains",
          overlaySyncEnabled: false,
          displayName: "",
          nameSources: ["title"],
          multiOverlay: { mode: "single" },
          outlineSync: {
            enabled: true,
            itemType: "song",
          },
        },
      ],
      people: [],
    };
    const row: EventData = {
      elementType: "Song of Praise",
      title: "Amazing Grace",
      ledBy: "Praise Team",
    };

    expect(mapServicePlanningRows([row], config)).toEqual([]);
  });

  it("prefers the most specific matching rule before applying overlay settings", () => {
    const best = findBestMatchingElementRule("Song of Praise", [
      {
        id: "generic-song",
        matchElementType: "Song",
        matchMode: "contains",
        displayName: "Song",
        nameSources: ["title"],
        multiOverlay: { mode: "single" },
      },
      {
        id: "specific-song-of-praise",
        matchElementType: "Song of Praise",
        matchMode: "contains",
        overlaySyncEnabled: false,
        displayName: "",
        nameSources: ["title"],
        multiOverlay: { mode: "single" },
      },
    ]);

    expect(best?.id).toBe("specific-song-of-praise");
  });

  const integrationsSabbath: ChurchIntegrations["servicePlanning"] = {
    enabled: true,
    elementRules: [
      {
        id: "ss",
        matchElementType: "Sabbath School",
        matchMode: "contains",
        displayName: "Sabbath School",
        nameSources: ["title"],
        multiOverlay: {
          mode: "split",
          eventSuffixByPersonIndex: [" Co-Host", " Host", " Co-Host"],
        },
      },
    ],
    people: [
      {
        id: "d",
        names: ["Desmond Dunkley"],
        displayName: "Desmond Dunkley",
      },
      {
        id: "k",
        names: ["Kameal Anderson"],
        displayName: "Kameal Anderson",
      },
      {
        id: "g",
        names: ["Gillian Cornwall"],
        displayName: "Gillian Cornwall",
      },
    ],
  };

  it("split: applies Host to first person when pills are Host then Co-Host (regression)", () => {
    const row: EventData = {
      elementType: "Sabbath School Lesson Study",
      title: "Kameal Anderson, Gillian Cornwall",
      ledBy: "Third Person",
    };
    const config: ChurchIntegrations["servicePlanning"] = {
      enabled: true,
      elementRules: [
        {
          id: "ss",
          matchElementType: "Sabbath School Lesson Study",
          matchMode: "contains",
          displayName: "Sabbath School",
          nameSources: ["title", "ledBy"],
          multiOverlay: {
            mode: "split",
            eventSuffixByPersonIndex: ["Host", "Co-Host"],
          },
        },
      ],
      people: [],
    };
    const mapped = mapServicePlanningRows([row], config);
    expect(mapped[0].candidates).toHaveLength(3);
    expect(mapped[0].candidates[0].patch.event).toBe("Sabbath School Host");
    expect(mapped[0].candidates[1].patch.event).toBe("Sabbath School Co-Host");
    expect(mapped[0].candidates[2].patch.event).toBe("Sabbath School");
  });

  it("split: names in title and led by columns are separate people (no bogus join)", () => {
    const row: EventData = {
      elementType: "Music",
      title: "Alice Smith, Bob Jones",
      ledBy: "Charlie Lee",
    };
    const config: ChurchIntegrations["servicePlanning"] = {
      enabled: true,
      elementRules: [
        {
          id: "m",
          matchElementType: "Music",
          matchMode: "contains",
          displayName: "Special Music",
          nameSources: ["title", "ledBy"],
          multiOverlay: { mode: "split" },
        },
      ],
      people: [],
    };
    const mapped = mapServicePlanningRows([row], config);
    expect(mapped).toHaveLength(1);
    expect(mapped[0].candidates).toHaveLength(3);
    expect(mapped[0].candidates[0].patch.name).toMatch(/Alice Smith/i);
    expect(mapped[0].candidates[1].patch.name).toMatch(/Bob Jones/i);
    expect(mapped[0].candidates[2].patch.name).toMatch(/Charlie Lee/i);
  });

  it("findOverlayForServicePlanningCandidate picks exact event match for role string", () => {
    const mk = (id: string, event: string): OverlayInfo => ({
      id,
      type: "participant",
      event,
    });
    const list: OverlayInfo[] = [
      mk("gen", "Sabbath School"),
      mk("host", "Sabbath School Host"),
    ];
    const hit = findOverlayForServicePlanningCandidate(
      "Sabbath School Lesson Study",
      "Sabbath School Host",
      list,
    );
    expect(hit?.id).toBe("host");
  });

  it("findOverlayForServicePlanningCandidate ignores non-participant overlays", () => {
    const list: OverlayInfo[] = [
      { id: "image", type: "image", event: "Sabbath School Host" },
      { id: "participant", type: "participant", event: "Sabbath School Host" },
    ];
    const hit = findOverlayForServicePlanningCandidate(
      "Sabbath School Lesson Study",
      "Sabbath School Host",
      list,
    );
    expect(hit?.id).toBe("participant");
  });

  it("findOverlayForServicePlanningCandidate treats missing types as participant overlays", () => {
    const list: OverlayInfo[] = [{ id: "legacy", event: "Sabbath School Host" }];
    const hit = findOverlayForServicePlanningCandidate(
      "Sabbath School Lesson Study",
      "Sabbath School Host",
      list,
    );
    expect(hit?.id).toBe("legacy");
  });

  it("findOverlayForServicePlanningCandidate skips overlays already used for duplicate events", () => {
    const mk = (id: string, event: string): OverlayInfo => ({
      id,
      type: "participant",
      event,
    });
    const list: OverlayInfo[] = [
      mk("host", "Sabbath School Host"),
      mk("cohostA", "Sabbath School Co-Host"),
      mk("cohostB", "Sabbath School Co-Host"),
    ];
    const used = new Set<string>();
    const first = findOverlayForServicePlanningCandidate(
      "Sabbath School Lesson Study",
      "Sabbath School Co-Host",
      list,
      used,
    );
    expect(first?.id).toBe("cohostA");
    used.add(first!.id);
    const second = findOverlayForServicePlanningCandidate(
      "Sabbath School Lesson Study",
      "Sabbath School Co-Host",
      list,
      used,
    );
    expect(second?.id).toBe("cohostB");
  });

  it("split: suffix list as RTDB object still maps Host to first token", () => {
    const row: EventData = {
      elementType: "Sabbath School Lesson Study",
      title: "Kameal Anderson",
      ledBy: "",
    };
    const config: ChurchIntegrations["servicePlanning"] = {
      enabled: true,
      elementRules: [
        {
          id: "ss",
          matchElementType: "Sabbath School Lesson Study",
          matchMode: "contains",
          displayName: "Sabbath School",
          nameSources: ["title"],
          multiOverlay: {
            mode: "split",
            eventSuffixByPersonIndex: {
              "1": "Co-Host",
              "0": "Host",
            } as unknown as string[],
          },
        },
      ],
      people: [],
    };
    const mapped = mapServicePlanningRows([row], config);
    expect(mapped[0].candidates[0].patch.event).toBe("Sabbath School Host");
  });

  it("sabbath row: split into three overlays with role suffixes", () => {
    const mapped = mapServicePlanningRows([sabbathRow], integrationsSabbath);
    expect(mapped).toHaveLength(1);
    expect(mapped[0].candidates.length).toBe(3);

    expect(mapped[0].candidates[0].patch.event).toBe("Sabbath School Co-Host");
    expect(mapped[0].candidates[0].patch.name).toMatch(/Desmond/i);

    expect(mapped[0].candidates[1].patch.event).toBe("Sabbath School Host");
    expect(mapped[0].candidates[1].patch.name).toMatch(/Kameal/i);

    expect(mapped[0].candidates[2].patch.event).toBe("Sabbath School Co-Host");
    expect(mapped[0].candidates[2].patch.name).toMatch(/Gillian/i);
  });

  it("split: blank display name uses match element type in event base and overflow", () => {
    const threeNameRow: EventData = {
      elementType: "Panel",
      title: "One, Two, Three",
      ledBy: "",
    };
    const config: ChurchIntegrations["servicePlanning"] = {
      enabled: true,
      elementRules: [
        {
          id: "p",
          matchElementType: "Panel",
          matchMode: "contains",
          displayName: "",
          nameSources: ["title"],
          multiOverlay: {
            mode: "split",
            eventSuffixByPersonIndex: [" Host"],
          },
        },
      ],
      people: [],
    };
    const mapped = mapServicePlanningRows([threeNameRow], config);
    expect(mapped[0].candidates).toHaveLength(3);
    expect(mapped[0].candidates[0].patch.event).toBe("Panel Host");
    expect(mapped[0].candidates[1].patch.event).toBe("Panel");
    expect(mapped[0].candidates[2].patch.event).toBe("Panel");
  });

  it("split: when more people than configured suffixes, extras use display name only", () => {
    const threeNameRow: EventData = {
      elementType: "Panel",
      title: "One, Two, Three",
      ledBy: "",
    };
    const config: ChurchIntegrations["servicePlanning"] = {
      enabled: true,
      elementRules: [
        {
          id: "p",
          matchElementType: "Panel",
          matchMode: "contains",
          displayName: "My Event",
          nameSources: ["title"],
          multiOverlay: {
            mode: "split",
            eventSuffixByPersonIndex: [" Host"],
          },
        },
      ],
      people: [],
    };
    const mapped = mapServicePlanningRows([threeNameRow], config);
    expect(mapped[0].candidates).toHaveLength(3);
    expect(mapped[0].candidates[0].patch.event).toBe("My Event Host");
    expect(mapped[0].candidates[1].patch.event).toBe("My Event");
    expect(mapped[0].candidates[2].patch.event).toBe("My Event");
  });

  it("split: repeat last suffix applies last pill to overflow names", () => {
    const threeNameRow: EventData = {
      elementType: "Panel",
      title: "One, Two, Three",
      ledBy: "",
    };
    const config: ChurchIntegrations["servicePlanning"] = {
      enabled: true,
      elementRules: [
        {
          id: "p",
          matchElementType: "Panel",
          matchMode: "contains",
          displayName: "My Event",
          nameSources: ["title"],
          multiOverlay: {
            mode: "split",
            eventSuffixByPersonIndex: [" Host"],
            repeatLastEventSuffix: true,
          },
        },
      ],
      people: [],
    };
    const mapped = mapServicePlanningRows([threeNameRow], config);
    expect(mapped[0].candidates).toHaveLength(3);
    expect(mapped[0].candidates[0].patch.event).toBe("My Event Host");
    expect(mapped[0].candidates[1].patch.event).toBe("My Event Host");
    expect(mapped[0].candidates[2].patch.event).toBe("My Event Host");
  });
});
