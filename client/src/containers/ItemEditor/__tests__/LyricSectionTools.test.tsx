import { fireEvent, render, screen } from "@testing-library/react";
import LyricSectionTools from "../LyricSectionTools";

jest.mock("../../../components/Button/Button", () => ({
  __esModule: true,
  default: ({ children, iconSize, svg, variant, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));

jest.mock("../../../components/Select/Select", () => ({
  __esModule: true,
  default: ({
    id,
    label,
    value,
    onChange,
    options,
  }: {
    id?: string;
    label?: string;
    value: string;
    onChange: (value: string) => void;
    options: { value: string; label: string }[];
  }) => (
    <select
      id={id}
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">Select...</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

describe("LyricSectionTools", () => {
  it("adds an empty section when a section type is selected", () => {
    const onAddEmptySection = jest.fn();

    render(
      <LyricSectionTools
        addNewSectionsToSongOrder
        onAddNewSectionsToSongOrderChange={jest.fn()}
        onAddEmptySection={onAddEmptySection}
        onOpenImportDrawer={jest.fn()}
      />,
    );

    fireEvent.change(
      screen.getByRole("combobox", { name: /add empty section/i }),
      {
        target: { value: "Bridge" },
      },
    );

    expect(onAddEmptySection).toHaveBeenCalledWith("Bridge");
  });

  it("opens the import drawer and reports Song Order toggle changes", () => {
    const onAddNewSectionsToSongOrderChange = jest.fn();
    const onOpenImportDrawer = jest.fn();

    render(
      <LyricSectionTools
        addNewSectionsToSongOrder
        onAddNewSectionsToSongOrderChange={onAddNewSectionsToSongOrderChange}
        onAddEmptySection={jest.fn()}
        onOpenImportDrawer={onOpenImportDrawer}
      />,
    );

    fireEvent.click(
      screen.getByRole("switch", { name: /add to song order/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /import from song/i }));

    expect(onAddNewSectionsToSongOrderChange).toHaveBeenCalledWith(false);
    expect(onOpenImportDrawer).toHaveBeenCalledTimes(1);
  });

  it("collapsible mode hides actions until the header is expanded", () => {
    const onOpenImportDrawer = jest.fn();

    render(
      <LyricSectionTools
        collapsible
        addNewSectionsToSongOrder
        onAddNewSectionsToSongOrderChange={jest.fn()}
        onAddEmptySection={jest.fn()}
        onOpenImportDrawer={onOpenImportDrawer}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /import from song/i }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /section tools/i }),
    );

    fireEvent.click(screen.getByRole("button", { name: /import from song/i }));
    expect(onOpenImportDrawer).toHaveBeenCalledTimes(1);
  });
});
