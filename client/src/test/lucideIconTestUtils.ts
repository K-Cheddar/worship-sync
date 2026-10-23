import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { LucideIcon } from "lucide-react";

export const getLucideIconInnerMarkup = (icon: LucideIcon): string => {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(createElement(icon));
  const renderedIcon = container.querySelector("svg");
  if (!renderedIcon) throw new Error("Expected a Lucide icon to render as an SVG.");
  return renderedIcon.innerHTML;
};
