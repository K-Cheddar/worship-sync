import { render, screen } from "@testing-library/react";
import Input from "./Input";

describe("Input mobile touch sizing", () => {
  it("keeps its desktop height and adds a fixed-rem mobile minimum", () => {
    render(<Input aria-label="Name" />);

    expect(screen.getByRole("textbox", { name: "Name" })).toHaveClass(
      "h-[2.25rem]",
      "max-md:min-h-[2rem]",
    );
  });

  it("allows an explicit compact mobile override", () => {
    render(<Input aria-label="Inline value" className="max-md:min-h-0" />);

    expect(screen.getByRole("textbox", { name: "Inline value" })).toHaveClass(
      "max-md:min-h-0",
    );
    expect(screen.getByRole("textbox", { name: "Inline value" })).not.toHaveClass(
      "max-md:min-h-[2rem]",
    );
  });
});
