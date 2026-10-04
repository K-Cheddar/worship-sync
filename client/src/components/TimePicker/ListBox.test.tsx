import { render, screen } from "@testing-library/react";
import { Listbox } from "./ListBox";

describe("Time picker listbox sizing", () => {
  it("preserves its intentionally compact fixed mobile option height", () => {
    render(
      <Listbox
        aria-label="Select hour"
        items={["08", "09"]}
        value="08"
      />,
    );

    expect(screen.getByRole("option", { name: "08" })).toHaveClass(
      "h-[2rem]",
      "max-md:min-h-[2rem]",
    );
  });
});
