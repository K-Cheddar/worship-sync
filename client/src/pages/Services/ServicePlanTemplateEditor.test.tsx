import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ServicePlanTemplateEditor, {
  countServicePlanTemplateItems,
  createServicePlanTemplateDraft,
  type ServicePlanTemplateDraft,
} from "./ServicePlanTemplateEditor";
import { ToastProvider } from "../../context/toastContext";
import {
  deleteServicePlanTemplate,
  getServicePlanMicrophones,
  saveServicePlanTemplate,
  AuthApiError,
} from "../../api/auth";
import { plainTextToRichText } from "../../types/richText";
import type { TeamService } from "../../api/authTypes";
import type {
  ServicePlanSection,
  ServicePlanTemplate,
} from "../../types/servicePlan";

jest.mock("../../api/auth", () => ({
  // The conflict check does `error instanceof AuthApiError`, so the mocked
  // module has to supply a real class or that check throws.
  AuthApiError: class AuthApiError extends Error {
    status?: number;
    details?: unknown;
    constructor(
      message: string,
      options: { status?: number; details?: unknown } = {},
    ) {
      super(message);
      this.name = "AuthApiError";
      this.status = options.status;
      this.details = options.details;
    }
  },
  saveServicePlanTemplate: jest.fn(),
  deleteServicePlanTemplate: jest.fn(),
  getServicePlanMicrophones: jest.fn(),
}));

// The element row pulls the song library in through its picker imports even
// when structure-only mode never opens them.
jest.mock("../../hooks", () => ({
  useSelector: (selector: (state: unknown) => unknown) =>
    selector({
      allDocs: { allSongDocs: [] },
      allItems: { list: [], isAllItemsLoading: false },
    }),
  useDispatch: () => jest.fn(),
}));

const mockSaveServicePlanTemplate = jest.mocked(saveServicePlanTemplate);
const mockDeleteServicePlanTemplate = jest.mocked(deleteServicePlanTemplate);
const mockGetServicePlanMicrophones = jest.mocked(getServicePlanMicrophones);

const microphones = [
  { id: "mic-orange", name: "Orange", type: "Handheld", color: "#f97316" },
];

const multiSlotMicrophones = [
  ...microphones,
  { id: "mic-blue", name: "Blue", type: "Lapel", color: "#3b82f6" },
];

const services: TeamService[] = [
  {
    id: "service-1",
    serviceId: "service-1",
    churchId: "church-1",
    name: "Sabbath Service",
    timerType: "countdown",
    reccurence: "weekly",
  },
  {
    id: "service-2",
    serviceId: "service-2",
    churchId: "church-1",
    name: "Midweek",
    timerType: "countdown",
    reccurence: "weekly",
  },
];

const templateSections: ServicePlanSection[] = [
  {
    id: "section-1",
    name: "Worship",
    elements: [
      {
        id: "element-1",
        type: "free",
        title: plainTextToRichText("Opening prayer"),
        startTime: "10:00",
        durationSeconds: 300,
      },
    ],
  },
];

const savedTemplate: ServicePlanTemplateDraft = {
  templateId: "template-1",
  name: "Standard Sabbath",
  serviceId: "service-1",
  sections: templateSections,
  revision: 4,
};

const serverTemplate = (
  overrides: Partial<ServicePlanTemplate> = {},
): ServicePlanTemplate => ({
  templateId: "template-1",
  churchId: "church-1",
  name: "Standard Sabbath",
  serviceId: "service-1",
  sections: templateSections,
  revision: 5,
  ...overrides,
});

const renderEditor = ({
  template = savedTemplate,
  canEdit = true,
  editorServices = services,
  onBack = jest.fn(),
  onSaved = jest.fn(),
  onDeleted = jest.fn(),
}: {
  template?: ServicePlanTemplateDraft;
  canEdit?: boolean;
  editorServices?: TeamService[];
  onBack?: () => void;
  onSaved?: (template: ServicePlanTemplate) => void;
  onDeleted?: (templateId: string) => void;
} = {}) => {
  const utils = render(
    <ToastProvider>
      <ServicePlanTemplateEditor
        churchId="church-1"
        template={template}
        services={editorServices}
        canEdit={canEdit}
        onBack={onBack}
        onSaved={onSaved}
        onDeleted={onDeleted}
      />
    </ToastProvider>,
  );
  return { ...utils, onBack, onSaved, onDeleted };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSaveServicePlanTemplate.mockResolvedValue({
    success: true,
    template: serverTemplate(),
  });
  mockDeleteServicePlanTemplate.mockResolvedValue({ success: true });
  mockGetServicePlanMicrophones.mockResolvedValue({
    success: true,
    microphones,
    audiences: [],
  });
});

describe("countServicePlanTemplateItems", () => {
  it("totals elements across every section", () => {
    expect(
      countServicePlanTemplateItems([
        { id: "a", name: "A", elements: [] },
        {
          id: "b",
          name: "B",
          elements: [
            { id: "b1", type: "free", title: plainTextToRichText("One") },
            { id: "b2", type: "free", title: plainTextToRichText("Two") },
          ],
        },
      ]),
    ).toBe(2);
  });
});

describe("createServicePlanTemplateDraft", () => {
  it("starts unsaved, unnamed, and with one section to build in", () => {
    const draft = createServicePlanTemplateDraft();
    expect(draft.templateId).toBe("");
    expect(draft.name).toBe("");
    expect(draft.serviceId).toBeUndefined();
    expect(draft.sections).toHaveLength(1);
  });

  it("keeps a service scope when one is supplied", () => {
    expect(createServicePlanTemplateDraft("service-2").serviceId).toBe(
      "service-2",
    );
  });
});

describe("ServicePlanTemplateEditor", () => {
  it("shows the template's structure and scope without entering edit mode", () => {
    renderEditor();

    expect(
      screen.getByRole("heading", { name: /Standard Sabbath/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Preferred for Sabbath Service/)).toBeInTheDocument();
    expect(screen.getByText("Worship")).toBeInTheDocument();
    expect(screen.getByText("Opening prayer")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("opens a brand-new template straight into editing", () => {
    renderEditor({ template: createServicePlanTemplateDraft() });

    expect(screen.getByRole("heading", { name: "Edit template details" })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Template name/i)).toBeInTheDocument();
  });

  it("edits standing assignees from a side sheet", async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(
      screen.getByRole("button", { name: "Add to Opening prayer" }),
    );
    const menu = await screen.findByRole("menu");
    await user.hover(within(menu).getByRole("menuitem", { name: /Microphone/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Orange/i }));

    expect(
      screen.getByRole("button", { name: "Microphone plan for Opening prayer" }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Microphone plan for Opening prayer" }),
    );
    expect(
      await screen.findByPlaceholderText("Assignees"),
    ).toBeInTheDocument();
  });

  it("saves a slot's standing group label with the template", async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(
      screen.getByRole("button", { name: "Add to Opening prayer" }),
    );
    const menu = await screen.findByRole("menu");
    await user.hover(within(menu).getByRole("menuitem", { name: /Microphone/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Orange/i }));

    await user.click(
      screen.getByRole("button", { name: "Microphone plan for Opening prayer" }),
    );
    await user.type(
      await screen.findByPlaceholderText("Assignees"),
      "Audience",
    );

    await waitFor(() => expect(mockSaveServicePlanTemplate).toHaveBeenCalled(), {
      timeout: 2_500,
    });
    const [, payload] = mockSaveServicePlanTemplate.mock.calls.at(-1) ?? [];
    expect(payload?.sections[0].elements[0].assignees[0]).toMatchObject({
      name: "Audience",
      microphoneIds: ["mic-orange"],
    });
  });

  it("offers notes but not songs or scripture on an item", async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(
      screen.getByRole("button", { name: "Add to Opening prayer" }),
    );

    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Note" })).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: "Song" })).not.toBeInTheDocument();
    expect(
      within(menu).queryByRole("menuitem", { name: "Scripture" }),
    ).not.toBeInTheDocument();
  });

  // Dropping an archived service from the picker used to leave the select on
  // its placeholder and the header reading "Available for any service", while
  // the saved serviceId stayed put — so the template kept sorting first for a
  // service the operator had been told it no longer targeted.
  it("still shows a scope pointing at an archived service", async () => {
    const user = userEvent.setup();
    const archivedServices: TeamService[] = [
      { ...services[0], archivedAt: "2026-01-01T00:00:00.000Z" },
      services[1],
    ];
    renderEditor({ editorServices: archivedServices });

    // The header line also carries the section/item counts, so match the
    // paragraph rather than an exact string.
    expect(
      screen.getByText(
        (_content, element) =>
          element?.tagName === "P"
          && (element.textContent || "").includes(
            "Preferred for Sabbath Service (archived)",
          ),
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Edit details" }));
    expect(screen.getByLabelText(/^Preferred for/i)).toHaveTextContent(
      "Sabbath Service (archived)",
    );
  });

  it("offers only active services as new scope choices", async () => {
    const user = userEvent.setup();
    const archivedServices: TeamService[] = [
      services[0],
      { ...services[1], archivedAt: "2026-01-01T00:00:00.000Z" },
    ];
    renderEditor({ editorServices: archivedServices });

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Edit details" }));
    await user.click(screen.getByLabelText(/^Preferred for/i));

    expect(
      await screen.findByRole("option", { name: "Sabbath Service" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Any service" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Midweek/i })).not.toBeInTheDocument();
  });

  // Unlike songs and assignments, a microphone plan repeats every week, so a
  // template is exactly where an operator should be able to set one up.
  it("attaches a microphone to an item and saves it with the template", async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(
      screen.getByRole("button", { name: "Add to Opening prayer" }),
    );

    const menu = await screen.findByRole("menu");
    // Radix submenus open on hover, and their items only select via a raw
    // click event here — userEvent's click doesn't reach them in jsdom.
    await user.hover(within(menu).getByRole("menuitem", { name: /Microphone/i }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Orange · Handheld/i }),
    );

    // A template has no people: its rows are the ordered microphone plan that
    // a dated plan hands out, so they read as slots rather than as gaps.
    await user.click(
      screen.getByRole("button", { name: "Microphone plan for Opening prayer" }),
    );
    expect(
      await within(screen.getByRole("dialog")).findByRole("button", {
        name: /Remove Orange from Slot 1/i,
      }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("dialog")).getByRole("group", {
        name: /Microphone plan for Opening prayer/i,
      }),
    ).toBeInTheDocument();
    await waitFor(() => expect(mockSaveServicePlanTemplate).toHaveBeenCalled(), {
      timeout: 2_500,
    });
    const [, payload] = mockSaveServicePlanTemplate.mock.calls.at(-1) ?? [];
    const [assignee] = payload?.sections[0].elements[0].assignees ?? [];
    expect(assignee.microphoneIds).toEqual(["mic-orange"]);
    expect(assignee.name).toBeUndefined();
  });

  it("adds each template microphone as its own ordered slot", async () => {
    const user = userEvent.setup();
    mockGetServicePlanMicrophones.mockResolvedValue({
      success: true,
      microphones: multiSlotMicrophones,
      audiences: [],
    });
    renderEditor();
    await user.click(screen.getByRole("button", { name: "Edit" }));

    await user.click(
      screen.getByRole("button", { name: "Add to Opening prayer" }),
    );
    let menu = await screen.findByRole("menu");
    await user.hover(within(menu).getByRole("menuitem", { name: /Microphone/i }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Orange \u00b7 Handheld/i }),
    );

    // Selecting a microphone keeps this submenu open, so the next available
    // microphone can become the next slot without reopening the whole menu.
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Blue \u00b7 Lapel/i }),
    );

    await user.click(
      screen.getByRole("button", { name: "Microphone plan for Opening prayer" }),
    );
    expect(
      await within(screen.getByRole("dialog")).findByRole("button", {
        name: /Remove Orange from Slot 1/i,
      }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /Remove Blue from Slot 2/i,
      }),
    ).toBeInTheDocument();
    await waitFor(() => expect(mockSaveServicePlanTemplate).toHaveBeenCalled(), {
      timeout: 2_500,
    });
    const [, payload] = mockSaveServicePlanTemplate.mock.calls.at(-1) ?? [];
    expect(payload?.sections[0].elements[0].assignees).toEqual([
      expect.objectContaining({ microphoneIds: ["mic-orange"] }),
      expect.objectContaining({ microphoneIds: ["mic-blue"] }),
    ]);
  });

  it("autosaves the edited name, scope and sections against the same template", async () => {
    const user = userEvent.setup();
    const { onSaved } = renderEditor();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Edit details" }));

    const nameField = screen.getByLabelText(/^Template name/i);
    await user.clear(nameField);
    await user.type(nameField, "Communion Sabbath");

    await waitFor(() => expect(mockSaveServicePlanTemplate).toHaveBeenCalled(), {
      timeout: 2_500,
    });
    expect(mockSaveServicePlanTemplate).toHaveBeenLastCalledWith("church-1", {
      name: "Communion Sabbath",
      serviceId: "service-1",
      sections: templateSections,
      templateId: "template-1",
      // Sent so the server rejects rather than overwrites a concurrent edit.
      baseRevision: 4,
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(await screen.findByText("Synced")).toBeInTheDocument();
  });

  // This editor deliberately never feeds `onSaved` back into its `template`
  // prop, so that prop keeps reporting revision 4 forever. Autosave has to keep
  // the revision the server handed back, or every edit past the first one is a
  // guaranteed conflict.
  it("saves against the revision the server returned, not the stale prop", async () => {
    const user = userEvent.setup();
    mockSaveServicePlanTemplate.mockImplementation(async (_churchId, payload) => ({
      success: true,
      template: serverTemplate({ revision: (payload.baseRevision ?? 0) + 1 }),
    }));
    renderEditor();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Edit details" }));

    const nameField = screen.getByLabelText(/^Template name/i);
    await user.type(nameField, " A");
    await waitFor(() => expect(mockSaveServicePlanTemplate).toHaveBeenCalledTimes(1), {
      timeout: 2_500,
    });
    expect(await screen.findByText("Synced")).toBeInTheDocument();

    await user.type(nameField, "B");
    await waitFor(() => expect(mockSaveServicePlanTemplate).toHaveBeenCalledTimes(2), {
      timeout: 2_500,
    });
    expect(mockSaveServicePlanTemplate.mock.calls[0][1].baseRevision).toBe(4);
    expect(mockSaveServicePlanTemplate.mock.calls[1][1].baseRevision).toBe(5);
  });

  it("drops the service scope when the template is moved to Any service", async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Edit details" }));

    await user.click(screen.getByRole("combobox", { name: /Preferred for/i }));
    await user.click(await screen.findByRole("option", { name: "Any service" }));

    await waitFor(() => expect(mockSaveServicePlanTemplate).toHaveBeenCalled(), {
      timeout: 2_500,
    });
    expect(
      mockSaveServicePlanTemplate.mock.calls.at(-1)?.[1],
    ).not.toHaveProperty("serviceId");
  });

  it("holds off creating anything until the new template has a name", async () => {
    const user = userEvent.setup();
    renderEditor({ template: createServicePlanTemplateDraft() });

    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: "Add section" }));
    expect(
      screen.getByText("Give this template a name to start saving it."),
    ).toBeInTheDocument();
    expect(mockSaveServicePlanTemplate).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Edit details" }));
    await user.type(screen.getByLabelText(/^Template name/i), "Fresh start");

    await waitFor(() => expect(mockSaveServicePlanTemplate).toHaveBeenCalled(), {
      timeout: 2_500,
    });
    // Created, not overwritten — there is no id to send yet.
    expect(
      mockSaveServicePlanTemplate.mock.calls.at(-1)?.[1],
    ).not.toHaveProperty("templateId");
  });

  it("targets the id the server minted once a new template has been created", async () => {
    const user = userEvent.setup();
    renderEditor({ template: createServicePlanTemplateDraft() });

    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: "Edit details" }));
    await user.type(screen.getByLabelText(/^Template name/i), "Fresh start");
    await waitFor(() => expect(mockSaveServicePlanTemplate).toHaveBeenCalled(), {
      timeout: 2_500,
    });

    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: "Add section" }));

    await waitFor(
      () => expect(mockSaveServicePlanTemplate.mock.calls.length).toBeGreaterThan(1),
      { timeout: 2_500 },
    );
    expect(mockSaveServicePlanTemplate.mock.calls.at(-1)?.[1].templateId).toBe(
      "template-1",
    );
  });

  it("surfaces a concurrent edit as a conflict instead of overwriting it", async () => {
    const user = userEvent.setup();
    const conflict = new AuthApiError("Conflict", {
      status: 409,
      details: { template: serverTemplate({ name: "Their version", revision: 9 }) },
    });
    mockSaveServicePlanTemplate.mockRejectedValueOnce(conflict);

    renderEditor();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Edit details" }));
    await user.type(screen.getByLabelText(/^Template name/i), "!");

    expect(
      await screen.findByText("Template changed elsewhere", undefined, {
        timeout: 2_500,
      }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: "Reload latest" }));

    await user.click(screen.getByRole("button", { name: "Edit details" }));
    expect(screen.getByLabelText(/^Template name/i)).toHaveValue(
      "Their version",
    );
    expect(await screen.findByText("Synced")).toBeInTheDocument();
  });

  it("leaves without prompting, since edits are already saving", async () => {
    const user = userEvent.setup();
    const { onBack } = renderEditor();

    await user.click(screen.getByRole("button", { name: "Back to Templates" }));

    expect(onBack).toHaveBeenCalled();
  });

  it("deletes only after the confirmation is accepted", async () => {
    const user = userEvent.setup();
    const { onDeleted } = renderEditor();

    await user.click(screen.getByRole("button", { name: "Template actions" }));
    await user.click(
      await screen.findByRole("menuitem", { name: /Delete template/ }),
    );
    expect(mockDeleteServicePlanTemplate).not.toHaveBeenCalled();

    await user.click(await screen.findByRole("button", { name: "Delete Forever" }));

    await waitFor(() =>
      expect(mockDeleteServicePlanTemplate).toHaveBeenCalledWith(
        "church-1",
        "template-1",
      ),
    );
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith("template-1"));
  });

  it("hides every editing control from a viewer and never writes", async () => {
    renderEditor({ canEdit: false });

    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    // No autosave status either — a viewer has nothing being saved.
    expect(screen.queryByText("Synced")).not.toBeInTheDocument();
    expect(screen.getByText("Opening prayer")).toBeInTheDocument();

    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(mockSaveServicePlanTemplate).not.toHaveBeenCalled();
  });
});
