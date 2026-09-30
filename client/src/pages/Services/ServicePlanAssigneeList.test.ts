import {
  addIemSlot,
  addMicrophoneSlot,
  applyAssigneeChanges,
  hasUnclaimedMicrophoneSlot,
  hasUnclaimedIemSlot,
  releaseServicePlanAssignee,
} from "./ServicePlanAssigneeList";

describe("hasUnclaimedMicrophoneSlot", () => {
  it("is true for a microphone waiting on whoever will carry it", () => {
    expect(
      hasUnclaimedMicrophoneSlot([{ id: "s1", microphoneIds: ["mic-orange"] }]),
    ).toBe(true);
  });

  it("is false once every slot has a name on it", () => {
    expect(
      hasUnclaimedMicrophoneSlot([
        { id: "s1", name: "Pastor John", microphoneIds: ["mic-orange"] },
      ]),
    ).toBe(false);
  });

  it("ignores a blank row the operator just added", () => {
    // It holds nothing, so it strands no microphone and blocks no new person.
    expect(hasUnclaimedMicrophoneSlot([{ id: "s1" }])).toBe(false);
  });
});

describe("releaseServicePlanAssignee", () => {
  it("keeps the microphones on the item when a person is removed", () => {
    expect(
      releaseServicePlanAssignee(
        [{ id: "a1", name: "Pastor John", memberId: "m1", microphoneIds: ["mic-orange"] }],
        "a1",
      ),
    ).toEqual([{ id: "a1", microphoneIds: ["mic-orange"] }]);
  });

  it("keeps both independent equipment assignments on an unclaimed slot", () => {
    expect(releaseServicePlanAssignee([
      { id: "a1", name: "Sarah", microphoneIds: ["same-id"], iemIds: ["same-id"] },
    ], "a1")).toEqual([
      { id: "a1", microphoneIds: ["same-id"], iemIds: ["same-id"] },
    ]);
  });

  it("deletes the slot on the second press, once nobody is on it", () => {
    expect(
      releaseServicePlanAssignee([{ id: "a1", microphoneIds: ["mic-orange"] }], "a1"),
    ).toEqual([]);
  });

  it("deletes a person who was carrying nothing", () => {
    expect(
      releaseServicePlanAssignee([{ id: "a1", name: "Sarah Lee" }], "a1"),
    ).toEqual([]);
  });

  it("leaves everyone else untouched", () => {
    const others = [
      { id: "a1", name: "Pastor John" },
      { id: "a2", name: "Sarah Lee", microphoneIds: ["mic-lapel"] },
    ];
    expect(releaseServicePlanAssignee(others, "a1")).toEqual([others[1]]);
  });
});

it("preserves an IEM-only unclaimed slot when assignments are normalized in the editor", () => {
  expect(hasUnclaimedIemSlot([{ id: "s1", iemIds: ["iem-3"] }])).toBe(true);
  expect(applyAssigneeChanges([{ id: "s1", iemIds: ["iem-3"] }], "s1", { name: "" })).toEqual([
    { id: "s1", iemIds: ["iem-3"], name: "" },
  ]);
});

it("removes microphone and IEM assignments independently", () => {
  const assignees = [{ id: "s1", name: "Sarah", microphoneIds: ["mic-2"], iemIds: ["iem-3"] }];
  expect(applyAssigneeChanges(assignees, "s1", { iemIds: [] })).toEqual([
    { id: "s1", name: "Sarah", microphoneIds: ["mic-2"], iemIds: [] },
  ]);
  expect(applyAssigneeChanges(assignees, "s1", { microphoneIds: [] })).toEqual([
    { id: "s1", name: "Sarah", microphoneIds: [], iemIds: ["iem-3"] },
  ]);
});

describe("addMicrophoneSlot", () => {
  it("gives each microphone its own slot, in the order added", () => {
    const first = addMicrophoneSlot([], "mic-a");
    const second = addMicrophoneSlot(first, "mic-b");
    const third = addMicrophoneSlot(second, "mic-c");

    // Three slots, not one slot holding three: a slot is one holder, so piling
    // them together would hand all three to whoever claims it.
    expect(third).toHaveLength(3);
    expect(third.map((slot) => slot.microphoneIds)).toEqual([
      ["mic-a"],
      ["mic-b"],
      ["mic-c"],
    ]);
  });

  it("adds after the people already on the item", () => {
    const next = addMicrophoneSlot(
      [{ id: "a1", name: "Pastor John", microphoneIds: ["mic-orange"] }],
      "mic-stand",
    );

    expect(next).toHaveLength(2);
    expect(next[0]).toMatchObject({ name: "Pastor John" });
    expect(next[1].name).toBeUndefined();
    expect(next[1].microphoneIds).toEqual(["mic-stand"]);
  });
});

describe("addIemSlot", () => {
  it("gives each IEM its own unclaimed template slot", () => {
    const next = addIemSlot([{ id: "person", name: "Jordan" }], "iem-one");

    expect(next).toHaveLength(2);
    expect(next[1]).toEqual({ id: expect.any(String), iemIds: ["iem-one"] });
  });
});
