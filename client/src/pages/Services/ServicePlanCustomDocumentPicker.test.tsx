import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import ServicePlanCustomDocumentPicker from "./ServicePlanCustomDocumentPicker";

const mockDocuments = [
  { _id: "doc-1", name: "Welcome Slides", type: "free", slides: [{ type: "text" }] },
  { _id: "doc-2", name: "Prayer Guide", type: "free", slides: [{ type: "text" }] },
  { _id: "song-1", name: "Not a document", type: "song", slides: [{ type: "text" }] },
  { _id: "doc-no-slides", name: "Not presentable", type: "free" },
];

jest.mock("../../hooks", () => ({
  useSelector: (selector: (state: unknown) => unknown) =>
    selector({ allDocs: { allFreeFormDocs: mockDocuments } }),
}));

jest.mock("../../components/Modal/Modal", () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div role="dialog">{children}</div>,
}));

jest.mock("../../components/FilteredItems/FilteredItems", () => ({
  __esModule: true,
  default: ({
    list,
    searchValue,
    setSearchValue,
    onAddItem,
  }: {
    list: Array<{ _id: string; name: string }>;
    searchValue: string;
    setSearchValue: (value: string) => void;
    onAddItem: (item: { _id: string; name: string }) => void;
  }) => (
    <div>
      <input aria-label="Search documents" value={searchValue} onChange={(event) => setSearchValue(event.target.value)} />
      {list.map((item) => (
        <button key={item._id} type="button" onClick={() => onAddItem(item)}>
          {item.name}
        </button>
      ))}
    </div>
  ),
}));

describe("ServicePlanCustomDocumentPicker", () => {
  it("uses the current custom-document index and omits attached or invalid items", () => {
    const onSelectDocument = jest.fn();
    render(
      <ServicePlanCustomDocumentPicker
        isOpen
        onClose={jest.fn()}
        attachedDocumentIds={["doc-1"]}
        onSelectDocument={onSelectDocument}
      />,
    );

    expect(screen.queryByRole("button", { name: "Welcome Slides" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Prayer Guide" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Not a document" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Not presentable" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Prayer Guide" }));
    expect(onSelectDocument).toHaveBeenCalledWith(expect.objectContaining({
      _id: "doc-2",
      name: "Prayer Guide",
      type: "free",
    }));
  });
});
