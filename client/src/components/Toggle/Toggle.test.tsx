import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Toggle from "./Toggle";

test("supports external labels and descriptions without a built-in label", async () => {
  const user = userEvent.setup();
  const onChange = jest.fn();
  render(<><span id="label">Song order</span><p id="description">Add new sections automatically.</p><Toggle value={false} onChange={onChange} aria-labelledby="label" aria-describedby="description" /></>);
  const toggle = screen.getByRole("switch", { name: "Song order" });
  expect(toggle).toHaveAccessibleDescription("Add new sections automatically.");
  await user.click(toggle);
  expect(onChange).toHaveBeenCalledWith(true);
});
