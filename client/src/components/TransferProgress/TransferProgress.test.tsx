import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TransferProgress } from "./TransferProgress";
import type { Transfer } from "../../context/transferModel";

const base: Transfer = {
  id: "transfer-1",
  type: "Media upload",
  name: "photo.png",
  status: "active",
  progress: 63,
  phase: { key: "uploading", label: "Uploading", current: 1, total: 2 },
  detail: "126 MB of 200 MB",
};

describe("TransferProgress", () => {
  it.each(["card", "summary", "compact"] as const)("renders %s from the same normalized progress", (variant) => {
    render(<TransferProgress transfer={base} variant={variant} />);
    expect(screen.getByText("photo.png")).toBeInTheDocument();
    expect(screen.getByText(/Uploading · 1 of 2/)).toBeInTheDocument();
    expect(screen.getByText("126 MB of 200 MB")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "photo.png progress" })).toHaveAttribute("aria-valuenow", "63");
  });

  it("renders indeterminate, failed, cancelled, and completed states accessibly", () => {
    const { rerender } = render(<TransferProgress transfer={{ ...base, status: "queued", progress: null }} variant="card" />);
    expect(screen.getByText("Queued")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuetext", "Queued, progress unknown");

    rerender(<TransferProgress transfer={{ ...base, progress: null }} variant="card" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuetext", "Uploading, progress unknown");
    expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
    expect(screen.getByRole("progressbar")).toHaveClass("motion-reduce:transition-none");

    rerender(<TransferProgress transfer={{ ...base, status: "failed", phase: { key: "failed", label: "Upload failed" }, error: { message: "Upload failed." } }} variant="card" />);
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Upload failed.");
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();

    rerender(<TransferProgress transfer={{ ...base, status: "cancelled", progress: 20 }} variant="card" />);
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
    rerender(<TransferProgress transfer={{ ...base, status: "complete", progress: 100 }} variant="card" />);
    expect(screen.getByText("Complete")).toBeInTheDocument();
  });

  it("renders a normalized result action only when the producer supplies one", () => {
    const { rerender } = render(<MemoryRouter><TransferProgress transfer={{ ...base, status: "complete", result: { label: "View presentation", to: "/controller/item-1" } }} variant="card" /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "View presentation" })).toHaveAttribute("href", "/controller/item-1");
    rerender(<MemoryRouter><TransferProgress transfer={{ ...base, status: "complete" }} variant="card" /></MemoryRouter>);
    expect(screen.queryByRole("link", { name: "View presentation" })).not.toBeInTheDocument();
  });

  it("shows partial completion alongside the actual batch progress", () => {
    render(<TransferProgress transfer={{ ...base, status: "partial", progress: 70, phase: { key: "partial", label: "Upload completed with errors" } }} variant="card" />);
    expect(screen.getByText("Completed with errors · 70%")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "photo.png progress" })).toHaveAttribute("aria-valuenow", "70");
  });
});
