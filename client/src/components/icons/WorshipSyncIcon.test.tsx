import { act, render, screen } from "@testing-library/react";
import type { SVGProps } from "react";
import WorshipSyncIcon from "./WorshipSyncIcon";
import {
  loadPositionIconCatalog,
  resolveWorshipSyncIcon,
  searchPositionIconCatalog,
} from "./iconRegistry";

jest.mock("@tabler/icons-react", () => ({
  IconCamera: (props: SVGProps<SVGSVGElement>) => <svg data-testid="tabler-camera" {...props} />,
  IconMicrophone: (props: SVGProps<SVGSVGElement>) => <svg data-testid="tabler-microphone" {...props} />,
}));

describe("WorshipSync position icons", () => {
  it("resolves legacy Lucide strings and structured Lucide refs", () => {
    expect(resolveWorshipSyncIcon("MicVocal")).not.toBeNull();
    expect(resolveWorshipSyncIcon({ source: "lucide", name: "Camera" })).not.toBeNull();
  });

  it("renders Tabler references and safely ignores unknown references", async () => {
    expect(resolveWorshipSyncIcon({ source: "tabler", name: "camera" })).not.toBeNull();
    const { rerender } = render(<WorshipSyncIcon icon={{ source: "tabler", name: "camera" }} />);
    expect(await screen.findByTestId("tabler-camera")).toBeInTheDocument();

    rerender(<WorshipSyncIcon icon={{ source: "custom", id: "church-icon" }} />);
    expect(screen.queryByTestId("tabler-camera")).not.toBeInTheDocument();
    expect(resolveWorshipSyncIcon({ source: "tabler", name: "not-a-real-icon" })).not.toBeNull();
    rerender(<WorshipSyncIcon icon={{ source: "tabler", name: "not-a-real-icon" }} />);
    expect(screen.queryByTestId("tabler-camera")).not.toBeInTheDocument();
    expect(resolveWorshipSyncIcon({ source: "lucide", name: "NotARealIcon" })).toBeNull();
    expect(resolveWorshipSyncIcon({ source: "invalid" } as never)).toBeNull();
  });

  it("applies an optional color to the glyph and leaves the default unstyled", () => {
    const { rerender } = render(<WorshipSyncIcon data-testid="position-icon" icon={{ source: "lucide", name: "Camera" }} />);
    expect(screen.getByTestId("position-icon")).not.toHaveStyle({ color: "#22d3ee" });
    rerender(<WorshipSyncIcon data-testid="position-icon" icon={{ source: "lucide", name: "Camera", color: "#22d3ee" }} />);
    expect(screen.getByTestId("position-icon")).toHaveStyle({ color: "#22d3ee" });
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
