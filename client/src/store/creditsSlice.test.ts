import { configureStore } from "@reduxjs/toolkit";
import {
  applyRemoveLineFromCreditsHistoryMap,
  creditsSlice,
  flattenCreditsHistoryLines,
} from "./creditsSlice";
import { createCreditsInfo } from "../test/fixtures";
import type { CreditsInfo } from "../types";

type CreditsState = {
  list: CreditsInfo[];
  liveCredits: CreditsInfo[];
  creditsHistory: Record<string, string[]>;
  initialList: string[];
  isLoading: boolean;
  transitionScene: string;
  creditsScene: string;
  scheduleName: string;
  selectedCreditId: string;
  isInitialized: boolean;
};

type CreditsSliceState = { credits: CreditsState };

jest.mock("../utils/generateRandomId", () => ({
  __esModule: true,
  default: () => "fixed-credit-id",
}));

const createStore = (preloadedState?: Partial<CreditsSliceState>) =>
  configureStore({
    reducer: { credits: creditsSlice.reducer },
    ...(preloadedState != null &&
      Object.keys(preloadedState).length > 0 && {
        preloadedState: preloadedState as CreditsSliceState,
      }),
  });

describe("creditsSlice", () => {
  describe("flattenCreditsHistoryLines and applyRemoveLineFromCreditsHistoryMap", () => {
    it("flattenCreditsHistoryLines merges all headings and dedupes by trimmed case", () => {
      expect(
        flattenCreditsHistoryLines({
          A: ["  Zed ", "Bob"],
          B: ["bob", "Ann"],
        }),
      ).toEqual(["Ann", "Bob", "Zed"]);
    });

    it("applyRemoveLineFromCreditsHistoryMap removes a line from every heading", () => {
      const before = {
        A: ["X", "Shared"],
        B: ["Shared", "Y"],
      };
      const after = applyRemoveLineFromCreditsHistoryMap(before, "Shared");
      expect(after).toEqual({ A: ["X"], B: ["Y"] });
    });

    it("applyRemoveLineFromCreditsHistoryMap drops a heading when it becomes empty", () => {
      const before = { Only: ["gone"] };
      const after = applyRemoveLineFromCreditsHistoryMap(before, "gone");
      expect(after).toEqual({});
    });

    it("applyRemoveLineFromCreditsHistoryMap returns same reference when nothing matches", () => {
      const before = { A: ["X"] };
      const after = applyRemoveLineFromCreditsHistoryMap(before, "Nope");
      expect(after).toBe(before);
    });
  });

  describe("reducer only", () => {
    it("selectCredit sets selectedCreditId", () => {
      const store = createStore();
      store.dispatch(creditsSlice.actions.selectCredit("credit-1"));
      expect(store.getState().credits.selectedCreditId).toBe("credit-1");
    });

    it("setTransitionScene and setCreditsScene update state", () => {
      const store = createStore();
      store.dispatch(creditsSlice.actions.setTransitionScene("Transition"));
      store.dispatch(creditsSlice.actions.setCreditsScene("Credits"));
      expect(store.getState().credits.transitionScene).toBe("Transition");
      expect(store.getState().credits.creditsScene).toBe("Credits");
    });

    it("updateCreditsList replaces list", () => {
      const store = createStore();
      const list = [
        createCreditsInfo({ id: "1", heading: "H1", text: "T1" }),
        createCreditsInfo({ id: "2", heading: "H2", text: "T2" }),
      ];
      store.dispatch(creditsSlice.actions.updateCreditsList(list));
      expect(store.getState().credits.list).toHaveLength(2);
      expect(store.getState().credits.list[0].heading).toBe("H1");
    });

    it("syncVisibleCreditsMirrorAndHistory copies non-hidden from list", () => {
      const store = createStore({
        credits: {
          list: [
            createCreditsInfo({
              id: "1",
              heading: "A",
              text: "a",
              hidden: false,
            }),
            createCreditsInfo({
              id: "2",
              heading: "B",
              text: "b",
              hidden: true,
            }),
          ],
          liveCredits: [],
          creditsHistory: {},
          initialList: [],
          isLoading: false,
          transitionScene: "",
          creditsScene: "",
          scheduleName: "",
          selectedCreditId: "",
          isInitialized: true,
        },
      });
      store.dispatch(creditsSlice.actions.syncVisibleCreditsMirrorAndHistory());
      const state = store.getState().credits;
      expect(state.liveCredits).toHaveLength(1);
      expect(state.liveCredits[0].heading).toBe("A");
    });

    it("syncVisibleCreditsMirrorAndHistory merges unique lines into creditsHistory by heading", () => {
      const store = createStore({
        credits: {
          list: [
            createCreditsInfo({
              id: "1",
              heading: "Reading of the Word",
              text: "Alice\nBob",
              hidden: false,
            }),
            createCreditsInfo({
              id: "2",
              heading: "Reading of the Word",
              text: "Bob\nCarol",
              hidden: false,
            }),
          ],
          liveCredits: [],
          creditsHistory: {},
          initialList: [],
          isLoading: false,
          transitionScene: "",
          creditsScene: "",
          scheduleName: "",
          selectedCreditId: "",
          isInitialized: true,
        },
      });
      store.dispatch(creditsSlice.actions.syncVisibleCreditsMirrorAndHistory());
      const state = store.getState().credits;
      expect(state.creditsHistory["Reading of the Word"]).toEqual([
        "Alice",
        "Bob",
        "Carol",
      ]);
    });

    it("initiateCreditsHistory sets creditsHistory", () => {
      const store = createStore();
      store.dispatch(
        creditsSlice.actions.initiateCreditsHistory({
          Sermon: ["Pastor A", "Pastor B"],
        }),
      );
      expect(store.getState().credits.creditsHistory).toEqual({
        Sermon: ["Pastor A", "Pastor B"],
      });
    });

    it("deleteCreditsHistoryEntry removes heading from creditsHistory", () => {
      const store = createStore({
        credits: {
          ...creditsSlice.getInitialState(),
          creditsHistory: { Sermon: ["A"], Invocation: ["B"] },
        },
      });
      store.dispatch(creditsSlice.actions.deleteCreditsHistoryEntry("Sermon"));
      expect(store.getState().credits.creditsHistory).toEqual({
        Invocation: ["B"],
      });
    });

    it("updateCreditsHistoryEntry sets lines for heading", () => {
      const store = createStore({
        credits: {
          ...creditsSlice.getInitialState(),
          creditsHistory: { Sermon: ["A"], Invocation: ["B"] },
        },
      });
      store.dispatch(
        creditsSlice.actions.updateCreditsHistoryEntry({
          heading: "Sermon",
          lines: ["X", "Y", "Z"],
        }),
      );
      expect(store.getState().credits.creditsHistory).toEqual({
        Sermon: ["X", "Y", "Z"],
        Invocation: ["B"],
      });
    });

    it("removeCreditsHistoryLineEverywhere removes a line from all headings", () => {
      const store = createStore({
        credits: {
          ...creditsSlice.getInitialState(),
          creditsHistory: { Sermon: ["Dup"], Invocation: ["Dup", "Keep"] },
        },
      });
      store.dispatch(
        creditsSlice.actions.removeCreditsHistoryLineEverywhere("Dup"),
      );
      expect(store.getState().credits.creditsHistory).toEqual({
        Invocation: ["Keep"],
      });
    });

    it("initiateCreditsList with payload sets list and preserves ids", () => {
      const store = createStore();
      const list = [
        createCreditsInfo({ id: "old-1", heading: "H1", text: "T1" }),
      ];
      store.dispatch(creditsSlice.actions.initiateCreditsList(list));
      const state = store.getState().credits;
      expect(state.list).toHaveLength(1);
      expect(state.list[0].heading).toBe("H1");
      expect(state.list[0].id).toBe("old-1");
      expect(state.isInitialized).toBe(true);
    });

    it("addCredit appends when no credit is selected", () => {
      const store = createStore();
      const credit = createCreditsInfo({ id: "c1", heading: "H1" });
      store.dispatch(creditsSlice.actions.addCredit(credit));
      expect(store.getState().credits.list.some((c) => c.id === "c1")).toBe(true);
      expect(store.getState().credits.selectedCreditId).toBe("c1");
    });

    it("addCredit inserts after the selected credit", () => {
      const store = createStore();
      const c1 = createCreditsInfo({ id: "c1", heading: "H1" });
      const c2 = createCreditsInfo({ id: "c2", heading: "H2" });
      const c3 = createCreditsInfo({ id: "c3", heading: "H3" });
      store.dispatch(creditsSlice.actions.initiateCreditsList([c1, c2]));
      store.dispatch(creditsSlice.actions.selectCredit("c1"));
      store.dispatch(creditsSlice.actions.addCredit(c3));
      const list = store.getState().credits.list;
      expect(list[1].id).toBe("c3");
    });

    it("deleteCredit removes a credit by id", () => {
      const store = createStore();
      store.dispatch(
        creditsSlice.actions.initiateCreditsList([
          createCreditsInfo({ id: "c1", heading: "H1" }),
          createCreditsInfo({ id: "c2", heading: "H2" }),
        ]),
      );
      store.dispatch(creditsSlice.actions.deleteCredit("c1"));
      expect(store.getState().credits.list).toHaveLength(1);
      expect(store.getState().credits.list[0].id).toBe("c2");
    });

    it("updateCredit replaces the matching credit", () => {
      const store = createStore();
      store.dispatch(
        creditsSlice.actions.initiateCreditsList([
          createCreditsInfo({ id: "c1", heading: "Old" }),
        ]),
      );
      store.dispatch(
        creditsSlice.actions.updateCredit(
          createCreditsInfo({ id: "c1", heading: "Updated" }),
        ),
      );
      expect(store.getState().credits.list[0].heading).toBe("Updated");
    });

    it("updateInitialList snapshots the current list ids", () => {
      const store = createStore();
      store.dispatch(
        creditsSlice.actions.initiateCreditsList([
          createCreditsInfo({ id: "c1", heading: "H1" }),
        ]),
      );
      store.dispatch(creditsSlice.actions.addCredit(createCreditsInfo({ id: "c2", heading: "H2" })));
      store.dispatch(creditsSlice.actions.updateInitialList());
      expect(store.getState().credits.initialList).toContain("c2");
    });

    it("setIsLoading sets the flag", () => {
      const store = createStore();
      store.dispatch(creditsSlice.actions.setIsLoading(false));
      expect(store.getState().credits.isLoading).toBe(false);
    });

    it("setScheduleName sets the schedule name", () => {
      const store = createStore();
      store.dispatch(creditsSlice.actions.setScheduleName("Sunday Morning"));
      expect(store.getState().credits.scheduleName).toBe("Sunday Morning");
    });

    it("setIsInitialized sets the flag", () => {
      const store = createStore();
      store.dispatch(creditsSlice.actions.setIsInitialized(true));
      expect(store.getState().credits.isInitialized).toBe(true);
    });

    it("initiateTransitionScene and initiateCreditsScene set scenes", () => {
      const store = createStore();
      store.dispatch(creditsSlice.actions.initiateTransitionScene("scene-t"));
      store.dispatch(creditsSlice.actions.initiateCreditsScene("scene-c"));
      expect(store.getState().credits.transitionScene).toBe("scene-t");
      expect(store.getState().credits.creditsScene).toBe("scene-c");
    });

    it("initiateLiveCredits sets live credits from payload", () => {
      const store = createStore();
      store.dispatch(
        creditsSlice.actions.initiateLiveCredits([
          createCreditsInfo({ id: "lc1", heading: "Live H1" }),
        ]),
      );
      expect(store.getState().credits.liveCredits).toHaveLength(1);
    });

    it("initiateLiveCredits clears list when payload is empty", () => {
      const store = createStore();
      store.dispatch(creditsSlice.actions.initiateLiveCredits([]));
      expect(store.getState().credits.liveCredits).toHaveLength(0);
    });

    it("updateCreditsListFromRemote replaces list from remote", () => {
      const store = createStore();
      store.dispatch(
        creditsSlice.actions.updateCreditsListFromRemote([
          createCreditsInfo({ id: "r1", heading: "Remote" }),
        ]),
      );
      expect(store.getState().credits.list).toHaveLength(1);
    });

    it("updateCreditsListFromRemote clears list when remote is empty", () => {
      const store = createStore();
      store.dispatch(creditsSlice.actions.initiateCreditsList([
        createCreditsInfo({ id: "c1", heading: "H1" }),
      ]));
      store.dispatch(creditsSlice.actions.updateCreditsListFromRemote([]));
      expect(store.getState().credits.list).toHaveLength(0);
    });

    it("updateLiveCreditsFromRemote replaces live credits from remote", () => {
      const store = createStore();
      store.dispatch(
        creditsSlice.actions.updateLiveCreditsFromRemote([
          createCreditsInfo({ id: "r1", heading: "Remote Live" }),
        ]),
      );
      expect(store.getState().credits.liveCredits).toHaveLength(1);
    });

    it("updateLiveCreditsFromRemote clears live credits when remote is empty", () => {
      const store = createStore();
      store.dispatch(creditsSlice.actions.updateLiveCreditsFromRemote([]));
      expect(store.getState().credits.liveCredits).toHaveLength(0);
    });

    it("forceUpdate is a no-op that does not throw", () => {
      const store = createStore();
      expect(() => store.dispatch(creditsSlice.actions.forceUpdate())).not.toThrow();
    });
  });
});
