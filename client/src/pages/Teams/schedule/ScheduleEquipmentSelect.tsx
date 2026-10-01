/**
 * Equipment-oriented entry point for the shared schedule selector.
 *
 * ScheduleMicrophoneSelect remains as a compatibility module for existing
 * schedule imports and tests; its implementation already renders both
 * microphone and IEM controls.
 */
export { default } from "./ScheduleMicrophoneSelect";
export type { ScheduleMicrophoneHolder as ScheduleEquipmentHolder } from "./ScheduleMicrophoneSelect";
