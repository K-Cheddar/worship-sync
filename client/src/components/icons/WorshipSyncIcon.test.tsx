import { act, render, screen } from "@testing-library/react";
import type { SVGProps } from "react";
import WorshipSyncIcon from "./WorshipSyncIcon";
import {
  loadPositionIconCatalog,
  normalizePositionIcon,
  resolveWorshipSyncIcon,
  searchPositionIconCatalog,
} from "./iconRegistry";

const mockTablerImportState = {
  failuresRemaining: 0,
  catalogFailuresRemaining: 0,
};

jest.mock("@tabler/icons-react", () => {
  if (mockTablerImportState.failuresRemaining > 0) {
    mockTablerImportState.failuresRemaining -= 1;
    throw new Error("Temporary Tabler import failure");
  }
  return {
    get IconCamera() {
      if (mockTablerImportState.catalogFailuresRemaining > 0) {
        mockTablerImportState.catalogFailuresRemaining -= 1;
        throw new Error("Temporary catalog failure");
      }
      return (props: SVGProps<SVGSVGElement>) => <svg data-testid="tabler-camera" {...props} />;
    },
    IconMicrophone: (props: SVGProps<SVGSVGElement>) => <svg data-testid="tabler-microphone" {...props} />,
  };
});

describe("WorshipSync position icons", () => {
  it("retries a failed Tabler import when connectivity returns", async () => {
    mockTablerImportState.failuresRemaining = 1;
    render(<WorshipSyncIcon icon={{ source: "tabler", name: "camera" }} />);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.queryByTestId("tabler-camera")).not.toBeInTheDocument();

    await act(async () => { window.dispatchEvent(new Event("online")); });
    expect(await screen.findByTestId("tabler-camera")).toBeInTheDocument();
  });

  it("retries catalog construction after it rejects", async () => {
    mockTablerImportState.catalogFailuresRemaining = 1;
    await expect(loadPositionIconCatalog()).rejects.toThrow("Temporary catalog failure");
    await expect(loadPositionIconCatalog()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ ref: { source: "tabler", name: "camera" } })]),
    );
  });

  it("resolves legacy Lucide strings and structured Lucide refs", () => {
    expect(resolveWorshipSyncIcon("MicVocal")).not.toBeNull();
    expect(resolveWorshipSyncIcon({ source: "lucide", name: "Camera" })).not.toBeNull();
    expect(resolveWorshipSyncIcon({ source: "tabler", name: "camera" })).toBeNull();
  });

  it("normalizes WorshipSync refs and safely ignores unsupported or invalid refs", () => {
    expect(normalizePositionIcon({ source: "worshipsync", name: "service" })).toEqual({ source: "worshipsync", name: "service" });
    expect(resolveWorshipSyncIcon({ source: "worshipsync", name: "unregistered" })).toBeNull();
    expect(normalizePositionIcon({ source: "custom", id: "old-icon" })).toEqual({ source: "custom", id: "old-icon" });
    expect(resolveWorshipSyncIcon({ source: "custom", id: "old-icon" })).toBeNull();
    expect(normalizePositionIcon({ source: "lucide", name: "" })).toBeNull();
    expect(resolveWorshipSyncIcon({ source: "invalid" } as never)).toBeNull();
  });

  it("renders a legacy Lucide string icon", () => {
    render(<WorshipSyncIcon data-testid="legacy-icon" icon="MicVocal" />);
    expect(screen.getByTestId("legacy-icon")).toBeInTheDocument();
  });

  it("renders Tabler through the canonical renderer, keeps it stable, and ignores unknown names", async () => {
    const icon = { source: "tabler", name: "camera" } as const;
    const { rerender } = render(<WorshipSyncIcon icon={icon} />);
    expect(await screen.findByTestId("tabler-camera")).toBeInTheDocument();
    rerender(<WorshipSyncIcon icon={icon} />);
    expect(screen.getByTestId("tabler-camera")).toBeInTheDocument();

    rerender(<WorshipSyncIcon icon={{ source: "tabler", name: "microphone" }} />);
    expect(screen.queryByTestId("tabler-camera")).not.toBeInTheDocument();
    expect(await screen.findByTestId("tabler-microphone")).toBeInTheDocument();

    rerender(<WorshipSyncIcon icon={icon} />);
    expect(screen.getByTestId("tabler-camera")).toBeInTheDocument();
    expect(screen.queryByTestId("tabler-microphone")).not.toBeInTheDocument();

    rerender(<WorshipSyncIcon icon={{ source: "custom", id: "church-icon" }} />);
    expect(screen.queryByTestId("tabler-camera")).not.toBeInTheDocument();
    rerender(<WorshipSyncIcon icon={{ source: "tabler", name: "not-a-real-icon" }} />);
    expect(screen.queryByTestId("tabler-camera")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tabler-microphone")).not.toBeInTheDocument();
    expect(resolveWorshipSyncIcon({ source: "lucide", name: "NotARealIcon" })).toBeNull();
    expect(resolveWorshipSyncIcon({ source: "invalid" } as never)).toBeNull();
  });

  it("leaves an uncolored glyph inheriting its surface and preserves explicit colors", () => {
    const { rerender } = render(<WorshipSyncIcon data-testid="position-icon" icon={{ source: "lucide", name: "Camera" }} />);
    expect(screen.getByTestId("position-icon").style.color).toBe("");
    rerender(<WorshipSyncIcon data-testid="position-icon" icon={{ source: "lucide", name: "Camera", color: "#22d3ee" }} />);
    expect(screen.getByTestId("position-icon")).toHaveStyle({ color: "#22d3ee" });
  });

  it("can inherit a badge's contrasting ink instead of using the ref color", () => {
    render(
      <span style={{ color: "#ffffff" }}>
        <WorshipSyncIcon
          data-testid="position-icon"
          icon={{ source: "lucide", name: "Camera", color: "#000000" }}
          inheritColor
        />
      </span>,
    );
    expect(screen.getByTestId("position-icon").style.color).toBe("");
  });

  it("does not assume a fixed background or add a glyph shadow", () => {
    const { rerender } = render(<WorshipSyncIcon data-testid="position-icon" icon={{ source: "lucide", name: "Camera", color: "#000000" }} />);
    expect(screen.getByTestId("position-icon")).toHaveStyle({ color: "#000000" });
    expect(screen.getByTestId("position-icon").style.filter).toBe("");

    rerender(<WorshipSyncIcon data-testid="position-icon" icon={{ source: "lucide", name: "Camera", color: "#fbbf24" }} />);
    expect(screen.getByTestId("position-icon")).toHaveStyle({ color: "#fbbf24" });
    expect(screen.getByTestId("position-icon").style.filter).toBe("");
  });

  it("searches Lucide and Tabler names together", async () => {
    let catalog: Awaited<ReturnType<typeof loadPositionIconCatalog>> = [];
    await act(async () => { catalog = await loadPositionIconCatalog(); });
    const cameraResults = searchPositionIconCatalog(catalog, "camera");
    expect(cameraResults.some((entry) => entry.ref.source === "lucide" && entry.ref.name === "Camera")).toBe(true);
    expect(cameraResults.some((entry) => entry.ref.source === "tabler" && entry.ref.name === "camera")).toBe(true);
    const microphoneResults = searchPositionIconCatalog(catalog, "microphone");
    expect(microphoneResults.some((entry) => entry.ref.source === "lucide" && entry.ref.name === "MicVocal")).toBe(true);
    expect(microphoneResults.some((entry) => entry.ref.source === "tabler" && entry.ref.name === "microphone")).toBe(true);
  });
});
