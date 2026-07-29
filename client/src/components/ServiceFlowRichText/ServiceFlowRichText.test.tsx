import { render, screen } from "@testing-library/react";
import ServiceFlowRichText from "./ServiceFlowRichText";

describe("ServiceFlowRichText", () => {
  it("renders structured colored spans as text without injecting markup", () => {
    render(
      <ServiceFlowRichText
        document={{
          blocks: [{
            type: "paragraph",
            spans: [{ text: "Red mic", color: "#dd0000", bold: true }],
          }],
        }}
      />,
    );

    const text = screen.getByText("Red mic");
    expect(text).toHaveStyle({ color: "rgb(221, 0, 0)" });
    expect(text).toHaveClass("font-semibold");
  });

  it("honors block alignment, and emits no alignment for the default", () => {
    render(
      <ServiceFlowRichText
        document={{
          blocks: [
            { type: "paragraph", align: "center", spans: [{ text: "Centered" }] },
            { type: "list-item", align: "right", spans: [{ text: "Right bullet" }] },
            { type: "paragraph", spans: [{ text: "Default" }] },
          ],
        }}
      />,
    );

    const [centered, rightBullet, defaultBlock] = screen.getAllByRole("paragraph");
    expect(centered).toHaveStyle({ textAlign: "center" });
    expect(rightBullet).toHaveStyle({ textAlign: "right" });
    // Left is the default, so no alignment is emitted for it at all.
    expect(defaultBlock).not.toHaveStyle({ textAlign: "center" });
    expect(defaultBlock).not.toHaveStyle({ textAlign: "right" });
  });

  it("renders block sizes from the fixed scale, leaving normal unstyled", () => {
    render(
      <ServiceFlowRichText
        document={{
          blocks: [
            { type: "paragraph", size: "large", spans: [{ text: "Headline" }] },
            { type: "paragraph", size: "small", spans: [{ text: "Fine print" }] },
            { type: "paragraph", spans: [{ text: "Body" }] },
          ],
        }}
      />,
    );

    const [large, small, normal] = screen.getAllByRole("paragraph");
    expect(large).toHaveClass("text-base");
    expect(small).toHaveClass("text-xs");
    // Normal inherits the container's scale rather than overriding it.
    expect(normal).not.toHaveClass("text-base");
    expect(normal).not.toHaveClass("text-xs");
  });
});
