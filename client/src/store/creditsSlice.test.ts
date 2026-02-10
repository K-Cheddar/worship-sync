import { configureStore } from "@reduxjs/toolkit";
import { creditsSlice } from "./creditsSlice";
import { createCreditsInfo } from "../test/fixtures";
import type { CreditsInfo } from "../types";

type CreditsState = {
  list: CreditsInfo[];
  publishedList: CreditsInfo[];
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

    it("updatePublishedCreditsList copies non-hidden from list", () => {
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
          publishedList: [],
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
      store.dispatch(creditsSlice.actions.updatePublishedCreditsList());
      const state = store.getState().credits;
      expect(state.publishedList).toHaveLength(1);
      expect(state.publishedList[0].heading).toBe("A");
    });

    it("updatePublishedCreditsList merges unique lines into creditsHistory by heading", () => {
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
          publishedList: [],
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
      store.dispatch(creditsSlice.actions.updatePublishedCreditsList());
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
          "Sermon": ["Pastor A", "Pastor B"],
        }),
      );
      expect(store.getState().credits.creditsHistory).toEqual({
        "Sermon": ["Pastor A", "Pastor B"],
      });
    });

    it("deleteCreditsHistoryEntry removes heading from creditsHistory", () => {
      const store = createStore({
        credits: {
          ...creditsSlice.getInitialState(),
          creditsHistory: { "Sermon": ["A"], "Invocation": ["B"] },
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
          creditsHistory: { "Sermon": ["A"], "Invocation": ["B"] },
        },
      });
      store.dispatch(
        creditsSlice.actions.updateCreditsHistoryEntry({
          heading: "Sermon",
          lines: ["X", "Y", "Z"],
        })
      );
      expect(store.getState().credits.creditsHistory).toEqual({
        Sermon: ["X", "Y", "Z"],
        Invocation: ["B"],
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
  });
});
