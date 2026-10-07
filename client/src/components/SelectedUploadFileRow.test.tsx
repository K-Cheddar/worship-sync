import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import SelectedUploadFileRow from "./SelectedUploadFileRow";

describe("SelectedUploadFileRow", () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  afterEach(() => {
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: originalCreateObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: originalRevokeObjectURL });
  });

  it("renders a local image thumbnail and revokes it when removed", () => {
    const createObjectURL = jest.fn(() => "blob:selected-image");
    const revokeObjectURL = jest.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    const file = new File(["image"], "photo.png", { type: "image/png" });

    const Selection = () => {
      const [selected, setSelected] = useState(true);
      return selected ? (
        <SelectedUploadFileRow file={file} displayName={file.name} visualType="image" editable onRename={jest.fn()} onRemove={() => setSelected(false)} />
      ) : null;
    };

    render(<Selection />);
    expect(screen.getByAltText("")).toHaveAttribute("src", "blob:selected-image");
    fireEvent.click(screen.getByRole("button", { name: "Remove photo.png" }));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:selected-image");
  });

  it.each([
    ["guide.pdf", "", "PDF"],
    ["guide.docx", "", "DOCX"],
    ["slides.pptx", "", "PPTX"],
    ["budget.xlsx", "", "XLSX"],
    ["notes.txt", "", "TEXT"],
    ["song.mp3", "", "MP3"],
    ["download", "application/pdf", "PDF"],
  ])("shows the right file-type visual for %s", (fileName, contentType, label) => {
    const file = new File(["content"], fileName, { type: contentType });
    render(<SelectedUploadFileRow file={file} displayName={file.name} visualType="file" editable={false} onRename={jest.fn()} onRemove={jest.fn()} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});
