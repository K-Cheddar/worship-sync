import { render, screen } from "@testing-library/react";
import Button from "./Button";

describe("UI Button mobile touch sizing", () => {
  it("keeps the desktop default height and adds a fixed-rem mobile minimum", () => {
    render(<Button>Save</Button>);

    expect(screen.getByRole("button", { name: "Save" })).toHaveClass(
      "h-9",
      "max-md:min-h-[2rem]",
    );
  });
});
