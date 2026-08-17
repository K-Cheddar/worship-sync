import { QuickLinkType } from "../types";
import { DisplayOutput, isBuiltInOutputId } from "./displayOutputs";

/**
 * Does this quick link belong to this display output?
 *
 * Links are bound to a display by `outputId`. A link saved before outputs
 * existed has none, and falls back to the **built-in** display of its
 * `displayType` — not to every display of that kind. Otherwise adding a second
 * projector would silently inherit the main projector's links, and an operator
 * pressing one on the lobby screen would send content they did not expect.
 */
export const isQuickLinkForOutput = (
  link: QuickLinkType,
  output: Pick<DisplayOutput, "id" | "type">,
) => {
  if (link.outputId) return link.outputId === output.id;
  if (!link.displayType) return false;
  return isBuiltInOutputId(output.id) && link.displayType === output.type;
};

/** Links for one display, capped for surfaces that show only a few. */
export const getQuickLinksForOutput = (
  links: QuickLinkType[],
  output: Pick<DisplayOutput, "id" | "type">,
  maxLinks?: number,
) => {
  const matched = links.filter((link) => isQuickLinkForOutput(link, output));
  return maxLinks === undefined ? matched : matched.slice(0, maxLinks);
};
