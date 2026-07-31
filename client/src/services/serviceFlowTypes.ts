export type ServiceFlowTextSpan = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
};

export type ServiceFlowRichText = {
  blocks: Array<{
    type: "paragraph" | "list-item";
    /** Absent means left, matching the editor-side RichTextBlock. */
    align?: "left" | "center" | "right";
    /** Absent means normal; a fixed scale, not a free font size. */
    size?: "small" | "large";
    /** Legacy list items omit this and render as bullets. */
    listStyle?: "bullet" | "ordered";
    /** Zero/absent is the top list level. */
    indent?: number;
    /** Ordered-list restart value; absent means continue or start at 1. */
    listStart?: number;
    spans: ServiceFlowTextSpan[];
  }>;
};

export type PublicServiceFlowTeamNote = {
  label: string;
  notes: ServiceFlowRichText;
  scope?: "role";
  positionId?: string;
  teamId?: string;
  teamName?: string;
};

export type PublicServiceFlowItem = {
  id: string;
  title: string;
  durationSeconds: number;
  notes: ServiceFlowRichText;
  teamNotes?: PublicServiceFlowTeamNote[];
  creditName?: string;
};

export type PublicServiceFlowSection = {
  id: string;
  title: string;
  items: PublicServiceFlowItem[];
};

export type PublicServiceFlow = {
  shareId: string;
  viewMode?: "team" | "general";
  title: string;
  startsAt: string;
  timezone: string;
  revision: number;
  sections: PublicServiceFlowSection[];
  live:
    | { mode: "schedule" }
    | { mode: "manual"; currentItemId: string }
    | { mode: "anchored"; currentItemId: string; startedAt: string };
};

export type PublicServiceFlowSnapshot = {
  success: true;
  churchName: string;
  churchLogoUrl?: string;
  /** First/primary church brand swatch when branding is configured. */
  churchPrimaryColor?: string;
  /** Second church brand swatch (Color 2) for simple-view accents. */
  churchSecondaryColor?: string;
  serverNowMs: number;
  service: PublicServiceFlow;
};
