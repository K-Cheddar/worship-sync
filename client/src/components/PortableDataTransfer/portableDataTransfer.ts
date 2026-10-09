import type { PortableDataType } from "../../api/authTypes";
import { downloadPortableData } from "../../api/auth";

export const PORTABLE_DATA_TYPES: Array<{
  id: PortableDataType;
  label: string;
  required: string[];
}> = [
  { id: "members", label: "Members", required: ["firstName", "lastName"] },
  { id: "teams", label: "Teams", required: ["name"] },
  { id: "positions", label: "Positions", required: ["name", "team"] },
  { id: "services", label: "Services", required: ["name", "recurrence"] },
  { id: "schedules", label: "Schedules", required: ["name", "team", "service", "date"] },
];

export const PORTABLE_FIELD_LABELS: Record<string, string> = {
  firstName: "First name", lastName: "Last name", title: "Title", email: "Email", phone: "Phone", teams: "Teams", positions: "Positions / Categories", notes: "Notes", servingFrequency: "Serving frequency", archived: "Archived", memberId: "WorshipSync Member ID", teamIds: "WorshipSync Team IDs", positionIds: "WorshipSync Position IDs", status: "Source status", smsOptIn: "Source SMS opt-in", timezone: "Source timezone", skillTiers: "Skill tiers (not applied)",
  name: "Name / person", description: "Description", usesMicrophones: "Uses microphones", usesIems: "Uses IEMs", team: "Team", group: "Group", order: "Order", positionId: "WorshipSync Position ID", teamId: "WorshipSync Team ID", icon: "Icon",
  recurrence: "Recurrence", time: "Time", date: "Date", daysOfWeek: "Days of week", startDate: "Start date", endDate: "End date", weekOrdinal: "Week ordinal", weekday: "Weekday", combinedGroup: "Combined group", position: "Position", requiredSlots: "Required slots", serviceId: "WorshipSync Service ID",
  startTime: "Start time", slot: "Slot", person: "Person", assignmentType: "Assignment type", guest: "Guest", scheduleId: "WorshipSync Schedule ID", occurrenceId: "WorshipSync Occurrence ID",
};

export const PORTABLE_FIELD_ORDER: Record<PortableDataType, string[]> = {
  members: ["firstName", "lastName", "name", "title", "email", "phone", "teams", "positions", "notes", "servingFrequency", "archived", "memberId", "teamIds", "positionIds", "status", "smsOptIn", "timezone", "skillTiers"],
  teams: ["name", "description", "usesMicrophones", "usesIems", "archived", "teamId", "icon"],
  positions: ["name", "team", "description", "group", "order", "archived", "positionId", "teamId"],
  services: ["name", "recurrence", "time", "date", "daysOfWeek", "startDate", "endDate", "weekOrdinal", "weekday", "combinedGroup", "position", "requiredSlots", "archived", "serviceId", "positionId"],
  schedules: ["name", "startDate", "endDate", "service", "date", "startTime", "team", "position", "slot", "person", "email", "assignmentType", "guest", "scheduleId", "occurrenceId", "serviceId", "teamId", "positionId", "memberId"],
};

export const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

export const downloadPortableCsv = async (churchId: string, type: PortableDataType) => {
  const result = await downloadPortableData(
    churchId,
    type,
    false,
    Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );
  downloadBlob(result.blob, result.filename);
};
