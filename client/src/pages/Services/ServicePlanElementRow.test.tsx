import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DndContext } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import ServicePlanElementRow, {
  elementDndId,
  getServicePlanElementSurfaceClassName,
  richTextOneLinePreview,
  type ServicePlanRoleNoteOption,
} from "./ServicePlanElementRow";
import { plainTextToRichText } from "../../types/richText";
import type {
  ServicePlanElement,
  ServicePlanSongReference,
} from "../../types/servicePlan";

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
    expect(even).toContain("bg-gray-900/50");
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
    roleNoteOptions?: ServicePlanRoleNoteOption[];
    onUpdate?: jest.Mock;
    onViewSongLyrics?: jest.Mock;
    canCreateLibrarySong?: boolean;
    resolvedSongRef?: ServicePlanSongReference;
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
          roleNoteOptions={overrides.roleNoteOptions}
          onViewSongLyrics={overrides.onViewSongLyrics}
          canCreateLibrarySong={overrides.canCreateLibrarySong}
          resolvedSongRef={overrides.resolvedSongRef}
        />
      </SortableContext>
    </DndContext>,
  );
};

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

  it("collapses attachment actions into one Add menu with colored options", async () => {
    const user = userEvent.setup();
    renderRow();

    expect(screen.queryByRole("button", { name: /Add song/i })).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: /Add to Pastoral Greetings/i }),
    );

    expect(await screen.findByRole("menuitem", { name: /^Song$/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /^Scripture$/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /^Note$/i })).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /Team-specific note/i }),
    ).toBeInTheDocument();
  });

  it("adds a role note using the selected Teams position", async () => {
    const user = userEvent.setup();
    const onUpdate = jest.fn();
    renderRow({
      onUpdate,
      roleNoteOptions: [{
        positionId: "camera",
        label: "Media Team · Camera",
        teamId: "media",
        teamName: "Media Team",
      }],
    });

    await user.click(screen.getByRole("button", { name: /Add to Pastoral Greetings/i }));
    await user.click(await screen.findByRole("menuitem", { name: /Role-specific note/i }));

    expect(onUpdate).not.toHaveBeenCalled();

    fireEvent.pointerDown(await screen.findByRole("button", { name: "Media Team · Camera" }));

    expect(onUpdate).toHaveBeenCalledWith({
      teamNotes: [
        expect.objectContaining({
          scope: "role",
          positionId: "camera",
          label: "Media Team · Camera",
          teamId: "media",
          teamName: "Media Team",
        }),
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
            isEditing
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
    ).toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: "Text size" })).toBeInTheDocument();
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
    expect(screen.getByLabelText(/Team note label/i)).toHaveValue("Band");
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
      screen.getByRole("button", { name: /Add to Pastoral Greetings/i }),
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
    expect(screen.getByText("5 min")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /^Title/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Drag to reorder/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Add to Pastoral Greetings/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove note/i })).not.toBeInTheDocument();
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
      screen.getByRole("button", { name: /View lyrics for Living Hope/i }),
    );

    expect(onViewSongLyrics).toHaveBeenCalledWith(songRef);
    expect(onUpdate).not.toHaveBeenCalled();
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

    expect(onUpdate).toHaveBeenCalledWith({ songRef: undefined });
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

    expect(screen.getByText(/Not in library/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /View lyrics/i }),
    ).not.toBeInTheDocument();
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

    expect(screen.queryByText(/Not in library/i)).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: /View lyrics for How Great Is Our God/i }),
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

  it("keeps unmatched songs non-interactive without create access", async () => {
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
      screen.queryByRole("button", { name: /View lyrics for Appeal Song/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Create Appeal Song in the library/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Not in library/i)).toBeInTheDocument();

    await user.click(screen.getByText(/Not in library/i));
    expect(onViewSongLyrics).not.toHaveBeenCalled();
  });

  it("opens create song for an unmatched badge when the operator can create library songs", async () => {
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
      screen.getByRole("button", { name: /Create Appeal Song in the library/i }),
    );

    expect(screen.getByTestId("song-picker")).toHaveAttribute(
      "data-start-in-create",
      "true",
    );
    expect(screen.getByTestId("song-picker")).toHaveAttribute(
      "data-initial-query",
      "Appeal Song",
    );
    expect(screen.getByTestId("song-picker")).toHaveAttribute(
      "data-initial-lyrics",
      "Come as you are",
    );
    expect(onViewSongLyrics).not.toHaveBeenCalled();
  });
});
