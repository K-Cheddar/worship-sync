import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import ServicePlanCustomDocumentPicker from "./ServicePlanCustomDocumentPicker";

const mockDispatch = jest.fn();

const mockDocuments = [
  { _id: "doc-1", name: "Welcome Slides", type: "free", slides: [{ type: "text" }] },
  { _id: "doc-2", name: "Prayer Guide", type: "free", slides: [{ type: "text" }] },
  { _id: "song-1", name: "Not a document", type: "song", slides: [{ type: "text" }] },
  { _id: "doc-no-slides", name: "Not presentable", type: "free" },
];

jest.mock("../../hooks", () => ({
  useSelector: (selector: (state: unknown) => unknown) =>
    selector({ allDocs: { allFreeFormDocs: mockDocuments } }),
  useDispatch: () => mockDispatch,
}));

jest.mock("../../containers/CreateItem/CreateItem", () => ({
  __esModule: true,
  default: ({ embeddedType, onCreated }: {
    embeddedType: string;
    onCreated: (item: { _id: string; name: string; type: string }) => void;
  }) => (
    <div data-testid="embedded-document-creator" data-type={embeddedType}>
      <button
        type="button"
        onClick={() => onCreated({
          _id: "new-document",
          name: "New Document",
          type: "free",
        })}
      >
        Create and attach
      </button>
    </div>
  ),
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
    showCreateAndExternal,
    onCreateNew,
  }: {
    list: Array<{ _id: string; name: string }>;
    searchValue: string;
    setSearchValue: (value: string) => void;
    onAddItem: (item: { _id: string; name: string }) => void;
    showCreateAndExternal?: boolean;
    onCreateNew?: () => void;
  }) => (
    <div>
      <input aria-label="Search documents" value={searchValue} onChange={(event) => setSearchValue(event.target.value)} />
      {showCreateAndExternal && onCreateNew ? (
        <button type="button" onClick={onCreateNew}>Create a new custom document</button>
      ) : null}
      {list.map((item) => (
        <button key={item._id} type="button" onClick={() => onAddItem(item)}>
          {item.name}
        </button>
      ))}
    </div>
  ),
}));

describe("ServicePlanCustomDocumentPicker", () => {
  beforeEach(() => mockDispatch.mockClear());

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

  it("creates a custom document through the embedded creator and attaches it", () => {
    const onSelectDocument = jest.fn();
    const onClose = jest.fn();
    render(
      <ServicePlanCustomDocumentPicker
        isOpen
        onClose={onClose}
        attachedDocumentIds={[]}
        onSelectDocument={onSelectDocument}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create a new custom document" }));
    expect(screen.getByTestId("embedded-document-creator")).toHaveAttribute("data-type", "free");

    fireEvent.click(screen.getByRole("button", { name: "Create and attach" }));
    expect(onSelectDocument).toHaveBeenCalledWith({
      _id: "new-document",
      name: "New Document",
      type: "free",
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("does not attach a created document after the picker closes", () => {
    const onSelectDocument = jest.fn();
    const onClose = jest.fn();
    const pickerProps = {
      onClose,
      attachedDocumentIds: [],
      onSelectDocument,
    };
    const view = render(
      <ServicePlanCustomDocumentPicker {...pickerProps} isOpen />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create a new custom document" }));
    view.rerender(
      <ServicePlanCustomDocumentPicker {...pickerProps} isOpen={false} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Create and attach" }));

    expect(onSelectDocument).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
