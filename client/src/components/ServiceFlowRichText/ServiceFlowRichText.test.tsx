import { render, screen } from "@testing-library/react";
import ServiceFlowRichText from "./ServiceFlowRichText";

describe("ServiceFlowRichText", () => {
  it("renders structured colored spans as text without injecting markup", () => {
    render(
      <ServiceFlowRichText
        document={{
          blocks: [{
            type: "paragraph",
            spans: [{ text: "Amber cue", color: "#fbbf24", bold: true }],
          }],
        }}
      />,
    );

    const text = screen.getByText("Amber cue");
    // Bright colors keep plain colored text (no chip).
    expect(text).toHaveStyle({ color: "rgb(251, 191, 36)" });
    expect(text).toHaveClass("font-bold");
    expect(text).not.toHaveStyle({ backgroundColor: "rgb(251, 191, 36)" });
  });

  it("keeps readable mid-tone colors as plain colored text", () => {
    render(
      <ServiceFlowRichText
        document={{
          blocks: [{
            type: "paragraph",
            spans: [{ text: "Gray", color: "#666666" }],
          }],
        }}
      />,
    );

    const text = screen.getByText("Gray");
    expect(text).toHaveStyle({ color: "rgb(102, 102, 102)" });
    expect(text).not.toHaveStyle({ backgroundColor: "rgb(102, 102, 102)" });
  });

  it("chips only near-invisible colors on the dark note surface", () => {
    render(
      <ServiceFlowRichText
        document={{
          blocks: [{
            type: "paragraph",
            spans: [{ text: "Black", color: "#000000" }],
          }],
        }}
      />,
    );

    const text = screen.getByText("Black");
    expect(text).toHaveAttribute("data-rich-text-color", "#000000");
    expect(text).toHaveStyle({
      color: "rgb(255, 255, 255)",
      backgroundColor: "rgb(0, 0, 0)",
    });
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

  it("renders ordered and nested bullet lists semantically", () => {
    render(
      <ServiceFlowRichText
        document={{
          blocks: [
            {
              type: "list-item",
              listStyle: "ordered",
              listStart: 3,
              spans: [{ text: "Third" }],
            },
            {
              type: "list-item",
              listStyle: "ordered",
              spans: [{ text: "Fourth" }],
            },
            {
              type: "list-item",
              indent: 1,
              spans: [{ text: "Nested bullet" }],
            },
          ],
        }}
      />,
    );

    const lists = screen.getAllByRole("list");
    expect(lists).toHaveLength(2);
    expect(lists[0]).toHaveAttribute("start", "3");
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("Nested bullet")).toBeInTheDocument();
  });

  it("keeps indent-gap depth with markerless intermediate parents", () => {
    render(
      <ServiceFlowRichText
        document={{
          blocks: [
            { type: "list-item", spans: [{ text: "Parent" }] },
            {
              type: "list-item",
              indent: 2,
              spans: [{ text: "Deep child" }],
            },
          ],
        }}
      />,
    );

    expect(screen.getAllByRole("list")).toHaveLength(3);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[1]).toHaveClass("list-none");
    expect(screen.getByText("Deep child")).toBeInTheDocument();
  });

  it("preserves a blank paragraph between lines", () => {
    render(
      <ServiceFlowRichText
        document={{
          blocks: [
            { type: "paragraph", spans: [{ text: "Before" }] },
            { type: "paragraph", spans: [] },
            { type: "paragraph", spans: [{ text: "After" }] },
          ],
        }}
      />,
    );

    expect(screen.getAllByRole("paragraph")).toHaveLength(3);
  });
});
