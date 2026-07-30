import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ContextType } from "react";
import ServicePlanEditor from "./ServicePlanEditor";
import { GlobalInfoContext } from "../../context/globalInfo";
import { ToastProvider } from "../../context/toastContext";
import { createMockGlobalContext } from "../../test/mocks";
import {
  listServicePlanTemplates,
  saveServicePlanTemplate,
  getServicePlan,
  getServicePlanAssignmentHistory,
  publishServicePlan,
  saveServicePlan,
  saveServicePlanAssignmentHistory,
  unpublishServicePlan,
  updateServicePlanPublicLive,
} from "../../api/auth";
import { getServicePlanningImportDataFromUrl } from "../../containers/Overlays/eventParser";
import type {
  TeamRosterMember,
  TeamScheduleOccurrence,
  TeamService,
} from "../../api/authTypes";
import type { ServicePlan } from "../../types/servicePlan";
import { plainTextToRichText } from "../../types/richText";
import { calendarDateInTimeZone } from "../../utils/teamScheduleOccurrences";

jest.mock("../../api/auth", () => ({
  // Autosave's conflict check does `error instanceof AuthApiError`, so the
  // mocked module has to supply a real class or that check throws.
  AuthApiError: class AuthApiError extends Error {
    status?: number;
    details?: unknown;
  },
  listServicePlanTemplates: jest.fn(),
  saveServicePlanTemplate: jest.fn(),
  deleteServicePlanTemplate: jest.fn(),
  getServicePlan: jest.fn(),
  getServicePlanAssignmentHistory: jest.fn(),
  publishServicePlan: jest.fn(),
  saveServicePlan: jest.fn(),
  saveServicePlanAssignmentHistory: jest.fn(),
  unpublishServicePlan: jest.fn(),
  updateServicePlanPublicLive: jest.fn(),
}));

jest.mock("../../containers/Overlays/eventParser", () => ({
  getServicePlanningImportDataFromUrl: jest.fn(),
}));

// The library picker reads the song library via useSelector.
jest.mock("../../hooks", () => ({
  useSelector: (selector: (state: unknown) => unknown) =>
    selector({ allDocs: { allSongDocs: [] } }),
  useDispatch: () => jest.fn(),
}));

const mockListServicePlanTemplates = jest.mocked(listServicePlanTemplates);
const mockSaveServicePlanTemplate = jest.mocked(saveServicePlanTemplate);
const mockGetServicePlan = jest.mocked(getServicePlan);
const mockGetServicePlanAssignmentHistory = jest.mocked(getServicePlanAssignmentHistory);
const mockSaveServicePlanAssignmentHistory = jest.mocked(saveServicePlanAssignmentHistory);
const mockGetServicePlanningImportDataFromUrl = jest.mocked(
  getServicePlanningImportDataFromUrl,
);
const mockPublishServicePlan = jest.mocked(publishServicePlan);
const mockSaveServicePlan = jest.mocked(saveServicePlan);
const mockUnpublishServicePlan = jest.mocked(unpublishServicePlan);
const mockUpdateServicePlanPublicLive = jest.mocked(updateServicePlanPublicLive);

const oneTimeService: TeamService = {
  id: "service-1",
  serviceId: "service-1",
  churchId: "church-1",
  name: "Easter Sunday",
  timerType: "countdown",
  reccurence: "one_time",
  dateTimeISO: "2026-07-26T14:00:00.000Z",
};

// The occurrence is now chosen up front by the Plans list (TeamsPlansPage) and
// handed to the editor as a prop — this component no longer picks it itself.
const occurrence: TeamScheduleOccurrence = {
  occurrenceId: "service-1@2026-07-26T14:00:00.000Z",
  serviceId: "service-1",
  name: "Easter Sunday",
  startsAt: "2026-07-26T14:00:00.000Z",
};

const renderEditor = ({
  service = oneTimeService,
  occurrence: occurrenceProp = occurrence,
  members = [],
  canEdit = true,
  onBack,
  planNavigation,
}: {
  service?: TeamService;
  occurrence?: TeamScheduleOccurrence;
  members?: TeamRosterMember[];
  canEdit?: boolean;
  onBack?: () => void;
  planNavigation?: {
    onPrevious?: () => void;
    onNext?: () => void;
  };
} = {}) =>
  render(
    <GlobalInfoContext.Provider
      value={
        createMockGlobalContext({ churchId: "church-1" }) as ContextType<
          typeof GlobalInfoContext
        >
      }
    >
      <ToastProvider>
        <ServicePlanEditor
          service={service}
          occurrence={occurrenceProp}
          members={members}
          canEdit={canEdit}
          onBack={onBack}
          planNavigation={planNavigation}
        />
      </ToastProvider>
    </GlobalInfoContext.Provider>,
  );

describe("ServicePlanEditor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetServicePlan.mockResolvedValue({ success: true, servicePlan: null });
    mockListServicePlanTemplates.mockResolvedValue({ success: true, templates: [] });
    mockSaveServicePlanTemplate.mockResolvedValue({
      success: true,
      template: {} as never,
    });
    mockGetServicePlanAssignmentHistory.mockResolvedValue({ success: true, values: [] });
    mockSaveServicePlanAssignmentHistory.mockResolvedValue({ success: true, values: [] });
    mockSaveServicePlan.mockImplementation(async (_churchId, planKey, body) => ({
      success: true,
      servicePlan: {
        planId: `church-1::${planKey}`,
        churchId: "church-1",
        planKey,
        ...body,
      } as ServicePlan,
    }));
    mockPublishServicePlan.mockResolvedValue({
      success: true,
      publicUrl: "https://www.worshipsync.net/#/services/share-token",
      servicePlan: {} as ServicePlan,
    });
    mockUnpublishServicePlan.mockResolvedValue({
      success: true,
      servicePlan: {} as ServicePlan,
    });
    mockUpdateServicePlanPublicLive.mockResolvedValue({
      success: true,
      servicePlan: {} as ServicePlan,
    });
  });

  it("offers to start from scratch for an occurrence with no plan yet", async () => {
    renderEditor();
    expect(
      await screen.findByRole("button", { name: /Start from scratch/i }),
    ).toBeInTheDocument();
  });

  it("shows previous and next plan controls in the chrome when navigation is provided", async () => {
    const user = userEvent.setup();
    const onPrevious = jest.fn();
    const onNext = jest.fn();
    const onBack = jest.fn();

    renderEditor({
      onBack,
      planNavigation: { onPrevious, onNext },
    });

    expect(
      await screen.findByRole("button", { name: /Back to Plans/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /Plan navigation/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Previous plan/i }));
    await user.click(screen.getByRole("button", { name: /Next plan/i }));
    expect(onPrevious).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("disables a missing previous or next plan neighbor in the chrome", async () => {
    renderEditor({
      onBack: jest.fn(),
      planNavigation: { onNext: jest.fn() },
    });

    expect(
      await screen.findByRole("button", { name: /Previous plan/i }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: /Next plan/i })).toBeEnabled();
  });

  it("autosaves a new draft after the editor pauses", async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(await screen.findByRole("button", { name: /Start from scratch/i }));

    await waitFor(
      () => {
        expect(mockSaveServicePlan).toHaveBeenCalledWith(
          "church-1",
          "service-1@2026-07-26",
          expect.objectContaining({ baseRevision: 0 }),
        );
      },
      { timeout: 2_500 },
    );
  });

  it("applies a saved template to an empty plan", async () => {
    mockListServicePlanTemplates.mockResolvedValue({
      success: true,
      templates: [
        {
          templateId: "tpl-1",
          churchId: "church-1",
          name: "Standard Sabbath",
          serviceId: "service-1",
          sections: [
            {
              id: "tpl-section",
              name: "Worship",
              elements: [
                {
                  id: "tpl-el",
                  type: "free",
                  title: plainTextToRichText("Call to Worship"),
                  durationMinutes: 4,
                },
              ],
            },
          ],
        },
      ],
    });

    const user = userEvent.setup();
    renderEditor();

    await user.click(
      await screen.findByRole("button", { name: /Apply a template/i }),
    );
    await user.click(
      await screen.findByRole("button", { name: /Apply template Standard Sabbath/i }),
    );

    expect(await screen.findByLabelText(/^Title/i)).toHaveValue(
      "Call to Worship",
    );

    // Applying a template is persisted automatically after the editing pause.
    await waitFor(
      () => expect(mockSaveServicePlan).toHaveBeenCalledTimes(1),
      { timeout: 2_500 },
    );
    const [, , body] = mockSaveServicePlan.mock.calls[0];
    expect(body.sections[0].name).toBe("Worship");
    expect(body.sections[0].elements[0].durationMinutes).toBe(4);
    // Re-keyed on apply so two plans from one template never share ids.
    expect(body.sections[0].id).not.toBe("tpl-section");
    expect(body.sections[0].elements[0].id).not.toBe("tpl-el");
  });

  it("saves the current plan's structure as a template without its week-specific picks", async () => {
    mockGetServicePlan.mockResolvedValue({
      success: true,
      servicePlan: {
        planId: "church-1::service-1@2026-07-26",
        churchId: "church-1",
        planKey: "service-1@2026-07-26",
        serviceId: "service-1",
        date: "2026-07-26",
        name: "Easter Sunday",
        sections: [
          {
            id: "section-1",
            name: "Worship",
            elements: [
              {
                id: "el-1",
                type: "song",
                title: plainTextToRichText("Living Hope"),
                assignedName: "Jane Doe",
                songRef: {
                  kind: "library",
                  songId: "song-1",
                  songName: "Living Hope",
                },
              },
            ],
          },
        ],
      },
    });

    const user = userEvent.setup();
    renderEditor();

    await user.click(await screen.findByRole("button", { name: /Plan actions/i }));
    await user.click(
      await screen.findByRole("menuitem", { name: /Save as template/i }),
    );
    await user.type(
      await screen.findByLabelText(/Template name/i),
      "Standard Sabbath",
    );
    await user.click(screen.getByRole("button", { name: /^Save template$/i }));

    await waitFor(() => expect(mockSaveServicePlanTemplate).toHaveBeenCalled());
    const [, body] = mockSaveServicePlanTemplate.mock.calls[0];
    expect(body.name).toBe("Standard Sabbath");
    expect(body.serviceId).toBe("service-1");
    expect(body.sections[0].name).toBe("Worship");
    // Structure only — the week's song and assignment must not travel.
    expect(body.sections[0].elements[0].songRef).toBeUndefined();
    expect(body.sections[0].elements[0].assignedName).toBeUndefined();
  });

  it("imports a plan from a Service Planning URL into editable sections", async () => {
    mockGetServicePlanningImportDataFromUrl.mockResolvedValue({
      planLabel: "Sunday, Jul 26",
      sections: [
        {
          sectionName: "Worship",
          rows: [{ elementType: "Song", title: "Great Are You Lord", ledBy: "Jane" }],
        },
      ],
      teamAssignments: [],
    });

    const user = userEvent.setup();
    renderEditor();

    await user.click(
      await screen.findByRole("button", { name: /Import from Service Planning/i }),
    );
    await user.type(
      screen.getByLabelText(/Planning URL/i),
      "https://services.planningcenteronline.com/plans/123",
    );
    await user.click(screen.getByRole("button", { name: /^Import plan$/i }));

    await waitFor(() => {
      expect(mockGetServicePlanningImportDataFromUrl).toHaveBeenCalledWith(
        "https://services.planningcenteronline.com/plans/123",
      );
    });
    // The name is editable inline on the row itself — no expanding needed.
    expect(await screen.findByLabelText(/^Title/i)).toHaveValue(
      "Great Are You Lord",
    );

    await waitFor(() => {
      expect(mockSaveServicePlan).toHaveBeenCalledTimes(1);
    }, { timeout: 2_500 });
    const [, , body] = mockSaveServicePlan.mock.calls[0];
    expect(body.sourceImport).toEqual({
      source: "servicePlanning",
      sourceUrl: "https://services.planningcenteronline.com/plans/123",
      loadedAt: expect.any(String),
      planLabel: "Sunday, Jul 26",
    });
    // Regression: the plan name must track the occurrence being planned
    // (Easter Sunday), not the imported source's own plan label — the two
    // can describe entirely different dates when a template plan is reused.
    expect(body.name).toBe("Easter Sunday");
    // Regression: imported elements previously landed with no start time at
    // all (only "Start from scratch" seeded the timing anchor).
    expect(body.sections[0].elements[0].startTime).toBeTruthy();
  });

  it("suggests roster members and past free-text names for Assigned to, not roster-linked", async () => {
    const janeDoe: TeamRosterMember = {
      memberId: "member-1",
      churchId: "church-1",
      firstName: "Jane",
      lastName: "Doe",
      positionIds: [],
      blockoutDates: [],
    };
    mockGetServicePlanAssignmentHistory.mockResolvedValue({
      success: true,
      values: ["Guest Speaker Sam"],
    });

    const user = userEvent.setup();
    renderEditor({ members: [janeDoe] });

    await user.click(
      await screen.findByRole("button", { name: /Start from scratch/i }),
    );
    await user.click(screen.getByRole("button", { name: /Add element/i }));

    const assignedToField = await screen.findByRole("textbox", { name: /Assigned to/i });
    await user.click(assignedToField);

    expect(await screen.findByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByText("Guest Speaker Sam")).toBeInTheDocument();

    // Confirms this is plain free-text suggestion, not roster-linked: typing
    // a name that isn't a suggestion is accepted as-is.
    await user.type(assignedToField, "Someone New");
    expect(assignedToField).toHaveValue("Someone New");
  });

  it("builds a plan from scratch: add a section, add an element, edit its title, and autosave", async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(
      await screen.findByRole("button", { name: /Start from scratch/i }),
    );

    // Seeded with one default section already.
    await user.click(screen.getByRole("button", { name: /Add element/i }));
    await user.type(screen.getByLabelText(/^Title/i), "Great Are You Lord");

    await waitFor(() => {
      expect(mockSaveServicePlan).toHaveBeenCalledTimes(1);
    }, { timeout: 2_500 });
    const [churchId, planKey, body] = mockSaveServicePlan.mock.calls[0];
    expect(churchId).toBe("church-1");
    expect(planKey).toBe("service-1@2026-07-26");
    expect(body.serviceId).toBe("service-1");
    expect(body.sections[0].elements[0].title).toEqual(
      plainTextToRichText("Great Are You Lord"),
    );
    // The first element added to an empty plan seeds the timing anchor from
    // the occurrence's own start time (14:00 UTC on 2026-07-26).
    expect(body.sections[0].elements[0].startTime).toBeTruthy();
  });

  it("cascades duration edits forward and start-time edits into the previous item's duration", async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(
      await screen.findByRole("button", { name: /Start from scratch/i }),
    );

    await user.click(screen.getByRole("button", { name: /Add element/i }));
    await user.click(screen.getByRole("button", { name: /Add element/i }));

    // fireEvent.change (not userEvent.clear/type) — number inputs behave
    // unpredictably under userEvent's per-keystroke typing simulation in jsdom.
    // Per-element fields are labeled exactly "Time"/"Duration" —
    // anchored regexes so this doesn't also match the plan-level
    // "Service start time" field, which contains the same substring.
    const durationInputs = screen.getAllByLabelText(/^Duration/i);
    fireEvent.change(durationInputs[0], { target: { value: "15" } });
    // Wait for the controlled duration field to commit before blur — otherwise
    // onBlur still sees the previous durationText from the render closure.
    await waitFor(() => {
      expect(durationInputs[0]).toHaveValue("15");
    });
    fireEvent.blur(durationInputs[0]);

    const startTimeInputs = screen.getAllByLabelText(/^Time/i);
    await waitFor(() => {
      expect((startTimeInputs[0] as HTMLInputElement).value).toBeTruthy();
    });
    // TimePicker displays 12-hour "hh:mm AA" (zero-padded hour) while the plan
    // stores 24-hour, so the expected cascade result matches the display format.
    // Derive from the first field so this stays valid across local timezones
    // (occurrence start is absolute UTC; display is local).
    const firstStart = (startTimeInputs[0] as HTMLInputElement).value;
    const [, rawHour, rawMinute, meridiem] =
      firstStart.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i) || [];
    const hour24 =
      (Number(rawHour) % 12) + (meridiem.toUpperCase() === "PM" ? 12 : 0);
    const totalMinutes = hour24 * 60 + Number(rawMinute) + 15;
    const nextHour24 = Math.floor(totalMinutes / 60) % 24;
    const nextHour12 = nextHour24 % 12 === 0 ? 12 : nextHour24 % 12;
    const expectedSecondStart = `${String(nextHour12).padStart(2, "0")}:${String(
      totalMinutes % 60,
    ).padStart(2, "0")} ${nextHour24 >= 12 ? "PM" : "AM"}`;
    await waitFor(() => {
      expect(
        (screen.getAllByLabelText(/^Time/i)[1] as HTMLInputElement).value,
      ).toBe(expectedSecondStart);
    });
  });

  it("loads an existing plan for the occurrence instead of offering to start from scratch", async () => {
    mockGetServicePlan.mockResolvedValue({
      success: true,
      servicePlan: {
        planId: "church-1::service-1@2026-07-26",
        churchId: "church-1",
        planKey: "service-1@2026-07-26",
        serviceId: "service-1",
        date: "2026-07-26",
        name: "Easter Sunday",
        sections: [
          {
            id: "section-1",
            name: "Worship",
            elements: [
              { id: "el-1", type: "song", title: plainTextToRichText("Living Hope") },
            ],
          },
        ],
      },
    });

    renderEditor();

    // Existing plans open in compact view mode — titles are text, not inputs.
    expect(await screen.findByText("Living Hope")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /^Title/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Edit$/i })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Start from scratch/i }),
    ).not.toBeInTheDocument();
  });

  it("offers starter actions again when an existing plan has no sections left", async () => {
    mockGetServicePlan.mockResolvedValue({
      success: true,
      servicePlan: {
        planId: "church-1::service-1@2026-07-26",
        churchId: "church-1",
        planKey: "service-1@2026-07-26",
        serviceId: "service-1",
        date: "2026-07-26",
        name: "Easter Sunday",
        sections: [],
      },
    });

    renderEditor();

    expect(
      await screen.findByRole("button", { name: /Start from scratch/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Import from Service Planning/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Apply a template/i }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/Plan name/i)).not.toBeInTheDocument();
  });

  it("returns to starter actions after the last section is removed", async () => {
    mockGetServicePlan.mockResolvedValue({
      success: true,
      servicePlan: {
        planId: "church-1::service-1@2026-07-26",
        churchId: "church-1",
        planKey: "service-1@2026-07-26",
        serviceId: "service-1",
        date: "2026-07-26",
        name: "Easter Sunday",
        sections: [
          {
            id: "section-1",
            name: "Worship",
            elements: [],
          },
        ],
      },
    });

    const user = userEvent.setup();
    renderEditor();

    await user.click(await screen.findByRole("button", { name: /^Edit$/i }));
    expect(await screen.findByDisplayValue("Worship")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: /Remove section Worship/i }),
    );

    expect(
      await screen.findByRole("button", { name: /Start from scratch/i }),
    ).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Worship")).not.toBeInTheDocument();
  });

  it("keeps the draft editor after starting from scratch on a cleared plan", async () => {
    mockGetServicePlan.mockResolvedValue({
      success: true,
      servicePlan: {
        planId: "church-1::service-1@2026-07-26",
        churchId: "church-1",
        planKey: "service-1@2026-07-26",
        serviceId: "service-1",
        date: "2026-07-26",
        name: "Easter Sunday",
        sections: [],
      },
    });

    const user = userEvent.setup();
    renderEditor();

    await user.click(
      await screen.findByRole("button", { name: /Start from scratch/i }),
    );

    expect(await screen.findByLabelText(/Plan name/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Start from scratch/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Add section/i }),
    ).toBeInTheDocument();
  });

  it("collapses an existing element to a single line with compact chips, and expands/collapses on click", async () => {
    mockGetServicePlan.mockResolvedValue({
      success: true,
      servicePlan: {
        planId: "church-1::service-1@2026-07-26",
        churchId: "church-1",
        planKey: "service-1@2026-07-26",
        serviceId: "service-1",
        date: "2026-07-26",
        name: "Easter Sunday",
        sections: [
          {
            id: "section-1",
            name: "Worship",
            elements: [
              {
                id: "el-1",
                type: "song",
                title: plainTextToRichText("Living Hope"),
                startTime: "10:00",
                durationMinutes: 5,
                assignedName: "Jane Doe",
                notes: plainTextToRichText("Slow the tempo down."),
              },
            ],
          },
        ],
      },
    });

    const user = userEvent.setup();
    renderEditor();

    await user.click(await screen.findByRole("button", { name: /^Edit$/i }));

    // Name, time, duration and assignee are all editable on the one-line row
    // itself — nothing has to be expanded to change them.
    expect(await screen.findByLabelText(/^Title/i)).toHaveValue("Living Hope");
    expect(screen.getByLabelText(/^Time/i)).toHaveValue("10:00 AM");
    expect(screen.getByLabelText(/^Duration/i)).toHaveValue("5 min");
    expect(screen.getByLabelText(/^Assigned to/i)).toHaveValue("Jane Doe");
    await user.type(screen.getByLabelText(/^Title/i), "!");
    expect(screen.getByLabelText(/^Title/i)).toHaveValue("Living Hope!");

    // Song, scripture, and notes stay on the row via a single Add menu.
    // Existing notes start minimized to one preview line — expand to edit.
    // AnimateCollapse keeps the editor mounted while minimized, so prefer roles
    // over getByText (preview and hidden editor both contain the note text).
    expect(
      await screen.findByRole("button", { name: /Expand notes/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Notes" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Expand notes/i }));
    expect(await screen.findByRole("textbox", { name: "Notes" })).toHaveTextContent(
      "Slow the tempo down.",
    );
    expect(screen.queryByRole("button", { name: /Add song/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add scripture/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add note/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Add to Living Hope/i }));
    expect(await screen.findByRole("menuitem", { name: /^Song$/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /^Scripture$/i })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /^Note$/i })).not.toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /Team-specific note/i }),
    ).toBeInTheDocument();
  });

  it("hides notes from the plan view without changing saved content", async () => {
    mockGetServicePlan.mockResolvedValue({
      success: true,
      servicePlan: {
        planId: "church-1::service-1@2026-07-26",
        churchId: "church-1",
        planKey: "service-1@2026-07-26",
        serviceId: "service-1",
        date: "2026-07-26",
        name: "Easter Sunday",
        sections: [
          {
            id: "section-1",
            name: "Worship",
            elements: [
              {
                id: "el-1",
                type: "song",
                title: plainTextToRichText("Living Hope"),
                notes: plainTextToRichText("Slow the tempo down."),
                teamNotes: [
                  {
                    id: "tn-1",
                    label: "Band",
                    note: plainTextToRichText("Watch the bridge cue."),
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    const user = userEvent.setup();
    renderEditor();

    expect(
      await screen.findByRole("button", { name: /Expand notes/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Expand Band/i })).toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: /Plan actions/i }));
    await user.click(await screen.findByRole("menuitemcheckbox", { name: /^Hide notes$/i }));
    expect(screen.queryByRole("button", { name: /Expand notes/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Expand Band/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Plan actions/i }));
    const hideNotesItem = await screen.findByRole("menuitemcheckbox", {
      name: /^Hide notes$/i,
    });
    expect(hideNotesItem).toHaveAttribute("aria-checked", "true");
    await user.click(hideNotesItem);
    expect(
      await screen.findByRole("button", { name: /Expand notes/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Expand Band/i })).toBeInTheDocument();
  });

  it("collapses and expands a whole section, hiding its elements and Add element", async () => {
    mockGetServicePlan.mockResolvedValue({
      success: true,
      servicePlan: {
        planId: "church-1::service-1@2026-07-26",
        churchId: "church-1",
        planKey: "service-1@2026-07-26",
        serviceId: "service-1",
        date: "2026-07-26",
        name: "Easter Sunday",
        sections: [
          {
            id: "section-1",
            name: "Worship",
            elements: [
              { id: "el-1", type: "song", title: plainTextToRichText("Living Hope") },
            ],
          },
        ],
      },
    });

    const user = userEvent.setup();
    renderEditor();

    await user.click(await screen.findByRole("button", { name: /^Edit$/i }));
    await screen.findByLabelText(/^Title/i);
    expect(screen.getByRole("button", { name: /Add element/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Collapse section/i }));
    // Collapsed section content stays mounted for the height animation but is
    // aria-hidden / inert — role queries should not see it.
    expect(screen.getByRole("button", { name: /Expand section/i })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByRole("textbox", { name: /^Title/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add element/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Expand section/i }));
    expect(await screen.findByRole("textbox", { name: /^Title/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add element/i })).toBeInTheDocument();
  });

  it("disables editing controls when canEdit is false", async () => {
    mockGetServicePlan.mockResolvedValue({
      success: true,
      servicePlan: {
        planId: "church-1::service-1@2026-07-26",
        churchId: "church-1",
        planKey: "service-1@2026-07-26",
        serviceId: "service-1",
        date: "2026-07-26",
        name: "Easter Sunday",
        sections: [{ id: "section-1", name: "Worship", elements: [] }],
      },
    });

    renderEditor({ canEdit: false });

    expect(screen.queryByRole("button", { name: /Save plan/i })).not.toBeInTheDocument();
    expect(await screen.findByText("Synced")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Edit$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add section/i })).not.toBeInTheDocument();
  });

  it("shares from the header menu and lets an editor make an item live from its row", async () => {
    // Make live only appears on the service's calendar day — pin this
    // occurrence to "today" (plan timezone = local) so the control is available.
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const todayDate = calendarDateInTimeZone(new Date(), timeZone);
    const todayStartsAt = `${todayDate}T14:00:00.000Z`;
    const todayOccurrence: TeamScheduleOccurrence = {
      occurrenceId: `service-1@${todayStartsAt}`,
      serviceId: "service-1",
      name: "Easter Sunday",
      startsAt: todayStartsAt,
    };
    // Plan key still uses the UTC YYYY-MM-DD from startsAt (getOccurrenceDate).
    const planKey = `service-1@${todayStartsAt.slice(0, 10)}`;
    const publishedPlan: ServicePlan = {
      planId: `church-1::${planKey}`,
      churchId: "church-1",
      planKey,
      serviceId: "service-1",
      date: todayDate,
      name: "Easter Sunday",
      startsAt: todayStartsAt,
      published: true,
      publicLive: { mode: "schedule" },
      sections: [
        {
          id: "section-1",
          name: "Worship",
          elements: [{ id: "welcome", type: "free", title: plainTextToRichText("Welcome") }],
        },
      ],
    };
    mockGetServicePlan.mockResolvedValue({
      success: true,
      servicePlan: publishedPlan,
      publicUrls: {
        team: "https://www.worshipsync.net/#/services/share-token",
        general: "https://www.worshipsync.net/#/services/general-share-token",
      },
    });
    mockUpdateServicePlanPublicLive.mockResolvedValue({
      success: true,
      servicePlan: {
        ...publishedPlan,
        publicLive: { mode: "manual", currentElementId: "welcome" },
      },
    });

    const user = userEvent.setup();
    renderEditor({ occurrence: todayOccurrence });

    await user.click(await screen.findByRole("button", { name: /Plan actions/i }));
    expect(
      await screen.findByRole("button", { name: /Copy detailed view link/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /View detailed view/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Copy simple view link/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /View simple view/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /Save as template/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /Disable shared links/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Serving links include notes/i),
    ).not.toBeInTheDocument();

    await user.keyboard("{Escape}");

    await user.click(await screen.findByRole("button", { name: /Make Welcome live/i }));
    await waitFor(() => {
      expect(mockUpdateServicePlanPublicLive).toHaveBeenCalledWith(
        "church-1",
        planKey,
        { mode: "manual", currentElementId: "welcome" },
      );
    });
    expect(
      await screen.findByRole("button", {
        name: /Resume schedule \(currently live: Welcome\)/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Live \(pinned\): Welcome/i)).toBeInTheDocument();
  });

  it("publishes when copying a share link for an unpublished plan", async () => {
    const draftPlan: ServicePlan = {
      planId: "church-1::service-1@2026-07-26",
      churchId: "church-1",
      planKey: "service-1@2026-07-26",
      serviceId: "service-1",
      date: "2026-07-26",
      name: "Easter Sunday",
      startsAt: "2026-07-26T14:00:00.000Z",
      published: false,
      sections: [
        {
          id: "section-1",
          name: "Worship",
          elements: [{ id: "welcome", type: "free", title: plainTextToRichText("Welcome") }],
        },
      ],
    };
    mockGetServicePlan.mockResolvedValue({ success: true, servicePlan: draftPlan });
    mockPublishServicePlan.mockResolvedValue({
      success: true,
      servicePlan: { ...draftPlan, published: true },
      publicUrl: "https://www.worshipsync.net/#/services/share-token",
      teamPublicUrl: "https://www.worshipsync.net/#/services/share-token",
      generalPublicUrl: "https://www.worshipsync.net/#/services/general-share-token",
    });

    const user = userEvent.setup();
    renderEditor();

    await user.click(await screen.findByRole("button", { name: /Plan actions/i }));
    await user.click(await screen.findByRole("button", { name: /Copy detailed view link/i }));
    await waitFor(() => {
      expect(mockPublishServicePlan).toHaveBeenCalledWith(
        "church-1",
        "service-1@2026-07-26",
      );
    });
    expect(await screen.findByText(/Detailed view link copied/i)).toBeInTheDocument();
  });

  it("publishes and opens a view link for an unpublished plan", async () => {
    const draftPlan: ServicePlan = {
      planId: "church-1::service-1@2026-07-26",
      churchId: "church-1",
      planKey: "service-1@2026-07-26",
      serviceId: "service-1",
      date: "2026-07-26",
      name: "Easter Sunday",
      startsAt: "2026-07-26T14:00:00.000Z",
      published: false,
      sections: [
        {
          id: "section-1",
          name: "Worship",
          elements: [{ id: "welcome", type: "free", title: plainTextToRichText("Welcome") }],
        },
      ],
    };
    mockGetServicePlan.mockResolvedValue({ success: true, servicePlan: draftPlan });
    mockPublishServicePlan.mockResolvedValue({
      success: true,
      servicePlan: { ...draftPlan, published: true },
      publicUrl: "https://www.worshipsync.net/#/services/share-token",
      teamPublicUrl: "https://www.worshipsync.net/#/services/share-token",
      generalPublicUrl: "https://www.worshipsync.net/#/services/general-share-token",
    });
    const openSpy = jest.spyOn(window, "open").mockImplementation(() => null);

    const user = userEvent.setup();
    renderEditor();

    await user.click(await screen.findByRole("button", { name: /Plan actions/i }));
    await user.click(await screen.findByRole("button", { name: /View simple view/i }));
    await waitFor(() => {
      expect(mockPublishServicePlan).toHaveBeenCalledWith(
        "church-1",
        "service-1@2026-07-26",
      );
    });
    expect(openSpy).toHaveBeenCalledWith(
      "https://www.worshipsync.net/#/services/general-share-token",
      "_blank",
      "noopener,noreferrer",
    );
    openSpy.mockRestore();
  });
});
