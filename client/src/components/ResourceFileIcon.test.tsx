/* eslint-disable testing-library/no-node-access, testing-library/no-container -- Verify the shared visible icon shape and type container. */
import { render, screen } from "@testing-library/react";
import { AudioLines, File as FileIcon, FileImage, FileSpreadsheet, FileText, FileType2, FileVideo, Link2, Presentation } from "lucide-react";
import ResourceFileIcon from "./ResourceFileIcon";
import SelectedUploadFileRow from "./SelectedUploadFileRow";
import { resourceEntryFileVisual } from "../utils/churchResourceCatalog";
import { getLucideIconInnerMarkup } from "../test/lucideIconTestUtils";
import type { ResourceFileType } from "../utils/resourceFileType";

it.each([
  ["pdf", FileText, "red"], ["word", FileType2, "blue"], ["spreadsheet", FileSpreadsheet, "green"],
  ["presentation", Presentation, "orange"], ["image", FileImage, "purple"], ["audio", AudioLines, "amber"],
  ["video", FileVideo, "pink"], ["link", Link2, "cyan"], ["text", FileText, "teal"], ["file", FileIcon, "gray"],
] as const)("renders a distinctive %s file icon", (type, Icon, color) => {
  const { container } = render(<ResourceFileIcon visual={{ type: type as ResourceFileType, label: type }} />);
  const wrapper = container.firstElementChild;
  expect(wrapper).toHaveAttribute("aria-hidden", "true");
  expect(wrapper).toHaveClass(`text-${color}-300`);
  expect(wrapper?.querySelector("svg")?.innerHTML).toBe(getLucideIconInnerMarkup(Icon));
});

it("keeps upload and renamed library file visuals consistent with the original file", () => {
  const file = new File(["pdf"], "original.pdf", { type: "application/pdf" });
  const entry = { source: "church-resource", resource: { name: "Sunday guide", kind: "document", storage: { fileName: file.name, contentType: file.type } } } as Parameters<typeof resourceEntryFileVisual>[0];
  const { container } = render(<>
    <ResourceFileIcon visual={resourceEntryFileVisual(entry)} />
    <SelectedUploadFileRow file={file} displayName="Sunday guide" visualType="file" editable={false} onRename={jest.fn()} onRemove={jest.fn()} />
  </>);
  const icons = container.querySelectorAll('[data-file-type="pdf"]');
  expect(icons).toHaveLength(2);
  expect(icons[0].querySelector("svg")?.innerHTML).toBe(icons[1].querySelector("svg")?.innerHTML);
  expect(screen.getByText(/PDF.*3 B/)).toBeInTheDocument();
});
