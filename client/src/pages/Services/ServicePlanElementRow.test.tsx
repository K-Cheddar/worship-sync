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
  it("alternates row backgrounds without type-colored element borders", () => {
    const even = getServicePlanElementSurfaceClassName({ toneIndex: 0 });
    const odd = getServicePlanElementSurfaceClassName({ toneIndex: 1 });
    expect(even).toContain("bg-gray-900/75");
    expect(odd).toContain("bg-slate-950/90");
    expect(even).not.toContain("border-l-4");
    expect(even).not.toContain("border-l-cyan");
    expect(even).not.toEqual(odd);
  });

  it("marks live rows with a subtle emerald ring only", () => {
    const live = getServicePlanElementSurfaceClassName({
      toneIndex: 1,
      isLive: true,
    });
    expect(live).toContain("ring-emerald-500/40");
    expect(live).toContain("bg-slate-950/90");
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
    hideNotes?: boolean;
  } = {},
) => {
  const element = overrides.element ?? baseElement;
  return render(
    <DndContext onDragEnd={() => { }}>
      <SortableContext
        items={[elementDndId(element.id)]}
        strategy={verticalListSortingStrategy}
      >
        <ServicePlanElementRow
          element={element}
          canEdit={overrides.canEdit ?? true}
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

    await user.click(screen.getByRole("button", { name: /Expand notes/i }));
    expect(await screen.findByRole("textbox", { name: "Notes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bold" })).toBeInTheDocument();

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
});
