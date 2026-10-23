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
  allItems: { list: never[]; isAllItemsLoading: boolean };
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
  allItems: { list: [], isAllItemsLoading: false },
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
  globalInfo: Record<string, unknown> = {},
) => ({ children }: PropsWithChildren) =>
  React.createElement(
    Provider,
    {
      store: store as never,
      children: React.createElement(
        ControllerInfoContext.Provider,
        { value: { db } as never },
        React.createElement(
          GlobalInfoContext.Provider,
          { value: globalInfo as never },
          children,
        ),
      ),
    },
  );

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

  it("previews and explicitly syncs native assignees with legacy rules disabled", async () => {
    jest.useFakeTimers();

    const existingOverlay: OverlayInfo = {
      id: "weekly-host",
      type: "participant",
      name: "Previous participant",
      title: "Previous title",
      event: "Panelist",
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
          people: [],
          sectionRules: [],
          elementRules: [],
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
          participantOverlay: { enabled: true, eventLabel: "Panelist" },
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
      duplicateExactMatchesAreAmbiguous: true,
      patch: {
        name: "Dr. Greg Baldeo",
        title: "Lead Pastor",
        event: "Panelist",
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
      event: "Panelist",
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
