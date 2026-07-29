import { buildServicePlanOutlineItems } from "./servicePlanOutlineBridge";
import { createNewFreeForm, createNewHeading } from "../../utils/itemUtil";
import { plainTextToRichText } from "../../types/richText";
import type { ServicePlan } from "../../types/servicePlan";
import type { ServiceItem } from "../../types";

jest.mock("../../utils/itemUtil", () => ({
  createNewHeading: jest.fn(),
  createNewFreeForm: jest.fn(),
}));

const mockCreateNewHeading = jest.mocked(createNewHeading);
const mockCreateNewFreeForm = jest.mocked(createNewFreeForm);

const basePlan: ServicePlan = {
  planId: "plan-1",
  churchId: "church-1",
  planKey: "service-1@2026-07-26",
  serviceId: "service-1",
  date: "2026-07-26",
  name: "Sunday Service",
  sections: [
    {
      id: "section-1",
      name: "Worship",
      elements: [
        {
          id: "el-song",
          type: "song",
          title: plainTextToRichText("Great Are You Lord"),
          songRef: { kind: "library", songId: "song-1", songName: "Great Are You Lord" },
        },
        {
          id: "el-pending",
          type: "song",
          title: plainTextToRichText("Unwritten Song"),
          songRef: { kind: "pending", title: "Unwritten Song", lyricsText: "" },
        },
        {
          id: "el-video",
          type: "video",
          title: plainTextToRichText("Baptism Testimony"),
        },
      ],
    },
  ],
};

describe("buildServicePlanOutlineItems", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateNewHeading.mockImplementation(async ({ name }) => ({
      name,
      _id: `heading-${name}`,
      type: "heading",
    }));
    mockCreateNewFreeForm.mockImplementation(async ({ name }) => ({
      _id: name,
      name,
      type: "free",
      background: "",
      selectedArrangement: 0,
      selectedSlide: 0,
      selectedBox: 1,
      slides: [],
      arrangements: [],
      shouldSendTo: { projector: true, monitor: true, stream: true },
    }));
  });

  it("creates a heading for the section and inserts the library-matched song directly", async () => {
    const result = await buildServicePlanOutlineItems({
      plan: basePlan,
      currentList: [],
      db: undefined,
    });

    expect(mockCreateNewHeading).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Worship" }),
    );
    const songItem = result.items.find((item) => item.type === "song");
    expect(songItem).toEqual(
      expect.objectContaining({ _id: "song-1", name: "Great Are You Lord", type: "song" }),
    );
  });

  it("skips a pending (not-yet-created) song and reports its title", async () => {
    const result = await buildServicePlanOutlineItems({
      plan: basePlan,
      currentList: [],
      db: undefined,
    });
    expect(result.skippedTitles).toEqual(["Unwritten Song"]);
  });

  it("creates a blank free-form placeholder for a type with no real content reference", async () => {
    const result = await buildServicePlanOutlineItems({
      plan: basePlan,
      currentList: [],
      db: undefined,
    });
    expect(mockCreateNewFreeForm).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Baptism Testimony" }),
    );
    expect(result.items.some((item) => item.name === "Baptism Testimony")).toBe(true);
  });

  it("stamps pushedOutlineListId onto newly-pushed elements for future idempotency", async () => {
    const result = await buildServicePlanOutlineItems({
      plan: basePlan,
      currentList: [],
      db: undefined,
    });
    const [section] = result.updatedSections;
    expect(section.elements[0].pushedOutlineListId).toBeTruthy();
    // The skipped pending song never got a real item, so no listId to track.
    expect(section.elements[1].pushedOutlineListId).toBeUndefined();
    expect(section.elements[2].pushedOutlineListId).toBeTruthy();
  });

  it("counts only content elements, not headings, in insertedCount", async () => {
    const result = await buildServicePlanOutlineItems({
      plan: basePlan,
      currentList: [],
      db: undefined,
    });
    // 2 content items inserted (song + free-form placeholder); pending song skipped.
    expect(result.insertedCount).toBe(2);
  });

  it("does not re-push an element whose previously-pushed listId is still live", async () => {
    const alreadyPushedPlan: ServicePlan = {
      ...basePlan,
      sections: [
        {
          ...basePlan.sections[0],
          elements: [
            { ...basePlan.sections[0].elements[0], pushedOutlineListId: "already-live-id" },
          ],
        },
      ],
    };
    const currentList: ServiceItem[] = [
      { _id: "song-1", name: "Great Are You Lord", type: "song", listId: "already-live-id" },
    ];

    const result = await buildServicePlanOutlineItems({
      plan: alreadyPushedPlan,
      currentList,
      db: undefined,
    });

    expect(mockCreateNewHeading).not.toHaveBeenCalled();
    expect(result.items).toEqual([]);
    expect(result.insertedCount).toBe(0);
  });

  it("skips creating a heading for a section where nothing is new", async () => {
    const noNewWorkPlan: ServicePlan = {
      ...basePlan,
      sections: [
        {
          id: "section-done",
          name: "Already pushed",
          elements: [
            { ...basePlan.sections[0].elements[0], pushedOutlineListId: "still-here" },
          ],
        },
        basePlan.sections[0],
      ],
    };
    const currentList: ServiceItem[] = [
      { _id: "song-1", name: "Great Are You Lord", type: "song", listId: "still-here" },
    ];

    await buildServicePlanOutlineItems({
      plan: noNewWorkPlan,
      currentList,
      db: undefined,
    });

    expect(mockCreateNewHeading).toHaveBeenCalledTimes(1);
    expect(mockCreateNewHeading).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Worship" }),
    );
  });
});
