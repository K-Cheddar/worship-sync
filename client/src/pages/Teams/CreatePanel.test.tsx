import { render, screen } from "@testing-library/react";
import CreatePanel from "./CreatePanel";

const makeMatchMedia = (matches: boolean): typeof window.matchMedia =>
  jest.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    addListener: jest.fn(),
    removeListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })) as unknown as typeof window.matchMedia;

let originalMatchMedia: typeof window.matchMedia;

const renderCreatePanel = (
  overrides: Partial<React.ComponentProps<typeof CreatePanel>> = {},
) =>
  render(
    <CreatePanel
      open={false}
      onOpenCreate={jest.fn()}
      title="Edit member"
      sectionTitle="Members"
      createLabel="Create member"
      list={<p>Member list</p>}
      asideOpen={false}
      asideTitle="Filter members"
      aside={<p>Filters</p>}
      formFooter={<button type="button">Save</button>}
      {...overrides}
    >
      <button type="button">Form contents</button>
    </CreatePanel>,
  );

beforeEach(() => {
  originalMatchMedia = window.matchMedia;
  window.matchMedia = makeMatchMedia(false);
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

describe("CreatePanel layout", () => {
  it("coordinates desktop columns and keeps closed panels inert", () => {
    const { rerender } = renderCreatePanel();

    const layout = screen.getByTestId("teams-create-panel-row");
    const aside = screen.getByRole("region", { name: "Filter members" });
    const form = screen.getByRole("region", { name: "Edit member" });

    expect(layout).toHaveStyle({
      gridTemplateColumns:
        "minmax(0, 1fr) minmax(0, 0fr) minmax(0, 0fr)",
    });
    expect(layout).toHaveClass(
      "lg:transition-[grid-template-columns,column-gap]",
      "lg:grid-cols-2",
      "lg:gap-0",
      "lg:duration-[220ms]",
      "motion-reduce:transition-none",
    );
    expect(aside).toHaveAttribute("inert");
    expect(form).toHaveAttribute("inert");
    expect(form).toHaveClass(
      "pointer-events-none",
      "max-lg:translate-x-6",
      "max-lg:opacity-0",
      "max-lg:transition-[transform,opacity]",
    );
    expect(form).not.toHaveClass("max-lg:w-0", "max-lg:max-h-0");

    rerender(
      <CreatePanel
        open
        onOpenCreate={jest.fn()}
        title="Edit member"
        sectionTitle="Members"
        createLabel="Create member"
        list={<p>Member list</p>}
        asideOpen
        asideTitle="Filter members"
        aside={<p>Filters</p>}
      >
        <button type="button">Form contents</button>
      </CreatePanel>,
    );

    expect(layout).toHaveStyle({
      gridTemplateColumns:
        "minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)",
    });
    expect(layout).toHaveClass("lg:gap-4", "lg:duration-300");
    expect(aside).not.toHaveAttribute("inert");
    expect(form).not.toHaveAttribute("inert");
    expect(form).toHaveClass("flex", "w-full", "lg:max-w-xl");
    expect(form).not.toHaveClass("pointer-events-none", "max-lg:w-0");
  });

  it("uses a mounted mobile detail transition without height collapse", () => {
    window.matchMedia = makeMatchMedia(true);
    const { rerender } = renderCreatePanel();

    const list = screen.getByTestId("teams-create-panel-list");
    const form = screen.getByRole("region", { name: "Edit member" });

    expect(list).toHaveClass(
      "max-lg:translate-x-0",
      "max-lg:opacity-100",
      "max-lg:duration-[200ms]",
    );
    expect(form).toHaveClass(
      "max-lg:translate-x-6",
      "max-lg:opacity-0",
      "max-lg:duration-[200ms]",
      "max-lg:transition-[transform,opacity]",
      "max-lg:h-full",
    );
    expect(form).not.toHaveClass("max-lg:max-h-0", "max-lg:w-0");
    expect(form).toHaveAttribute("inert");
    expect(list).not.toHaveAttribute("inert");

    rerender(
      <CreatePanel
        open
        onOpenCreate={jest.fn()}
        title="Edit member"
        sectionTitle="Members"
        createLabel="Create member"
        list={<p>Member list</p>}
        asideOpen={false}
        asideTitle="Filter members"
        aside={<p>Filters</p>}
      >
        <button type="button">Form contents</button>
      </CreatePanel>,
    );

    expect(list).toHaveClass(
      "max-lg:-translate-x-6",
      "max-lg:opacity-0",
      "max-lg:pointer-events-none",
      "max-lg:duration-[240ms]",
    );
    expect(list).toHaveAttribute("inert");
    expect(form).toHaveClass(
      "max-lg:translate-x-0",
      "max-lg:opacity-100",
      "max-lg:duration-[240ms]",
    );
    expect(form).not.toHaveAttribute("inert");

    rerender(
      <CreatePanel
        open={false}
        onOpenCreate={jest.fn()}
        title="Edit member"
        sectionTitle="Members"
        createLabel="Create member"
        list={<p>Member list</p>}
        asideOpen={false}
        asideTitle="Filter members"
        aside={<p>Filters</p>}
      >
        <button type="button">Form contents</button>
      </CreatePanel>,
    );

    expect(list).toHaveClass("max-lg:translate-x-0", "max-lg:duration-[200ms]");
    expect(list).not.toHaveAttribute("inert");
    expect(form).toHaveClass(
      "max-lg:translate-x-6",
      "max-lg:opacity-0",
      "max-lg:duration-[200ms]",
    );
    expect(form).toHaveAttribute("inert");

    rerender(
      <CreatePanel
        open={false}
        onOpenCreate={jest.fn()}
        title="Edit member"
        sectionTitle="Members"
        createLabel="Create member"
        list={<p>Member list</p>}
        asideOpen
        asideTitle="Filter members"
        aside={<p>Filters</p>}
      >
        <button type="button">Form contents</button>
      </CreatePanel>,
    );

    const aside = screen.getByRole("region", { name: "Filter members" });
    expect(list).toHaveClass("max-lg:-translate-x-6", "max-lg:duration-[240ms]");
    expect(list).toHaveAttribute("inert");
    expect(aside).toHaveClass(
      "max-lg:translate-x-0",
      "max-lg:z-20",
      "max-lg:duration-[240ms]",
    );
    expect(aside).not.toHaveAttribute("inert");
    expect(form).toHaveAttribute("inert");
  });
});
