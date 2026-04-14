/** Unselected overlay list row chrome (shared by Overlay rows, loading skeleton). */
export const overlayRowUnselectedClass =
  "border-white/10 bg-black/50 hover:border-white/20";

/** Selected overlay row — matches controller list selection (Credits editor reuses this). */
export const overlayRowSelectedClass =
  "border-cyan-500 bg-cyan-950/45 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.35)]";

/**
 * Credits editor list row — frosted glass (distinct from overlay list rows).
 */
export const creditRowUnselectedClass =
  "rounded-md border border-transparent bg-black/[0.22] backdrop-blur-md " +
  "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.07)] " +
  "hover:border-white/18 hover:bg-black/[0.30]";

/** Credits editor list row when selected — glass + cyan accent (mid tone). */
export const creditRowSelectedClass =
  "rounded-md border border-cyan-400/50 bg-cyan-950 backdrop-blur-md " +
  "shadow-[inset_0_0_0_1px_rgba(34,211,238,0.42),inset_0_1px_0_0_rgba(255,255,255,0.08)]";
