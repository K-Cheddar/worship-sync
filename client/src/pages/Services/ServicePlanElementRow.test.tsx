import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DndContext } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import ServicePlanElementRow, {
  elementDndId,
  getServicePlanElementSurfaceClassName,
  richTextOneLinePreview,
  SERVICE_PLAN_COL,
  type ServicePlanRoleNoteOption,
  type ServicePlanTeamNoteOption,
} from "./ServicePlanElementRow";
import { plainTextToRichText } from "../../types/richText";
import type {
  ServicePlanElement,
  ServicePlanMicrophone,
  ServiceEquipment,
  ServicePlanSongReference,
} from "../../types/servicePlan";

let mockSongDocs: Array<Record<string, unknown>> = [];
let mockFreeFormDocs: Array<{ _id: string; name: string; type?: string; slides?: unknown[] }> = [];
jest.mock("../../hooks", () => ({
  useSelector: (selector: (state: unknown) => unknown) =>
    selector({ allDocs: { allSongDocs: mockSongDocs, allFreeFormDocs: mockFreeFormDocs } }),
}));

jest.mock("../../containers/ItemSlides/StaticSlideThumbnail", () => ({
  __esModule: true,
  default: ({ slide }: { slide: { name: string } }) => <div>{slide.name}</div>,
}));

// Both read Redux song state; the row's contract is only which one opens, with
// which title, and that the popover can escalate to the picker.
jest.mock("./ServicePlanLibraryPicker", () => ({
  __esModule: true,
  default: ({
    initialQuery,
    initialLyrics,
    startInCreate,
  }: {
    initialQuery?: string;
    initialLyrics?: string;
    startInCreate?: boolean;
  }) => (
    <div
      data-testid="song-picker"
      data-initial-query={initialQuery}
      data-initial-lyrics={initialLyrics}
      data-start-in-create={startInCreate ? "true" : "false"}
    />
  ),
}));

jest.mock("./ServicePlanSongSuggestionPopover", () => ({
  __esModule: true,
  default: ({
    open,
    title,
    anchor,
    onOpenLibrary,
    onCreateSong,
  }: {
    open: boolean;
    title: string;
    anchor: React.ReactNode;
    onOpenLibrary: () => void;
    onCreateSong?: () => void;
  }) => (
    <>
      {anchor}
      {open ? (
        <div data-testid="song-suggestions" data-title={title}>
          <button type="button" onClick={onOpenLibrary}>
            Search library
          </button>
          {onCreateSong ? (
            <button type="button" onClick={onCreateSong}>
              Create song
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  ),
}));

describe("getServicePlanElementSurfaceClassName", () => {
  it("alternates list-row backgrounds without type-colored borders", () => {
    const even = getServicePlanElementSurfaceClassName({ toneIndex: 0 });
    const odd = getServicePlanElementSurfaceClassName({ toneIndex: 1 });
    expect(even).toContain("bg-gray-800/35");
    expect(odd).toContain("bg-transparent");
    expect(even).toContain("border-b");
    expect(even).not.toContain("border-l-4");
    expect(even).not.toContain("border-l-cyan");
    expect(even).not.toEqual(odd);
  });

  it("marks live rows with a subtle emerald inset ring", () => {
    const live = getServicePlanElementSurfaceClassName({
      toneIndex: 1,
      isLive: true,
    });
    expect(live).toContain("ring-emerald-500/35");
    expect(live).toContain("bg-emerald-950/30");
    expect(live).not.toContain("border-l-emerald");
  });
});

describe("richTextOneLinePreview", () => {
  it("flattens rich text onto one line for collapsed previews", () => {
    expect(
      richTextOneLinePreview({
        blocks: [
          { type: "paragraph", spans: [{ text: "First  line" }] },
          { type: "list-item", spans: [{ text: "Second" }] },
        ],
      }),
    ).toBe("First line Second");
  });
});

describe("service plan row responsive columns", () => {
  it("reserves the additional participant preview for the 2xl assignment width", () => {
    expect(SERVICE_PLAN_COL.row).toContain("lg:grid-cols-[1.5rem_4.5rem_max-content_minmax(11rem,1.6fr)_minmax(9rem,1.2fr)_minmax(8rem,1fr)");
    expect(SERVICE_PLAN_COL.row).toContain("2xl:grid-cols-[1.5rem_5rem_max-content_minmax(16rem,1.6fr)_minmax(14rem,1.2fr)_minmax(12rem,1fr)");
    expect(SERVICE_PLAN_COL.mediumViewWithActions).toContain("lg:grid-cols-[1.5rem_5rem_max-content_minmax(12rem,1.4fr)_minmax(10rem,1.4fr)_minmax(11rem,1.1fr)");
    expect(SERVICE_PLAN_COL.mediumViewWithActions).toContain("2xl:grid-cols-[1.5rem_5rem_max-content_minmax(16rem,1.4fr)_minmax(14rem,1.4fr)_minmax(12rem,1.1fr)");
  });
});

describe("custom document content badges", () => {
  it("uses the current document title in the Content column", () => {
    mockFreeFormDocs = [{ _id: "document-1", name: "Updated presentation" }];
    renderRow({
      canEdit: false,
      element: {
        ...baseElement,
        resources: [{
          id: "custom-document-ref",
          type: "custom-document",
          title: "Old title",
          data: { customDocumentId: "document-1" },
        }],
      },
    });

    expect(screen.getByText("Updated presentation")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview Updated presentation" })).toBeInTheDocument();
  });

  it("opens the authenticated custom document preview in read-only mode", async () => {
    const user = userEvent.setup();
    const onSelect = jest.fn();
    mockFreeFormDocs = [{
      _id: "document-1",
      name: "Updated presentation",
      type: "free",
      slides: [{ id: "slide-1", name: "Welcome slide" }],
    }];

    renderRow({
      canEdit: false,
      isEditing: false,
      onSelect,
      element: {
        ...baseElement,
        resources: [{
          id: "custom-document-ref",
          type: "custom-document",
          title: "Old title",
          data: { customDocumentId: "document-1" },
        }],
      },
    });

    await user.click(screen.getByRole("button", { name: "Preview Updated presentation" }));

    expect(await screen.findByRole("heading", { name: "Updated presentation" })).toBeInTheDocument();
    expect(screen.getByText("Welcome slide", { selector: "figcaption" })).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });
});

const baseElement: ServicePlanElement = {
  id: "el-1",
  type: "free",
  title: plainTextToRichText("Pastoral Greetings"),
  startTime: "10:00",
  durationMinutes: 5,
};

const renderRow = (
  overrides: {
    element?: ServicePlanElement;
    toneIndex?: number;
    isServiceDay?: boolean;
    isLive?: boolean;
    isManualLive?: boolean;
    canEdit?: boolean;
    isEditing?: boolean;
    hideNotes?: boolean;
    teamNotesFilter?: string;
    roleNotesFilter?: string;
    teamNoteOptions?: ServicePlanTeamNoteOption[];
    roleNoteOptions?: ServicePlanRoleNoteOption[];
    onUpdate?: jest.Mock;
    onSelect?: jest.Mock;
    onViewSongLyrics?: jest.Mock;
    onOpenContent?: jest.Mock;
    canCreateLibrarySong?: boolean;
    resolvedSongRef?: ServicePlanSongReference;
    microphones?: ServicePlanMicrophone[];
    iemEquipment?: ServiceEquipment[];
    scheduledEquipmentHolders?: ReadonlyMap<string, string[]>;
    scheduledEquipmentStatus?: "ready" | "loading" | "unavailable";
    structureOnly?: boolean;
    onReviewImportAmbiguity?: jest.Mock;
    isReviewing?: boolean;
  } = {},
) => {
  const element = overrides.element ?? baseElement;
  const canEdit = overrides.canEdit ?? true;
  return render(
    <DndContext onDragEnd={() => { }}>
      <SortableContext
        items={[elementDndId(element.id)]}
        strategy={verticalListSortingStrategy}
      >
        <ServicePlanElementRow
          element={element}
          canEdit={canEdit}
          isEditing={overrides.isEditing ?? canEdit}
          onRemove={jest.fn()}
          onUpdate={overrides.onUpdate ?? jest.fn()}
          onSelect={overrides.onSelect}
          onDurationChange={jest.fn()}
          onStartTimeChange={jest.fn()}
          assignedToHistoryValues={[]}
          toneIndex={overrides.toneIndex}
          isServiceDay={overrides.isServiceDay ?? false}
          isLive={overrides.isLive ?? false}
          isManualLive={overrides.isManualLive ?? false}
          onMakePublicLive={jest.fn()}
          hideNotes={overrides.hideNotes}
          teamNotesFilter={overrides.teamNotesFilter}
          roleNotesFilter={overrides.roleNotesFilter}
          teamNoteOptions={overrides.teamNoteOptions}
          roleNoteOptions={overrides.roleNoteOptions}
          onViewSongLyrics={overrides.onViewSongLyrics}
          onOpenContent={overrides.onOpenContent}
          onReviewImportAmbiguity={overrides.onReviewImportAmbiguity}
          isReviewing={overrides.isReviewing}
          canCreateLibrarySong={overrides.canCreateLibrarySong}
          resolvedSongRef={overrides.resolvedSongRef}
          microphones={overrides.microphones}
          iemEquipment={overrides.iemEquipment}
          scheduledEquipmentHolders={overrides.scheduledEquipmentHolders}
          scheduledEquipmentStatus={overrides.scheduledEquipmentStatus}
          structureOnly={overrides.structureOnly}
        />
      </SortableContext>
    </DndContext>,
  );
};

describe("import ambiguity indicator", () => {
  it("marks the active review row without changing selection", () => {
    renderRow({ isReviewing: true });

    expect(screen.getByTestId("service-plan-element-el-1")).toHaveAttribute("data-reviewing", "true");
  });

  it("opens review from an accessible row action and remains visible when deferred", async () => {
    const user = userEvent.setup();
    const onReviewImportAmbiguity = jest.fn();
    renderRow({
      element: {
        ...baseElement,
        importAmbiguity: {
          source: "servicePlanning",
          sourceKey: "Worship:0",
          sourceElementType: "Reading",
          sourceTitle: "Psalms 97 Jasmine Williams",
          sourceLedBy: "",
          parts: [],
          reasons: ["Review the remaining text."],
          status: "deferred",
          sourceFingerprint: "source",
        },
      },
      onReviewImportAmbiguity,
    });
    await user.click(screen.getByRole("button", { name: "Review import interpretation for Pastoral Greetings" }));
    expect(onReviewImportAmbiguity).toHaveBeenCalledTimes(1);
  });

  it("keeps a clear external link accessible for attachment authorization", () => {
    renderRow({
      element: {
        ...baseElement,
        importAmbiguity: {
          source: "servicePlanning",
          sourceKey: "Worship:0",
          sourceElementType: "Special Feature",
          sourceTitle: "https://youtu.be/abc?t=45",
          sourceLedBy: "",
          parts: [{ kind: "url", value: "https://youtu.be/abc?t=45", destination: "resource", sourceField: "title" }],
          reasons: [],
          status: "confirmed",
          authorizationPending: true,
          sourceFingerprint: "source",
        },
      },
      onReviewImportAmbiguity: jest.fn(),
    });

    expect(screen.getByRole("button", { name: "Review import interpretation for Pastoral Greetings" })).toBeInTheDocument();
  });

  it("does not show a review warning for an empty-title-only import condition", () => {
    renderRow({
      element: {
        ...baseElement,
        importAmbiguity: {
          source: "servicePlanning",
          sourceKey: "Worship:0",
          sourceElementType: "Special Feature",
          sourceTitle: "",
          sourceLedBy: "",
          parts: [],
          reasons: ["The source title is empty."],
          status: "confirmed",
          sourceFingerprint: "empty-title",
        },
      },
      onReviewImportAmbiguity: jest.fn(),
    });

    expect(screen.queryByRole("button", { name: "Review import interpretation for Pastoral Greetings" })).not.toBeInTheDocument();
  });
});

describe("ServicePlanElementRow", () => {
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
    // Keep the compact note toolbar stable in jsdom (same as RichTextEditor tests).
    window.matchMedia = ((query: string) => ({
      matches: false,
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
  });

  it("keeps content and notes in separate contextual Add menus", async () => {
    const user = userEvent.setup();
    renderRow({ teamNoteOptions: [{ teamId: "band", label: "Band" }] });

    expect(screen.queryByRole("button", { name: /Add song/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Add content to Pastoral Greetings/i }));

    expect(await screen.findByRole("menuitem", { name: /^Song$/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /^Scripture$/i })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /^Note$/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /More actions for Pastoral Greetings/i }));
    expect(await screen.findByRole("menuitem", { name: /^Note$/i })).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /Team-specific note/i }),
    ).toBeInTheDocument();
  });

  // Covers the menu-to-popover handoff: picking Scripture should leave the
  // operator able to type a reference straight away. (jsdom can't reproduce the
  // dismissal this flow is prone to — see the `modal` note on the popover.)
  it("hands focus to the reference field when scripture opens from the Add menu", async () => {
    const user = userEvent.setup();
    renderRow();

    await user.click(screen.getByRole("button", { name: /Add content to Pastoral Greetings/i }));
    await user.click(screen.getByRole("menuitem", { name: /^Scripture$/i }));

    const field = await screen.findByLabelText(/Scripture reference/i);
    expect(field).toHaveFocus();
  });

  // Attaching scripture clears the legacy singular `songRef` as part of moving
  // the element onto the arrays. It has to write `songRefs` in the same update
  // or the merged element ends up with no song at all.
  it("keeps a legacy single song when scripture is added through the content manager", async () => {
    const user = userEvent.setup();
    const onUpdate = jest.fn();
    renderRow({
      onUpdate,
      element: {
        ...baseElement,
        type: "song",
        songRef: { kind: "library", songId: "song-1", songName: "Great Are You Lord" },
      },
    });

    await user.click(
      screen.getByRole("button", { name: /Manage content for Pastoral Greetings/i }),
    );
    await user.click(screen.getByRole("button", { name: /Add content to Pastoral Greetings/i }));
    await user.click(screen.getByRole("menuitem", { name: /^Scripture$/i }));
    await user.type(
      await screen.findByLabelText(/Scripture reference/i),
      "John 3:16",
    );
    await user.click(screen.getByRole("button", { name: /Attach scripture/i }));

    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        songRef: undefined,
        songRefs: [
          { kind: "library", songId: "song-1", songName: "Great Are You Lord" },
        ],
      }),
    );
  });

  it("adds a role note using the selected Teams position", async () => {
    const user = userEvent.setup();
    const onUpdate = jest.fn();
    renderRow({
      onUpdate,
      roleNoteOptions: [{
        positionId: "camera",
        label: "Camera",
        teamId: "media",
        teamName: "Media Team",
      }],
    });

    await user.click(screen.getByRole("button", { name: /More actions for Pastoral Greetings/i }));
    await user.click(await screen.findByRole("menuitem", { name: /Role-specific note/i }));

    expect(onUpdate).not.toHaveBeenCalled();

    // Selection is on click: the picker lets pointerDown through untouched so a
    // touch drag scrolls the role list instead of picking whatever is under
    // the finger (see ServicePlanRolePickerContent).
    // Selection is on click now: the picker lets pointerDown through untouched
    // so a touch drag scrolls the role list instead of picking whatever is
    // under the finger (see RoleNoteAudienceSubmenu). A raw click event is
    // needed rather than userEvent's — its pointer movement closes the Radix
    // submenu before the click lands.
    fireEvent.click(await screen.findByRole("button", { name: "Camera" }));

    expect(onUpdate).toHaveBeenCalledWith({
      teamNotes: [
        expect.objectContaining({
          scope: "role",
          positionIds: ["camera"],
          label: "Camera",
          teamIds: ["media"],
          teamNames: ["Media Team"],
        }),
      ],
    });
  });

  it("summarizes extra attachments and reveals them in the content manager", async () => {
    const user = userEvent.setup();
    const onUpdate = jest.fn();
    renderRow({
      onUpdate,
      element: {
        ...baseElement,
        songRefs: [
          { kind: "library", songId: "song-1", songName: "Opening Song" },
          { kind: "library", songId: "song-2", songName: "Response Song" },
        ],
        scriptureRefs: [
          { label: "Psalm 100", book: "Psalms", chapter: "100", verseRange: "", version: "NIV" },
          { label: "John 3:16", book: "John", chapter: "3", verseRange: "16", version: "NIV" },
        ],
      },
    });

    expect(screen.getByText("Opening Song")).toBeInTheDocument();
    expect(screen.queryByText("Response Song")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Manage content for Pastoral Greetings/i })).toHaveTextContent("3");

    await user.click(screen.getByRole("button", { name: /Manage content for Pastoral Greetings/i }));
    expect(await screen.findByText("Response Song")).toBeInTheDocument();
    expect(screen.getByText("Psalm 100")).toBeInTheDocument();
    expect(screen.getByText("John 3:16")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove song Response Song" }));
    expect(onUpdate).toHaveBeenCalledWith({
      songRef: undefined,
      songRefs: [{ kind: "library", songId: "song-1", songName: "Opening Song" }],
    });
  });

  it("edits a scripture attachment in place", async () => {
    const user = userEvent.setup();
    const onUpdate = jest.fn();
    renderRow({
      onUpdate,
      element: {
        ...baseElement,
        scriptureRefs: [
          { label: "Psalm 100 (NIV)", book: "Psalms", chapter: "100", verseRange: "", version: "NIV" },
          { label: "John 3:16 (NIV)", book: "John", chapter: "3", verseRange: "16", version: "NIV" },
        ],
      },
    });

    await user.click(screen.getByRole("button", { name: "Edit scripture Psalm 100 (NIV)" }));

    const field = await screen.findByLabelText(/Scripture reference/i);
    expect(field).toHaveValue("Psalms 100");
    await user.clear(field);
    await user.type(field, "Psalm 23:1");
    await user.click(screen.getByRole("button", { name: /Update scripture/i }));

    expect(onUpdate).toHaveBeenCalledWith({
      scriptureRef: undefined,
      scriptureRefs: [
        expect.objectContaining({
          book: "Psalms",
          chapter: "23",
          verseRange: "1",
          version: "NIV",
        }),
        { label: "John 3:16 (NIV)", book: "John", chapter: "3", verseRange: "16", version: "NIV" },
      ],
    });
  });

  it("shows Make live only on the service day", () => {
    const { rerender } = renderRow({ isServiceDay: false });
    expect(
      screen.queryByRole("button", { name: /Make Pastoral Greetings live/i }),
    ).not.toBeInTheDocument();

    rerender(
      <DndContext onDragEnd={() => { }}>
        <SortableContext
          items={[elementDndId(baseElement.id)]}
          strategy={verticalListSortingStrategy}
        >
          <ServicePlanElementRow
            element={baseElement}
            canEdit
            isEditing={false}
            onRemove={jest.fn()}
            onUpdate={jest.fn()}
            onDurationChange={jest.fn()}
            onStartTimeChange={jest.fn()}
            assignedToHistoryValues={[]}
            isServiceDay
            onMakePublicLive={jest.fn()}
          />
        </SortableContext>
      </DndContext>,
    );

    expect(
      screen.getByRole("button", { name: /Make Pastoral Greetings live/i }),
    ).toHaveTextContent("Make live");
  });

  it("hides Make live while editing", () => {
    renderRow({ isServiceDay: true, isEditing: true });
    expect(
      screen.queryByRole("button", { name: /Make Pastoral Greetings live/i }),
    ).not.toBeInTheDocument();
  });

  it("opens the content panel instead of an edit popover when available", async () => {
    const user = userEvent.setup();
    const onOpenContent = jest.fn();
    renderRow({
      onOpenContent,
      element: {
        ...baseElement,
        scriptureRefs: [
          { label: "Psalm 100 (NIV)", book: "Psalms", chapter: "100", verseRange: "", version: "NIV" },
        ],
      },
    });

    await user.click(screen.getByRole("button", { name: "Edit scripture Psalm 100 (NIV)" }));

    expect(onOpenContent).toHaveBeenCalledWith(expect.any(HTMLElement));
    expect(screen.queryByLabelText(/Scripture reference/i)).not.toBeInTheDocument();
  });

  it("hides the live badge while editing", () => {
    renderRow({ isLive: true, isEditing: true });

    expect(
      screen.queryByLabelText(/Live on schedule: Pastoral Greetings/i),
    ).not.toBeInTheDocument();
  });

  it("minimizes notes to one preview line and expands to the editor", async () => {
    const user = userEvent.setup();
    renderRow({
      element: {
        ...baseElement,
        notes: plainTextToRichText("Slow the tempo down."),
        teamNotes: [
          {
            id: "tn-1",
            label: "Band",
            note: plainTextToRichText("Watch the bridge cue."),
          },
        ],
      },
    });

    expect(screen.getByRole("button", { name: /Expand notes/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Expand Band/i })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Notes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bold" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "More formatting" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Expand notes/i }));
    expect(await screen.findByRole("textbox", { name: "Notes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bold" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "More formatting" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Minimize notes/i }));
    // After minimize, the editor panel is aria-hidden; the preview control returns.
    expect(screen.queryByRole("textbox", { name: "Notes" })).not.toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: /Expand notes/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Expand Band/i }));
    expect(await screen.findByRole("textbox", { name: /Band note/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/Team note audience/i)).toBeInTheDocument();
  });

  it("hides shared and team notes when hideNotes is set", async () => {
    const user = userEvent.setup();
    renderRow({
      hideNotes: true,
      element: {
        ...baseElement,
        notes: plainTextToRichText("Slow the tempo down."),
        teamNotes: [
          {
            id: "tn-1",
            label: "Band",
            note: plainTextToRichText("Watch the bridge cue."),
          },
        ],
      },
    });

    expect(screen.queryByRole("button", { name: /Expand notes/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Expand Band/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Slow the tempo down.")).not.toBeInTheDocument();
    expect(screen.queryByText("Watch the bridge cue.")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /Add content to Pastoral Greetings/i }),
    );
    expect(await screen.findByRole("menuitem", { name: /^Song$/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /^Scripture$/i })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /^Note$/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: /Team-specific note/i }),
    ).not.toBeInTheDocument();
  });

  it("filters team notes by label while leaving shared notes visible", () => {
    renderRow({
      teamNotesFilter: "Band",
      element: {
        ...baseElement,
        notes: plainTextToRichText("Panel Discussion"),
        teamNotes: [
          {
            id: "tn-1",
            label: "Band",
            note: plainTextToRichText("Watch the bridge cue."),
          },
          {
            id: "tn-2",
            label: "Media Team",
            note: plainTextToRichText("Lower house lights."),
          },
        ],
      },
    });

    expect(screen.getByRole("button", { name: /Expand notes/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Expand Band/i })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Expand Media Team/i }),
    ).not.toBeInTheDocument();
  });

  it("scopes all role notes to the selected team", () => {
    renderRow({
      teamNotesFilter: "Coordinators",
      element: {
        ...baseElement,
        teamNotes: [
          {
            id: "role-media",
            scope: "role",
            positionId: "director",
            label: "Media Team · Director",
            teamName: "Media Team",
            note: plainTextToRichText("Check the camera."),
          },
          {
            id: "role-coordinator",
            scope: "role",
            positionId: "lead-coordinator",
            label: "Coordinators · Lead Coordinator",
            teamName: "Coordinators",
            note: plainTextToRichText("Give the go-live cue."),
          },
        ],
      },
    });

    expect(
      screen.getByRole("button", { name: /Expand Coordinators · Lead Coordinator/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Expand Media Team · Director/i }),
    ).not.toBeInTheDocument();
  });

  it("shows selected role names on the audience trigger and marks them in the menu", async () => {
    const user = userEvent.setup();
    const roleNoteOptions: ServicePlanRoleNoteOption[] = [
      {
        positionId: "lead-coordinator",
        label: "Coordinators · Lead Coordinator",
        teamId: "coordinators",
        teamName: "Coordinators",
      },
      {
        positionId: "camera",
        label: "Media Team · Camera",
        teamId: "media",
        teamName: "Media Team",
      },
      {
        positionId: "director",
        label: "Media Team · Director",
        teamId: "media",
        teamName: "Media Team",
      },
    ];

    renderRow({
      roleNoteOptions,
      element: {
        ...baseElement,
        teamNotes: [
          {
            id: "role-note",
            scope: "role",
            positionIds: ["lead-coordinator", "camera"],
            label: "Coordinators · Lead Coordinator, Media Team · Camera",
            note: plainTextToRichText("Cue camera two."),
          },
        ],
      },
    });

    await user.click(
      screen.getByRole("button", {
        name: /Expand Lead Coordinator, Camera/i,
      }),
    );

    const audienceTrigger = screen.getByRole("button", {
      name: /Role note audiences: Lead Coordinator, Camera/i,
    });
    expect(audienceTrigger).toHaveTextContent("Lead Coordinator, Camera");
    expect(audienceTrigger).not.toHaveTextContent(/2 roles/i);

    await user.click(audienceTrigger);

    expect(screen.getByRole("button", { name: "Lead Coordinator" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Camera" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Director" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("renders a compact read-only row in view mode", () => {
    renderRow({
      isEditing: false,
      element: {
        ...baseElement,
        assignedName: "Pastoral Team",
        notes: plainTextToRichText("Panel Discussion"),
      },
    });

    expect(screen.getByText("Pastoral Greetings")).toBeInTheDocument();
    expect(screen.getAllByText("Pastoral Team").length).toBeGreaterThan(0);
    expect(screen.getByText("10:00 AM")).toBeInTheDocument();
    expect(screen.getByText("5m")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /^Title/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Drag to reorder/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Add content to Pastoral Greetings/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove note/i })).not.toBeInTheDocument();
  });

  it("shows ordered participant names and opens complete microphone details", async () => {
    const user = userEvent.setup();
    const orange: ServicePlanMicrophone = {
      id: "mic-orange",
      name: "Orange",
      type: "Handheld",
      color: "#f97316",
    };
    renderRow({
      canEdit: false,
      isEditing: false,
      microphones: [orange],
      element: {
        ...baseElement,
        assignees: [
          { id: "mic", microphoneIds: ["mic-orange"] },
          { id: "lead", name: "Pastor John", microphoneIds: ["mic-orange"] },
          { id: "second", name: "Sarah Lee" },
        ],
      },
    });

    const trigger = screen.getByRole("button", {
      name: "Show all 2 participants for Pastoral Greetings",
    });
    expect(trigger).toHaveTextContent("2");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveClass(
      "flex-none",
      "shrink-0",
      "max-md:min-h-0!",
      "max-md:h-[2rem]!",
    );
    expect(screen.getByText("Pastor John, Sarah Lee")).toHaveClass(
      "min-w-0",
      "flex-1",
      "overflow-hidden",
      "text-ellipsis",
      "whitespace-nowrap",
    );

    await user.click(trigger);
    const dialog = await screen.findByRole("dialog");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(dialog).toHaveTextContent("Assignees");
    expect(dialog).toHaveTextContent("Pastor John");
    expect(dialog).toHaveTextContent("Sarah Lee");
    expect(dialog).toHaveTextContent("Orange");
    await user.keyboard("{Escape}");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("preserves distinct same-name participant records in edit and view summaries", async () => {
    const user = userEvent.setup();
    const orange: ServicePlanMicrophone = {
      id: "mic-orange",
      name: "Orange",
      type: "Handheld",
      color: "#f97316",
    };
    renderRow({
      element: {
        ...baseElement,
        assignees: [
          { id: "lead", name: "Pastor John" },
          { id: "duplicate", name: " pastor john " },
          { id: "same-name", name: "Pastor John" },
          { id: "second", name: "Sarah Lee" },
          { id: "stand", microphoneIds: [orange.id] },
        ],
      },
      microphones: [orange],
    });

    expect(screen.getByPlaceholderText("Led by")).toHaveValue("Pastor John");
    const additionalNames = screen.getByTitle("pastor john, Pastor John, Sarah Lee");
    expect(additionalNames).toHaveTextContent("pastor john, Pastor John, Sarah Lee");
    expect(additionalNames).toHaveClass("hidden", "2xl:block");
    const trigger = screen.getByRole("button", {
      name: "Show all 4 participants for Pastoral Greetings",
    });
    expect(trigger).toHaveTextContent("4");
    expect(trigger).toHaveClass("min-w-10", "shrink-0");

    await user.click(trigger);
    expect(await screen.findByText("Edit people and equipment")).toBeInTheDocument();
    expect(
      screen
        .getAllByPlaceholderText("Assigned to")
        .map((field) => (field as HTMLInputElement).value),
    ).toEqual(expect.arrayContaining([
      "Pastor John",
      " pastor john ",
      "Pastor John",
      "Sarah Lee",
    ]));
    expect(screen.getAllByText("Orange").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByText("Edit people and equipment")).not.toBeInTheDocument();
  });

  it("keeps view names ordered for every assigned participant and excludes empty mic slots", () => {
    renderRow({
      canEdit: false,
      isEditing: false,
      element: {
        ...baseElement,
        assignees: [
          { id: "stand", microphoneIds: ["mic-orange"] },
          { id: "lead", name: "Pastor John" },
          { id: "duplicate", name: " pastor john " },
          { id: "same-name", name: "Pastor John" },
          { id: "second", name: "Sarah Lee" },
        ],
      },
    });

    const participantNames = screen.getByText("Pastor John, pastor john, Pastor John, Sarah Lee");
    expect(participantNames).toHaveAttribute(
      "title",
      "Pastor John, pastor john, Pastor John, Sarah Lee",
    );
    expect(participantNames).toHaveClass(
      "min-w-0",
      "flex-1",
      "overflow-hidden",
      "text-ellipsis",
      "whitespace-nowrap",
    );
    const trigger = screen.getByRole("button", {
      name: "Show all 4 participants for Pastoral Greetings",
    });
    expect(trigger).toHaveTextContent("4");
    expect(trigger).toHaveClass("min-w-10", "shrink-0");
  });

  it("keeps the edit assignment trigger without a count for zero participants", async () => {
    const user = userEvent.setup();
    renderRow();

    const trigger = screen.getByRole("button", {
      name: "Assignees for Pastoral Greetings",
    });
    expect(trigger).not.toHaveTextContent(/\d/);
    await user.click(trigger);
    expect(await screen.findByText("Edit people and equipment")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add person/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByText("Edit people and equipment")).not.toBeInTheDocument();
  });

  it("updates the lead input and additional names after promoting another participant", async () => {
    const user = userEvent.setup();
    const onUpdate = jest.fn();
    const initialElement = {
      ...baseElement,
      assignees: [
        { id: "lead", name: "Pastor John" },
        { id: "second", name: "Sarah Lee" },
      ],
    };
    const { rerender } = renderRow({ element: initialElement, onUpdate });

    expect(screen.getByPlaceholderText("Led by")).toHaveValue("Pastor John");
    expect(screen.getByTitle("Sarah Lee")).toHaveTextContent("Sarah Lee");
    await user.click(
      screen.getByRole("button", { name: "Show all 2 participants for Pastoral Greetings" }),
    );
    await user.click(await screen.findByRole("button", { name: "Make lead" }));

    expect(onUpdate).toHaveBeenCalledWith({
      assignees: [
        { id: "second", name: "Sarah Lee" },
        { id: "lead", name: "Pastor John" },
      ],
    }, undefined);

    rerender(
      <DndContext onDragEnd={() => { }}>
        <SortableContext
          items={[elementDndId(initialElement.id)]}
          strategy={verticalListSortingStrategy}
        >
          <ServicePlanElementRow
            element={{
              ...initialElement,
              assignees: [
                { id: "second", name: "Sarah Lee" },
                { id: "lead", name: "Pastor John" },
              ],
            }}
            canEdit
            isEditing
            onRemove={jest.fn()}
            onUpdate={onUpdate}
            onDurationChange={jest.fn()}
            onStartTimeChange={jest.fn()}
            assignedToHistoryValues={[]}
          />
        </SortableContext>
      </DndContext>,
    );

    expect(screen.getByPlaceholderText("Led by")).toHaveValue("Sarah Lee");
    expect(screen.getByTitle("Pastor John")).toHaveTextContent("Pastor John");
  });

  it("keeps the details trigger available for one long-named participant and zero people", async () => {
    const user = userEvent.setup();
    const { rerender } = renderRow({
      canEdit: false,
      isEditing: false,
      element: {
        ...baseElement,
        assignees: [{ id: "a1", name: "A Very Exceptionally Long Participant Name" }],
      },
    });

    const oneParticipant = screen.getByRole("button", {
      name: "Show all 1 participant for Pastoral Greetings",
    });
    expect(oneParticipant).toHaveTextContent("1");
    expect(screen.getByText("A Very Exceptionally Long Participant Name")).toHaveAttribute(
      "title",
      "A Very Exceptionally Long Participant Name",
    );
    await user.click(oneParticipant);
    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "A Very Exceptionally Long Participant Name",
    );
    await user.keyboard("{Escape}");
    expect(oneParticipant).toHaveAttribute("aria-expanded", "false");

    rerender(
      <DndContext onDragEnd={() => { }}>
        <SortableContext
          items={[elementDndId(baseElement.id)]}
          strategy={verticalListSortingStrategy}
        >
          <ServicePlanElementRow
            element={baseElement}
            canEdit={false}
            isEditing={false}
            onRemove={jest.fn()}
            onUpdate={jest.fn()}
            onDurationChange={jest.fn()}
            onStartTimeChange={jest.fn()}
            assignedToHistoryValues={[]}
          />
        </SortableContext>
      </DndContext>,
    );
    expect(
      screen.getByRole("button", { name: "View people and equipment for Pastoral Greetings" }),
    ).not.toHaveTextContent(/\d/);
  });

  it("shows a stable total for many participants, including names beyond the visible width", async () => {
    const user = userEvent.setup();
    renderRow({
      canEdit: false,
      isEditing: false,
      element: {
        ...baseElement,
        assignees: [
          { id: "a1", name: "Alexandria Montgomery" },
          { id: "a2", name: "Benjamin Christopher" },
          { id: "a3", name: "Catherine Isabella" },
          { id: "a4", name: "Dominic Alexander" },
          { id: "stand", microphoneIds: ["mic-orange"] },
        ],
      },
    });

    const trigger = screen.getByRole("button", {
      name: "Show all 4 participants for Pastoral Greetings",
    });
    expect(trigger).toHaveTextContent("4");
    expect(screen.getByText(
      "Alexandria Montgomery, Benjamin Christopher, Catherine Isabella, Dominic Alexander",
    )).toHaveAttribute("title", "Alexandria Montgomery, Benjamin Christopher, Catherine Isabella, Dominic Alexander");
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Escape}");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveTextContent("4");
    await user.keyboard("{Enter}");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Escape}");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("opens lyrics from the song badge without removing the song", async () => {
    const user = userEvent.setup();
    const onViewSongLyrics = jest.fn();
    const onUpdate = jest.fn();
    const songRef = {
      kind: "library" as const,
      songId: "song-1",
      songName: "Living Hope",
    };

    renderRow({
      onUpdate,
      onViewSongLyrics,
      element: {
        ...baseElement,
        type: "song",
        title: plainTextToRichText("Living Hope"),
        songRef,
      },
    });

    await user.click(
      screen.getByRole("button", { name: /View song details for Living Hope/i }),
    );

    expect(onViewSongLyrics).toHaveBeenCalledWith(songRef);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("opens lyrics from each song badge when an element has multiple songs", async () => {
    const user = userEvent.setup();
    const onViewSongLyrics = jest.fn();
    const openingSong = {
      kind: "library" as const,
      songId: "song-1",
      songName: "Opening Song",
    };
    const responseSong = {
      kind: "library" as const,
      songId: "song-2",
      songName: "Response Song",
    };

    renderRow({
      onViewSongLyrics,
      element: {
        ...baseElement,
        songRefs: [openingSong, responseSong],
      },
    });

    await user.click(
      screen.getByRole("button", { name: /View song details for Opening Song/i }),
    );
    await user.click(screen.getByRole("button", { name: /Manage content for Pastoral Greetings/i }));
    await user.click(
      screen.getByRole("button", { name: /View song details for Response Song/i }),
    );

    expect(onViewSongLyrics).toHaveBeenNthCalledWith(1, openingSong);
    expect(onViewSongLyrics).toHaveBeenNthCalledWith(2, responseSong);
  });

  it("removes the song without opening lyrics", async () => {
    const user = userEvent.setup();
    const onViewSongLyrics = jest.fn();
    const onUpdate = jest.fn();

    renderRow({
      onUpdate,
      onViewSongLyrics,
      element: {
        ...baseElement,
        type: "song",
        title: plainTextToRichText("Living Hope"),
        songRef: {
          kind: "library",
          songId: "song-1",
          songName: "Living Hope",
        },
      },
    });

    await user.click(screen.getByRole("button", { name: /Remove song/i }));

    expect(onUpdate).toHaveBeenCalledWith({ songRef: undefined, songRefs: [] });
    expect(onViewSongLyrics).not.toHaveBeenCalled();
  });

  it("marks an unmatched imported song as not in the library", () => {
    renderRow({
      element: {
        ...baseElement,
        type: "song",
        title: plainTextToRichText("How Great is Our God (E)"),
        songRef: { kind: "pending", title: "How Great is Our God", lyricsText: "" },
      },
    });

    expect(screen.getByRole("img", { name: /Not in library/i })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /View song details/i }),
    ).not.toBeInTheDocument();
  });

  it("shows an unlinked source-classified song as not in the library", () => {
    renderRow({
      element: {
        ...baseElement,
        type: "free",
        sourceElementTypeRaw: "Song",
        title: plainTextToRichText("Shall Not Want (Eb→F)"),
      },
    });

    expect(screen.getByRole("img", { name: /Not in library/i })).toBeInTheDocument();
  });

  it("opens the existing content panel from a compact normalized mixed-resource summary", async () => {
    const user = userEvent.setup();
    const onOpenContent = jest.fn();
    renderRow({
      onOpenContent,
      element: {
        ...baseElement,
        songRef: { kind: "library", songId: "song-1", songName: "Opening Song" },
        scriptureRef: { label: "Psalm 100", book: "Psalms", chapter: "100", verseRange: "", version: "NIV" },
        resources: [
          { id: "song-resource", type: "song", title: "Opening Song", data: { songId: "song-1" } },
          { id: "scripture-resource", type: "scripture", title: "Psalm 100", data: { label: "Psalm 100" } },
          { id: "youtube", type: "youtube", title: "Sermon video" },
          { id: "audio", type: "audio", title: "Reference audio" },
          { id: "document", type: "document", title: "Service notes", data: { resourceId: "private-document-id" } },
          { id: "link", type: "url", title: "Reading", url: "https://example.com/reading" },
        ],
      },
    });

    const summary = screen.getByRole("button", { name: "Manage content for Pastoral Greetings" });
    expect(summary).toHaveTextContent("Opening Song");
    expect(summary).toHaveTextContent("+5");
    summary.focus();
    await user.keyboard("{Enter}");
    expect(onOpenContent).toHaveBeenCalledWith(expect.any(HTMLElement));
  });

  it("keeps the attached resource chip, remove control, and panel button together", () => {
    const onOpenContent = jest.fn();
    renderRow({
      onOpenContent,
      element: {
        ...baseElement,
        resources: [{ id: "notes", type: "url", title: "Notes", url: "https://example.com/notes" }],
      },
    });

    expect(screen.getByRole("button", { name: "Remove resource Notes" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Manage content for Pastoral Greetings" })).toHaveLength(2);
  });

  it("previews titled and untitled linked resources in view mode without selecting the row", async () => {
    const user = userEvent.setup();
    const onSelect = jest.fn();
    const url = "https://example.test/resources/a-very-long-resource-name-that-must-stay-within-the-content-column.pdf";
    const view = renderRow({
      canEdit: false,
      isEditing: false,
      onSelect,
      element: {
        ...baseElement,
        resources: [{ id: "titled", type: "url", title: "Service notes", url: "https://example.test/notes" }],
      },
    });

    expect(screen.getByText("Service notes")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Preview Service notes" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Close modal" }));
    view.unmount();
    renderRow({
      canEdit: false,
      isEditing: false,
      onSelect,
      element: {
        ...baseElement,
        resources: [{ id: "untitled", type: "url", title: "", url }],
      },
    });
    const untitled = screen.getByRole("button", { name: `Preview ${url}` });
    expect(screen.getByText(url)).toHaveClass("min-w-0", "truncate");
    expect(untitled).toHaveAttribute("title", url);
  });

  it("removes an inferred source-classified song instead of recreating it", async () => {
    const user = userEvent.setup();
    const onUpdate = jest.fn();

    renderRow({
      onUpdate,
      element: {
        ...baseElement,
        sourceElementTypeRaw: "Song",
        title: plainTextToRichText("Welcome and announcements"),
      },
    });

    await user.click(screen.getByRole("button", { name: "Remove song" }));

    expect(onUpdate).toHaveBeenCalledWith({
      songRef: undefined,
      songRefs: [],
      sourceSongReferenceDismissed: true,
    });
  });

  it("shows a song added to the library after the import as linked", async () => {
    const user = userEvent.setup();
    const onViewSongLyrics = jest.fn();
    const resolvedSongRef = {
      kind: "library" as const,
      songId: "song-42",
      songName: "How Great Is Our God",
    };

    renderRow({
      onViewSongLyrics,
      resolvedSongRef,
      element: {
        ...baseElement,
        type: "song",
        title: plainTextToRichText("How Great is Our God (E)"),
        // Still pending on the saved plan — the library gained it since.
        songRef: { kind: "pending", title: "How Great is Our God", lyricsText: "" },
      },
    });

    expect(screen.queryByRole("img", { name: /Not in library/i })).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: /View song details for How Great Is Our God/i }),
    );
    // The viewer gets the library song, not the stale pending reference.
    expect(onViewSongLyrics).toHaveBeenCalledWith(resolvedSongRef);
  });

  it("offers close matches from an unmatched song's badge", async () => {
    const user = userEvent.setup();
    const onViewSongLyrics = jest.fn();

    renderRow({
      onViewSongLyrics,
      element: {
        ...baseElement,
        type: "song",
        title: plainTextToRichText("How Great is Our God (E)"),
        songRef: { kind: "pending", title: "How Great is Our God", lyricsText: "" },
      },
    });

    await user.click(
      screen.getByRole("button", {
        name: /Link How Great is Our God to a song in the library/i,
      }),
    );

    expect(screen.getByTestId("song-suggestions")).toHaveAttribute(
      "data-title",
      "How Great is Our God",
    );
    // The heavy library modal stays shut until it's actually asked for.
    expect(screen.queryByTestId("song-picker")).not.toBeInTheDocument();
    expect(onViewSongLyrics).not.toHaveBeenCalled();
  });

  it("escalates from the suggestions to the library, keeping the title searched", async () => {
    const user = userEvent.setup();

    renderRow({
      element: {
        ...baseElement,
        type: "song",
        title: plainTextToRichText("How Great is Our God (E)"),
        songRef: { kind: "pending", title: "How Great is Our God", lyricsText: "" },
      },
    });

    await user.click(
      screen.getByRole("button", {
        name: /Link How Great is Our God to a song in the library/i,
      }),
    );
    await user.click(screen.getByRole("button", { name: /Search library/i }));

    expect(screen.getByTestId("song-picker")).toHaveAttribute(
      "data-initial-query",
      "How Great is Our God",
    );
  });

  it("escalates from the suggestions to create song when allowed", async () => {
    const user = userEvent.setup();

    renderRow({
      canCreateLibrarySong: true,
      element: {
        ...baseElement,
        type: "song",
        title: plainTextToRichText("How Great is Our God (E)"),
        songRef: {
          kind: "pending",
          title: "How Great is Our God",
          lyricsText: "The splendor of a king",
        },
      },
    });

    await user.click(
      screen.getByRole("button", {
        name: /Link How Great is Our God to a song in the library/i,
      }),
    );
    await user.click(screen.getByRole("button", { name: /Create song/i }));

    expect(screen.getByTestId("song-picker")).toHaveAttribute(
      "data-start-in-create",
      "true",
    );
    expect(screen.getByTestId("song-picker")).toHaveAttribute(
      "data-initial-query",
      "How Great is Our God",
    );
    expect(screen.getByTestId("song-picker")).toHaveAttribute(
      "data-initial-lyrics",
      "The splendor of a king",
    );
  });

  it("opens a status popover for unmatched songs in read mode", async () => {
    const user = userEvent.setup();
    const onViewSongLyrics = jest.fn();
    const songRef = {
      kind: "pending" as const,
      title: "Appeal Song",
      lyricsText: "Verse one",
    };

    renderRow({
      canEdit: false,
      isEditing: false,
      onViewSongLyrics,
      element: {
        ...baseElement,
        type: "song",
        title: plainTextToRichText("Appeal Song"),
        songRef,
      },
    });

    expect(
      screen.queryByRole("button", { name: /Create Appeal Song in the library/i }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", {
        name: /View song status for Appeal Song/i,
      }),
    );
    expect(screen.getByText("Song not found")).toBeInTheDocument();
    expect(screen.getAllByText("Appeal Song").length).toBeGreaterThan(1);
    expect(screen.getByText("This song is not in the library.")).toBeInTheDocument();
    expect(onViewSongLyrics).not.toHaveBeenCalled();
  });

  it("opens the status popover instead of create for an unmatched badge in read mode", async () => {
    const user = userEvent.setup();
    const onViewSongLyrics = jest.fn();

    renderRow({
      canEdit: true,
      isEditing: false,
      canCreateLibrarySong: true,
      onViewSongLyrics,
      element: {
        ...baseElement,
        type: "song",
        title: plainTextToRichText("Appeal Song"),
        songRef: {
          kind: "pending",
          title: "Appeal Song",
          lyricsText: "Come as you are",
        },
      },
    });

    await user.click(
      screen.getByRole("button", { name: /View song status for Appeal Song/i }),
    );

    expect(screen.getByText("Song not found")).toBeInTheDocument();
    expect(screen.getAllByText("Appeal Song").length).toBeGreaterThan(1);
    expect(screen.getByText("This song is not in the library.")).toBeInTheDocument();
    expect(screen.queryByTestId("song-picker")).not.toBeInTheDocument();
    expect(onViewSongLyrics).not.toHaveBeenCalled();
  });
});

describe("assignees and their microphones", () => {
  const orange: ServicePlanMicrophone = {
    id: "mic-orange",
    name: "Orange",
    type: "Handheld",
    color: "#f97316",
  };
  const lapel: ServicePlanMicrophone = {
    id: "mic-lapel",
    name: "Lapel 1",
    type: "Lapel",
    color: "#22d3ee",
  };

  it("shows every assignee, not just the first", () => {
    renderRow({
      canEdit: false,
      element: {
        ...baseElement,
        assignees: [
          { id: "a1", name: "Pastor John" },
          { id: "a2", name: "Sarah Lee" },
        ],
      },
    });

    // Group header matches Notes chrome so chips are not a loose row.
    expect(screen.getByText("Assignees")).toBeInTheDocument();
    // The running-order column is intentionally compact; the full block
    // beneath the item still exposes both people and their microphones.
    expect(screen.getAllByText("Pastor John").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: "Show all 2 participants for Pastoral Greetings" }),
    ).toHaveTextContent("2");
    expect(screen.getByText("Sarah Lee")).toBeInTheDocument();
  });

  it("reads a legacy single assignee and element microphones", () => {
    renderRow({
      canEdit: false,
      microphones: [orange],
      element: {
        ...baseElement,
        assignedName: "Pastor John",
        microphoneAssignments: [{ microphoneId: "mic-orange" }],
      },
    });

    expect(screen.getAllByText("Pastor John").length).toBeGreaterThan(0);
    // The legacy mic had no person on it, so it lands on the unassigned slot.
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
    expect(screen.getByText("Orange")).toBeInTheDocument();
  });

  it("keeps microphone assignments visible when notes are filtered", () => {
    renderRow({
      canEdit: true,
      isEditing: false,
      teamNotesFilter: "Media Team",
      microphones: [orange],
      element: {
        ...baseElement,
        assignees: [{ id: "a1", name: "Pastor John", microphoneIds: [orange.id] }],
      },
    });

    expect(screen.getAllByText("Pastor John").length).toBeGreaterThan(0);
    expect(screen.getByText("Orange")).toBeInTheDocument();
  });

  it("puts a microphone on the person it was added for", async () => {
    const user = userEvent.setup();
    const onUpdate = jest.fn();
    renderRow({
      microphones: [orange, lapel],
      onUpdate,
      element: {
        ...baseElement,
        assignees: [{ id: "a1", name: "Pastor John" }],
      },
    });

    await user.click(
      screen.getByRole("button", { name: "Show all 1 participant for Pastoral Greetings" }),
    );
    await user.click(
      await screen.findByRole("button", { name: /Add microphone for Pastor John/i }),
    );
    await user.click(await screen.findByRole("menuitem", { name: /Orange/i }));

    expect(onUpdate).toHaveBeenCalledWith(
      {
        assignees: [
          { id: "a1", name: "Pastor John", microphoneIds: ["mic-orange"] },
        ],
      },
      undefined,
    );
  });

  it("swaps an assigned microphone from its chip", async () => {
    const user = userEvent.setup();
    const onUpdate = jest.fn();
    renderRow({
      microphones: [orange, lapel],
      onUpdate,
      element: {
        ...baseElement,
        assignees: [{ id: "a1", name: "Pastor John", microphoneIds: [orange.id] }],
      },
    });

    await user.click(
      screen.getByRole("button", { name: "Show all 1 participant for Pastoral Greetings" }),
    );
    await user.click(
      screen.getByRole("button", { name: /Change Orange for Pastor John/i }),
    );
    await user.click(screen.getByRole("menuitem", { name: /Lapel 1/i }));

    expect(onUpdate).toHaveBeenCalledWith(
      {
        assignees: [
          { id: "a1", name: "Pastor John", microphoneIds: ["mic-lapel"] },
        ],
      },
      undefined,
    );
  });

  it("clears the lead name without promoting the next assignee", async () => {
    const user = userEvent.setup();
    const onUpdate = jest.fn();
    const { rerender } = renderRow({
      onUpdate,
      element: {
        ...baseElement,
        assignees: [
          { id: "lead", name: "Greg Baldeo" },
          { id: "additional", name: "Abigail" },
        ],
      },
    });
    await user.click(screen.getByRole("button", { name: "Clear" }));

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith({
        assignees: [
          { id: "lead", name: "" },
          { id: "additional", name: "Abigail" },
        ],
      });
    });

    rerender(
      <DndContext onDragEnd={() => { }}>
        <SortableContext
          items={[elementDndId(baseElement.id)]}
          strategy={verticalListSortingStrategy}
        >
          <ServicePlanElementRow
            element={{
              ...baseElement,
              assignees: [
                { id: "lead", name: "" },
                { id: "additional", name: "Abigail" },
              ],
            }}
            canEdit
            isEditing
            onRemove={jest.fn()}
            onUpdate={onUpdate}
            onDurationChange={jest.fn()}
            onStartTimeChange={jest.fn()}
            assignedToHistoryValues={[]}
          />
        </SortableContext>
      </DndContext>,
    );

    expect(screen.getByPlaceholderText("Led by")).toHaveValue("");
    expect(screen.getByTitle("Abigail")).toHaveTextContent("Abigail");
  });

  it("offers a microphone to only one person at a time", async () => {
    const user = userEvent.setup();
    renderRow({
      microphones: [orange, lapel],
      element: {
        ...baseElement,
        assignees: [
          { id: "a1", name: "Pastor John", microphoneIds: ["mic-orange"] },
          { id: "a2", name: "Sarah Lee" },
        ],
      },
    });

    await user.click(
      screen.getByRole("button", { name: "Show all 2 participants for Pastoral Greetings" }),
    );
    await user.click(
      await screen.findByRole("button", { name: /Add microphone for Sarah Lee/i }),
    );

    const menu = await screen.findByRole("menu");
    expect(menu).toHaveTextContent("Lapel 1");
    // Already in Pastor John's hands, so it is not offered again.
    expect(menu).not.toHaveTextContent("Orange");
  });

  it("marks schedule-held microphones in the add-mic menu", async () => {
    const user = userEvent.setup();
    renderRow({
      microphones: [orange, lapel],
      scheduledEquipmentHolders: new Map([["mic-orange", ["Johnny Mclain"]]]),
      element: {
        ...baseElement,
        assignees: [{ id: "a1", name: "Abigail" }],
      },
    });

    await user.click(
      screen.getByRole("button", { name: "Show all 1 participant for Pastoral Greetings" }),
    );
    await user.click(
      await screen.findByRole("button", { name: /Add microphone for Abigail/i }),
    );

    const orangeOption = await screen.findByRole("menuitem", { name: /Orange/i });
    expect(
      within(orangeOption).getByText("Assigned: Johnny Mclain"),
    ).toBeInTheDocument();

    const lapelOption = screen.getByRole("menuitem", { name: /Lapel 1/i });
    expect(within(lapelOption).queryByText(/Assigned:/i)).not.toBeInTheDocument();
    expect(within(lapelOption).getByText("Lapel")).toBeInTheDocument();
  });

  it("places microphone controls before IEM controls and uses the equipment accent", async () => {
    const user = userEvent.setup();
    const iem: ServiceEquipment = { id: "iem-one", category: "iem", name: "IEM 1", subtype: "Beltpack" };
    renderRow({
      microphones: [orange],
      iemEquipment: [iem],
      element: { ...baseElement, assignees: [{ id: "a1", name: "Abigail" }] },
    });

    await user.click(screen.getByRole("button", { name: "Show all 1 participant for Pastoral Greetings" }));

    const equipmentButtons = within(
      screen.getByRole("group", { name: "Assignees for Pastoral Greetings" }),
    ).getAllByRole("button", { name: /Add (microphone|IEM) for Abigail/i });
    expect(equipmentButtons).toHaveLength(2);
    expect(equipmentButtons[0]).toHaveAccessibleName(/Add microphone for Abigail/i);
    expect(equipmentButtons[1]).toHaveAccessibleName(/Add IEM for Abigail/i);
    const addIem = equipmentButtons[1];
    expect(addIem).toHaveClass("border-fuchsia-500/40", "text-fuchsia-200");
  });

  it("shows schedule holders and conflict details for IEM assignments", async () => {
    const user = userEvent.setup();
    const iem: ServiceEquipment = { id: "iem-one", category: "iem", name: "IEM 1", subtype: "Beltpack" };
    renderRow({
      iemEquipment: [iem],
      scheduledEquipmentHolders: new Map([[iem.id, ["Jordan Lee"]]]),
      element: { ...baseElement, assignees: [{ id: "a1", name: "Abigail", iemIds: [iem.id] }] },
    });
    await user.click(screen.getByRole("button", { name: "Show all 1 participant for Pastoral Greetings" }));
    expect(screen.getByRole("group", { name: "Assignees for Pastoral Greetings" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "IEM conflict for IEM 1" }));
    expect(await screen.findByText("IEM 1 is scheduled to Jordan Lee.")).toBeInTheDocument();
  });

  it("shows one-assignee IEM-only details in read-only mode", () => {
    const iem: ServiceEquipment = { id: "iem-one", category: "iem", name: "IEM 1", subtype: "Beltpack" };
    renderRow({
      canEdit: false,
      isEditing: false,
      iemEquipment: [iem],
      element: { ...baseElement, assignees: [{ id: "a1", name: "Abigail", iemIds: [iem.id] }] },
    });

    expect(screen.getByRole("group", { name: "Assignees for Pastoral Greetings" })).toHaveTextContent("IEM 1");
  });

  it("shows both microphone and IEM in a read-only assignee row", () => {
    const headset: ServicePlanMicrophone = {
      id: "mic-blue",
      name: "Blue",
      type: "Headset",
      color: "#2563eb",
    };
    const iem: ServiceEquipment = {
      id: "iem-red",
      category: "iem",
      name: "Red",
      subtype: "wireless-beltpack",
      color: "#ef4444",
    };
    renderRow({
      canEdit: false,
      isEditing: false,
      microphones: [headset],
      iemEquipment: [iem],
      element: {
        ...baseElement,
        assignees: [{ id: "a1", name: "Clover Palmer", microphoneIds: [headset.id], iemIds: [iem.id] }],
      },
    });

    const assigneeList = screen.getByRole("group", { name: "Assignees for Pastoral Greetings" });
    expect(within(assigneeList).getByLabelText("Blue · Headset")).toBeInTheDocument();
    expect(within(assigneeList).getByLabelText("Red · Wireless beltpack")).toBeInTheDocument();
  });

  it("keeps a person's IEM on an unassigned slot when they are removed", async () => {
    const user = userEvent.setup();
    const onUpdate = jest.fn();
    const iem: ServiceEquipment = { id: "iem-one", category: "iem", name: "IEM 1", subtype: "Beltpack" };
    renderRow({
      iemEquipment: [iem],
      onUpdate,
      element: { ...baseElement, assignees: [{ id: "a1", name: "Abigail", memberId: "member-a", iemIds: [iem.id] }] },
    });

    await user.click(screen.getByRole("button", { name: /Assignees for Pastoral Greetings/i }));
    await user.click(await screen.findByRole("button", { name: /Remove Abigail from Pastoral Greetings, keeping their equipment/i }));

    expect(onUpdate).toHaveBeenCalledWith({ assignees: [{ id: "a1", iemIds: [iem.id] }] }, undefined);
  });

  it("adds an IEM-only equipment slot in structure mode", async () => {
    const user = userEvent.setup();
    const onUpdate = jest.fn();
    const iem: ServiceEquipment = { id: "iem-one", category: "iem", name: "IEM 1", subtype: "Beltpack" };
    renderRow({ structureOnly: true, iemEquipment: [iem], onUpdate });

    await user.click(screen.getByRole("button", { name: "Add to Pastoral Greetings" }));
    await user.click(await screen.findByRole("menuitem", { name: "IEM 1" }));

    expect(onUpdate).toHaveBeenCalledWith({ assignees: [{ id: expect.any(String), iemIds: [iem.id] }] });
  });

  it.each([
    ["loading", "Checking schedule…"],
    ["unavailable", "Schedule availability couldn't be confirmed"],
  ] as const)("shows %s schedule equipment status in the IEM picker", async (status, message) => {
    const user = userEvent.setup();
    const iem: ServiceEquipment = { id: "iem-one", category: "iem", name: "IEM 1", subtype: "Beltpack" };
    renderRow({
      iemEquipment: [iem],
      scheduledEquipmentStatus: status,
      element: { ...baseElement, assignees: [{ id: "a1", name: "Abigail" }] },
    });

    await user.click(screen.getByRole("button", { name: "Show all 1 participant for Pastoral Greetings" }));
    await user.click(await screen.findByRole("button", { name: /Add IEM for Abigail/i }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    const item = screen.getByRole("menuitem", { name: /IEM 1/ });
    expect(within(item).queryByText(/Available/i)).not.toBeInTheDocument();
  });

  it("keeps conflict details in a popover behind the warning icon", async () => {
    const user = userEvent.setup();
    renderRow({
      microphones: [orange],
      scheduledEquipmentHolders: new Map([["mic-orange", ["Johnny Mclain"]]]),
      element: {
        ...baseElement,
        assignees: [{ id: "a1", name: "Abigail", microphoneIds: ["mic-orange"] }],
      },
    });

    expect(screen.queryByText(/is scheduled to Johnny Mclain/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Microphone conflict for Orange/i }));
    expect(await screen.findByText(/Orange · Handheld is scheduled to Johnny Mclain/i)).toBeInTheDocument();
  });

  it("clears the unassigned slot when its last microphone is removed", async () => {
    const user = userEvent.setup();
    const onUpdate = jest.fn();
    renderRow({
      microphones: [orange],
      onUpdate,
      element: {
        ...baseElement,
        assignees: [{ id: "stand", microphoneIds: ["mic-orange"] }],
      },
    });

    await user.click(
      screen.getByRole("button", { name: /Assignees for Pastoral Greetings/i }),
    );
    await user.click(
      await screen.findByRole("button", { name: /Remove Orange from Unassigned/i }),
    );

    expect(onUpdate).toHaveBeenCalledWith({ assignees: [] }, undefined);
  });
});

// A template's microphone plan arrives as ordered slots with nobody on them.
// Claiming one is just typing a name into it, so the plan hands microphones
// out in order without anything having to redistribute them.
describe("microphone slots from a template", () => {
  const orange: ServicePlanMicrophone = {
    id: "mic-orange",
    name: "Orange",
    type: "Handheld",
    color: "#f97316",
  };
  const choirMics: ServicePlanMicrophone[] = [
    { id: "choir-l", name: "Choir L", type: "Choir", color: "#a78bfa" },
    { id: "choir-r", name: "Choir R", type: "Choir", color: "#a78bfa" },
    { id: "choir-c", name: "Choir C", type: "Choir", color: "#a78bfa" },
  ];

  it("claims a blank equipment slot when a name is entered in compact Led by", async () => {
    const user = userEvent.setup();
    const onUpdate = jest.fn();
    renderRow({
      onUpdate,
      microphones: [orange],
      element: {
        ...baseElement,
        assignees: [{ id: "slot-1", microphoneIds: [orange.id] }],
      },
    });

    const lead = screen.getByPlaceholderText("Led by");
    await user.type(lead, "Jasmine");
    await user.tab();

    expect(onUpdate).toHaveBeenCalledWith({
      assignees: [{ id: "slot-1", name: "Jasmine", microphoneIds: [orange.id] }],
    });
  });

  it("keeps explicit Add person separate from a blank equipment slot", async () => {
    const user = userEvent.setup();
    const onUpdate = jest.fn();
    renderRow({
      onUpdate,
      microphones: [orange],
      element: {
        ...baseElement,
        assignees: [{ id: "slot-1", microphoneIds: [orange.id] }],
      },
    });

    await user.click(screen.getByRole("button", { name: /Assignees for Pastoral Greetings/i }));
    await user.click(await screen.findByRole("button", { name: /Add person/i }));

    expect(onUpdate).toHaveBeenCalledWith({
      assignees: [
        { id: "slot-1", microphoneIds: [orange.id] },
        expect.objectContaining({ id: expect.any(String) }),
      ],
    }, undefined);
  });

  it("offers another person while a microphone slot is unclaimed", async () => {
    const user = userEvent.setup();
    renderRow({
      microphones: [orange],
      element: {
        ...baseElement,
        assignees: [{ id: "slot-1", microphoneIds: ["mic-orange"] }],
      },
    });

    await user.click(
      screen.getByRole("button", { name: /Assignees for Pastoral Greetings/i }),
    );

    // The empty slot is the invitation — a rival blank row would leave the
    // microphone stranded behind it.
    expect(
      await screen.findByRole("button", { name: /Add person/i }),
    ).toBeInTheDocument();
  });

  it("offers another person once every slot is claimed", async () => {
    const user = userEvent.setup();
    renderRow({
      microphones: [orange],
      element: {
        ...baseElement,
        assignees: [
          { id: "slot-1", name: "Pastor John", microphoneIds: ["mic-orange"] },
        ],
      },
    });

    await user.click(
      screen.getByRole("button", { name: /Assignees for Pastoral Greetings/i }),
    );

    expect(
      await screen.findByRole("button", { name: /Add person/i }),
    ).toBeInTheDocument();
  });

  it("hands a whole slot to one group, so a choir gets all three", async () => {
    const user = userEvent.setup();
    const onUpdate = jest.fn();
    renderRow({
      microphones: choirMics,
      onUpdate,
      element: {
        ...baseElement,
        assignees: [
          { id: "slot-1", microphoneIds: ["choir-l", "choir-r", "choir-c"] },
        ],
      },
    });

    await user.click(
      screen.getByRole("button", { name: /Assignees for Pastoral Greetings/i }),
    );
    await user.type(
      await screen.findByRole("textbox", { name: /Assigned to/i }),
      "Chorale",
    );
    await user.tab();

    const [changes] = onUpdate.mock.calls.at(-1) ?? [];
    expect(changes.assignees[0].microphoneIds).toEqual([
      "choir-l",
      "choir-r",
      "choir-c",
    ]);
  });

  it("returns a removed person's microphones to the item instead of deleting them", async () => {
    const user = userEvent.setup();
    const onUpdate = jest.fn();
    renderRow({
      microphones: [orange],
      onUpdate,
      element: {
        ...baseElement,
        assignees: [
          { id: "a1", name: "Pastor John", microphoneIds: ["mic-orange"] },
        ],
      },
    });

    await user.click(
      screen.getByRole("button", { name: "Show all 1 participant for Pastoral Greetings" }),
    );
    await user.click(
      await screen.findByRole("button", {
        name: /Remove Pastor John .*keeping their equipment/i,
      }),
    );

    expect(onUpdate).toHaveBeenCalledWith(
      { assignees: [{ id: "a1", microphoneIds: ["mic-orange"] }] },
      undefined,
    );
  });

  it("flags a person with no microphone only when the item has a plan", () => {
    const { unmount } = renderRow({
      canEdit: false,
      microphones: [orange],
      element: {
        ...baseElement,
        assignees: [
          { id: "a1", name: "Pastor John", microphoneIds: ["mic-orange"] },
          { id: "a2", name: "Sarah Lee" },
        ],
      },
    });

    expect(screen.getByText("No equipment")).toBeInTheDocument();
    unmount();

    // An item with no microphones at all says nothing — most people never
    // need one.
    renderRow({
      canEdit: false,
      microphones: [orange],
      element: {
        ...baseElement,
        assignees: [{ id: "a1", name: "Sarah Lee" }],
      },
    });

    expect(screen.queryByText("No equipment")).not.toBeInTheDocument();
  });
});
