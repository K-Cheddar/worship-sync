import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DndContext } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import ServicePlanElementRow, {
  elementDndId,
  getServicePlanElementSurfaceClassName,
  richTextOneLinePreview,
  type ServicePlanRoleNoteOption,
  type ServicePlanTeamNoteOption,
} from "./ServicePlanElementRow";
import { plainTextToRichText } from "../../types/richText";
import type {
  ServicePlanElement,
  ServicePlanMicrophone,
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
    teamNoteOptions?: ServicePlanTeamNoteOption[];
    roleNoteOptions?: ServicePlanRoleNoteOption[];
    onUpdate?: jest.Mock;
    onViewSongLyrics?: jest.Mock;
    canCreateLibrarySong?: boolean;
    resolvedSongRef?: ServicePlanSongReference;
    microphones?: ServicePlanMicrophone[];
    scheduledMicrophoneHolders?: ReadonlyMap<string, string[]>;
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
          teamNoteOptions={overrides.teamNoteOptions}
          roleNoteOptions={overrides.roleNoteOptions}
          onViewSongLyrics={overrides.onViewSongLyrics}
          canCreateLibrarySong={overrides.canCreateLibrarySong}
          resolvedSongRef={overrides.resolvedSongRef}
          microphones={overrides.microphones}
          scheduledMicrophoneHolders={overrides.scheduledMicrophoneHolders}
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
    renderRow({ teamNoteOptions: [{ teamId: "band", label: "Band" }] });

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

  // Covers the menu-to-popover handoff: picking Scripture should leave the
  // operator able to type a reference straight away. (jsdom can't reproduce the
  // dismissal this flow is prone to — see the `modal` note on the popover.)
  it("hands focus to the reference field when scripture opens from the Add menu", async () => {
    const user = userEvent.setup();
    renderRow();

    await user.click(
      screen.getByRole("button", { name: /Add to Pastoral Greetings/i }),
    );
    await user.click(screen.getByRole("menuitem", { name: /^Scripture$/i }));

    const field = await screen.findByLabelText(/Scripture reference/i);
    expect(field).toHaveFocus();
  });

  // Attaching scripture clears the legacy singular `songRef` as part of moving
  // the element onto the arrays. It has to write `songRefs` in the same update
  // or the merged element ends up with no song at all.
  it("keeps a legacy single song when scripture is attached", async () => {
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
      screen.getByRole("button", { name: /Add to Pastoral Greetings/i }),
    );
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

    await user.click(screen.getByRole("button", { name: /Add to Pastoral Greetings/i }));
    await user.click(await screen.findByRole("menuitem", { name: /Role-specific note/i }));

    expect(onUpdate).not.toHaveBeenCalled();

    fireEvent.pointerDown(await screen.findByRole("button", { name: "Camera" }));

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

  it("keeps every song and scripture attachment visible and removable", async () => {
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
    expect(screen.getByText("Response Song")).toBeInTheDocument();
    expect(screen.getByText("Psalm 100")).toBeInTheDocument();
    expect(screen.getByText("John 3:16")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove song Response Song" }));
    expect(onUpdate).toHaveBeenCalledWith({
      songRef: undefined,
      songRefs: [{ kind: "library", songId: "song-1", songName: "Opening Song" }],
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
      screen.getByRole("button", { name: /View lyrics for Opening Song/i }),
    );
    await user.click(
      screen.getByRole("button", { name: /View lyrics for Response Song/i }),
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
    // Rendered twice by design: the stacked mobile line and the desktop
    // Assigned column.
    expect(screen.getAllByText("Pastor John, Sarah Lee").length).toBeGreaterThan(0);
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
      screen.getByRole("button", { name: /Add microphone for Pastor John/i }),
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
      screen.getByRole("button", { name: /Add microphone for Sarah Lee/i }),
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
      scheduledMicrophoneHolders: new Map([["mic-orange", ["Johnny Mclain"]]]),
      element: {
        ...baseElement,
        assignees: [{ id: "a1", name: "Abigail" }],
      },
    });

    await user.click(
      screen.getByRole("button", { name: /Add microphone for Abigail/i }),
    );

    const orangeOption = await screen.findByRole("menuitem", { name: /Orange/i });
    expect(
      within(orangeOption).getByText("Assigned: Johnny Mclain"),
    ).toBeInTheDocument();

    const lapelOption = screen.getByRole("menuitem", { name: /Lapel 1/i });
    expect(within(lapelOption).queryByText(/Assigned:/i)).not.toBeInTheDocument();
    expect(within(lapelOption).getByText("Lapel")).toBeInTheDocument();
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
      screen.getByRole("button", { name: /Remove Orange from Unassigned/i }),
    );

    expect(onUpdate).toHaveBeenCalledWith({ assignees: [] }, undefined);
  });
});
