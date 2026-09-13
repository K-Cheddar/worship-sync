import { initialCreateItemState } from "../../store/createItemSlice";
import {
  getCreateItemTypeOptions,
  getDefaultCreateItemType,
  isUnstartedCreateItemDraft,
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

  it("treats the blank global song draft as unstarted", () => {
    expect(isUnstartedCreateItemDraft(initialCreateItemState)).toBe(true);
  });

  it("does not treat a typed or non-song draft as unstarted", () => {
    expect(
      isUnstartedCreateItemDraft({
        ...initialCreateItemState,
        name: "Welcome",
      }),
    ).toBe(false);
    expect(
      isUnstartedCreateItemDraft({
        ...initialCreateItemState,
        type: "free",
      }),
    ).toBe(false);
  });
});
