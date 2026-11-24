import {
  readSlideEditingScope,
  saveSlideEditingScope,
  SLIDE_EDITING_SCOPE_STORAGE_KEY,
} from "./slideEditingScope";

describe("slide editing scope preference", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to all slides and remembers a local selected-slide preference", () => {
    expect(readSlideEditingScope()).toBe("all");

    saveSlideEditingScope("selected");

    expect(localStorage.getItem(SLIDE_EDITING_SCOPE_STORAGE_KEY)).toBe("selected");
    expect(readSlideEditingScope()).toBe("selected");
  });

  it("falls back to all slides when the stored value is invalid", () => {
    localStorage.setItem(SLIDE_EDITING_SCOPE_STORAGE_KEY, "unexpected");

    expect(readSlideEditingScope()).toBe("all");
  });
});
