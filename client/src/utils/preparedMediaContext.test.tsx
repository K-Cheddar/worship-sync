import { act, renderHook } from "@testing-library/react";
import {
  usePreparedMediaContext,
  type PreparedMediaContext,
} from "./preparedMediaContext";

const fallback: PreparedMediaContext = {
  controllerProfileId: "presentation",
  controllerProfileName: "Presentation",
  outlineScope: "presentation",
  outlineId: "persisted-outline",
  outlineName: "Persisted Outline",
  contextSource: "persisted ItemLists fallback",
};

describe("usePreparedMediaContext", () => {
  it("adopts matching runtime selection while isolating other controller scopes", () => {
    const { result } = renderHook(() => usePreparedMediaContext(fallback));
    const selected: PreparedMediaContext = {
      ...fallback,
      outlineId: "runtime-outline",
      outlineName: "Runtime Outline",
      contextSource: "local runtime selection",
    };

    act(() => {
      window.dispatchEvent(
        new CustomEvent("worshipsync-prepared-media-context", {
          detail: {
            ...selected,
            controllerProfileId: "auxiliary",
            outlineScope: "auxiliary",
          },
        }),
      );
    });
    expect(result.current).toEqual(fallback);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("worshipsync-prepared-media-context", {
          detail: selected,
        }),
      );
    });
    expect(result.current).toEqual(selected);
  });
});
