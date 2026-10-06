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

  it("shows per-file progress without an averaged batch percentage", () => {
    render(<TransferProgress transfer={{
      ...base,
      name: "2 media files",
      progress: 50,
      files: [
        { id: "first", name: "First.mp4", status: "active", progress: 24, phase: "Uploading video" },
        { id: "second", name: "Second.png", status: "queued", progress: 0, phase: "Queued" },
      ],
    }} variant="card" />);

    expect(screen.getByText("Uploading")).toBeInTheDocument();
    expect(screen.queryByText("50%")).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar", { name: "2 media files progress" })).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "First.mp4 progress" })).toHaveAttribute("aria-valuenow", "24");
  });

  it("shows partial completion alongside the actual single transfer progress", () => {
    render(<TransferProgress transfer={{ ...base, status: "partial", progress: 70, phase: { key: "partial", label: "Upload completed with errors" } }} variant="card" />);
    expect(screen.getByText("Completed with errors · 70%")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "photo.png progress" })).toHaveAttribute("aria-valuenow", "70");
  });

  it("shows provider cleanup failures for media already removed from the library", () => {
    render(<TransferProgress transfer={{
      ...base,
      type: "Media deletion",
      status: "partial",
      progress: null,
      phase: { key: "partial", label: "Media removed; cloud cleanup needs attention", current: 1, total: 1 },
      detail: "1 of 1 media items removed · 1 need attention",
      files: [{
        id: "media-1",
        name: "Photo.jpg",
        status: "complete",
        progress: 100,
        phase: "Cloud cleanup failed",
        error: "Removed from Media; cloud storage still needs cleanup.",
      }],
    }} variant="card" />);

    expect(screen.getByText("Cloud cleanup failed")).toBeInTheDocument();
    expect(screen.getByText("1 of 1 media items removed · 1 need attention")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Removed from Media; cloud storage still needs cleanup.");
  });
});
