import {
  updateBoxProperties,
  updateItemTimerColor,
  updateFormattedTextDisplayInfo,
} from "./formatter";
import { ItemState, Box } from "../types";

const minimalBox: Box = {
  id: "b1",
  words: "text",
  width: 100,
  height: 100,
  fontSize: 2.5,
  brightness: 100,
  topMargin: 0,
  sideMargin: 0,
  x: 0,
  y: 0,
  background: "",
  fontColor: "rgba(255,255,255,1)",
  shouldKeepAspectRatio: false,
  transparent: false,
  excludeFromOverflow: false,
  align: "center",
  slideIndex: 0,
  label: "",
  isBold: false,
  isItalic: false,
};

const itemWithSlides: ItemState = {
  name: "Test",
  type: "image",
  _id: "item-1",
  selectedArrangement: 0,
  selectedSlide: 0,
  selectedBox: 0,
  slides: [
    {
      type: "Media",
      name: "Slide 1",
      id: "s1",
      boxes: [
        { ...minimalBox, id: "b0" },
        { ...minimalBox, id: "b1" },
      ],
    },
  ],
  arrangements: [],
  shouldSendTo: { projector: true, monitor: true, stream: true },
};

describe("formatter", () => {
  describe("updateBoxProperties", () => {
    it("returns item unchanged when slide is missing", () => {
      const noSlides = { ...itemWithSlides, slides: [] };
      const result = updateBoxProperties({
        updatedProperties: { words: "updated" },
        item: noSlides,
      });
      expect(result).toBe(noSlides);
    });

    it("updates only the selected box on the selected slide", () => {
      const result = updateBoxProperties({
        updatedProperties: { words: "new words", fontSize: 3 },
        item: itemWithSlides,
      });
      expect(result.slides[0].boxes[0].words).toBe("new words");
      expect(result.slides[0].boxes[0].fontSize).toBe(3);
      expect(result.slides[0].boxes[1]).toEqual(minimalBox);
    });

    it("applies to selected box on all slides when shouldApplyToAll is true", () => {
      const result = updateBoxProperties({
        updatedProperties: { fontColor: "#ff0000" },
        item: itemWithSlides,
        shouldApplyToAll: true,
      });
      expect(result.slides[0].boxes[0].fontColor).toBe("#ff0000");
      expect(result.slides[0].boxes[1].fontColor).toBe("rgba(255,255,255,1)");
    });
  });

  describe("updateItemTimerColor", () => {
    it("returns item unchanged when timerInfo is missing", () => {
      const item = { ...itemWithSlides, timerInfo: undefined };
      const result = updateItemTimerColor({
        timerColor: "#00ff00",
        item,
      });
      expect(result).toBe(item);
    });

    it("updates timerInfo.color", () => {
      const item: ItemState = {
        ...itemWithSlides,
        timerInfo: {
          id: "t1",
          hostId: "h",
          name: "T",
          timerType: "timer",
          status: "stopped",
          isActive: false,
          remainingTime: 60,
          color: "#000000",
        },
      };
      const result = updateItemTimerColor({
        timerColor: "#00ff00",
        item,
      });
      expect(result.timerInfo!.color).toBe("#00ff00");
    });
  });

  describe("updateFormattedTextDisplayInfo", () => {
    it("updates only selected slide when shouldApplyToAll is false", () => {
      const item: ItemState = {
        ...itemWithSlides,
        slides: [
          { ...itemWithSlides.slides[0], formattedTextDisplayInfo: undefined },
          {
            type: "Media",
            name: "Slide 2",
            id: "s2",
            boxes: [minimalBox],
            formattedTextDisplayInfo: undefined,
          },
        ],
      };
      const info = {
        backgroundColor: "#111",
        textColor: "#fff",
        fontSize: 2,
        paddingX: 1,
        paddingY: 1,
        align: "center" as const,
        isBold: false,
        isItalic: false,
        text: "",
      };
      const result = updateFormattedTextDisplayInfo({
        formattedTextDisplayInfo: info,
        item,
        shouldApplyToAll: false,
      });
      expect(result.slides[0].formattedTextDisplayInfo).toEqual(info);
      expect(result.slides[1].formattedTextDisplayInfo).toBeUndefined();
    });

    it("updates all slides when shouldApplyToAll is true", () => {
      const item: ItemState = {
        ...itemWithSlides,
        slides: [
          { ...itemWithSlides.slides[0] },
          {
            type: "Media",
            name: "Slide 2",
            id: "s2",
            boxes: [minimalBox],
          },
        ],
      };
      const info = {
        backgroundColor: "#111",
        textColor: "#fff",
        fontSize: 2,
        paddingX: 1,
        paddingY: 1,
        align: "center" as const,
        isBold: false,
        isItalic: false,
        text: "",
      };
      const result = updateFormattedTextDisplayInfo({
        formattedTextDisplayInfo: info,
        item,
        shouldApplyToAll: true,
      });
      result.slides.forEach((slide) => {
        expect(slide.formattedTextDisplayInfo).toEqual(info);
      });
    });
  });
});
