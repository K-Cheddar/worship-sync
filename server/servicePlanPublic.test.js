import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPublicServicePlanSnapshot,
  publicServingMemberIdsForPlan,
} from "./servicePlanPublic.js";

const plan = {
  published: true,
  publicLinkToken: "share-token",
  startsAt: "2026-07-27T14:00:00.000Z",
  timezone: "America/New_York",
  name: "Sunday Service",
  updatedAt: "2026-07-27T13:00:00.000Z",
  publicLive: { mode: "manual", currentElementId: "welcome" },
  sections: [
    {
      id: "main",
      name: "Main",
      elements: [
        {
          id: "welcome",
          title: {
            blocks: [{ type: "paragraph", spans: [{ text: "Welcome" }] }],
          },
          notes: {
            blocks: [
              {
                type: "paragraph",
                spans: [{ text: "Red mic", color: "#dd0000" }],
              },
            ],
          },
          teamNotes: [
            {
              label: "Media",
              note: {
                blocks: [
                  {
                    type: "paragraph",
                    spans: [{ text: "Capture the greeting" }],
                  },
                ],
              },
            },
          ],
          durationMinutes: 5,
          assignedMemberId: "private-member",
          assignedName: "Jamie Rivera",
        },
      ],
    },
  ],
};

test("detailed snapshots expose the full role roster for notes filters", () => {
  const snapshot = buildPublicServicePlanSnapshot({
    plan,
    positions: [
      {
        positionId: "camera",
        name: "Camera",
        teamId: "media",
      },
      {
        positionId: "sound",
        name: "Sound",
        teamId: "media",
      },
      {
        positionId: "archived-role",
        name: "Retired",
        teamId: "media",
        archivedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    teams: [{ teamId: "media", name: "Media Team" }],
  });

  assert.deepEqual(snapshot.roles, [
    {
      positionId: "camera",
      label: "Camera",
      teamId: "media",
      teamName: "Media Team",
    },
    {
      positionId: "sound",
      label: "Sound",
      teamId: "media",
      teamName: "Media Team",
    },
  ]);
});

test("general snapshots omit the role roster", () => {
  const snapshot = buildPublicServicePlanSnapshot({
    plan: {
      ...plan,
      publicGeneralLinkToken: "general-share-token",
    },
    positions: [
      {
        positionId: "camera",
        name: "Camera",
        teamId: "media",
      },
    ],
    teams: [{ teamId: "media", name: "Media Team" }],
    viewMode: "general",
    shareId: "general-share-token",
  });

  assert.equal(snapshot.roles, undefined);
});

test("detailed snapshots expose scheduled microphone holders by team", () => {
  const snapshot = buildPublicServicePlanSnapshot({
    plan: {
      ...plan,
      serviceId: "sunday",
      date: "2026-07-27",
    },
    microphones: [
      { id: "mic-blue", name: "Blue", type: "Handheld", color: "#2563eb" },
    ],
    teams: [
      { teamId: "worship", name: "Worship Team", usesMicrophoneAssignments: true },
      { teamId: "media", name: "Media Team", usesMicrophoneAssignments: false },
    ],
    positions: [
      { positionId: "lead", name: "Lead vocal", teamId: "worship" },
      { positionId: "camera", name: "Camera", teamId: "media" },
    ],
    members: [
      { memberId: "member-1", firstName: "Avery", lastName: "Stone" },
      { memberId: "member-2", firstName: "Jordan", lastName: "Lee" },
    ],
    schedules: [
      {
        scheduleId: "worship-schedule",
        teamId: "worship",
        occurrences: [
          {
            occurrenceId: "sunday@2026-07-27T14:00:00.000Z",
            serviceId: "sunday",
            startsAt: "2026-07-27T14:00:00.000Z",
          },
        ],
        assignments: {
          "sunday@2026-07-27T14:00:00.000Z": {
            "lead::0": { primaryMemberId: "member-1" },
          },
        },
        microphoneAssignments: {
          "sunday@2026-07-27T14:00:00.000Z": {
            "lead::0": ["mic-blue"],
          },
        },
      },
      {
        scheduleId: "media-schedule",
        teamId: "media",
        occurrences: [
          {
            occurrenceId: "sunday@2026-07-27T14:00:00.000Z",
            serviceId: "sunday",
            startsAt: "2026-07-27T14:00:00.000Z",
          },
        ],
        assignments: {
          "sunday@2026-07-27T14:00:00.000Z": {
            "camera::0": { primaryMemberId: "member-2" },
          },
        },
        microphoneAssignments: {
          "sunday@2026-07-27T14:00:00.000Z": {
            "camera::0": ["mic-blue"],
          },
        },
      },
    ],
  });

  assert.deepEqual(snapshot.servingTeams, [
    {
      teamId: "worship",
      teamName: "Worship Team",
      members: [
        {
          positionId: "lead",
          positionName: "Lead vocal",
          memberName: "Avery Stone",
          microphones: [
            { id: "mic-blue", name: "Blue", type: "Handheld", color: "#2563eb" },
          ],
        },
      ],
    },
  ]);
});

test("public detailed views load only members assigned to the matching occurrence", () => {
  const schedules = [
    {
      occurrences: [
        {
          occurrenceId: "sunday@2026-07-27T14:00:00.000Z",
          serviceId: "sunday",
          startsAt: "2026-07-27T14:00:00.000Z",
        },
        {
          occurrenceId: "sunday@2026-08-03T14:00:00.000Z",
          serviceId: "sunday",
          startsAt: "2026-08-03T14:00:00.000Z",
        },
      ],
      assignments: {
        "sunday@2026-07-27T14:00:00.000Z": {
          "lead::0": { primaryMemberId: "member-current" },
        },
        "sunday@2026-08-03T14:00:00.000Z": {
          "lead::0": { primaryMemberId: "member-future" },
        },
      },
      microphoneAssignments: {
        "sunday@2026-07-27T14:00:00.000Z": {
          "lead::0": ["mic-current"],
        },
        "sunday@2026-08-03T14:00:00.000Z": {
          "lead::0": ["mic-future"],
        },
      },
    },
  ];

  assert.deepEqual(
    publicServingMemberIdsForPlan({
      plan: { ...plan, serviceId: "sunday", date: "2026-07-27" },
      schedules,
      timezone: "America/New_York",
    }),
    ["member-current"],
  );
});

test("general snapshots never expose scheduled microphone holders", () => {
  const snapshot = buildPublicServicePlanSnapshot({
    plan: {
      ...plan,
      serviceId: "sunday",
      date: "2026-07-27",
      publicGeneralLinkToken: "general-share-token",
    },
    viewMode: "general",
    shareId: "general-share-token",
    microphones: [
      { id: "mic-blue", name: "Blue", type: "Handheld", color: "#2563eb" },
    ],
    teams: [{ teamId: "worship", name: "Worship Team", usesMicrophoneAssignments: true }],
    positions: [{ positionId: "lead", name: "Lead vocal", teamId: "worship" }],
    members: [{ memberId: "member-1", firstName: "Avery", lastName: "Stone" }],
    schedules: [
      {
        scheduleId: "worship-schedule",
        teamId: "worship",
        occurrences: [
          {
            occurrenceId: "sunday@2026-07-27T14:00:00.000Z",
            serviceId: "sunday",
            startsAt: "2026-07-27T14:00:00.000Z",
          },
        ],
        assignments: {
          "sunday@2026-07-27T14:00:00.000Z": {
            "lead::0": { primaryMemberId: "member-1" },
          },
        },
        microphoneAssignments: {
          "sunday@2026-07-27T14:00:00.000Z": {
            "lead::0": ["mic-blue"],
          },
        },
      },
    ],
  });

  assert.equal(snapshot.servingTeams, undefined);
});

test("public service plan snapshot exposes display-only team notes but omits editor fields", () => {
  const snapshot = buildPublicServicePlanSnapshot({
    plan,
    churchName: "Northside",
  });
  const item = snapshot.service.sections[0].items[0];
  assert.equal(item.title, "Welcome");
  assert.equal(item.durationSeconds, 300);
  assert.deepEqual(item.teamNotes, [
    {
      label: "Media",
      notes: {
        blocks: [
          { type: "paragraph", spans: [{ text: "Capture the greeting" }] },
        ],
      },
    },
  ]);
  assert.equal(item.creditName, "Jamie Rivera");
  assert.equal(
    snapshot.service.sections[0].items[0].assignedMemberId,
    undefined,
  );
  assert.equal(snapshot.service.viewMode, "team");
  assert.deepEqual(snapshot.service.live, {
    mode: "manual",
    currentItemId: "welcome",
  });
});

test("public service plan snapshot exposes sanitized song and scripture labels", () => {
  const snapshot = buildPublicServicePlanSnapshot({
    plan: {
      ...plan,
      sections: [{
        ...plan.sections[0],
        elements: [{
          ...plan.sections[0].elements[0],
          songRefs: [
            { kind: "library", songId: "private-song", songName: "Great Are You Lord" },
            { kind: "pending", title: "Unlinked Song", lyricsText: "private lyrics" },
          ],
          scriptureRefs: [
            { label: "Psalm 100:1–5", book: "Psalm", chapter: "100", verseRange: "1–5", version: "NIV" },
          ],
        }],
      }],
    },
  });

  assert.deepEqual(snapshot.service.sections[0].items[0].songs, [
    "Great Are You Lord",
    "Unlinked Song",
  ]);
  assert.deepEqual(snapshot.service.sections[0].items[0].scriptureRefs, ["Psalm 100:1–5"]);
  assert.equal(JSON.stringify(snapshot).includes("private-song"), false);
  assert.equal(JSON.stringify(snapshot).includes("private lyrics"), false);
});

test("public snapshots preserve a server-anchored live timeline", () => {
  const snapshot = buildPublicServicePlanSnapshot({
    plan: {
      ...plan,
      publicLive: {
        mode: "anchored",
        currentElementId: "welcome",
        startedAt: "2026-07-27T14:03:00.000Z",
      },
    },
  });

  assert.deepEqual(snapshot.service.live, {
    mode: "anchored",
    currentItemId: "welcome",
    startedAt: "2026-07-27T14:03:00.000Z",
  });
});

test("public team snapshots preserve role note targets", () => {
  const snapshot = buildPublicServicePlanSnapshot({
    plan: {
      ...plan,
      sections: [
        {
          ...plan.sections[0],
          elements: [
            {
              ...plan.sections[0].elements[0],
              teamNotes: [
                {
                  scope: "role",
                  positionIds: ["camera", "switcher"],
                  teamIds: ["media"],
                  teamNames: ["Media Team"],
                  label: "Media Team · Camera",
                  note: {
                    blocks: [
                      {
                        type: "paragraph",
                        spans: [{ text: "Hold the wide shot." }],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  });

  assert.deepEqual(snapshot.service.sections[0].items[0].teamNotes, [
    {
      scope: "role",
      positionIds: ["camera", "switcher"],
      teamIds: ["media"],
      teamNames: ["Media Team"],
      label: "Media Team · Camera",
      notes: {
        blocks: [
          { type: "paragraph", spans: [{ text: "Hold the wide shot." }] },
        ],
      },
    },
  ]);
});

test("detailed snapshots expose microphones only to their selected roles", () => {
  const microphoneAssignments = [
    {
      microphoneId: "orange-handheld",
    },
  ];
  const audiences = [
    {
      positionId: "foh",
      roleName: "Front of house sound",
      teamId: "media",
      teamName: "Media Team",
    },
  ];
  const microphones = [
    {
      id: "orange-handheld",
      name: "Orange",
      type: "Handheld",
      color: "#f97316",
    },
  ];
  const detailed = buildPublicServicePlanSnapshot({
    plan: {
      ...plan,
      sections: [
        {
          ...plan.sections[0],
          elements: [
            {
              ...plan.sections[0].elements[0],
              microphoneAssignments,
            },
          ],
        },
      ],
    },
    microphones,
    microphoneAudiences: audiences,
  });

  assert.deepEqual(
    detailed.service.sections[0].items[0].microphoneAssignments,
    [
      {
        microphone: {
          id: "orange-handheld",
          name: "Orange",
          type: "Handheld",
          color: "#f97316",
        },
        audiences,
      },
    ],
  );

  const general = buildPublicServicePlanSnapshot({
    plan: {
      ...plan,
      publicGeneralLinkToken: "general-share-token",
      sections: [
        {
          ...plan.sections[0],
          elements: [
            {
              ...plan.sections[0].elements[0],
              microphoneAssignments,
            },
          ],
        },
      ],
    },
    microphones,
    viewMode: "general",
    shareId: "general-share-token",
  });
  assert.deepEqual(
    general.service.sections[0].items[0].microphoneAssignments,
    [],
  );
});

test("public snapshots preserve ordered and nested note lists", () => {
  const snapshot = buildPublicServicePlanSnapshot({
    plan: {
      ...plan,
      sections: [
        {
          ...plan.sections[0],
          elements: [
            {
              ...plan.sections[0].elements[0],
              notes: {
                blocks: [
                  {
                    type: "list-item",
                    listStyle: "ordered",
                    listStart: 3,
                    spans: [{ text: "Third" }],
                  },
                  {
                    type: "list-item",
                    indent: 1,
                    spans: [{ text: "Nested" }],
                  },
                ],
              },
            },
          ],
        },
      ],
    },
  });

  assert.deepEqual(snapshot.service.sections[0].items[0].notes, {
    blocks: [
      {
        type: "list-item",
        listStyle: "ordered",
        listStart: 3,
        spans: [{ text: "Third" }],
      },
      {
        type: "list-item",
        indent: 1,
        spans: [{ text: "Nested" }],
      },
    ],
  });
});

test("public snapshots can carry the church primary brand color", () => {
  const snapshot = buildPublicServicePlanSnapshot({
    plan,
    churchName: "Northside",
    churchPrimaryColor: "#112233",
  });
  assert.equal(snapshot.churchPrimaryColor, "#112233");
});

test("public snapshots can carry the church secondary brand color", () => {
  const snapshot = buildPublicServicePlanSnapshot({
    plan,
    churchName: "Northside",
    churchSecondaryColor: "#AABBCC",
  });
  assert.equal(snapshot.churchSecondaryColor, "#AABBCC");
});

test("general snapshots contain credits but never operational notes", () => {
  const snapshot = buildPublicServicePlanSnapshot({
    plan: { ...plan, publicGeneralLinkToken: "general-share-token" },
    viewMode: "general",
    shareId: "general-share-token",
  });
  const item = snapshot.service.sections[0].items[0];
  assert.equal(snapshot.service.shareId, "general-share-token");
  assert.equal(snapshot.service.viewMode, "general");
  assert.deepEqual(item.notes, { blocks: [] });
  assert.deepEqual(item.teamNotes, []);
  assert.deepEqual(item.microphoneAssignments, []);
  assert.equal(item.creditName, "Jamie Rivera");
  assert.equal(item.assignedMemberId, undefined);
});

test("draft or malformed public plans are never serialized", () => {
  assert.equal(
    buildPublicServicePlanSnapshot({ plan: { ...plan, published: false } }),
    null,
  );
  assert.equal(
    buildPublicServicePlanSnapshot({ plan: { ...plan, startsAt: "invalid" } }),
    null,
  );
});

test("public snapshot anchors the timeline at a pre-service first item", () => {
  // The plan starts at 10:00 in New York; a 9:45 call time has to keep the
  // whole timeline 15 minutes earlier instead of sliding it to the service
  // start, which is what the plan editor shows.
  const withPreService = {
    ...plan,
    sections: [
      {
        ...plan.sections[0],
        elements: [
          { ...plan.sections[0].elements[0], startTime: "09:45" },
          {
            id: "song",
            title: {
              blocks: [{ type: "paragraph", spans: [{ text: "Song" }] }],
            },
            startTime: "09:50",
            durationMinutes: 10,
          },
        ],
      },
    ],
  };

  const snapshot = buildPublicServicePlanSnapshot({ plan: withPreService });

  assert.equal(snapshot.service.startsAt, "2026-07-27T14:00:00.000Z");
  assert.equal(snapshot.service.timelineStartsAt, "2026-07-27T13:45:00.000Z");
});

test("public snapshot omits the timeline anchor when the plan starts on time", () => {
  const onTime = {
    ...plan,
    sections: [
      {
        ...plan.sections[0],
        elements: [{ ...plan.sections[0].elements[0], startTime: "10:00" }],
      },
    ],
  };

  assert.equal(
    buildPublicServicePlanSnapshot({ plan: onTime }).service.timelineStartsAt,
    undefined,
  );
  assert.equal(
    buildPublicServicePlanSnapshot({ plan }).service.timelineStartsAt,
    undefined,
  );
});

test("public snapshot falls back safely when an older plan has an invalid timezone", () => {
  const snapshot = buildPublicServicePlanSnapshot({
    plan: { ...plan, timezone: "not/a-timezone" },
  });
  assert.equal(snapshot.service.timezone, "UTC");
});
