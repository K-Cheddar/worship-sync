export type WorkstationAccessOption = "full" | "music" | "view";
export type DisplaySurfaceOption =
  | "projector"
  | "projector-display"
  | "monitor"
  | "stream"
  | "stream-info"
  | "credits";

export const workstationAccessOptions: { value: WorkstationAccessOption; label: string }[] = [
  { value: "full", label: "Full access" },
  { value: "music", label: "Music access" },
  { value: "view", label: "View access" },
];

export const displaySurfaceOptions: { value: DisplaySurfaceOption; label: string }[] = [
  { value: "projector", label: "Full-frame projector" },
  { value: "projector-display", label: "Projector with controls" },
  { value: "monitor", label: "Monitor layout" },
  { value: "stream", label: "Stream layout" },
  { value: "stream-info", label: "Stream info layout" },
  { value: "credits", label: "Credits layout" },
];
