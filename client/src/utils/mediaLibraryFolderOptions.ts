import type { MediaFolder, Option } from "../types";

/**
 * Synthetic `Option.value` for Move to folder: opens create-folder flow, then
 * moves the selection into the new folder (not a real folder id).
 */
export const MEDIA_LIBRARY_MOVE_TO_NEW_FOLDER = "__move_to_new_folder__";

/** Flat tree options for Move-to `Select` (indented labels). */
export function buildFolderTreeSelectOptions(folders: MediaFolder[]): {
  tree: { id: string; label: string }[];
  selectOptions: Option[];
} {
  const byParent = new Map<string | null, MediaFolder[]>();
  for (const f of folders) {
    const p = f.parentId ?? null;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p)!.push(f);
  }
  const sortKids = (arr: MediaFolder[]) =>
    [...arr].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
  const tree: { id: string; label: string }[] = [];
  const walk = (parentId: string | null, prefix: string) => {
    const kids = sortKids(byParent.get(parentId) || []);
    for (const k of kids) {
      tree.push({ id: k.id, label: `${prefix}${k.name}` });
      walk(k.id, `${prefix}— `);
    }
  };
  walk(null, "");

  const selectOptions: Option[] = [
    { value: "__root__", label: "Library root" },
    ...tree.map((o) => ({ value: o.id, label: o.label })),
  ];

  return { tree, selectOptions };
}
