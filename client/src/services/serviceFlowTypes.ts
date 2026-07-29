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
    spans: ServiceFlowTextSpan[];
  }>;
};

export type PublicServiceFlowTeamNote = {
  label: string;
  notes: ServiceFlowRichText;
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
  live: { mode: "schedule" } | { mode: "manual"; currentItemId: string };
};

export type PublicServiceFlowSnapshot = {
  success: true;
  churchName: string;
  churchLogoUrl?: string;
  serverNowMs: number;
  service: PublicServiceFlow;
};
