import type { Display } from "../types/electron";

export function getDisplayLabel(display: Display, index: number): string {
  const resolution = `${display.bounds.width}x${display.bounds.height}`;
  const type = display.internal ? "Built-in" : "External";
  const displayNumber = index + 1;
  if (display.label) {
    return `${display.label} (${resolution})`;
  }
  return `Display ${displayNumber} - ${type} (${resolution})`;
}
