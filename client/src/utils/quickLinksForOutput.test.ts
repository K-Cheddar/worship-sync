import { QuickLinkType } from "../types";
import {
  getQuickLinksForOutput,
  isQuickLinkForOutput,
} from "./quickLinksForOutput";

const link = (overrides: Partial<QuickLinkType> = {}): QuickLinkType => ({
  id: "ql_1",
  label: "Logo",
  canDelete: true,
  displayType: "projector",
  ...overrides,
});

const MAIN = { id: "projector", type: "projector" } as const;
const LOBBY = { id: "out_lobby", type: "projector" } as const;
const STAGE = { id: "monitor", type: "monitor" } as const;

describe("isQuickLinkForOutput", () => {
  it("matches a link bound to that display", () => {
    expect(isQuickLinkForOutput(link({ outputId: "out_lobby" }), LOBBY)).toBe(
      true,
    );
  });

  it("does not leak a bound link onto another display of the same type", () => {
    expect(isQuickLinkForOutput(link({ outputId: "out_lobby" }), MAIN)).toBe(
      false,
    );
  });

  it("keeps an unbound legacy link on the built-in display of its type", () => {
    expect(isQuickLinkForOutput(link(), MAIN)).toBe(true);
  });

  it("does not inherit an unbound legacy link onto a new display", () => {
    expect(isQuickLinkForOutput(link(), LOBBY)).toBe(false);
  });

  it("does not match an unbound link across display types", () => {
    expect(isQuickLinkForOutput(link(), STAGE)).toBe(false);
  });

  it("ignores a link with neither a display nor a type", () => {
    expect(isQuickLinkForOutput(link({ displayType: undefined }), MAIN)).toBe(
      false,
    );
  });

  it("prefers the binding over the stale display type on the link", () => {
    const bound = link({ outputId: "out_lobby", displayType: "monitor" });
    expect(isQuickLinkForOutput(bound, LOBBY)).toBe(true);
    expect(isQuickLinkForOutput(bound, STAGE)).toBe(false);
  });
});

describe("getQuickLinksForOutput", () => {
  const links = [
    link({ id: "a", outputId: "out_lobby" }),
    link({ id: "b" }),
    link({ id: "c", outputId: "out_lobby" }),
    link({ id: "d", displayType: "monitor" }),
  ];

  it("returns only the links for that display", () => {
    expect(getQuickLinksForOutput(links, LOBBY).map((l) => l.id)).toEqual([
      "a",
      "c",
    ]);
    expect(getQuickLinksForOutput(links, MAIN).map((l) => l.id)).toEqual(["b"]);
  });

  it("caps the list when a surface shows only a few", () => {
    expect(getQuickLinksForOutput(links, LOBBY, 1).map((l) => l.id)).toEqual([
      "a",
    ]);
  });

  it("returns an empty list for a display with no links", () => {
    expect(
      getQuickLinksForOutput(links, { id: "out_new", type: "stream" }),
    ).toEqual([]);
  });
});
