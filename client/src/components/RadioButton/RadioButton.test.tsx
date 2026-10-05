import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RadioButton, { RadioGroup } from "./RadioButton";

test("composes shared radio primitives with label activation and arrow navigation", async () => {
  const user = userEvent.setup();
  const onValueChange = jest.fn();
  render(<RadioGroup defaultValue="one" onValueChange={onValueChange} aria-label="Layout"><RadioButton optionValue="one" label="One" /><RadioButton optionValue="two" label="Two" helperText="Second layout" /></RadioGroup>);
  await user.click(screen.getByText("Two:"));
  expect(screen.getByRole("radio", { name: "Two:" })).toBeChecked();
  expect(screen.getByRole("radio", { name: "Two:" })).toHaveAccessibleDescription("Second layout");
  await user.click(screen.getByRole("radio", { name: "Two:" }));
  await user.keyboard("{ArrowLeft>}");
  await waitFor(() => expect(screen.getByRole("radio", { name: "One:" })).toBeChecked());
  await user.keyboard("{/ArrowLeft}");
  expect(onValueChange).toHaveBeenLastCalledWith("one");
});
