import assert from "node:assert/strict";
import test from "node:test";
import { mapPlanningCenterPlanToImportData } from "./planningCenterPlanImport.js";

test("mapPlanningCenterPlanToImportData maps assignees, key, arrangement, and start time", () => {
  const result = mapPlanningCenterPlanToImportData({
    plan: {
      type: "Plan",
      id: "42",
      attributes: {
        dates: "September 14, 2026",
        title: "Sunday Gathering",
        planning_center_url:
          "https://services.planningcenteronline.com/plans/42",
      },
      relationships: {
        service_type: { data: { type: "ServiceType", id: "7" } },
      },
    },
    items: [
      {
        type: "Item",
        id: "1",
        attributes: {
          item_type: "header",
          title: "Worship",
          service_position: "during",
        },
      },
      {
        type: "Item",
        id: "2",
        attributes: {
          item_type: "song",
          title: "Opening",
          length: 240,
          key_name: "G",
          service_position: "during",
        },
        relationships: {
          song: { data: { type: "Song", id: "s1" } },
          arrangement: { data: { type: "Arrangement", id: "ar1" } },
          key: { data: { type: "Key", id: "k1" } },
          item_notes: { data: [{ type: "ItemNote", id: "n1" }] },
          item_assignments: {
            data: [
              { type: "ItemAssignment", id: "a1" },
              { type: "ItemAssignment", id: "a2" },
            ],
          },
          item_times: { data: [{ type: "ItemTime", id: "it1" }] },
        },
      },
      {
        type: "Item",
        id: "3",
        attributes: {
          item_type: "item",
          title: "Welcome",
          description: "Greet guests",
          service_position: "during",
        },
        relationships: {
          item_assignments: {
            data: [{ type: "ItemAssignment", id: "a3" }],
          },
        },
      },
      {
        type: "Item",
        id: "4",
        attributes: {
          item_type: "header",
          title: "Message",
          service_position: "during",
        },
      },
      {
        type: "Item",
        id: "5",
        attributes: {
          item_type: "item",
          title: "Sermon",
          service_position: "during",
        },
      },
    ],
    included: [
      {
        type: "Song",
        id: "s1",
        attributes: { title: "Great Are You Lord" },
      },
      {
        type: "Arrangement",
        id: "ar1",
        attributes: { name: "Acoustic" },
      },
      {
        type: "Key",
        id: "k1",
        attributes: { starting_key: "G", name: "G" },
      },
      {
        type: "ItemNote",
        id: "n1",
        attributes: { content: "Band in" },
      },
      {
        type: "ItemTime",
        id: "it1",
        attributes: { exclude: false },
        relationships: {
          plan_time: { data: { type: "PlanTime", id: "pt1" } },
        },
      },
      {
        type: "PlanTime",
        id: "pt1",
        attributes: {
          starts_at: "2026-09-14T10:15:00-04:00",
          time_type: "service",
        },
      },
      {
        type: "ItemAssignment",
        id: "a1",
        relationships: {
          assignable: { data: { type: "Person", id: "p1" } },
        },
      },
      {
        type: "ItemAssignment",
        id: "a2",
        relationships: {
          assignable: { data: { type: "Person", id: "p2" } },
        },
      },
      {
        type: "ItemAssignment",
        id: "a3",
        relationships: {
          assignable: { data: { type: "TeamPosition", id: "tp1" } },
        },
      },
      {
        type: "Person",
        id: "p1",
        attributes: { name: "Jane Doe" },
      },
      {
        type: "Person",
        id: "p2",
        attributes: { first_name: "Jordan", last_name: "Lee" },
      },
      {
        type: "TeamPosition",
        id: "tp1",
        attributes: { name: "Host" },
      },
    ],
  });

  assert.equal(result.sections[0].sectionName, "Worship");
  const songRow = result.sections[0].rows[0];
  assert.equal(songRow.songTitle, "Great Are You Lord");
  assert.equal(songRow.contentTitle, songRow.title);
  assert.equal(songRow.title, "Great Are You Lord — Acoustic (G)");
  assert.equal(songRow.startTime, "10:15");
  assert.equal(songRow.ledBy, "Jane Doe, Jordan Lee");
  assert.deepEqual(songRow.ledByAssignments, [
    { kind: "person", id: "p1", name: "Jane Doe" },
    { kind: "person", id: "p2", name: "Jordan Lee" },
  ]);
  assert.equal(songRow.note, "Band in");
  assert.equal(result.sections[0].rows[1].ledBy, "Host");
  assert.deepEqual(result.sections[0].rows[1].ledByAssignments, [
    { kind: "teamPosition", id: "tp1", name: "Host" },
  ]);
  assert.equal(result.sections[1].sectionName, "Message");
});

test("mapPlanningCenterPlanToImportData puts pre and post items in their own sections", () => {
  const result = mapPlanningCenterPlanToImportData({
    plan: {
      type: "Plan",
      id: "9",
      attributes: { short_dates: "Sep 14" },
      relationships: {
        service_type: { data: { type: "ServiceType", id: "1" } },
      },
    },
    items: [
      {
        type: "Item",
        id: "1",
        attributes: {
          item_type: "item",
          title: "Lobby music",
          service_position: "pre",
        },
      },
      {
        type: "Item",
        id: "2",
        attributes: {
          item_type: "header",
          title: "Worship",
          service_position: "during",
        },
      },
      {
        type: "Item",
        id: "3",
        attributes: {
          item_type: "media",
          title: "Welcome slide",
          service_position: "during",
        },
      },
      {
        type: "Item",
        id: "4",
        attributes: {
          item_type: "item",
          title: "Dismissal video",
          service_position: "post",
        },
      },
    ],
  });

  assert.equal(result.sections.length, 3);
  assert.equal(result.sections[0].sectionName, "Pre-Service");
  assert.equal(result.sections[0].rows[0].title, "Lobby music");
  assert.equal(result.sections[1].sectionName, "Worship");
  assert.equal(result.sections[1].rows[0].elementType, "Media");
  assert.equal(result.sections[2].sectionName, "Post-Service");
  assert.equal(result.sections[2].rows[0].title, "Dismissal video");
});
