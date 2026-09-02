import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ContextType, ReactNode } from "react";
import ServicePlanEditor from "./ServicePlanEditor";
import {
  collectServicePlanRoleNoteOptions,
  collectServicePlanTeamNoteLabels,
} from "./servicePlanNoteOptions";
import { roleNoteMatchesServicePlanTeam } from "./servicePlanRoleNoteTeam";
import { GlobalInfoContext } from "../../context/globalInfo";
import { ToastProvider } from "../../context/toastContext";
import { createMockGlobalContext } from "../../test/mocks";
import {
  listServicePlanTemplates,
  saveServicePlanTemplate,
  getServicePlan,
  getServicePlanAssignmentHistory,
  getServicePlanMicrophones,
  publishServicePlan,
  saveServicePlan,
  saveServicePlanAssignmentHistory,
  saveServicePlanMicrophones,
  unpublishServicePlan,
  updateServicePlanPublicLive,
} from "../../api/auth";
import { getServicePlanningImportDataFromUrl } from "../../containers/Overlays/eventParser";
import type {
  TeamPosition,
  TeamRecord,
  TeamRosterMember,
  TeamScheduleOccurrence,
  TeamService,
} from "../../api/authTypes";
import type { ServicePlan } from "../../types/servicePlan";
import type { TeamsAssignmentSummaryRow } from "../Teams/pages/teamsAssignmentsSummary";
import {
  plainTextToRichText,
  richTextToPlainText,
} from "../../types/richText";
import { calendarDateInTimeZone } from "../../utils/teamScheduleOccurrences";
import * as generalUtils from "../../utils/generalUtils";

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
  getServicePlanMicrophones: jest.fn(),
  publishServicePlan: jest.fn(),
  saveServicePlan: jest.fn(),
  saveServicePlanAssignmentHistory: jest.fn(),
  saveServicePlanMicrophones: jest.fn(),
  unpublishServicePlan: jest.fn(),
  updateServicePlanPublicLive: jest.fn(),
  getSongAudioUrl: jest.fn(),
}));

// Song attach/create modal — row contract is covered in ElementRow tests; keep
// this light so editor flows can assert open/seed without CreateItem chrome.
jest.mock("./ServicePlanLibraryPicker", () => ({
  __esModule: true,
  default: ({
    initialQuery,
    initialLyrics,
    startInCreate,
    onSelectSong,
  }: {
    initialQuery?: string;
    initialLyrics?: string;
    startInCreate?: boolean;
    onSelectSong?: (songRef: {
      kind: "library";
      songId: string;
      songName: string;
    }) => void;
  }) => (
    <div
      data-testid="song-picker"
      data-initial-query={initialQuery ?? ""}
      data-initial-lyrics={initialLyrics ?? ""}
      data-start-in-create={startInCreate ? "true" : "false"}
    >
      <button
        type="button"
        onClick={() =>
          onSelectSong?.({
            kind: "library",
            songId: "created-song",
            songName: initialQuery || "Created song",
          })
        }
      >
        Complete song creation
      </button>
    </div>
  ),
}));

jest.mock("../../containers/Overlays/eventParser", () => ({
  getServicePlanningImportDataFromUrl: jest.fn(),
}));

// The library picker, the song suggestion popover, and the plan song lyrics
// viewer all read songs via useSelector.
let mockAllSongDocs: Array<Record<string, unknown>> = [];
jest.mock("../../hooks", () => ({
  useSelector: (selector: (state: unknown) => unknown) =>
    selector({
      allDocs: { allSongDocs: mockAllSongDocs },
      allItems: { list: [], isAllItemsLoading: false },
    }),
  useDispatch: () => jest.fn(),
}));

const mockListServicePlanTemplates = jest.mocked(listServicePlanTemplates);
const mockSaveServicePlanTemplate = jest.mocked(saveServicePlanTemplate);
const mockGetServicePlan = jest.mocked(getServicePlan);
const mockGetServicePlanAssignmentHistory = jest.mocked(getServicePlanAssignmentHistory);
const mockGetServicePlanMicrophones = jest.mocked(getServicePlanMicrophones);
const mockSaveServicePlanAssignmentHistory = jest.mocked(saveServicePlanAssignmentHistory);
const mockSaveServicePlanMicrophones = jest.mocked(saveServicePlanMicrophones);
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
  positions = [],
  teams = [],
  canEdit = true,
  initialEditing = false,
  onBack,
  planNavigation,
  occurrenceSwitcher,
  teamMicrophones,
  scheduledAssignmentRows,
  mobileServingContent,
}: {
  service?: TeamService;
  occurrence?: TeamScheduleOccurrence;
  members?: TeamRosterMember[];
  positions?: TeamPosition[];
  teams?: TeamRecord[];
  canEdit?: boolean;
  initialEditing?: boolean;
  onBack?: () => void;
  planNavigation?: {
    onPrevious?: () => void;
    onNext?: () => void;
  };
  occurrenceSwitcher?: {
    options: { occurrenceId: string; label: string }[];
    onSelect: (occurrenceId: string) => void;
  };
  teamMicrophones?: {
    rows: TeamsAssignmentSummaryRow[];
    savingSlot?: string | null;
    onChange: (
      row: TeamsAssignmentSummaryRow,
      microphoneIds: string[],
    ) => void;
  };
  scheduledAssignmentRows?: TeamsAssignmentSummaryRow[];
  mobileServingContent?: ReactNode;
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
          positions={positions}
          teams={teams}
          canEdit={canEdit}
          initialEditing={initialEditing}
          onBack={onBack}
          planNavigation={planNavigation}
          occurrenceSwitcher={occurrenceSwitcher}
          teamMicrophones={teamMicrophones}
          scheduledAssignmentRows={scheduledAssignmentRows}
          mobileServingContent={mobileServingContent}
        />
      </ToastProvider>
    </GlobalInfoContext.Provider>,
  );

describe("collectServicePlanTeamNoteLabels", () => {
  it("returns sorted unique non-empty team note labels", () => {
    expect(
      collectServicePlanTeamNoteLabels([
        {
          id: "section-1",
          name: "Worship",
          elements: [
            {
              id: "el-1",
              type: "free",
              title: plainTextToRichText("One"),
              teamNotes: [
                { id: "tn-1", label: "Media Team", note: plainTextToRichText("a") },
                { id: "tn-2", label: "Band", note: plainTextToRichText("b") },
                { id: "tn-3", label: "  ", note: plainTextToRichText("c") },
                { id: "tn-4", label: "Band", note: plainTextToRichText("d") },
              ],
            },
          ],
        },
      ]),
    ).toEqual(["Band", "Media Team"]);
  });
});

describe("role note filter options", () => {
  // Behavior change: the filter lists the full roster (quiet roles included),
  // not only roles that already have notes/mics. Selecting a quiet role still
  // hides other roles' notes via the existing roleNotesFilter matchers.
  it("keeps quiet roster roles available in the filter", () => {
    const allRoles = collectServicePlanRoleNoteOptions(
      [{
        id: "section-1",
        name: "Worship",
        elements: [{
          id: "el-1",
          type: "free",
          title: plainTextToRichText("One"),
          teamNotes: [{
            id: "note-1",
            scope: "role",
            positionId: "camera",
            label: "Media Team · Camera",
            note: plainTextToRichText("Hold the wide shot."),
          }],
        }],
      }],
      [
        {
          positionId: "camera",
          churchId: "church-1",
          teamId: "media",
          name: "Camera",
          icon: "camera",
        },
        {
          positionId: "lyrics",
          churchId: "church-1",
          teamId: "media",
          name: "Lyrics",
          icon: "lyrics",
        },
      ],
      [{
        teamId: "media",
        churchId: "church-1",
        name: "Media Team",
        memberIds: [],
      }],
    );

    const filterOptions = allRoles.filter((role) =>
      roleNoteMatchesServicePlanTeam(role, ""),
    );

    expect(filterOptions.map((role) => role.positionId).sort()).toEqual([
      "camera",
      "lyrics",
    ]);
  });

  it("scopes all-role choices to the selected team", () => {
    const allRoles = [
      {
        positionId: "director",
        label: "Director",
        teamId: "media",
        teamName: "Media Team",
      },
      {
        positionId: "lead-coordinator",
        label: "Lead Coordinator",
        teamId: "coordinators",
        teamName: "Coordinators",
      },
    ];

    expect(
      allRoles.filter((role) =>
        roleNoteMatchesServicePlanTeam(role, "Coordinators"),
      ),
    ).toEqual([allRoles[1]]);
  });
});

describe("ServicePlanEditor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAllSongDocs = [];
    mockGetServicePlan.mockResolvedValue({ success: true, servicePlan: null });
    mockListServicePlanTemplates.mockResolvedValue({ success: true, templates: [] });
    mockSaveServicePlanTemplate.mockResolvedValue({
      success: true,
      template: {} as never,
    });
    mockGetServicePlanAssignmentHistory.mockResolvedValue({ success: true, values: [] });
    mockGetServicePlanMicrophones.mockResolvedValue({
      success: true,
      microphones: [],
      audiences: [],
    });
    mockSaveServicePlanAssignmentHistory.mockResolvedValue({ success: true, values: [] });
    mockSaveServicePlanMicrophones.mockResolvedValue({
      success: true,
      microphones: [],
      audiences: [],
    });
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

  describe("Mic Assignments tab", () => {
    const microphoneTeam: TeamRecord = {
      teamId: "team-1",
      churchId: "church-1",
      name: "Worship",
      memberIds: [],
      usesMicrophoneAssignments: true,
    };

    const scheduledRow: TeamsAssignmentSummaryRow = {
      teamId: "team-1",
      teamName: "Worship",
      scheduleId: "schedule-1",
      occurrenceId: occurrence.occurrenceId,
      positionId: "position-vocal",
      positionName: "Vocal",
      columnKey: "position-vocal::0",
      slotLabel: "Vocal 1",
      memberName: "Avery Stone",
      microphoneIds: [],
    };

    const withCatalog = () => {
      mockGetServicePlanMicrophones.mockResolvedValue({
        success: true,
        microphones: [
          { id: "mic-lead", name: "Lead", type: "Handheld", color: "#22d3ee" },
        ],
        audiences: [],
      });
    };

    it("allocates a microphone to a scheduled role away from the running order", async () => {
      const user = userEvent.setup();
      const onChange = jest.fn();
      withCatalog();

      renderEditor({
        teams: [microphoneTeam],
        teamMicrophones: { rows: [scheduledRow], onChange },
      });

      await user.click(
        await screen.findByRole("tab", { name: /Mic Assignments/i }),
      );
      expect(screen.getAllByRole("tab")).toHaveLength(3);
      expect(
        screen.queryByRole("tab", { name: /Who's serving/i }),
      ).not.toBeInTheDocument();
      // The picker identifies both the scheduled person and role, so duplicate
      // role slots are unambiguous during live setup.
      const microphoneSelect = await screen.findByRole("combobox", {
        name: /Microphone for Avery Stone \(Vocal 1\)/i,
      });

      await user.click(microphoneSelect);
      await user.click(await screen.findByRole("option", { name: /Lead/i }));

      expect(onChange).toHaveBeenCalledWith(scheduledRow, ["mic-lead"]);
    });

    it("keeps Mics available with guidance when no scheduled role can hold one", async () => {
      const user = userEvent.setup();
      withCatalog();

      // Same rows, but the team never opted into microphone assignments.
      renderEditor({
        teams: [{ ...microphoneTeam, usesMicrophoneAssignments: false }],
        teamMicrophones: { rows: [scheduledRow], onChange: jest.fn() },
      });

      expect(
        await screen.findByRole("button", { name: /Start from scratch/i }),
      ).toBeInTheDocument();
      await user.click(
        await screen.findByRole("tab", { name: /Mic Assignments/i }),
      );
      expect(
        screen.getByText(/No scheduled roles for teams that use microphones yet/i),
      ).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: /Order of service/i })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: /Setlist/i })).toBeInTheDocument();
    });
  });

  it("shows an ordered compact setlist and opens full song details", async () => {
    const user = userEvent.setup();
    mockAllSongDocs = [{
      _id: "song-1",
      name: "Living Hope",
      type: "song",
      selectedArrangement: 0,
      arrangements: [],
      slides: [],
      shouldSendTo: { projector: true, monitor: true, stream: true },
      songLinks: [{
        id: "link-1",
        label: "Tutorial",
        url: "https://example.com/tutorial",
      }],
      songAudio: {
        id: "audio-1",
        key: "churches/church-1/songs/song-1/audio-1.mp3",
        fileName: "living-hope.mp3",
        contentType: "audio/mpeg",
        sizeBytes: 3_524_633,
        uploadedAt: "2026-08-06T12:00:00.000Z",
      },
    }];
    mockGetServicePlan.mockResolvedValue({
      success: true,
      servicePlan: {
        planId: "plan-1",
        churchId: "church-1",
        planKey: "service-1@2026-07-26",
        serviceId: "service-1",
        date: "2026-07-26",
        name: "Easter Sunday",
        sections: [{
          id: "section-1",
          name: "Worship",
          elements: [{
            id: "element-1",
            type: "song",
            title: plainTextToRichText("Living Hope"),
            songRefs: [{
              kind: "library",
              songId: "song-1",
              songName: "Living Hope",
            }],
          }],
        }],
      } as ServicePlan,
    });

    renderEditor();
    await user.click(await screen.findByRole("tab", { name: "Setlist" }));

    const setlist = await screen.findByRole("region", { name: "Service setlist" });
    expect(within(setlist).getByRole("link", { name: /Tutorial/i })).toHaveAttribute(
      "href",
      "https://example.com/tutorial",
    );
    expect(within(setlist).getByRole("button", { name: "Play" })).toBeInTheDocument();
    expect(within(setlist).queryByRole("button", { name: "Download" })).not.toBeInTheDocument();

    await user.click(
      within(setlist).getByRole("button", {
        name: /View song details for Living Hope/i,
      }),
    );
    expect(await screen.findByText(/Song details.*Living Hope/i)).toBeInTheDocument();
  });

  it("offers to start from scratch for an occurrence with no plan yet", async () => {
    renderEditor();
    expect(
      await screen.findByRole("button", { name: /Start from scratch/i }),
    ).toBeInTheDocument();
  });

  // The Controller workspace picks the occurrence itself and has no Plans list
  // to go back to, so the switch has to be reachable from the plan's own menu —
  // including on a service with no plan saved yet, or the operator is stuck.
  // Drill-in (not a side submenu) keeps the picker on-screen on narrow viewports.
  it("switches to another occurrence from the plan actions menu", async () => {
    const user = userEvent.setup();
    const onSelect = jest.fn();

    renderEditor({
      occurrenceSwitcher: {
        options: [
          { occurrenceId: occurrence.occurrenceId, label: "Easter Sunday · Sun, Jul 26, 2:00 PM" },
          { occurrenceId: "service-2@2026-07-29T23:00:00.000Z", label: "Midweek · Wed, Jul 29, 7:00 PM" },
        ],
        onSelect,
      },
    });

    await user.click(await screen.findByRole("button", { name: /Plan actions/i }));
    await user.click(await screen.findByRole("menuitem", { name: /Switch service/i }));
    await user.click(await screen.findByRole("menuitemradio", { name: /Midweek/i }));

    expect(onSelect).toHaveBeenCalledWith("service-2@2026-07-29T23:00:00.000Z");
  });

  it("leaves the plan actions menu alone when there is nothing to switch to", async () => {
    renderEditor({
      occurrenceSwitcher: {
        options: [
          { occurrenceId: occurrence.occurrenceId, label: "Easter Sunday · Sun, Jul 26, 2:00 PM" },
        ],
        onSelect: jest.fn(),
      },
    });

    expect(
      await screen.findByRole("button", { name: /Start from scratch/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Plan actions/i }),
    ).not.toBeInTheDocument();
  });

  // Role notes uses a drill-in panel (not a side submenu) so the picker stays
  // fully visible when the plan actions menu is flush against the viewport edge.
  it("opens role notes as a drill-in panel in the plan actions menu", async () => {
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
                teamNotes: [
                  {
                    id: "rn-1",
                    scope: "role",
                    positionId: "camera",
                    label: "Media Team · Camera",
                    note: plainTextToRichText("Hold the wide shot."),
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    const user = userEvent.setup();
    renderEditor({
      positions: [
        {
          positionId: "camera",
          churchId: "church-1",
          teamId: "media",
          name: "Camera",
        },
      ],
      teams: [
        {
          teamId: "media",
          churchId: "church-1",
          name: "Media Team",
          memberIds: [],
        },
      ],
    });

    await user.click(await screen.findByRole("button", { name: /Plan actions/i }));
    await user.click(await screen.findByRole("menuitem", { name: /Role notes/i }));

    expect(screen.getByRole("textbox", { name: /Search roles/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^All roles$/i })).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitemcheckbox", { name: /^Hide notes$/i }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("menuitem", { name: /^Back$/i }));
    expect(
      await screen.findByRole("menuitemcheckbox", { name: /^Hide notes$/i }),
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

  it("automatically starts a new occurrence from the service default template", async () => {
    const serviceWithDefault: TeamService = {
      ...oneTimeService,
      defaultPlanTemplateId: "tpl-default",
    };
    mockListServicePlanTemplates.mockResolvedValue({
      success: true,
      templates: [
        {
          templateId: "tpl-default",
          churchId: "church-1",
          name: "Standard Sabbath",
          serviceId: "service-1",
          sections: [
            {
              id: "tpl-section",
              name: "Word",
              elements: [
                {
                  id: "tpl-reading",
                  type: "free",
                  title: plainTextToRichText("Scripture reading"),
                  scheduledPositionIds: ["reader"],
                },
              ],
            },
          ],
        },
      ],
    });

    renderEditor({
      service: serviceWithDefault,
      scheduledAssignmentRows: [
        {
          teamId: "worship-elements",
          teamName: "Worship Elements",
          scheduleId: "schedule-1",
          occurrenceId: occurrence.occurrenceId,
          positionId: "reader",
          positionName: "Scripture Reader",
          columnKey: "reader::0",
          slotLabel: "Scripture Reader",
          memberId: "member-1",
          memberName: "Avery Stone",
          canNotify: true,
          microphoneIds: [],
        },
      ],
    });

    expect(await screen.findByText(/Avery Stone/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Apply a template/i }),
    ).not.toBeInTheDocument();

    await waitFor(
      () => expect(mockSaveServicePlan).toHaveBeenCalledTimes(1),
      { timeout: 2_500 },
    );
    const [, , body] = mockSaveServicePlan.mock.calls[0];
    expect(body.sections[0].elements[0].scheduledPositionIds).toEqual([
      "reader",
    ]);
    expect(body.sections[0].elements[0].id).not.toBe("tpl-reading");
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
    expect(body.sections[0].elements[0].assignees).toEqual([]);
  });

  it("shows every team's imported notes even when a team filter was saved", async () => {
    // The operator once focused "Coordinators" on the public plan view; that
    // preference is shared with this editor and outlives the session.
    localStorage.setItem("worshipsyncServicePublicNotesTeam", "Coordinators");
    mockGetServicePlanningImportDataFromUrl.mockResolvedValue({
      planLabel: "Sat, Aug 1 - 10 AM",
      sections: [
        {
          sectionName: "Teaching & Mission",
          rows: [{
            elementType: "Sabbath School Lesson Study",
            title: "Panel",
            ledBy: "Greg Baldeo",
            teamNotes: [
              { teamName: "Media Team", note: "3 or 4 headsets" },
              { teamName: "Sabbath School Panel (g)", note: "Begin after the countdown." },
              { teamName: "Coordinators", note: "Prep the platform." },
            ],
          }],
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
      "https://planning.myamplify.io/public/serviceFlow.cfm?_wp=abc",
    );
    await user.click(screen.getByRole("button", { name: /^Import plan$/i }));

    // All three teams' notes are visible, not just the saved one.
    expect(await screen.findByText("Media Team")).toBeInTheDocument();
    expect(screen.getByText("Sabbath School Panel (g)")).toBeInTheDocument();
    expect(screen.getByText("Coordinators")).toBeInTheDocument();

    // And all three are what actually gets saved.
    await waitFor(() => {
      expect(mockSaveServicePlan).toHaveBeenCalledTimes(1);
    }, { timeout: 2_500 });
    const [, , body] = mockSaveServicePlan.mock.calls[0];
    expect(
      body.sections[0].elements[0].teamNotes.map((note: { label: string }) => note.label),
    ).toEqual(["Media Team", "Sabbath School Panel (g)", "Coordinators"]);
  });

  it("replaces an untouched scratch draft on import instead of leaving its blank section", async () => {
    mockGetServicePlanningImportDataFromUrl.mockResolvedValue({
      planLabel: "Sunday, Jul 26",
      sections: [
        {
          sectionName: "Welcome & Connection",
          rows: [{ elementType: "Welcome", title: "Pastoral Greetings", ledBy: "Jane" }],
        },
      ],
      teamAssignments: [],
    });

    const user = userEvent.setup();
    renderEditor();

    // Starting from scratch seeds one empty "Service" section. Importing over
    // it must not treat that as a plan to reconcile.
    await user.click(await screen.findByRole("button", { name: /Start from scratch/i }));
    await user.click(await screen.findByRole("button", { name: /Plan actions/i }));
    await user.click(await screen.findByRole("menuitem", { name: /Import updates/i }));
    // Set the URL in one event — typing it character by character is the
    // slowest thing in this test, and this suite runs close to its budget.
    fireEvent.change(screen.getByLabelText(/Planning URL/i), {
      target: { value: "https://services.planningcenteronline.com/plans/123" },
    });
    await user.click(screen.getByRole("button", { name: /Apply updates/i }));

    expect(await screen.findByDisplayValue("Welcome & Connection")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Service")).not.toBeInTheDocument();

    // Let the autosave this import queued actually land, both to assert what
    // was persisted and so its timer can't fire during the next test.
    await waitFor(() => expect(mockSaveServicePlan).toHaveBeenCalled(), {
      timeout: 2_500,
    });
    const [, , body] = mockSaveServicePlan.mock.calls[0];
    expect(body.sections.map((section) => section.name)).toEqual([
      "Welcome & Connection",
    ]);
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

  it("refreshes an existing plan with only the selected Service Planning fields", async () => {
    mockGetServicePlan.mockResolvedValue({
      success: true,
      servicePlan: {
        planId: "church-1::service-1@2026-07-26",
        churchId: "church-1",
        planKey: "service-1@2026-07-26",
        serviceId: "service-1",
        date: "2026-07-26",
        name: "Easter Sunday",
        sourceImport: {
          source: "servicePlanning",
          sourceUrl: "https://services.planningcenteronline.com/plans/123",
          loadedAt: "2026-07-20T12:00:00.000Z",
          planLabel: "Sunday, Jul 26",
        },
        sections: [
          {
            id: "section-1",
            sourcePlanningManaged: true,
            name: "Worship",
            elements: [
              {
                id: "element-1",
                sourcePlanningManaged: true,
                type: "free",
                title: plainTextToRichText("Old welcome"),
                startTime: "09:00",
                assignedName: "Avery",
              },
            ],
          },
        ],
      },
    });
    mockGetServicePlanningImportDataFromUrl.mockResolvedValue({
      planLabel: "Sunday, Jul 26",
      sections: [
        {
          sectionName: "Worship",
          rows: [{ elementType: "Welcome", title: "Welcome home", ledBy: "Blair", startTime: "09:05" }],
        },
      ],
      teamAssignments: [],
    });

    const user = userEvent.setup();
    renderEditor();

    await user.click(await screen.findByRole("button", { name: /Plan actions/i }));
    await user.click(await screen.findByRole("menuitem", { name: /Import updates/i }));
    expect(screen.getByLabelText(/Planning URL/i)).toHaveValue(
      "https://services.planningcenteronline.com/plans/123",
    );
    expect(screen.getByRole("checkbox", { name: /Titles and content/i })).toBeChecked();
    await user.click(screen.getByRole("checkbox", { name: /Start times and durations/i }));
    await user.click(screen.getByRole("button", { name: /Apply updates/i }));
    expect(await screen.findByText(/1 change ready to apply/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Apply 1 change/i }));

    await waitFor(() => expect(mockSaveServicePlan).toHaveBeenCalled(), { timeout: 2_500 });
    const [, , body] = mockSaveServicePlan.mock.calls[0];
    expect(body.sections[0].elements[0]).toMatchObject({
      id: "element-1",
      startTime: "09:00",
    });
    expect(body.sections[0].elements[0].assignees[0].name).toBe("Blair");
    expect(body.sections[0].elements[0].title.blocks[0].spans[0].text).toBe("Welcome home");
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
    await user.click(screen.getByRole("button", { name: /Choose item destination/i }));
    await user.click(screen.getByRole("menuitem", { name: /Add to Service/i }));
    // Microphones hang off a person now, so an item starts with nobody on it.
    // Assignment editing opens in a side sheet to keep the plan list stable.
    await user.click(
      await screen.findByRole("button", { name: /Assignees for item/i }),
    );
    await user.click(await screen.findByRole("button", { name: /Add person/i }));

    const assignedToField = await screen.findByRole("textbox", { name: /Assigned to/i });
    await user.click(assignedToField);

    expect(await screen.findByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByText("Guest Speaker Sam")).toBeInTheDocument();

    mockSaveServicePlanAssignmentHistory.mockClear();
    fireEvent.mouseDown(
      screen.getByRole("button", {
        name: /remove "Guest Speaker Sam" from history/i,
      }),
    );
    await waitFor(() =>
      expect(mockSaveServicePlanAssignmentHistory).toHaveBeenCalledWith(
        "church-1",
        [],
      ),
    );
    expect(screen.queryByText("Guest Speaker Sam")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: /remove "Jane Doe" from history/i,
      }),
    ).not.toBeInTheDocument();

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

    // Seeded with one default section already; choose it before adding.
    await user.click(screen.getByRole("button", { name: /Choose item destination/i }));
    await user.click(screen.getByRole("menuitem", { name: /Add to Service/i }));
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

    await user.click(screen.getByRole("button", { name: /Choose item destination/i }));
    await user.click(screen.getByRole("menuitem", { name: /Add to Service/i }));
    await user.click(screen.getByRole("button", { name: /^Add item$/i }));

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

  const planWithTwoSections: ServicePlan = {
    planId: "church-1::service-1@2026-07-26",
    churchId: "church-1",
    planKey: "service-1@2026-07-26",
    serviceId: "service-1",
    date: "2026-07-26",
    name: "Easter Sunday",
    sections: [
      { id: "section-1", name: "Worship", elements: [] },
      { id: "section-2", name: "Word", elements: [] },
    ],
  };

  it("opens in edit mode when the entry point requests it", async () => {
    mockGetServicePlan.mockResolvedValue({
      success: true,
      servicePlan: planWithTwoSections,
    });
    renderEditor({ initialEditing: true });

    expect(await screen.findByRole("button", { name: /^Done$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Edit$/i })).not.toBeInTheDocument();
  });

  it("undoes and redoes a structural edit, and autosaves the restored plan", async () => {
    mockGetServicePlan.mockResolvedValue({
      success: true,
      servicePlan: planWithTwoSections,
    });

    const user = userEvent.setup();
    renderEditor();

    await user.click(await screen.findByRole("button", { name: /^Edit$/i }));
    expect(await screen.findByDisplayValue("Worship")).toBeInTheDocument();
    // Nothing edited yet, so neither control is live.
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /More tools for Worship/i }));
    await user.click(screen.getByRole("menuitem", { name: /Remove section/i }));
    expect(screen.queryByDisplayValue("Worship")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByDisplayValue("Worship")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();

    // The undone plan is the plan of record — autosave persists it.
    await waitFor(() => {
      expect(
        mockSaveServicePlan.mock.calls
          .at(-1)?.[2]
          .sections.map((section) => section.name),
      ).toEqual(["Worship", "Word"]);
    }, { timeout: 3_000 });

    await user.click(screen.getByRole("button", { name: "Redo" }));
    expect(screen.queryByDisplayValue("Worship")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
  });

  it("undoes with the keyboard and clears history when the operator clicks Done", async () => {
    mockGetServicePlan.mockResolvedValue({
      success: true,
      servicePlan: planWithTwoSections,
    });

    const user = userEvent.setup();
    renderEditor();

    await user.click(await screen.findByRole("button", { name: /^Edit$/i }));
    await user.click(await screen.findByRole("button", { name: /More tools for Word/i }));
    await user.click(await screen.findByRole("menuitem", { name: /Remove section/i }));
    expect(screen.queryByDisplayValue("Word")).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: "z", ctrlKey: true });
    expect(await screen.findByDisplayValue("Word")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "z", ctrlKey: true, shiftKey: true });
    await waitFor(() => {
      expect(screen.queryByDisplayValue("Word")).not.toBeInTheDocument();
    });

    // Done commits the editing session, so there is nothing left to step back
    // through when the operator returns to Edit.
    await user.click(screen.getByRole("button", { name: /^Done$/i }));
    await user.click(screen.getByRole("button", { name: /^Edit$/i }));
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
  });

  it("collapses a typing burst on one field into a single undo step", async () => {
    mockGetServicePlan.mockResolvedValue({
      success: true,
      servicePlan: planWithTwoSections,
    });

    const user = userEvent.setup();
    renderEditor();

    await user.click(await screen.findByRole("button", { name: /^Edit$/i }));
    const sectionName = await screen.findByDisplayValue("Worship");
    await user.clear(sectionName);
    await user.type(sectionName, "Opening");
    expect(await screen.findByDisplayValue("Opening")).toBeInTheDocument();

    // One press returns the whole burst — including the clear, which shares the
    // field's coalesce key — rather than one character.
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByDisplayValue("Worship")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  });

  it("keeps removing a note its own undo step, even right after typing in it", async () => {
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
                type: "free",
                title: plainTextToRichText("Welcome"),
                notes: plainTextToRichText("Original"),
              },
            ],
          },
        ],
      },
    });

    const user = userEvent.setup();
    renderEditor();

    await user.click(await screen.findByRole("button", { name: /^Edit$/i }));
    await user.click(screen.getByRole("button", { name: /Expand notes/i }));
    await user.click(await screen.findByRole("textbox", { name: "Notes" }));
    await user.keyboard("X");

    // Removing lands immediately after the typing burst and writes the same
    // `notes` shape, so only the row can say it is a discrete action.
    await user.click(screen.getByRole("button", { name: /Remove note/i }));
    await waitFor(() => {
      expect(
        richTextToPlainText(
          mockSaveServicePlan.mock.calls.at(-1)![2].sections[0].elements[0].notes,
        ),
      ).not.toContain("X");
    }, { timeout: 3_000 });
    mockSaveServicePlan.mockClear();

    // Undo must land on the typed note, not jump back past the typing too.
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => {
      expect(
        richTextToPlainText(
          mockSaveServicePlan.mock.calls.at(-1)![2].sections[0].elements[0].notes,
        ),
      ).toContain("X");
    }, { timeout: 3_000 });
  });

  it("leaves undo alone for a field that owns its own history", async () => {
    mockGetServicePlan.mockResolvedValue({
      success: true,
      servicePlan: planWithTwoSections,
    });

    const user = userEvent.setup();
    renderEditor();

    await user.click(await screen.findByRole("button", { name: /^Edit$/i }));
    await user.click(await screen.findByRole("button", { name: /More tools for Word/i }));
    await user.click(await screen.findByRole("menuitem", { name: /Remove section/i }));

    // Plain inputs carry data-ignore-undo so the browser's own character-level
    // undo still applies inside them; the plan-level step must not also fire.
    fireEvent.keyDown(await screen.findByDisplayValue("Worship"), {
      key: "z",
      ctrlKey: true,
    });
    expect(screen.queryByDisplayValue("Word")).not.toBeInTheDocument();

    // A rich-text field marks the keystroke handled before it reaches us.
    const markHandled = (event: Event) => event.preventDefault();
    document.addEventListener("keydown", markHandled, true);
    fireEvent.keyDown(document, { key: "z", ctrlKey: true, cancelable: true });
    document.removeEventListener("keydown", markHandled, true);
    expect(screen.queryByDisplayValue("Word")).not.toBeInTheDocument();
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
    expect(
      await screen.findByRole("button", { name: "View full name: Living Hope" }),
    ).toBeInTheDocument();
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
    await user.click(screen.getByRole("button", { name: /More tools for Worship/i }));
    await user.click(screen.getByRole("menuitem", { name: /Remove section/i }));

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

    await user.click(screen.getByRole("button", { name: /Plan actions/i }));
    await user.click(screen.getByRole("menuitem", { name: /Edit service details/i }));
    expect(await screen.findByLabelText(/Plan name/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Close/i }));
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
    renderEditor({
      teams: [{
        teamId: "team-band",
        churchId: "church-1",
        name: "Band",
        memberIds: [],
      }],
    });

    expect(
      screen.queryByRole("button", { name: /Assignees for Living Hope/i }),
    ).not.toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: /^Edit$/i }));

    // Name, time, duration and assignee are all editable on the one-line row
    // itself — nothing has to be expanded to change them.
    expect(await screen.findByLabelText(/^Title/i)).toHaveValue("Living Hope");
    expect(screen.getByLabelText(/^Time/i)).toHaveValue("10:00 AM");
    expect(screen.getByLabelText(/^Duration/i)).toHaveValue("5 min");
    await user.type(screen.getByLabelText(/^Title/i), "!");
    expect(screen.getByLabelText(/^Title/i)).toHaveValue("Living Hope!");
    await user.click(
      screen.getByRole("button", { name: /Assignees for Living Hope/i }),
    );
    expect(await screen.findByLabelText(/^Assigned to/i)).toHaveValue("Jane Doe");
    await user.click(screen.getByRole("button", { name: /Close side panel/i }));
    await user.click(screen.getByRole("button", { name: /^Done$/i }));

    // Content and notes stay close to the row, but use separate actions.
    // Existing notes start minimized to one preview line — expand to edit.
    // AnimateCollapse keeps the editor mounted while minimized, so prefer roles
    // over getByText (preview and hidden editor both contain the note text).
    expect(
      await screen.findByRole("button", { name: /Expand notes/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Notes" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Edit$/i })).toBeInTheDocument();
  });

  it("autosaves note typing without requiring the editor to blur", async () => {
    mockGetServicePlan.mockResolvedValue({
      success: true,
      servicePlan: {
        planId: "church-1::service-1@2026-07-26",
        churchId: "church-1",
        planKey: "service-1@2026-07-26",
        serviceId: "service-1",
        date: "2026-07-26",
        name: "Easter Sunday",
        sections: [{
          id: "section-1",
          name: "Worship",
          elements: [{
            id: "el-1",
            type: "free",
            title: plainTextToRichText("Welcome"),
            notes: plainTextToRichText("Original"),
          }],
        }],
      },
    });
    const user = userEvent.setup();
    renderEditor();

    await user.click(await screen.findByRole("button", { name: /^Edit$/i }));
    await user.click(screen.getByRole("button", { name: /Expand notes/i }));
    const notes = await screen.findByRole("textbox", { name: "Notes" });
    mockSaveServicePlan.mockClear();

    await user.click(notes);
    await user.keyboard("X");

    await waitFor(
      () => expect(mockSaveServicePlan).toHaveBeenCalled(),
      { timeout: 2_500 },
    );
    const [, , body] = mockSaveServicePlan.mock.calls.at(-1)!;
    expect(
      richTextToPlainText(body.sections[0].elements[0].notes),
    ).toContain("X");
    expect(notes).toHaveFocus();
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
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Expand notes/i })).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Expand Band/i })).not.toBeInTheDocument();
    });

    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: /Plan actions/i }));
    const hideNotesMenuItem = await screen.findByRole("menuitemcheckbox", {
      name: /^Hide notes$/i,
    });
    expect(hideNotesMenuItem).toHaveAttribute("data-state", "checked");
    await user.click(hideNotesMenuItem);
    expect(
      await screen.findByRole("button", { name: /Expand notes/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Expand Band/i })).toBeInTheDocument();
  });

  it("filters the plan view to one team's notes", async () => {
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
                  {
                    id: "tn-2",
                    label: "Media Team",
                    note: plainTextToRichText("Lower house lights."),
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
      await screen.findByRole("button", { name: /Expand Band/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Expand Media Team/i }),
    ).toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: /Plan actions/i }));
    await user.click(await screen.findByRole("menuitemradio", { name: /^Band$/i }));

    expect(screen.getByRole("button", { name: /Expand Band/i })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Expand Media Team/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Expand notes/i })).toBeInTheDocument();
  });

  it("keeps the plan-level Add item control available while sections collapse", async () => {
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
    expect(screen.getByRole("button", { name: /Choose item destination/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Collapse section/i }));
    // Collapsed section content stays mounted for the height animation but is
    // aria-hidden / inert — role queries should not see it.
    expect(screen.getByRole("button", { name: /Expand section/i })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByRole("textbox", { name: /^Title/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Choose item destination/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Expand section/i }));
    expect(await screen.findByRole("textbox", { name: /^Title/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Choose item destination/i })).toBeInTheDocument();
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
          elements: [
            { id: "welcome", type: "free", title: plainTextToRichText("Welcome") },
            { id: "message", type: "free", title: plainTextToRichText("Message") },
          ],
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
    mockUpdateServicePlanPublicLive
      .mockResolvedValueOnce({
        success: true,
        servicePlan: {
          ...publishedPlan,
          publicLive: {
            mode: "anchored",
            currentElementId: "welcome",
            startedAt: new Date().toISOString(),
          },
        },
      })
      .mockResolvedValueOnce({
        success: true,
        servicePlan: {
          ...publishedPlan,
          publicLive: { mode: "manual", currentElementId: "welcome" },
        },
      })
      .mockResolvedValueOnce({
        success: true,
        servicePlan: {
          ...publishedPlan,
          publicLive: { mode: "manual", currentElementId: "message" },
        },
      })
      .mockResolvedValueOnce({
        success: true,
        servicePlan: {
          ...publishedPlan,
          publicLive: {
            mode: "anchored",
            currentElementId: "message",
            startedAt: new Date().toISOString(),
          },
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
    // The pair is symmetric now: a published plan says so instead of only
    // offering the off switch.
    expect(
      screen.getByRole("menuitem", { name: /Shared links enabled/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: /Enable shared links/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Serving links include notes/i),
    ).not.toBeInTheDocument();

    await user.keyboard("{Escape}");

    await user.click(await screen.findByRole("button", { name: /Make Welcome live/i }));
    await waitFor(() => {
      expect(mockUpdateServicePlanPublicLive).toHaveBeenCalledWith(
        "church-1",
        planKey,
        { mode: "anchored", currentElementId: "welcome" },
      );
    });
    expect(
      await screen.findByLabelText(/Live, started .*: Welcome/i),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Plan actions/i }));
    expect(
      await screen.findByRole("menuitem", { name: /Pause automatic advance/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /Return to planned schedule/i }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: /Pause automatic advance/i }));
    await waitFor(() => {
      expect(mockUpdateServicePlanPublicLive).toHaveBeenLastCalledWith(
        "church-1",
        planKey,
        { mode: "manual", currentElementId: "welcome" },
      );
    });

    await user.click(await screen.findByRole("button", { name: /Make Message live/i }));
    await waitFor(() => {
      expect(mockUpdateServicePlanPublicLive).toHaveBeenLastCalledWith(
        "church-1",
        planKey,
        { mode: "manual", currentElementId: "message" },
      );
    });

    await user.click(screen.getByRole("button", { name: /Plan actions/i }));
    expect(
      await screen.findByRole("menuitem", { name: /Continue automatic timing/i }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: /Continue automatic timing/i }));
    await waitFor(() => {
      expect(mockUpdateServicePlanPublicLive).toHaveBeenLastCalledWith(
        "church-1",
        planKey,
        { mode: "anchored", currentElementId: "message" },
      );
    });
  });

  it("offers an explicit publish for an unpublished plan", async () => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const todayDate = calendarDateInTimeZone(new Date(), timeZone);
    const todayStartsAt = `${todayDate}T14:00:00.000Z`;
    const todayOccurrence: TeamScheduleOccurrence = {
      occurrenceId: `service-1@${todayStartsAt}`,
      serviceId: "service-1",
      name: "Easter Sunday",
      startsAt: todayStartsAt,
    };
    const planKey = `service-1@${todayStartsAt.slice(0, 10)}`;
    const draftPlan: ServicePlan = {
      planId: `church-1::${planKey}`,
      churchId: "church-1",
      planKey,
      serviceId: "service-1",
      date: todayDate,
      name: "Easter Sunday",
      startsAt: todayStartsAt,
      published: false,
      sections: [
        {
          id: "section-1",
          name: "Worship",
          elements: [
            { id: "welcome", type: "free", title: plainTextToRichText("Welcome") },
          ],
        },
      ],
    };
    mockGetServicePlan.mockResolvedValue({
      success: true,
      servicePlan: draftPlan,
    });
    mockPublishServicePlan.mockResolvedValue({
      success: true,
      servicePlan: { ...draftPlan, published: true },
    });

    const user = userEvent.setup();
    renderEditor({ occurrence: todayOccurrence });

    await user.click(await screen.findByRole("button", { name: /Plan actions/i }));

    // Previously the only way to publish was to copy a link you did not want.
    // Worded as enable/disable because many plans can be published at once —
    // the current-service link picks whichever is running or next.
    const publishItem = await screen.findByRole("menuitem", {
      name: /Enable shared links/i,
    });
    expect(
      screen.queryByRole("menuitem", { name: /Disable shared links/i }),
    ).not.toBeInTheDocument();

    await user.click(publishItem);

    await waitFor(() => {
      expect(mockPublishServicePlan).toHaveBeenCalledWith("church-1", planKey);
    });
  });

  it("scrolls to the live item in view mode when the live element changes", async () => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const todayDate = calendarDateInTimeZone(new Date(), timeZone);
    const todayStartsAt = `${todayDate}T14:00:00.000Z`;
    const todayOccurrence: TeamScheduleOccurrence = {
      occurrenceId: `service-1@${todayStartsAt}`,
      serviceId: "service-1",
      name: "Easter Sunday",
      startsAt: todayStartsAt,
    };
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
          elements: [
            { id: "welcome", type: "free", title: plainTextToRichText("Welcome") },
            { id: "message", type: "free", title: plainTextToRichText("Message") },
          ],
        },
      ],
    };
    mockGetServicePlan.mockResolvedValue({
      success: true,
      servicePlan: publishedPlan,
    });
    mockUpdateServicePlanPublicLive
      .mockResolvedValueOnce({
        success: true,
        servicePlan: {
          ...publishedPlan,
          publicLive: {
            mode: "anchored",
            currentElementId: "welcome",
            startedAt: new Date().toISOString(),
          },
        },
      })
      .mockResolvedValueOnce({
        success: true,
        servicePlan: {
          ...publishedPlan,
          publicLive: {
            mode: "anchored",
            currentElementId: "message",
            startedAt: new Date().toISOString(),
          },
        },
      });

    const keepInView = jest
      .spyOn(generalUtils, "keepElementInView")
      .mockReturnValue(true);

    const user = userEvent.setup();
    renderEditor({ occurrence: todayOccurrence });

    await user.click(await screen.findByRole("button", { name: /Make Welcome live/i }));
    await waitFor(() => {
      expect(keepInView).toHaveBeenCalledWith(
        expect.objectContaining({
          shouldScrollToCenter: true,
        }),
      );
    });
    expect(screen.getByLabelText(/Live, started .*: Welcome/i)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Service plan" })).toBeInTheDocument();

    keepInView.mockClear();
    await user.click(await screen.findByRole("button", { name: /^Edit$/i }));
    await user.click(await screen.findByRole("button", { name: /^Done$/i }));
    await user.click(await screen.findByRole("button", { name: /Make Message live/i }));
    await waitFor(() => {
      expect(mockUpdateServicePlanPublicLive).toHaveBeenLastCalledWith(
        "church-1",
        planKey,
        { mode: "anchored", currentElementId: "message" },
      );
    });
    // Still editing — do not follow live yet.
    await waitFor(() => {
      expect(keepInView).toHaveBeenCalledWith(
        expect.objectContaining({
          shouldScrollToCenter: true,
        }),
      );
    });
    keepInView.mockRestore();
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

  it("opens library song lyrics from a plan song badge", async () => {
    mockAllSongDocs = [
      {
        _id: "song-1",
        name: "Living Hope",
        type: "song",
        selectedArrangement: 0,
        arrangements: [
          {
            name: "Master",
            formattedLyrics: [
              { id: "v1", name: "Verse 1", words: "Who am I that the highest King" },
            ],
          },
        ],
      },
    ];
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
    renderEditor({ canEdit: false });

    await user.click(
      await screen.findByRole("button", { name: /View song details for Living Hope/i }),
    );

    expect(
      await screen.findByText("Song details — Living Hope"),
    ).toBeInTheDocument();
    expect(screen.getByText("Verse 1")).toBeInTheDocument();
    expect(screen.getByText("Who am I that the highest King")).toBeInTheDocument();
  });

  it("opens stored reference lyrics for a pending song without edit access", async () => {
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
            name: "Response",
            elements: [
              {
                id: "el-1",
                type: "song",
                title: plainTextToRichText("Appeal Song"),
                songRef: {
                  kind: "pending",
                  title: "Appeal Song",
                  lyricsText: "Come as you are",
                },
              },
            ],
          },
        ],
      },
    });

    const user = userEvent.setup();
    renderEditor({ canEdit: false });

    await user.click(await screen.findByRole("tab", { name: "Setlist" }));
    const setlist = await screen.findByRole("region", { name: "Service setlist" });
    expect(within(setlist).getByText(/Not in library/i)).toBeInTheDocument();
    await user.click(
      within(setlist).getByRole("button", {
        name: /View reference lyrics for Appeal Song/i,
      }),
    );
    expect(await screen.findByText("Lyrics — Appeal Song")).toBeInTheDocument();
    expect(screen.getByText("Come as you are")).toBeInTheDocument();
  });

  it("opens create song for a pending plan song when the operator can create library songs", async () => {
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
            name: "Response",
            elements: [
              {
                id: "el-1",
                type: "song",
                title: plainTextToRichText("Appeal Song"),
                songRef: {
                  kind: "pending",
                  title: "Appeal Song",
                  lyricsText: "Come as you are",
                },
              },
            ],
          },
        ],
      },
    });

    const user = userEvent.setup();
    renderEditor({ canEdit: true });

    await user.click(
      await screen.findByRole("button", {
        name: /Create Appeal Song in the library/i,
      }),
    );

    const picker = await screen.findByTestId("song-picker");
    expect(picker).toHaveAttribute("data-start-in-create", "true");
    expect(picker).toHaveAttribute("data-initial-query", "Appeal Song");
    expect(picker).toHaveAttribute("data-initial-lyrics", "Come as you are");
    expect(screen.queryByText("Lyrics — Appeal Song")).not.toBeInTheDocument();
  });

  it("creates a pending song from Setlist and links every exact occurrence", async () => {
    const pendingSong = {
      kind: "pending" as const,
      title: "Appeal Song",
      lyricsText: "Come as you are",
    };
    mockAllSongDocs = [{
      _id: "created-song",
      name: "Appeal Song",
      type: "song",
      selectedArrangement: 0,
      arrangements: [],
      slides: [],
      shouldSendTo: { projector: true, monitor: true, stream: true },
    }];
    mockGetServicePlan.mockResolvedValue({
      success: true,
      servicePlan: {
        planId: "church-1::service-1@2026-07-26",
        churchId: "church-1",
        planKey: "service-1@2026-07-26",
        serviceId: "service-1",
        date: "2026-07-26",
        name: "Easter Sunday",
        sections: [{
          id: "section-1",
          name: "Response",
          elements: [
            {
              id: "el-1",
              type: "song",
              title: plainTextToRichText("Appeal Song"),
              songRef: pendingSong,
            },
            {
              id: "el-2",
              type: "free",
              title: plainTextToRichText("Prayer"),
            },
            {
              id: "el-3",
              type: "song",
              title: plainTextToRichText("Appeal Song continued"),
              songRef: pendingSong,
            },
          ],
        }],
      },
    });

    const user = userEvent.setup();
    renderEditor();
    await user.click(await screen.findByRole("tab", { name: "Setlist" }));
    const setlist = await screen.findByRole("region", { name: "Service setlist" });
    expect(
      within(setlist).getAllByRole("button", {
        name: /Create Appeal Song in the library/i,
      }),
    ).toHaveLength(2);

    await user.click(
      within(setlist).getAllByRole("button", {
        name: /Create Appeal Song in the library/i,
      })[0],
    );
    expect(await screen.findByTestId("song-picker")).toHaveAttribute(
      "data-start-in-create",
      "true",
    );
    await user.click(
      screen.getByRole("button", { name: "Complete song creation" }),
    );

    await waitFor(() => {
      expect(
        within(setlist).getAllByRole("button", {
          name: /View song details for Appeal Song/i,
        }),
      ).toHaveLength(2);
    });
    expect(within(setlist).queryByText(/Not in library/i)).not.toBeInTheDocument();
  });

  it("explains when a library song badge cannot be resolved", async () => {
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
                title: plainTextToRichText("Missing Song"),
                songRef: {
                  kind: "library",
                  songId: "deleted-song",
                  songName: "Missing Song",
                },
              },
            ],
          },
        ],
      },
    });

    const user = userEvent.setup();
    renderEditor({ canEdit: false });

    await user.click(
      await screen.findByRole("button", { name: /View song details for Missing Song/i }),
    );

    expect(await screen.findByText("Lyrics — Missing Song")).toBeInTheDocument();
    expect(
      screen.getByText(/This song is not in the library right now/i),
    ).toBeInTheDocument();
  });
});
