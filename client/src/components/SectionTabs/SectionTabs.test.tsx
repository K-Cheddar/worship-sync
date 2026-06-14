import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SectionTabs } from "./SectionTabs";

const CrashingTab = () => {
  throw new Error("Tab failed.");
};

describe("SectionTabs", () => {
  it("contains a crash inside the active tab panel", async () => {
    const user = userEvent.setup();
    const consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    render(
      <SectionTabs
        items={[
          {
            value: "safe",
            label: "Safe",
            content: <div>Safe tab content</div>,
          },
          {
            value: "broken",
            label: "Broken",
            content: <CrashingTab />,
          },
        ]}
      />,
    );

    expect(screen.getByText("Safe tab content")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /^Broken$/i }));

    expect(
      await screen.findByRole("heading", {
        name: /This section could not load/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^Safe$/i })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /^Safe$/i }));

    expect(screen.getByText("Safe tab content")).toBeInTheDocument();

    consoleErrorSpy.mockRestore();
  });
});
