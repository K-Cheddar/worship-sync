import { render, screen } from "@testing-library/react";
import ResponsiveDataTable, { ResponsiveDataTableSkeleton } from "./ResponsiveDataTable";

const view = (compact: boolean) => <ResponsiveDataTable
  label="Example records"
  compact={compact}
  desktopHeader={<tr><th scope="col">Name</th></tr>}
  desktopRows={() => <tr><td>Desktop value</td></tr>}
  mobileRows={() => <li>Mobile value</li>}
/>;

it("mounts one semantic layout for each available width", () => {
  const utils = render(view(false));
  expect(screen.getByRole("table", { name: "Example records" })).toBeInTheDocument();
  expect(screen.getByText("Desktop value")).toBeInTheDocument();
  expect(screen.queryByText("Mobile value")).not.toBeInTheDocument();
  utils.rerender(view(true));
  expect(screen.queryByRole("table", { name: "Example records" })).not.toBeInTheDocument();
  expect(screen.getByRole("list", { name: "Example records" })).toBeInTheDocument();
  expect(screen.getByText("Mobile value")).toBeInTheDocument();
  expect(screen.queryByText("Desktop value")).not.toBeInTheDocument();
});

it("does not build rows for the inactive layout", () => {
  const desktopRows = jest.fn(() => <tr><td>Desktop value</td></tr>);
  const mobileRows = jest.fn(() => <li>Mobile value</li>);
  render(<ResponsiveDataTable label="Example records" compact desktopHeader={<tr><th>Name</th></tr>} desktopRows={desktopRows} mobileRows={mobileRows} />);
  expect(mobileRows).toHaveBeenCalledTimes(1);
  expect(desktopRows).not.toHaveBeenCalled();
});

it("reuses the matching table and compact list structure while loading", () => {
  const props = { label: "Example records", loadingLabel: "Loading records", columns: [{ label: "Name" }, { label: "Status" }], rowCount: 3 };
  const utils = render(<ResponsiveDataTableSkeleton {...props} compact={false} />);
  const loading = screen.getByRole("region", { name: "Loading records" });
  expect(loading).toHaveAttribute("aria-busy", "true");
  expect(screen.getByRole("status")).toHaveTextContent("Loading records");
  expect(screen.getByRole("table", { name: "Example records" })).toBeInTheDocument();
  expect(screen.getAllByRole("row")).toHaveLength(4);
  utils.rerender(<ResponsiveDataTableSkeleton {...props} compact />);
  expect(screen.queryByRole("table", { name: "Example records" })).not.toBeInTheDocument();
  expect(screen.getByRole("list", { name: "Example records" })).toBeInTheDocument();
  expect(screen.getAllByRole("listitem")).toHaveLength(3);
});
