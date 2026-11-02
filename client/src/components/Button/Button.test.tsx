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

describe("Button text wrapping", () => {
  it("keeps default buttons on one line and allows wrapping when requested", () => {
    render(
      <>
        <Button>Toolbar action</Button>
        <Button wrap>Long outline item name</Button>
      </>,
    );

    expect(screen.getByRole("button", { name: "Toolbar action" })).toHaveClass(
      "whitespace-nowrap",
    );
    expect(
      screen.getByRole("button", { name: "Long outline item name" }),
    ).toHaveClass("text-wrap", "whitespace-normal", "break-words");
    expect(
      screen.getByRole("button", { name: "Long outline item name" }),
    ).not.toHaveClass("whitespace-nowrap");
  });
});
