import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DndContext } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import ServicePlanElementRow, {
  elementDndId,
  getServicePlanElementSurfaceClassName,
  richTextOneLinePreview,
} from "./ServicePlanElementRow";
import { plainTextToRichText } from "../../types/richText";
import type { ServicePlanElement } from "../../types/servicePlan";

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
    publicSharingEnabled?: boolean;
    isLive?: boolean;
    isManualLive?: boolean;
    canEdit?: boolean;
    isEditing?: boolean;
    hideNotes?: boolean;
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
          onUpdate={jest.fn()}
          onDurationChange={jest.fn()}
          onStartTimeChange={jest.fn()}
          assignedToHistoryValues={[]}
          toneIndex={overrides.toneIndex}
          publicSharingEnabled={overrides.publicSharingEnabled ?? true}
          isServiceDay={overrides.isServiceDay ?? false}
          isLive={overrides.isLive ?? false}
          isManualLive={overrides.isManualLive ?? false}
          onMakePublicLive={jest.fn()}
          onResumePublicSchedule={jest.fn()}
          hideNotes={overrides.hideNotes}
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

  it("shows Make live only on the service day", () => {
    const { rerender } = renderRow({ isServiceDay: false, publicSharingEnabled: true });
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
            publicSharingEnabled
            isServiceDay
            onMakePublicLive={jest.fn()}
            onResumePublicSchedule={jest.fn()}
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
});
