import { configureStore } from "@reduxjs/toolkit";
import overlayTemplatesReducer, {
  initiateTemplates,
  setIsInitialized,
  addTemplate,
  updateTemplate,
  deleteTemplate,
  updateTemplatesFromRemote,
  setIsLoading,
  setHasPendingUpdate,
} from "./overlayTemplatesSlice";
import type { OverlayFormatting, SavedTemplate } from "../types";

const createStore = () =>
  configureStore({ reducer: { overlayTemplates: overlayTemplatesReducer } });

const makeTemplate = (id: string, name: string): SavedTemplate => ({
  id,
  name,
  formatting: {} as OverlayFormatting,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
});

describe("overlayTemplatesSlice", () => {
  describe("initial state", () => {
    it("starts with empty template lists and not initialized", () => {
      const store = createStore();
      const state = store.getState().overlayTemplates;
      expect(state.isInitialized).toBe(false);
      expect(state.isLoading).toBe(false);
      expect(state.hasPendingUpdate).toBe(false);
      expect(state.templatesByType.participant).toHaveLength(0);
    });
  });

  describe("initiateTemplates", () => {
    it("sets templates, marks initialized, and clears loading", () => {
      const store = createStore();
      store.dispatch(
        initiateTemplates({
          participant: [makeTemplate("t1", "T1")],
          "stick-to-bottom": [],
          "qr-code": [],
          image: [],
        }),
      );
      const state = store.getState().overlayTemplates;
      expect(state.isInitialized).toBe(true);
      expect(state.isLoading).toBe(false);
      expect(state.templatesByType.participant).toHaveLength(1);
      expect(state.templatesByType.participant[0].name).toBe("T1");
    });

    it("uses empty defaults when called with undefined", () => {
      const store = createStore();
      store.dispatch(initiateTemplates(undefined));
      const state = store.getState().overlayTemplates;
      expect(state.isInitialized).toBe(true);
      expect(state.templatesByType.participant).toHaveLength(0);
    });
  });

  describe("setIsInitialized", () => {
    it("sets isInitialized flag", () => {
      const store = createStore();
      store.dispatch(setIsInitialized(true));
      expect(store.getState().overlayTemplates.isInitialized).toBe(true);
    });
  });

  describe("addTemplate", () => {
    it("appends a template to the correct overlay type list", () => {
      const store = createStore();
      store.dispatch(
        addTemplate({ type: "participant", template: makeTemplate("t1", "T1") }),
      );
      const state = store.getState().overlayTemplates;
      expect(state.templatesByType.participant).toHaveLength(1);
      expect(state.templatesByType.participant[0].id).toBe("t1");
      expect(state.hasPendingUpdate).toBe(true);
    });

    it("does not affect other overlay type lists", () => {
      const store = createStore();
      store.dispatch(
        addTemplate({ type: "participant", template: makeTemplate("t1", "T1") }),
      );
      expect(
        store.getState().overlayTemplates.templatesByType["stick-to-bottom"],
      ).toHaveLength(0);
    });
  });

  describe("updateTemplate", () => {
    it("updates an existing template by id", () => {
      const store = createStore();
      store.dispatch(
        addTemplate({
          type: "participant",
          template: makeTemplate("t1", "Original"),
        }),
      );
      store.dispatch(
        updateTemplate({
          type: "participant",
          templateId: "t1",
          updates: { name: "Updated" },
        }),
      );
      expect(
        store.getState().overlayTemplates.templatesByType.participant[0].name,
      ).toBe("Updated");
      expect(store.getState().overlayTemplates.hasPendingUpdate).toBe(true);
    });

    it("does not update when the template id is not found", () => {
      const store = createStore();
      store.dispatch(
        addTemplate({
          type: "participant",
          template: makeTemplate("t1", "Original"),
        }),
      );
      store.dispatch(
        updateTemplate({
          type: "participant",
          templateId: "missing",
          updates: { name: "Updated" },
        }),
      );
      expect(
        store.getState().overlayTemplates.templatesByType.participant[0].name,
      ).toBe("Original");
    });
  });

  describe("deleteTemplate", () => {
    it("removes a template by id and sets hasPendingUpdate", () => {
      const store = createStore();
      store.dispatch(
        addTemplate({ type: "participant", template: makeTemplate("t1", "T1") }),
      );
      store.dispatch(addTemplate({ type: "participant", template: makeTemplate("t2", "T2") }));
      store.dispatch(deleteTemplate({ type: "participant", templateId: "t1" }));
      const templates = store.getState().overlayTemplates.templatesByType.participant;
      expect(templates).toHaveLength(1);
      expect(templates[0].id).toBe("t2");
      expect(store.getState().overlayTemplates.hasPendingUpdate).toBe(true);
    });

    it("is a no-op when the id does not exist", () => {
      const store = createStore();
      store.dispatch(
        addTemplate({ type: "participant", template: makeTemplate("t1", "T1") }),
      );
      store.dispatch(
        deleteTemplate({ type: "participant", templateId: "missing" }),
      );
      expect(
        store.getState().overlayTemplates.templatesByType.participant,
      ).toHaveLength(1);
    });
  });

  describe("updateTemplatesFromRemote", () => {
    it("replaces all templates with remote data without setting hasPendingUpdate", () => {
      const store = createStore();
      store.dispatch(
        addTemplate({ type: "participant", template: makeTemplate("t1", "Old") }),
      );
      store.dispatch(setHasPendingUpdate(false));
      store.dispatch(
        updateTemplatesFromRemote({
          participant: [makeTemplate("t2", "Remote")],
          "stick-to-bottom": [],
          "qr-code": [],
          image: [],
        }),
      );
      const state = store.getState().overlayTemplates;
      expect(state.templatesByType.participant).toHaveLength(1);
      expect(state.templatesByType.participant[0].name).toBe("Remote");
      expect(state.hasPendingUpdate).toBe(false);
    });
  });

  describe("setIsLoading", () => {
    it("sets isLoading flag", () => {
      const store = createStore();
      store.dispatch(setIsLoading(true));
      expect(store.getState().overlayTemplates.isLoading).toBe(true);
      store.dispatch(setIsLoading(false));
      expect(store.getState().overlayTemplates.isLoading).toBe(false);
    });
  });

  describe("setHasPendingUpdate", () => {
    it("sets hasPendingUpdate flag", () => {
      const store = createStore();
      store.dispatch(setHasPendingUpdate(true));
      expect(store.getState().overlayTemplates.hasPendingUpdate).toBe(true);
      store.dispatch(setHasPendingUpdate(false));
      expect(store.getState().overlayTemplates.hasPendingUpdate).toBe(false);
    });
  });
});
