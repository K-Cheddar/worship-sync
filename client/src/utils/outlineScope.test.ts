import { ItemList } from "../types";
import {
  DEFAULT_OUTLINE_SCOPE,
  filterOutlinesByScope,
  getOutlineScope,
  isOutlineInScope,
  resolveOutlineForScope,
} from "./outlineScope";

const outline = (_id: string, controllerScope?: string): ItemList => ({
  _id,
  name: _id,
  ...(controllerScope ? { controllerScope } : {}),
});

const lists = [
  outline("sunday-am"),
  outline("lobby-a", "ctrl_lobby"),
  outline("sunday-pm"),
  outline("lobby-b", "ctrl_lobby"),
];

describe("getOutlineScope", () => {
  it("treats an outline with no scope as the presentation controller's", () => {
    // Every outline that existed before scoping has to keep working.
    expect(getOutlineScope(outline("sunday-am"))).toBe(DEFAULT_OUTLINE_SCOPE);
    expect(getOutlineScope(undefined)).toBe(DEFAULT_OUTLINE_SCOPE);
    expect(getOutlineScope(null)).toBe(DEFAULT_OUTLINE_SCOPE);
  });

  it("ignores a whitespace-only scope rather than creating an unreachable outline", () => {
    expect(getOutlineScope(outline("x", "   "))).toBe(DEFAULT_OUTLINE_SCOPE);
  });

  it("returns an explicit scope", () => {
    expect(getOutlineScope(outline("lobby-a", "ctrl_lobby"))).toBe(
      "ctrl_lobby",
    );
  });
});

describe("isOutlineInScope", () => {
  it("matches unscoped outlines against the presentation scope", () => {
    expect(isOutlineInScope(outline("sunday-am"), DEFAULT_OUTLINE_SCOPE)).toBe(
      true,
    );
    expect(isOutlineInScope(outline("sunday-am"), "ctrl_lobby")).toBe(false);
  });

  it("treats an empty requested scope as the presentation scope", () => {
    expect(isOutlineInScope(outline("sunday-am"), "")).toBe(true);
  });
});

describe("filterOutlinesByScope", () => {
  it("returns only one controller's outlines, in order", () => {
    expect(filterOutlinesByScope(lists, "ctrl_lobby").map((l) => l._id)).toEqual(
      ["lobby-a", "lobby-b"],
    );
    expect(
      filterOutlinesByScope(lists, DEFAULT_OUTLINE_SCOPE).map((l) => l._id),
    ).toEqual(["sunday-am", "sunday-pm"]);
  });

  it("returns nothing for a controller with no outlines yet", () => {
    expect(filterOutlinesByScope(lists, "ctrl_new")).toEqual([]);
  });
});

describe("resolveOutlineForScope", () => {
  it("prefers the outline the controller had open", () => {
    expect(resolveOutlineForScope(lists, "ctrl_lobby", "lobby-b")?._id).toBe(
      "lobby-b",
    );
  });

  it("falls back to the first outline in the same scope", () => {
    expect(resolveOutlineForScope(lists, "ctrl_lobby", "gone")?._id).toBe(
      "lobby-a",
    );
  });

  it("never falls back across scopes", () => {
    // The regression this exists to prevent: an auxiliary controller silently
    // opening the sanctuary's outline because its own went away.
    expect(
      resolveOutlineForScope(lists, "ctrl_lobby", "sunday-am")?._id,
    ).not.toBe("sunday-am");
    expect(resolveOutlineForScope(lists, "ctrl_new", "sunday-am")).toBeUndefined();
  });
});
