import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ColorField from "./ColorField";
import { GlobalInfoContext } from "../../context/globalInfo";
import { createMockGlobalContext } from "../../test/mocks";
import {
  RECENT_COLORS_STORAGE_KEY,
  readRecentColors,
  writeRecentColors,
} from "../../utils/recentColors";

describe("ColorField", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    jest.useRealTimers();
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

    // Brand swatches are presets — they should not be written to recents.
    expect(localStorage.getItem(RECENT_COLORS_STORAGE_KEY)).toBeNull();
  });

  it("does not persist brand or common preset picks to recent colors", async () => {
    jest.useFakeTimers();
    const handleChange = jest.fn();

    render(
      <GlobalInfoContext.Provider
        value={
          createMockGlobalContext({
            churchBranding: {
              mission: "",
              vision: "",
              logos: { square: null, wide: null },
              colors: [{ label: "Primary", value: "#112233" }],
            },
          }) as any
        }
      >
        <ColorField
          label="Background"
          value="#00ADC5"
          onChange={handleChange}
        />
      </GlobalInfoContext.Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "#00ADC5" }));

    await waitFor(() => {
      expect(screen.getByText("Primary")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Primary/i }));
    fireEvent.click(screen.getByRole("button", { name: "Color #FFFFFF" }));

    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(handleChange).toHaveBeenCalledWith("#112233");
    expect(handleChange).toHaveBeenCalledWith("#FFFFFF");
    expect(readRecentColors()).toEqual([]);
    expect(
      screen.queryByRole("button", { name: "Color #112233" }),
    ).not.toBeInTheDocument();
  });

  it("persists hex input colors to recent after a pause", async () => {
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
          value="#00ADC5"
          onChange={handleChange}
        />
      </GlobalInfoContext.Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "#00ADC5" }));

    const hexInput = await screen.findByRole("textbox");
    jest.useFakeTimers();

    fireEvent.change(hexInput, {
      target: { value: "#ABCDEF" },
    });

    expect(handleChange).toHaveBeenCalledWith("#ABCDEF");

    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(readRecentColors()[0]).toBe("#ABCDEF");
    expect(
      screen.getByRole("button", { name: "Color #ABCDEF" }),
    ).toBeInTheDocument();
  });

  it("renders recent colors on the first row and common colors on the second", async () => {
    writeRecentColors(["#FF0000", "#00FF00", "#FFFFFF"]);
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
      expect(
        screen.getByRole("button", { name: "Color #FF0000" }),
      ).toBeInTheDocument();
    });

    expect(screen.queryByText("Recent")).not.toBeInTheDocument();

    const swatchLabels = screen
      .getAllByRole("button", { name: /^Color / })
      .map((button) => button.getAttribute("aria-label"));

    expect(swatchLabels).toEqual([
      "Color #FF0000",
      "Color #00FF00",
      "Color #EF4444",
      "Color #F97316",
      "Color #EAB308",
      "Color #22C55E",
      "Color #3B82F6",
      "Color #8B5CF6",
      "Color #EC4899",
      "Color #78716C",
      "Color #FFFFFF",
      "Color #000000",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Color #FF0000" }));
    expect(handleChange).toHaveBeenCalledWith("#FF0000");

    fireEvent.click(screen.getByRole("button", { name: "Color #FFFFFF" }));
    expect(handleChange).toHaveBeenCalledWith("#FFFFFF");
  });
});
