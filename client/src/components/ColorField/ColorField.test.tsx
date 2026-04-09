import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ColorField from "./ColorField";
import { GlobalInfoContext } from "../../context/globalInfo";
import { createMockGlobalContext } from "../../test/mocks";

describe("ColorField", () => {
  it("renders saved church brand swatches and applies a selected swatch", async () => {
    const handleChange = jest.fn();

    render(
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
  });
});
