import * as React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DatePicker from "./DatePicker";

describe("tmp datepicker dropdown", () => {
  it("shows wide year range and enabled months by default", async () => {
    const user = userEvent.setup();
    render(<DatePicker label="DOB" value="" onChange={() => {}} />);
    await user.click(screen.getByLabelText("Open calendar"));

    const selects = screen.getAllByRole("combobox");
    selects.forEach((sel, i) => {
      const options = Array.from(sel.querySelectorAll("option"));
      const enabled = options.filter((o) => !(o as HTMLOptionElement).disabled);
      // eslint-disable-next-line no-console
      console.log(
        `select[${i}] total=${options.length} enabled=${enabled.length} first=${options[0]?.textContent} last=${options[options.length - 1]?.textContent}`,
      );
    });
    expect(selects.length).toBeGreaterThan(0);
  });
});
