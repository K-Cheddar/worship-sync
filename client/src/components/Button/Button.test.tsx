import { render, screen } from "@testing-library/react";
import Button from "./Button";

describe("Button mobile touch sizing", () => {
  it("gives ordinary buttons a fixed-rem mobile minimum", () => {
    render(<Button>Save</Button>);

    expect(screen.getByRole("button", { name: "Save" })).toHaveClass(
      "max-md:min-h-[2rem]",
    );
  });

  it("preserves text-link and explicit compact sizing", () => {
    render(
      <>
        <Button variant="textLink">Help</Button>
        <Button className="max-md:min-h-0">Compact</Button>
      </>,
    );

    expect(screen.getByRole("button", { name: "Help" })).toHaveClass(
      "max-md:min-h-0",
    );
    expect(screen.getByRole("button", { name: "Help" })).not.toHaveClass(
      "max-md:min-h-[2rem]",
    );
    expect(screen.getByRole("button", { name: "Compact" })).toHaveClass(
      "max-md:min-h-0",
    );
  });
});
