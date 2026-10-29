import React, { type PropsWithChildren } from "react";
import { act, renderHook } from "@testing-library/react";
import { configureStore, type UnknownAction } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import {
  dedupeOutlineCandidatesForPreview,
  getChangedOverlayPatch,
  getRepeatedOverlayDedupeKey,
  overlayPlanHasExecutableChange,
  useServicePlanningImport,
  type ExecutableOverlaySyncPlanItem,
} from "./useServicePlanningImport";
import { buildServicePlanningPreview } from "../integrations/servicePlanning/buildServicePlanningPreview";
import type { OutlineItemCandidate } from "../types/servicePlanningImport";
import type { OverlayInfo } from "../types";
import type { ServicePlanningConfig } from "../types/integrations";
import { createDefaultChurchIntegrations } from "../types/integrations";
import { ControllerInfoContext } from "../context/controllerInfo";
import { GlobalInfoContext } from "../context/globalInfo";
import overlaysReducer, {
  addExistingOverlayToList,
  initiateOverlayList,
  updateOverlayInList,
} from "../store/overlaysSlice";
import { overlaySlice } from "../store/overlaySlice";
import { normalizeOverlayForSync } from "../utils/overlayUtils";
import { plainTextToRichText } from "../types/richText";

type SyncTestState = {
  allDocs: { allSongDocs: never[]; allFreeFormDocs: never[] };
  undoable: {
    present: {
      overlays: ReturnType<typeof overlaysReducer>;
      overlay: ReturnType<typeof overlaySlice.reducer>;
      itemList: { list: never[] };
      itemLists: { selectedList: null; activeList: null };
      preferences: { preferences: Record<string, unknown> };
      overlayTemplates: {
        templatesByType: Record<string, never[]>;
        defaultTemplateIdsByType: Record<string, string>;
      };
    };
  };
  presentation: { participantOverlayInfo: Partial<OverlayInfo> };
};

const initialSyncTestState: SyncTestState = {
  allDocs: { allSongDocs: [], allFreeFormDocs: [] },
  undoable: {
    present: {
      overlays: overlaysReducer(undefined, { type: "test/init" }),
      overlay: overlaySlice.reducer(undefined, { type: "test/init" }),
      itemList: { list: [] },
      itemLists: { selectedList: null, activeList: null },
      preferences: {
        preferences: {
          defaultBibleBackground: { background: {}, mediaInfo: undefined },
          defaultBibleBackgroundBrightness: 0,
          defaultBibleFontMode: "default",
        },
      },
      overlayTemplates: {
        templatesByType: {},
        defaultTemplateIdsByType: {},
      },
    },
  },
  presentation: { participantOverlayInfo: { id: "on-air", name: "On Air" } },
};

const createSyncTestStore = (initialOverlays: OverlayInfo[]) => {
  const reducer = (
    state: SyncTestState = initialSyncTestState,
    action: UnknownAction,
  ): SyncTestState => ({
    ...state,
    undoable: {
      ...state.undoable,
      present: {
        ...state.undoable.present,
        overlays: overlaysReducer(state.undoable.present.overlays, action),
        overlay: overlaySlice.reducer(state.undoable.present.overlay, action),
      },
    },
  });
  const store = configureStore({ reducer });
  store.dispatch(initiateOverlayList(initialOverlays));
  return store;
};

const servicePlanningHookWrapper = (
  store: ReturnType<typeof createSyncTestStore>,
  db: { get: (id: string) => Promise<unknown>; put: (doc: unknown) => Promise<unknown> },
  globalInfo: Record<string, unknown> | (() => Record<string, unknown>) = {},
) => {
  const contextDb = { allDocs: jest.fn(async () => ({ rows: [] })), ...db };
  const getGlobalInfo = typeof globalInfo === "function"
    ? globalInfo
    : () => Object.keys(globalInfo).length
      ? globalInfo
      : {
          churchId: "test-church",
          churchIntegrationsStatus: "ready",
          churchIntegrations: createDefaultChurchIntegrations(),
        };
  return ({ children }: PropsWithChildren) => React.createElement(
    Provider,
    {
      store: store as never,
      children: React.createElement(
        ControllerInfoContext.Provider,
        { value: { db: contextDb } as never },
        React.createElement(
          GlobalInfoContext.Provider,
          { value: getGlobalInfo() as never },
          children,
        ),
      ),
    },
  );
};

const makeSongCandidate = (
  overrides: Partial<OutlineItemCandidate> = {},
): OutlineItemCandidate => ({
  sectionName: "Worship",
  headingName: "Praise",
  elementType: "Song of Praise",
  title: "You Deserve It (F)",
  outlineItemType: "song",
  cleanedTitle: "You Deserve It",
  matchedLibraryItem: null,
  parsedRef: null,
  overlayReady: false,
  outlineAlreadyPresent: false,
  ...overrides,
  sourceRowIndex: overrides.sourceRowIndex ?? 0,
});

describe("dedupeOutlineCandidatesForPreview", () => {
  it("removes duplicate song rows that would collapse into the same heading", () => {
    const deduped = dedupeOutlineCandidatesForPreview([
      makeSongCandidate(),
      makeSongCandidate({ title: "You Deserve It (F) reprise" }),
      makeSongCandidate({ title: "You Deserve It (F) tag" }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].cleanedTitle).toBe("You Deserve It");
  });

  it("keeps the same song when it belongs under a different heading", () => {
    const deduped = dedupeOutlineCandidatesForPreview([
      makeSongCandidate({ headingName: "Praise" }),
      makeSongCandidate({ headingName: "Response" }),
    ]);

    expect(deduped).toHaveLength(2);
  });
});

describe("getChangedOverlayPatch", () => {
  const overlay: OverlayInfo = {
    id: "overlay-1",
    type: "participant",
    name: "Avery",
    title: "Host",
    event: "Welcome",
  };

  it("returns no changes when the mapped fields already match", () => {
    expect(
      getChangedOverlayPatch(overlay, {
        name: "Avery",
        title: "Host",
        event: "Welcome",
      }),
    ).toEqual({});
  });

  it("returns only fields that differ", () => {
    expect(
      getChangedOverlayPatch(overlay, {
        name: "Avery",
        title: "Speaker",
        event: "Welcome",
      }),
    ).toEqual({ title: "Speaker" });
  });

  it("clears an existing title when the service plan has no matching title", () => {
    expect(
      getChangedOverlayPatch(overlay, {
        name: "Avery",
        title: undefined,
        event: "Welcome",
      }),
    ).toEqual({ title: undefined });
  });
});

describe("getRepeatedOverlayDedupeKey", () => {
  it("returns a stable key when the rule opts into repeated-overlay dedupe", () => {
    expect(
      getRepeatedOverlayDedupeKey(
        {
          rule: {
            id: "song-rule",
            dedupeRepeatedOverlays: true,
          },
        } as any,
        {
          patch: {
            name: "Desmond Dunkley",
            title: "Praise God",
            event: "Song of Praise",
          },
        },
      ),
    ).toBe("song-rule::Desmond Dunkley::Praise God::Song of Praise");
  });

  it("returns null when repeated-overlay dedupe is off", () => {
    expect(
      getRepeatedOverlayDedupeKey(
        {
          rule: {
            id: "song-rule",
            dedupeRepeatedOverlays: false,
          },
        } as any,
        {
          patch: {
            name: "Desmond Dunkley",
            title: "Praise God",
            event: "Song of Praise",
          },
        },
      ),
    ).toBeNull();
  });
});

describe("overlayPlanHasExecutableChange", () => {
  it("does not treat existing-overlay placement as executable by itself", () => {
    const overlays: OverlayInfo[] = [
      { id: "welcome", type: "participant", event: "Welcome", name: "Avery" },
      {
        id: "sabbath",
        type: "participant",
        event: "Sabbath School",
        name: "Taylor",
      },
    ];

    expect(
      overlayPlanHasExecutableChange(
        [
          {
            sectionName: "",
            sourceRowIndex: 0,
            elementType: "Sabbath School",
            title: "",
            ledBy: "",
            personIndex: 0,
            rawNameToken: "Taylor",
            action: "update",
            placementOnly: true,
            targetOverlayId: "sabbath",
            patch: {
              name: "Taylor",
              event: "Sabbath School",
              title: undefined,
            },
          },
        ],
        overlays,
      ),
    ).toBe(false);
  });

  it("does not treat an already positioned overlay as executable by itself", () => {
    const overlays: OverlayInfo[] = [
      {
        id: "sabbath",
        type: "participant",
        event: "Sabbath School",
        name: "Taylor",
      },
    ];

    expect(
      overlayPlanHasExecutableChange(
        [
          {
            sectionName: "",
            sourceRowIndex: 0,
            elementType: "Sabbath School",
            title: "",
            ledBy: "",
            personIndex: 0,
            rawNameToken: "Taylor",
            action: "update",
            placementOnly: true,
            targetOverlayId: "sabbath",
            patch: {
              name: "Taylor",
              event: "Sabbath School",
              title: undefined,
            },
          },
        ],
        overlays,
      ),
    ).toBe(false);
  });
});

describe("useServicePlanningImport overlay execution", () => {
  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it.each([false, true])("previews and syncs native assignees with URL import disabled and a matching rule=%s", async (withRule) => {
    jest.useFakeTimers();
    const event = withRule ? "Sabbath School Panelist" : "Panelist";

    const existingOverlay: OverlayInfo = {
      id: "weekly-host",
      type: "participant",
      name: "Previous participant",
      title: "Previous title",
      event,
      description: "Keep this note",
      formatting: { participantOverlayPosition: "left" },
    };
    let storedDoc: Record<string, unknown> = {
      _id: "overlay-weekly-host",
      _rev: "1-a",
      docType: "overlay",
      ...existingOverlay,
    };
    const db = {
      get: jest.fn(async () => ({ ...storedDoc })),
      put: jest.fn(async (doc: unknown) => {
        storedDoc = { ...(doc as Record<string, unknown>), _rev: "2-b" };
        return { ok: true, rev: "2-b" };
      }),
    };
    const store = createSyncTestStore([existingOverlay]);
    const wrapper = servicePlanningHookWrapper(store, db, {
      churchId: "church-1",
      churchIntegrationsStatus: "ready",
      churchIntegrations: {
        servicePlanning: {
          enabled: false,
          people: [{ id: "legacy", names: ["Dr. Greg Baldeo"], displayName: "Legacy Name", title: "Legacy Title" }],
          sectionRules: [],
          elementRules: withRule ? [{
            id: "lesson",
            matchElementType: "Sabbath School Lesson Study",
            matchMode: "contains",
            displayName: "Sabbath School",
            nameSources: ["title", "ledBy"],
            multiOverlay: { mode: "split", eventSuffixByPersonIndex: ["Panelist"] },
          }] : [],
        },
      },
    });
    const { result } = renderHook(() => useServicePlanningImport(), { wrapper });
    const nativePlan = {
      planKey: "service@2026-10-18",
      name: "Sunday service",
      sections: [{
        id: "section-1",
        name: "Worship",
        elements: [{
          id: "element-panel",
          type: "free" as const,
          title: plainTextToRichText("Sabbath School Lesson Study"),
          positionId: "position-worship",
          participantOverlay: withRule ? undefined : { eventLabel: "Panelist" },
          assignees: [{ id: "assignee-1", memberId: "member-1", name: "Old name" }],
        }],
      }],
    };
    const participantOverlay = {
      status: "ready" as const,
      elements: [{
        elementId: "element-panel",
        assignees: [{
          name: "Dr. Greg Baldeo",
          memberStatus: "resolved" as const,
          roleStatus: "resolved" as const,
          roleTitle: "Lead Pastor",
        }],
      }],
    };

    let outline!: Awaited<ReturnType<typeof result.current.loadPlanPreview>>;
    await act(async () => {
      outline = await result.current.loadPlanPreview(nativePlan, [], participantOverlay);
    });

    expect(result.current.isServicePlanningEnabled).toBe(false);
    expect(outline.preview.overlayPlan).toHaveLength(1);
    expect(outline.preview.overlayPlan[0]).toMatchObject({
      action: "update",
      targetOverlayId: "weekly-host",
      sourceKind: "native",
      patch: {
        name: "Dr. Greg Baldeo",
        title: "Lead Pastor",
        event,
      },
    });
    const step = outline.preview.overlayPlan[0] as ExecutableOverlaySyncPlanItem;
    expect(step.action).toBe("update");

    let executionResult!: Awaited<ReturnType<typeof result.current.executeOverlaySyncStep>>;
    await act(async () => {
      const pending = result.current.executeOverlaySyncStep(step);
      await jest.advanceTimersByTimeAsync(500);
      executionResult = await pending;
    });

    expect(executionResult.overlaysUpdated).toBe(1);
    expect(storedDoc).toMatchObject({
      name: "Dr. Greg Baldeo",
      title: "Lead Pastor",
      event,
      description: "Keep this note",
      formatting: { participantOverlayPosition: "left" },
    });
  });

  it("rechecks stale create steps, replaces manual names, and preserves persisted order and settings", async () => {
    jest.useFakeTimers();

    const reusableOverlay: OverlayInfo = {
      id: "weekly-host",
      type: "participant",
      name: "Manual Name",
      title: "Manual Title",
      event: "Sabbath School Host",
      description: "Local note",
      formatting: { participantOverlayPosition: "left" },
      servicePlanSource: {
        planKey: "service@2026-09-25",
        elementId: "element-previous",
        candidateId: "element-previous:0",
      },
      servicePlanBaseline: { name: "Old plan value" },
      servicePlanOverrides: { name: true },
    };
    const otherOverlay: OverlayInfo = {
      id: "benediction",
      type: "participant",
      name: "Other Person",
      event: "Benediction",
      formatting: { participantOverlayPosition: "center" },
    };
    let storedDoc = {
      _id: "overlay-weekly-host",
      _rev: "1-a",
      docType: "overlay",
      ...reusableOverlay,
      // Another controller's newer unrelated fields are in Pouch already,
      // although this controller has not received their overlay-list echo yet.
      description: "Remote note",
      formatting: { participantOverlayPosition: "right" as const },
    };
    const get = jest.fn(async () => ({ ...storedDoc }));
    const put = jest.fn(async (doc: unknown) => {
      storedDoc = {
        ...(doc as typeof storedDoc),
        _rev: "2-b",
      };
      return { ok: true, rev: "2-b" };
    });
    const db = { get, put };
    const store = createSyncTestStore([reusableOverlay, otherOverlay]);
    const { result } = renderHook(() => useServicePlanningImport(), {
      wrapper: servicePlanningHookWrapper(store, db),
    });
    const orderBefore = store
      .getState()
      .undoable.present.overlays.list.map((overlay) => overlay.id);
    const livePresentationBefore = store.getState().presentation;
    expect(store.getState().undoable.present.overlays.list[0].name).toBe(
      "Manual Name",
    );

    const staleCreateStep = {
      action: "create" as const,
      sectionName: "",
      sourceRowIndex: 0,
      elementType: "Sabbath School Lesson Study",
      title: "Current Reader",
      ledBy: "Current Plan Name",
      personIndex: 0,
      rawNameToken: "Current Plan Name",
      patch: {
        name: "Current Plan Name",
        title: "Current Reader",
        event: "Sabbath School Host",
      },
    };

    let firstResult: Awaited<ReturnType<typeof result.current.executeOverlaySyncStep>>;
    await act(async () => {
      const pending = result.current.executeOverlaySyncStep(staleCreateStep);
      await jest.advanceTimersByTimeAsync(500);
      firstResult = await pending;
    });

    expect(firstResult!).toMatchObject({
      overlaysUpdated: 1,
      overlaysCreated: 0,
      resultOverlayId: "weekly-host",
    });
    expect(storedDoc).toMatchObject({
      name: "Current Plan Name",
      title: "Current Reader",
      event: "Sabbath School Host",
      description: "Remote note",
      formatting: { participantOverlayPosition: "right" },
    });
    expect(
      store.getState().undoable.present.overlays.list.map((overlay) => overlay.id),
    ).toEqual(orderBefore);
    expect(
      store.getState().undoable.present.overlays.list[0],
    ).toMatchObject({
      id: "weekly-host",
      name: "Current Plan Name",
      formatting: { participantOverlayPosition: "right" },
      description: "Remote note",
    });
    expect(store.getState().presentation).toEqual(livePresentationBefore);

    let repeatedResult: Awaited<ReturnType<typeof result.current.executeOverlaySyncStep>>;
    await act(async () => {
      repeatedResult = await result.current.executeOverlaySyncStep(staleCreateStep);
    });
    expect(repeatedResult!).toMatchObject({
      overlaysUpdated: 0,
      overlaysCreated: 0,
      overlaysSkipped: 1,
      resultOverlayId: "weekly-host",
    });
    expect(put).toHaveBeenCalledTimes(1);

    // A second controller loading the shared persisted overlay keeps the same
    // configured order and sees the refreshed values.
    const secondControllerStore = createSyncTestStore([
      normalizeOverlayForSync(storedDoc),
      otherOverlay,
    ]);
    expect(
      secondControllerStore
        .getState()
        .undoable.present.overlays.list.map((overlay) => overlay.id),
    ).toEqual(orderBefore);
    expect(
      secondControllerStore.getState().undoable.present.overlays.list[0].name,
    ).toBe("Current Plan Name");
  });

  it("applies every mapped field from preview when one changes after preview", async () => {
    jest.useFakeTimers();

    const overlay: OverlayInfo = {
      id: "weekly-host",
      type: "participant",
      name: "James",
      title: "Elder",
      event: "Sabbath School Host",
    };
    const servicePlanning: ServicePlanningConfig = {
      enabled: true,
      people: [
        {
          id: "michael",
          names: ["Michael"],
          displayName: "Michael",
          title: "Elder",
        },
      ],
      sectionRules: [],
      elementRules: [
        {
          id: "sabbath-school",
          matchElementType: "Sabbath School",
          matchMode: "exact",
          displayName: "Sabbath School Host",
          nameSources: ["ledBy"],
          multiOverlay: { mode: "single" },
        },
      ],
    };
    const preview = buildServicePlanningPreview({
      importData: {
        planLabel: "This week",
        sections: [
          {
            sectionName: "Worship",
            rows: [
              {
                elementType: "Sabbath School",
                title: "Sabbath School",
                ledBy: "Michael",
              },
            ],
          },
        ],
        teamAssignments: [],
      },
      servicePlanning,
      overlays: [overlay],
      songLibrary: [],
      activeOutlineList: [],
    });
    const step = preview.overlayPlan[0];
    expect(step).toMatchObject({
      action: "update",
      targetOverlayId: "weekly-host",
      patch: {
        name: "Michael",
        title: "Elder",
        event: "Sabbath School Host",
      },
    });
    if (step.action !== "update") throw new Error("Expected an update step");
    const executionStep = { ...step, action: "update" as const };

    let storedDoc: Record<string, unknown> = {
      _id: "overlay-weekly-host",
      _rev: "1-a",
      docType: "overlay",
      ...overlay,
    };
    const db = {
      get: jest.fn(async () => ({ ...storedDoc })),
      put: jest.fn(async (doc: unknown) => {
        storedDoc = { ...(doc as Record<string, unknown>), _rev: "2-b" };
        return { ok: true, rev: "2-b" };
      }),
    };
    const store = createSyncTestStore([overlay]);
    const { result } = renderHook(() => useServicePlanningImport(), {
      wrapper: servicePlanningHookWrapper(store, db),
    });

    // The unchanged title became a manual edit after preview was built.
    store.dispatch(updateOverlayInList({ id: "weekly-host", title: "Pastor" }));

    await act(async () => {
      const pending = result.current.executeOverlaySyncStep(executionStep);
      await jest.advanceTimersByTimeAsync(500);
      await pending;
    });

    expect(storedDoc).toMatchObject({
      name: "Michael",
      title: "Elder",
      event: "Sabbath School Host",
    });
  });

  it("creates a genuinely unmatched event after existing overlays and persists it", async () => {
    jest.useFakeTimers();

    const existing: OverlayInfo[] = [
      { id: "sabbath", type: "participant", event: "Sabbath School Host" },
      { id: "benediction", type: "participant", event: "Benediction" },
    ];
    const createdDocs: unknown[] = [];
    const db = {
      get: jest.fn(async () => { throw new Error("No template document"); }),
      put: jest.fn(async (doc: unknown) => {
        createdDocs.push(doc);
        return { ok: true, rev: "1-new" };
      }),
    };
    const store = createSyncTestStore(existing);
    const { result } = renderHook(() => useServicePlanningImport(), {
      wrapper: servicePlanningHookWrapper(store, db),
    });
    const step = {
      action: "create" as const,
      sectionName: "",
      sourceRowIndex: 0,
      elementType: "Offering",
      title: "Deacon",
      ledBy: "Jordan",
      personIndex: 0,
      rawNameToken: "Jordan",
      patch: { name: "Jordan", title: "Deacon", event: "Offering" },
    };
    const orderBefore = store
      .getState()
      .undoable.present.overlays.list.map((overlay) => overlay.id);

    let executionResult: Awaited<ReturnType<typeof result.current.executeOverlaySyncStep>>;
    await act(async () => {
      const pending = result.current.executeOverlaySyncStep(step);
      await jest.advanceTimersByTimeAsync(500);
      executionResult = await pending;
    });

    expect(executionResult!).toMatchObject({ overlaysCreated: 1 });
    expect(createdDocs).toHaveLength(1);
    const created = store.getState().undoable.present.overlays.list;
    expect(created.slice(1).map((overlay) => overlay.id)).toEqual(orderBefore);
    expect(created[0]).toMatchObject({
      name: "Jordan",
      title: "Deacon",
      event: "Offering",
    });
  });

  it("revalidates a planned update when its original target no longer matches", async () => {
    jest.useFakeTimers();

    const staleTarget: OverlayInfo = {
      id: "stale-target",
      type: "participant",
      name: "Keep this person",
      event: "Sabbath School Host",
    };
    const replacement: OverlayInfo = {
      id: "current-match",
      type: "participant",
      name: "Old current person",
      event: "Sabbath School Host",
    };
    const docs: Record<string, Record<string, unknown>> = {
      "overlay-stale-target": {
        _id: "overlay-stale-target",
        _rev: "1-stale",
        docType: "overlay",
        ...staleTarget,
      },
      "overlay-current-match": {
        _id: "overlay-current-match",
        _rev: "1-current",
        docType: "overlay",
        ...replacement,
      },
    };
    const db = {
      get: jest.fn(async (id: string) => {
        if (!docs[id]) throw new Error(`Missing ${id}`);
        return { ...docs[id] };
      }),
      put: jest.fn(async (doc: unknown) => {
        const saved: Record<string, unknown> = {
          ...(doc as Record<string, unknown>),
          _rev: "2-current",
        };
        docs[String(saved["_id"])] = saved;
        return { ok: true, rev: "2-current" };
      }),
    };
    const store = createSyncTestStore([staleTarget]);
    const { result } = renderHook(() => useServicePlanningImport(), {
      wrapper: servicePlanningHookWrapper(store, db),
    });

    // The overlay changed after preview, and another controller added a row
    // that now owns the planned event.
    store.dispatch(updateOverlayInList({ id: "stale-target", event: "Prayer" }));
    store.dispatch(addExistingOverlayToList({ overlay: replacement }));

    let executionResult: Awaited<ReturnType<typeof result.current.executeOverlaySyncStep>>;
    await act(async () => {
      const pending = result.current.executeOverlaySyncStep({
        action: "update",
        sectionName: "",
        sourceRowIndex: 0,
        elementType: "Sabbath School Lesson Study",
        title: "Reader",
        ledBy: "New current person",
        personIndex: 0,
        rawNameToken: "New current person",
        targetOverlayId: "stale-target",
        patch: {
          name: "New current person",
          title: "Reader",
          event: "Sabbath School Host",
        },
      });
      await jest.advanceTimersByTimeAsync(500);
      executionResult = await pending;
    });

    expect(executionResult!).toMatchObject({
      overlaysUpdated: 1,
      resultOverlayId: "current-match",
    });
    expect(
      store.getState().undoable.present.overlays.list.find(
        (overlay) => overlay.id === "stale-target",
      ),
    ).toMatchObject({ name: "Keep this person", event: "Prayer" });
    expect(docs["overlay-current-match"]).toMatchObject({
      name: "New current person",
      title: "Reader",
      event: "Sabbath School Host",
    });
    expect(db.get).toHaveBeenCalledWith("overlay-current-match");
    expect(db.get).not.toHaveBeenCalledWith("overlay-stale-target");
  });
});


describe("native overlay mapping readiness", () => {
  afterEach(() => jest.useRealTimers());

  const makeNativePlan = () => ({
    planKey: "service-1@2026-10-25",
    name: "Sabbath Service",
    sourceImport: undefined,
    sections: [{
      id: "worship",
      name: "Worship",
      elements: [
        {
          id: "sermon",
          type: "free" as const,
          title: plainTextToRichText("Sermon"),
          sourceElementTypeRaw: "Sermon",
          assignees: [
            { id: "speaker-a", name: "Avery" },
            { id: "speaker-b", name: "Jordan" },
          ],
        },
        {
          id: "prayer",
          type: "free" as const,
          title: plainTextToRichText("Prayer"),
          sourceElementTypeRaw: "Prayer",
          assignees: [{ id: "reader", name: "Casey" }],
        },
      ],
    }],
  });

  const makeProjection = () => ({
    status: "ready" as const,
    elements: [
      {
        elementId: "sermon",
        assignees: ["Avery", "Jordan"].map((name) => ({
          name,
          memberStatus: "guest" as const,
          roleStatus: "not-applicable" as const,
        })),
      },
      {
        elementId: "prayer",
        assignees: [{
          name: "Casey",
          memberStatus: "guest" as const,
          roleStatus: "not-applicable" as const,
        }],
      },
    ],
  });

  const makeIntegrationSettings = (eventLabel = "Custom Event") => {
    const integrations = createDefaultChurchIntegrations();
    integrations.servicePlanning.elementRules = [
      {
        id: "sermon-rule",
        matchElementType: "Sermon",
        matchMode: "exact",
        overlaySyncEnabled: true,
        displayName: eventLabel,
        nameSources: ["ledBy"],
        multiOverlay: {
          mode: "split",
          eventSuffixByPersonIndex: ["First", "Second"],
        },
      },
      {
        id: "prayer-rule",
        matchElementType: "Prayer",
        matchMode: "exact",
        overlaySyncEnabled: false,
        displayName: "Disabled Prayer",
        nameSources: ["ledBy"],
        multiOverlay: { mode: "single" },
      },
    ];
    return integrations;
  };

  const makeDb = (allDocs = jest.fn(async () => ({ rows: [] }))) => ({
    allDocs,
    get: jest.fn(async (id: string) => ({ _id: id, _rev: "1-a", docType: "overlay" })),
    put: jest.fn(async () => ({ rev: "2-b" })),
  });

  it("keeps default preview internal until settings arrive, then syncs only the latest mapping", async () => {
    const store = createSyncTestStore([]);
    const db = makeDb();
    const sourcePlan = makeNativePlan();
    let globalInfo: Record<string, unknown> = {
      churchId: "church-1",
      churchIntegrationsStatus: "loading",
    };
    const { result, rerender } = renderHook(() => useServicePlanningImport(), {
      wrapper: servicePlanningHookWrapper(store, db, () => globalInfo),
    });

    let defaultPreview!: Awaited<ReturnType<typeof result.current.loadPlanPreview>>["preview"];
    await act(async () => {
      defaultPreview = (await result.current.loadPlanPreview(sourcePlan, [], makeProjection())).preview;
    });
    expect(defaultPreview.overlayCandidates.flatMap((row) => row.candidates.map((candidate) => candidate.patch.event)))
      .toEqual(["Sermon", "Sermon", "Prayer"]);
    expect(result.current.isNativeOverlayPreviewFresh(defaultPreview)).toBe(false);
    await expect(result.current.runImport(defaultPreview, { overlays: true, outline: false }))
      .rejects.toThrow(/settings are still loading/i);
    await expect(result.current.runImport(defaultPreview, { overlays: false, outline: true }))
      .resolves.toMatchObject({ outlineInserted: 0, overlaysUpdated: 0 });
    expect(db.put).not.toHaveBeenCalled();

    globalInfo = {
      churchId: "church-1",
      churchIntegrationsStatus: "ready",
      churchIntegrations: makeIntegrationSettings(),
    };
    rerender();
    let configuredPreview!: Awaited<ReturnType<typeof result.current.loadPlanPreview>>["preview"];
    await act(async () => {
      configuredPreview = (await result.current.loadPlanPreview(sourcePlan, [], makeProjection())).preview;
    });
    expect(result.current.isNativeOverlayPreviewFresh(configuredPreview)).toBe(true);
    expect(configuredPreview.overlayCandidates.flatMap((row) => row.candidates.map((candidate) => candidate.patch.event)))
      .toEqual(["Custom Event First", "Custom Event Second"]);
    expect(configuredPreview.nativeOverlaySummary?.selectedItemCount).toBe(1);
    expect(result.current.planOverlaySyncSteps(configuredPreview).steps).toHaveLength(2);

    await act(async () => {
      await result.current.runImport(configuredPreview, { overlays: true, outline: false });
    });
    expect(store.getState().undoable.present.overlays.list.map(({ event }) => event))
      .toEqual(["Custom Event First", "Custom Event Second"]);
    expect(db.put).toHaveBeenCalledTimes(2);
  });

  it("rejects a preview or pending overlay step after mapping settings change", async () => {
    jest.useFakeTimers();
    const store = createSyncTestStore([{
      id: "target",
      type: "participant",
      name: "Old name",
      event: "Custom Event First",
    }]);
    const db = makeDb();
    const sourcePlan = makeNativePlan();
    let globalInfo: Record<string, unknown> = {
      churchId: "church-1",
      churchIntegrationsStatus: "ready",
      churchIntegrations: makeIntegrationSettings(),
    };
    const { result, rerender } = renderHook(() => useServicePlanningImport(), {
      wrapper: servicePlanningHookWrapper(store, db, () => globalInfo),
    });
    let preview!: Awaited<ReturnType<typeof result.current.loadPlanPreview>>["preview"];
    await act(async () => {
      preview = (await result.current.loadPlanPreview(sourcePlan, [], makeProjection())).preview;
    });

    let pending!: Promise<unknown>;
    await act(async () => {
      pending = result.current.runImport(preview, { overlays: true, outline: false });
      await Promise.resolve();
    });
    const pendingResult = pending.then(
      () => new Error("Expected the stale overlay sync to reject."),
      (error: unknown) => error as Error,
    );
    expect(db.put).not.toHaveBeenCalled();

    globalInfo = {
      churchId: "church-1",
      churchIntegrationsStatus: "ready",
      churchIntegrations: makeIntegrationSettings("Changed Event"),
    };
    rerender();
    await act(async () => { await jest.runAllTimersAsync(); });
    expect((await pendingResult).message).toMatch(/settings changed/i);
    expect(db.put).not.toHaveBeenCalled();
    expect(store.getState().undoable.present.overlays.list[0]).toMatchObject({
      id: "target",
      name: "Old name",
      event: "Custom Event First",
    });
    expect(result.current.isNativeOverlayPreviewFresh(preview)).toBe(false);
  });

  it("keeps native preview freshness when an unrelated rule option changes", async () => {
    const store = createSyncTestStore([]);
    const db = makeDb();
    const integrations = makeIntegrationSettings();
    let globalInfo: Record<string, unknown> = {
      churchId: "church-1",
      churchIntegrationsStatus: "ready",
      churchIntegrations: integrations,
    };
    const { result, rerender } = renderHook(() => useServicePlanningImport(), {
      wrapper: servicePlanningHookWrapper(store, db, () => globalInfo),
    });
    let preview!: Awaited<ReturnType<typeof result.current.loadPlanPreview>>["preview"];
    await act(async () => {
      preview = (await result.current.loadPlanPreview(makeNativePlan(), [], makeProjection())).preview;
    });
    const mappingKey = result.current.nativeOverlayMappingKey;

    const changedIntegrations = makeIntegrationSettings();
    changedIntegrations.servicePlanning.elementRules[0].dedupeRepeatedOverlays = true;
    globalInfo = { ...globalInfo, churchIntegrations: changedIntegrations };
    rerender();

    expect(result.current.nativeOverlayMappingKey).toBe(mappingKey);
    expect(result.current.isNativeOverlayPreviewFresh(preview)).toBe(true);
  });
});

describe("native overlay synchronization batches", () => {
  afterEach(() => jest.useRealTimers());

  const makePlan = (items: Array<{ name: string; event: string; song?: string; phase?: "pre" | "main" | "post" }>) => ({
    plan: {
      planKey: "sabbath@2026-10-25",
      name: "Sabbath Service",
      sections: items.map((item, index) => ({
        id: `section-${index}`,
        name: "Worship",
        phase: item.phase,
        elements: [{
          id: `item-${index}`,
          type: item.song ? "song" as const : "free" as const,
          title: plainTextToRichText(item.event),
          assignees: [{ id: `assignee-${index}`, name: item.name }],
          ...(item.song ? { songRef: { kind: "pending" as const, title: item.song, lyricsText: "Lyrics" } } : {}),
        }],
      })),
    },
    projection: {
      status: "ready" as const,
      elements: items.map((item, index) => ({
        elementId: `item-${index}`,
        assignees: [{ name: item.name, memberStatus: "guest" as const, roleStatus: "not-applicable" as const }],
      })),
    },
  });

  const memoryDb = (overlays: OverlayInfo[]) => {
    const docs = new Map(overlays.map((overlay) => [`overlay-${overlay.id}`, {
      ...overlay, _id: `overlay-${overlay.id}`, _rev: "1-a", docType: "overlay",
    }]));
    return {
      docs,
      allDocs: jest.fn(async () => ({ rows: [...docs.values()].map((doc) => ({ doc })) })),
      get: jest.fn(async (id: string) => {
        const doc = docs.get(id);
        if (!doc) throw new Error(`Missing ${id}`);
        return { ...doc };
      }),
      put: jest.fn(async (raw: unknown) => {
        const doc = raw as ReturnType<typeof docs.get> & { _id: string };
        docs.set(doc._id, { ...doc, _rev: "2-b" });
        return { rev: "2-b" };
      }),
    };
  };

  it("reuses co-hosts, repeated songs, sermon and offertory; copies library songs; leaves unused and excluded overlays intact on two runs", async () => {
    jest.useFakeTimers();
    const cohost = "Sabbath School Co-Host";
    const songEvent = "Song of Praise";
    const existing: OverlayInfo[] = [
      ...["Gillian Cornwall", "Kameal Anderson", "Alrae Spence"].map((name, index) => ({
        id: `cohost-${index}`, name, title: "Previous title", event: cohost,
        formatting: { participantOverlayPosition: "right" as const }, description: "Keep description",
      })),
      { id: "ryann", name: "Ryann", event: "Sermon" },
      { id: "samuel", name: "Samuel Muir", event: "Sermon" },
      { id: "roshaun", name: "Roshaun", event: "Sermon" },
      ...[0, 1, 2].map((index) => ({ id: `god-is-${index}`, name: "Praise Team", title: "God Is", event: songEvent })),
      { id: "my-jesus", name: "Praise Team", title: "My Jesus, I Love Thee", event: songEvent },
      { id: "offertory", name: "Treasurer Name", title: "Old title", event: "Offertory", duration: 12 },
      { id: "welcome-1", name: "Pastoral Team", event: "Welcome & Announcements" },
      { id: "welcome-2", name: "Pastoral Team", event: "Welcome & Announcements" },
      { id: "prayer-1", name: "Pastoral Team", event: "Call to Prayer" },
      { id: "prayer-2", name: "Pastoral Team", event: "Call to Prayer" },
      { id: "pre", name: "Previous pre", event: "Prelude" },
      { id: "post", name: "Previous post", event: "Postlude" },
    ];
    const librarySong: OverlayInfo = {
      id: "library-song", name: "Praise Team", title: "Just Want to Praise You", event: songEvent,
      formatting: { participantOverlayPosition: "left" }, duration: 18, description: "Library style",
    };
    const db = memoryDb([...existing, librarySong]);
    const originalLibrary = { ...db.docs.get("overlay-library-song") };
    const store = createSyncTestStore(existing);
    const before = store.getState().undoable.present.overlays.list;
    const liveBefore = store.getState().presentation;
    const { result } = renderHook(() => useServicePlanningImport(), {
      wrapper: servicePlanningHookWrapper(store, db),
    });
    const source = makePlan([
      { name: "Clifton Anderson", event: cohost },
      { name: "Orville Mullings", event: cohost },
      { name: "Praise Team", event: songEvent, song: "Just Want to Praise You" },
      ...[0, 1, 2].map(() => ({ name: "Praise Team", event: songEvent, song: "God Is" })),
      { name: "Praise Team", event: songEvent, song: "My Jesus, I Love Thee" },
      { name: "Samuel Muir", event: "Sermon" },
      { name: "Gorphine Tomlinson", event: "Offertory", phase: "main" },
      { name: "Pastoral Team", event: "Welcome & Announcements" },
      { name: "Pastoral Team", event: "Call to Prayer" },
      { name: "New pre", event: "Prelude", phase: "pre" },
      { name: "New post", event: "Postlude", phase: "post" },
    ]);
    let preview!: Awaited<ReturnType<typeof result.current.loadPlanPreview>>["preview"];
    await act(async () => {
      preview = (await result.current.loadPlanPreview(source.plan, [], source.projection)).preview;
    });
    expect(preview.overlayPlan.map((step) => step.targetOverlayId)).toEqual([
      "cohost-0", "cohost-1", "library-song", "god-is-0", "god-is-1", "god-is-2", "my-jesus", "samuel", "offertory", "welcome-1", "prayer-1",
    ]);
    expect(preview.overlayPlan[2]).toMatchObject({ action: "clone", targetOverlaySource: "library", patch: { title: "Just Want to Praise You" } });
    expect(preview.nativeOverlaySummary?.selectedItemCount).toBe(11);
    const planned = result.current.planOverlaySyncSteps(preview);
    expect(planned.steps)
      .toEqual(preview.overlayPlan.filter((step) => step.action !== "skip"));
    expect(planned.steps.every((step) => step.nativeOverlayMappingKey === preview.nativeOverlayMappingKey))
      .toBe(true);

    await act(async () => {
      const pending = result.current.runImport(preview, { overlays: true, outline: false });
      await jest.runAllTimersAsync();
      expect((await pending).overlaysUpdated).toBe(4);
    });
    const after = store.getState().undoable.present.overlays.list;
    expect(after).toHaveLength(existing.length + 1);
    for (const id of ["cohost-2", "ryann", "roshaun", "welcome-2", "prayer-2", "pre", "post"]) {
      expect(after.find((overlay) => overlay.id === id)).toEqual(before.find((overlay) => overlay.id === id));
    }
    expect(after.find((overlay) => overlay.id === "cohost-0")).toMatchObject({
      name: "Clifton Anderson", title: "", formatting: { participantOverlayPosition: "right" }, description: "Keep description",
    });
    expect(after.find((overlay) => overlay.id === "offertory")).toMatchObject({ name: "Gorphine Tomlinson", title: "", duration: 12 });
    const copied = after.find((overlay) => !existing.some((old) => old.id === overlay.id));
    expect(copied).toMatchObject({ title: librarySong.title, duration: 18, description: "Library style", formatting: { participantOverlayPosition: "left" } });
    expect(copied?.id).not.toBe(librarySong.id);
    expect(db.docs.get("overlay-library-song")).toEqual(originalLibrary);
    expect(store.getState().presentation).toBe(liveBefore);
    expect(overlayPlanHasExecutableChange(preview.overlayPlan, after)).toBe(false);
    const writes = db.put.mock.calls.length;

    // Reuse the original preview, as the mounted Controller does after sync.
    await act(async () => {
      const pending = result.current.runImport(preview, { overlays: true, outline: false });
      await jest.runAllTimersAsync();
      expect((await pending).overlaysUpdated).toBe(0);
    });
    expect(db.put).toHaveBeenCalledTimes(writes);
    expect(store.getState().undoable.present.overlays.list).toEqual(after);
    expect(db.docs.size).toBe(existing.length + 2);
  });

  it("keeps exact targets reserved when a fallback is executed first", async () => {
    jest.useFakeTimers();
    const db = memoryDb([
      { id: "samuel", name: "Samuel Muir", event: "Sermon" },
      { id: "spare", name: "Roshaun", event: "Sermon" },
    ]);
    const store = createSyncTestStore([...db.docs.values()]);
    const { result } = renderHook(() => useServicePlanningImport(), { wrapper: servicePlanningHookWrapper(store, db) });
    const source = makePlan([{ name: "New Speaker", event: "Sermon" }, { name: "Samuel Muir", event: "Sermon" }]);
    let preview!: Awaited<ReturnType<typeof result.current.loadPlanPreview>>["preview"];
    await act(async () => { preview = (await result.current.loadPlanPreview(source.plan, [], source.projection)).preview; });
    expect(preview.overlayPlan.map((step) => step.targetOverlayId)).toEqual(["spare", "samuel"]);
    await act(async () => {
      const steps = result.current.planOverlaySyncSteps(preview).steps;
      const pending = result.current.executeOverlaySyncStep(steps[0]);
      await jest.runAllTimersAsync();
      expect((await pending).resultOverlayId).toBe("spare");
      expect((await result.current.executeOverlaySyncStep(steps[1], { claimedOverlayIds: new Set(["spare"]) })).resultOverlayId).toBe("samuel");
    });
    expect(db.put).toHaveBeenCalledTimes(1);
    expect(db.docs.get("overlay-samuel")?.name).toBe("Samuel Muir");
  });

  it("uses the same active-list target in preview and execution before an exact library match", async () => {
    jest.useFakeTimers();
    const active: OverlayInfo = {
      id: "active-sermon",
      name: "Previous Speaker",
      title: "Pastor",
      event: "Sermon",
      duration: 14,
      formatting: { participantOverlayPosition: "right" },
      description: "Keep this note",
    };
    const library: OverlayInfo = {
      id: "library-sermon",
      name: "New Speaker",
      title: "Guest Pastor",
      event: "Sermon",
      duration: 7,
      description: "Library template",
    };
    const unrelated: OverlayInfo = {
      id: "unrelated-overlay",
      name: "Host",
      event: "Welcome",
      formatting: { participantOverlayPosition: "left" },
    };
    const db = memoryDb([active, library]);
    const libraryBefore = { ...db.docs.get("overlay-library-sermon") };
    const store = createSyncTestStore([active, unrelated]);
    const { result } = renderHook(() => useServicePlanningImport(), {
      wrapper: servicePlanningHookWrapper(store, db),
    });
    const source = makePlan([{ name: "New Speaker", event: "Sermon" }]);
    let preview!: Awaited<ReturnType<typeof result.current.loadPlanPreview>>["preview"];
    await act(async () => {
      preview = (await result.current.loadPlanPreview(source.plan, [], source.projection)).preview;
    });

    expect(preview.overlayPlan[0]).toMatchObject({ action: "update", targetOverlayId: "active-sermon" });
    const step = result.current.planOverlaySyncSteps(preview).steps[0];
    expect(step).toMatchObject({ action: "update", targetOverlayId: preview.overlayPlan[0].targetOverlayId });
    await act(async () => {
      const pending = result.current.executeOverlaySyncStep(step);
      await jest.runAllTimersAsync();
      expect(await pending).toMatchObject({ overlaysUpdated: 1, resultOverlayId: "active-sermon" });
    });

    const after = store.getState().undoable.present.overlays.list;
    expect(after.map((overlay) => overlay.id)).toEqual(["active-sermon", "unrelated-overlay"]);
    expect(after[0]).toMatchObject({
      id: "active-sermon",
      name: "New Speaker",
      title: "",
      event: "Sermon",
      duration: 14,
      formatting: { participantOverlayPosition: "right" },
      description: "Keep this note",
    });
    expect(db.docs.get("overlay-library-sermon")).toEqual(libraryBefore);
  });

  it("resumes after a partial create failure without duplicating the durable first overlay", async () => {
    jest.useFakeTimers();
    const db = memoryDb([]);
    const save = db.put.getMockImplementation()!;
    db.put.mockImplementationOnce(save).mockRejectedValueOnce(new Error("Save unavailable"));
    const store = createSyncTestStore([]);
    const { result } = renderHook(() => useServicePlanningImport(), { wrapper: servicePlanningHookWrapper(store, db) });
    const source = makePlan([{ name: "Clifton Anderson", event: "Co-Host" }, { name: "Orville Mullings", event: "Co-Host" }]);
    let preview!: Awaited<ReturnType<typeof result.current.loadPlanPreview>>["preview"];
    await act(async () => { preview = (await result.current.loadPlanPreview(source.plan, [], source.projection)).preview; });
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      await act(async () => {
        const failed = result.current.runImport(preview, { overlays: true, outline: false }).catch((error: Error) => error);
        await jest.runAllTimersAsync();
        expect(await failed).toEqual(new Error("Save unavailable"));
      });
      const durableId = store.getState().undoable.present.overlays.list[0].id;
      await act(async () => {
        const pending = result.current.runImport(preview, { overlays: true, outline: false });
        await jest.runAllTimersAsync();
        expect((await pending).overlaysUpdated).toBe(1);
      });
      const overlays = store.getState().undoable.present.overlays.list;
      expect(overlays).toHaveLength(2);
      expect(overlays.find((overlay) => overlay.name === "Clifton Anderson")?.id).toBe(durableId);
      expect(db.docs.size).toBe(2);
      expect(db.put).toHaveBeenCalledTimes(3);
    } finally {
      log.mockRestore();
    }
  });

  it("skips a changed native target rather than rematching another same-event overlay", async () => {
    const db = memoryDb([{ id: "target", name: "Samuel Muir", event: "Sermon" }, { id: "other", name: "Ryann", event: "Sermon" }]);
    const store = createSyncTestStore([...db.docs.values()]);
    const { result } = renderHook(() => useServicePlanningImport(), { wrapper: servicePlanningHookWrapper(store, db) });
    const source = makePlan([{ name: "Samuel Muir", event: "Sermon" }]);
    let preview!: Awaited<ReturnType<typeof result.current.loadPlanPreview>>["preview"];
    await act(async () => { preview = (await result.current.loadPlanPreview(source.plan, [], source.projection)).preview; });
    const step = result.current.planOverlaySyncSteps(preview).steps[0];
    store.dispatch(updateOverlayInList({ id: "target", event: "Prayer" }));
    await act(async () => {
      expect(await result.current.executeOverlaySyncStep(step)).toMatchObject({ overlaysSkipped: 1, reasons: [expect.stringMatching(/refresh/i)] });
    });
    expect(db.put).not.toHaveBeenCalled();
    expect(store.getState().undoable.present.overlays.list[1].name).toBe("Ryann");
  });

  it("finishes an in-flight write in its original database without updating the new church's same-ID overlay", async () => {
    jest.useFakeTimers();
    const original = { id: "same-id", name: "Original", event: "Sermon" };
    const dbA = memoryDb([original]);
    const dbB = memoryDb([{ ...original, name: "Church B" }]);
    let finishWrite!: () => void;
    const save = dbA.put.getMockImplementation()!;
    dbA.put.mockImplementationOnce(async (doc: unknown) => {
      await new Promise<void>((resolve) => { finishWrite = resolve; });
      return save(doc);
    });
    const store = createSyncTestStore([original]);
    let context = { db: dbA, churchId: "church-a" };
    const wrapper = ({ children }: PropsWithChildren) => React.createElement(Provider, { store, children:
      React.createElement(ControllerInfoContext.Provider, { value: { db: context.db } as never },
        React.createElement(GlobalInfoContext.Provider, { value: {
          churchId: context.churchId,
          churchIntegrationsStatus: "ready",
          churchIntegrations: createDefaultChurchIntegrations(),
        } as never }, children)),
    });
    const { result, rerender } = renderHook(() => useServicePlanningImport(), { wrapper });
    const step: ExecutableOverlaySyncPlanItem = { sourceKind: "native", nativeOverlayMappingKey: result.current.nativeOverlayMappingKey, action: "update", targetOverlayId: "same-id", sectionName: "", sourceRowIndex: 0, elementType: "Sermon", title: "Sermon", ledBy: "", personIndex: 0, rawNameToken: "New", patch: { name: "New", title: "", event: "Sermon" } };
    let pending!: ReturnType<typeof result.current.executeOverlaySyncStep>;
    await act(async () => { pending = result.current.executeOverlaySyncStep(step); await jest.advanceTimersByTimeAsync(500); });
    expect(dbA.put).toHaveBeenCalledTimes(1);
    context = { db: dbB, churchId: "church-b" };
    act(() => { store.dispatch(initiateOverlayList([{ ...original, name: "Church B" }])); });
    rerender();
    await act(async () => { finishWrite(); await pending; });
    expect(dbA.docs.get("overlay-same-id")?.name).toBe("New");
    expect(dbB.put).not.toHaveBeenCalled();
    expect(dbB.get).not.toHaveBeenCalled();
    expect(store.getState().undoable.present.overlays.list[0].name).toBe("Church B");
  });

  it("does not copy a library overlay after the hook unmounts during its read", async () => {
    const library = { id: "library", name: "Guest", event: "Sermon" };
    const db = memoryDb([library]);
    let resolveRead!: (doc: Awaited<ReturnType<typeof db.get>>) => void;
    db.get.mockImplementationOnce(() => new Promise((resolve) => { resolveRead = resolve; }));
    const store = createSyncTestStore([]);
    const { result, unmount } = renderHook(() => useServicePlanningImport(), { wrapper: servicePlanningHookWrapper(store, db) });
    const step: ExecutableOverlaySyncPlanItem = { sourceKind: "native", nativeOverlayMappingKey: result.current.nativeOverlayMappingKey, action: "clone", targetOverlaySource: "library", targetOverlayId: "library", sectionName: "", sourceRowIndex: 0, elementType: "Sermon", title: "Sermon", ledBy: "", personIndex: 0, rawNameToken: "Guest", patch: { name: "Guest", title: "", event: "Sermon" } };
    const pending = result.current.executeOverlaySyncStep(step);
    unmount();
    resolveRead(db.docs.get("overlay-library")!);
    expect(await pending).toMatchObject({ overlaysSkipped: 1 });
    expect(db.put).not.toHaveBeenCalled();
    expect(store.getState().undoable.present.overlays.list).toEqual([]);
  });

});
