import { initialCreateItemState } from "../../store/createItemSlice";
import {
  getCreateItemTypeOptions,
  getDefaultCreateItemType,
  isContentBlankCreateItemDraft,
} from "./createItemTypeDefaults";

describe("createItemTypeDefaults", () => {
  it("puts songs first on the presentation controller", () => {
    expect(
      getCreateItemTypeOptions("presentation").map((option) => option.type),
    ).toEqual(["song", "bible", "free", "timer"]);
    expect(getDefaultCreateItemType("presentation")).toBe("song");
  });

  it("puts custom items first on aux controllers", () => {
    expect(
      getCreateItemTypeOptions("aux-presentation").map((option) => option.type),
    ).toEqual(["free", "song", "bible", "timer"]);
    expect(getDefaultCreateItemType("aux-presentation")).toBe("free");
  });

  it("uses the same presentation order for the overlay controller", () => {
    expect(
      getCreateItemTypeOptions("overlay").map((option) => option.type),
    ).toEqual(["song", "bible", "free", "timer"]);
    expect(getDefaultCreateItemType("overlay")).toBe("song");
  });

  it("treats blank drafts as content-blank regardless of type", () => {
    expect(isContentBlankCreateItemDraft(initialCreateItemState)).toBe(true);
    expect(
      isContentBlankCreateItemDraft({
        ...initialCreateItemState,
        type: "free",
      }),
    ).toBe(true);
  });

  it("does not treat a typed draft as content-blank", () => {
    expect(
      isContentBlankCreateItemDraft({
        ...initialCreateItemState,
        name: "Welcome",
      }),
    ).toBe(false);
  });
});
