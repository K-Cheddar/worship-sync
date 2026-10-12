export type OccurrenceIdentityShape = {
  occurrenceId?: string;
  logicalOccurrenceId?: string;
  serviceId?: string;
  serviceIds?: string[];
  groupId?: string;
  serviceDate?: string;
  startsAt?: string;
};

export function serviceDateTimeInTimeZone(date: string, time: string, timeZone: string): Date | null;
export function calendarDateInTimeZone(date: Date | string | number, timeZone: string): string;
export function logicalOccurrenceIdForService(serviceId: string, serviceDate: string): string;
export function logicalOccurrenceIdForGroup(groupId: string, serviceDate: string): string;
export function resolveOccurrenceIdentity(occurrence: OccurrenceIdentityShape, timeZone?: string): {
  logicalOccurrenceId: string;
  serviceDate: string;
  groupId: string;
  serviceIds: string[];
} | null;
export function sameOccurrenceIdentity(left: OccurrenceIdentityShape, right: OccurrenceIdentityShape, timeZone?: string): boolean;
export function matchOccurrencesByIdentity<T extends OccurrenceIdentityShape>(stored: T[], current: T[], timeZone?: string): {
  matches: Map<string, T>;
  ambiguousCurrentIds: Set<string>;
  matchedStoredIds: Set<string>;
};
export function occurrenceIdentityListsMatch(left: OccurrenceIdentityShape[], right: OccurrenceIdentityShape[], timeZone?: string): boolean;
export function hasOccurrenceIdentityAmbiguity(stored: OccurrenceIdentityShape[], current: OccurrenceIdentityShape[], timeZone?: string): boolean;
export function occurrenceScheduleDetailsMatch(left: OccurrenceIdentityShape[], right: OccurrenceIdentityShape[], timeZone?: string): boolean;
export function preserveStoredOccurrenceIds<T extends OccurrenceIdentityShape>(stored: T[], current: T[], timeZone?: string): T[] | null;
