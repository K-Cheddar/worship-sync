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
  positionIds?: string[];
  teamId?: string;
  teamName?: string;
  teamIds?: string[];
  teamNames?: string[];
};

export type PublicServiceFlowMicrophoneAudience = {
  positionId: string;
  roleName: string;
  teamId?: string;
  teamName?: string;
};

export type PublicServiceFlowMicrophoneAssignment = {
  microphone: {
    id: string;
    name: string;
    type: string;
    color: string;
  };
  audiences: PublicServiceFlowMicrophoneAudience[];
  /** The person holding it, when the item names one. */
  holderName?: string;
};

export type PublicServiceFlowItem = {
  id: string;
  title: string;
  durationSeconds: number;
  notes: ServiceFlowRichText;
  teamNotes?: PublicServiceFlowTeamNote[];
  microphoneAssignments?: PublicServiceFlowMicrophoneAssignment[];
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
  /**
   * Where the planned item timeline begins, which is the first item's own
   * start time — pre-service items can put that before the service's
   * `startsAt` (a 9:45 call time on a 10:00 service). Absent when the plan
   * starts exactly at `startsAt`, and on snapshots published before this
   * existed, so readers fall back to `startsAt`.
   */
  timelineStartsAt?: string;
  timezone: string;
  revision: number;
  sections: PublicServiceFlowSection[];
  live:
    | { mode: "schedule" }
    | { mode: "manual"; currentItemId: string }
    | { mode: "anchored"; currentItemId: string; startedAt: string };
};

export type PublicServiceFlowRole = {
  positionId: string;
  label: string;
  teamId?: string;
  teamName?: string;
};

export type PublicServiceFlowSnapshot = {
  success: true;
  churchName: string;
  churchLogoUrl?: string;
  /** First/primary church brand swatch when branding is configured. */
  churchPrimaryColor?: string;
  /** Second church brand swatch (Color 2) for simple-view accents. */
  churchSecondaryColor?: string;
  /**
   * Full non-archived role roster for the detailed-view notes/mic filter.
   * Absent on simple/general view and on older snapshots.
   */
  roles?: PublicServiceFlowRole[];
  serverNowMs: number;
  service: PublicServiceFlow;
};
