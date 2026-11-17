import diff from "fast-diff";

type Edit = { start: number; end: number; text: string };
const applyEdit = (base: string, edit: Edit) => base.slice(0, edit.start) + edit.text + base.slice(edit.end);
const hasAmbiguousPosition = (base: string, edit: Edit) => {
  const result = applyEdit(base, edit);
  return [-1, 1].some(shift => edit.start + shift >= 0 && edit.end + shift <= base.length &&
    applyEdit(base, { ...edit, start: edit.start + shift, end: edit.end + shift }) === result);
};
function edits(base: string, next: string): Edit[] {
  let offset = 0;
  const result: Edit[] = [];
  let pending: Edit | undefined;
  for (const [kind, text] of diff(base, next)) {
    if (kind === 0) {
      if (pending) result.push(pending);
      pending = undefined;
      offset += text.length;
    } else {
      pending ??= { start: offset, end: offset, text: "" };
      if (kind === -1) { offset += text.length; pending.end = offset; }
      else pending.text += text;
    }
  }
  if (pending) result.push(pending);
  return result;
}

/** Authored offsets, not slide positions. Ambiguous/overlapping edits conflict. */
export function mergeLyricText(base: string, local: string, remote: string): string | null {
  if (local === base || local === remote) return remote;
  if (remote === base) return local;
  const localEdits = edits(base, local);
  const remoteEdits = edits(base, remote);
  // Repeated lyric lines/runs can admit several equivalent authored offsets.
  // Do not guess which copy a deletion/replacement targeted while merging.
  if ([...localEdits, ...remoteEdits].some(edit => hasAmbiguousPosition(base, edit))) return null;
  const combined = [...remoteEdits];
  for (const edit of localEdits) {
    if (remoteEdits.some(other => other.start === edit.start && other.end === edit.end && other.text === edit.text)) continue;
    if (remoteEdits.some(other =>
      // Insertions at a replaced range boundary are ambiguous as well.
      edit.start <= other.end && other.start <= edit.end &&
      !(edit.start === other.end && edit.start !== edit.end && other.start !== other.end) &&
      !(other.start === edit.end && edit.start !== edit.end && other.start !== other.end))) return null;
    combined.push(edit);
  }
  let merged = base;
  for (const edit of combined.sort((a, b) => b.start - a.start)) {
    merged = applyEdit(merged, edit);
  }
  return merged;
}
