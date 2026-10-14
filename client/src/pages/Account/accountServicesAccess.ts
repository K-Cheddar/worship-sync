import type { MemberPermissions, ServicesPermission } from "../../api/authTypes";

export const serviceEditingAccessOptions: {
  value: ServicesPermission;
  label: string;
}[] = [
  { value: "none", label: "None" },
  { value: "view", label: "View" },
  { value: "edit", label: "Edit" },
];

export const toServicesAccessOption = (
  permissions?: MemberPermissions,
  role?: string,
): ServicesPermission => (role === "admin" ? "edit" : permissions?.services || "none");

/** Teams edit is intentionally a superset of Services edit for legacy editors. */
export const formatMemberServicesAccessSummary = (
  permissions?: MemberPermissions,
  role?: string,
) =>
  role === "admin" ||
  permissions?.teams === "edit" ||
  permissions?.services === "edit"
    ? "Edit services and plans"
    : "No service editing";
