import { CalendarDays } from "lucide-react";
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

  it("keeps inactive tab content mounted when keepMounted is set", async () => {
    const user = userEvent.setup();

    render(
      <SectionTabs
        keepMounted
        items={[
          {
            value: "one",
            label: "One",
            content: <div>First panel</div>,
          },
          {
            value: "two",
            label: "Two",
            content: <div>Second panel</div>,
          },
        ]}
      />,
    );

    expect(screen.getByText("First panel")).toBeInTheDocument();
    expect(screen.getByText("Second panel")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /^Two$/i }));

    expect(screen.getByText("First panel")).toBeInTheDocument();
    expect(screen.getByText("Second panel")).toBeInTheDocument();
  });

  it("keeps the accessible tab name when an icon is provided", () => {
    render(
      <SectionTabs
        items={[
          {
            value: "plans",
            label: "Plans",
            icon: CalendarDays,
            content: <div>Plans content</div>,
          },
        ]}
      />,
    );

    expect(screen.getByRole("tab", { name: /^Plans$/i })).toBeInTheDocument();
  });
});
