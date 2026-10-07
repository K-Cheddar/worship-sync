import { render, screen } from "@testing-library/react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "./Select";

describe("Select mobile touch sizing", () => {
  it.each([
    ["default", "h-[2.25rem]"],
    ["sm", "h-8"],
  ] as const)("keeps the %s desktop height and adds a fixed mobile minimum", (size, desktopHeight) => {
    render(
      <Select>
        <SelectTrigger size={size} aria-label="Choose an option">
          Choose
        </SelectTrigger>
      </Select>,
    );

    const trigger = screen.getByRole("combobox", { name: "Choose an option" });
    expect(trigger).toHaveClass(desktopHeight);
    expect(trigger).toHaveClass("max-md:min-h-[2rem]");
  });

  it("gives menu options a mobile minimum without changing desktop padding", () => {
    render(
      <Select open>
        <SelectTrigger aria-label="Choose an option">Choose</SelectTrigger>
        <SelectContent>
          <SelectItem value="one">One</SelectItem>
        </SelectContent>
      </Select>,
    );

    expect(screen.getByRole("option", { name: "One" })).toHaveClass(
      "py-1.5",
      "max-md:min-h-[2rem]",
    );
  });
});
