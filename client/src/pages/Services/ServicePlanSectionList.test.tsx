import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ServicePlanSectionList from "./ServicePlanSectionList";
import type {
  ServicePlanElement,
  ServicePlanMicrophone,
  ServicePlanSection,
  ServicePlanSongReference,
} from "../../types/servicePlan";
import type { DBItem } from "../../types";
import { plainTextToRichText } from "../../types/richText";

let desktopPanel = true;

jest.mock("../../hooks/useMediaQuery", () => ({
  useMediaQuery: (query: string) =>
    query === "(min-width: 1280px)" ? desktopPanel : false,
}));

jest.mock("./ServicePlanContentPanel", () => ({
  __esModule: true,
  default: ({
    element,
    onOpenSongDetails,
    onScriptureAttachModeChange,
    onResourceEditorModeChange,
  }: {
    element: ServicePlanElement;
    onOpenSongDetails?: (songRef: ServicePlanSongReference) => void;
    onScriptureAttachModeChange?: (active: boolean) => void;
    onResourceEditorModeChange?: (active: boolean) => void;
  }) => (
    <div aria-label={`Content for ${element.id}`}>
      <p>Content panel for {element.id}</p>
      <button
        type="button"
        onClick={() =>
          onOpenSongDetails?.({
            kind: "library",
            songId: "song-a",
            songName: "Song A",
          })
        }
      >
        Open song details
      </button>
      <button type="button" onClick={() => onScriptureAttachModeChange?.(true)}>
        Begin scripture attachment
      </button>
      <button type="button" onClick={() => onScriptureAttachModeChange?.(false)}>
        Attach scripture
      </button>
      <button type="button" onClick={() => onResourceEditorModeChange?.(true)}>
        Begin resource entry
      </button>
      <button type="button" onClick={() => onResourceEditorModeChange?.(false)}>
        Finish resource entry
      </button>
    </div>
  ),
}));

jest.mock("./ServicePlanSongDetailsPanel", () => ({
  __esModule: true,
  default: ({ song }: { song: DBItem }) => (
    <div aria-label={`Song details for ${song.name}`}>Song details for {song.name}</div>
  ),
}));

jest.mock("./ServicePlanAssigneeList", () => ({
  __esModule: true,
  addMicrophoneSlot: (assignees: unknown[]) => assignees,
  addServicePlanAssignee: (assignees: unknown[]) => assignees,
  DebouncedAssigneeNameField: () => null,
  default: ({
    itemLabel,
    onEdit,
  }: {
    itemLabel: string;
    onEdit?: () => void;
  }) => (
    <div aria-label={`Assignments for ${itemLabel}`}>
      {onEdit ? (
        <button type="button" onClick={onEdit}>
          Open assignments for {itemLabel}
        </button>
      ) : null}
      <p>Assignments for {itemLabel}</p>
    </div>
  ),
}));

const microphone: ServicePlanMicrophone = {
  id: "mic-a",
  name: "Orange",
  type: "handheld",
  color: "#f97316",
};

const createElement = (id: string): ServicePlanElement => ({
  id,
  type: "free",
  title: plainTextToRichText(`Item ${id.slice(-1).toUpperCase()}`),
  startTime: "10:00",
  durationMinutes: 5,
});

const createSections = (): ServicePlanSection[] => [{
  id: "section-a",
  name: "Section A",
  elements: [createElement("item-a"), createElement("item-b")],
}];

const songDocument = {
  _id: "song-a",
  type: "song",
  name: "Song A",
} as DBItem;

let originalMatchMedia: typeof window.matchMedia;

beforeEach(() => {
  originalMatchMedia = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: desktopPanel && query === "(min-width: 1280px)",
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  desktopPanel = true;
});

const renderList = ({
  structureOnly = false,
  desktop = true,
  initialSections = createSections(),
}: {
  structureOnly?: boolean;
  desktop?: boolean;
  initialSections?: ServicePlanSection[];
} = {}) => {
  desktopPanel = desktop;

  const Harness = () => {
    const [sections, setSections] = useState(initialSections);
    const [selection, setSelection] = useState<{
      sectionId: string;
      elementId?: string;
    } | null>(null);

    return (
      <>
        <ServicePlanSectionList
          sections={sections}
          canEdit
          isEditing
          structureOnly={structureOnly}
          onSectionsChange={setSections}
          selection={selection}
          onSelectionChange={setSelection}
          microphones={structureOnly ? [microphone] : []}
          allSongDocs={[songDocument]}
        />
        <button
          type="button"
          onClick={() => setSelection({ sectionId: "section-a", elementId: "item-b" })}
        >
          Externally select Item B
        </button>
      </>
    );
  };

  return render(<Harness />);
};

const panel = (label: string) => {
  const panels = screen.getAllByLabelText(label);
  return panels[desktopPanel ? 0 : panels.length - 1];
};

const selectItemB = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByDisplayValue("Item B"));
};

describe("ServicePlanSectionList item-specific panels", () => {
  it.each([true, false])(
    "keeps the Content panel open and follows selection (%s desktop)",
    async (desktop) => {
      const user = userEvent.setup();
      renderList({ desktop });

      await user.click(screen.getByRole("button", { name: "Add content to Item A" }));
      expect(panel("Content editor for Item A")).toBeInTheDocument();

      await selectItemB(user);

      expect(panel("Content editor for Item B")).toBeInTheDocument();
      expect(screen.getAllByText("Content panel for item-b").at(-1)).toBeInTheDocument();
    },
  );

  it.each([true, false])(
    "keeps the People/Microphones panel open and follows selection (%s desktop)",
    async (desktop) => {
      const user = userEvent.setup();
      renderList({ structureOnly: true, desktop });

      await user.click(screen.getByRole("button", { name: "Assignees for Item A" }));
      expect(panel("Assignment editor for Item A")).toBeInTheDocument();

      await selectItemB(user);

      expect(panel("Assignment editor for Item B")).toBeInTheDocument();
      expect(screen.getAllByText("Assignments for Item B").at(-1)).toBeInTheDocument();
    },
  );

  it("exits song details and shows the new item's Content panel", async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(screen.getByRole("button", { name: "Add content to Item A" }));
    await user.click(screen.getByRole("button", { name: "Open song details" }));
    expect(panel("Song details for Song A")).toBeInTheDocument();

    await selectItemB(user);

    expect(panel("Content editor for Item B")).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Song details for Song A" })).not.toBeInTheDocument();
  });

  it("does not open a panel when selecting an item with no panel open", async () => {
    const user = userEvent.setup();
    renderList();

    await selectItemB(user);

    expect(screen.queryByRole("complementary", { name: /editor for/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: /editor for/i })).not.toBeInTheDocument();
  });

  it("hides Done while entering a resource and restores it afterward", async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(screen.getByRole("button", { name: "Add content to Item A" }));
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Begin resource entry" }));
    expect(screen.queryByRole("button", { name: "Done" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Finish resource entry" }));
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
  });

  it("follows a parent-controlled selection change when a panel is already open", async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(screen.getByRole("button", { name: "Add content to Item A" }));
    await user.click(screen.getByRole("button", { name: "Externally select Item B" }));

    expect(panel("Content editor for Item B")).toBeInTheDocument();
  });

  it("closes item-specific content when selecting a section", async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(screen.getByRole("button", { name: "Add content to Item A" }));
    expect(panel("Content editor for Item A")).toBeInTheDocument();

    await user.click(screen.getByDisplayValue("Section A"));

    await waitFor(() =>
      expect(screen.queryByRole("complementary", { name: /editor for/i })).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /editor for/i })).not.toBeInTheDocument(),
    );
  });

  it("closes the panel when its represented item is deleted", async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(screen.getByRole("button", { name: "Add content to Item A" }));
    expect(panel("Content editor for Item A")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "More actions for Item A" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete item" }));

    await waitFor(() =>
      expect(screen.queryByRole("complementary", { name: /editor for/i })).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /editor for/i })).not.toBeInTheDocument(),
    );
    expect(screen.getByDisplayValue("Item B")).toBeInTheDocument();
  });

});
