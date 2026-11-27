export type SlideEditingScope = "all" | "selected";

export const SLIDE_EDITING_SCOPE_STORAGE_KEY =
  "worshipsync_slide_editing_scope";

export const readSlideEditingScope = (): SlideEditingScope =>
  localStorage.getItem(SLIDE_EDITING_SCOPE_STORAGE_KEY) === "selected"
    ? "selected"
    : "all";

export const saveSlideEditingScope = (scope: SlideEditingScope) => {
  localStorage.setItem(SLIDE_EDITING_SCOPE_STORAGE_KEY, scope);
};
