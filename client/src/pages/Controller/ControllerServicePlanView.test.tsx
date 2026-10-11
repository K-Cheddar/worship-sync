import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter, useLocation } from "react-router-dom";
import store from "../../store/store";
import { setActiveItemInList } from "../../store/itemListSlice";
import { updateAllFreeFormDocs, updateAllSongDocs } from "../../store/allDocsSlice";
import { getServiceFlowProgress } from "../../services/serviceFlowProgress";
import FloatingWindow from "../../components/FloatingWindow/FloatingWindow";
import { FloatingWindowZIndexProvider } from "../../components/FloatingWindow/FloatingWindowZIndexContext";
import ControllerServicePlanView from "./ControllerServicePlanView";
import { buildServicePlanFlowSnapshot } from "../buildServicePlanFlowSnapshot";
import { getServicePlanLiveProgress } from "../Services/servicePlanLive";
import { plainTextToRichText } from "../../types/richText";
import type { DBItem } from "../../types";
import type { ServicePlan, ServicePlanElement } from "../../types/servicePlan";

jest.mock("../../hooks/useCachedMediaUrl", () => ({
  useCachedMediaUrl: (url?: string) => url,
  useResolvedCachedMediaUrl: (url?: string) => url,
}));

const plan: ServicePlan = {
  planId: "plan-1",
  churchId: "church-1",
  planKey: "service-1@2026-09-25",
  serviceId: "service-1",
  date: "2026-09-25",
  startsAt: "2026-09-25T22:00:00.000Z",
  name: "Friday Service",
  sections: [{
    id: "section-1",
    name: "Worship",
    elements: [{
      id: "welcome",
      type: "free",
      title: plainTextToRichText("Welcome"),
      startTime: "18:00",
      durationSeconds: 90,
      notes: plainTextToRichText("Shared safety note"),
      teamNotes: [
        { id: "text-note", scope: "role", label: "Text Master", teamId: "presentation", teamName: "Presentation", positionId: "text-master", note: plainTextToRichText("Text team cue") },
        { id: "stage-note", scope: "role", label: "Stage Manager", teamId: "presentation", teamName: "Presentation", positionId: "stage-manager", note: plainTextToRichText("Stage team cue") },
        { id: "graphics-note", scope: "role", label: "Graphics Operator", teamId: "graphics", teamName: "Graphics", positionId: "graphics-operator", note: plainTextToRichText("Graphics team cue") },
        { id: "team-note", scope: "team", label: "Presentation", note: plainTextToRichText("Presentation team cue") },
      ],
      assignees: [{ id: "assignee-1", name: "Jordan Rivera", microphoneIds: [] }],
      resources: [
        { id: "resource-1", type: "url", title: "Run sheet", url: "https://example.test/run-sheet" },
        { id: "resource-2", type: "song", title: "Opening Song" },
        { id: "resource-3", type: "scripture", title: "Psalm 100:1–5" },
      ],
    }],
  }],
};

const snapshot = (() => {
  const built = buildServicePlanFlowSnapshot({
    plan,
    startsAt: plan.startsAt!,
    churchName: "Test Church",
  });
  built.roles = [
    { positionId: "text-master", label: "Text Master", teamId: "presentation", teamName: "Presentation" },
    { positionId: "stage-manager", label: "Stage Manager", teamId: "presentation", teamName: "Presentation" },
    { positionId: "graphics-operator", label: "Graphics Operator", teamId: "graphics", teamName: "Graphics" },
    { positionId: "presentation-operator", label: "Presentation Operator", teamId: "presentation", teamName: "Presentation" },
    { positionId: "vocalist", label: "Vocalist", teamId: "worship", teamName: "Worship" },
  ];
  const item = built.service.sections[0].items[0];
  built.service.sections[0].items[0] = {
    ...item,
    microphoneAssignments: [{
      microphone: { id: "mic-vocal", name: "Vocal mic", type: "Headset", color: "#22d3ee" },
      audiences: [{ positionId: "vocalist", roleName: "Vocalist", teamId: "worship", teamName: "Worship" }],
      holderName: "Avery Volunteer",
    }],
    equipmentAssignments: [{
      equipment: { id: "iem-1", name: "IEM 1", category: "iem" },
      holderName: "Avery Volunteer",
    }],
  };
  return built;
})();
const brandColors = {
  sectionLabelColor: "#a855f7",
  sectionBorderColor: "#06b6d4",
};

const RouteProbe = () => {
  const location = useLocation();
  return <div data-testid="controller-route">{location.pathname}{location.search}</div>;
};

const TestProviders = ({ children }: { children: React.ReactNode }) => (
  <Provider store={store}>
    <MemoryRouter initialEntries={["/controller/service-planning"]}>
      {children}
    </MemoryRouter>
  </Provider>
);

const renderWithStore = (ui: React.ReactElement) => render(ui, { wrapper: TestProviders });

const renderInFloatingWindow = (ui: React.ReactNode) => render(
  <Provider store={store}>
    <MemoryRouter initialEntries={["/controller/service-planning"]}>
      <FloatingWindowZIndexProvider>
        <FloatingWindow
          title="Service Plan"
          onClose={jest.fn()}
          resizable={false}
          defaultWidth={760}
          defaultHeight={620}
        >
          {ui}
        </FloatingWindow>
      </FloatingWindowZIndexProvider>
    </MemoryRouter>
  </Provider>,
);

const makePlanWithElement = (element: ServicePlanElement): ServicePlan => ({
  ...plan,
  sections: [{
    ...plan.sections[0],
    elements: [element],
  }],
});

const makeSongDoc = (id: string, lyrics: string): DBItem => ({
  _id: id,
  name: "Same Song",
  type: "song",
  selectedArrangement: 0,
  arrangements: [{
    id: `arrangement-${id}`,
    name: "Default",
    formattedLyrics: [{
      id: `verse-${id}`,
      type: "Verse",
      name: "Verse 1",
      words: lyrics,
    }],
    songOrder: [{ id: `verse-${id}`, name: "Verse 1" }],
    slides: [],
  }],
  slides: [],
  songMetadata: {
    source: "manual",
    trackName: "Same Song",
    artistName: `Artist for ${id}`,
    importedAt: "2026-10-11T12:00:00.000Z",
  },
  songLinks: [{ id: `link-${id}`, label: "Tutorial", url: "https://example.test/tutorial" }],
} as unknown as DBItem);

describe("ControllerServicePlanView", () => {
  beforeEach(() => {
    localStorage.clear();
    store.dispatch(updateAllSongDocs([]));
    store.dispatch(updateAllFreeFormDocs([]));
  });
  afterEach(() => {
    jest.restoreAllMocks();
    store.dispatch(updateAllSongDocs([]));
    store.dispatch(updateAllFreeFormDocs([]));
  });

  it("keeps quiet roster roles selectable while rendering compact controller rows", async () => {
    const user = userEvent.setup();
    renderWithStore(
      <ControllerServicePlanView
        {...brandColors}
        plan={plan}
        snapshot={snapshot}
        churchId="church-1"
        controllerProfileId="presentation"
        scrollbarWidth="auto"
      />,
    );

    expect(screen.getByRole("heading", { name: "Welcome" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Worship" })).toBeInTheDocument();
    expect(screen.getByText("Shared safety note")).toBeInTheDocument();
    expect(screen.getByText("Presentation team cue")).toBeInTheDocument();
    expect(screen.getByText("Vocal mic")).toBeInTheDocument();
    expect(screen.getByText("IEM 1 · Avery Volunteer")).toBeInTheDocument();
    expect(screen.getByText("18:00")).toBeInTheDocument();
    expect(screen.getByText("1:30")).toBeInTheDocument();
    expect(screen.getByText("Led by:")).toHaveClass("text-zinc-400");
    expect(screen.getByText("Jordan Rivera")).toHaveClass("text-white");
    expect(screen.getByRole("heading", { name: "Welcome" })).toHaveClass("min-w-0", "flex-1", "break-words", "whitespace-normal", "text-xs", "font-semibold");
    expect(screen.getByText("18:00")).toHaveClass("shrink-0");
    expect(screen.getByText("1:30")).toHaveClass("shrink-0");
    expect(screen.getByRole("button", { name: "View Web link: Run sheet" })).toHaveClass("border-neutral-700", "bg-neutral-900/80");
    expect(screen.getByTitle("Song: Opening Song")).toBeInTheDocument();
    expect(screen.getByTitle("Scripture: Psalm 100:1–5")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Worship" })).toHaveClass("px-2.5", "py-1.5");
    expect(screen.getByRole("heading", { name: "Worship" })).toHaveStyle({ color: brandColors.sectionLabelColor });
    expect(screen.getByRole("region", { name: "Service plan section: Worship" })).toHaveStyle({
      borderLeftColor: brandColors.sectionBorderColor,
    });
    expect(screen.getAllByRole("listitem")[0]).toHaveClass("flex", "px-2.5", "py-2");
    expect(screen.getByRole("button", { name: /Filter roles/ })).toHaveClass("!bg-zinc-900", "!border-zinc-700", "!h-7");

    await user.click(screen.getByRole("button", { name: /Filter roles/ }));
    expect(screen.getByRole("button", { name: "Presentation Operator" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Role options" })).toHaveStyle({
      "--scrollbar-width": "auto",
    });
  });

  it("filters microphones and role notes by the selected controller role", async () => {
    const user = userEvent.setup();
    renderWithStore(
      <ControllerServicePlanView
        {...brandColors}
        plan={plan}
        snapshot={snapshot}
        churchId="church-1"
        controllerProfileId="presentation"
      />,
    );

    await user.click(screen.getByRole("button", { name: /Filter roles/ }));
    await user.click(screen.getByRole("button", { name: "Presentation Operator" }));
    expect(screen.queryByText("Vocal mic")).not.toBeInTheDocument();
    expect(screen.queryByText("IEM 1 · Avery Volunteer")).not.toBeInTheDocument();
    expect(screen.getByText("Shared safety note")).toBeInTheDocument();
    expect(screen.getByText("Presentation team cue")).toBeInTheDocument();
    expect(screen.queryByText("Graphics team cue")).not.toBeInTheDocument();
    expect(screen.queryByText("Text team cue")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Text Master" }));
    expect(screen.getByText("Text team cue")).toBeInTheDocument();
  });

  it("persists profile-scoped filters and removes stale role ids", async () => {
    const key = "worship-sync:service-plan-operator:church-1:presentation";
    localStorage.setItem(key, JSON.stringify({ teamName: "Presentation", positionIds: ["text-master", "deleted-role"] }));
    renderWithStore(
      <ControllerServicePlanView
        {...brandColors}
        plan={plan}
        snapshot={snapshot}
        churchId="church-1"
        controllerProfileId="presentation"
      />,
    );

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(key) || "{}")).toEqual({
        teamName: "Presentation",
        positionIds: ["text-master"],
      });
    });
    expect(screen.getByRole("combobox", { name: "Team:" })).toHaveTextContent("Presentation");
    expect(within(screen.getByRole("button", { name: /Filter roles/ })).getByText("Text Master")).toBeInTheDocument();
  });

  it("keeps long notes and resources available without expanding the running order", async () => {
    const user = userEvent.setup();
    const longUrl = `https://example.test/${"very-long-resource-path/".repeat(20)}`;
    const resourcePlan = {
      ...plan,
      sections: [{
        ...plan.sections[0],
        elements: [{
          ...plan.sections[0].elements[0],
          notes: plainTextToRichText("A long shared note for the operator."),
          resources: [{ id: "long-url", type: "url" as const, title: "Dropbox link", url: longUrl }],
        }],
      }],
    };
    const resourceSnapshot = buildServicePlanFlowSnapshot({ plan: resourcePlan, startsAt: resourcePlan.startsAt! });
    renderWithStore(
      <ControllerServicePlanView
        {...brandColors}
        plan={resourcePlan}
        snapshot={resourceSnapshot}
        churchId="church-1"
        controllerProfileId="presentation"
      />,
    );

    expect(screen.getByText("Dropbox link")).toBeInTheDocument();
    expect(screen.queryByText(longUrl)).not.toBeInTheDocument();
    expect(screen.getByText(/View notes/)).toBeInTheDocument();
    expect(screen.getByRole("group")).not.toHaveAttribute("open");
    expect(screen.getByText("A long shared note for the operator.")).toBeInTheDocument();

    await user.click(screen.getByText(/View notes/));
    expect(screen.getByRole("group")).toHaveAttribute("open");
    await user.click(screen.getByRole("button", { name: "View Web link: Dropbox link" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("marks the live item clearly and supports an unpublished plan without a viewer snapshot", () => {
    const manualPlan = {
      ...plan,
      publicLive: { mode: "manual" as const, currentElementId: "welcome" },
    };
    renderWithStore(
      <ControllerServicePlanView
        {...brandColors}
        plan={manualPlan}
        churchId="church-1"
        controllerProfileId="presentation"
      />,
    );

    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.getByRole("listitem", { current: true })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("listitem", { current: true })).toHaveClass("border-emerald-400", "bg-emerald-500/[0.07]");
    expect(screen.getByText("Welcome")).toBeInTheDocument();
  });

  it("uses controller surfaces and ignores the standalone public-view theme preference", () => {
    localStorage.setItem("worshipsyncServicePublicTheme", "light");
    const getItem = jest.spyOn(Storage.prototype, "getItem");
    renderWithStore(
      <ControllerServicePlanView
        {...brandColors}
        plan={plan}
        snapshot={snapshot}
        churchId="church-1"
        controllerProfileId="presentation"
      />,
    );

    expect(getItem).not.toHaveBeenCalledWith("worshipsyncServicePublicTheme");
    expect(screen.getByLabelText("Selected service plan running order")).not.toHaveClass("text-gray-100");
    expect(screen.getByRole("heading", { name: "Worship" })).toHaveClass("bg-zinc-950/80");
  });

  it("uses the canonical manual plan override", () => {
    const manualPlan = {
      ...plan,
      publicLive: { mode: "manual" as const, currentElementId: "welcome" },
    };
    const liveSnapshot = buildServicePlanFlowSnapshot({
      plan: manualPlan,
      startsAt: manualPlan.startsAt!,
    });
    renderWithStore(
      <ControllerServicePlanView
        {...brandColors}
        plan={manualPlan}
        snapshot={liveSnapshot}
        churchId="church-1"
        controllerProfileId="presentation"
      />,
    );

    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.getByRole("listitem", { current: true })).toHaveAttribute("aria-current", "true");
  });

  it("highlights the scheduled item and stays unchanged when an outline item is selected", () => {
    const startsAt = new Date(Date.now() - 100_000).toISOString();
    const schedulePlan: ServicePlan = {
      ...plan,
      startsAt,
      sections: [{
        id: "section-1",
        name: "Worship",
        elements: [
          { ...plan.sections[0].elements[0], startTime: undefined, durationSeconds: 90 },
          {
            id: "song",
            type: "free",
            title: plainTextToRichText("Song"),
            durationSeconds: 120,
          },
        ],
      }],
    };
    const ui = (
      <ControllerServicePlanView
        {...brandColors}
        plan={schedulePlan}
        churchId="church-1"
        controllerProfileId="presentation"
      />
    );
    const { rerender } = renderWithStore(ui);

    const liveRow = screen.getByRole("listitem", { current: true });
    expect(within(liveRow).getByRole("heading", { name: "Song" })).toBeInTheDocument();
    expect(getServicePlanLiveProgress(schedulePlan, Date.now())?.current?.item.id).toBe("song");

    // Outline browsing updates Redux selection only. The plan's live row is
    // still determined by the service-flow schedule.
    store.dispatch(setActiveItemInList("outline-welcome"));
    rerender(ui);

    expect(screen.getAllByRole("listitem", { current: true })).toHaveLength(1);
    expect(within(screen.getByRole("listitem", { current: true })).getByRole("heading", { name: "Song" }))
      .toBeInTheDocument();
    expect(within(screen.getByRole("listitem", { current: true })).queryByRole("heading", { name: "Welcome" }))
      .not.toBeInTheDocument();
  });

  it("uses the anchored live timeline and agrees with public service progress", () => {
    const startedAt = new Date(Date.now() - 30_000).toISOString();
    const anchoredPlan: ServicePlan = {
      ...plan,
      publicLive: {
        mode: "anchored",
        currentElementId: "song",
        startedAt,
      },
      sections: [{
        ...plan.sections[0],
        elements: [
          { ...plan.sections[0].elements[0], startTime: undefined, durationSeconds: 90 },
          {
            id: "song",
            type: "free",
            title: plainTextToRichText("Song"),
            durationSeconds: 120,
          },
        ],
      }],
    };
    const publicSnapshot = buildServicePlanFlowSnapshot({
      plan: anchoredPlan,
      startsAt: anchoredPlan.startsAt!,
      serverNowMs: Date.now(),
    });
    const controllerProgress = getServicePlanLiveProgress(anchoredPlan, Date.now());
    const publicProgress = getServiceFlowProgress(publicSnapshot.service, Date.now());

    expect(controllerProgress?.current?.item.id).toBe("song");
    expect(controllerProgress?.current?.item.id).toBe(publicProgress.current?.item.id);

    renderWithStore(
      <ControllerServicePlanView
        {...brandColors}
        plan={anchoredPlan}
        snapshot={publicSnapshot}
        churchId="church-1"
        controllerProfileId="presentation"
      />,
    );
    expect(within(screen.getByRole("listitem", { current: true })).getByRole("heading", { name: "Song" }))
      .toBeInTheDocument();
  });

  it("filters the compact microphone cues by team while retaining shared notes", async () => {
    const user = userEvent.setup();
    renderWithStore(
      <ControllerServicePlanView
        {...brandColors}
        plan={plan}
        snapshot={snapshot}
        churchId="church-1"
        controllerProfileId="presentation"
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "Team:" }));
    await user.click(screen.getByRole("option", { name: "Presentation" }));
    expect(screen.queryByText("Vocal mic")).not.toBeInTheDocument();
    expect(screen.getByText("Shared safety note")).toBeInTheDocument();
  });

  it("opens current and legacy song attachments by their saved IDs in attachment order", async () => {
    const user = userEvent.setup();
    const firstSong = makeSongDoc("song-first", "Lyrics for song-first");
    const secondSong = makeSongDoc("song-second", "Lyrics for song-second");
    store.dispatch(updateAllSongDocs([firstSong, secondSong]));
    const element: ServicePlanElement = {
      id: "songs",
      type: "song",
      title: plainTextToRichText("Same Song"),
      songRefs: [{
        id: "legacy-song-first",
        kind: "library",
        songId: firstSong._id,
        songName: firstSong.name,
      }],
      resources: [{
        id: "current-song-second",
        type: "song",
        title: secondSong.name,
        data: {
          songRef: {
            kind: "library",
            songId: secondSong._id,
            songName: secondSong.name,
          },
        },
      }],
      contentOrder: ["current-song-second", "legacy-song-first"],
    };
    const songPlan = makePlanWithElement(element);
    const songSnapshot = buildServicePlanFlowSnapshot({
      plan: songPlan,
      startsAt: songPlan.startsAt!,
    });
    const outlineStateBefore = store.getState().itemList;
    const dispatchSpy = jest.spyOn(store, "dispatch");

    renderWithStore(
      <ControllerServicePlanView
        {...brandColors}
        plan={songPlan}
        snapshot={songSnapshot}
        churchId="church-1"
        controllerProfileId="presentation"
      />,
    );

    await user.click(screen.getByRole("button", {
      name: "View Song: Same Song (attachment 1 of 2)",
    }));
    expect(screen.getByRole("heading", { name: /Song details/ })).toBeInTheDocument();
    expect(screen.getByText("Lyrics for song-second")).toBeInTheDocument();
    expect(screen.getByText("Artist for song-second")).toBeInTheDocument();
    expect(screen.getByText("Tutorial")).toBeInTheDocument();
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(store.getState().itemList).toBe(outlineStateBefore);

    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", {
      name: "View Song: Same Song (attachment 2 of 2)",
    }));
    expect(screen.getByText("Lyrics for song-first")).toBeInTheDocument();
    expect(screen.queryByText("Lyrics for song-second")).not.toBeInTheDocument();
  });

  it("opens pending song lyrics and explains when a library song is missing", async () => {
    const user = userEvent.setup();
    const pendingElement: ServicePlanElement = {
      id: "pending-song",
      type: "song",
      title: plainTextToRichText("Pending song"),
      songRef: {
        id: "pending-song-reference",
        kind: "pending",
        title: "Pending song",
        lyricsText: "Attached pending lyrics",
      },
    };
    const pendingPlan = makePlanWithElement(pendingElement);
    renderWithStore(
      <ControllerServicePlanView
        {...brandColors}
        plan={pendingPlan}
        snapshot={buildServicePlanFlowSnapshot({
          plan: pendingPlan,
          startsAt: pendingPlan.startsAt!,
        })}
        churchId="church-1"
        controllerProfileId="presentation"
      />,
    );

    await user.click(screen.getByRole("button", { name: "View Song: Pending song" }));
    expect(screen.getByRole("heading", { name: "Lyrics — Pending song" })).toBeInTheDocument();
    expect(screen.getByText("Attached pending lyrics")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close" }));
    const missingElement: ServicePlanElement = {
      id: "missing-song",
      type: "song",
      title: plainTextToRichText("Missing song"),
      songRef: {
        kind: "library",
        songId: "deleted-song-id",
        songName: "Missing song",
      },
    };
    const missingPlan = makePlanWithElement(missingElement);
    renderWithStore(
      <ControllerServicePlanView
        {...brandColors}
        plan={missingPlan}
        snapshot={buildServicePlanFlowSnapshot({
          plan: missingPlan,
          startsAt: missingPlan.startsAt!,
        })}
        churchId="church-1"
        controllerProfileId="presentation"
      />,
    );
    await user.click(screen.getByRole("button", { name: "View Song: Missing song" }));
    expect(screen.getByText("This song is no longer available in the song library."))
      .toBeInTheDocument();
  });

  it("navigates scripture to the existing Bible route without changing the outline", async () => {
    const user = userEvent.setup();
    const scripturePlan = makePlanWithElement({
      id: "scripture",
      type: "free",
      title: plainTextToRichText("Reading"),
      resources: [{
        id: "john-passage",
        type: "scripture",
        title: "John 3:16–18 (NKJV)",
        data: {
          scripture: {
            id: "john-passage",
            label: "John 3:16–18 (NKJV)",
            book: "John",
            chapter: "3",
            verseRange: "16-18",
            version: "NKJV",
          },
        },
      }],
    });
    const outlineStateBefore = store.getState().itemList;
    const dispatchSpy = jest.spyOn(store, "dispatch");

    renderWithStore(
      <>
        <RouteProbe />
        <ControllerServicePlanView
          {...brandColors}
          plan={scripturePlan}
          snapshot={buildServicePlanFlowSnapshot({
            plan: scripturePlan,
            startsAt: scripturePlan.startsAt!,
          })}
          churchId="church-1"
          controllerProfileId="presentation"
        />
      </>,
    );

    await user.click(screen.getByRole("button", {
      name: "View Scripture: John 3:16–18 (NKJV)",
    }));
    expect(screen.getByTestId("controller-route"))
      .toHaveTextContent("/controller/bible?book=John&chapter=3&verses=16-18&version=NKJV");
    expect(store.getState().itemList).toBe(outlineStateBefore);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it("opens each custom-document attachment by ID and shows an unavailable state", async () => {
    const user = userEvent.setup();
    const firstDocument = {
      _id: "custom-document-first",
      name: "Same Deck",
      type: "free",
      slides: [{
        id: "slide-first",
        name: "First document slide",
        type: "Title",
        boxes: [{ id: "box-first", words: "First document content", width: 80, height: 20, x: 10, y: 10 }],
      }],
    } as unknown as DBItem;
    const secondDocument = {
      _id: "custom-document-second",
      name: "Same Deck",
      type: "free",
      slides: [{
        id: "slide-second",
        name: "Second document slide",
        type: "Title",
        boxes: [{ id: "box-second", words: "Second document content", width: 80, height: 20, x: 10, y: 10 }],
      }],
    } as unknown as DBItem;
    store.dispatch(updateAllFreeFormDocs([firstDocument, secondDocument]));
    const customPlan = makePlanWithElement({
      id: "custom-documents",
      type: "free",
      title: plainTextToRichText("Welcome"),
      resources: [
        {
          id: "custom-reference-first",
          type: "custom-document",
          title: "Same Deck",
          data: { customDocumentId: firstDocument._id },
        },
        {
          id: "custom-reference-second",
          type: "custom-document",
          title: "Same Deck",
          data: { customDocumentId: secondDocument._id },
        },
      ],
      contentOrder: ["custom-reference-second", "custom-reference-first"],
    });
    renderWithStore(
      <ControllerServicePlanView
        {...brandColors}
        plan={customPlan}
        snapshot={buildServicePlanFlowSnapshot({
          plan: customPlan,
          startsAt: customPlan.startsAt!,
        })}
        churchId="church-1"
        controllerProfileId="presentation"
      />,
    );

    await user.click(screen.getByRole("button", {
      name: "View Custom document: Same Deck (attachment 1 of 2)",
    }));
    expect(screen.getByRole("dialog", { name: "Same Deck" })).toBeInTheDocument();
    expect(screen.getByText("Second document slide")).toBeInTheDocument();
    expect(screen.getByText("Second document content")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", {
      name: "View Custom document: Same Deck (attachment 2 of 2)",
    }));
    expect(screen.getByText("First document slide")).toBeInTheDocument();
    expect(screen.getByText("First document content")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    const missingPlan = makePlanWithElement({
      id: "missing-custom",
      type: "free",
      title: plainTextToRichText("Welcome"),
      resources: [{
        id: "deleted-custom-reference",
        type: "custom-document",
        title: "Deleted slides",
        data: { customDocumentId: "deleted-custom-document" },
      }],
    });
    renderWithStore(
      <ControllerServicePlanView
        {...brandColors}
        plan={missingPlan}
        snapshot={buildServicePlanFlowSnapshot({
          plan: missingPlan,
          startsAt: missingPlan.startsAt!,
        })}
        churchId="church-1"
        controllerProfileId="presentation"
      />,
    );
    await user.click(screen.getByRole("button", { name: "View Custom document: Deleted slides" }));
    expect(screen.getByRole("status"))
      .toHaveTextContent("This custom document is no longer available in the library.");
  });

  it("keeps text and media resources on the established content preview", async () => {
    const user = userEvent.setup();
    const previewPlan = makePlanWithElement({
      id: "preview-resources",
      type: "free",
      title: plainTextToRichText("Resources"),
      resources: [
        {
          id: "notes-resource",
          type: "text",
          title: "Run notes",
          data: { text: "Previewable text content" },
        },
        {
          id: "image-resource",
          type: "image",
          title: "Backdrop",
          url: "https://example.test/backdrop.png",
        },
        {
          id: "scripture-link-resource",
          type: "scripture",
          title: "Scripture companion",
          url: "https://example.test/scripture",
        },
      ],
    });
    renderWithStore(
      <ControllerServicePlanView
        {...brandColors}
        plan={previewPlan}
        snapshot={buildServicePlanFlowSnapshot({
          plan: previewPlan,
          startsAt: previewPlan.startsAt!,
        })}
        churchId="church-1"
        controllerProfileId="presentation"
      />,
    );

    await user.click(screen.getByRole("button", { name: "View Notes: Run notes" }));
    expect(screen.getByText("Previewable text content")).toBeInTheDocument();
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("button", { name: "View Image: Backdrop" }));
    expect(screen.getByRole("dialog", { name: "Backdrop" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "View Scripture: Scripture companion" }));
    expect(screen.getByRole("dialog", { name: "Scripture companion" })).toBeInTheDocument();
  });

  it("keeps preview dialogs owned by the controller floating window and restores focus", async () => {
    const user = userEvent.setup();
    const customDocument: DBItem = {
      _id: "floating-window-document",
      name: "Floating window slides",
      type: "free",
      slides: [],
    } as unknown as DBItem;
    store.dispatch(updateAllFreeFormDocs([customDocument]));
    const floatingPlan = makePlanWithElement({
      id: "floating-window-preview",
      type: "free",
      title: plainTextToRichText("Welcome"),
      resources: [{
        id: "floating-window-reference",
        type: "custom-document",
        title: customDocument.name,
        data: { customDocumentId: customDocument._id },
      }],
    });

    renderInFloatingWindow(
      <ControllerServicePlanView
        {...brandColors}
        plan={floatingPlan}
        snapshot={buildServicePlanFlowSnapshot({
          plan: floatingPlan,
          startsAt: floatingPlan.startsAt!,
        })}
        churchId="church-1"
        controllerProfileId="presentation"
      />,
    );

    const trigger = screen.getByRole("button", {
      name: "View Custom document: Floating window slides",
    });
    trigger.focus();
    await user.keyboard("{Enter}");
    const overlayHost = screen.getByTestId("floating-window-overlay-host");
    expect(within(overlayHost).getByRole("dialog", {
      name: "Floating window slides",
    })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(within(overlayHost).queryByRole("dialog")).not.toBeInTheDocument();
  });
});
