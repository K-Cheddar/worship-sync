import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Checkbox from "./Checkbox";

const StatefulCheckbox = ({
  className,
}: {
  className?: string;
}) => {
  const [checked, setChecked] = useState(false);
  return (
    <Checkbox
      label="Team"
      checked={checked}
      onCheckedChange={setChecked}
      className={className}
    />
  );
};

describe("Checkbox", () => {
  it("toggles once when the control is clicked", async () => {
    const user = userEvent.setup();
    const onCheckedChange = jest.fn();

    render(
      <Checkbox
        label="Team"
        checked={false}
        onCheckedChange={onCheckedChange}
        className="rounded-lg px-3 py-2"
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: "Team" }));

    expect(onCheckedChange).toHaveBeenCalledTimes(1);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("toggles once when the labeled row is clicked", async () => {
    const user = userEvent.setup();

    render(<StatefulCheckbox className="rounded-lg px-3 py-2" />);

    await user.click(screen.getByText("Team"));

    expect(screen.getByRole("checkbox", { name: "Team" })).toBeChecked();
  });
});
