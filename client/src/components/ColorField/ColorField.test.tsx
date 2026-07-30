import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ColorField from "./ColorField";
import { GlobalInfoContext } from "../../context/globalInfo";
import { createMockGlobalContext } from "../../test/mocks";
import {
  RECENT_COLORS_STORAGE_KEY,
  writeRecentColors,
} from "../../utils/recentColors";

describe("ColorField", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders saved church brand swatches and applies a selected swatch", async () => {
    const handleChange = jest.fn();

    const { unmount } = render(
      <GlobalInfoContext.Provider
        value={
          createMockGlobalContext({
            churchBranding: {
              mission: "",
              vision: "",
              logos: { square: null, wide: null },
              colors: [
                { label: "Primary", value: "#112233" },
                { value: "#AABBCCDD" },
              ],
            },
          }) as any
        }
      >
        <ColorField
          label="Background"
          value="#000000"
          onChange={handleChange}
        />
      </GlobalInfoContext.Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "#000000" }));

    await waitFor(() => {
      expect(screen.getByText("Primary")).toBeInTheDocument();
    });
    expect(screen.getByText("Color 2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Primary/i }));

    expect(handleChange).toHaveBeenCalledWith("#112233");
    expect(localStorage.getItem(RECENT_COLORS_STORAGE_KEY)).toBeNull();

    unmount();

    expect(localStorage.getItem(RECENT_COLORS_STORAGE_KEY)).toContain(
      "#112233",
    );
  });

  it("renders recent color swatches and applies a selected recent color", async () => {
    writeRecentColors(["#FF0000", "#00FF00"]);
    const handleChange = jest.fn();

    render(
      <GlobalInfoContext.Provider
        value={
          createMockGlobalContext({
            churchBranding: {
              mission: "",
              vision: "",
              logos: { square: null, wide: null },
              colors: [],
            },
          }) as any
        }
      >
        <ColorField
          label="Background"
          value="#000000"
          onChange={handleChange}
        />
      </GlobalInfoContext.Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "#000000" }));

    await waitFor(() => {
      expect(screen.getByText("Recent")).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Recent color #FF0000" }),
    );

    expect(handleChange).toHaveBeenCalledWith("#FF0000");
  });
});
