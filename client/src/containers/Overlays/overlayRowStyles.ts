/** Unselected overlay list row chrome (shared by Overlay rows, loading skeleton). */
export const overlayRowUnselectedClass =
  "border-white/10 bg-black/50 hover:border-white/20";

/** Selected overlay row — matches controller list selection (Credits editor reuses this). */
export const overlayRowSelectedClass =
  "border-cyan-500 bg-cyan-950/45 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.35)]";

/** Credits editor list row when not selected. */
export const creditRowUnselectedClass = `${overlayRowUnselectedClass} rounded-md`;

/** Credits editor list row when selected. */
export const creditRowSelectedClass = `${overlayRowSelectedClass} rounded-md`;
