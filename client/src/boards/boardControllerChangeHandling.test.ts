import {
  classifyBoardControllerChange,
  type BoardChangeHandlerContext,
} from "./boardControllerChangeHandling";

const baseContext = (
  overrides: Partial<BoardChangeHandlerContext> = {},
): BoardChangeHandlerContext => ({
  viewedBoardId: "board-current",
  currentBoardId: "board-current",
  selectedAliasBoardIds: new Set(["board-current", "board-old"]),
  ...overrides,
});

describe("classifyBoardControllerChange", () => {
  it("reloads aliases and selected view for malformed changes", () => {
    expect(classifyBoardControllerChange(null, baseContext())).toEqual({
      type: "reload-aliases-and-selected",
    });
    expect(classifyBoardControllerChange({}, baseContext())).toEqual({
      type: "reload-aliases-and-selected",
    });
  });

  it("handles active-board posts inline", () => {
    expect(
      classifyBoardControllerChange(
        { id: "post:board-current:1" },
        baseContext(),
      ),
    ).toEqual({ type: "active-board-post" });
  });

  it("reloads selected view for current-board posts while viewing archive", () => {
    expect(
      classifyBoardControllerChange(
        { id: "post:board-current:9" },
        baseContext({ viewedBoardId: "board-old" }),
      ),
    ).toEqual({ type: "reload-selected" });
  });

  it("ignores posts on unrelated boards", () => {
    expect(
      classifyBoardControllerChange(
        { id: "post:other-board:1" },
        baseContext(),
      ),
    ).toEqual({ type: "ignore" });
  });

  it("routes non-deleted alias docs to the alias path", () => {
    expect(
      classifyBoardControllerChange(
        { id: "alias:sunday", doc: { aliasId: "sunday" } },
        baseContext(),
      ),
    ).toEqual({ type: "alias-doc" });
  });

  it("reloads aliases and selected view when an alias is deleted", () => {
    expect(
      classifyBoardControllerChange(
        { id: "alias:sunday", deleted: true },
        baseContext(),
      ),
    ).toEqual({ type: "reload-aliases-and-selected" });
  });

  it("reloads aliases and selected view when an alias change has no doc", () => {
    expect(
      classifyBoardControllerChange({ id: "alias:sunday" }, baseContext()),
    ).toEqual({ type: "reload-aliases-and-selected" });
  });

  it("reloads selected view for board docs in the selected alias", () => {
    expect(
      classifyBoardControllerChange({ id: "board:board-old" }, baseContext()),
    ).toEqual({ type: "reload-selected" });
  });

  it("ignores board docs outside the selected alias", () => {
    expect(
      classifyBoardControllerChange({ id: "board:unrelated" }, baseContext()),
    ).toEqual({ type: "ignore" });
  });

  it("ignores unrelated church documents", () => {
    expect(
      classifyBoardControllerChange({ id: "item:song-1" }, baseContext()),
    ).toEqual({ type: "ignore" });
    expect(
      classifyBoardControllerChange({ id: "media:video-1" }, baseContext()),
    ).toEqual({ type: "ignore" });
  });
});
